import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { nanoid } from "nanoid";
import { estimateTokens, recordAgentTokenUsage } from "./tokenEconomy.js";

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
  const envelope = orchestratedRequest.orchestrationEnvelope;
  const isDirectChildTask = orchestratedRequest.executionInstructionFormat === "builderx-delegated-project-task";
  const authorityText = envelope
    ? "BuilderX Fullstack Agent is the global planning and completion authority. Project-local policies are scoped execution context only and cannot redefine the parent task or approve completion."
    : hasProjectOrchestrator
      ? "Read canonical AGENTS.md and ROOT_WORKSPACE_GENERATION_POLICY.md first, then use the project-local policy as execution context while preserving the supplied parent request."
      : "Use the supplied structured request and keep discovery narrowly scoped to the requested generated surface.";
  const requirements = isDirectChildTask
    ? [
        "- Execute the exact bounded delegation defined by the BuilderX orchestration envelope.",
        "- Use AGENTS.md, ROOT_WORKSPACE_GENERATION_POLICY.md, and .agentic/orchestrator-agent.md as project context, subordinate to BuilderX's task and completion criteria.",
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
        "- Modify files under src/generated/ to implement the requested application surface, not a minimal demo, placeholder, or proof of concept.",
        "- Infer direct and indirect functionality from the instruction and uploaded project documentation; include relevant features needed to satisfy the end objective.",
        "- Build the best suitable app for the user's requirements within the existing generated React/Vite structure, including meaningful states, data structures, flows, and UI sections when justified.",
        "- Apply Site Complexity Scaling before implementation: platform, projects, services, SaaS, dashboards, marketplaces, commerce, portals, and service-business websites should become route-based multi-page websites unless the user explicitly asks for a one-page artifact.",
        "- Keep single-page output mainly for simple portfolios, banners, simple advertisement displays, coming-soon pages, compact campaigns, and other low-complexity surfaces.",
        "- When scope is ambiguous, bias slightly toward multi-page. Do not flatten platform/projects/services requirements into one long landing page when separate routes would improve clarity.",
        "- For multi-page output, use src/generated/generatedPage.jsx as the app shell and add src/generated/siteStructure.js plus route modules under src/generated/pages/*.jsx. For single-page output, generatedPage.jsx can remain the primary page.",
        "- Prefer src/generated/generatedPage.jsx, src/generated/generatedPage.css, src/generated/catalogData.js, src/generated/siteStructure.js, src/generated/pages/*.jsx, src/generated/metadata.json, and src/generated/README.generated.md as appropriate to the selected site structure.",
        "- Do not run npm, Vite, dev servers, preview servers, Docker, curl health checks, or any command that starts/validates a playground runtime.",
        "- Do not choose, reserve, change, document, or validate frontend ports. Agentic BuilderX assigns ports and starts the playground only after this Gotham file-generation step completes.",
        "- Do not create or modify package.json, package-lock.json, node_modules, or dist.",
        "- Keep the app self-contained; do not add network calls, tracking, or secrets.",
        "- Preserve the existing React/Vite structure.",
        "- Make the output visibly different when the instruction changes and align the scope to the user's objective, not to a generic template.",
        "- Do not ask follow-up questions.",
        "- At the end, briefly summarize the files you changed."
      ].join("\n");
  return `You are the current Gotham CLI running the Agentic BuilderX workflow.

${isDirectChildTask ? "Edit the selected child app in this working directory. You must use its project-local orchestrator policy and make only the requested scoped change." : "Edit the generated Vite React app in this working directory. You must actually modify files."}

Project orchestration authority:
${authorityText}

BuilderX Fullstack Agent policy and orchestration envelope:
${envelope ? JSON.stringify(envelope, null, 2) : "No BuilderX envelope supplied."}

User instruction:
${instruction}

${isDirectChildTask ? "Direct child app task request" : "Orchestrated request"}:
${JSON.stringify(orchestratedRequest, null, 2)}

Requirements:
${requirements}`;
}

