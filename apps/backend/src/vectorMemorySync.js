import crypto from "node:crypto";
import fs from "fs-extra";
import path from "node:path";
import { builderxRoot, openAiConfigFor, workspaceRoot } from "./globalAgentKnowledge.js";

const SYNC_FILE_EXTENSIONS = new Set([".md", ".txt", ".json"]);
let activeSyncPromise = null;
let lastScheduledAt = 0;

function uniquePaths(rows) {
  return [...new Set(rows.filter(Boolean).map((row) => path.resolve(row)))];
}

function redact(content = "") {
  return String(content)
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_OPENAI_KEY]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s'"`]+/gi, "$1[REDACTED]")
    .replace(/\b([A-Z0-9_]*(?:API_KEY|TOKEN|PASSWORD|SECRET))\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
    .replace(/(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s]+@/gi, "$1[REDACTED]@")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
}

function displayProjectName(projectRoot) {
  const name = path.basename(projectRoot);
  if (name === "agentic-builderX") return "Agentic BuilderX";
  if (name.toLowerCase() === "geofinderx") return "GeoFinderX";
  if (name === "orchestrator-agent-001") return "Orchestrator Agent";
  return name;
}

function syncCandidateRoots() {
  const workspace = workspaceRoot();
  const builder = builderxRoot();
  const explicit = String(process.env.AGENT_MEMORY_SYNC_ROOTS || process.env.GLOBAL_AGENT_KNOWLEDGE_ROOTS || "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return uniquePaths([
    ...explicit,
    builder,
    path.join(workspace, "apps", "geofinderx"),
    path.join(workspace, "orchestrator-agent-001"),
    "/workspace/project",
    "/workspace/money/apps/geofinderx",
    "/workspace/money/orchestrator-agent-001"
  ]);
}

function categoryFor(relativePath) {
  if (relativePath.includes("/prompts/")) return "agent_prompts";
  if (relativePath.includes("/projects/")) return "project_summaries";
  if (relativePath.includes("/corrections/")) return "correction_patterns";
  if (relativePath.includes("/upgrades/")) return "upgrade_notes";
  return "agent_knowledge";
}

function frontMatter(markdown = "") {
  const yaml = String(markdown).match(/^---\n([\s\S]*?)\n---/);
  const values = {};
  for (const line of (yaml?.[1] || "").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function attr(value, fallback = "") {
  return String(value || fallback || "").slice(0, 512);
}

async function collectKnowledgeFiles(directory) {
  const files = [];
  if (!(await fs.pathExists(directory))) return files;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectKnowledgeFiles(absolutePath)));
    if (entry.isFile() && SYNC_FILE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolutePath);
  }
  return files.sort();
}

async function readJson(filePath, fallback = {}) {
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, value, { spaces: 2 });
}

