import crypto from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "fs-extra";
import { nanoid } from "nanoid";
import { estimateTokens, recordAgentTokenUsage } from "./tokenEconomy.js";
import { agentCliInvocation } from "./agentCli.js";
import { sanitizeAgentProcessEnv } from "./providerAuth.js";
import { classifyCodexError, markCodexProfileUnavailable, recordCodexProfileResult } from "./codexProfiles.js";

const ignoredDirs = new Set(["node_modules", "dist", ".git"]);
const openaiAllowedGeneratedFiles = new Set([
  "generatedPage.jsx",
  "generatedPage.css",
  "catalogData.js",
  "siteStructure.js",
  "metadata.json",
  "README.generated.md"
]);

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

async function collectGeneratedFileContext(generatedSourceDir, maxChars = 120000) {
  const files = [];
  async function walk(dir = generatedSourceDir) {
    if (!(await fs.pathExists(dir))) return;
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "pages") await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = path.relative(generatedSourceDir, absolutePath).split(path.sep).join("/");
      if (!openaiAllowedGeneratedFiles.has(relativePath) && !relativePath.startsWith("pages/")) continue;
      const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
      files.push({ path: `src/generated/${relativePath}`, content });
    }
  }
  await walk();
  let remaining = maxChars;
  return files.map((file) => {
    const content = file.content.slice(0, Math.max(0, remaining));
    remaining -= content.length;
    return { ...file, content };
  }).filter((file) => file.content || remaining > 0);
}

function parseOpenAIJsonPayload(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("OpenAI returned an empty response.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) return JSON.parse(fenced);
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart !== -1 && objectEnd > objectStart) {
      return JSON.parse(trimmed.slice(objectStart, objectEnd + 1));
    }
    throw new Error("OpenAI response was not valid JSON.");
  }
}

function normalizeGeneratedWritePath(filePath = "") {
  const normalized = String(filePath || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const relative = normalized.startsWith("src/generated/")
    ? normalized.slice("src/generated/".length)
    : normalized;
  if (!relative || relative.includes("..") || path.isAbsolute(relative)) {
    throw new Error(`OpenAI returned an unsafe generated file path: ${filePath}`);
  }
  if (!openaiAllowedGeneratedFiles.has(relative) && !relative.startsWith("pages/")) {
    throw new Error(`OpenAI attempted to write outside allowed generated files: ${filePath}`);
  }
  return relative;
}

async function callOpenAIJson({ system, user, model, timeoutMs }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for AI_CLI_PROVIDER=openai.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...(process.env.OPENAI_ORG_ID ? { "OpenAI-Organization": process.env.OPENAI_ORG_ID } : {}),
        ...(process.env.OPENAI_PROJECT_ID ? { "OpenAI-Project": process.env.OPENAI_PROJECT_ID } : {})
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ]
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error?.message || `OpenAI request failed with HTTP ${response.status}`);
    }
    const content = data?.choices?.[0]?.message?.content || "";
    return { payload: parseOpenAIJsonPayload(content), raw: content, usage: data?.usage || {} };
  } finally {
    clearTimeout(timer);
  }
}

async function runOpenAIFileGeneration({ promptText, generatedSourceDir, timeoutMs, emit, buildId, executionAgentId }) {
  const currentFiles = await collectGeneratedFileContext(generatedSourceDir);
  const model = process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1";
  emit("codex-progress", `OpenAI server runtime selected with model ${model}`, {
    stage: "5/8",
    buildId,
    agentId: executionAgentId,
    cliProvider: "openai"
  });
  const { payload, raw, usage } = await callOpenAIJson({
    model,
    timeoutMs,
    system: [
      "You are Agentic BuilderX's server-side OpenAI implementation worker.",
      "Return JSON only. Do not include markdown.",
      "You may create or update only files under src/generated/.",
      "The output must be a complete file-change plan, not a patch."
    ].join(" "),
    user: [
      promptText,
      "",
      "Current src/generated files:",
      JSON.stringify(currentFiles, null, 2),
      "",
      "Return exactly this JSON shape:",
      JSON.stringify({
        summary: "short implementation summary",
        files: [
          {
            path: "src/generated/generatedPage.jsx",
            content: "complete file contents"
          }
        ]
      }, null, 2)
    ].join("\n")
  });
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) throw new Error("OpenAI did not return any generated file changes.");
  const written = [];
  for (const file of files) {
    const relativePath = normalizeGeneratedWritePath(file.path);
    const content = String(file.content ?? "");
    if (!content.trim()) throw new Error(`OpenAI returned empty content for ${file.path}`);
    const absolutePath = path.join(generatedSourceDir, relativePath);
    await fs.ensureDir(path.dirname(absolutePath));
    await fs.writeFile(absolutePath, content);
    written.push(`src/generated/${relativePath}`);
  }
  return {
    outputText: raw,
    summary: payload.summary || "",
    usage,
    written
  };
}

