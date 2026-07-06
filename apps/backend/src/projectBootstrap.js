import crypto from "node:crypto";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import fs from "fs-extra";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentCliInvocation } from "./agentCli.js";

const builderxSourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const codexBootstrapCommand =
  "Use .codex/prompts/bootstrap-orchestrator.md and execute the bootstrap. Use only the local orchestrator files already unzipped in this project. Do not clone, download, or fetch an orchestrator-agent from git.";
const claudeBootstrapCommands = {
  new: "Execute the /setup-new-project command from .claude/commands/setup-new-project.md. Use only the local orchestrator files already installed in this project. Do not clone, download, or fetch an orchestrator-agent from git.",
  existing: "Execute the /setup-existing-project command from .claude/commands/setup-existing-project.md. Use only the local orchestrator files already installed in this project. Do not clone, download, or fetch an orchestrator-agent from git."
};
const seedPaths = [
  ".claude/commands",
  ".claude/settings.example.json",
  ".codex/prompts",
  ".env.example",
  "AGENTS.md",
  "CLAUDE.md",
  "ROOT_WORKSPACE_GENERATION_POLICY.md",
  "docs/USAGE.md"
];
const requiredBootstrapArtifacts = [
  "agents/generated/project-execution-agent.agent.md",
  "registry/agents/project-execution-agent.registry.json",
  "graph/neo4j",
  "topology/d3/agentic-system-graph.json",
  "qagentic-support/README.md",
  "qagentic-support/qagent-framework.md",
  "qagentic-support/qagent-controller.md",
  "qagentic-support/qagent-stop-rules.md",
  "qagentic-support/runtime-qagent-template.md",
  "qagentic-support/qagent-memory-policy.md",
  "schemas/qagent-next-instruction.schema.json",
  ".codex/prompts/task-qagentic.md",
  ".codex/prompts/bootstrap-orchestrator-qagentic.md",
  "observability/qagentic/latest-qagentic-bootstrap.json",
  "observability/bootstrap-orchestrator-001/bootstrap-verification.json"
];
const bootstrapVerificationPath = "observability/bootstrap-orchestrator-001/bootstrap-verification.json";

const qagentNextInstructionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "QAgent Next Instruction Packet",
  type: "object",
  additionalProperties: false,
  required: [
    "continue",
    "completion_score",
    "stop_reason",
    "gap_summary",
    "missing_items",
    "next_agent_type",
    "next_instruction",
    "validation_required",
    "memory_update",
    "iteration_control"
  ],
  properties: {
    continue: { type: "boolean" },
    completion_score: { type: "integer", minimum: 0, maximum: 100 },
    stop_reason: { type: "string" },
    gap_summary: { type: "string" },
    missing_items: { type: "array", items: { type: "string" } },
    next_agent_type: { type: "string" },
    next_instruction: { type: "string" },
    validation_required: { type: "array", items: { type: "string" } },
    memory_update: {
      type: "object",
      additionalProperties: false,
      required: ["store", "summary", "tags"],
      properties: {
        store: { type: "boolean" },
        summary: { type: "string" },
        tags: { type: "array", items: { type: "string" } }
      }
    },
    iteration_control: {
      type: "object",
      additionalProperties: false,
      required: ["current_iteration", "max_iterations", "stop_if_next_validation_passes"],
      properties: {
        current_iteration: { type: "integer", minimum: 0 },
        max_iterations: { type: "integer", minimum: 1, maximum: 8 },
        stop_if_next_validation_passes: { type: "boolean" }
      }
    }
  }
};

