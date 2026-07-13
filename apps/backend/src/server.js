import cors from "cors";
import express from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { runCodexReviewWorkflow, runCodexWorkflow } from "./codexWorkflow.js";
import { createBuilderXOrchestrationEnvelope } from "./builderXAuthority.js";
import { isTransientWorkflowError, selectAdaptiveRoute } from "./adaptiveOrchestration.js";
import { generateWebpage } from "./generator.js";
import { formatProjectOrchestratorInstruction, orchestrateBuilderInstruction } from "./orchestratorAgent.js";
import { buildAgenticSystemGraph, syncProjectAgentTopology } from "./projectAgents.js";
import {
  createProject,
  deleteProject,
  ensureProjectPreview,
  exportProject,
  getProject,
  importProject,
  ensureProjectPreviewWithPortRetry,
  listProjects,
  saveProjectMedia,
  startRegisteredProjects
} from "./projectManager.js";
import { restartGeneratedRuntime } from "./runtimeRestart.js";
import { runProjectOrchestratorBootstrap } from "./projectBootstrap.js";
import { listGlobalAgents } from "./globalAgentKnowledge.js";
import { scheduleAgentMemorySync, syncKnownAgentKnowledgeRoots } from "./vectorMemorySync.js";
import { registerHostingRoutes } from "./hosting/hosting-conversation.controller.js";
import { authenticateGooglePayload, restrictedIntent, userFromRequest } from "./auth.js";
import { readAgentEfficiencySummary } from "./tokenEconomy.js";
import { authConfigurationDiagnostics, listProviderConfigs, providerConfig } from "./providerAuth.js";
import {
  createCodexProfile,
  deleteCodexProfile,
  enableCodexProfile,
  getCodexProfileLoginSession,
  listCodexProfiles,
  loginCommandForProfile,
  markCodexProfileAvailable,
  markCodexProfileUnavailable,
  openCodexProfileLogin,
  refreshAllCodexProfileUsage,
  refreshCodexProfileUsage,
  setDefaultCodexProfile,
  updateCodexProfile,
  validateCodexProfile
} from "./codexProfiles.js";

const app = express();
const port = Number(process.env.PORT || 8080);
const clients = new Set();
const runtimeLog = [];
const workflowEventBuffers = new Map();
const runtimeLogPath =
  process.env.WORKFLOW_RUNTIME_LOG_PATH || process.env.MCP_RUNTIME_LOG_PATH || "/workspace/runtime/workflow-runtime-log.jsonl";
const MAX_RUNTIME_LOG_ROWS = 400;
const previewUrl = process.env.GENERATED_SITE_URL || "http://localhost:5174";
const upload = multer({ dest: "/tmp/agentic-builderx-uploads" });
const istTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata"
});

const GenerateSchema = z.object({
  instruction: z.string().min(12).max(8000),
  projectId: z.string().optional(),
  taskType: z.enum(["Simple", "Medium", "Large", "Hard", "simple", "medium", "large", "hard", "small", "complex"]).optional(),
  mediaIds: z.array(z.string()).optional(),
  codexProfileId: z.string().optional()
});
const NewProjectSchema = z.object({
  name: z.string().min(2).max(80),
  instruction: z.string().min(12).max(8000).optional(),
  taskType: z.enum(["Simple", "Medium", "Large", "Hard", "simple", "medium", "large", "small", "hard", "complex"]).optional(),
  mediaIds: z.array(z.string()).optional(),
  stagedMediaIds: z.array(z.string()).optional(),
  stagedDocumentIds: z.array(z.string()).optional()
});
const ProjectImportSchema = z.object({
  name: z.string().min(2).max(80)
});
const CodexProfileSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  displayName: z.string().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  priority: z.number().optional()
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function rejectRestrictedIntent(res, text) {
  const restricted = restrictedIntent(text);
  if (!restricted) return false;
  res.status(403).json({
    status: "restricted",
    error: restricted.reason
  });
  return true;
}

function persistRuntimeLogEvent(payload) {
  fs.mkdirSync(path.dirname(runtimeLogPath), { recursive: true });
  const existingRows = fs.existsSync(runtimeLogPath)
    ? fs
        .readFileSync(runtimeLogPath, "utf8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
    : [];
  const rows = [...existingRows.slice(-(MAX_RUNTIME_LOG_ROWS - 1)), JSON.stringify(payload)];
  fs.writeFileSync(runtimeLogPath, `${rows.join("\n")}\n`);
}

function event(type, message, extra = {}) {
  const payload = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    message,
    createdAt: new Date().toISOString(),
    time: `${istTimeFormatter.format(new Date())} IST`,
    ...extra
  };
  runtimeLog.unshift(payload);
  runtimeLog.splice(MAX_RUNTIME_LOG_ROWS);
  if (payload.type !== "builderx-complete") {
    for (const key of [payload.parentWorkflowId, payload.buildId].filter(Boolean)) {
      const rows = workflowEventBuffers.get(key) || [];
      rows.push(payload);
      workflowEventBuffers.set(key, rows);
    }
  }
  persistRuntimeLogEvent(payload);
  console.log(`[workflow-runtime] ${payload.type}: ${payload.message}`);
  for (const client of clients) {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

function createOrchestrationBuildSnapshot({
  projectId = "",
  projectName = "BuilderX default workspace",
  instruction = "",
  taskType = "Medium",
  status = "succeeded",
  buildId = "",
  parentWorkflowId = "",
  childExecutionIds = [],
  flowPath = null,
  changedFiles = [],
  error = ""
} = {}) {
  const completedAt = new Date().toISOString();
  const snapshotAgents = flowPath?.activeAgents || [];
  const projectExecutorId = snapshotAgents.find((agent) =>
    agent.id && agent.id !== "builderx-fullstack-agent" && !String(agent.id).includes("reviewer") && !String(agent.id).includes("qagent")
  )?.id || "project-execution-agent";
  const reviewerId = snapshotAgents.find((agent) => String(agent.id).includes("reviewer") || String(agent.id).includes("qagent"))?.id || "builderx-independent-reviewer";
  const responsibleAgentForType = (type = "", explicitId = "") => {
    if (explicitId) return explicitId;
    if (/review|qagent/i.test(type)) return reviewerId;
    if (/delegation|generating|codex|files-applied|build-start|codegen/i.test(type)) return projectExecutorId;
    return "builderx-fullstack-agent";
  };
  const bufferedEvents = [
    ...(workflowEventBuffers.get(parentWorkflowId) || []),
    ...(workflowEventBuffers.get(buildId) || [])
  ];
  const workflowEvents = [...bufferedEvents, ...runtimeLog]
    .filter((row) => {
      if (parentWorkflowId && row.parentWorkflowId === parentWorkflowId) return true;
      if (buildId && row.buildId === buildId) return true;
      return false;
    })
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  const startedAt = workflowEvents[0]?.createdAt || completedAt;
  const terminalType = status === "succeeded" ? "builderx-complete" : "builderx-failed";
  const timeline = workflowEvents.map((row, index) => ({
    id: row.id || `${parentWorkflowId || buildId}-${index + 1}`,
    sequence: index + 1,
    type: row.type,
    message: row.message,
    createdAt: row.createdAt,
    elapsedMs: Math.max(0, new Date(row.createdAt || startedAt).getTime() - new Date(startedAt).getTime()),
    stage: row.stage || "",
    agentId: responsibleAgentForType(row.type, row.agentId || row.reviewerAgentId),
    childExecutionId: row.childExecutionId || "",
    status: row.status || (row.type?.includes("failed") || row.type === "error" ? "failed" : "recorded"),
    decision: row.adaptiveRoute ? {
      kind: "selected",
      value: row.adaptiveRoute.mode,
      reason: row.adaptiveRoute.reasons?.join(" ") || "Selected by adaptive orchestration."
    } : null
  }));
  if (!timeline.some((row) => row.type === terminalType || (status === "succeeded" && row.type === "builderx-complete"))) {
    timeline.push({
      id: `${parentWorkflowId || buildId || "workflow"}-terminal`,
      sequence: timeline.length + 1,
      type: terminalType,
      message: status === "succeeded" ? "BuilderX approved workflow completion." : `BuilderX rejected workflow completion: ${error || "execution failed"}`,
      createdAt: completedAt,
      elapsedMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
      stage: "terminal",
      agentId: "builderx-fullstack-agent",
      childExecutionId: "",
      status,
      decision: null
    });
  }
  const stableBuildId = buildId || `failed_${String(parentWorkflowId || Date.now()).replace(/^builderx_/, "").slice(0, 18)}`;
  const generatedFeatures = [
    ...(flowPath?.functionalities || []).map((item) => ({ id: item.id, label: item.label, detail: item.detail, state: item.state })),
    ...(flowPath?.featureActions || []).map((item) => ({ id: item.id, label: item.label, detail: item.reason, state: item.status, target: item.target }))
  ].filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id && candidate.label === item.label) === index);
  const agentWork = snapshotAgents.map((agent) => ({
    agentId: agent.id,
    name: agent.name,
    role: agent.role,
    work: [...new Set([
      agent.action,
      ...timeline.filter((item) => item.agentId === agent.id).map((item) => item.message),
      ...generatedFeatures.filter((feature) => agent.id === projectExecutorId).map((feature) => `Generated feature: ${feature.label}`)
    ].filter(Boolean))].slice(0, 12)
  }));
  const routeChoices = flowPath?.decisionTree?.children
    ?.find((node) => node.id === "adaptive-routing")?.children || [];
  const selectedRoute = routeChoices.find((choice) => choice.state === "selected") || {
    id: flowPath?.adaptiveRoute?.mode || "adaptive-route",
    label: `Route: ${flowPath?.adaptiveRoute?.mode || "adaptive"}`,
    state: status === "succeeded" ? "selected" : "failed",
    reason: flowPath?.adaptiveRoute?.reasons?.join(" ") || error
  };
  const executionChoices = snapshotAgents.map((agent) => ({
    id: `agent-choice-${agent.id}`,
    label: agent.name,
    state: agent.status === "failed" ? "failed" : "selected",
    detail: agent.action || agent.role,
    responsibleAgentId: agent.id
  }));
  executionChoices.push({
    id: "unassigned-execution",
    label: "Unassigned execution",
    state: "rejected",
    detail: "Rejected because every execution and review step requires explicit agent ownership.",
    responsibleAgentId: "builderx-fullstack-agent"
  });
  const scopeChoices = [
    ...generatedFeatures.slice(0, 10).map((item) => ({
      id: item.id,
      label: item.label,
      state: item.state === "failed" ? "failed" : "selected",
      detail: item.detail,
      responsibleAgentId: projectExecutorId
    })),
    ...(flowPath?.rejectedPaths || []).filter((item) => !routeChoices.some((choice) => choice.id === item.id)).slice(0, 4).map((item) => ({
      id: `scope-rejection-${item.id}`,
      label: item.id,
      state: "rejected",
      detail: item.reason,
      responsibleAgentId: item.responsibleAgentId || "builderx-fullstack-agent"
    }))
  ];
  const completionChoices = status === "succeeded"
    ? [
        { id: "completion-approved", label: "Approve build", state: "selected", detail: "Execution and validation evidence passed.", responsibleAgentId: "builderx-fullstack-agent" },
        { id: "completion-rejected", label: "Reject completion", state: "rejected", detail: "Not selected because required evidence passed.", responsibleAgentId: "builderx-fullstack-agent" }
      ]
    : [
        { id: "completion-approved", label: "Approve build", state: "rejected", detail: error || "Validation evidence did not pass.", responsibleAgentId: "builderx-fullstack-agent" },
        { id: "completion-rejected", label: "Reject completion", state: "selected", detail: error || "BuilderX rejected completion.", responsibleAgentId: "builderx-fullstack-agent" }
      ];
  const stages = [
    { id: "route-decision", label: "Select orchestration route", responsibleAgentId: "builderx-fullstack-agent", choices: routeChoices.length ? routeChoices.map((choice) => ({ ...choice, responsibleAgentId: "builderx-fullstack-agent", detail: choice.reason })) : [selectedRoute] },
    { id: "agent-decision", label: "Assign responsible agents", responsibleAgentId: "builderx-fullstack-agent", choices: executionChoices },
    { id: "scope-decision", label: "Generate selected features", responsibleAgentId: projectExecutorId, choices: scopeChoices.length ? scopeChoices : [{ id: "scope-recorded", label: "Execute requested scope", state: status === "succeeded" ? "selected" : "failed", detail: error || "Requested scope executed.", responsibleAgentId: projectExecutorId }] },
    { id: "completion-decision", label: "BuilderX completion gate", responsibleAgentId: "builderx-fullstack-agent", choices: completionChoices }
  ];
  const buildDecisionGraph = (stageIndex = 0) => {
    const stage = stages[stageIndex];
    if (!stage) return null;
    const choices = stage.choices.map((choice) => ({
      ...choice,
      type: "choice",
      children: []
    }));
    const continuation = choices.find((choice) => ["selected", "completed", "passed"].includes(choice.state));
    const nextStage = buildDecisionGraph(stageIndex + 1);
    if (continuation && nextStage) continuation.children.push(nextStage);
    return { ...stage, type: "decision", state: "recorded", children: choices };
  };
  const snapshot = {
    schemaVersion: 2,
    id: `${parentWorkflowId || stableBuildId}:snapshot`,
    snapshotBuildId: stableBuildId,
    buildId,
    parentWorkflowId,
    childExecutionIds,
    projectId,
    projectName,
    instruction,
    taskType,
    status,
    startedAt,
    completedAt,
    durationMs: Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime()),
    route: flowPath?.adaptiveRoute || null,
    agents: snapshotAgents,
    agentWork,
    generatedFeatures,
    selectedDecisions: (flowPath?.executedDecisions || []).map((decision) => ({
      ...decision,
      responsibleAgentId: decision.responsibleAgentId || (/generation|implementation/i.test(decision.id || decision.label) ? projectExecutorId : "builderx-fullstack-agent")
    })),
    rejectedDecisions: (flowPath?.rejectedPaths || []).map((decision) => ({
      ...decision,
      responsibleAgentId: decision.responsibleAgentId || "builderx-fullstack-agent"
    })),
    decisionTree: flowPath?.decisionTree || null,
    decisionGraph: {
      id: `${parentWorkflowId || stableBuildId}-start`,
      label: "Build instruction accepted",
      type: "start",
      state: "selected",
      responsibleAgentId: "builderx-fullstack-agent",
      detail: instruction,
      children: [buildDecisionGraph()].filter(Boolean)
    },
    validation: {
      status: status === "succeeded" ? "passed" : "failed",
      review: flowPath?.adaptiveRoute?.requiresIndependentReview ? "independent" : "builderx",
      error
    },
    changedFiles,
    timeline
  };
  if (parentWorkflowId) workflowEventBuffers.delete(parentWorkflowId);
  if (buildId) workflowEventBuffers.delete(buildId);
  return snapshot;
}