async function runOpenAIReview({ promptText, generatedSiteDir, executionResult, timeoutMs }) {
  const model = process.env.OPENAI_REVIEW_MODEL || process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || "gpt-4.1";
  const changedFiles = [];
  for (const filePath of executionResult.files || []) {
    const normalized = String(filePath || "").replace(/\\/g, "/");
    if (!normalized.startsWith("src/generated/")) continue;
    const absolutePath = path.join(generatedSiteDir, normalized);
    const content = await fs.readFile(absolutePath, "utf8").catch(() => "");
    changedFiles.push({ path: normalized, content: content.slice(0, 40000) });
  }
  const { payload, raw, usage } = await callOpenAIJson({
    model,
    timeoutMs,
    system: "You are BuilderX's independent read-only reviewer. Return JSON only.",
    user: [
      promptText,
      "",
      "Changed file evidence:",
      JSON.stringify(changedFiles, null, 2),
      "",
      "Return JSON: {\"verdict\":\"PASS\"} or {\"verdict\":\"FAIL\",\"reason\":\"concise reason\"}."
    ].join("\n")
  });
  const verdict = String(payload.verdict || "").toUpperCase();
  if (verdict !== "PASS") throw new Error(`Independent review failed: ${payload.reason || "acceptance criteria were not met"}`);
  return { outputText: raw, usage };
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
        "- BuilderX can create web apps, mobile-app surfaces/prototypes, flyers, posters, PDF-style documents embedded in webpages, API documentation pages, Swagger/OpenAPI pages, and other requested digital artifacts. Choose the artifact type from the instruction instead of assuming every request is a generic website.",
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
  const timeoutMs = Number(options.timeoutMs ?? process.env.CODEX_WORKFLOW_TIMEOUT_MS ?? 10 * 60 * 1000);
  const sourceInstruction = orchestratedRequest.sourceInstruction || orchestratedRequest.objective || "";
  const executionAgentId = options.executionAgentId || orchestratedRequest.orchestrationEnvelope?.authority?.agentId || options.agentId || orchestratedRequest.orchestrator || "project-execution-agent";
  const buildId = `codex_${nanoid(10)}`;
  const generatedSourceDir = path.join(generatedSiteDir, "src", "generated");
  const projectOrchestratorPath = path.join(generatedSiteDir, ".agentic", "orchestrator-agent.md");
  const hasProjectOrchestrator = await fs.pathExists(projectOrchestratorPath);
  const promptText = codexPrompt(sourceInstruction, orchestratedRequest, hasProjectOrchestrator);
  const invocation = agentCliInvocation({
    prompt: promptText,
    cwd: generatedSiteDir,
    codexProfileId: options.codexProfileId || orchestratedRequest.codexProfileId,
    codexProfileSelectionMode: options.codexProfileSelectionMode || orchestratedRequest.codexProfileSelectionMode
  });

  await fs.ensureDir(generatedSourceDir);
  const before = await collectFileHashes(generatedSourceDir);
  const startedAt = Date.now();

  emit("codex-start", `Starting current Gotham CLI workflow ${buildId}`, {
    stage: "5/8",
    buildId,
    generatedSiteDir,
    generatedSourceDir,
    codexBin: invocation.command,
    cliProvider: invocation.provider,
    codexProfileId: invocation.codexProfile?.id || "",
    agentId: executionAgentId,
    orchestrationAuthority: orchestratedRequest.orchestrationEnvelope ? "builderx-global" : hasProjectOrchestrator ? "project-local-legacy" : "builderx-default",
    parentWorkflowId: orchestratedRequest.orchestrationEnvelope?.parentWorkflowId || buildId,
    childExecutionIds: orchestratedRequest.orchestrationEnvelope?.childExecutionIds || [],
    orchestratorPolicyPath: hasProjectOrchestrator ? projectOrchestratorPath : null
  });

  const output = [];
  const errors = [];
  let openAIUsage = null;
  if (invocation.provider === "openai") {
    const result = await runOpenAIFileGeneration({
      promptText,
      generatedSourceDir,
      timeoutMs,
      emit,
      buildId,
      executionAgentId
    });
    output.push(result.outputText);
    openAIUsage = result.usage;
  } else {
    await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: generatedSiteDir,
        env: {
          ...(invocation.env || sanitizeAgentProcessEnv(process.env)),
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
          if (invocation.codexProfile?.id) recordCodexProfileResult(invocation.codexProfile.id, true);
          resolve();
          return;
        }
        const errorText = errors.join("").slice(-2000);
        const errorCode = invocation.codexProfile?.id ? classifyCodexError(errorText) : "";
        if (errorCode === "usage_limit") markCodexProfileUnavailable(invocation.codexProfile.id, errorCode);
        if (invocation.codexProfile?.id) recordCodexProfileResult(invocation.codexProfile.id, false);
        reject(new Error(`Gotham workflow exited with code ${code}: ${errorText}`));
      });
    });
  }

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
    outputTokens: openAIUsage?.completion_tokens || estimateTokens(outputText),
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
      command: invocation.command,
      provider: invocation.provider,
      profile: invocation.codexProfile || null,
      durationMs,
      openAIUsage,
      outputTail: outputText.slice(-4000)
    },
    tokenUsage
  };
}