async function appendQAgenticAgentsSection(workspaceDir) {
  const agentsPath = path.join(workspaceDir, "AGENTS.md");
  const existing = (await fs.pathExists(agentsPath)) ? await fs.readFile(agentsPath, "utf8") : "";
  if (existing.includes("<!-- qagentic-support:start -->")) return;
  const block = [
    "",
    "<!-- qagentic-support:start -->",
    "# QAgentic Support",
    "",
    "QAgentic support is additive. It must not replace or weaken existing project orchestrator instructions.",
    "",
    "- QAgent Controller reviews the previous agent response against the original objective.",
    "- It detects missing work, weak validation, incomplete implementation, and unclear next steps.",
    "- It outputs only a stop decision or a Next Instruction Packet.",
    "- Runtime QAgents are generated only for blocking or important objective gaps.",
    "- Stop when the objective is complete, validation passes, only polish remains, required user information is missing, or the iteration cap is reached.",
    "<!-- qagentic-support:end -->",
    ""
  ].join("\n");
  await fs.ensureDir(path.dirname(agentsPath));
  await fs.writeFile(agentsPath, `${existing.replace(/\s*$/, "")}${existing.trim() ? "\n" : ""}${block}`);
}

export async function ensureProjectQAgenticFramework(workspaceDir, project = {}, options = {}) {
  const created = [];
  const source = options.source || "builderx-qagentic-framework";
  const ensureText = async (relativePath, content) => {
    const targetPath = path.join(workspaceDir, relativePath);
    if (await fs.pathExists(targetPath)) return;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, content);
    created.push(relativePath);
  };
  const ensureJson = async (relativePath, payload) => {
    const targetPath = path.join(workspaceDir, relativePath);
    if (await fs.pathExists(targetPath)) return;
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeJson(targetPath, payload, { spaces: 2 });
    created.push(relativePath);
  };

  await ensureText("qagentic-support/README.md", `# QAgentic Support

Base QAgentic support is generated at project onset. Runtime QAgents are generated only when objective gaps are detected.

QAgents produce strict Next Instruction Packets and do not directly implement code.
`);
  await ensureText("qagentic-support/qagent-framework.md", `# QAgent Framework

The QAgent framework turns the end of an agent response into a precise continuation decision.

It compares the original objective, previous response, changed files, validation evidence, and known constraints. It continues only for blocking or important gaps.

Do not pre-generate unlimited specialized QAgents. Runtime QAgents are temporary by default and may be persisted only when a repeated reusable gap pattern is proven.
`);
  await ensureText("qagentic-support/qagent-controller.md", `# QAgent Controller

Compare the previous response with the original objective. Continue only for blocking or important gaps. Prefer existing agents. Emit a Next Instruction Packet matching \`schemas/qagent-next-instruction.schema.json\`.

The controller must not execute code directly.
`);
  await ensureText("qagentic-support/qagent-stop-rules.md", `# QAgent Stop Rules

Stop when the objective is complete, validation passes, only polish remains, human approval is required, required user information is missing, or the iteration cap is reached.

Iteration caps: tiny=1, small=3, medium=5, large=8.
`);
  await ensureText("qagentic-support/runtime-qagent-template.md", `# Runtime QAgent Template

Runtime QAgents are temporary by default. They output only Next Instruction Packets and must not implement code directly.

Required output schema: \`schemas/qagent-next-instruction.schema.json\`.
`);
  await ensureText("qagentic-support/qagent-memory-policy.md", `# QAgent Memory Policy

Store objective gaps, successful next instruction summaries, stop reasons, validation failures, and reusable patterns. Do not store secrets, credentials, raw private data, or speculative gap guesses.
`);
  await ensureJson("schemas/qagent-next-instruction.schema.json", qagentNextInstructionSchema);
  await ensureText(".codex/prompts/task-qagentic.md", `Read AGENTS.md, qagentic-support/README.md, qagentic-support/qagent-controller.md, and qagentic-support/qagent-stop-rules.md before acting.

Enable QAgentic continuation review for this task.

Task type: tiny | small | medium | large
Task: <write the user objective here>

Preserve existing features. Reuse existing agents. Runtime QAgents may be generated only for blocking or important objective gaps. QAgents must not execute code directly. Stop when the objective is complete, validation passes, only polish remains, required user information is missing, or the task iteration cap is reached.
`);
  await ensureText(".codex/prompts/bootstrap-orchestrator-qagentic.md", `Optional new-project bootstrap prompt for QAgentic support.

Use this only when creating or bootstrapping a new project, or when the user explicitly requests QAgentic support for an existing project.

Create missing qagentic-support framework files, schema, task prompt, observability output, and QAgent Controller topology relations without replacing existing project instructions.
`);
  await ensureJson("observability/qagentic/latest-qagentic-bootstrap.json", {
    status: "generated",
    source,
    project_id: project.id || "",
    project_name: project.name || "",
    base_framework: true,
    runtime_qagents: "generate_only_when_objective_gap_detected",
    generated_at: new Date().toISOString()
  });
  await appendQAgenticAgentsSection(workspaceDir);
  return { status: created.length ? "created" : "already-present", created };
}