async function runBuilderXOwnedWorkflow(orchestratedRequest, options, orchestrationEnvelope, adaptiveRoute) {
  const maxAttempts = Math.max(1, Number(process.env.BUILDERX_WORKFLOW_MAX_ATTEMPTS || 2));
  let lastError;
  let result;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const delegatedAgent = orchestrationEnvelope.delegations[0];
      const executionAgentId = adaptiveRoute.executionAgent === "project-orchestrator" && delegatedAgent
        ? delegatedAgent.agentId
        : "builderx-fullstack-agent";
      const executionAgentName = executionAgentId === "builderx-fullstack-agent"
        ? "BuilderX Fullstack Agent"
        : `${options.projectName || "Project"} Orchestrator Agent`;
      result = await runCodexWorkflow(orchestratedRequest, {
        ...options,
        attempt,
        executionAgentId,
        executionAgentName
      });
      break;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientWorkflowError(error)) break;
      event("builderx-retry", `BuilderX is retrying failed execution (${attempt + 1}/${maxAttempts})`, {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionIds: orchestrationEnvelope.childExecutionIds,
        attempt,
        nextAttempt: attempt + 1,
        retryReason: "transient_failure",
        error: error.message
      });
    }
  }
  if (!result) throw lastError;

  let review = null;
  if (adaptiveRoute.requiresIndependentReview) {
    const reviewAttempts = Math.max(1, Number(process.env.BUILDERX_REVIEW_MAX_ATTEMPTS || 2));
    for (let attempt = 1; attempt <= reviewAttempts; attempt += 1) {
      try {
        review = await runCodexReviewWorkflow(orchestratedRequest, result, {
          ...options,
          reviewerAgentId: adaptiveRoute.reviewerAgentId
        });
        break;
      } catch (error) {
        if (attempt >= reviewAttempts || !isTransientWorkflowError(error)) throw error;
        event("review-retry", `BuilderX is retrying transient reviewer failure (${attempt + 1}/${reviewAttempts})`, {
          parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
          reviewerAgentId: adaptiveRoute.reviewerAgentId,
          attempt,
          nextAttempt: attempt + 1,
          error: error.message
        });
      }
    }
  }
  return { ...result, adaptiveRoute, review };
}

function safeFileBase(value = "document") {
  return String(value || "document")
    .replace(/\.[^.]+$/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "document";
}

function safeExtension(value = "") {
  const ext = path.extname(String(value || "")).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return ext || ".txt";
}

function stagedDocumentRoot(user) {
  const userId = safeFileBase(user?.id || "anonymous");
  return path.join(builderxProjectRoot(), "runtime", "staged-project-documents", userId);
}

function stagedDocumentIndexPath(user) {
  return path.join(stagedDocumentRoot(user), "index.json");
}

function stagedMediaRoot(user) {
  const userId = safeFileBase(user?.id || "anonymous");
  return path.join(builderxProjectRoot(), "runtime", "staged-project-media", userId);
}

function stagedMediaIndexPath(user) {
  return path.join(stagedMediaRoot(user), "index.json");
}

function documentPurposeFromName(name = "", mimeType = "") {
  const value = `${name} ${mimeType}`.toLowerCase();
  if (value.includes("requirement") || value.includes("prd") || value.includes("scope")) return "requirements";
  if (value.includes("design") || value.includes("wireframe") || value.includes("figma")) return "design";
  if (value.includes("api") || value.includes("openapi") || value.includes("swagger")) return "api";
  if (value.includes("data") || value.includes("schema")) return "data-model";
  return "project-documentation";
}

async function readStagedDocuments(user) {
  const indexPath = stagedDocumentIndexPath(user);
  if (!fs.existsSync(indexPath)) return [];
  const rows = await fs.promises.readFile(indexPath, "utf8").then((value) => JSON.parse(value)).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function writeStagedDocuments(user, rows) {
  const indexPath = stagedDocumentIndexPath(user);
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(rows, null, 2));
}

async function stageProjectDocuments(user, files = []) {
  const root = stagedDocumentRoot(user);
  await fs.promises.mkdir(root, { recursive: true });
  const existing = await readStagedDocuments(user);
  const staged = [];
  for (const file of files) {
    const purpose = documentPurposeFromName(file.originalname, file.mimetype);
    const storedName = `${purpose}-${Date.now()}-${safeFileBase(file.originalname)}${safeExtension(file.originalname)}`;
    const absolutePath = path.join(root, storedName);
    await fs.promises.copyFile(file.path, absolutePath);
    await fs.promises.rm(file.path, { force: true });
    const record = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      originalName: file.originalname,
      name: storedName,
      purpose,
      mimeType: file.mimetype,
      size: file.size,
      path: absolutePath,
      relativePath: path.relative(builderxProjectRoot(), absolutePath).split(path.sep).join("/"),
      uploadedAt: new Date().toISOString()
    };
    staged.push(record);
  }
  await writeStagedDocuments(user, [...existing, ...staged]);
  return staged;
}

async function attachStagedDocumentsToProject(user, project, selectedIds = []) {
  if (!project?.workspaceDir || !selectedIds.length) return [];
  const staged = await readStagedDocuments(user);
  const selected = staged.filter((row) => selectedIds.includes(row.id));
  if (!selected.length) return [];
  const docsDir = path.join(project.workspaceDir, "docs", "project-input");
  await fs.promises.mkdir(docsDir, { recursive: true });
  const attached = [];
  for (const doc of selected) {
    const targetPath = path.join(docsDir, doc.name);
    await fs.promises.copyFile(doc.path, targetPath);
    attached.push({
      ...doc,
      projectPath: `docs/project-input/${doc.name}`
    });
  }
  await writeStagedDocuments(user, staged.filter((row) => !selectedIds.includes(row.id)));
  return attached;
}

