import cors from "cors";
import express from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { z } from "zod";
import { runCodexWorkflow } from "./codexWorkflow.js";
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

const app = express();
const port = Number(process.env.PORT || 8080);
const clients = new Set();
const runtimeLog = [];
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
  mediaIds: z.array(z.string()).optional()
});
const NewProjectSchema = z.object({
  name: z.string().min(2).max(80),
  instruction: z.string().min(12).max(8000).optional(),
  taskType: z.enum(["Simple", "Medium", "Large", "simple", "medium", "large", "small", "hard", "complex"]).optional(),
  mediaIds: z.array(z.string()).optional()
});
const ProjectImportSchema = z.object({
  name: z.string().min(2).max(80)
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

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
  persistRuntimeLogEvent(payload);
  console.log(`[workflow-runtime] ${payload.type}: ${payload.message}`);
  for (const client of clients) {
    client.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
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
    restartMode: String(process.env.RESTART_GENERATED_CONTAINER || "false").toLowerCase() === "true" ? "docker-socket" : "vite-hot-reload"
  });
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

app.get("/api/projects", async (_req, res) => {
  res.json({
    status: "ok",
    projects: await listProjects()
  });
});

app.get("/api/agentic-system/graph", async (_req, res) => {
  try {
    res.json(await buildAgenticSystemGraph());
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

app.post("/api/agents/vector-sync", async (req, res) => {
  try {
    const summary = await syncKnownAgentKnowledgeRoots({ reason: req.body?.reason || "manual", emit: event });
    res.json(summary);
  } catch (error) {
    res.status(500).json({ status: "failed", error: error.message });
  }
});

app.post("/api/projects/new", async (req, res) => {
  const parsed = NewProjectSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Project name must be 2-80 characters and optional instruction must be at least 12 characters."
    });
  }

  const projectInstruction =
    parsed.data.instruction ||
    `Create a polished starter web app for ${parsed.data.name}. Include a market-ready hero, product sections, conversion CTA, and responsive layout.`;
  const projectTaskType = parsed.data.taskType || "Medium";
  const projectOrchestratorPrompt = formatProjectOrchestratorInstruction(projectInstruction, projectTaskType);
  event("project-create-start", `Creating project ${parsed.data.name}`, {
    projectName: parsed.data.name,
    container: process.env.GENERATED_SITE_CONTAINER || "agentic-builderx-generated-site"
  });

  let project = null;
  try {
    project = await createProject(parsed.data.name, null, { emit: event });
    const bootstrap = await runProjectOrchestratorBootstrap(project, { emit: event });
    event("project-instruction-start", `Reading the UI instruction through ${project.name}'s bootstrapped orchestrator`, {
      projectId: project.id,
      promptPath: bootstrap.promptPath,
      taskType: projectTaskType
    });
    event("orchestrator-prompt", projectOrchestratorPrompt, {
      stage: "2/8",
      projectId: project.id,
      projectName: project.name,
      taskType: projectTaskType,
      promptTarget: `${project.name}.orchestrator-agent`,
      instructionFormat: "Task Type / Task"
    });
    const orchestrated = orchestrateBuilderInstruction(projectInstruction);
    const media = (project.media || []).filter((item) => parsed.data.mediaIds?.includes(item.id));
    orchestrated.structuredRequest.media = media;
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
    const result = await runCodexWorkflow(orchestrated.structuredRequest, {
      emit: event,
      generatedSiteDir: project.workspaceDir
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
    return res.json({
      status: "succeeded",
      project: readyProject,
      projectName: parsed.data.name,
      container: `agentic-builderx-project-${project.id}`,
      previewUrl: readyProject.previewUrl,
      buildId: result.buildId,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || [],
      bootstrap,
      restart: { status: "project-server", reason: `Project Vite server assigned to port ${project.port}` }
    });
  } catch (error) {
    if (project?.id) {
      event("project-create-preserved", `Preserved incomplete project ${project.name} after generation failure`, {
        projectId: project.id,
        workspaceDir: project.workspaceDir,
        port: project.port
      });
    }
    event("project-create-failed", error.message, { projectName: parsed.data.name });
    return res.status(500).json({
      status: "failed",
      projectName: parsed.data.name,
      project,
      previewUrl: project?.previewUrl || previewUrl,
      error: error.message
    });
  }
});

app.post("/api/projects/import", upload.single("project"), async (req, res) => {
  const parsed = ProjectImportSchema.safeParse(req.body);
  if (!parsed.success || !req.file) {
    return res.status(400).json({ error: "Project name and .zip file are required." });
  }

  try {
    const project = await importProject(parsed.data.name, req.file.path);
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
  try {
    const project = await getProject(req.params.projectId);
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
  try {
    const deletedProject = await deleteProject(req.params.projectId);
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
  try {
    const project = await getProject(req.params.projectId);
    const media = await saveProjectMedia(project, req.files || []);
    event("media-uploaded", `Uploaded ${media.length} media file${media.length === 1 ? "" : "s"}`, {
      projectId: project?.id,
      media
    });
    return res.json({ status: "succeeded", media, project: await getProject(req.params.projectId) });
  } catch (error) {
    return res.status(400).json({ status: "failed", error: error.message });
  }
});

app.get("/api/projects/:projectId/export", async (req, res) => {
  try {
    const project = await getProject(req.params.projectId);
    const exported = await exportProject(project);
    res.download(exported.outputPath, exported.fileName);
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const parsed = GenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Instruction must be between 12 and 8000 characters."
    });
  }

  const selectedProject = await getProject(parsed.data.projectId);
  const media = (selectedProject?.media || []).filter((item) => !parsed.data.mediaIds?.length || parsed.data.mediaIds.includes(item.id));
  const instructionWithMedia = media.length
    ? `${parsed.data.instruction}\n\nUploaded media available to use:\n${media.map((item) => `- ${item.name}: ${item.path}`).join("\n")}`
    : parsed.data.instruction;
  const useProjectOrchestrator = Boolean(selectedProject && !selectedProject.isDefault);
  const orchestratorInstruction = formatProjectOrchestratorInstruction(instructionWithMedia, parsed.data.taskType || "Medium");
  const orchestrated = useProjectOrchestrator
    ? {
        structuredRequest: {
          orchestrator: "child-project-orchestrator-agent",
          sourceInstruction: orchestratorInstruction,
          rawTextBoxInstruction: parsed.data.instruction,
          executionInstructionFormat: "child-project-direct-task",
          objective: `Execute the selected project task directly inside ${selectedProject.name}.`,
          pageType: "child_project_direct_task",
          topic: selectedProject.name,
          sections: ["direct-task"],
          constraints: [
            "Use the child project's AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md as the only orchestration authority.",
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
  orchestrated.structuredRequest.rawTextBoxInstruction = parsed.data.instruction;
  orchestrated.structuredRequest.executionInstructionFormat = useProjectOrchestrator
    ? "child-project-direct-task"
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
  event("orchestrator-prompt", useProjectOrchestrator ? orchestratorInstruction : formatProjectOrchestratorInstruction(instructionWithMedia, parsed.data.taskType || "Medium"), {
    stage: "2/8",
    projectId: selectedProject?.id || null,
    projectName: selectedProject?.name || "BuilderX default workspace",
    taskType: parsed.data.taskType || "Medium",
    promptTarget: useProjectOrchestrator ? `${selectedProject.name}.orchestrator-agent` : "builderx-fullstack-agent",
    instructionFormat: "Task Type / Task"
  });
  if (selectedProject && !selectedProject.isDefault) {
    event("project-orchestrator-direct", `Passing instruction directly to ${selectedProject.name}'s orchestrator agent`, {
      stage: "2/8",
      projectId: selectedProject.id,
      taskType: parsed.data.taskType || "Medium",
      instructionFormat: "Task type / task"
    });
  }
  event("request-received", "Gotham MCP workflow request received", { stage: "1/8" });
  if (useProjectOrchestrator) {
    event("child-project-handoff", `BuilderX skipped its orchestrator; ${selectedProject.name} owns task scope`, {
      stage: "3/8",
      projectId: selectedProject.id,
      workspaceDir: selectedProject.workspaceDir
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
  event("generating", "Running current Gotham CLI against generated-site workspace", { stage: "5/8" });
  try {
    const result = await runCodexWorkflow(orchestrated.structuredRequest, {
      emit: event,
      generatedSiteDir: selectedProject?.workspaceDir
    });
    event("files-applied", `Gotham changed ${result.files.length} generated app files`, {
      stage: "6/8",
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
    return res.json({ ...result, restart, orchestrated: orchestrated.structuredRequest });
  } catch (error) {
    event("error", error.message);
    return res.status(500).json({ error: error.message });
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