async function ensureFallbackBootstrapArtifacts(project, missingArtifacts, bootstrapError) {
  const workspaceDir = project.workspaceDir;
  const fallbackArtifacts = [];
  const ensureJson = async (relativePath, payload) => {
    if (await fs.pathExists(path.join(workspaceDir, relativePath))) return;
    await fs.ensureDir(path.dirname(path.join(workspaceDir, relativePath)));
    await fs.writeJson(path.join(workspaceDir, relativePath), payload, { spaces: 2 });
    fallbackArtifacts.push(relativePath);
  };
  const ensureText = async (relativePath, content) => {
    if (await fs.pathExists(path.join(workspaceDir, relativePath))) return;
    await fs.ensureDir(path.dirname(path.join(workspaceDir, relativePath)));
    await fs.writeFile(path.join(workspaceDir, relativePath), content);
    fallbackArtifacts.push(relativePath);
  };

  await fs.ensureDir(path.join(workspaceDir, "graph", "neo4j"));
  await ensureText(
    "agents/generated/project-execution-agent.agent.md",
    [
      "# Project Execution Agent",
      "",
      `project_id: ${project.id}`,
      `project_name: ${project.name}`,
      'role: "project-execution-agent"',
      "",
      "## Responsibility",
      "Execute Agentic BuilderX project generation tasks using the local AGENTS.md policy and the prompt supplied from the BuilderX text box.",
      ""
    ].join("\n")
  );
  await ensureJson("registry/agents/project-execution-agent.registry.json", {
    agent_id: "project-execution-agent",
    project_id: project.id,
    role: "project-execution-agent",
    source: "builderx-fallback-bootstrap",
    created_at: new Date().toISOString()
  });
  await ensureJson("topology/d3/agentic-system-graph.json", {
    metadata: {
      project_name: project.name,
      project_id: project.id,
      source: "builderx-fallback-bootstrap"
    },
    nodes: [{ id: `project:${project.id}`, label: project.name, type: "project" }],
    links: []
  });
  const qagentic = await ensureProjectQAgenticFramework(workspaceDir, project, { source: "builderx-fallback-qagentic-bootstrap" });
  fallbackArtifacts.push(...qagentic.created);

  await ensureJson(bootstrapVerificationPath, {
    status: bootstrapError ? "bootstrap-command-failed-continuing" : "incomplete",
    workflow_id: "bootstrap-orchestrator-001",
    project_id: project.id,
    message: bootstrapError
      ? "Bootstrap command failed, but BuilderX created local fallback artifacts so project generation can continue."
      : "Bootstrap command completed, but required artifacts were missing. BuilderX created local fallback artifacts so project generation can continue.",
    error: bootstrapError?.message || null,
    missingArtifacts,
    fallbackArtifacts,
    recordedAt: new Date().toISOString()
  });
  return fallbackArtifacts;
}

function enabled(value, defaultValue = true) {
  if (value === undefined) return defaultValue;
  return String(value).toLowerCase() !== "false";
}

function archivePath() {
  return process.env.ORCHESTRATOR_ARCHIVE_PATH || "/workspace/project/orchestrator-temp/orchestrator-agent-001-main.zip";
}

function normalizedArchiveEntries(zip) {
  const entries = zip.getEntries().filter((entry) => !entry.isDirectory);
  const names = entries.map((entry) => entry.entryName.replace(/\\/g, "/").replace(/^\/+/, ""));
  const firstSegments = new Set(names.map((name) => name.split("/")[0]).filter(Boolean));
  const rootPrefix = firstSegments.size === 1 ? `${[...firstSegments][0]}/` : "";
  return entries.map((entry, index) => ({
    entry,
    relativePath: rootPrefix && names[index].startsWith(rootPrefix) ? names[index].slice(rootPrefix.length) : names[index]
  }));
}