async function readStagedMedia(user) {
  const indexPath = stagedMediaIndexPath(user);
  if (!fs.existsSync(indexPath)) return [];
  const rows = await fs.promises.readFile(indexPath, "utf8").then((value) => JSON.parse(value)).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function writeStagedMedia(user, rows) {
  const indexPath = stagedMediaIndexPath(user);
  await fs.promises.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.promises.writeFile(indexPath, JSON.stringify(rows, null, 2));
}

async function stageProjectMedia(user, files = []) {
  const root = stagedMediaRoot(user);
  await fs.promises.mkdir(root, { recursive: true });
  const existing = await readStagedMedia(user);
  const staged = [];
  for (const file of files) {
    const storedName = `reference-${Date.now()}-${safeFileBase(file.originalname)}${safeExtension(file.originalname)}`;
    const absolutePath = path.join(root, storedName);
    await fs.promises.copyFile(file.path, absolutePath);
    await fs.promises.rm(file.path, { force: true });
    staged.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      originalName: file.originalname,
      name: storedName,
      mimeType: file.mimetype,
      size: file.size,
      path: absolutePath,
      relativePath: path.relative(builderxProjectRoot(), absolutePath).split(path.sep).join("/"),
      purpose: "creation-reference",
      uploadedAt: new Date().toISOString()
    });
  }
  await writeStagedMedia(user, [...existing, ...staged]);
  return staged;
}

async function attachStagedMediaToProject(user, project, selectedIds = []) {
  if (!project?.id || !selectedIds.length) return { media: [], project };
  const staged = await readStagedMedia(user);
  const selected = staged.filter((row) => selectedIds.includes(row.id));
  if (!selected.length) return { media: [], project };
  const media = await saveProjectMedia(project, selected.map((row) => ({
    path: row.path,
    originalname: row.originalName,
    mimetype: row.mimeType,
    size: row.size
  })), { purpose: "creation-reference" });
  await writeStagedMedia(user, staged.filter((row) => !selectedIds.includes(row.id)));
  const refreshedProject = await getProject(project.id, { user });
  return { media, project: refreshedProject || project };
}

function graphNodeId(value) {
  return typeof value === "object" && value ? value.id : value;
}

function normalizeGraphKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

function rounded(value, digits = 4) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Number(number.toFixed(digits)) : 0;
}

function projectNodeLookup(nodes = []) {
  const lookup = new Map();
  for (const node of nodes) {
    if (node?.type !== "project") continue;
    [
      node.id,
      node.label,
      node.metadata?.projectName,
      node.metadata?.name,
      node.metadata?.folderName,
      node.metadata?.projectId
    ]
      .filter(Boolean)
      .forEach((value) => lookup.set(normalizeGraphKey(value), node));
  }
  return lookup;
}

function projectCorrelationForAgent(agent, projectsByKey) {
  const candidates = [
    agent.project,
    agent.vector?.attributes?.project_name,
    agent.vector?.attributes?.project_id,
    agent.vector?.attributes?.source_path ? String(agent.vector.attributes.source_path).split("/")[0] : ""
  ].filter(Boolean);
  for (const candidate of candidates) {
    const match = projectsByKey.get(normalizeGraphKey(candidate));
    if (match) return { node: match, value: candidate };
  }
  return null;
}

function agentAnalysisMetadata(agent, correlation) {
  const tokenEconomy = agent.tokenEconomy || {};
  return {
    modelNodalAnalysis: true,
    correlation: correlation ? "matched_project_node" : "standalone_no_project_correlation",
    correlatedProject: correlation?.node?.label || "",
    project: agent.project || "",
    role: agent.role || "",
    domain: agent.domain || "",
    objective: agent.objective || "",
    instructionSummary: agent.instructionSummary || "",
    capabilities: agent.capabilities || [],
    vectorStatus: agent.vector?.status || "unknown",
    vectorSource: agent.vector?.source || "",
    vectorFileId: agent.vector?.file_id || "",
    totalRuns: Number(tokenEconomy.totalRuns || 0),
    inputTokens: Number(tokenEconomy.inputTokens || 0),
    outputTokens: Number(tokenEconomy.outputTokens || 0),
    totalTokens: Number(tokenEconomy.totalTokens || 0),
    averageInputTokens: rounded(tokenEconomy.averageInputTokens, 2),
    averageOutputTokens: rounded(tokenEconomy.averageOutputTokens, 2),
    inputTokenCostUsd: rounded(tokenEconomy.inputEstimatedUsd, 6),
    outputTokenCostUsd: rounded(tokenEconomy.outputEstimatedUsd, 6),
    totalCostUsd: rounded(tokenEconomy.estimatedUsd, 6),
    averageCostUsd: rounded(tokenEconomy.averageUsd, 6),
    accuracyValue: rounded(tokenEconomy.averageAccuracyValue || agent.efficiency?.accuracy, 2),
    efficiencyScore: rounded(tokenEconomy.averageEfficiencyScore || agent.efficiency?.economy, 2),
    abilityScore: rounded(tokenEconomy.averageAbilityScore || agent.efficiency?.capability, 2),
    tokensPerAccuracyPoint: rounded(tokenEconomy.tokensPerAccuracyPoint, 2),
    usdPerAccuracyPoint: rounded(tokenEconomy.usdPerAccuracyPoint, 6),
    lastRunAt: tokenEconomy.lastRunAt || agent.updatedAt || "",
    sourcePath: agent.sourcePath || "",
    description: agent.objective || agent.instructionSummary || `${agent.name} agent model analysis.`
  };
}

function agentAnalysisNode(agent, correlation) {
  const vectorCompleted = agent.vector?.status === "completed";
  const humanReview = Boolean(agent.requiresHumanReview);
  return {
    id: `agent:${agent.id}`,
    type: "agent",
    label: agent.name || agent.id,
    group: correlation ? "global-agent-analysis" : "standalone-agent-analysis",
    risk_level: humanReview ? "high" : vectorCompleted ? "low" : "medium",
    status: agent.status || agent.vector?.status || "active",
    agent_id: agent.id,
    cluster_id: agent.role || agent.domain || "global-agent",
    metadata: agentAnalysisMetadata(agent, correlation)
  };
}

function mergeAgenticSystemGraph(baseGraph, globalAgentsResult) {
  const nodesById = new Map((baseGraph.nodes || []).filter((node) => node?.id).map((node) => [node.id, node]));
  const linksByKey = new Map(
    (baseGraph.links || []).map((link) => [
      `${graphNodeId(link.source)}->${graphNodeId(link.target)}:${link.type || "related"}`,
      link
    ])
  );
  const projectsByKey = projectNodeLookup(baseGraph.nodes || []);
  let correlatedCount = 0;
  let standaloneCount = 0;

  for (const agent of globalAgentsResult.agents || []) {
    if (!agent?.id) continue;
    const correlation = projectCorrelationForAgent(agent, projectsByKey);
    const node = agentAnalysisNode(agent, correlation);
    const existing = nodesById.get(node.id);
    nodesById.set(node.id, existing ? { ...existing, ...node, metadata: { ...(existing.metadata || {}), ...node.metadata } } : node);
    if (correlation) {
      correlatedCount += 1;
      const key = `${correlation.node.id}->${node.id}:has_agent_model_analysis`;
      if (!linksByKey.has(key)) {
        linksByKey.set(key, {
          source: correlation.node.id,
          target: node.id,
          type: "has_agent_model_analysis",
          weight: 1.5,
          metadata: {
            modelNodalAnalysis: true,
            correlation: "matched_project_node",
            project: correlation.node.label
          }
        });
      }
    } else {
      standaloneCount += 1;
    }
  }

  return {
    ...baseGraph,
    metadata: {
      ...(baseGraph.metadata || {}),
      agent_model_nodal_analysis: true,
      agent_model_nodal_analysis_count: (globalAgentsResult.agents || []).length,
      correlated_agent_analysis_count: correlatedCount,
      standalone_agent_analysis_count: standaloneCount,
      global_agent_source: globalAgentsResult.source || null
    },
    nodes: [...nodesById.values()],
    links: [...linksByKey.values()]
  };
}

function adaptiveFlowEvidence({ projectName, orchestrated, result, error = "" }) {
  const route = result?.adaptiveRoute || null;
  const selectedMode = route?.mode || (error ? "failed" : "pending");
  const projectAgentId = `${String(projectName || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-orchestrator-agent`;
  const activeAgents = [
    {
      id: "builderx-fullstack-agent",
      name: "BuilderX Fullstack Agent",
      role: "Canonical authority",
      status: error ? "failed" : "completed",
      action: "Classified the task, selected the route, enforced constraints, and controlled completion."
    }
  ];
  if (["delegated", "delegated_reviewed"].includes(selectedMode)) {
    activeAgents.push({
      id: projectAgentId,
      name: `${projectName || "Project"} Orchestrator Agent`,
      role: "Bounded project executor",
      status: error ? "failed" : "completed",
      action: "Executed the project-scoped change without receiving completion authority."
    });
  }
  if (selectedMode === "delegated_reviewed") {
    activeAgents.push({
      id: "builderx-independent-reviewer",
      name: "BuilderX Independent Reviewer",
      role: "Read-only validator",
      status: result?.review?.status || (error ? "failed" : "pending"),
      action: "Inspected workspace evidence and returned an independent pass/fail verdict."
    });
  }

  const actions = (result?.fileOperations || []).map((operation, index) => ({
    id: `file-action-${index + 1}`,
    type: operation.action || "modify",
    label: `${String(operation.action || "modify").toUpperCase()} ${operation.path}`,
    target: operation.path,
    reason: operation.reason || "Required by the selected adaptive execution path.",
    status: "completed"
  }));
  const structuredRequest = orchestrated?.structuredRequest || {};
  const requestedFunctionality = structuredRequest.rawTextBoxInstruction || structuredRequest.sourceInstruction || structuredRequest.objective || "";
  const functionalityNames = [
    requestedFunctionality,
    ...(structuredRequest.sections || []).filter((section) => section && section !== "direct-task").map((section) => `Section: ${String(section).replaceAll("_", " ")}`),
    ...(structuredRequest.routePlan || []).map((route) => `Route: ${route.title || route.key || route.path}`)
  ].filter(Boolean);
  const functionalities = [...new Set(functionalityNames)].map((label, index) => ({
    id: `functionality-${index + 1}`,
    label,
    type: "functionality",
    state: error ? "failed" : result?.buildId ? "completed" : "selected",
    detail: index === 0 ? "Requested project functionality selected for implementation." : "Included by the BuilderX feature and route plan."
  }));
  const routeChoices = ["single", "delegated", "delegated_reviewed"].map((mode) => ({
    id: mode,
    label: mode.replaceAll("_", " "),
    state: mode === selectedMode ? "selected" : "rejected",
    reason: mode === selectedMode
      ? (route?.reasons || []).join(" ") || "Selected by the adaptive routing score."
      : mode === "single"
        ? "Rejected because task complexity or managed-project ownership justified delegation."
        : mode === "delegated"
          ? "Rejected when either delegation was unnecessary or independent review was required."
          : "Rejected because risk, complexity, or the model-call budget did not require an independent reviewer."
  }));
  const decisionTree = {
    id: result?.parentWorkflowId || "builderx-pending",
    label: `${projectName || "BuilderX"} adaptive workflow`,
    type: "workflow",
    state: error ? "failed" : "completed",
    children: [
      {
        id: "adaptive-routing",
        label: `Adaptive route: ${selectedMode}`,
        type: "decision",
        state: error ? "failed" : "selected",
        detail: route ? `Score ${route.routeScore}; risk ${route.riskLevel}; ${route.plannedModelCalls}/${route.modelCallBudget} model calls.` : error || "Route pending.",
        children: routeChoices
      },
      {
        id: "working-agents",
        label: "Working agents",
        type: "agents",
        state: error ? "failed" : "completed",
        children: activeAgents.map((agent) => ({ ...agent, label: agent.name, type: "agent", state: agent.status }))
      },
      {
        id: "selected-functionalities",
        label: "Selected features and functionalities",
        type: "functionalities",
        state: functionalities.length ? (error ? "failed" : "completed") : "pending",
        children: functionalities
      },
      {
        id: "implementation-actions",
        label: "Implementation actions",
        type: "actions",
        state: actions.length ? "completed" : error ? "failed" : "pending",
        children: actions.map((action) => ({ ...action, type: "action", state: action.status, detail: action.reason }))
      },
      {
        id: "rejected-choices",
        label: "Rejected or not selected",
        type: "rejections",
        state: "completed",
        children: routeChoices.filter((choice) => choice.state === "rejected").map((choice) => ({ ...choice, type: "rejection" }))
      },
      {
        id: "completion-gate",
        label: "BuilderX completion gate",
        type: "validation",
        state: error ? "failed" : result?.buildId ? "completed" : "pending",
        detail: error || (result?.review ? "Independent review passed; BuilderX approved completion." : "Execution evidence passed; BuilderX approved completion.")
      }
    ]
  };
  return { route, selectedMode, activeAgents, actions, functionalities, routeChoices, decisionTree };
}

