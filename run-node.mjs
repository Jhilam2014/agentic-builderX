#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

function usage() {
  console.log(`Agentic BuilderX Node/npm runner (no Docker)

Usage:
  node run-node.mjs               Install if needed and start all services
  node run-node.mjs --install     Refresh npm dependencies before starting
  node run-node.mjs --no-install  Start without installing dependencies
  node run-node.mjs --status      Check local service endpoints
  node run-node.mjs --help        Show this help

Stop a running foreground session with Ctrl+C.`);
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const sourceLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = sourceLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

function commandAvailable(command) {
  const result = spawnSync(command, ["--version"], { stdio: "ignore", timeout: 5000 });
  return !result.error && result.status === 0;
}

function ensureNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) throw new Error(`Node.js 20 or newer is required; found ${process.version}.`);
  if (!commandAvailable(npmCommand)) throw new Error("npm is required but was not found on PATH.");
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => server.close(() => resolve(true)));
  });
}

async function endpointReady(url, attempts = 90) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return true;
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function printStatus(urls) {
  let healthy = true;
  for (const [name, url] of urls) {
    const ready = await endpointReady(url, 1);
    console.log(`${ready ? "ready" : "offline"}  ${name.padEnd(16)} ${url}`);
    healthy &&= ready;
  }
  process.exitCode = healthy ? 0 : 1;
}

function installDependencies(force) {
  if (!force && dependenciesHealthy()) return;
  if (!dependenciesHealthy()) {
    console.log("Removing an incomplete or non-portable node_modules installation...");
    for (const candidate of [
      path.join(root, "node_modules"),
      path.join(root, "apps", "frontend", "node_modules"),
      path.join(root, "apps", "backend", "node_modules"),
      path.join(root, "apps", "generated-site", "node_modules")
    ]) {
      fs.rmSync(candidate, { recursive: true, force: true });
    }
  }
  console.log("Installing workspace dependencies with npm...");
  const result = spawnSync(npmCommand, ["install", "--include=optional", "--no-audit", "--no-fund"], {
    cwd: root,
    stdio: "inherit",
    env: process.env
  });
  if (result.status !== 0) throw new Error("npm install failed.");
}

function dependenciesHealthy() {
  const vitePackage = path.join(root, "node_modules", "vite", "package.json");
  const expressPackage = path.join(root, "node_modules", "express", "package.json");
  if (!fs.existsSync(vitePackage) || !fs.existsSync(expressPackage)) return false;
  if (process.platform === "win32") return fs.existsSync(path.join(root, "node_modules", ".bin", "vite.cmd"));
  try {
    return fs.lstatSync(path.join(root, "node_modules", ".bin", "vite")).isSymbolicLink();
  } catch {
    return false;
  }
}

function startService(name, prefix, script, extraArgs, env) {
  const child = spawn(npmCommand, ["--prefix", prefix, "run", script, ...extraArgs], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const write = (stream, chunk) => {
    for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) stream.write(`[${name}] ${line}\n`);
  };
  child.stdout.on("data", (chunk) => write(process.stdout, chunk));
  child.stderr.on("data", (chunk) => write(process.stderr, chunk));
  child.on("exit", (code, signal) => {
    if (!stopping && code !== 0) {
      console.error(`[${name}] exited unexpectedly (${signal || code}).`);
      shutdown(1);
    }
  });
  return child;
}

if (args.has("--help") || args.has("-h")) {
  usage();
  process.exit(0);
}

loadEnv(path.join(root, ".env"));
ensureNodeVersion();

const frontendPort = Number(process.env.FRONTEND_PORT || 5173);
const backendPort = Number(process.env.BACKEND_PORT || 8080);
const generatedPort = Number(process.env.GENERATED_SITE_PORT || 5174);
const urls = [
  ["BuilderX", `http://localhost:${frontendPort}`],
  ["Backend API", `http://localhost:${backendPort}/api/status`],
  ["Generated site", `http://localhost:${generatedPort}`]
];

