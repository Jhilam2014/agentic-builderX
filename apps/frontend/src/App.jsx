import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  CheckCircle2,
  Code2,
  Database,
  Download,
  ExternalLink,
  FolderUp,
  Gauge,
  Loader2,
  Monitor,
  Maximize2,
  MonitorSmartphone,
  MousePointer2,
  PanelRight,
  Palette,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Tablet,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  X
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";
const GENERATED_SITE_URL = import.meta.env.VITE_GENERATED_SITE_URL || "http://localhost:5174";
const MAX_RUNTIME_LOG_ROWS = 400;

const starterPrompt = "";
const taskTypeOptions = [
  { id: "Simple", label: "Simple", tone: "simple" },
  { id: "Medium", label: "Medium", tone: "medium" },
  { id: "Large", label: "Large", tone: "large" }
];
const activityFilters = [
  { id: "all", label: "All" },
  { id: "instructions", label: "Instructions" },
  { id: "codex", label: "Gotham status" },
  { id: "runtime", label: "Runtime" },
  { id: "errors", label: "Errors" }
];
const themeOptions = [
  { id: "light", label: "Lighter" },
  { id: "dark", label: "Darker" },
  { id: "system", label: "System" }
];
const devicePresets = [
  { id: "phone", label: "Phone", icon: Smartphone, width: 390, height: 844 },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 820, height: 1180 },
  { id: "laptop", label: "Laptop", icon: MonitorSmartphone, width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", icon: Monitor, width: 1440, height: 900 }
];
const colorPalettes = [
  { name: "Teal Console", colors: ["#222831", "#393E46", "#00ADB5", "#EEEEEE"], url: "https://colorhunt.co/palette/222831393e4600adb5eeeeee" },
  { name: "Crimson Night", colors: ["#000000", "#3D0000", "#950101", "#FF0000"], url: "https://colorhunt.co/palette/0000003d0000950101ff0000" },
  { name: "Blue Depth", colors: ["#1B262C", "#0F4C75", "#3282B8", "#BBE1FA"], url: "https://colorhunt.co/palette/1b262c0f4c753282b8bbe1fa" },
  { name: "Navy Glass", colors: ["#0B2447", "#19376D", "#576CBC", "#A5D7E8"], url: "https://colorhunt.co/palette/0b244719376d576cbca5d7e8" },
  { name: "Deep Mint", colors: ["#2C3333", "#2E4F4F", "#0E8388", "#CBE4DE"], url: "https://colorhunt.co/palette/2c33332e4f4f0e8388cbe4de" },
  { name: "Signal Slate", colors: ["#121212", "#30475E", "#F05454", "#F5F5F5"], url: "https://colorhunt.co/palette/12121230475ef05454f5f5f5" }
];
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

function gothamText(value) {
  return String(value ?? "")
    .replaceAll("Codex", "Gotham")
    .replaceAll("codex", "gotham");
}

function displayEventType(value) {
  return gothamText(value).replaceAll(/[_-]/g, " ");
}

function EventRow({ event, sessionStartedAt }) {
  const isCurrentSession = sessionStartedAt && new Date(event.createdAt || 0).getTime() >= sessionStartedAt;
  const isPromptEvent = ["instruction", "orchestrator-prompt"].includes(event.type);
  return (
    <li className={`event-row ${isCurrentSession ? "current-session" : ""} ${event.progressGroup ? "codex-progress-row" : ""}`}>
      <span className="event-dot" />
      <div>
        <strong>{displayEventType(event.type)}</strong>
        {isPromptEvent ? <pre>{gothamText(event.message)}</pre> : <p>{gothamText(event.message)}</p>}
        {event.progressGroup ? (
          <>
            <span className="event-progress-track" />
            <span className="event-progress-label">{event.repeatCount} Gotham progress updates grouped</span>
          </>
        ) : null}
        {event.promptTarget || event.taskType ? (
          <small className="event-detail">
            {[event.promptTarget, event.taskType ? `Task Type: ${event.taskType}` : null].filter(Boolean).join(" · ")}
          </small>
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
          <strong>{isUser ? "You" : displayEventType(event.type || "gotham")}</strong>
          <time>{formatIstTime(event.createdAt)}</time>
        </div>
        <p>{gothamText(event.message)}</p>
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
      message: "Gotham is working...",
      progressGroup: true,
      repeatCount
    });
    index += repeatCount - 1;
  }
  return collapsed;
}

function activityCategory(event) {
  if (["instruction", "orchestrator-prompt", "project-instruction-start", "project-orchestrator-direct", "child-project-handoff"].includes(event.type)) {
    return "instructions";
  }
  if (String(event.type || "").startsWith("codex") || ["request-received", "orchestrated", "file-plan", "file-plan-item", "generating", "files-applied"].includes(event.type)) {
    return "codex";
  }
  if (["generated", "hot-reload", "restarted", "runtime-refresh-requested", "project-runtime-ready", "project-selected", "project-runtime-handoff"].includes(event.type)) {
    return "runtime";
  }
  if (["error", "log-disconnected", "project-create-failed", "project-select-failed", "project-import-failed"].includes(event.type)) {
    return "errors";
  }
  return "runtime";
}