export async function installProjectOrchestratorSeed(workspaceDir, options = {}) {
  if (!enabled(process.env.ORCHESTRATOR_INSTALL_ENABLED)) {
    return { status: "skipped", reason: "ORCHESTRATOR_INSTALL_ENABLED=false" };
  }
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const sourceArchive = archivePath();
  if (!(await fs.pathExists(sourceArchive))) throw new Error(`Project orchestrator archive was not found at ${sourceArchive}.`);
  emit("orchestrator-archive-start", `Extracting project orchestrator from ${sourceArchive}`, {
    archivePath: sourceArchive,
    workspaceDir
  });

  const zip = new AdmZip(sourceArchive);
  const extractedFiles = [];
  for (const { entry, relativePath } of normalizedArchiveEntries(zip)) {
    if (!relativePath || relativePath === ".DS_Store" || relativePath === ".env") continue;
    const targetPath = path.resolve(workspaceDir, relativePath);
    const workspaceRoot = path.resolve(workspaceDir);
    if (targetPath !== workspaceRoot && !targetPath.startsWith(`${workspaceRoot}${path.sep}`)) {
      throw new Error(`Orchestrator archive contains an unsafe path: ${entry.entryName}`);
    }
    await fs.ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, entry.getData());
    extractedFiles.push(relativePath);
  }
  // Older orchestrator archives may predate native Claude commands. Install the
  // current command adapters from BuilderX so imported/existing projects get the
  // same setup and task entrypoints without requiring an archive refresh.
  const commandSourceCandidates = [
    process.env.BUILDERX_PROJECT_ROOT && path.join(process.env.BUILDERX_PROJECT_ROOT, ".claude", "commands"),
    path.join(builderxSourceRoot, ".claude", "commands")
  ].filter(Boolean);
  let claudeCommandsSource = null;
  for (const candidate of commandSourceCandidates) {
    if (await fs.pathExists(candidate)) {
      claudeCommandsSource = candidate;
      break;
    }
  }
  const claudeCommandsTarget = path.join(workspaceDir, ".claude", "commands");
  if (claudeCommandsSource) {
    await fs.copy(claudeCommandsSource, claudeCommandsTarget, { overwrite: true });
    const commandNames = await fs.readdir(claudeCommandsSource);
    for (const commandName of commandNames) {
      const relativePath = `.claude/commands/${commandName}`;
      if (!extractedFiles.includes(relativePath)) extractedFiles.push(relativePath);
    }
  }
  for (const relativePath of seedPaths) {
    if (!(await fs.pathExists(path.join(workspaceDir, relativePath)))) {
      throw new Error(`Orchestrator archive is missing ${relativePath}.`);
    }
  }
  const archiveBuffer = await fs.readFile(sourceArchive);
  const manifest = {
    archivePath: sourceArchive,
    archiveName: path.basename(sourceArchive),
    archiveSha256: crypto.createHash("sha256").update(archiveBuffer).digest("hex"),
    archiveComment: zip.getZipComment() || null,
    extractedFiles,
    preservedRuntimeFiles: [".env"],
    installedAt: new Date().toISOString(),
    bootstrapPrompt: ".codex/prompts/bootstrap-orchestrator.md"
  };
  await fs.ensureDir(path.join(workspaceDir, ".agentic"));
  await fs.writeJson(path.join(workspaceDir, ".agentic", "orchestrator-source.json"), manifest, { spaces: 2 });
  emit("orchestrator-archive-installed", `Project orchestrator archive installed (${extractedFiles.length} files)`, manifest);
  return { status: "installed", ...manifest };
}