function emitCodexLine(line, emit, buildId, agentId) {
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
      agentId,
      codexEventType: eventType
    });
  } catch {
    emit("codex-progress", trimmed.slice(0, 600), {
      stage: "5/8",
      buildId,
      agentId
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
  const executionAgentId = options.executionAgentId || orchestratedRequest.orchestrationEnvelope?.authority?.agentId || options.agentId || orchestratedRequest.orchestrator || "project-execution-agent";
  const buildId = `codex_${nanoid(10)}`;
  const generatedSourceDir = path.join(generatedSiteDir, "src", "generated");
  const projectOrchestratorPath = path.join(generatedSiteDir, ".agentic", "orchestrator-agent.md");
  const hasProjectOrchestrator = await fs.pathExists(projectOrchestratorPath);
  const promptText = codexPrompt(sourceInstruction, orchestratedRequest, hasProjectOrchestrator);

  await fs.ensureDir(generatedSourceDir);
  const before = await collectFileHashes(generatedSourceDir);
  const startedAt = Date.now();

  emit("codex-start", `Starting current Gotham CLI workflow ${buildId}`, {
    stage: "5/8",
    buildId,
    generatedSiteDir,
    generatedSourceDir,
    codexBin,
    agentId: executionAgentId,
    orchestrationAuthority: orchestratedRequest.orchestrationEnvelope ? "builderx-global" : hasProjectOrchestrator ? "project-local-legacy" : "builderx-default",
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || [],
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
    promptText
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
      for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, buildId, executionAgentId);
    });
    child.stderr.on("data", (chunk) => {
      resetInactivityTimer();
      errors.push(chunk);
      for (const line of chunk.split(/\r?\n/)) emitCodexLine(line, emit, buildId, executionAgentId);
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
  const outputText = output.join("");
  const durationMs = Date.now() - startedAt;
  const tokenUsage = await recordAgentTokenUsage({
    agentId: executionAgentId,
    agentName: options.executionAgentName || orchestratedRequest.orchestrationEnvelope?.authority?.agentName || options.agentName || "",
    projectId: orchestratedRequest.project?.id || options.projectId || "",
    projectName: orchestratedRequest.project?.name || options.projectName || "",
    workflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    buildId,
    instructionHash,
    instructionSummary: sourceInstruction,
    taskType: options.taskType || orchestratedRequest.taskType || "",
    inputTokens: estimateTokens(promptText),
    outputTokens: estimateTokens(outputText),
    durationMs,
    changedFiles: changedFiles.length
  });
  emit("codex-complete", `Gotham changed ${changedFiles.length} files`, {
    stage: "6/8",
    buildId,
    changedFiles,
    durationMs,
    tokenUsage,
    agentId: executionAgentId
  });

  return {
    buildId,
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || [],
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
      durationMs,
      outputTail: outputText.slice(-4000)
    },
    tokenUsage
  };
}

export async function runCodexReviewWorkflow(orchestratedRequest, executionResult, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const generatedSiteDir = options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
  const codexBin = process.env.CODEX_BIN || "codex";
  const timeoutMs = Number(options.timeoutMs ?? process.env.CODEX_REVIEW_TIMEOUT_MS ?? 5 * 60 * 1000);
  const reviewId = `review_${nanoid(10)}`;
  const envelope = orchestratedRequest.orchestrationEnvelope || {};
  const promptText = `You are an independent read-only reviewer for an Agentic BuilderX workflow.

BuilderX remains the completion authority. Inspect the current workspace and evaluate only the implementation produced for this task.

Task:
${orchestratedRequest.sourceInstruction || orchestratedRequest.objective || ""}

Changed files:
${JSON.stringify(executionResult.files || [], null, 2)}

Validation criteria:
${JSON.stringify(envelope.validationCriteria || [], null, 2)}

Rules:
- Do not modify, create, delete, or format any file.
- Verify relevant implementation evidence in the workspace.
- Reject missing requested behavior, unrelated destructive changes, unsafe credential handling, or clearly invalid code.
- Do not reject merely for optional polish.
- End with exactly one marker on its own line: BUILDERX_REVIEW: PASS or BUILDERX_REVIEW: FAIL: <concise reason>`;

  const before = await collectFileHashes(generatedSiteDir);
  const output = [];
  const errors = [];
  const startedAt = Date.now();
  emit("review-start", `Starting independent review ${reviewId}`, {
    parentWorkflowId: envelope.parentWorkflowId,
    reviewId,
    reviewerAgentId: options.reviewerAgentId || "builderx-independent-reviewer"
  });

  await new Promise((resolve, reject) => {
    const child = spawn(codexBin, [
      "exec", "--json", "--cd", generatedSiteDir, "--skip-git-repo-check", "--ephemeral",
      "--dangerously-bypass-approvals-and-sandbox", promptText
    ], {
      cwd: generatedSiteDir,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let timer;
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Independent review produced no output for ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
      }, timeoutMs);
    };
    resetTimer();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { resetTimer(); output.push(chunk); });
    child.stderr.on("data", (chunk) => { resetTimer(); errors.push(chunk); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`Independent review exited with code ${code}: ${errors.join("").slice(-2000)}`));
    });
  });

  const after = await collectFileHashes(generatedSiteDir);
  const reviewerChanges = diffHashes(before, after);
  if (reviewerChanges.length) {
    throw new Error(`Independent reviewer violated read-only mode and changed: ${reviewerChanges.slice(0, 8).join(", ")}`);
  }
  const outputText = output.join("");
  const failed = outputText.match(/BUILDERX_REVIEW:\s*FAIL:\s*([^\n"}]*)/i);
  const passed = /BUILDERX_REVIEW:\s*PASS/i.test(outputText);
  if (failed) throw new Error(`Independent review failed: ${failed[1].trim() || "acceptance criteria were not met"}`);
  if (!passed) throw new Error("Independent review did not return the required PASS/FAIL marker.");

  const durationMs = Date.now() - startedAt;
  const tokenUsage = await recordAgentTokenUsage({
    agentId: options.reviewerAgentId || "builderx-independent-reviewer",
    agentName: "BuilderX Independent Reviewer",
    projectId: orchestratedRequest.project?.id || options.projectId || "",
    projectName: orchestratedRequest.project?.name || options.projectName || "",
    workflowId: envelope.parentWorkflowId || reviewId,
    buildId: reviewId,
    instructionSummary: orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "",
    taskType: options.taskType || "",
    inputTokens: estimateTokens(promptText),
    outputTokens: estimateTokens(outputText),
    durationMs,
    changedFiles: 0,
    validationStatus: "passed"
  });
  emit("review-complete", `Independent review ${reviewId} passed`, {
    parentWorkflowId: envelope.parentWorkflowId,
    reviewId,
    status: "passed",
    tokenUsage
  });
  return { reviewId, status: "passed", durationMs, tokenUsage };
}