function scoreTone(value) {
  if (value >= 70) return "strong";
  if (value >= 50) return "steady";
  return "low";
}

function vectorLabel(vector) {
  if (vector?.status === "completed") return "OpenAI confirmed";
  if (vector?.status === "pending") return "Vector pending";
  if (vector?.status) return vector.status.replace(/_/g, " ");
  return "Local only";
}

function agentKnowledgeText(agent) {
  return (
    agent.instructionSummary ||
    agent.objective ||
    agent.reuseGuidance ||
    agent.deliverablePatterns ||
    "No knowledge summary recorded yet."
  );
}

function hasAgentMemory(agent) {
  return Boolean(agent?.vectorMemoryContent || agent?.sourceReferences?.length || agent?.vector?.file_id);
}

function markdownSections(markdown = "") {
  const text = String(markdown || "").trim();
  if (!text) return [];
  const sections = [];
  let body = text;
  const frontMatter = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (frontMatter) {
    sections.push({ title: "Metadata", content: frontMatter[1].trim(), level: 0 });
    body = body.slice(frontMatter[0].length);
  }
  const headingPattern = /^(#{1,4})\s+(.+)$/gm;
  const headings = [...body.matchAll(headingPattern)];
  if (!headings.length) {
    sections.push({ title: "Content", content: body.trim(), level: 1 });
    return sections.filter((section) => section.content);
  }
  headings.forEach((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = index + 1 < headings.length ? headings[index + 1].index : body.length;
    sections.push({
      title: heading[2].trim(),
      content: body.slice(start, end).trim(),
      level: heading[1].length
    });
  });
  return sections.filter((section) => section.content || section.title);
}

function highlightedMarkdownLines(content = "") {
  return String(content || "")
    .split(/\r?\n/)
    .map((line, index) => {
      const important = /\b(CRITICAL|IMPORTANT|MANDATORY|MUST|NON-OPTIONAL|REQUIRED|NEVER|ALWAYS)\b/i.test(line);
      return (
        <span className={important ? "markdown-line important" : "markdown-line"} key={`${index}-${line.slice(0, 16)}`}>
          {line || " "}
        </span>
      );
    });
}

function MarkdownSourceModal({ source, onClose }) {
  const sections = useMemo(() => markdownSections(source?.content || ""), [source]);
  const [openSections, setOpenSections] = useState(() => new Set(sections.map((_, index) => index)));

  useEffect(() => {
    setOpenSections(new Set(sections.map((_, index) => index)));
  }, [source?.path, sections.length]);

  if (!source) return null;
  const hasContent = Boolean(source.content);

  function toggle(index) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <div
      className="modal-backdrop agent-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <section className="markdown-source-modal" role="dialog" aria-modal="true" aria-label={`${source.label || source.path} markdown`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="agent-modal-header">
          <div>
            <p>Markdown source · {source.contentSource?.replace(/_/g, " ") || "local file"}</p>
            <h2>{source.label || source.path}</h2>
            <span>{source.path}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Close markdown source">
            <X size={16} />
          </button>
        </header>

        {!hasContent ? (
          <div className="markdown-empty-state">
            This `.md` reference came from OpenAI vector metadata, but the local markdown body is not available in BuilderX.
          </div>
        ) : (
          <div className="markdown-section-list">
            {sections.map((section, index) => {
              const isOpen = openSections.has(index);
              return (
                <article className={`markdown-section level-${section.level}`} key={`${section.title}-${index}`}>
                  <button className="markdown-section-toggle" onClick={() => toggle(index)}>
                    <span className="markdown-toggle-symbol">{isOpen ? "−" : "+"}</span>
                    <span>{section.title}</span>
                  </button>
                  {isOpen ? <pre className="markdown-section-content">{highlightedMarkdownLines(section.content)}</pre> : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function AgentDetailModal({ agent, onClose }) {
  const [selectedSource, setSelectedSource] = useState(null);
  if (!agent) return null;
  const detailCards = [
    ["Knowledge summary", agentKnowledgeText(agent)],
    ["Objective", agent.objective],
    ["Instruction summary", agent.instructionSummary],
    ["Deliverable patterns", agent.deliverablePatterns],
    ["Validation", agent.validationResults],
    ["Correction patterns", agent.correctionPatterns],
    ["Lessons learned", agent.lessonsLearned],
    ["Reuse guidance", agent.reuseGuidance]
  ].filter(([, value]) => value);

  return (
    <div className="modal-backdrop agent-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="agent-modal" role="dialog" aria-modal="true" aria-label={`${agent.name} profile`} onMouseDown={(event) => event.stopPropagation()}>
        <header className="agent-modal-header">
          <div className="agent-profile-large" style={{ "--agent-color": agent.profile?.color || "#2563eb" }}>
            {agent.profile?.icon || "🤖"}
          </div>
          <div>
            <p>{agent.project} · {agent.profile?.label || agent.role}</p>
            <h2>{agent.name}</h2>
            <span>{agent.role} · {agent.domain}</span>
          </div>
          <button className="icon-button" onClick={onClose} title="Close agent details">
            <X size={16} />
          </button>
        </header>

        <div className="agent-modal-grid">
          <section className="agent-card agent-efficiency-card">
            <div className="section-heading">
              <Gauge size={18} />
              <h2>Efficiency signals</h2>
            </div>
            <div className="agent-score-grid">
              {Object.entries(agent.efficiency || {}).map(([key, value]) => (
                <div className={`agent-score ${scoreTone(value)}`} key={key}>
                  <span>{key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="agent-card">
            <div className="section-heading">
              <Database size={18} />
              <h2>Vector memory</h2>
            </div>
            <p>{vectorLabel(agent.vector)}</p>
            <small>{agent.vector?.source || "workspace knowledge"} · {agent.sourcePath}</small>
            {agent.vectorMemoryContentSource && <small>content source · {agent.vectorMemoryContentSource.replace(/_/g, " ")}</small>}
            <small>Used {agent.usageCount ?? 0} time{Number(agent.usageCount || 0) === 1 ? "" : "s"} in local memory records</small>
            {agent.sourceReferences?.length ? (
              <div className="agent-md-links">
                {agent.sourceReferences.map((source) => (
                  <button
                    type="button"
                    key={`${source.path}-${source.contentSource}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedSource(source);
                    }}
                  >
                    {source.label || source.path}
                  </button>
                ))}
              </div>
            ) : null}
          </section>

          <section className="agent-card agent-capability-card">
            <div className="section-heading">
              <ShieldCheck size={18} />
              <h2>Capabilities</h2>
            </div>
            <div className="agent-tags">
              {(agent.capabilities?.length ? agent.capabilities : ["General task execution"]).map((capability) => (
                <span key={capability}>{capability}</span>
              ))}
            </div>
          </section>

          {detailCards.map(([title, value]) => (
            <section className="agent-card" key={title}>
              <h3>{title}</h3>
              <p>{value}</p>
            </section>
          ))}

          <section className="agent-card agent-vector-memory-card">
            <h3>Vector memory content</h3>
            <pre className="agent-vector-memory-content">
              {agent.vectorMemoryContent || "No local vector-memory content or retrievable OpenAI vector metadata is available yet."}
            </pre>
          </section>
        </div>
      </section>
      <MarkdownSourceModal source={selectedSource} onClose={() => setSelectedSource(null)} />
    </div>
  );
}

function AgentsWorkspace() {
  const [agents, setAgents] = useState([]);
  const [source, setSource] = useState(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAgent, setSelectedAgent] = useState(null);

  async function loadAgents() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/agents/global`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Agent knowledge could not be loaded.");
      setAgents(Array.isArray(data.agents) ? data.agents : []);
      setSource(data.source || null);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAgents();
  }, []);

  const filteredAgents = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return agents;
    return agents.filter((agent) =>
      [agent.name, agent.project, agent.role, agent.domain, agent.objective, agent.instructionSummary, agent.reuseGuidance, ...(agent.capabilities || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [agents, query]);

  const confirmedCount = agents.filter((agent) => agent.vector?.status === "completed").length;

  return (
    <main className="agents-workspace-tab">
      <header className="agents-hero">
        <div>
          <span className="eyebrow">Global agent memory</span>
          <h1>Agents</h1>
          <p>
            Agent profiles collected from global knowledge records and vector-store sync metadata across BuilderX, GeoFinderX,
            and project-local orchestrators.
          </p>
        </div>
        <div className="agents-hero-actions">
          <button className="ghost-action" onClick={loadAgents} disabled={loading}>
            {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}
            Refresh
          </button>
        </div>
      </header>

      <section className="agents-summary-grid">
        <div className="agent-summary-card">
          <span>Total agents</span>
          <strong>{agents.length}</strong>
        </div>
        <div className="agent-summary-card">
          <span>OpenAI confirmed</span>
          <strong>{confirmedCount}</strong>
        </div>
        <div className="agent-summary-card">
          <span>Vector store</span>
          <strong>{source?.openaiVectorStore?.status || "unknown"}</strong>
          <small>
            {source?.openaiVectorStore?.name || source?.openaiVectorStore?.id || "No vector store detected"} ·{" "}
            {source?.openaiVectorStore?.fileCount ?? 0} files
          </small>
          <small>
            {source?.openaiVectorStore?.agentMemoryFileCount ?? 0} agent-memory files ·{" "}
            {source?.openaiVectorStore?.vectorOnlyAgentCount ?? 0} vector-only agents
          </small>
          <small>
            API key {source?.openaiVectorStore?.hasApiKey ? "found" : "missing"} · Store ID{" "}
            {source?.openaiVectorStore?.hasVectorStoreId ? "found" : "missing"}
            {source?.openaiVectorStore?.configSource ? ` · ${source.openaiVectorStore.configSource}` : ""}
          </small>
        </div>
      </section>

      <section className="agents-table-card">
        <div className="agents-toolbar">
          <label className="agents-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search agents, skills, domains..." />
          </label>
          {source?.openaiVectorStore?.error ? <span className="agents-warning">{source.openaiVectorStore.error}</span> : null}
        </div>

        {error ? <div className="agents-error">{error}</div> : null}
        {loading ? (
          <div className="agents-loading"><Loader2 className="spin" size={18} /> Loading global agent memory...</div>
        ) : (
          <div className="agents-table-wrap">
            <table className="agents-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Project</th>
                  <th>Domain</th>
                  <th>Knowledge</th>
                  <th>Capabilities</th>
                  <th>Memory</th>
                  <th>Used</th>
                  <th>Efficiency</th>
                  <th>Vector status</th>
                </tr>
              </thead>
              <tbody>
                {filteredAgents.map((agent) => (
                  <tr key={`${agent.project}-${agent.id}-${agent.sourcePath}`} onClick={() => setSelectedAgent(agent)}>
                    <td>
                      <div className="agent-name-cell">
                        <span className="agent-profile-icon" style={{ "--agent-color": agent.profile?.color || "#2563eb" }}>{agent.profile?.icon || "🤖"}</span>
                        <div>
                          <strong>{agent.name}</strong>
                          <small>{agent.role}</small>
                        </div>
                      </div>
                    </td>
                    <td>{agent.project}</td>
                    <td>{agent.profile?.label || agent.domain}</td>
                    <td>
                      <p className="agent-knowledge-snippet">{agentKnowledgeText(agent)}</p>
                    </td>
                    <td>
                      <div className="agent-tags compact">
                        {(agent.capabilities || []).slice(0, 3).map((capability) => <span key={capability}>{capability}</span>)}
                      </div>
                    </td>
                    <td>
                      <span className={`memory-status ${hasAgentMemory(agent) ? "has-memory" : "no-memory"}`}>
                        {hasAgentMemory(agent) ? "Memory" : "No memory"}
                      </span>
                    </td>
                    <td>{agent.usageCount ?? 0}</td>
                    <td>
                      <span className={`agent-efficiency-pill ${scoreTone(agent.efficiency?.capability || 0)}`}>
                        {agent.efficiency?.capability || 0}/100
                      </span>
                    </td>
                    <td>
                      <span className={`vector-status ${agent.vector?.status === "completed" ? "confirmed" : "pending"}`}>
                        {vectorLabel(agent.vector)}
                      </span>
                    </td>
                  </tr>
                ))}
                {!filteredAgents.length ? (
                  <tr>
                    <td colSpan="9" className="agents-empty">No agents matched this search.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AgentDetailModal agent={selectedAgent} onClose={() => setSelectedAgent(null)} />
    </main>
  );
}

export default function App() {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("builder");
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem("builderx-theme") || "system");
  const [instruction, setInstruction] = useState(starterPrompt);
  const [taskType, setTaskType] = useState("Medium");
  const [brandingPalette, setBrandingPalette] = useState(null);
  const [customPalette, setCustomPalette] = useState(["#111827", "#0F766E", "#2563EB", "#F8FAFC"]);
  const [showPalettePicker, setShowPalettePicker] = useState(false);
  const [backendStatus, setBackendStatus] = useState("offline");
  const [mcpStatus, setMcpStatus] = useState("offline");
  const [mcpId, setMcpId] = useState("");
  const [generatedStatus, setGeneratedStatus] = useState("ready");
  const [, setEvents] = useState([]);
  const [runtimeLogs, setRuntimeLogs] = useState([]);
  const [chatPrompts, setChatPrompts] = useState([]);
  const [lastBuild, setLastBuild] = useState(null);
  const [isGenerating, setGenerating] = useState(false);
  const [projectName, setProjectName] = useState("Bag commerce studio");
  const [projectResult, setProjectResult] = useState(null);
  const [isCreatingProject, setCreatingProject] = useState(false);
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isSelectingProject, setSelectingProject] = useState(false);
  const [isUploadingMedia, setUploadingMedia] = useState(false);
  const [isImportingProject, setImportingProject] = useState(false);
  const [isDeletingProject, setDeletingProject] = useState(false);
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [fitPreview, setFitPreview] = useState(false);
  const [previewDeviceId, setPreviewDeviceId] = useState("desktop");
  const [isPickingReference, setPickingReference] = useState(false);
  const [selectedReference, setSelectedReference] = useState(null);
  const [sessionStartedAt, setSessionStartedAt] = useState(null);
  const [activityFilter, setActivityFilter] = useState("all");
  const previewFrameRef = useRef(null);

  const selectedProject = selectedProjectId ? projects.find((project) => project.id === selectedProjectId) : null;
  const selectedPreviewUrl = selectedProject?.previewUrl || "";
  const previewDevice = devicePresets.find((device) => device.id === previewDeviceId) || devicePresets.at(-1);
  const activePalette = brandingPalette?.name === "Custom" ? { name: "Custom", colors: customPalette } : brandingPalette;
  const canSubmit = Boolean(selectedProject) && instruction.trim().length > 12 && !isGenerating;
  const canCreateProject = projectName.trim().length > 1 && !isCreatingProject && !selectedProject;
  const workflowRunning = isGenerating || generatedStatus === "working" || isCreatingProject || isSelectingProject;
  const mcpWorkflowRunning = isGenerating || isCreatingProject;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = themeMode;
      localStorage.setItem("builderx-theme", themeMode);
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  const metrics = useMemo(
    () => [
      { label: "Runtime", value: selectedProject ? (generatedStatus === "ready" ? "Live" : "Building") : "Idle" },
      { label: "Backend", value: backendStatus === "online" ? "Online" : "Offline" },
      { label: "Gotham MCP", value: mcpStatus === "online" ? "External" : "Offline", detail: mcpId ? `ID ${mcpId}` : null },
      { label: "Orchestrator", value: lastBuild?.orchestrated?.pageType ? "Structured" : "Ready" },
      { label: "Last build", value: lastBuild?.buildId ? lastBuild.buildId.slice(-6) : "None" }
    ],
    [backendStatus, generatedStatus, lastBuild, mcpId, mcpStatus, selectedProject]
  );
  const activityEvents = useMemo(() => {
    const rows = collapseCodexProgressRows(
      markCurrentSession(normalizeRuntimeRows([...runtimeLogs, ...chatPrompts]).slice(0, MAX_RUNTIME_LOG_ROWS), sessionStartedAt)
    );
    if (activityFilter === "all") return rows;
    return rows.filter((event) => activityCategory(event) === activityFilter);
  }, [activityFilter, chatPrompts, runtimeLogs, sessionStartedAt]);
  const chatMessages = useMemo(
    () => markCurrentSession(normalizeRuntimeRows([...runtimeLogs, ...chatPrompts]).slice(0, 80), sessionStartedAt),
    [chatPrompts, runtimeLogs, sessionStartedAt]
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
          setMcpId(data.codexMcpId || "");
        }
      } catch {
        if (!cancelled) {
          setBackendStatus("offline");
          setMcpStatus("offline");
          setMcpId("");
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

  async function loadProjects() {
    const res = await fetch(`${BACKEND_URL}/api/projects`);
    const data = await res.json();
    if (Array.isArray(data.projects)) {
      setProjects(data.projects);
      if (selectedProjectId && !data.projects.some((project) => project.id === selectedProjectId)) {
        setSelectedProjectId("");
      }
    }
  }

  useEffect(() => {
    loadProjects().catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (selectedProject && !selectedProject.isDefault) setProjectName(selectedProject.name);
  }, [selectedProject?.id]);

  function sendReferenceMode(enabled) {
    setPickingReference(enabled);
    previewFrameRef.current?.contentWindow?.postMessage({ type: "builderx-reference-mode", enabled }, "*");
  }

  function appendUiReference(reference) {
    const label = reference.label ? ` "${reference.label}"` : "";
    const referenceText = `[ui:${reference.id}${label}, tag:${reference.tag}]`;
    setInstruction((current) => {
      const trimmed = current.trimEnd();
      return `${trimmed}${trimmed ? "\n\n" : ""}UI reference ${referenceText}\n`;
    });
  }

  useEffect(() => {
    function receiveReference(event) {
      if (event.data?.type === "builderx-ui-reference-selected") {
        const reference = event.data.reference;
        setSelectedReference(reference);
        setPickingReference(false);
        appendUiReference(reference);
      }
      if (event.data?.type === "builderx-ui-reference-cancelled") {
        setPickingReference(false);
      }
    }
    window.addEventListener("message", receiveReference);
    return () => window.removeEventListener("message", receiveReference);
  }, []);

  async function selectProject(projectId) {
    if (!projectId) {
      setSelectedProjectId("");
      sendReferenceMode(false);
      setSelectedReference(null);
      setPreviewKey(Date.now());
      return;
    }
    setSelectingProject(true);
    setGeneratedStatus("working");
    try {
      const res = await fetch(`${BACKEND_URL}/api/projects/${projectId}/select`, {
        method: "POST"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project preview failed to start");
      await loadProjects();
      if (data.project) {
        setProjects((current) => current.map((project) => (project.id === data.project.id ? { ...project, ...data.project } : project)));
      }
      setSelectedProjectId(data.project?.id || projectId);
      sendReferenceMode(false);
      setSelectedReference(null);
      setPreviewKey(Date.now());
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `project-select-error-${Date.now()}`,
              type: "error",
              message: error.message,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } finally {
      setSelectingProject(false);
      setGeneratedStatus("ready");
    }
  }

  function applyReadyProject(project) {
    if (!project?.id) return;
    setProjects((current) => [...current.filter((item) => item.id !== project.id), project]);
    setSelectedProjectId(project.id);
    sendReferenceMode(false);
    setSelectedReference(null);
    setPreviewKey(Date.now());
  }

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
    const baseInstruction = instruction.trim();
    const submittedInstruction = activePalette
      ? `${baseInstruction}\n\nBranding colours: ${activePalette.name} (${activePalette.colors.join(", ")}).`
      : baseInstruction;
    const submittedPrompt = `Task Type: ${taskType}\nTask: ${submittedInstruction}`;
    setInstruction("");
    setSessionStartedAt(startedAt);
    const queuedEvent = {
      id: `queued-${Date.now()}`,
      type: "queued",
      message: "Run workflow clicked. Sending instruction to Gotham MCP workflow...",
      createdAt: new Date(startedAt).toISOString(),
      time: formatIstTime()
    };
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      type: "instruction",
      message: submittedPrompt,
      taskType,
      promptTarget: selectedProject ? `${selectedProject.name}.orchestrator-agent` : "builderx-fullstack-agent",
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
        body: JSON.stringify({
          instruction: submittedInstruction,
          taskType,
          projectId: selectedProjectId,
          mediaIds: selectedProject?.media?.map((item) => item.id) || []
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(gothamText(data.error || "Gotham MCP workflow failed"));
      setLastBuild(data);
      await loadProjects();
      applyReadyProject(data.restart?.project);
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
    const startedAt = Date.now();
    const baseInstruction = instruction.trim();
    const submittedInstruction = baseInstruction && activePalette
      ? `${baseInstruction}\n\nBranding colours: ${activePalette.name} (${activePalette.colors.join(", ")}).`
      : baseInstruction;
    if (submittedInstruction.length > 12) {
      const submittedPrompt = `Task Type: ${taskType}\nTask: ${submittedInstruction}`;
      const userMessage = {
        id: `new-project-instruction-${Date.now()}`,
        role: "user",
        type: "instruction",
        message: submittedPrompt,
        taskType,
        promptTarget: `${projectName.trim()}.orchestrator-agent`,
        createdAt: new Date(startedAt).toISOString(),
        time: formatIstTime()
      };
      setChatPrompts((current) => normalizeRuntimeRows([userMessage, ...current]));
    }
    setCreatingProject(true);
    setGeneratedStatus("working");
    setProjectResult({ status: "running", projectName: projectName.trim(), previewUrl: selectedPreviewUrl });
    if (submittedInstruction.length > 12) setInstruction("");
    try {
      const res = await fetch(`${BACKEND_URL}/api/projects/new`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          instruction: submittedInstruction.length > 12 ? submittedInstruction : undefined,
          taskType,
          mediaIds: selectedProject?.media?.map((item) => item.id) || []
        })
      });
      const data = await res.json();
      setProjectResult(data);
      if (!res.ok) throw new Error(data.error || "Project creation failed");
      await loadProjects();
      applyReadyProject(data.project);
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

  async function uploadMedia(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length || !selectedProject || selectedProject.isDefault) return;
    setUploadingMedia(true);
    try {
      const body = new FormData();
      for (const file of files) body.append("media", file);
      const res = await fetch(`${BACKEND_URL}/api/projects/${selectedProject.id}/media`, {
        method: "POST",
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Media upload failed");
      await loadProjects();
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `media-error-${Date.now()}`,
              type: "error",
              message: error.message,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
    } finally {
      setUploadingMedia(false);
    }
  }

  async function importProject(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportingProject(true);
    setGeneratedStatus("working");
    try {
      const body = new FormData();
      body.append("name", file.name.replace(/\.zip$/i, ""));
      body.append("project", file);
      const res = await fetch(`${BACKEND_URL}/api/projects/import`, {
        method: "POST",
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project import failed");
      await loadProjects();
      applyReadyProject(data.project);
      setProjectResult({ status: "succeeded", projectName: data.project.name, container: `port ${data.project.port}` });
    } catch (error) {
      setProjectResult({ status: "failed", projectName: file.name, error: error.message });
    } finally {
      setImportingProject(false);
      setGeneratedStatus("ready");
    }
  }

  async function deleteSelectedProject() {
    if (!selectedProject || selectedProject.isDefault || isDeletingProject) return;
    const confirmed = window.confirm(
      `Permanently delete ${selectedProject.name}? This removes its workspace, containers, database volumes, agents, and generated files.`
    );
    if (!confirmed) return;
    setDeletingProject(true);
    setGeneratedStatus("working");
    try {
      const res = await fetch(`${BACKEND_URL}/api/projects/${selectedProject.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project deletion failed");
      setSelectedProjectId("");
      await loadProjects();
      setProjectResult({
        status: "succeeded",
        projectName: data.project.name,
        container: "workspace and runtime data deleted"
      });
      setPreviewKey(Date.now());
    } catch (error) {
      setProjectResult({ status: "failed", projectName: selectedProject.name, error: error.message });
    } finally {
      setDeletingProject(false);
      setGeneratedStatus("ready");
    }
  }

  return (
    <div className="workspace-shell">
      <nav className="workspace-tabs" aria-label="BuilderX workspace tabs">
        <div className="workspace-brand">
          <div className="brand-mark">
            <Sparkles size={20} />
          </div>
          <div>
            <h1>Agentic BuilderX</h1>
            <p>Professional webpage generation cockpit</p>
          </div>
        </div>
        <button
          type="button"
          className={activeWorkspaceTab === "builder" ? "active" : ""}
          onClick={() => setActiveWorkspaceTab("builder")}
          aria-selected={activeWorkspaceTab === "builder"}
        >
          <Sparkles size={15} />
          Builder
        </button>
        <button
          type="button"
          className={activeWorkspaceTab === "agentic-system" ? "active" : ""}
          onClick={() => setActiveWorkspaceTab("agentic-system")}
          aria-selected={activeWorkspaceTab === "agentic-system"}
        >
          <PanelRight size={15} />
          Agentic System D3
        </button>
        <button
          type="button"
          className={activeWorkspaceTab === "agents" ? "active" : ""}
          onClick={() => setActiveWorkspaceTab("agents")}
          aria-selected={activeWorkspaceTab === "agents"}
        >
          <Bot size={15} />
          Agents
        </button>
        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {themeOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              className={themeMode === option.id ? "active" : ""}
              onClick={() => setThemeMode(option.id)}
              role="radio"
              aria-checked={themeMode === option.id}
            >
              {option.label}
            </button>
          ))}
        </div>
        {mcpWorkflowRunning ? <span className="workspace-running"><i />Gotham workflow running</span> : null}
      </nav>
      {activeWorkspaceTab === "builder" ? (
      <main className="app-shell">
      <section className="preview-panel">
        <header className="preview-toolbar">
          <div className="preview-title">
            <MonitorSmartphone size={20} />
            <div>
              <h2>Playground</h2>
              <p>{selectedPreviewUrl || "No project selected"}</p>
            </div>
          </div>
          <div className="toolbar-actions">
            <select
              className="project-select"
              value={selectedProjectId}
              onChange={(event) => selectProject(event.target.value)}
              disabled={isSelectingProject}
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} : {project.port}
                </option>
              ))}
            </select>
            <div className="device-toggle" aria-label="Preview device size">
              {devicePresets.map((device) => {
                const DeviceIcon = device.icon;
                return (
                  <button
                    key={device.id}
                    className={`device-button ${previewDeviceId === device.id ? "active" : ""}`}
                    onClick={() => {
                      setPreviewDeviceId(device.id);
                      setFitPreview(false);
                    }}
                    title={`${device.label} ${device.width}x${device.height}`}
                    aria-label={`${device.label} preview`}
                  >
                    <DeviceIcon size={16} />
                  </button>
                );
              })}
            </div>
            <button className="text-button" onClick={() => setFitPreview((value) => !value)}>
              <Maximize2 size={16} />
              {fitPreview ? "Keep aspect" : "Fit screen"}
            </button>
            <button
              className={`icon-button ${isPickingReference ? "active" : ""}`}
              onClick={() => sendReferenceMode(!isPickingReference)}
              disabled={!selectedProject}
              title="Select a playground reference"
            >
              <MousePointer2 size={18} />
            </button>
            <button
              className="icon-button"
              onClick={() => selectProject(selectedProjectId)}
              disabled={!selectedProject || isSelectingProject}
              title="Restart if needed and reload preview"
            >
              <RefreshCcw size={18} />
            </button>
            {selectedProject ? (
              <a className="icon-button" href={selectedPreviewUrl} target="_blank" rel="noreferrer" title="Open preview">
                <ExternalLink size={18} />
              </a>
            ) : (
              <button className="icon-button" disabled title="Open preview">
                <ExternalLink size={18} />
              </button>
            )}
          </div>
        </header>

        <div className={`preview-stage ${fitPreview ? "fit-preview" : ""}`}>
          <div
            className={`preview-frame-wrap ${previewDeviceId} ${workflowRunning ? "running-preview-border" : ""}`}
            style={{
              "--preview-width": `${previewDevice.width}px`,
              "--preview-height": `${previewDevice.height}px`
            }}
          >
            {selectedProject ? (
              <>
                <iframe
                  ref={previewFrameRef}
                  key={previewKey}
                  title="Generated webpage preview"
                  src={selectedPreviewUrl}
                  onLoad={() => {
                    if (isPickingReference) sendReferenceMode(true);
                  }}
                />
                {isPickingReference ? (
                  <span className="reference-status picking">Click a UI element in the playground</span>
                ) : selectedReference ? (
                  <span className="reference-status">Selected UI: {selectedReference.id}</span>
                ) : null}
              </>
            ) : (
              <div className="empty-playground">
                <MonitorSmartphone size={28} />
                <span>Select a project to load its playground.</span>
              </div>
            )}
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
            <span>{selectedProject ? (selectedProject.isDefault ? "Containerized preview" : `Port ${selectedProject.port}`) : "No port selected"}</span>
          </div>
        </footer>
      </section>

      <aside className="control-panel">
        <section className={`composer chat-card ${mcpWorkflowRunning ? "mcp-running-border" : ""}`} aria-busy={mcpWorkflowRunning}>
          <div className="section-heading">
            <TerminalSquare size={18} />
            <h2>Gotham Builder chat</h2>
          </div>
          <div className="project-onboarding">
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Project name"
              readOnly={Boolean(selectedProject && !selectedProject.isDefault)}
              title={selectedProject && !selectedProject.isDefault ? "Existing project name" : "New project name"}
            />
            <select
              className="project-select project-select-inline"
              value={selectedProjectId}
              onChange={(event) => selectProject(event.target.value)}
              disabled={isSelectingProject}
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} : {project.port}
                </option>
              ))}
            </select>
            <button className="new-project-action" onClick={createNewProject} disabled={!canCreateProject}>
              {isCreatingProject ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              New project
            </button>
          </div>
          <div className="project-tools">
            <label className={`tool-action ${!selectedProject || selectedProject.isDefault ? "disabled" : ""}`}>
              {isUploadingMedia ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
              Media
              <input type="file" multiple onChange={uploadMedia} disabled={!selectedProject || selectedProject.isDefault || isUploadingMedia} />
            </label>
            <label className="tool-action">
              {isImportingProject ? <Loader2 className="spin" size={16} /> : <FolderUp size={16} />}
              Project
              <input type="file" accept=".zip" onChange={importProject} disabled={isImportingProject} />
            </label>
            <a
              className={`tool-action ${selectedProject ? "" : "disabled"}`}
              href={selectedProject ? `${BACKEND_URL}/api/projects/${selectedProject.id}/export` : undefined}
            >
              <Download size={16} />
              Export
            </a>
            <button
              className={`tool-action danger ${!selectedProject || selectedProject.isDefault ? "disabled" : ""}`}
              onClick={deleteSelectedProject}
              disabled={!selectedProject || selectedProject.isDefault || isDeletingProject}
              title="Delete selected project"
            >
              {isDeletingProject ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
              Delete
            </button>
          </div>
          {selectedProject?.media?.length ? (
            <div className="media-strip">
              {selectedProject.media.slice(-4).map((item) => (
                <span key={item.id}>{item.name}</span>
              ))}
            </div>
          ) : null}
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
              <li className="empty-state">Gotham responses will appear here while the workflow runs.</li>
            )}
          </ol>
          <div className="task-type-switch" role="radiogroup" aria-label="Task type">
            {taskTypeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`${option.tone} ${taskType === option.id ? "active" : ""}`}
                onClick={() => setTaskType(option.id)}
                role="radio"
                aria-checked={taskType === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="chat-input-shell">
            <textarea
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder=""
            />
          </div>
          <p className="orchestrator-note">
            {activePalette
              ? `Task Type: ${taskType}. Branding palette selected: ${activePalette.name}.`
              : `Task Type: ${taskType}. BuilderX will structure this as “Task Type” and “Task” before handoff.`}
          </p>
          <div className="composer-actions">
            <button className="primary-action" onClick={generatePage} disabled={!canSubmit}>
              {isGenerating ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              Run workflow
            </button>
            <button className="ghost-action" onClick={() => setShowPalettePicker(true)}>
              <Palette size={18} />
              Branding colours
            </button>
          </div>
        </section>

        <section className="status-grid">
          {metrics.map((metric) => (
            <div className="metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.detail ? <small>{metric.detail}</small> : null}
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
            <span>Gotham MCP</span>
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
          <div className="activity-filters" role="tablist" aria-label="Activity log filters">
            {activityFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={activityFilter === filter.id ? "active" : ""}
                onClick={() => setActivityFilter(filter.id)}
                role="tab"
                aria-selected={activityFilter === filter.id}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <ol>
            {activityEvents.length ? (
              activityEvents.map((event) => <EventRow key={`activity-${event.id || event.createdAt}`} event={event} sessionStartedAt={sessionStartedAt} />)
            ) : (
              <li className="empty-state">Activity events will appear here.</li>
            )}
          </ol>
        </section>

        <button className="agentic-link" type="button" onClick={() => setActiveWorkspaceTab("agentic-system")}>
          <PanelRight size={16} />
          Open Agentic System D3
        </button>
      </aside>
      {showPalettePicker ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowPalettePicker(false)}>
          <section className="palette-modal" role="dialog" aria-modal="true" aria-label="Branding colour palettes" onMouseDown={(event) => event.stopPropagation()}>
            <header className="palette-modal-header">
              <div>
                <h2>Branding colours</h2>
                <p>Optional palette for the next instruction.</p>
              </div>
              <button className="icon-button" onClick={() => setShowPalettePicker(false)} title="Close palette picker">
                <X size={16} />
              </button>
            </header>
            <div className="palette-list">
              {colorPalettes.map((palette) => (
                <button
                  key={palette.name}
                  className={`palette-option ${brandingPalette?.name === palette.name ? "active" : ""}`}
                  onClick={() => setBrandingPalette(palette)}
                >
                  <span>{palette.name}</span>
                  <span className="swatch-row">
                    {palette.colors.map((color) => (
                      <i key={color} style={{ background: color }} title={color} />
                    ))}
                  </span>
                </button>
              ))}
            </div>
            <div className="custom-palette">
              <strong>Custom palette</strong>
              <div className="custom-colors">
                {customPalette.map((color, index) => (
                  <label key={index}>
                    <input
                      type="color"
                      value={color}
                      onChange={(event) => {
                        const next = [...customPalette];
                        next[index] = event.target.value;
                        setCustomPalette(next);
                        setBrandingPalette({ name: "Custom", colors: next });
                      }}
                    />
                    <span>{color}</span>
                  </label>
                ))}
              </div>
            </div>
            <footer className="palette-footer">
              <span>{activePalette ? `${activePalette.name}: ${activePalette.colors.join(" ")}` : "No palette selected"}</span>
              <button className="ghost-action" onClick={() => setBrandingPalette(null)}>Clear</button>
              <button className="primary-action" onClick={() => setShowPalettePicker(false)}>Done</button>
            </footer>
          </section>
        </div>
      ) : null}
      </main>
      ) : activeWorkspaceTab === "agentic-system" ? (
        <main className="agentic-workspace-tab">
          <iframe title="Agentic System D3" src="/agentic-system/d3/index.html?embedded=1" />
        </main>
      ) : (
        <AgentsWorkspace />
      )}
    </div>
  );
}