function emitBootstrapLine(line, emit, buildId) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const payload = JSON.parse(trimmed);
    const eventType = payload.type || payload.event || "bootstrap-event";
    const message = payload.message || payload.text || payload.item?.text || payload.item?.message || eventType;
    emit("orchestrator-bootstrap-progress", String(message).slice(0, 600), { buildId, codexEventType: eventType });
  } catch {
    emit("orchestrator-bootstrap-progress", trimmed.slice(0, 600), { buildId });
  }
}

export async function runProjectOrchestratorBootstrap(project, options = {}) {
  if (!enabled(process.env.ORCHESTRATOR_BOOTSTRAP_ENABLED)) {
    return { status: "skipped", reason: "ORCHESTRATOR_BOOTSTRAP_ENABLED=false" };
  }
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const workspaceDir = project.workspaceDir;
  const invocationProvider = agentCliInvocation({ prompt: "provider-check", cwd: workspaceDir }).provider;
  const setupMode = options.setupMode === "existing" ? "existing" : "new";
  const bootstrapCommand = invocationProvider === "claude" ? claudeBootstrapCommands[setupMode] : codexBootstrapCommand;
  const promptRelativePath = invocationProvider === "claude"
    ? `.claude/commands/setup-${setupMode}-project.md`
    : ".codex/prompts/bootstrap-orchestrator.md";
  const promptPath = path.join(workspaceDir, ...promptRelativePath.split("/"));
  if (!(await fs.pathExists(promptPath))) throw new Error("Project bootstrap prompt is not installed.");
  const timeoutMs = Number(process.env.ORCHESTRATOR_BOOTSTRAP_TIMEOUT_MS || 15 * 60 * 1000);
  const buildId = `bootstrap_${project.id}`;
  emit("orchestrator-bootstrap-start", bootstrapCommand, {
    buildId,
    projectId: project.id,
    workspaceDir,
    promptPath: promptRelativePath,
    cliProvider: invocationProvider,
    setupMode
  });

  const invocation = agentCliInvocation({ prompt: bootstrapCommand, cwd: workspaceDir });
  const stderr = [];
  let bootstrapError = null;
  await new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: workspaceDir,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Project orchestrator bootstrap timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => chunk.split(/\r?\n/).forEach((line) => emitBootstrapLine(line, emit, buildId)));
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      chunk.split(/\r?\n/).forEach((line) => emitBootstrapLine(line, emit, buildId));
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Orchestrator bootstrap exited with code ${code}: ${stderr.join("").slice(-2000)}`));
    });
  }).catch((error) => {
    bootstrapError = error;
  });

  const missing = [];
  for (const relativePath of requiredBootstrapArtifacts) {
    if (!(await fs.pathExists(path.join(workspaceDir, relativePath)))) missing.push(relativePath);
  }
  const fallbackArtifacts = missing.length || bootstrapError ? await ensureFallbackBootstrapArtifacts(project, missing, bootstrapError) : [];
  const verifiedArtifacts = [];
  for (const relativePath of requiredBootstrapArtifacts) {
    if (await fs.pathExists(path.join(workspaceDir, relativePath))) verifiedArtifacts.push(relativePath);
  }
  const result = {
    status: bootstrapError ? "bootstrap-failed-continuing" : missing.length ? "bootstrapped-with-warnings" : "bootstrapped",
    buildId,
    projectId: project.id,
    promptPath: promptRelativePath,
    cliProvider: invocation.provider,
    setupMode,
    verifiedArtifacts,
    missingArtifacts: missing,
    fallbackArtifacts,
    bootstrapError: bootstrapError?.message || null
  };
  await fs.ensureDir(path.join(workspaceDir, ".agentic"));
  await fs.writeJson(path.join(workspaceDir, ".agentic", "bootstrap-status.json"), {
    ...result,
    completedAt: new Date().toISOString()
  }, { spaces: 2 });
  emit(
    bootstrapError || missing.length ? "orchestrator-bootstrap-warning" : "orchestrator-bootstrap-complete",
    bootstrapError || missing.length
      ? `Project orchestrator bootstrap completed with missing artifacts; continuing generation for ${project.name}`
      : `Project orchestrator bootstrap verified for ${project.name}`,
    result
  );
  return result;
}