function projectCreationFlowPath({ projectName, taskType, orchestrated, result, status = "succeeded", error = "" }) {
  const adaptive = adaptiveFlowEvidence({ projectName, orchestrated, result, error });
  const selectedPath = error ? "human-choice-review" : "builderx-global-orchestration";
  const deterministicScore = error
    ? {
        objectiveFit: 10,
        requiredFeatureCoverage: 8,
        relevantFeatureExpansion: 5,
        technicalFeasibility: 4,
        reuseOfExistingAgentsAndPatterns: 7,
        validationAndDeploymentReadiness: 3,
        tokenTimeCostEfficiency: 5
      }
    : {
        objectiveFit: 23,
        requiredFeatureCoverage: 18,
        relevantFeatureExpansion: 13,
        technicalFeasibility: 14,
        reuseOfExistingAgentsAndPatterns: 9,
        validationAndDeploymentReadiness: 8,
        tokenTimeCostEfficiency: 4
      };
  const confidence = Object.values(deterministicScore).reduce((sum, value) => sum + value, 0);
  const hardConstraints = [
    "preserve_user_instruction_objective",
    "generate_project_local_agents",
    "preserve_standalone_docker_portability",
    "avoid_secret_storage",
    "maintain_graph_vector_memory_and_local_agent_controls",
    "validate_or_report_unavailable_validation"
  ];
  const relevantFeatureExpansion = [
    "responsive_app_shell",
    "empty_loading_error_states",
    "standalone_docker_packaging",
    "project_local_orchestrator",
    "agentic_system_graph_metadata",
    "what_next_path_knowledge"
  ];
  return {
    status,
    selectedPath,
    confidence,
    deterministic: true,
    scoringRubric: deterministicScore,
    hardConstraints,
    relevantFeatureExpansion,
    subObjectives: [
      {
        id: "requirements",
        label: "Requirements",
        state: "completed",
        detail: orchestrated?.structuredRequest?.sections?.length
          ? `${orchestrated.structuredRequest.sections.length} requested sections mapped`
          : "Instruction prompt captured"
      },
      {
        id: "feature-coverage",
        label: "Feature coverage",
        state: error ? "blocked" : "selected",
        detail: "Direct and indirect app capabilities expanded"
      },
      {
        id: "architecture",
        label: "Architecture",
        state: error ? "blocked" : "completed",
        detail: "UI, data, agents, memory, and Docker constraints"
      },
      {
        id: "generation",
        label: "Generation",
        state: result?.buildId ? "completed" : error ? "blocked" : "pending",
        detail: result?.buildId ? `Gotham build ${result.buildId}` : "Awaiting Gotham file work"
      },
      {
        id: "validation",
        label: "Validation",
        state: result?.buildId && !error ? "selected" : "pending",
        detail: "Preview handoff and next development review"
      }
    ],
    projectName,
    taskType,
    summary: error
      ? "Generation failed or path confidence was insufficient. Human Agent review is the next decision point."
      : "BuilderX retained global authority, delegated bounded project execution, and approved the generated result.",
    activeAgents: adaptive.activeAgents,
    functionalities: adaptive.functionalities,
    featureActions: adaptive.actions,
    adaptiveRoute: adaptive.route,
    decisionTree: adaptive.decisionTree,
    executedDecisions: [
      {
        id: "adaptive-route",
        label: "Adaptive execution route",
        value: adaptive.selectedMode,
        reason: adaptive.route?.reasons?.join(" ") || error || "Adaptive route evidence is pending."
      },
      {
        id: "selected-path",
        label: "Selected path",
        value: selectedPath,
        reason: error
          ? "Generation failed, so Human Agent review became the active recovery path."
          : "Highest deterministic score while preserving project-local agents, memory, Docker readiness, and Gotham handoff."
      },
      {
        id: "agent-topology",
        label: "Agent topology",
        value: error ? "deferred" : "BuilderX global authority with project-scoped executors",
        reason: error
          ? "Agent execution is deferred until recovery choice is selected."
          : "The project requires local orchestration, graph/vector memory controls, QAgent support, and validation handoff."
      },
      {
        id: "generation-route",
        label: "Generation route",
        value: result?.buildId ? `Gotham build ${result.buildId}` : error ? "blocked" : "pending",
        reason: result?.files?.length
          ? `${result.files.length} file changes were produced for this project.`
          : error || "Waiting for file generation evidence."
      }
    ],
    humanInLoop: {
      required: Boolean(error),
      reason: error ? "A human choice is needed before retrying or changing the development path." : "",
      choices: error
        ? [
            { id: "retry-same-path", label: "Retry same path", impact: "Use the same project-local orchestrator path again." },
            { id: "simplify-scope", label: "Simplify scope", impact: "Reduce project requirements before retrying." },
            { id: "change-architecture", label: "Change architecture", impact: "Choose a different technical direction before generation." }
          ]
        : []
    },
    nodes: [
      {
        id: "intake",
        label: "Instruction intake",
        state: "completed",
        detail: `Task type ${taskType || "Medium"}`
      },
      {
        id: "path-selection",
        label: "What-next path selection",
        state: "completed",
        detail: `Deterministic constraint score ${confidence}/100 selected the strongest path.`
      },
      {
        id: "builderx-global-orchestration",
        label: "BuilderX global orchestration",
        state: selectedPath === "builderx-global-orchestration" ? "selected" : "disabled",
        detail: "Own the parent task, delegate bounded execution, validate evidence, and approve completion."
      },
      {
        id: "project-local-orchestrator",
        label: "Project-local orchestrator",
        state: selectedPath === "builderx-global-orchestration" ? "delegated" : "disabled",
        detail: "Provide project-scoped context and execute the bounded BuilderX delegation."
      },
      {
        id: "template-only",
        label: "Template-only generation",
        state: selectedPath === "template-only" ? "selected" : "disabled",
        detail: "Faster path, skipped because project memory and agents are required."
      },
      {
        id: "human-choice-review",
        label: "Human Agent choice",
        state: selectedPath === "human-choice-review" ? "selected" : "disabled",
        detail: error ? "Review retry, scope change, or alternate architecture." : "Available when path confidence is low."
      },
      {
        id: "gotham-generation",
        label: "Gotham generation",
        state: result?.buildId ? "completed" : error ? "blocked" : "pending",
        detail: result?.buildId ? `Build ${result.buildId}` : "Waiting for generation evidence."
      },
      {
        id: "runtime-handoff",
        label: "Runtime handoff",
        state: result?.buildId && !error ? "completed" : "pending",
        detail: "Assign preview port and preserve standalone Docker path."
      }
    ],
    rejectedPaths: [
      ...adaptive.routeChoices.filter((choice) => choice.state === "rejected").map((choice) => ({
        id: choice.id,
        reason: choice.reason,
        constraint: adaptive.route ? `risk=${adaptive.route.riskLevel}; calls=${adaptive.route.plannedModelCalls}/${adaptive.route.modelCallBudget}` : "route unavailable"
      })),
      {
        id: "template-only",
        reason: "Lower required feature coverage and does not capture enough project-local agent, memory, Docker, and graph context."
      },
      {
        id: "human-choice-review",
        reason: error ? "Selected because generation failed." : "Not selected because confidence was sufficient."
      }
    ],
    evidence: [
      orchestrated?.structuredRequest?.pageType ? `Page type: ${orchestrated.structuredRequest.pageType}` : "",
      orchestrated?.structuredRequest?.sections?.length ? `Sections: ${orchestrated.structuredRequest.sections.join(", ")}` : "",
      result?.files?.length ? `${result.files.length} generated file changes` : ""
    ].filter(Boolean),
    nextRecommendation: error
      ? "Ask the Human Agent to choose retry, simplify scope, or change architecture."
      : "Review the generated preview, then continue with targeted project-local tasks."
  };
}

