import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { nanoid } from "nanoid";

const ignoredDirs = new Set(["node_modules", "dist", ".git"]);

async function collectFileHashes(rootDir, dir = rootDir, hashes = new Map()) {
  if (!(await fs.pathExists(dir))) return hashes;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFileHashes(rootDir, absolutePath, hashes);
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path.relative(rootDir, absolutePath);
    const content = await fs.readFile(absolutePath);
    hashes.set(relativePath, crypto.createHash("sha256").update(content).digest("hex"));
  }
  return hashes;
}

function diffHashes(before, after) {
  const changed = [];
  for (const [filePath, hash] of after.entries()) {
    if (before.get(filePath) !== hash) changed.push(filePath);
  }
  for (const filePath of before.keys()) {
    if (!after.has(filePath)) changed.push(filePath);
  }
  return [...new Set(changed)].sort();
}

function codexPrompt(instruction, orchestratedRequest, hasProjectOrchestrator) {
  const isDirectChildTask = orchestratedRequest.executionInstructionFormat === "child-project-direct-task";
  const authorityText = isDirectChildTask
    ? "Read AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md first, then .agentic/orchestrator-agent.md. The selected child app's project-local orchestrator is the only task-planning authority; BuilderX is only the launcher."
    : hasProjectOrchestrator
      ? "Read canonical AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md first, then .agentic/orchestrator-agent.md for project-specific context. The bootstrapped project-local orchestrator controls task scope, MCP context, token economy, validation, and completion."
      : "Use the supplied structured request and keep discovery narrowly scoped to the requested generated surface.";
  const requirements = isDirectChildTask
    ? [
        "- Treat the exact User instruction above as the child app orchestrator task.",
        "- Do not reinterpret it through BuilderX page generation, landing-page generation, or broad redesign planning.",
        "- Follow AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md command rules before editing.",
        "- Inspect the smallest relevant set of current child app files before changing anything.",
        "- Apply only the narrowest complete change requested by the task.",
        "- Preserve every unrelated existing feature, behavior, route, data set, visual section, style, and interaction.",
        "- Do not remove, rename, simplify, redesign, or replace existing functionality unless the task explicitly asks for it.",
        "- Modify only files that are necessary for the requested change; if src/generated files are involved, patch the smallest relevant sections instead of rewriting the app.",
        "- Do not run npm, Vite, dev servers, preview servers, Docker, curl health checks, or any command that starts/validates a playground runtime.",
        "- Do not choose, reserve, change, document, or validate frontend ports. Agentic BuilderX assigns ports and starts the playground only after this Gotham file-generation step completes.",
        "- Do not create or modify package.json, package-lock.json, node_modules, or dist.",
        "- Keep credentials, secrets, external tracking, and unsafe scripts out of the app.",
        "- Do not ask follow-up questions.",
        "- At the end, briefly summarize the files you changed and confirm unrelated features were preserved."
      ].join("\n")
    : [
        "- Treat the Agentic BuilderX text-box prompt above as the active user task.",
        "- If the user instruction begins with \"Task type:\", pass that exact task block through the project-local orchestrator command rules as the task to execute.",
        "- When project-local orchestration is available, execute the task using AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md command rules.",
        "- Modify files under src/generated/ to implement the requested page.",
        "- Prefer src/generated/generatedPage.jsx, src/generated/generatedPage.css, src/generated/catalogData.js, src/generated/metadata.json, and src/generated/README.generated.md.",
        "- Do not run npm, Vite, dev servers, preview servers, Docker, curl health checks, or any command that starts/validates a playground runtime.",
        "- Do not choose, reserve, change, document, or validate frontend ports. Agentic BuilderX assigns ports and starts the playground only after this Gotham file-generation step completes.",
        "- Do not create or modify package.json, package-lock.json, node_modules, or dist.",
        "- Keep the app self-contained; do not add network calls, tracking, or secrets.",
        "- Preserve the existing React/Vite structure.",
        "- Make the output visibly different when the instruction changes.",
        "- Do not ask follow-up questions.",
        "- At the end, briefly summarize the files you changed."
      ].join("\n");
  return `You are the current Gotham CLI running the Agentic BuilderX workflow.

${isDirectChildTask ? "Edit the selected child app in this working directory. You must use its project-local orchestrator policy and make only the requested scoped change." : "Edit the generated Vite React app in this working directory. You must actually modify files."}

Project orchestration authority:
${authorityText}

User instruction:
${instruction}

${isDirectChildTask ? "Direct child app task request" : "Orchestrated request"}:
${JSON.stringify(orchestratedRequest, null, 2)}

Requirements:
${requirements}`;
}