export async function runCodexReviewWorkflow(orchestratedRequest, executionResult, options = {}) {
  const emit = typeof options.emit === "function" ? options.emit : () => {};
  const generatedSiteDir = options.generatedSiteDir || process.env.GENERATED_SITE_DIR || path.resolve(process.cwd(), "../generated-site");
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
  const invocation = agentCliInvocation({
    prompt: promptText,
    cwd: generatedSiteDir,
    codexProfileId: options.codexProfileId || orchestratedRequest.codexProfileId,
    codexProfileSelectionMode: options.codexProfileSelectionMode || orchestratedRequest.codexProfileSelectionMode
  });

  const before = await collectFileHashes(generatedSiteDir);
  const output = [];
  const errors = [];
  const startedAt = Date.now();
  emit("review-start", `Starting independent review ${reviewId}`, {
    parentWorkflowId: envelope.parentWorkflowId,
    reviewId,
    reviewerAgentId: options.reviewerAgentId || "builderx-independent-reviewer"
  });

  let openAIUsage = null;
  if (invocation.provider === "openai") {
    const result = await runOpenAIReview({ promptText, generatedSiteDir, executionResult, timeoutMs });
    output.push("BUILDERX_REVIEW: PASS\n", result.outputText);
    openAIUsage = result.usage;
  } else {
    await new Promise((resolve, reject) => {
      const child = spawn(invocation.command, invocation.args, {
        cwd: generatedSiteDir,
        env: { ...(invocation.env || sanitizeAgentProcessEnv(process.env)), CI: "1", NO_COLOR: "1" },
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
        if (code === 0) {
          if (invocation.codexProfile?.id) recordCodexProfileResult(invocation.codexProfile.id, true);
          resolve();
          return;
        }
        const errorText = errors.join("").slice(-2000);
        const errorCode = invocation.codexProfile?.id ? classifyCodexError(errorText) : "";
        if (errorCode === "usage_limit") markCodexProfileUnavailable(invocation.codexProfile.id, errorCode);
        if (invocation.codexProfile?.id) recordCodexProfileResult(invocation.codexProfile.id, false);
        reject(new Error(`Independent review exited with code ${code}: ${errorText}`));
      });
    });
  }

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
    outputTokens: openAIUsage?.completion_tokens || estimateTokens(outputText),
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
