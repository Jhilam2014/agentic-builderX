import crypto from "node:crypto";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import fs from "fs-extra";
import path from "node:path";

const bootstrapCommand =
  "Use .codex/prompts/bootstrap-orchestrator.md and execute the bootstrap. Use only the local orchestrator files already unzipped in this project. Do not clone, download, or fetch an orchestrator-agent from git.";
const seedPaths = [
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
  "observability/bootstrap-orchestrator-001/bootstrap-verification.json"
];
const bootstrapVerificationPath = "observability/bootstrap-orchestrator-001/bootstrap-verification.json";

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
  const promptPath = path.join(workspaceDir, ".codex", "prompts", "bootstrap-orchestrator.md");
  if (!(await fs.pathExists(promptPath))) throw new Error("Project bootstrap prompt is not installed.");
  const codexBin = process.env.CODEX_BIN || "codex";
  const timeoutMs = Number(process.env.ORCHESTRATOR_BOOTSTRAP_TIMEOUT_MS || 15 * 60 * 1000);
  const buildId = `bootstrap_${project.id}`;
  emit("orchestrator-bootstrap-start", bootstrapCommand, {
    buildId,
    projectId: project.id,
    workspaceDir,
    promptPath: ".codex/prompts/bootstrap-orchestrator.md"
  });

  const args = [
    "exec",
    "--json",
    "--cd",
    workspaceDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--dangerously-bypass-approvals-and-sandbox",
    bootstrapCommand
  ];
  const stderr = [];
  let bootstrapError = null;
  await new Promise((resolve, reject) => {
    const child = spawn(codexBin, args, {
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
    promptPath: ".codex/prompts/bootstrap-orchestrator.md",
    verifiedArtifacts,
    missingArtifacts: missing,
    fallbackArtifacts,
    bootstrapError: bootstrapError?.message || null
  };
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
