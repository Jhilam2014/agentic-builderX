import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Code2,
  ExternalLink,
  Loader2,
  Maximize2,
  MonitorSmartphone,
  PanelRight,
  Play,
  Plus,
  Radio,
  RefreshCcw,
  Server,
  Sparkles,
  TerminalSquare,
  UserRound
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";
const GENERATED_SITE_URL = import.meta.env.VITE_GENERATED_SITE_URL || "http://localhost:5174";
const MAX_RUNTIME_LOG_ROWS = 400;

const starterPrompt =
  "Create a premium SaaS homepage for an AI finance analyst product. Include a confident hero, KPI strip, product workflow, pricing teaser, and a polished CTA.";
const majorEventTypes = new Set([
  "queued",
  "request-received",
  "instruction-received",
  "orchestrated",
  "file-plan",
  "operation-plan",
  "build-start",
  "codex-start",
  "codex-progress",
  "codex-complete",
  "files-applied",
  "runtime-refresh-requested",
  "hot-reload",
  "restarted",
  "generated",
  "error",
  "log-disconnected"
]);
const istTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Kolkata"
});

function formatIstTime(value = new Date()) {
  return `${istTimeFormatter.format(new Date(value))} IST`;
}

function StatusPill({ status }) {
  const tone = status === "online" ? "online" : status === "working" ? "working" : "offline";
  return <span className={`status-pill ${tone}`}>{status}</span>;
}

function EventRow({ event, sessionStartedAt }) {
  const isCurrentSession = sessionStartedAt && new Date(event.createdAt || 0).getTime() >= sessionStartedAt;
  return (
    <li className={`event-row ${isCurrentSession ? "current-session" : ""} ${event.progressGroup ? "codex-progress-row" : ""}`}>
      <span className="event-dot" />
      <div>
        <strong>{event.type}</strong>
        <p>{event.message}</p>
        {event.progressGroup ? (
          <>
            <span className="event-progress-track" />
            <span className="event-progress-label">{event.repeatCount} Codex progress updates grouped</span>
          </>
        ) : null}
      </div>
      <time>{formatIstTime(event.createdAt)}</time>
    </li>
  );
}

function ChatMessage({ event }) {
  const detailParts = [event.stage, event.path, event.buildId ? `build ${String(event.buildId).replace("build_", "")}` : null].filter(Boolean);
  const isUser = event.role === "user";
  const isCurrentSession = event.currentSession;
  return (
    <li className={`chat-message ${isUser ? "user-message" : "codex-message"} ${isCurrentSession ? "current-session" : ""} ${event.type || ""}`}>
      <div className="chat-avatar">{isUser ? <UserRound size={15} /> : <Bot size={15} />}</div>
      <div className="chat-bubble">
        <div className="chat-meta">
          <strong>{isUser ? "You" : event.type || "codex"}</strong>
          <time>{formatIstTime(event.createdAt)}</time>
        </div>
        <p>{event.message}</p>
        {detailParts.length ? <small>{detailParts.join(" · ")}</small> : null}
      </div>
    </li>
  );
}