async function api(config, apiPath, init = {}) {
  const headers = { Authorization: `Bearer ${config.apiKey}`, ...(init.headers || {}) };
  if (config.orgId) headers["OpenAI-Organization"] = config.orgId;
  if (config.projectId) headers["OpenAI-Project"] = config.projectId;
  const response = await fetch(`https://api.openai.com/v1${apiPath}`, { ...init, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${body.error?.message || "request failed"}`);
  return body;
}

async function listAttachedFiles(config) {
  const rows = [];
  let after = "";
  do {
    const query = new URLSearchParams({ limit: "100", order: "asc" });
    if (after) query.set("after", after);
    const page = await api(config, `/vector_stores/${encodeURIComponent(config.vectorStoreId)}/files?${query}`);
    rows.push(...(page.data || []));
    after = page.has_more ? page.last_id : "";
  } while (after);
  return rows;
}

async function attachKnowledgeFile({ config, filePath, relativePath, projectRoot, contentHash, sanitized }) {
  const projectName = displayProjectName(projectRoot);
  const meta = frontMatter(sanitized);
  const form = new FormData();
  form.set("purpose", "assistants");
  form.set(
    "file",
    new Blob([`Source: ${relativePath}\nProject: ${projectName}\n\n${sanitized}`], { type: "text/markdown" }),
    path.basename(relativePath)
  );
  const uploaded = await api(config, "/files", { method: "POST", body: form });
  const attached = await api(config, `/vector_stores/${encodeURIComponent(config.vectorStoreId)}/files`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_id: uploaded.id,
      attributes: {
        project: projectName,
        project_name: projectName,
        agent_id: attr(meta.agent_id),
        agent_name: attr(meta.agent_name),
        version: attr(meta.version),
        domain: attr(meta.domain),
        workflow_class: attr(meta.workflow_class),
        status: attr(meta.status),
        content_type: attr(meta.content_type, categoryFor(`/${relativePath}`)),
        collection: categoryFor(`/${relativePath}`),
        source: "agentic-builderx-periodic-sync",
        source_path: relativePath.slice(0, 512),
        source_file: path.relative(workspaceRoot(), filePath).split(path.sep).join("/").slice(0, 512),
        content_sha256: contentHash,
        sync_reason: "local_memory_candidate",
        synced_by: "agentic-builderx"
      }
    })
  });
  return attached;
}

async function syncRoot({ config, projectRoot, remoteByHash }) {
  const knowledgeRoot = path.join(projectRoot, "memory", "agent-knowledge");
  const files = await collectKnowledgeFiles(knowledgeRoot);
  const syncIndexPath = path.join(projectRoot, "registry", "agents", "vector-sync-index.json");
  const index = await readJson(syncIndexPath, { provider: "openai", vector_store_id: config.vectorStoreId, files: {} });
  index.provider = "openai";
  index.vector_store_id = config.vectorStoreId;
  index.files ||= {};

  const uploaded = [];
  const skipped = [];
  const failed = [];

  for (const filePath of files) {
    const relativePath = path.relative(projectRoot, filePath).split(path.sep).join("/");
    try {
      const sanitized = redact(await fs.readFile(filePath, "utf8"));
      const contentHash = crypto.createHash("sha256").update(sanitized).digest("hex");
      const prior = index.files[relativePath];
      const remote = remoteByHash.get(contentHash);

      if ((prior?.content_sha256 === contentHash && ["completed", "in_progress"].includes(prior?.status)) || remote) {
        index.files[relativePath] = {
          content_sha256: contentHash,
          file_id: prior?.file_id || remote?.id || "",
          status: remote?.status || prior?.status || "completed",
          vector_store_id: config.vectorStoreId,
          synced_at: prior?.synced_at || new Date().toISOString()
        };
        skipped.push(relativePath);
        continue;
      }

      const attached = await attachKnowledgeFile({ config, filePath, relativePath, projectRoot, contentHash, sanitized });
      index.files[relativePath] = {
        content_sha256: contentHash,
        file_id: attached.id,
        status: attached.status || "in_progress",
        vector_store_id: config.vectorStoreId,
        synced_at: new Date().toISOString()
      };
      remoteByHash.set(contentHash, attached);
      uploaded.push(relativePath);
      await writeJson(syncIndexPath, index);
    } catch (error) {
      failed.push({ path: relativePath, error: error.message });
    }
  }

  index.last_sync_at = new Date().toISOString();
  await writeJson(syncIndexPath, index);
  return { projectRoot, projectName: displayProjectName(projectRoot), scanned: files.length, uploaded, skipped, failed };
}

async function writeSyncLogs(summary) {
  const builder = builderxRoot();
  await writeJson(path.join(builder, "observability", "agent-memory", "latest-sync.json"), summary);
  await writeJson(path.join(builder, "observability", "vector-memory", "latest-vector-write.json"), summary);
  if (summary.status === "failed" || summary.files_failed > 0) {
    await writeJson(path.join(builder, "memory", "pending-sync", `${summary.workflow_id}.vector-sync.json`), summary);
  }
}

export async function syncKnownAgentKnowledgeRoots({ reason = "manual", emit = null } = {}) {
  if (String(process.env.AGENT_MEMORY_SYNC_ENABLED || "true").toLowerCase() === "false") {
    const skipped = {
      workflow_id: `builderx-vector-sync-${Date.now()}`,
      status: "skipped",
      reason: "AGENT_MEMORY_SYNC_ENABLED=false",
      completed_at: new Date().toISOString()
    };
    await writeSyncLogs(skipped);
    return skipped;
  }

  const startedAt = new Date().toISOString();
  const workflowId = `builderx-vector-sync-${Date.now()}`;
  const config = await openAiConfigFor(path.join(workspaceRoot(), "apps", "geofinderx"));
  if (!config.apiKey || !config.vectorStoreId) {
    const summary = {
      workflow_id: workflowId,
      reason,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status: "failed",
      errors: ["Missing OPENAI_API_KEY or OPENAI_AGENT_VECTOR_STORE_ID."],
      vector_store_id: config.vectorStoreId ? `${config.vectorStoreId.slice(0, 8)}…${config.vectorStoreId.slice(-4)}` : null,
      local_files_scanned: 0,
      files_uploaded: 0,
      files_skipped: 0,
      files_failed: 0,
      pending_sync_count: 0
    };
    await writeSyncLogs(summary);
    return summary;
  }

  emit?.("vector-sync-started", "Syncing local VectorDB candidate memory to OpenAI Vector Store", { reason });
  const roots = [];
  const remote = await listAttachedFiles(config);
  const remoteByHash = new Map(remote.filter((file) => file.attributes?.content_sha256).map((file) => [file.attributes.content_sha256, file]));
  const rootResults = [];

  for (const projectRoot of syncCandidateRoots()) {
    if (!(await fs.pathExists(path.join(projectRoot, "memory", "agent-knowledge")))) continue;
    roots.push(projectRoot);
    rootResults.push(await syncRoot({ config, projectRoot, remoteByHash }));
  }

  const filesUploaded = rootResults.reduce((sum, row) => sum + row.uploaded.length, 0);
  const filesSkipped = rootResults.reduce((sum, row) => sum + row.skipped.length, 0);
  const failures = rootResults.flatMap((row) => row.failed.map((failure) => ({ ...failure, project: row.projectName })));
  const summary = {
    workflow_id: workflowId,
    reason,
    provider: "openai",
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    vector_store_id: `${config.vectorStoreId.slice(0, 8)}…${config.vectorStoreId.slice(-4)}`,
    config_source: config.configSource || null,
    scanned_roots: roots,
    local_files_scanned: rootResults.reduce((sum, row) => sum + row.scanned, 0),
    files_uploaded: filesUploaded,
    files_skipped: filesSkipped,
    files_failed: failures.length,
    pending_sync_count: failures.length,
    status: failures.length ? "partial" : "success",
    errors: failures,
    roots: rootResults.map((row) => ({
      project: row.projectName,
      scanned: row.scanned,
      uploaded: row.uploaded,
      skipped: row.skipped,
      failed: row.failed
    }))
  };
  await writeSyncLogs(summary);
  emit?.(summary.status === "success" ? "vector-sync-complete" : "vector-sync-partial", `Vector memory sync ${summary.status}: ${filesUploaded} uploaded, ${filesSkipped} unchanged`, {
    reason,
    filesUploaded,
    filesSkipped,
    filesFailed: failures.length
  });
  return summary;
}

export function scheduleAgentMemorySync({ reason = "periodic", emit = null, minSpacingMs = 60_000 } = {}) {
  const now = Date.now();
  if (activeSyncPromise) return activeSyncPromise;
  if (now - lastScheduledAt < minSpacingMs) return Promise.resolve(null);
  lastScheduledAt = now;
  activeSyncPromise = syncKnownAgentKnowledgeRoots({ reason, emit })
    .catch(async (error) => {
      const summary = {
        workflow_id: `builderx-vector-sync-${Date.now()}`,
        reason,
        status: "failed",
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        errors: [error.message],
        local_files_scanned: 0,
        files_uploaded: 0,
        files_skipped: 0,
        files_failed: 1,
        pending_sync_count: 1
      };
      await writeSyncLogs(summary);
      emit?.("vector-sync-failed", error.message, { reason });
      return summary;
    })
    .finally(() => {
      activeSyncPromise = null;
    });
  return activeSyncPromise;
}