function gothamInstructionFlowPath({ projectName, taskType, orchestrated, result, status = "succeeded", error = "", useProjectOrchestrator = false }) {
  const flowPath = projectCreationFlowPath({ projectName, taskType, orchestrated, result, status, error });
  const selectedPath = error ? "human-choice-review" : "builderx-global-orchestration";
  const changedCount = result?.files?.length || 0;
  return {
    ...flowPath,
    selectedPath,
    summary: error
      ? "Gotham chat instruction failed. Human Agent review is the next decision point."
      : "Gotham chat instruction executed through the selected deterministic workflow path.",
    nodes: flowPath.nodes.map((node) => {
      if (node.id === "intake") {
        return { ...node, detail: `Gotham chat instruction captured as ${taskType || "Medium"} task.` };
      }
      if (node.id === "path-selection") {
        return { ...node, detail: `Deterministic path selection executed for ${projectName || "BuilderX workspace"}.` };
      }
      if (node.id === "project-local-orchestrator") {
        return {
          ...node,
          state: useProjectOrchestrator ? "delegated" : "disabled",
          detail: useProjectOrchestrator
            ? "BuilderX delegated bounded execution while retaining parent authority."
            : "No project delegation is needed for the BuilderX default workspace."
        };
      }
      if (node.id === "template-only") {
        return {
          ...node,
          state: selectedPath === "template-only" ? "selected" : "disabled",
          detail: useProjectOrchestrator
            ? "Rejected because project-local orchestration is required for this project."
            : "Selected for the BuilderX default generated-site workflow."
        };
      }
      return node;
    }),
    executedDecisions: [
      ...(flowPath.executedDecisions || []).filter((decision) => !["selected-path", "generation-route"].includes(decision.id)),
      {
        id: "selected-path",
        label: "Selected path",
        value: selectedPath,
        reason: error
          ? "Generation failed, so Human Agent review became the active recovery path."
          : useProjectOrchestrator
            ? "BuilderX retained task authority and selected bounded project execution."
            : "No project-local scope was selected, so BuilderX used its default generated-site workflow."
      },
      {
        id: "generation-route",
        label: "Generation route",
        value: result?.buildId ? `Gotham build ${result.buildId}` : error ? "blocked" : "pending",
        reason: changedCount ? `${changedCount} file changes were produced by this chat instruction.` : error || "Waiting for Gotham file generation evidence."
      }
    ],
    rejectedPaths: [
      ...(flowPath.rejectedPaths || []).filter((pathOption) => !["template-only", "project-local-orchestrator", "human-choice-review"].includes(pathOption.id)),
      {
        id: useProjectOrchestrator ? "template-only" : "project-local-orchestrator",
        reason: useProjectOrchestrator
          ? "Rejected because the active project requires project-local agents, memory, and runtime handoff."
          : "Rejected because no non-default project was selected for this Gotham chat instruction."
      },
      {
        id: "human-choice-review",
        reason: error ? "Selected because generation failed." : "Not selected because path confidence was sufficient."
      }
    ],
    nextRecommendation: error
      ? "Ask the Human Agent to choose retry, simplify scope, or change architecture."
      : "Review the updated preview, then continue with the next project-specific Gotham chat instruction."
  };
}

function builderxProjectRoot() {
  if (process.env.BUILDERX_PROJECT_ROOT) return process.env.BUILDERX_PROJECT_ROOT;
  if (fs.existsSync(path.join(process.cwd(), "apps", "backend"))) return process.cwd();
  return path.resolve(process.cwd(), "../..");
}

function persistWhatNextKnowledge(flowPath, extra = {}) {
  const projectKey = safeFileBase(extra.projectId || flowPath?.projectName || "builderx-default");
  const knowledgePath = path.join(builderxProjectRoot(), "memory", "project-intelligence", "projects", projectKey, "what-next-knowledge.jsonl");
  fs.mkdirSync(path.dirname(knowledgePath), { recursive: true });
  fs.appendFileSync(
    knowledgePath,
    `${JSON.stringify({
      recordedAt: new Date().toISOString(),
      source: "agentic-builderx-project-creation",
      ...extra,
      flowPath
    })}\n`
  );
}

function projectHistoryRoot(projectId = "") {
  return path.join(builderxProjectRoot(), "memory", "project-intelligence", "projects", safeFileBase(projectId || "builderx-default"));
}

function projectInstructionLedgerPath(projectId = "") {
  return path.join(projectHistoryRoot(projectId), "project-instructions.jsonl");
}

function projectHistoryFiles(fileName, projectId = "") {
  const legacyPath = path.join(builderxProjectRoot(), "memory", "project-intelligence", fileName);
  if (projectId) return [path.join(projectHistoryRoot(projectId), fileName), legacyPath];
  const projectsRoot = path.join(builderxProjectRoot(), "memory", "project-intelligence", "projects");
  const scopedPaths = fs.existsSync(projectsRoot)
    ? fs.readdirSync(projectsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(projectsRoot, entry.name, fileName))
    : [];
  return [legacyPath, ...scopedPaths];
}

function safeJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function persistProjectInstruction(record = {}) {
  const ledgerPath = projectInstructionLedgerPath(record.projectId || "builderx-default");
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(
    ledgerPath,
    `${JSON.stringify({
      recordedAt: new Date().toISOString(),
      source: "agentic-builderx-instruction",
      projectId: record.projectId || "",
      projectName: record.projectName || "BuilderX default workspace",
      taskType: record.taskType || "Medium",
      instruction: record.instruction || "",
      status: record.status || "received",
      buildId: record.buildId || "",
      parentWorkflowId: record.parentWorkflowId || record.flowPath?.decisionTree?.id || "",
      childExecutionIds: record.childExecutionIds || [],
      adaptiveRoute: record.adaptiveRoute || record.flowPath?.adaptiveRoute || null,
      review: record.review || null,
      orchestrationSnapshot: record.orchestrationSnapshot || null,
      flowPath: record.flowPath || null,
      changedFiles: record.changedFiles || [],
      error: record.error || ""
    })}\n`
  );
}