if (args.has("--status")) {
  await printStatus(urls);
  process.exit();
}

if (!args.has("--no-install")) {
  installDependencies(args.has("--install") || !dependenciesHealthy());
} else if (!dependenciesHealthy()) {
  throw new Error("Dependencies are missing or non-portable. Remove --no-install to perform a clean npm install.");
}

const runtimeRoot = path.join(root, "runtime");
// Docker registry entries may contain container-only paths such as /workspace.
// Isolating process-mode state makes the Node runner portable between machines.
const nodeRuntimeRoot = path.join(runtimeRoot, "node");
const localEnv = {
  ...process.env,
  NODE_ENV: "development",
  PORT: String(backendPort),
  FRONTEND_PORT: String(frontendPort),
  BACKEND_PORT: String(backendPort),
  GENERATED_SITE_PORT: String(generatedPort),
  VITE_BACKEND_URL: `http://localhost:${backendPort}`,
  VITE_GENERATED_SITE_URL: `http://localhost:${generatedPort}`,
  GENERATED_SITE_URL: `http://localhost:${generatedPort}`,
  GENERATED_SITE_INTERNAL_URL: `http://localhost:${generatedPort}`,
  GENERATED_SITE_DIR: path.join(root, "apps", "generated-site"),
  PROJECT_RUNTIME_MODE: "process",
  PROJECT_HOST_URL: "http://localhost",
  PROJECTS_ROOT: path.join(nodeRuntimeRoot, "projects"),
  PROJECTS_REGISTRY_PATH: path.join(nodeRuntimeRoot, "projects.json"),
  PROJECT_EXPORTS_ROOT: path.join(nodeRuntimeRoot, "exports"),
  PROJECTS_GITIGNORE_PATH: path.join(nodeRuntimeRoot, "projects.gitignore"),
  WORKFLOW_RUNTIME_LOG_PATH: path.join(nodeRuntimeRoot, "workflow-runtime-log.jsonl"),
  BUILDERX_PROJECT_ROOT: root,
  BUILDERX_WORKSPACE_ROOT: root,
  ORCHESTRATOR_ARCHIVE_PATH: process.env.ORCHESTRATOR_ARCHIVE_PATH || path.join(root, "orchestrator-temp", "orchestrator-agent-001-main.zip"),
  RESTART_GENERATED_CONTAINER: "false"
};

if (!process.env.AI_CLI_PROVIDER) {
  if (commandAvailable("codex")) localEnv.AI_CLI_PROVIDER = "codex";
  else if (commandAvailable("claude")) localEnv.AI_CLI_PROVIDER = "claude";
  else localEnv.AI_CLI_PROVIDER = "auto";
}

for (const port of [frontendPort, backendPort, generatedPort]) {
  if (!(await portAvailable(port))) {
    throw new Error(`Port ${port} is already in use. Stop the existing process or choose another port in .env.`);
  }
}
fs.mkdirSync(nodeRuntimeRoot, { recursive: true });

let stopping = false;
const children = [];
function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 350).unref();
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

children.push(startService("backend", "apps/backend", "start", [], localEnv));
children.push(startService("generated", "apps/generated-site", "dev", ["--", "--host", "0.0.0.0", "--port", String(generatedPort)], localEnv));
children.push(startService("frontend", "apps/frontend", "dev", ["--", "--host", "0.0.0.0", "--port", String(frontendPort)], localEnv));

console.log(`Starting Agentic BuilderX without Docker (${localEnv.AI_CLI_PROVIDER} agent CLI mode)...`);
const readiness = await Promise.all(urls.map(([, url]) => endpointReady(url)));
if (readiness.some((ready) => !ready)) {
  console.error("One or more services did not become ready.");
  shutdown(1);
} else {
  console.log(`\nAgentic BuilderX is running without Docker.

Frontend:       ${urls[0][1]}
Backend API:    ${urls[1][1]}
Generated site: ${urls[2][1]}
Agent CLI:      ${localEnv.AI_CLI_PROVIDER}

Press Ctrl+C to stop all services.`);
}
