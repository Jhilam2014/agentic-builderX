import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function agentInstructionCandidates() {
  return [
    process.env.BUILDERX_AGENT_INSTRUCTION_PATH,
    path.resolve(moduleDir, "../../../agents/generated/builderx-fullstack-agent.agent.md"),
    path.resolve(process.cwd(), "agents/generated/builderx-fullstack-agent.agent.md"),
    "/workspace/project/agents/generated/builderx-fullstack-agent.agent.md"
  ].filter(Boolean);
}

function canonicalInstructionCandidates() {
  return [
    process.env.BUILDERX_CANONICAL_POLICY_PATH,
    path.resolve(moduleDir, "../../../AGENTS.md"),
    path.resolve(process.cwd(), "AGENTS.md"),
    "/workspace/project/AGENTS.md"
  ].filter(Boolean);
}

const runtimePolicyPattern = /<!-- canonical-runtime-policy:start -->([\s\S]*?)<!-- canonical-runtime-policy:end -->/m;

function contentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function readFirstExisting(paths) {
  for (const candidate of paths) {
    if (await fs.pathExists(candidate)) {
      return { path: candidate, content: await fs.readFile(candidate, "utf8") };
    }
  }
  throw new Error("BuilderX Fullstack Agent instruction file is unavailable; global orchestration cannot start.");
}

function projectAgentId(project) {
  if (!project || project.isDefault) return null;
  const slug = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${slug}-orchestrator-agent`;
}

export async function createBuilderXOrchestrationEnvelope({ instruction, taskType = "Medium", project = null, structuredRequest }) {
  const canonicalPolicy = await readFirstExisting(canonicalInstructionCandidates());
  const runtimePolicy = canonicalPolicy.content.match(runtimePolicyPattern)?.[1]?.trim();
  if (!runtimePolicy) {
    throw new Error(`Canonical AGENTS.md at ${canonicalPolicy.path} does not contain the compact runtime policy block.`);
  }
  const builderProfile = await readFirstExisting(agentInstructionCandidates());
  const localPolicyPath = project?.workspaceDir
    ? path.join(project.workspaceDir, ".agentic", "orchestrator-agent.md")
    : null;
  const localPolicy = localPolicyPath && (await fs.pathExists(localPolicyPath))
    ? await fs.readFile(localPolicyPath, "utf8")
    : "";
  const delegatedAgentId = projectAgentId(project);
  const parentWorkflowId = `builderx_${crypto.randomUUID()}`;
  const childExecutionIds = delegatedAgentId ? [`delegation_${crypto.randomUUID()}`] : [];

  return {
    version: "1.1",
    parentWorkflowId,
    authority: {
      agentId: "builderx-fullstack-agent",
      agentName: "BuilderX Fullstack Agent",
      canonicalPolicy: {
        path: canonicalPolicy.path,
        sha256: contentHash(canonicalPolicy.content),
        runtimeContract: runtimePolicy,
        loadMode: "compact-runtime-contract"
      },
      agentProfile: {
        path: builderProfile.path,
        sha256: contentHash(builderProfile.content),
        loadMode: "reference"
      },
      precedence: ["canonicalPolicy", "agentProfile", "projectPolicy"]
    },
    task: { instruction, taskType },
    project: project
      ? { id: project.id, name: project.name, workspaceDir: project.workspaceDir, isDefault: Boolean(project.isDefault) }
      : null,
    plan: {
      objective: structuredRequest.objective,
      pageType: structuredRequest.pageType,
      sections: structuredRequest.sections || [],
      fileOperations: structuredRequest.fileOperations || []
    },
    delegations: delegatedAgentId
      ? [{
          executionId: childExecutionIds[0],
          agentId: delegatedAgentId,
          role: "project-scoped executor and adviser",
          projectPolicy: localPolicy
            ? { path: localPolicyPath, sha256: contentHash(localPolicy), loadMode: "workspace-file" }
            : null,
          mayRedefineParentTask: false,
          mayApproveCompletion: false
        }]
      : [],
    constraints: [
      ...(structuredRequest.constraints || []),
      "BuilderX Fullstack Agent retains planning, sequencing, validation, retry, and completion authority.",
      "Delegated agents must not redefine the parent task or its completion criteria."
    ],
    expectedOutputs: structuredRequest.fileOperations || [],
    validationCriteria: [
      "The requested project change is implemented.",
      "Unrelated project behavior is preserved.",
      "At least one generated source file changes before completion is reported."
    ],
    childExecutionIds
  };
}