function readProjectInstructionTimeline({ projectId = "" } = {}) {
  const normalizeInstructionBuild = (value = "") => String(value || "").replace(/^Gotham build\s+/i, "").trim();
  const ledgerRows = projectHistoryFiles("project-instructions.jsonl", projectId).flatMap(safeJsonLines).map((row) => ({
    recordedAt: row.recordedAt,
    source: row.source || "agentic-builderx-instruction",
    projectId: row.projectId || "",
    projectName: row.projectName || "BuilderX default workspace",
    taskType: row.taskType || "Medium",
    instruction: row.instruction || row.instructionSummary || "",
    status: row.status || "received",
    buildId: normalizeInstructionBuild(row.buildId),
    parentWorkflowId: row.parentWorkflowId || row.flowPath?.decisionTree?.id || "",
    childExecutionIds: row.childExecutionIds || [],
    adaptiveRoute: row.adaptiveRoute || row.flowPath?.adaptiveRoute || null,
    review: row.review || null,
    orchestrationSnapshot: row.orchestrationSnapshot || null,
    flowPath: row.flowPath || null,
    changedFiles: row.changedFiles || [],
    error: row.error || ""
  }));
  const knowledgeRows = projectHistoryFiles("what-next-knowledge.jsonl", projectId).flatMap(safeJsonLines).map((row) => ({
    recordedAt: row.recordedAt,
    source: row.source || "agentic-builderx-what-next",
    projectId: row.projectId || "",
    projectName: row.projectName || row.flowPath?.projectName || "BuilderX default workspace",
    taskType: row.flowPath?.taskType || "Medium",
    instruction: row.instructionSummary || "",
    status: row.flowPath?.status || (row.error ? "failed" : "succeeded"),
    buildId: normalizeInstructionBuild(row.flowPath?.executedDecisions?.find((decision) => decision.id === "generation-route")?.value || ""),
    parentWorkflowId: row.flowPath?.decisionTree?.id || "",
    childExecutionIds: [],
    adaptiveRoute: row.flowPath?.adaptiveRoute || null,
    review: null,
    orchestrationSnapshot: row.orchestrationSnapshot || null,
    flowPath: row.flowPath || null,
    changedFiles: row.changedFiles || [],
    error: row.error || ""
  }));
  const unmatchedKnowledgeRows = knowledgeRows.filter((knowledge) => !ledgerRows.some((ledger) =>
    ledger.projectId === knowledge.projectId &&
    ledger.instruction === knowledge.instruction &&
    ledger.status === knowledge.status &&
    Math.abs(new Date(ledger.recordedAt || 0).getTime() - new Date(knowledge.recordedAt || 0).getTime()) < 10_000
  ));
  const seen = new Set();
  return [...ledgerRows, ...unmatchedKnowledgeRows]
    .filter((row) => row.instruction)
    .filter((row) => !projectId || row.projectId === projectId)
    .filter((row) => {
      const key = row.parentWorkflowId
        ? `${row.projectId}|workflow:${row.parentWorkflowId}`
        : `${row.projectId}|${row.projectName}|${row.instruction}|${row.status}|${row.buildId}|${row.recordedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => new Date(b.recordedAt || 0).getTime() - new Date(a.recordedAt || 0).getTime());
}

app.get("/api/status", (_req, res) => {
  res.json({
    status: "ok",
    service: "agentic-builderx-backend",
    codexMcp: "external",
    codexMcpId: process.env.CODEX_MCP_ID || process.env.MCP_SERVER_ID || process.env.HOSTNAME || null,
    orchestratorAgent: "ready",
    generatedSiteDir: process.env.GENERATED_SITE_DIR || "/workspace/generated-site",
    generatedSiteContainer: process.env.GENERATED_SITE_CONTAINER || "agentic-builderx-generated-site",
    restartMode: String(process.env.RESTART_GENERATED_CONTAINER || "false").toLowerCase() === "true" ? "docker-socket" : "vite-hot-reload",
    authProviders: authConfigurationDiagnostics().map(({ provider, enabled, authMode, configured, connected, diagnostics }) => ({
      provider,
      enabled,
      authMode,
      configured,
      connected,
      diagnostics
    }))
  });
});

app.get("/api/auth/providers", (req, res) => {
  res.json({ status: "ok", providers: listProviderConfigs(userFromRequest(req)) });
});

app.get("/api/auth/:provider/status", (req, res) => {
  try {
    res.json({ status: "ok", provider: providerConfig(req.params.provider, userFromRequest(req)) });
  } catch {
    res.status(404).json({ status: "failed", error: "Unsupported provider." });
  }
});

app.post("/api/auth/:provider/disconnect", (_req, res) => {
  try {
    res.json({ status: "ok", message: "Provider disconnect is managed by the local CLI profile, not BuilderX.", provider: _req.params.provider });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message || "Provider disconnect failed." });
  }
});

app.get("/api/codex/profiles", (_req, res) => {
  try {
    const profiles = listCodexProfiles();
    res.json({
      status: "ok",
      selectionMode: process.env.CODEX_PROFILE_SELECTION_MODE || "manual",
      automaticFallback: process.env.CODEX_ALLOW_AUTOMATIC_PROFILE_FALLBACK === "true",
      profiles: profiles.map((profile) => ({ ...profile, loginCommand: loginCommandForProfile(profile) }))
    });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles", (req, res) => {
  try {
    const payload = CodexProfileSchema.extend({ id: z.string().min(1).max(64) }).parse(req.body || {});
    const result = createCodexProfile(payload);
    res.json({ status: "ok", ...result });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.patch("/api/codex/profiles/:profileId", (req, res) => {
  try {
    const payload = CodexProfileSchema.parse(req.body || {});
    const profiles = updateCodexProfile(req.params.profileId, payload);
    res.json({ status: "ok", profiles });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.delete("/api/codex/profiles/:profileId", (req, res) => {
  try {
    const result = deleteCodexProfile(req.params.profileId);
    res.json({ status: "ok", ...result });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles/:profileId/validate", async (req, res) => {
  try {
    const result = await validateCodexProfile(req.params.profileId);
    res.json({ status: result.status, result, profiles: listCodexProfiles() });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles/refresh-usage", async (_req, res) => {
  try {
    const profiles = await refreshAllCodexProfileUsage();
    res.json({ status: "ok", profiles });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles/:profileId/usage", async (req, res) => {
  try {
    const result = await refreshCodexProfileUsage(req.params.profileId);
    res.json({ status: "ok", ...result });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles/:profileId/login", async (req, res) => {
  try {
    const login = await openCodexProfileLogin(req.params.profileId);
    res.json({ status: "ok", login, profiles: listCodexProfiles() });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message, code: error.code || "", settingsUrl: error.settingsUrl || "", output: error.output || "" });
  }
});

app.get("/api/codex/profiles/:profileId/login-sessions/:loginSessionId", (req, res) => {
  try {
    const login = getCodexProfileLoginSession(req.params.profileId, req.params.loginSessionId);
    res.json({ status: "ok", login, profiles: login.profiles || listCodexProfiles() });
  } catch (error) {
    res.status(error.code === "CODEX_LOGIN_SESSION_NOT_FOUND" ? 404 : 400).json({ status: "failed", error: error.message, code: error.code || "" });
  }
});

app.post("/api/codex/profiles/:profileId/set-default", (req, res) => {
  try {
    const profiles = setDefaultCodexProfile(req.params.profileId);
    res.json({ status: "ok", profiles });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles/:profileId/enable", (req, res) => {
  enableCodexProfile(req.params.profileId).then((profiles) => {
    res.json({ status: "ok", profiles });
  }).catch((error) => {
    res.status(error.statusCode || 400).json({
      status: "failed",
      error: error.message,
      code: error.code,
      result: error.result,
      login: error.login
    });
  });
});

app.post("/api/codex/profiles/:profileId/disable", (req, res) => {
  try {
    const profiles = updateCodexProfile(req.params.profileId, { enabled: false });
    res.json({ status: "ok", profiles });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles/:profileId/mark-available", (req, res) => {
  try {
    const profiles = markCodexProfileAvailable(req.params.profileId);
    res.json({ status: "ok", profiles });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/codex/profiles/:profileId/mark-unavailable", (req, res) => {
  try {
    const profiles = markCodexProfileUnavailable(req.params.profileId, "manual_unavailable");
    res.json({ status: "ok", profiles });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.get("/api/runtime-log", (_req, res) => {
  let fileLogs = [];
  if (fs.existsSync(runtimeLogPath)) {
    fileLogs = fs
      .readFileSync(runtimeLogPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-MAX_RUNTIME_LOG_ROWS)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  }
  const logs = (fileLogs.length ? fileLogs : runtimeLog)
    .slice(0, MAX_RUNTIME_LOG_ROWS)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
  res.json({
    status: "ok",
    logs,
    source: fileLogs.length ? "file" : "memory"
  });
});

app.get("/api/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.write(
    `data: ${JSON.stringify({
      id: `connected-${Date.now()}`,
      type: "connected",
      message: "Event stream connected",
      createdAt: new Date().toISOString(),
      time: `${istTimeFormatter.format(new Date())} IST`
    })}\n\n`
  );
  clients.add(res);
  req.on("close", () => clients.delete(res));
});

app.post("/api/auth/google", (req, res) => {
  try {
    res.json({ status: "ok", user: authenticateGooglePayload(req.body || {}) });
  } catch (error) {
    res.status(401).json({ status: "failed", error: error.message });
  }
});

app.get("/api/config", (_req, res) => {
  res.json({
    status: "ok",
    googleClientId: process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || "",
    runtimeTarget: process.env.AGENTIC_RUNTIME_TARGET || process.env.AGENT_EXECUTION_TARGET || process.env.BUILDERX_RUNTIME_TARGET || "auto",
    aiProvider: process.env.AI_CLI_PROVIDER || "auto"
  });
});

app.get("/api/projects", async (req, res) => {
  res.json({
    status: "ok",
    user: userFromRequest(req),
    projects: await listProjects({ user: userFromRequest(req) })
  });
});

app.get("/api/project-instructions", (req, res) => {
  res.json({
    status: "ok",
    instructions: readProjectInstructionTimeline({ projectId: req.query.projectId || "" })
  });
});

app.get("/api/agentic-system/graph", async (_req, res) => {
  try {
    const baseGraph = await buildAgenticSystemGraph();
    const globalAgents = await listGlobalAgents();
    res.json(mergeAgenticSystemGraph(baseGraph, globalAgents));
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/agents/global", async (_req, res) => {
  try {
    res.json(await listGlobalAgents());
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.get("/api/agents/efficiency", async (_req, res) => {
  try {
    res.json(await readAgentEfficiencySummary());
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

registerHostingRoutes(app);

app.post("/api/project-documents/stage", upload.array("documents", 12), async (req, res) => {
  const user = userFromRequest(req);
  try {
    const documents = await stageProjectDocuments(user, req.files || []);
    event("project-documents-staged", `Staged ${documents.length} project document${documents.length === 1 ? "" : "s"}`, {
      userId: user.id,
      documents: documents.map((doc) => ({ id: doc.id, name: doc.name, purpose: doc.purpose }))
    });
    res.json({ status: "succeeded", documents });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/project-media/stage", upload.array("media", 12), async (req, res) => {
  const user = userFromRequest(req);
  try {
    const media = await stageProjectMedia(user, req.files || []);
    event("project-media-staged", `Staged ${media.length} creation media reference${media.length === 1 ? "" : "s"}`, {
      userId: user.id,
      media: media.map((item) => ({ id: item.id, name: item.originalName, purpose: item.purpose }))
    });
    res.json({ status: "succeeded", media });
  } catch (error) {
    res.status(400).json({ status: "failed", error: error.message });
  }
});

app.post("/api/agents/vector-sync", async (req, res) => {
  return res.status(403).json({
    status: "restricted",
    error: "Direct user-triggered vector memory sync/export is restricted."
  });
  /*
  try {
    const summary = await syncKnownAgentKnowledgeRoots({ reason: req.body?.reason || "manual", emit: event });
    res.json(summary);
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
  */
});

app.post("/api/projects/new", async (req, res) => {
  const user = userFromRequest(req);
  const parsed = NewProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Project name must be 2-80 characters and optional instruction must be at least 12 characters."
    });
  }

  const projectInstruction =
    parsed.data.instruction ||
    `Create a polished starter web app for ${parsed.data.name}. Include a market-ready hero, product sections, conversion CTA, and responsive layout.`;
  if (rejectRestrictedIntent(res, `${parsed.data.name}\n${projectInstruction}`)) return;
  const projectTaskType = parsed.data.taskType || "Medium";
  const projectOrchestratorPrompt = formatProjectOrchestratorInstruction(projectInstruction, projectTaskType);
  event("project-create-start", `Creating project ${parsed.data.name}`, {
    projectName: parsed.data.name,
    container: process.env.GENERATED_SITE_CONTAINER || "agentic-builderx-generated-site"
  });

  let project = null;
  let orchestrationEnvelope = null;
  try {
    project = await createProject(parsed.data.name, null, { emit: event, user });
    const projectDocuments = await attachStagedDocumentsToProject(user, project, parsed.data.stagedDocumentIds || []);
    const stagedMediaResult = await attachStagedMediaToProject(user, project, parsed.data.stagedMediaIds || []);
    project = stagedMediaResult.project;
    const creationMedia = stagedMediaResult.media || [];
    const bootstrap = await runProjectOrchestratorBootstrap(project, { emit: event, setupMode: "new" });
    event("project-instruction-start", `Reading the UI instruction through ${project.name}'s bootstrapped orchestrator`, {
      projectId: project.id,
      promptPath: bootstrap.promptPath,
      taskType: projectTaskType
    });
    const orchestrated = orchestrateBuilderInstruction(projectInstruction);
    const media = [
      ...(project.media || []).filter((item) => parsed.data.mediaIds?.includes(item.id)),
      ...creationMedia
    ].filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index);
    orchestrated.structuredRequest.media = media;
    orchestrated.structuredRequest.projectDocuments = projectDocuments;
    const projectAgents = await syncProjectAgentTopology(project, orchestrated.structuredRequest);
    event("project-agents-created", `Created ${projectAgents.agents.length} project-scoped agents for ${project.name}`, {
      projectName: project.name,
      projectId: project.id,
      agents: projectAgents.agents.map((agent) => agent.id)
    });
    orchestrated.structuredRequest.sourceInstruction = media.length
      ? `${orchestrated.structuredRequest.sourceInstruction}\n\nUploaded media available to use:\n${media
          .map((item) => `- ${item.name}: ${item.path}`)
          .join("\n")}`
      : orchestrated.structuredRequest.sourceInstruction;
    if (projectDocuments.length) {
      orchestrated.structuredRequest.sourceInstruction = [
        orchestrated.structuredRequest.sourceInstruction,
        "Project documentation files staged for this app. Treat these as durable requirements/context sources and infer direct and indirect functionality from them:",
        ...projectDocuments.map((doc) => `- ${doc.originalName} stored as ${doc.projectPath} (${doc.purpose})`)
      ].join("\n");
    }
    orchestrationEnvelope = await createBuilderXOrchestrationEnvelope({
      instruction: projectInstruction,
      taskType: projectTaskType,
      project,
      structuredRequest: orchestrated.structuredRequest
    });
    const adaptiveRoute = selectAdaptiveRoute({
      instruction: projectInstruction,
      taskType: projectTaskType,
      project
    });
    if (adaptiveRoute.mode === "single") {
      orchestrationEnvelope.delegations = [];
      orchestrationEnvelope.childExecutionIds = [];
    }
    orchestrationEnvelope.adaptiveRoute = adaptiveRoute;
    orchestrated.structuredRequest.orchestrationEnvelope = orchestrationEnvelope;
    event("builderx-start", `BuilderX accepted global authority for ${project.name}`, {
      stage: "2/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      projectId: project.id
    });
    event("adaptive-route-selected", `BuilderX selected ${adaptiveRoute.mode}`, {
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      projectId: project.id,
      projectName: project.name,
      adaptiveRoute
    });
    event("orchestrator-prompt", projectOrchestratorPrompt, {
      stage: "2/8",
      projectId: project.id,
      projectName: project.name,
      taskType: projectTaskType,
      promptTarget: "builderx-fullstack-agent",
      instructionFormat: "Task Type / Task",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId
    });
    for (const delegation of orchestrationEnvelope.delegations) {
      event("delegation-start", `BuilderX delegated bounded project execution to ${delegation.agentId}`, {
        stage: "3/8",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionId: delegation.executionId,
        agentId: delegation.agentId,
        projectId: project.id
      });
    }
    const result = await runBuilderXOwnedWorkflow(orchestrated.structuredRequest, {
      emit: event,
      generatedSiteDir: project.workspaceDir,
      agentId: "builderx-fullstack-agent",
      agentName: "BuilderX Fullstack Agent",
      projectId: project.id,
      projectName: project.name,
      taskType: projectTaskType
    }, orchestrationEnvelope, adaptiveRoute);
    for (const delegation of orchestrationEnvelope.delegations) {
      event("delegation-complete", `${delegation.agentId} completed its bounded execution`, {
        stage: "6/8",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionId: delegation.executionId,
        agentId: delegation.agentId,
        changedFiles: result.files
      });
    }
    event("builderx-validation", "BuilderX accepted generated-file validation evidence", {
      stage: "7/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      status: "passed",
      changedFiles: result.files
    });
    event("project-runtime-handoff", "Gotham file generation complete; BuilderX is assigning the playground port", {
      projectId: project.id,
      workspaceDir: project.workspaceDir
    });
    const readyProject = await ensureProjectPreviewWithPortRetry(project, { emit: event });
    project = readyProject;
    event("project-created", `Project ${parsed.data.name} generated on port ${project.port}`, {
      projectName: parsed.data.name,
      projectId: project.id,
      port: project.port,
      buildId: result.buildId,
    });
    scheduleAgentMemorySync({ reason: "project-created", emit: event });
    const flowPath = projectCreationFlowPath({ projectName: parsed.data.name, taskType: projectTaskType, orchestrated, result });
    persistWhatNextKnowledge(flowPath, {
      projectId: readyProject.id,
      projectName: parsed.data.name,
      instructionSummary: projectInstruction,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    persistProjectInstruction({
      projectId: readyProject.id,
      projectName: parsed.data.name,
      taskType: projectTaskType,
      instruction: projectInstruction,
      status: "succeeded",
      buildId: result.buildId,
      parentWorkflowId: result.parentWorkflowId,
      childExecutionIds: result.childExecutionIds,
      adaptiveRoute: result.adaptiveRoute,
      review: result.review,
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: readyProject.id,
        projectName: parsed.data.name,
        instruction: projectInstruction,
        taskType: projectTaskType,
        status: "succeeded",
        buildId: result.buildId,
        parentWorkflowId: result.parentWorkflowId,
        childExecutionIds: result.childExecutionIds,
        flowPath,
        changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
      }),
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    event("builderx-complete", `BuilderX approved completion for ${project.name}`, {
      stage: "8/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      buildId: result.buildId
    });
    return res.json({
      status: "succeeded",
      project: readyProject,
      projectName: parsed.data.name,
      container: `agentic-builderx-project-${project.id}`,
      previewUrl: readyProject.previewUrl,
      buildId: result.buildId,
      parentWorkflowId: result.parentWorkflowId,
      childExecutionIds: result.childExecutionIds,
      adaptiveRoute: result.adaptiveRoute,
      review: result.review,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || [],
      bootstrap,
      flowPath,
      restart: { status: "project-server", reason: `Project Vite server assigned to port ${project.port}` }
    });
  } catch (error) {
    if (orchestrationEnvelope) {
      event("builderx-validation", "BuilderX rejected completion because execution or validation failed", {
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionIds: orchestrationEnvelope.childExecutionIds,
        status: "failed",
        error: error.message
      });
    }
    if (project?.id) {
      event("project-create-preserved", `Preserved incomplete project ${project.name} after generation failure`, {
        projectId: project.id,
        workspaceDir: project.workspaceDir,
        port: project.port
      });
    }
    event("project-create-failed", error.message, { projectName: parsed.data.name });
    const flowPath = projectCreationFlowPath({ projectName: parsed.data.name, taskType: projectTaskType, status: "failed", error: error.message });
    persistWhatNextKnowledge(flowPath, {
      projectId: project?.id || "",
      projectName: parsed.data.name,
      instructionSummary: projectInstruction,
      error: error.message
    });
    persistProjectInstruction({
      projectId: project?.id || "",
      projectName: parsed.data.name,
      taskType: projectTaskType,
      instruction: projectInstruction,
      status: "failed",
      parentWorkflowId: orchestrationEnvelope?.parentWorkflowId || "",
      childExecutionIds: orchestrationEnvelope?.childExecutionIds || [],
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: project?.id || "",
        projectName: parsed.data.name,
        instruction: projectInstruction,
        taskType: projectTaskType,
        status: "failed",
        parentWorkflowId: orchestrationEnvelope?.parentWorkflowId || "",
        childExecutionIds: orchestrationEnvelope?.childExecutionIds || [],
        flowPath,
        error: error.message
      }),
      error: error.message
    });
    return res.status(500).json({
      status: "failed",
      projectName: parsed.data.name,
      project,
      previewUrl: project?.previewUrl || previewUrl,
      error: error.message,
      parentWorkflowId: orchestrationEnvelope?.parentWorkflowId || null,
      childExecutionIds: orchestrationEnvelope?.childExecutionIds || [],
      flowPath
    });
  }
});

