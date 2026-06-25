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

function codexPrompt(instruction, orchestratedRequest) {
  return `You are the current Codex CLI running the Agentic BuilderX workflow.

Edit the generated Vite React app in this working directory. You must actually modify files.

User instruction:
${instruction}

Orchestrated request:
${JSON.stringify(orchestratedRequest, null, 2)}

Requirements:
- Modify files under src/generated/ to implement the requested page.
- Prefer src/generated/generatedPage.jsx, src/generated/generatedPage.css, src/generated/catalogData.js, src/generated/metadata.json, and src/generated/README.generated.md.
- Do not create or modify package.json, package-lock.json, node_modules, or dist.
- Keep the app self-contained; do not add network calls, tracking, or secrets.
- Preserve the existing React/Vite structure.
- Make the output visibly different when the instruction changes.
- Do not ask follow-up questions.
- At the end, briefly summarize the files you changed.`;
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
  const timeoutMs = Number(process.env.CODEX_WORKFLOW_TIMEOUT_MS || 10 * 60 * 1000);
  const sourceInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const buildId = `codex_${nanoid(10)}`;
  const generatedSourceDir = path.join(generatedSiteDir, "src", "generated");

  await fs.ensureDir(generatedSourceDir);
  const before = await collectFileHashes(generatedSourceDir);
  const startedAt = Date.now();

  emit("codex-start", `Starting current Codex CLI workflow ${buildId}`, {
    stage: "5/8",
    buildId,
    generatedSiteDir,
    generatedSourceDir,
    codexBin
  });

  const args = [
    "exec",
    "--json",
    "--cd",
    generatedSiteDir,
    "--skip-git-repo-check",
    "--ephemeral",
    "--dangerously-bypass-approvals-and-sandbox",
    codexPrompt(sourceInstruction, orchestratedRequest)
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

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Codex workflow timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output.push(chunk);
      for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, buildId);
    });
    child.stderr.on("data", (chunk) => {
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
      reject(new Error(`Codex workflow exited with code ${code}: ${errors.join("").slice(-2000)}`));
    });
  });

  const after = await collectFileHashes(generatedSourceDir);
  const changedSourceFiles = diffHashes(before, after);
  const changedFiles = changedSourceFiles.map((filePath) =>
    path.join("src", "generated", filePath).split(path.sep).join("/")
  );
  if (!changedFiles.length) {
    throw new Error("Codex completed but did not change any src/generated files.");
  }

  const instructionHash = crypto.createHash("sha256").update(sourceInstruction).digest("hex");
  emit("codex-complete", `Codex changed ${changedFiles.length} files`, {
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
      reason: "Changed by current Codex CLI workflow."
    })),
    codex: {
      command: codexBin,
      durationMs: Date.now() - startedAt,
      outputTail: output.join("").slice(-4000)
    }
  };
}
