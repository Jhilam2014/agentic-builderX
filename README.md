# Agentic BuilderX

Agentic BuilderX is a containerized webpage builder. The frontend collects instructions, the backend exposes generation endpoints, and the generated webpage runs in a separate Vite container for live preview.

## Services

- `frontend`: React control surface at `http://localhost:5173`.
- `backend`: Node/Express API at `http://localhost:8080`.
- `generated-site`: isolated generated webpage preview at `http://localhost:5174`.

## Run

```bash
./run.sh
```

Or run Compose directly:

```bash
docker compose up --build
```

Then open `http://localhost:5173`.

Useful runner commands:

```bash
./run.sh --status
./run.sh --logs
./run.sh --stop
```

## Generate

Submit an instruction in the BuilderX chat. The frontend sends it to the backend workflow endpoint, where the BuilderX orchestrator agent first restructures the raw instruction into a safer build request. The backend writes React source into `apps/generated-site/src/generated`, then the generated app refreshes through Vite hot reload by default.

## Codex MCP

BuilderX no longer exposes a local `/mcp` server. Use the real Codex MCP integration from Codex itself, for example:

```bash
codex mcp-server
```

BuilderX uses `POST /api/generate` for its Run workflow action and reports `codexMcp: external` from `GET /api/status`.
Inside Docker, the backend image installs the current Codex CLI package and mounts `${HOME}/.codex` at `/workspace/codex-home`, so `Run workflow` uses your authenticated Codex configuration. If Codex completes without changing generated-site files, the request fails instead of falling back to local code generation.

Every generation response includes `orchestrated`, which shows the orchestrator agent's normalized objective, page type, topic, audience, tone, sections, constraints, and handoff metadata.

## Generated App Restart

By default, BuilderX uses the generated app's Vite hot reload after each successful generation. This avoids browser `ERR_CONNECTION_RESET` and WebSocket errors while the preview iframe is open. If you need a hard generated-site container restart, set `RESTART_GENERATED_CONTAINER=true`; the backend container already mounts `/var/run/docker.sock` and can restart `agentic-builderx-generated-site` through Docker's local API. If the socket is unavailable, generation still succeeds and the response reports the skipped restart status.

## MCP Runtime Log

Generation status is visible directly inside the BuilderX chat. The chat combines user instruction bubbles with runtime process bubbles, keeps the latest 400 rows with the newest event at the top, and polls the backend log endpoint in addition to the live event stream. Chat timestamps are formatted in IST only.

Major workflow events also appear in the right-side `Activity log` and `Codex runtime log` cards. Events from the current workflow session are highlighted in light green.

The center `Playground` keeps the generated webpage in a standard 16:9 preview by default. Use `Fit screen` to stretch the preview into the available space.

The `Open Agentic System D3` button opens a D3 graph of the active agent, functionality clusters, child features, services, memory nodes, Neo4j artifacts, and human review node.

You can also inspect the same data directly:

```bash
curl http://localhost:8080/api/runtime-log
tail -f runtime/workflow-runtime-log.jsonl
```

The log records `request-received`, `orchestrated`, `file-plan`, `generating`, `files-applied`, `restarted`, and `generated`.
Detailed process rows also include build start, workspace resolution, individual file-operation start/done events, code generation completion, and runtime refresh status so the panel behaves like a live development task log.

## Generated App File Operations

The generator now applies an orchestrator file-operation plan instead of only rewriting one component. Each request can:

- `add` generated support files such as `catalogData.js`
- `modify` React, CSS, and metadata files
- `delete` obsolete generated modules

For example, a bag-business instruction generates a commerce landing page with a product catalog, material story, buying workflow, metadata, and a generated handoff README.