app.post("/api/projects/import", upload.single("project"), async (req, res) => {
  const user = userFromRequest(req);
  const parsed = ProjectImportSchema.safeParse(req.body);
  if (!parsed.success || !req.file) {
    return res.status(400).json({ error: "Project name and .zip file are required." });
  }

  try {
    if (rejectRestrictedIntent(res, parsed.data.name)) return;
    const project = await importProject(parsed.data.name, req.file.path, { user });
    const readyProject = await ensureProjectPreviewWithPortRetry(project, { emit: event });
    event("project-imported", `Project ${readyProject.name} imported on port ${readyProject.port}`, {
      projectName: project.name,
      projectId: project.id,
      port: readyProject.port
    });
    return res.json({ status: "succeeded", project: readyProject });
  } catch (error) {
    event("project-import-failed", error.message, { projectName: parsed.data.name });
    return res.status(500).json({ status: "failed", error: error.message });
  } finally {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
  }
});

app.post("/api/projects/:projectId/select", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const readyProject = await ensureProjectPreview(project, {
      previewTimeoutMs: Number(process.env.PROJECT_SELECT_PREVIEW_TIMEOUT_MS || 15000),
      allowPreviewTimeout: true
    });
    const recovered = ["created", "created-and-started", "recreated", "recreated-and-started", "restarted", "started"].includes(
      readyProject.runtime?.status
    );
    event(recovered ? "project-runtime-ready" : "project-selected", `Project ${readyProject.name} is live in the playground`, {
      projectId: readyProject.id,
      port: readyProject.port,
      previewUrl: readyProject.previewUrl,
      container: readyProject.containerName,
      runtimeStatus: readyProject.runtime?.status || "running",
      previewWarning: readyProject.previewWarning || null
    });
    return res.json({ status: "succeeded", project: readyProject });
  } catch (error) {
    event("project-select-failed", error.message, { projectId: req.params.projectId });
    return res.status(error.message === "Project not found." ? 404 : 503).json({ status: "failed", error: error.message });
  }
});

app.delete("/api/projects/:projectId", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const deletedProject = await deleteProject(req.params.projectId, { user });
    event("project-deleted", `Project ${deletedProject.name} and its runtime data were deleted`, {
      projectId: deletedProject.id,
      projectName: deletedProject.name,
      port: deletedProject.port,
      containers: deletedProject.runtimeResources.containers,
      volumes: deletedProject.runtimeResources.volumes,
      networks: deletedProject.runtimeResources.networks
    });
    return res.json({ status: "succeeded", project: deletedProject });
  } catch (error) {
    const status = error.message === "Project not found." ? 404 : error.message.includes("cannot be deleted") ? 400 : 500;
    return res.status(status).json({ status: "failed", error: error.message });
  }
});

app.post("/api/projects/:projectId/media", upload.array("media", 12), async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const media = await saveProjectMedia(project, req.files || [], {
      purpose: req.query?.purpose === "app-icon" ? "app-icon" : "media"
    });
    event("media-uploaded", `Uploaded ${media.length} media file${media.length === 1 ? "" : "s"}`, {
      projectId: project?.id,
      media
    });
    return res.json({ status: "succeeded", media, project: await getProject(req.params.projectId, { user }) });
  } catch (error) {
    return res.status(400).json({ status: "failed", error: error.message });
  }
});

