import cors from "cors";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { runCodexWorkflow } from "./codexWorkflow.js";
import { generateWebpage } from "./generator.js";
import { orchestrateBuilderInstruction } from "./orchestratorAgent.js";
import { restartGeneratedRuntime } from "./runtimeRestart.js";

const app = express();
const port = Number(process.env.PORT || 8080);
const clients = new Set();
const runtimeLog = [];
const runtimeLogPath =
  process.env.WORKFLOW_RUNTIME_LOG_PATH || process.env.MCP_RUNTIME_LOG_PATH || "/workspace/runtime/workflow-runtime-log.jsonl";
const MAX_RUNTIME_LOG_ROWS = 400;
const previewUrl = process.env.GENERATED_SITE_URL || "http://localhost:5174";
const istTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata"
});

const GenerateSchema = z.object({
  instruction: z.string().min(12).max(8000)
});
const NewProjectSchema = z.object({
  name: z.string().min(2).max(80),
  instruction: z.string().min(12).max(8000).optional()
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
  event("project-create-start", `Creating project ${parsed.data.name}`, {
    projectName: parsed.data.name,
    container: process.env.GENERATED_SITE_CONTAINER || "agentic-builderx-generated-site"
  });

  try {
    const orchestrated = orchestrateBuilderInstruction(projectInstruction);
    const result = await generateWebpage(orchestrated.structuredRequest, { emit: event });
    const restart = await restartGeneratedRuntime();
    event("project-created", `Project ${parsed.data.name} generated into preview container`, {
      projectName: parsed.data.name,
      buildId: result.buildId,
      restart
    });
    return res.json({
      status: "succeeded",
      projectName: parsed.data.name,
      container: process.env.GENERATED_SITE_CONTAINER || "agentic-builderx-generated-site",
      previewUrl,
      buildId: result.buildId,
      changedFiles: result.files?.map((file) => file.path || file).filter(Boolean) || [],
      restart
    });
  } catch (error) {
    event("project-create-failed", error.message, { projectName: parsed.data.name });
    return res.status(500).json({
      status: "failed",
      projectName: parsed.data.name,
      previewUrl,
      error: error.message
    });
  }
});

app.post("/api/generate", async (req, res) => {
  const parsed = GenerateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Instruction must be between 12 and 8000 characters."
    });
  }

  const orchestrated = orchestrateBuilderInstruction(parsed.data.instruction);
  event("request-received", "Codex MCP workflow request received", { stage: "1/8" });
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
  event("generating", "Running current Codex CLI against generated-site workspace", { stage: "5/8" });
  try {
    const result = await runCodexWorkflow(orchestrated.structuredRequest, { emit: event });
    event("files-applied", `Codex changed ${result.files.length} generated app files`, {
      stage: "6/8",
      fileOperations: result.fileOperations
    });
    event("runtime-refresh-requested", "Refreshing generated-site runtime after file operations", { stage: "7/8" });
    const restart = await restartGeneratedRuntime();
    event(restart.status === "restarted" ? "restarted" : "hot-reload", restart.reason || `Restarted ${restart.container}`, {
      stage: "7/8",
      restart
    });
    event("generated", `Generated ${result.files.length} files`, {
      stage: "8/8",
      buildId: result.buildId
    });
    return res.json({ ...result, restart, orchestrated: orchestrated.structuredRequest });
  } catch (error) {
    event("error", error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.use((err, _req, res, _next) => {
  res.status(500).json({ error: err.message || "Unexpected server error" });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`Agentic BuilderX backend listening on ${port}`);
});