function emitCodexLine(line, emit, buildId) {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const event = JSON.parse(trimmed);
    const eventType = event.type || event.event || "codex-event";
    const message =
      event.message ||
      event.text ||
      event.delta ||
      event.item?.text ||
      event.item?.message ||
      event.result?.message ||
      eventType;
    emit("codex-progress", String(message).slice(0, 600), {
      stage: "5/8",
      buildId,
      codexEventType: eventType
    });
  } catch {
    emit("codex-progress", trimmed.slice(0, 600), {
      stage: "5/8",
      buildId
    });
  }
}

export async function runCodexWorkflow(orchestratedRequest, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const generatedSiteDir =
    options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
  const codexBin = process.env.CODEX_BIN || "codex";
  const timeoutMs = Number(options.timeoutMs ?? process.env.CODEX_WORKFLOW_TIMEOUT_MS ?? 10 * 60 * 1000);
  const sourceInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const buildId = `codex_${nanoid(10)}`;
  const generatedSourceDir = path.join(generatedSiteDir, "src", "generated");
  const projectOrchestratorPath = path.join(generatedSiteDir, ".agentic", "orchestrator-agent.md");
  const hasProjectOrchestrator = await fs.pathExists(projectOrchestratorPath);

  await fs.ensureDir(generatedSourceDir);
  const before = await collectFileHashes(generatedSourceDir);
  const startedAt = Date.now();

  emit("codex-start", `Starting current Gotham CLI workflow ${buildId}`, {
    stage: "5/8",
    buildId,
    generatedSiteDir,
    generatedSourceDir,
    codexBin,
    orchestrationAuthority: hasProjectOrchestrator ? "project-local" : "builderx-default",
    orchestratorPolicyPath: hasProjectOrchestrator ? projectOrchestratorPath : null
  });

  const args = [
    "exec",
    "--json",
    "--cd",
    generatedSiteDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--dangerously-bypass-approvals-and-sandbox",
    codexPrompt(sourceInstruction, orchestratedRequest, hasProjectOrchestrator)
  ];

  const output = [];
  const errors = [];
  await new Promise((resolve, reject) => {
    const child = spawn(codexBin, args, {
      cwd: generatedSiteDir,
      env: {
        ...process.env,
        CI: "1",
        NO_COLOR: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    let timer;
    const resetInactivityTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Gotham workflow produced no output for ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
      }, timeoutMs);
    };
    resetInactivityTimer();

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      resetInactivityTimer();
      output.push(chunk);
      for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, buildId);
    });
    child.stderr.on("data", (chunk) => {
      resetInactivityTimer();
      errors.push(chunk);
      for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, buildId);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Gotham workflow exited with code ${code}: ${errors.join("").slice(-2000)}`));
    });
  });

  const after = await collectFileHashes(generatedSourceDir);
  const changedSourceFiles = diffHashes(before, after);
  const changedFiles = changedSourceFiles.map((filePath) =>
    path.join("src", "generated", filePath).split(path.sep).join("/")
  );
  if (!changedFiles.length) {
    throw new Error("Gotham completed but did not change any src/generated files.");
  }

  const instructionHash = crypto.createHash("sha256").update(sourceInstruction).digest("hex");
  emit("codex-complete", `Gotham changed ${changedFiles.length} files`, {
    stage: "6/8",
    buildId,
    changedFiles,
    durationMs: Date.now() - startedAt
  });

  return {
    buildId,
    title: orchestratedRequest.topic || "Generated Site",
    instructionHash,
    generatedAt: new Date().toISOString(),
    files: changedFiles,
    fileOperations: changedSourceFiles.map((filePath, index) => ({
      action: before.has(filePath) ? "modify" : "add",
      path: changedFiles[index],
      reason: "Changed by current Gotham CLI workflow."
    })),
    codex: {
      command: codexBin,
      durationMs: Date.now() - startedAt,
      outputTail: output.join("").slice(-4000)
    }
  };
}