app.get("/api/projects/:projectId/export", async (req, res) => {
  const user = userFromRequest(req);
  try {
    const project = await getProject(req.params.projectId, { user });
    const exported = await exportProject(project);
    res.download(exported.outputPath, exported.fileName);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const user = userFromRequest(req);
  const parsed = GenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Instruction must be between 12 and 8000 characters."
    });
  }

  if (rejectRestrictedIntent(res, parsed.data.instruction)) return;
  const selectedProject = await getProject(parsed.data.projectId, { user });
  const media = (selectedProject?.media || []).filter((item) => !parsed.data.mediaIds?.length || parsed.data.mediaIds.includes(item.id));
  const instructionWithMedia = media.length
    ? `${parsed.data.instruction}\n\nUploaded media available to use:\n${media.map((item) => `- ${item.name}: ${item.path}`).join("\n")}`
    : parsed.data.instruction;
  const useProjectOrchestrator = Boolean(selectedProject && !selectedProject.isDefault);
  const orchestratorInstruction = formatProjectOrchestratorInstruction(instructionWithMedia, parsed.data.taskType || "Medium");
  const orchestrated = useProjectOrchestrator
    ? {
        structuredRequest: {
          orchestrator: "builderx-fullstack-agent",
          sourceInstruction: orchestratorInstruction,
          rawTextBoxInstruction: parsed.data.instruction,
          executionInstructionFormat: "builderx-delegated-project-task",
          objective: `Execute the selected project task directly inside ${selectedProject.name}.`,
          pageType: "child_project_direct_task",
          topic: selectedProject.name,
          sections: ["direct-task"],
          constraints: [
            "Use the child project's AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md as scoped execution context under BuilderX authority.",
            "Apply the narrowest complete change requested by the task.",
            "Preserve unrelated existing features, behavior, content, styling, and data."
          ],
          handoff: {
            target: "child-project.orchestrator-agent",
            workspaceDir: selectedProject.workspaceDir,
            restartRequired: true
          },
          fileOperations: []
        },
        codexInstruction: orchestratorInstruction
      }
    : orchestrateBuilderInstruction(instructionWithMedia);
  orchestrated.structuredRequest.media = media;
  orchestrated.structuredRequest.codexProfileId = parsed.data.codexProfileId || "";
  orchestrated.structuredRequest.rawTextBoxInstruction = parsed.data.instruction;
  orchestrated.structuredRequest.executionInstructionFormat = useProjectOrchestrator
    ? "builderx-delegated-project-task"
    : "builderx-default";
  orchestrated.structuredRequest.project = selectedProject
    ? {
        id: selectedProject.id,
        name: selectedProject.name,
        port: selectedProject.port,
        previewUrl: selectedProject.previewUrl,
        workspaceDir: selectedProject.workspaceDir
      }
    : null;
  const orchestrationEnvelope = await createBuilderXOrchestrationEnvelope({
    instruction: instructionWithMedia,
    taskType: parsed.data.taskType || "Medium",
    project: selectedProject,
    structuredRequest: orchestrated.structuredRequest
  });
  const adaptiveRoute = selectAdaptiveRoute({
    instruction: instructionWithMedia,
    taskType: parsed.data.taskType || "Medium",
    project: selectedProject
  });
  if (adaptiveRoute.mode === "single") {
    orchestrationEnvelope.delegations = [];
    orchestrationEnvelope.childExecutionIds = [];
  }
  orchestrationEnvelope.adaptiveRoute = adaptiveRoute;
  orchestrated.structuredRequest.orchestrationEnvelope = orchestrationEnvelope;
  event("builderx-start", "BuilderX accepted global orchestration authority", {
    stage: "2/8",
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
    projectId: selectedProject?.id || null
  });
  event("adaptive-route-selected", `BuilderX selected ${adaptiveRoute.mode}`, {
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
    projectId: selectedProject?.id || null,
    projectName: selectedProject?.name || "BuilderX default workspace",
    adaptiveRoute
  });
  event("orchestrator-prompt", useProjectOrchestrator ? orchestratorInstruction : formatProjectOrchestratorInstruction(instructionWithMedia, parsed.data.taskType || "Medium"), {
    stage: "2/8",
    projectId: selectedProject?.id || null,
    projectName: selectedProject?.name || "BuilderX default workspace",
    taskType: parsed.data.taskType || "Medium",
    promptTarget: "builderx-fullstack-agent",
    instructionFormat: "Task Type / Task"
  });
  if (orchestrationEnvelope.delegations.length) {
    event("delegation-start", `BuilderX delegated bounded project execution to ${orchestrationEnvelope.delegations[0].agentId}`, {
      stage: "2/8",
      projectId: selectedProject.id,
      taskType: parsed.data.taskType || "Medium",
      instructionFormat: "Task type / task",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionId: orchestrationEnvelope.delegations[0].executionId,
      agentId: orchestrationEnvelope.delegations[0].agentId
    });
  }
  event("request-received", "Gotham MCP workflow request received", { stage: "1/8" });
  if (useProjectOrchestrator) {
    event("builderx-delegation", `${selectedProject.name} is executing a BuilderX-owned task`, {
      stage: "3/8",
      projectId: selectedProject.id,
      workspaceDir: selectedProject.workspaceDir,
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId
    });
  } else {
    event("orchestrated", `Instruction restructured for ${orchestrated.structuredRequest.pageType}`, {
      stage: "3/8",
      objective: orchestrated.structuredRequest.objective,
      topic: orchestrated.structuredRequest.topic,
      sections: orchestrated.structuredRequest.sections
    });
    event("file-plan", `Orchestrator planned ${orchestrated.structuredRequest.fileOperations.length} file operations`, {
      stage: "4/8",
      fileOperations: orchestrated.structuredRequest.fileOperations
    });
    for (const [index, operation] of orchestrated.structuredRequest.fileOperations.entries()) {
      event("file-plan-item", `${index + 1}. ${operation.action.toUpperCase()} ${operation.path}`, {
        stage: "4/8",
        action: operation.action,
        path: operation.path,
        reason: operation.reason
      });
    }
  }
  const adaptiveExecutionAgentId = adaptiveRoute.executionAgent === "project-orchestrator" && orchestrationEnvelope.delegations[0]
    ? orchestrationEnvelope.delegations[0].agentId
    : "builderx-fullstack-agent";
  event("generating", "Running current Gotham CLI against generated-site workspace", {
    stage: "5/8",
    agentId: adaptiveExecutionAgentId,
    parentWorkflowId: orchestrationEnvelope.parentWorkflowId
  });
  try {
    const result = await runBuilderXOwnedWorkflow(orchestrated.structuredRequest, {
      emit: event,
      generatedSiteDir: selectedProject?.workspaceDir,
      agentId: "builderx-fullstack-agent",
      agentName: "BuilderX Fullstack Agent",
      codexProfileId: parsed.data.codexProfileId || "",
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "BuilderX default workspace",
      taskType: parsed.data.taskType || "Medium"
    }, orchestrationEnvelope, adaptiveRoute);
    for (const delegation of orchestrationEnvelope.delegations) {
      event("delegation-complete", `${delegation.agentId} completed its bounded execution`, {
        stage: "6/8",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionId: delegation.executionId,
        agentId: delegation.agentId,
        changedFiles: result.files
      });
    }
    event("builderx-validation", "BuilderX accepted generated-file validation evidence", {
      stage: "7/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      status: "passed",
      changedFiles: result.files
    });
    event("files-applied", `Gotham changed ${result.files.length} generated app files`, {
      stage: "6/8",
      agentId: result.tokenUsage?.agentId || adaptiveExecutionAgentId,
      fileOperations: result.fileOperations
    });
    event("runtime-refresh-requested", "Refreshing generated-site runtime after file operations", { stage: "7/8" });
    const restart = selectedProject && !selectedProject.isDefault
      ? (event("project-runtime-handoff", "Gotham file generation complete; BuilderX is assigning the playground port", {
          stage: "7/8",
          projectId: selectedProject.id,
          workspaceDir: selectedProject.workspaceDir
        }),
        await ensureProjectPreviewWithPortRetry(selectedProject, { emit: event }).then((readyProject) => ({
          status: readyProject.runtime?.status || "project-server",
          container: readyProject.containerName,
          reason: `Project container is live on port ${readyProject.port}.`,
          project: readyProject
        })))
      : await restartGeneratedRuntime();
    event(restart.status === "restarted" ? "restarted" : "hot-reload", restart.reason || `Restarted ${restart.container}`, {
      stage: "7/8",
      restart
    });
    event("generated", `Generated ${result.files.length} files`, {
      stage: "8/8",
      buildId: result.buildId
    });
    scheduleAgentMemorySync({ reason: "workflow-generated", emit: event });
    const flowPath = gothamInstructionFlowPath({
      projectName: selectedProject?.name || "BuilderX default workspace",
      taskType: parsed.data.taskType || "Medium",
      orchestrated,
      result,
      useProjectOrchestrator
    });
    persistWhatNextKnowledge(flowPath, {
      source: "agentic-builderx-gotham-chat",
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "BuilderX default workspace",
      instructionSummary: parsed.data.instruction,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    persistProjectInstruction({
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "BuilderX default workspace",
      taskType: parsed.data.taskType || "Medium",
      instruction: parsed.data.instruction,
      status: "succeeded",
      buildId: result.buildId,
      parentWorkflowId: result.parentWorkflowId,
      childExecutionIds: result.childExecutionIds,
      adaptiveRoute: result.adaptiveRoute,
      review: result.review,
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "BuilderX default workspace",
        instruction: parsed.data.instruction,
        taskType: parsed.data.taskType || "Medium",
        status: "succeeded",
        buildId: result.buildId,
        parentWorkflowId: result.parentWorkflowId,
        childExecutionIds: result.childExecutionIds,
        flowPath,
        changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
      }),
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || []
    });
    event("builderx-complete", "BuilderX approved workflow completion", {
      stage: "8/8",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      buildId: result.buildId
    });
    return res.json({ ...result, restart, orchestrated: orchestrated.structuredRequest, flowPath });
  } catch (error) {
    event("builderx-validation", "BuilderX rejected completion because execution or validation failed", {
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      status: "failed",
      error: error.message
    });
    event("error", error.message);
    const flowPath = gothamInstructionFlowPath({
      projectName: selectedProject?.name || "BuilderX default workspace",
      taskType: parsed.data.taskType || "Medium",
      orchestrated,
      status: "failed",
      error: error.message,
      useProjectOrchestrator
    });
    persistWhatNextKnowledge(flowPath, {
      source: "agentic-builderx-gotham-chat",
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "BuilderX default workspace",
      instructionSummary: parsed.data.instruction,
      error: error.message
    });
    persistProjectInstruction({
      projectId: selectedProject?.id || "",
      projectName: selectedProject?.name || "BuilderX default workspace",
      taskType: parsed.data.taskType || "Medium",
      instruction: parsed.data.instruction,
      status: "failed",
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      adaptiveRoute: orchestrationEnvelope.adaptiveRoute,
      flowPath,
      orchestrationSnapshot: createOrchestrationBuildSnapshot({
        projectId: selectedProject?.id || "",
        projectName: selectedProject?.name || "BuilderX default workspace",
        instruction: parsed.data.instruction,
        taskType: parsed.data.taskType || "Medium",
        status: "failed",
        parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
        childExecutionIds: orchestrationEnvelope.childExecutionIds,
        flowPath,
        error: error.message
      }),
      error: error.message
    });
    return res.status(500).json({
      error: error.message,
      parentWorkflowId: orchestrationEnvelope.parentWorkflowId,
      childExecutionIds: orchestrationEnvelope.childExecutionIds,
      flowPath
    });
  }
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message || "Unexpected server error" });
});

app.listen(port, "0.0.0.0", async () => {
  console.log(`Agentic BuilderX backend listening on ${port}`);
  try {
    const projects = await startRegisteredProjects();
    if (projects.length) {
      console.log(`Started ${projects.length} managed project preview server${projects.length === 1 ? "" : "s"}.`);
    }
  } catch (error) {
    console.error(`Failed to start managed project previews: ${error.message}`);
  }
  const syncIntervalMs = Number(process.env.AGENT_MEMORY_SYNC_INTERVAL_MS || 300000);
  setTimeout(() => scheduleAgentMemorySync({ reason: "backend-startup", emit: event }), 8000);
  setInterval(() => scheduleAgentMemorySync({ reason: "periodic", emit: event }), Math.max(60000, syncIntervalMs));
});