function normalizeRuntimeRows(rows) {
  const seen = new Set();
  return rows
    .filter(Boolean)
    .map((row) => ({
      ...row,
      createdAt: row.createdAt || new Date().toISOString(),
      time: formatIstTime(row.createdAt || Date.now())
    }))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .filter((row) => {
      const key = row.id || `${row.createdAt}-${row.type}-${row.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_RUNTIME_LOG_ROWS);
}

function mergeRuntimeRows(nextRows, currentRows = []) {
  return normalizeRuntimeRows([...(nextRows || []), ...currentRows]);
}

function markCurrentSession(rows, sessionStartedAt) {
  if (!sessionStartedAt) return rows;
  return rows.map((row) => ({
    ...row,
    currentSession: new Date(row.createdAt || 0).getTime() >= sessionStartedAt
  }));
}

function collapseCodexProgressRows(rows) {
  const collapsed = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.type !== "codex-progress" || rows[index + 1]?.type !== "codex-progress") {
      collapsed.push(row);
      continue;
    }

    let repeatCount = 1;
    while (rows[index + repeatCount]?.type === "codex-progress") {
      repeatCount += 1;
    }
    collapsed.push({
      ...row,
      id: `codex-progress-group-${row.id || row.createdAt}`,
      message: "Codex is working...",
      progressGroup: true,
      repeatCount
    });
    index += repeatCount - 1;
  }
  return collapsed;
}

export default function App() {
  const [instruction, setInstruction] = useState(starterPrompt);
  const [backendStatus, setBackendStatus] = useState("offline");
  const [mcpStatus, setMcpStatus] = useState("offline");
  const [generatedStatus, setGeneratedStatus] = useState("ready");
  const [events, setEvents] = useState([]);
  const [runtimeLogs, setRuntimeLogs] = useState([]);
  const [chatPrompts, setChatPrompts] = useState([]);
  const [lastBuild, setLastBuild] = useState(null);
  const [isGenerating, setGenerating] = useState(false);
  const [projectName, setProjectName] = useState("Bag commerce studio");
  const [projectResult, setProjectResult] = useState(null);
  const [isCreatingProject, setCreatingProject] = useState(false);
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [fitPreview, setFitPreview] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);

  const canSubmit = instruction.trim().length > 12 && !isGenerating;
  const canCreateProject = projectName.trim().length > 1 && !isCreatingProject;

  const metrics = useMemo(
    () => [
      { label: "Runtime", value: generatedStatus === "ready" ? "Live" : "Building" },
      { label: "Backend", value: backendStatus === "online" ? "Online" : "Offline" },
      { label: "Codex MCP", value: mcpStatus === "online" ? "External" : "Offline" },
      { label: "Orchestrator", value: lastBuild?.orchestrated?.pageType ? "Structured" : "Ready" },
      { label: "Last build", value: lastBuild?.buildId ? lastBuild.buildId.slice(-6) : "None" }
    ],
    [backendStatus, generatedStatus, lastBuild, mcpStatus]
  );
  const chatMessages = useMemo(
    () => markCurrentSession(normalizeRuntimeRows([...runtimeLogs, ...chatPrompts]).slice(0, MAX_RUNTIME_LOG_ROWS), sessionStartedAt),
    [chatPrompts, runtimeLogs, sessionStartedAt]
  );
  const majorEvents = useMemo(
    () =>
      collapseCodexProgressRows(
        markCurrentSession(normalizeRuntimeRows(runtimeLogs.filter((event) => majorEventTypes.has(event.type))).slice(0, 18), sessionStartedAt)
      ),
    [runtimeLogs, sessionStartedAt]
  );

  useEffect(() => {
    let cancelled = false;
    async function checkHealth() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/status`);
        const data = await res.json();
        if (!cancelled) {
          setBackendStatus(data.status === "ok" ? "online" : "offline");
          setMcpStatus(data.codexMcp === "external" ? "online" : "offline");
        }
      } catch {
        if (!cancelled) {
          setBackendStatus("offline");
          setMcpStatus("offline");
        }
      }
    }
    checkHealth();
    const id = setInterval(checkHealth, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let source;
    let reconnectTimer;
    let pollTimer;

    async function loadRuntimeLog() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/runtime-log`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data.logs)) {
          setRuntimeLogs((current) => mergeRuntimeRows(data.logs, current));
        }
      } catch {
        if (!cancelled) {
          const errorRow = {
            id: `runtime-log-error-${Date.now()}`,
            type: "log-disconnected",
            message: "Runtime log endpoint is not reachable yet.",
            createdAt: new Date().toISOString(),
            time: formatIstTime()
          };
          setRuntimeLogs((current) => mergeRuntimeRows([errorRow], current));
        }
      }
    }

    function connect() {
      source = new EventSource(`${BACKEND_URL}/api/events`);
      source.onmessage = (message) => {
        const event = JSON.parse(message.data);
        setEvents((current) => [event, ...current].slice(0, 8));
        setRuntimeLogs((current) => mergeRuntimeRows([event], current));
        if (event.type === "generated") {
          setGeneratedStatus("ready");
          setPreviewKey(Date.now());
        }
        if (
          [
            "request-received",
            "orchestrated",
            "file-plan",
            "generating",
            "codex-start",
            "codex-progress",
            "build-start",
            "files-written",
            "files-applied",
            "runtime-refresh-requested",
            "restarted"
          ].includes(event.type)
        ) {
          setGeneratedStatus("working");
        }
      };
      source.onerror = () => {
        source.close();
        if (!cancelled) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
    }

    loadRuntimeLog();
    pollTimer = window.setInterval(loadRuntimeLog, 1500);
    connect();
    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearTimeout(reconnectTimer);
      if (source) source.close();
    };
  }, []);

  async function generatePage() {
    if (!canSubmit) return;
    const startedAt = Date.now();
    setSessionStartedAt(startedAt);
    const queuedEvent = {
      id: `queued-${Date.now()}`,
      type: "queued",
      message: "Run workflow clicked. Sending instruction to Codex MCP workflow...",
      createdAt: new Date(startedAt).toISOString(),
      time: formatIstTime()
    };
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      type: "instruction",
      message: instruction.trim(),
      createdAt: new Date(startedAt).toISOString(),
      time: formatIstTime()
    };
    setChatPrompts((current) => normalizeRuntimeRows([userMessage, ...current]));
    setEvents((current) => [queuedEvent, ...current].slice(0, 8));
    setRuntimeLogs((current) => mergeRuntimeRows([queuedEvent], current));
    setGenerating(true);
    setGeneratedStatus("working");
    try {
      const res = await fetch(`${BACKEND_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruction })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Codex MCP workflow failed");
      setLastBuild(data);
      setPreviewKey(Date.now());
    } catch (error) {
      const errorEvent = {
        id: `error-${Date.now()}`,
        type: "error",
        message: error.message,
        createdAt: new Date().toISOString(),
        time: formatIstTime()
      };
      setEvents((current) => [errorEvent, ...current].slice(0, 8));
      setRuntimeLogs((current) => mergeRuntimeRows([errorEvent], current));
    } finally {
      setGenerating(false);
      setGeneratedStatus("ready");
    }
  }

  async function createNewProject() {
    if (!canCreateProject) return;
    setCreatingProject(true);
    setGeneratedStatus("working");
    setProjectResult({ status: "running", projectName: projectName.trim(), previewUrl: GENERATED_SITE_URL });
    try {
      const res = await fetch(`${BACKEND_URL}/api/projects/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          instruction: instruction.trim().length > 12 ? instruction.trim() : undefined
        })
      });
      const data = await res.json();
      setProjectResult(data);
      if (!res.ok) throw new Error(data.error || "Project creation failed");
      setPreviewKey(Date.now());
    } catch (error) {
      setProjectResult((current) => ({
        ...(current || { projectName: projectName.trim(), previewUrl: GENERATED_SITE_URL }),
        status: "failed",
        error: error.message
      }));
    } finally {
      setCreatingProject(false);
      setGeneratedStatus("ready");
    }
  }

  return (
    <main className="app-shell">
      <section className="preview-panel">
        <header className="preview-toolbar">
          <div className="preview-title">
            <MonitorSmartphone size={20} />
            <div>
              <h2>Playground</h2>
              <p>{GENERATED_SITE_URL}</p>
            </div>
          </div>
          <div className="toolbar-actions">
            <button className="text-button" onClick={() => setFitPreview((value) => !value)}>
              <Maximize2 size={16} />
              {fitPreview ? "Keep aspect" : "Fit screen"}
            </button>
            <button className="icon-button" onClick={() => setPreviewKey(Date.now())} title="Reload preview">
              <RefreshCcw size={18} />
            </button>
            <a className="icon-button" href={GENERATED_SITE_URL} target="_blank" rel="noreferrer" title="Open preview">
              <ExternalLink size={18} />
            </a>
          </div>
        </header>

        <div className={`preview-stage ${fitPreview ? "fit-preview" : ""}`}>
          <div className="preview-frame-wrap">
            <iframe key={previewKey} title="Generated webpage preview" src={GENERATED_SITE_URL} />
          </div>
        </div>

        <footer className="build-footer">
          <div>
            <CheckCircle2 size={18} />
            <span>Shared generated-site volume with Vite hot reload</span>
          </div>
          <div>
            <Code2 size={18} />
            <span>{lastBuild?.files?.length ? `${lastBuild.files.length} files updated` : "Ready to generate"}</span>
          </div>
          <div>
            <Play size={18} />
            <span>Containerized preview</span>
          </div>
        </footer>
      </section>

      <aside className="control-panel">
        <div className="brand-row">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <h1>Agentic BuilderX</h1>
            <p>Professional webpage generation cockpit</p>
          </div>
        </div>

        <section className="composer chat-card">
          <div className="section-heading">
            <TerminalSquare size={18} />
            <h2>Codex Builder chat</h2>
          </div>
          <div className="project-onboarding">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
            />
            <button className="new-project-action" onClick={createNewProject} disabled={!canCreateProject}>
              {isCreatingProject ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              New project
            </button>
          </div>
          {projectResult ? (
            <div className={`project-status ${projectResult.status || ""}`}>
              <strong>{projectResult.projectName}</strong>
              <span>
                {projectResult.status === "succeeded"
                  ? `Preview ready in ${projectResult.container}`
                  : projectResult.error || "Generating project..."}
              </span>
            </div>
          ) : null}
          <ol className="chat-thread">
            {chatMessages.length ? (
              chatMessages.map((event) => <ChatMessage key={event.id || `${event.type}-${event.createdAt}`} event={event} />)
            ) : (
              <li className="empty-state">Send an instruction to start the Codex workflow conversation.</li>
            )}
          </ol>
          <div className="chat-input-shell">
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="Ask BuilderX to create or modify the generated webpage..."
            />
          </div>
          <p className="orchestrator-note">
            Showing the latest {MAX_RUNTIME_LOG_ROWS} Codex workflow events with IST timestamps.
          </p>
          <div className="composer-actions">
            <button className="primary-action" onClick={generatePage} disabled={!canSubmit}>
              {isGenerating ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              Run workflow
            </button>
            <button className="ghost-action" onClick={() => setPreviewKey(Date.now())}>
              <RefreshCcw size={18} />
              Refresh
            </button>
          </div>
        </section>

        <section className="status-grid">
          {metrics.map((metric) => (
            <div className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </section>

        <section className="system-card">
          <div className="section-heading">
            <Server size={18} />
            <h2>Runtime</h2>
          </div>
          <div className="runtime-row">
            <span>Backend API</span>
            <StatusPill status={backendStatus} />
          </div>
          <div className="runtime-row">
            <span>Codex MCP</span>
            <StatusPill status={mcpStatus} />
          </div>
          <div className="runtime-row">
            <span>Generated site</span>
            <StatusPill status={generatedStatus} />
          </div>
        </section>

        <section className="activity-card">
          <div className="section-heading">
            <Activity size={18} />
            <h2>Activity log</h2>
          </div>
          <ol>
            {majorEvents.length ? (
              majorEvents.map((event) => <EventRow key={`activity-${event.id || event.createdAt}`} event={event} sessionStartedAt={sessionStartedAt} />)
            ) : (
              <li className="empty-state">Major activity events will appear here.</li>
            )}
          </ol>
        </section>

        <section className="runtime-log-card">
          <div className="section-heading">
            <Radio size={18} />
            <h2>Codex runtime log</h2>
          </div>
          <ol>
            {majorEvents.length ? (
              majorEvents.map((event) => <EventRow key={`codex-${event.id || event.createdAt}`} event={event} sessionStartedAt={sessionStartedAt} />)
            ) : (
              <li className="empty-state">Major Codex runtime events will appear here.</li>
            )}
          </ol>
        </section>

        <a className="agentic-link" href="/agentic-system/d3/index.html" target="_blank" rel="noreferrer">
          <PanelRight size={16} />
          Open Agentic System D3
        </a>
      </aside>
    </main>
  );
}
