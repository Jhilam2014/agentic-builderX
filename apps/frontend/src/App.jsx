import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import * as d3 from "d3";
import {
  Activity,
  Bot,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  Download,
  ExternalLink,
  FolderUp,
  Gauge,
  GitBranch,
  Loader2,
  Monitor,
  Maximize2,
  MonitorSmartphone,
  Moon,
  MousePointer2,
  PanelRight,
  Palette,
  Pause,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Sun,
  Smartphone,
  Tablet,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  X,
  XCircle
} from "lucide-react";
import CloudHostingPage from "./pages/CloudHostingPage.jsx";
import { authFetch, clearUser, getStoredUser, storeUser } from "./authClient.js";

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
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor }
];
const devicePresets = [
  { id: "phone", label: "Phone", icon: Smartphone, width: 390, height: 844 },
  { id: "tablet", label: "Tablet", icon: Tablet, width: 820, height: 1180 },
  { id: "laptop", label: "Laptop", icon: MonitorSmartphone, width: 1280, height: 800 },
  { id: "desktop", label: "Desktop", icon: Monitor, width: 1440, height: 900 }
];
const colorPalettes = [
  { name: "Trusted Finance", colors: ["#112E81", "#4647AE", "#4382DF", "#AACCD6"], url: "https://colorhunt.co/palette/112e814647ae4382dfaaccd6", keywords: ["finance", "bank", "investment", "insurance", "legal", "enterprise", "trust"] },
  { name: "Clinical Teal", colors: ["#0A2947", "#F3E4C9", "#D3D4C0", "#8B5E3C"], url: "https://colorhunt.co/palette/0a2947f3e4c9d3d4c08b5e3c", keywords: ["health", "medical", "clinic", "wellness", "care", "hospital"] },
  { name: "Sustainable Growth", colors: ["#9CB080", "#618764", "#2B5748", "#273338"], url: "https://colorhunt.co/palette/9cb0806187642b5748273338", keywords: ["green", "eco", "sustainable", "agriculture", "environment", "organic", "nature"] },
  { name: "SaaS Momentum", colors: ["#293681", "#4274D9", "#95CCD0", "#DDE7E6"], url: "https://colorhunt.co/palette/2936814274d995ccddd0e7e6", keywords: ["saas", "software", "technology", "platform", "dashboard", "developer", "cloud", "ai"] },
  { name: "Commerce Energy", colors: ["#FF6A1C", "#FFDA62", "#FFAE56", "#F5788B"], url: "https://colorhunt.co/palette/ff6a1cffda62ffae56f5788b", keywords: ["commerce", "shop", "store", "retail", "marketplace", "sale", "fashion"] },
  { name: "Luxury Editorial", colors: ["#000000", "#233D4D", "#FE7F2D", "#EAECF0"], url: "https://colorhunt.co/palette/000000233d4dfe7f2deaecf0", keywords: ["luxury", "premium", "editorial", "portfolio", "architecture", "automotive"] },
  { name: "Media Studio", colors: ["#4B1426", "#17433F", "#558467", "#EFEABB"], url: "https://colorhunt.co/palette/4b142617433f558467efeabb", keywords: ["media", "audio", "video", "music", "film", "creative", "studio"] },
  { name: "Education Spark", colors: ["#FFBF00", "#FFF78D", "#467235", "#283F24"], url: "https://colorhunt.co/palette/ffbf00fff78d467235283f24", keywords: ["education", "school", "learning", "student", "course", "children"] },
  { name: "Hospitality Warmth", colors: ["#FFCA95", "#FF7873", "#E22F80", "#8140DC"], url: "https://colorhunt.co/palette/ffca95ff7873e22f808140dc", keywords: ["food", "restaurant", "travel", "hotel", "hospitality", "event", "beauty"] },
  { name: "Calm Service", colors: ["#607456", "#EEE0CC", "#BA6A4C", "#7B2525"], url: "https://colorhunt.co/palette/607456eee0ccba6a4c7b2525", keywords: ["consulting", "service", "professional", "local business", "home", "interior"] },
  { name: "Future Violet", colors: ["#1B4EF5", "#3874FF", "#5996FF", "#F4CEFF"], url: "https://colorhunt.co/palette/1b4ef53874ff5996fff4ceff", keywords: ["startup", "innovation", "future", "crypto", "web3", "automation"] },
  { name: "Bold Campaign", colors: ["#FF9E20", "#215E61", "#1D2128", "#F4F2F2"], url: "https://colorhunt.co/palette/ff9e20215e611d2128f4f2f2", keywords: ["marketing", "campaign", "agency", "sports", "community", "nonprofit"] },
  { name: "Navy Glass", colors: ["#0B2447", "#19376D", "#576CBC", "#A5D7E8"], url: "https://colorhunt.co/palette/0b244719376d576cbca5d7e8", keywords: [] }
];

function recommendBrandPalette(context = "") {
  const normalized = String(context || "").toLowerCase();
  const scored = colorPalettes.map((palette, index) => {
    const matches = (palette.keywords || []).filter((keyword) => normalized.includes(keyword));
    return { palette, score: matches.length, matches, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const winner = scored[0]?.score ? scored[0] : { palette: colorPalettes.at(-1), score: 0, matches: [] };
  return {
    ...winner.palette,
    recommended: true,
    reason: winner.matches.length
      ? `Recommended for ${winner.matches.join(", ")}.`
      : "Recommended as a versatile professional default."
  };
}
const agentVisuals = {
  "builderx-fullstack-agent": { color: "#334155", accent: "#38bdf8", label: "Fullstack", initials: "BX", kind: "fullstack" },
  "builderx-independent-reviewer": { color: "#581c87", accent: "#e879f9", label: "Reviewer", initials: "BR", kind: "reviewer" },
  "project-execution-agent": { color: "#0f766e", accent: "#22c55e", label: "Execution", initials: "PX", kind: "execution" },
  "human-controller": { color: "#7f1d1d", accent: "#fb7185", label: "Human", initials: "HC", kind: "human" },
  "agent-memory-sync": { color: "#4c1d95", accent: "#a78bfa", label: "Memory", initials: "AM", kind: "memory" },
  "geofinderx-orchestrator-agent": { color: "#7c3aed", accent: "#2dd4bf", label: "Orchestrator", initials: "GO", kind: "geo-orchestrator" },
  "geofinderx-ui-composition-agent": { color: "#2563eb", accent: "#93c5fd", label: "UI", initials: "GU", kind: "ui" },
  "geofinderx-content-data-agent": { color: "#d97706", accent: "#facc15", label: "Content", initials: "GC", kind: "geo-data" },
  "geofinderx-runtime-packaging-agent": { color: "#0f766e", accent: "#5eead4", label: "Runtime", initials: "GR", kind: "runtime" },
  "geofinderx-local-execution-agent": { color: "#0f766e", accent: "#86efac", label: "Execution", initials: "GX", kind: "execution" },
  "mapex-orchestrator-agent": { color: "#7c3aed", accent: "#c4b5fd", label: "Orchestrator", initials: "MO", kind: "commerce-orchestrator" },
  "mapex-ui-composition-agent": { color: "#2563eb", accent: "#60a5fa", label: "UI", initials: "MU", kind: "ui" },
  "mapex-content-data-agent": { color: "#d97706", accent: "#fbbf24", label: "Content", initials: "MC", kind: "content" },
  "mapex-runtime-packaging-agent": { color: "#0f766e", accent: "#2dd4bf", label: "Runtime", initials: "MR", kind: "runtime" },
  "mapex-commerce-catalog-agent": { color: "#be123c", accent: "#fb7185", label: "Commerce", initials: "MS", kind: "commerce" },
  "instagram-ocr": { color: "#be185d", accent: "#f9a8d4", label: "OCR", initials: "IO", kind: "ocr" },
  "rtt-signal-analysis": { color: "#1d4ed8", accent: "#67e8f9", label: "Signal", initials: "RS", kind: "signal" },
  "whatsapp-auto-reply": { color: "#15803d", accent: "#86efac", label: "Reply", initials: "WA", kind: "reply" },
  "voice-assist": { color: "#0369a1", accent: "#7dd3fc", label: "Voice", initials: "VA", kind: "voice" }
};
const defaultProjectFlowNodes = [
  { id: "intake", label: "Instruction intake", state: "pending", detail: "Waiting for project creation." },
  { id: "path-selection", label: "What-next path selection", state: "pending", detail: "Choose the strongest development route." },
  { id: "project-local-orchestrator", label: "Project-local orchestrator", state: "selected", detail: "Agents, Docker scaffold, memory, and Gotham handoff." },
  { id: "template-only", label: "Template-only generation", state: "disabled", detail: "Available but not selected for managed projects." },
  { id: "human-choice-review", label: "Human Agent choice", state: "disabled", detail: "Used when the correct path is unclear." },
  { id: "gotham-generation", label: "Gotham generation", state: "pending", detail: "Generate project files." },
  { id: "runtime-handoff", label: "Runtime handoff", state: "pending", detail: "Assign preview and preserve standalone Docker path." }
];
const defaultSubObjectiveFlow = [
  { id: "requirements", label: "Requirements", state: "completed", detail: "Instruction and docs" },
  { id: "feature-coverage", label: "Feature coverage", state: "selected", detail: "Direct and indirect needs" },
  { id: "architecture", label: "Architecture", state: "pending", detail: "Data, UI, runtime" },
  { id: "generation", label: "Generation", state: "pending", detail: "Gotham file work" },
  { id: "validation", label: "Validation", state: "pending", detail: "Preview and handoff" }
];
const techStackNodes = [
  { id: "frontend", label: "Frontend", x: 132, y: 58, color: "#2563eb", icon: MonitorSmartphone },
  { id: "backend", label: "Backend", x: 132, y: 170, color: "#0f766e", icon: Server },
  { id: "database", label: "Database", x: 588, y: 58, color: "#d97706", icon: Database },
  { id: "cloud", label: "Cloud services", x: 588, y: 170, color: "#7c3aed", icon: Cloud },
  { id: "services", label: "AI / Integrations", x: 360, y: 204, color: "#be123c", icon: Bot }
];

const techStackNodeById = new Map(techStackNodes.map((node) => [node.id, node]));

function stackText(items) {
  return items.filter(Boolean).slice(0, 3).join(" / ");
}

function serviceFlowSteps(snapshot) {
  const categories = snapshot.categories || [];
  const byId = new Map(categories.map((category) => [category.id, category]));
  return ["frontend", "backend", "database", "services", "cloud"].map((id, index) => {
    const category = byId.get(id) || { id, label: displayEventType(id), items: [], state: "planned" };
    return {
      ...category,
      order: index + 1,
      insight:
        id === "frontend"
          ? "User-facing screens, generated pages, responsive CSS, and playground preview surface."
          : id === "backend"
            ? "BuilderX API, project orchestration, Gotham workflow handoff, and runtime project controls."
            : id === "database"
              ? "Project metadata, generated app data, vector memory records, and graph artifacts used for reasoning."
              : id === "services"
                ? "AI workflow, QAgentic review, OAuth/media inputs, and external service integration points."
                : "Docker runtime, preview port assignment, generated-site hosting, and cloud deployment path."
    };
  });
}

function buildTechStackSnapshot({ project, lastBuild, flowPath, generatedStatus }) {
  const projectName = flowPath?.projectName || project?.name || "No project selected";
  const files = Array.isArray(lastBuild?.files) ? lastBuild.files.map((file) => file.path || file).filter(Boolean) : [];
  const hasJsx = files.some((file) => /\.jsx?$/i.test(file));
  const hasCss = files.some((file) => /\.css$/i.test(file));
  const hasData = files.some((file) => /catalogData|metadata|\.json$/i.test(file));
  const isProject = Boolean(project && !project.isDefault);
  const isRunning = flowPath?.status === "running" || generatedStatus === "working";
  const progress = isRunning
    ? 58
    : flowPath?.status === "failed"
      ? 36
      : lastBuild?.buildId || project
        ? 100
        : 0;
  const buildKey = lastBuild?.buildId || project?.updatedAt || project?.id || "no-build";
  const snapshotTime = lastBuild?.createdAt || project?.updatedAt || new Date().toISOString();
  return {
    key: [
      project?.id || "none",
      buildKey,
      flowPath?.status || "idle",
      flowPath?.selectedPath || "no-path",
      generatedStatus
    ].join(":"),
    projectId: project?.id || "",
    buildKey,
    createdAt: snapshotTime,
    projectName,
    buildId: lastBuild?.buildId || "",
    progress,
    status: flowPath?.status || (project ? "ready" : "idle"),
    categories: [
      {
        id: "frontend",
        label: "Frontend",
        items: ["React", "Vite", hasCss ? "Generated CSS" : "Responsive UI", hasJsx ? "Generated pages" : ""],
        state: hasJsx || project ? "active" : "planned"
      },
      {
        id: "backend",
        label: "Backend",
        items: ["Node.js", "Express API", isProject ? "Project orchestrator" : "BuilderX generator"],
        state: project ? "active" : "planned"
      },
      {
        id: "database",
        label: "Database",
        items: [hasData ? "Generated metadata" : "Project metadata", "Vector memory", "Neo4j graph artifacts"],
        state: hasData || flowPath ? "active" : "planned"
      },
      {
        id: "cloud",
        label: "Cloud services",
        items: [isProject ? `Preview port ${project.port || "pending"}` : "Generated-site container", "Docker runtime", "Cloud hosting path"],
        state: project ? "active" : "planned"
      },
      {
        id: "services",
        label: "AI / Integrations",
        items: ["Gotham workflow", "QAgentic support", "OAuth / media inputs"],
        state: flowPath || lastBuild ? "active" : "planned"
      }
    ]
  };
}

function gothamChatFlowPath({ projectName, taskType, useProjectOrchestrator }) {
  const selectedPath = useProjectOrchestrator ? "project-local-orchestrator" : "template-only";
  return {
    status: "running",
    selectedPath,
    confidence: 68,
    deterministic: true,
    projectName: projectName || "BuilderX default workspace",
    taskType,
    summary: "BuilderX is executing deterministic path selection for this Gotham chat instruction.",
    humanInLoop: { required: false, reason: "", choices: [] },
    subObjectives: defaultSubObjectiveFlow.map((node) => ({
      ...node,
      state: node.id === "requirements" || node.id === "feature-coverage" ? "completed" : node.id === "generation" ? "selected" : "pending"
    })),
    nodes: defaultProjectFlowNodes.map((node) => ({
      ...node,
      state:
        node.id === "intake" || node.id === "path-selection"
          ? "completed"
          : node.id === selectedPath
            ? "selected"
            : node.id === "human-choice-review"
              ? "disabled"
              : "pending",
      detail:
        node.id === "intake"
          ? `Gotham chat instruction captured as ${taskType || "Medium"} task.`
          : node.id === "path-selection"
            ? "Choosing the strongest route before Gotham generation."
            : node.detail
    })),
    rejectedPaths: [
      {
        id: useProjectOrchestrator ? "template-only" : "project-local-orchestrator",
        reason: useProjectOrchestrator
          ? "Project-local orchestration is required for the selected project."
          : "No project-local target is selected for this instruction."
      }
    ],
    nextRecommendation: "Wait for Gotham generation to finish, then review the selected path evidence."
  };
}

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

function agentIdFromProjectName(projectName) {
  const slug = String(projectName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-orchestrator-agent` : "";
}

function initialsFor(value) {
  const words = String(value || "Agent")
    .replace(/agent$/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || "AG").toUpperCase();
}

function stableAgentHash(value = "agent") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const generatedAgentPalettes = [
  ["#1d4ed8", "#67e8f9"], ["#7c3aed", "#f0abfc"], ["#0f766e", "#5eead4"],
  ["#b45309", "#fde047"], ["#be123c", "#fda4af"], ["#0369a1", "#7dd3fc"],
  ["#4d7c0f", "#bef264"], ["#9f1239", "#f9a8d4"], ["#4338ca", "#a5b4fc"]
];

function agentVisualFromId(agentId, fallback = {}) {
  const id = String(agentId || "").trim();
  const base = agentVisuals[id] || {};
  const hash = stableAgentHash(id || fallback.name || fallback.agentName);
  const generatedPalette = generatedAgentPalettes[hash % generatedAgentPalettes.length];
  const color = base.color || fallback.profile?.color || fallback.color || generatedPalette[0];
  return {
    id: id || "gotham-builder",
    name: fallback.name || base.name || fallback.agentName || displayEventType(id || "Gotham Builder"),
    label: base.label || fallback.profile?.label || fallback.role || fallback.domain || "Agent",
    initials: base.initials || fallback.initials || initialsFor(fallback.name || id),
    color,
    accent: base.accent || fallback.accent || fallback.profile?.accent || generatedPalette[1],
    role: fallback.role || base.label || fallback.domain || "",
    objective: fallback.objective || fallback.instructionSummary || "",
    capabilities: fallback.capabilities || [],
    kind: base.kind || fallback.profile?.kind || fallback.kind || "",
    variant: hash % 6
  };
}

function agentVisualFromRecord(agent) {
  return agentVisualFromId(agent?.id, {
    name: agent?.name,
    role: agent?.role,
    domain: agent?.domain,
    profile: agent?.profile,
    objective: agent?.objective,
    instructionSummary: agent?.instructionSummary,
    capabilities: agent?.capabilities
  });
}

function agentVisualFromEvent(event, selectedProject = null) {
  if (event?.role === "user") {
    return { id: "user", name: "You", label: "Human", initials: "YU", color: "#0f766e", accent: "#5eead4" };
  }
  const promptTarget = String(event?.promptTarget || "");
  const explicitId = promptTarget.includes(".orchestrator-agent")
    ? agentIdFromProjectName(promptTarget.replace(/\.orchestrator-agent$/, ""))
    : promptTarget;
  const projectAgentId = selectedProject && !selectedProject.isDefault ? agentIdFromProjectName(selectedProject.name) : "";
  const builderStages = [
    "request-received", "builderx-start", "adaptive-route-selected", "orchestrator-prompt", "orchestrated",
    "file-plan", "file-plan-item", "builderx-delegation", "builderx-validation", "builderx-complete",
    "builderx-retry", "runtime-refresh-requested", "project-runtime-handoff", "generated", "hot-reload", "restarted",
    "project-create-start", "project-instruction-start", "project-agents-created", "project-created",
    "project-runtime-ready", "project-create-preserved", "project-create-failed", "error"
  ];
  const reviewerStages = ["review-start", "review-complete", "review-retry"];
  const executorStages = ["delegation-start", "delegation-complete", "generating", "codex-start", "codex-progress", "codex-complete", "files-applied"];
  const inferredId =
    event?.reviewerAgentId ||
    event?.agentId ||
    explicitId ||
    (reviewerStages.includes(event?.type) ? "builderx-independent-reviewer" : "") ||
    (builderStages.includes(event?.type) ? "builderx-fullstack-agent" : "") ||
    (executorStages.includes(event?.type) ? projectAgentId || "project-execution-agent" : "") ||
    (event?.type === "project-orchestrator-direct" || event?.type === "child-project-handoff" ? projectAgentId : "") ||
    "project-execution-agent";
  return agentVisualFromId(inferredId, {
    name: inferredId === "project-execution-agent" ? "Project Execution Agent" : displayEventType(inferredId),
    role: "Agent"
  });
}

function agentIconKind(avatar = {}) {
  if (avatar.kind) return String(avatar.kind).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const value = `${avatar.id || ""} ${avatar.name || ""} ${avatar.label || ""} ${avatar.role || ""} ${avatar.objective || ""} ${(avatar.capabilities || []).join(" ")}`.toLowerCase();
  if (value.includes("human") || value === "user") return "human";
  if (value.includes("qagent")) return "qagent";
  if (/ocr|image text|vision|extract/.test(value)) return "ocr";
  if (/signal|rtt|metric|trend|forecast/.test(value)) return "signal";
  if (/reply|message|whatsapp|chat automation/.test(value)) return "reply";
  if (/review|audit|validation|verifier|quality/.test(value)) return "reviewer";
  if (/security|auth|permission|compliance|privacy/.test(value)) return "security";
  if (/test|testing|qa|coverage/.test(value)) return "testing";
  if (/memory|vector|knowledge|graph/.test(value)) return "memory";
  if (/api|backend|service|integration|webhook/.test(value)) return "api";
  if (/voice|audio|speech/.test(value)) return "voice";
  if (/map|geo|location|route/.test(value) && (value.includes("orchestrator") || value.includes("planner"))) return "geo-orchestrator";
  if (/map|geo|location|route/.test(value) && (value.includes("data") || value.includes("content"))) return "geo-data";
  if (/map|geo|location|route/.test(value)) return "geo";
  if ((value.includes("commerce") || value.includes("catalog")) && (value.includes("orchestrator") || value.includes("planner"))) return "commerce-orchestrator";
  if (value.includes("orchestrator") || value.includes("builderx") || value.includes("fullstack")) return "orchestrator";
  if (value.includes("ui") || value.includes("composition") || value.includes("frontend")) return "ui";
  if (/content|copy|media|ocr|document/.test(value)) return "content";
  if (value.includes("data") || value.includes("database")) return "data";
  if (value.includes("runtime") || value.includes("packaging") || value.includes("docker") || value.includes("execution")) return "runtime";
  if (value.includes("commerce") || value.includes("catalog")) return "commerce";
  if (value.includes("analytics") || value.includes("signal") || value.includes("score")) return "analytics";
  return "agent";
}

function AgentGlyph({ kind }) {
  if (kind === "fullstack") {
    return (
      <g className="agent-glyph">
        <rect x="18" y="18" width="28" height="20" rx="4" />
        <path d="M22 25h20M24 32h8M18 43h28M24 43v5M32 38v10M40 43v5" />
        <circle cx="24" cy="48" r="2.4" />
        <circle cx="32" cy="48" r="2.4" />
        <circle cx="40" cy="48" r="2.4" />
      </g>
    );
  }
  if (kind === "execution") {
    return (
      <g className="agent-glyph">
        <path d="M22 22h20l4 7-14 13-14-13 4-7Z" />
        <path d="M27 31l4 4 8-9" />
        <path d="M20 45h24M25 45l-4 5M39 45l4 5" />
      </g>
    );
  }
  if (kind === "ocr") {
    return (
      <g className="agent-glyph">
        <rect x="18" y="20" width="28" height="24" rx="4" />
        <path d="M24 28h16M24 35h10M18 28h-4M50 28h-4M18 36h-4M50 36h-4" />
        <circle cx="40" cy="38" r="4" />
        <path d="M43 41l5 5" />
      </g>
    );
  }
  if (kind === "signal") {
    return (
      <g className="agent-glyph">
        <path d="M18 43h28M22 41c4-18 8-18 12 0s8 18 12 0" />
        <path d="M20 28h6M38 28h6M28 20l4-4 4 4" />
        <circle cx="32" cy="32" r="3" />
      </g>
    );
  }
  if (kind === "reply") {
    return (
      <g className="agent-glyph">
        <path d="M18 22h28v18H30l-8 7v-7h-4V22Z" />
        <path d="M25 30h14M25 36h9" />
        <path d="M42 42l4 4 6-9" />
      </g>
    );
  }
  if (kind === "geo-orchestrator") {
    return (
      <g className="agent-glyph">
        <path d="M32 48s12-11 12-21a12 12 0 1 0-24 0c0 10 12 21 12 21Z" />
        <path d="M32 21v12M26 27h12" />
        <circle cx="18" cy="18" r="3" />
        <circle cx="46" cy="18" r="3" />
        <circle cx="48" cy="43" r="3" />
        <path d="M21 19l7 4M43 20l-7 4M42 40l-7-5" />
      </g>
    );
  }
  if (kind === "geo-data") {
    return (
      <g className="agent-glyph">
        <path d="M20 22l9-4 11 4 8-3v25l-8 3-11-4-9 4V22Z" />
        <path d="M29 18v25M40 22v25" />
        <circle cx="34" cy="32" r="4" />
      </g>
    );
  }
  if (kind === "commerce-orchestrator") {
    return (
      <g className="agent-glyph">
        <path d="M20 27h24l-3 14H23l-3-14Z" />
        <path d="M25 27c1-6 4-9 7-9s6 3 7 9" />
        <path d="M32 31v8M28 35h8" />
        <circle cx="18" cy="45" r="3" />
        <circle cx="46" cy="45" r="3" />
        <path d="M23 41l-3 3M41 41l3 3" />
      </g>
    );
  }
  if (kind === "reviewer") {
    return <g className="agent-glyph"><path d="M20 19h19l7 7-15 20-15-20 4-7Z" /><path d="M24 31l5 5 11-13" /><circle cx="44" cy="19" r="4" /></g>;
  }
  if (kind === "security") {
    return <g className="agent-glyph"><path d="M32 16l14 6v10c0 9-6 15-14 18-8-3-14-9-14-18V22l14-6Z" /><path d="M26 32l4 4 9-10" /></g>;
  }
  if (kind === "testing") {
    return <g className="agent-glyph"><path d="M25 17h14M28 17v9L19 43c-2 4 1 7 5 7h16c4 0 7-3 5-7L36 26v-9" /><path d="M23 39h18M27 34l3 3 7-7" /></g>;
  }
  if (kind === "memory") {
    return <g className="agent-glyph"><path d="M24 19c-7 1-10 8-6 13-4 6 0 13 7 13 3 5 11 4 12-2 7 1 11-7 7-12 3-7-4-14-11-11-2-3-7-3-9-1Z" /><path d="M25 27h14M25 34h14M28 41h8" /></g>;
  }
  if (kind === "api") {
    return <g className="agent-glyph"><path d="M22 22h20v20H22z" /><path d="M16 27h6M16 37h6M42 27h6M42 37h6M27 16v6M37 16v6M27 42v6M37 42v6" /><path d="M27 34l4-4 6 6" /></g>;
  }
  if (kind === "content") {
    return <g className="agent-glyph"><path d="M20 18h17l7 7v22H20V18Z" /><path d="M37 18v8h7M25 31h14M25 37h14M25 43h9" /></g>;
  }
  if (kind === "voice") {
    return <g className="agent-glyph"><rect x="27" y="16" width="10" height="24" rx="5" /><path d="M21 32c0 7 4 12 11 12s11-5 11-12M32 44v6M25 50h14" /></g>;
  }
  if (kind === "geo") {
    return <g className="agent-glyph"><path d="M32 49s13-12 13-22a13 13 0 1 0-26 0c0 10 13 22 13 22Z" /><circle cx="32" cy="27" r="5" /></g>;
  }
  if (kind === "ui") {
    return (
      <g className="agent-glyph">
        <rect x="19" y="21" width="26" height="22" rx="4" />
        <path d="M24 28h8M25 36l-5-4 5-4M39 28l5 4-5 4M31 38l4-12" />
      </g>
    );
  }
  if (kind === "data") {
    return (
      <g className="agent-glyph">
        <ellipse cx="32" cy="21" rx="12" ry="5" />
        <path d="M20 21v18c0 3 5 5 12 5s12-2 12-5V21M20 30c0 3 5 5 12 5s12-2 12-5" />
        <path d="M43 40l4 4M47 44h4M47 44v4" />
      </g>
    );
  }
  if (kind === "runtime") {
    return (
      <g className="agent-glyph">
        <path d="M22 23h20l4 8-14 12-14-12 4-8Z" />
        <path d="M22 23l10 8 10-8M32 31v12" />
        <circle cx="22" cy="44" r="3" />
        <circle cx="42" cy="44" r="3" />
        <path d="M25 44h14" />
      </g>
    );
  }
  if (kind === "human") {
    return (
      <g className="agent-glyph">
        <circle cx="32" cy="24" r="7" />
        <path d="M19 45c3-8 8-12 13-12s10 4 13 12" />
        <path d="M20 24h-4M48 24h-4M18 34l-3 3M46 34l3 3" />
      </g>
    );
  }
  if (kind === "qagent") {
    return (
      <g className="agent-glyph">
        <circle cx="30" cy="30" r="12" />
        <path d="M38 38l7 7M25 29l4 4 9-10" />
        <path d="M18 18l4 4M42 18l-4 4" />
      </g>
    );
  }
  if (kind === "commerce") {
    return (
      <g className="agent-glyph">
        <path d="M20 26h25l-3 16H23l-3-16Z" />
        <path d="M25 26c1-6 4-9 8-9s7 3 8 9" />
        <circle cx="27" cy="46" r="2" />
        <circle cx="39" cy="46" r="2" />
      </g>
    );
  }
  if (kind === "analytics") {
    return (
      <g className="agent-glyph">
        <path d="M19 44h27M23 44V34M32 44V26M41 44V30" />
        <path d="M21 30l9-7 7 5 8-10" />
        <circle cx="30" cy="23" r="2" />
        <circle cx="37" cy="28" r="2" />
        <circle cx="45" cy="18" r="2" />
      </g>
    );
  }
  if (kind === "orchestrator") {
    return (
      <g className="agent-glyph">
        <path d="M32 18l10 6v11l-10 6-10-6V24l10-6Z" />
        <path d="M32 18v8M22 24l10 8 10-8M32 32v9" />
        <path d="M22 35l-7 6M42 35l7 6M22 24l-7-5M42 24l7-5" />
        <circle cx="15" cy="19" r="3" />
        <circle cx="49" cy="19" r="3" />
        <circle cx="15" cy="41" r="3" />
        <circle cx="49" cy="41" r="3" />
        <circle cx="32" cy="32" r="3.5" />
      </g>
    );
  }
  return (
    <g className="agent-glyph">
      <path d="M22 24l10-6 10 6v12l-10 6-10-6V24Z" />
      <path d="M22 24l10 6 10-6M32 30v12" />
      <circle cx="22" cy="44" r="3" />
      <circle cx="42" cy="44" r="3" />
      <circle cx="32" cy="48" r="3" />
      <path d="M24 43l6-4M40 43l-6-4M32 45v-4" />
    </g>
  );
}

function AgentAvatar({ visual, size = "medium", className = "" }) {
  const avatar = visual || agentVisualFromId("project-execution-agent");
  const label = `${avatar.name} profile image`;
  const instanceId = useId().replace(/:/g, "-");
  const safeId = `${String(avatar.id || "agent").replace(/[^a-zA-Z0-9_-]/g, "-")}-${instanceId}`;
  const kind = agentIconKind(avatar);
  return (
    <span
      className={`agent-avatar ${size} ${className} kind-${kind} variant-${avatar.variant || 0}`}
      style={{ "--agent-color": avatar.color, "--agent-accent": avatar.accent }}
      title={label}
      aria-label={label}
      role="img"
    >
      <svg viewBox="0 0 64 64" focusable="false" aria-hidden="true">
        <defs>
          <radialGradient id={`avatar-${safeId}-core`} cx="50%" cy="48%" r="58%">
            <stop stopColor="var(--agent-accent)" stopOpacity="0.42" />
            <stop offset="0.55" stopColor="var(--agent-color)" stopOpacity="0.3" />
            <stop offset="1" stopColor="#050b18" />
          </radialGradient>
          <linearGradient id={`avatar-${safeId}-ring`} x1="12" x2="52" y1="8" y2="56" gradientUnits="userSpaceOnUse">
            <stop stopColor="var(--agent-accent)" />
            <stop offset="1" stopColor="var(--agent-color)" />
          </linearGradient>
          <filter id={`avatar-${safeId}-glow`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <rect className="agent-avatar-shell" x="3.5" y="3.5" width="57" height="57" rx="18" />
        <circle className="agent-avatar-core" cx="32" cy="32" r="24" fill={`url(#avatar-${safeId}-core)`} />
        <circle className="agent-avatar-orbit outer" cx="32" cy="32" r="25" />
        <circle className="agent-avatar-orbit inner" cx="32" cy="32" r="18" />
        <path className="agent-avatar-link" d="M16 32h9M39 32h9M32 16v9M32 39v9" />
        <circle className="agent-avatar-node" cx="16" cy="32" r="2.1" />
        <circle className="agent-avatar-node" cx="48" cy="32" r="2.1" />
        <circle className="agent-avatar-node" cx="32" cy="16" r="2.1" />
        <circle className="agent-avatar-node" cx="32" cy="48" r="2.1" />
        <circle className="agent-avatar-ring" cx="32" cy="32" r="16" filter={`url(#avatar-${safeId}-glow)`} />
        <AgentGlyph kind={kind} />
        <text className="agent-avatar-monogram" x="49" y="53" textAnchor="middle">{String(avatar.initials || "AG").slice(0, 2)}</text>
      </svg>
    </span>
  );
}

function EventRow({ event, sessionStartedAt, selectedProject }) {
  const isCurrentSession = sessionStartedAt && new Date(event.createdAt || 0).getTime() >= sessionStartedAt;
  const isPromptEvent = ["instruction", "orchestrator-prompt"].includes(event.type);
  const visual = agentVisualFromEvent(event, selectedProject);
  return (
    <li className={`event-row ${isCurrentSession ? "current-session" : ""} ${event.progressGroup ? "codex-progress-row" : ""}`}>
      <AgentAvatar visual={visual} size="tiny" />
      <div>
        <strong>{displayEventType(event.type)} · {visual.name}</strong>
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

function ChatMessage({ event, selectedProject }) {
  const detailParts = [event.stage, event.path, event.buildId ? `build ${String(event.buildId).replace("build_", "")}` : null].filter(Boolean);
  const isUser = event.role === "user";
  const isCurrentSession = event.currentSession;
  const visual = agentVisualFromEvent(event, selectedProject);
  const thread = event.activityThread || [];
  return (
    <li className={`chat-message ${isUser ? "user-message" : "codex-message"} ${isCurrentSession ? "current-session" : ""} ${event.type || ""}`}>
      <div className="chat-avatar">
        {isUser ? <UserRound size={15} /> : <AgentAvatar visual={visual} size="tiny" />}
      </div>
      <div className="chat-bubble">
        <div className="chat-meta">
          <strong>{isUser ? "You" : visual.name}</strong>
          <time>{formatIstTime(event.createdAt)}</time>
        </div>
        <p>{gothamText(event.message)}</p>
        {thread.length ? (
          <div className="chat-activity-thread">
            <span>{thread.length + 1} related {displayEventType(event.activityThreadType || event.type)} updates</span>
            <ol>
              {[event, ...thread].slice(0, 5).map((item) => (
                <li key={item.id || `${item.type}-${item.createdAt}`}>
                  <time>{formatIstTime(item.createdAt)}</time>
                  <span>{gothamText(item.message)}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {!isUser ? <small>{visual.label}</small> : null}
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

function activityThreadType(event) {
  if (event.role === "user") return "";
  if (event.type === "codex-progress") return "gotham-progress";
  if (event.type === "file-plan-item") return "file-plan-item";
  if (["request-received", "orchestrated", "generating", "codex-start", "codex-complete", "files-applied", "generated"].includes(event.type)) {
    return "workflow-status";
  }
  if (String(event.type || "").startsWith("project-")) return "project-status";
  return event.type || "";
}

function collapseAgentActivityThreads(rows, selectedProject) {
  const collapsed = [];
  for (const row of rows) {
    const threadType = activityThreadType(row);
    const visual = agentVisualFromEvent(row, selectedProject);
    const buildId = row.buildId || "";
    const previous = collapsed.at(-1);
    const previousThreadType = activityThreadType(previous || {});
    const previousVisual = previous ? agentVisualFromEvent(previous, selectedProject) : null;
    const secondsApart = previous
      ? Math.abs(new Date(previous.createdAt || 0).getTime() - new Date(row.createdAt || 0).getTime()) / 1000
      : Infinity;
    const sameThread =
      threadType &&
      previousThreadType === threadType &&
      previousVisual?.id === visual.id &&
      (previous?.buildId || "") === buildId &&
      secondsApart <= 180;

    if (sameThread) {
      previous.activityThread = [...(previous.activityThread || []), row];
      previous.activityThreadType = threadType;
      continue;
    }
    collapsed.push(row);
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

function compactNumber(value) {
  return new Intl.NumberFormat("en", { notation: Number(value || 0) >= 10000 ? "compact" : "standard" }).format(Number(value || 0));
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 6 }).format(Number(value || 0));
}

function shortDate(value) {
  if (!value) return "No runs";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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
  const visual = agentVisualFromRecord(agent);
  const tokenTimeline = agent.tokenEconomy?.timeline?.length ? agent.tokenEconomy.timeline : [];
  const efficiencyTimeline = tokenTimeline.filter((row) => row.efficiencyScore || row.accuracyValue || row.abilityScore);
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
          <AgentAvatar visual={visual} size="large" />
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

          <section className="agent-card agent-token-economy-card">
            <div className="section-heading">
              <Gauge size={18} />
              <h2>Token Economy</h2>
            </div>
            <div className="token-economy-grid">
              <div>
                <span>Total</span>
                <strong>{compactNumber(agent.tokenEconomy?.totalTokens)}</strong>
              </div>
              <div>
                <span>Input</span>
                <strong>{compactNumber(agent.tokenEconomy?.inputTokens)}</strong>
              </div>
              <div>
                <span>Output</span>
                <strong>{compactNumber(agent.tokenEconomy?.outputTokens)}</strong>
              </div>
              <div>
                <span>Input cost</span>
                <strong>{money(agent.tokenEconomy?.inputEstimatedUsd)}</strong>
              </div>
              <div>
                <span>Output cost</span>
                <strong>{money(agent.tokenEconomy?.outputEstimatedUsd)}</strong>
              </div>
              <div>
                <span>Avg / run</span>
                <strong>{compactNumber(agent.tokenEconomy?.averageTotalTokens)}</strong>
              </div>
              <div>
                <span>Est. expense</span>
                <strong>{money(agent.tokenEconomy?.estimatedUsd)}</strong>
              </div>
              <div>
                <span>Avg expense</span>
                <strong>{money(agent.tokenEconomy?.averageUsd)}</strong>
              </div>
              <div>
                <span>Avg accuracy</span>
                <strong>{agent.tokenEconomy?.averageAccuracyValue || 0}</strong>
              </div>
              <div>
                <span>Avg efficiency</span>
                <strong>{agent.tokenEconomy?.averageEfficiencyScore || 0}</strong>
              </div>
              <div>
                <span>Ability</span>
                <strong>{agent.tokenEconomy?.averageAbilityScore || agent.efficiency?.capability || 0}</strong>
              </div>
              <div>
                <span>Tokens / accuracy</span>
                <strong>{compactNumber(agent.tokenEconomy?.tokensPerAccuracyPoint)}</strong>
              </div>
              <div>
                <span>Expense / accuracy</span>
                <strong>{money(agent.tokenEconomy?.usdPerAccuracyPoint)}</strong>
              </div>
            </div>
            <div className="token-economy-timeline" aria-label="Token economy timeline">
              {(tokenTimeline.length ? tokenTimeline : [{ totalTokens: 0, inputTokens: 0, outputTokens: 0, estimatedUsd: 0, createdAt: "" }]).map((row, index, rows) => {
                const max = Math.max(...rows.map((item) => Number(item.totalTokens || 0)), 1);
                const height = Math.max(8, Math.round((Number(row.totalTokens || 0) / max) * 58));
                return (
                  <span
                    key={`${row.createdAt || "empty"}-${index}`}
                    style={{ "--bar-height": `${height}px` }}
                    title={`${row.createdAt || "No runs yet"} · ${compactNumber(row.totalTokens)} tokens · ${money(row.estimatedUsd)}`}
                  />
                );
              })}
            </div>
            <div className="agent-efficiency-timeline" aria-label="Agentic efficiency timeline">
              {(efficiencyTimeline.length ? efficiencyTimeline : [{ efficiencyScore: 0, accuracyValue: 0, abilityScore: 0, createdAt: "" }]).map((row, index, rows) => {
                const max = Math.max(...rows.map((item) => Number(item.efficiencyScore || 0)), 1);
                const height = Math.max(8, Math.round((Number(row.efficiencyScore || 0) / max) * 58));
                return (
                  <span
                    key={`${row.createdAt || "eff-empty"}-${index}`}
                    style={{ "--bar-height": `${height}px` }}
                    title={`${row.createdAt || "No runs yet"} · efficiency ${row.efficiencyScore || 0}/100 · accuracy ${row.accuracyValue || 0}/100 · ability ${row.abilityScore || 0}/100`}
                  />
                );
              })}
            </div>
            {tokenTimeline.length ? (
              <div className="token-execution-list">
                {tokenTimeline.slice().reverse().slice(0, 6).map((row) => (
                  <div key={`${row.buildId}-${row.createdAt}`}>
                    <span>
                      {shortDate(row.createdAt)}
                      {row.taskType ? ` · ${row.taskType}` : ""}
                    </span>
                    <strong>{money(row.estimatedUsd)}</strong>
                    <small>
                      {compactNumber(row.inputTokens)} in · {compactNumber(row.outputTokens)} out · {compactNumber(row.totalCredits)} credits
                      {row.inputCredits !== undefined ? ` · in cost ${compactNumber(row.inputCredits)} cr` : ""}
                      {row.outputCredits !== undefined ? ` · out cost ${compactNumber(row.outputCredits)} cr` : ""}
                      {row.accuracyValue ? ` · accuracy ${row.accuracyValue}/100` : ""}
                      {row.efficiencyScore ? ` · efficiency ${row.efficiencyScore}/100` : ""}
                      {row.costModel ? ` · ${row.costModel}` : ""}
                    </small>
                  </div>
                ))}
              </div>
            ) : null}
            <p>
              {agent.tokenEconomy?.totalRuns
                ? `${agent.tokenEconomy.totalRuns} recorded run${agent.tokenEconomy.totalRuns === 1 ? "" : "s"} using local token estimates and OpenAI Codex credit-rate math. Subscription fees are flat account costs, so per-run expense is shown as estimated usage value.`
                : "No token usage has been recorded for this agent yet."}
            </p>
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
                        <AgentAvatar visual={agentVisualFromRecord(agent)} size="table" />
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
                    <td>
                      <span className="agent-used-cell">
                        <strong>{agent.tokenEconomy?.totalRuns || agent.usageCount || 0}</strong>
                        <small>{agent.tokenEconomy?.lastRunAt ? shortDate(agent.tokenEconomy.lastRunAt) : "No recent run"}</small>
                      </span>
                    </td>
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

function TechStackTopologySvg({ snapshot, categoryById, progress, variant = "compact", selectedStepId = "" }) {
  const graphId = useId().replace(/:/g, "-");
  const isLarge = variant === "large";
  const architectureRows = [
    { id: "frontend", x: 34, y: 40, width: 150, height: 62, lane: "Client" },
    { id: "backend", x: 220, y: 40, width: 150, height: 62, lane: "API" },
    { id: "services", x: 406, y: 40, width: 150, height: 62, lane: "Agent services" },
    { id: "database", x: 220, y: 144, width: 150, height: 62, lane: "Persistence" },
    { id: "cloud", x: 406, y: 144, width: 150, height: 62, lane: "Runtime" }
  ];
  const architectureLinks = [
    ["frontend", "backend"],
    ["backend", "services"],
    ["backend", "database"],
    ["services", "cloud"],
    ["database", "cloud"]
  ];
  const rowById = new Map(architectureRows.map((row) => [row.id, row]));
  const linkPath = (fromId, toId) => {
    const from = rowById.get(fromId);
    const to = rowById.get(toId);
    if (!from || !to) return "";
    if (from.x === to.x) {
      const startX = from.x + from.width / 2;
      const startY = from.y + from.height;
      const endY = to.y;
      return `M ${startX} ${startY} L ${startX} ${endY}`;
    }
    const startX = from.x + from.width;
    const startY = from.y + from.height / 2;
    const endX = to.x;
    const endY = to.y + to.height / 2;
    return `M ${startX} ${startY} L ${endX} ${endY}`;
  };

  return (
    <svg className={`tech-stack-graph ${variant}`} viewBox="0 0 720 260" role="img" aria-label={`${snapshot.projectName} frontend backend database cloud services architecture`}>
      <defs>
        <marker id={`tech-stack-arrow-${graphId}`} markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
          <path className="tech-stack-arrow-head" d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>
      <g className="tech-stack-architecture-boundary">
        <rect x="18" y="18" width="684" height="224" rx="14" />
        <text x="34" y="31">{isLarge ? `${snapshot.projectName} architecture` : "High-level architecture"}</text>
      </g>
      <g className="tech-stack-architecture-links">
        {architectureLinks.map(([from, to]) => (
          <path key={`${from}-${to}`} d={linkPath(from, to)} markerEnd={`url(#tech-stack-arrow-${graphId})`} />
        ))}
      </g>
      <g className="tech-stack-architecture-progress">
        <rect x="592" y="42" width="78" height="164" rx="10" />
        <text x="631" y="70">Progress</text>
        <text x="631" y="97">{progress}%</text>
        <line x1="612" y1="184" x2="650" y2="184" />
        <line x1="612" y1={184 - Math.round(progress * 1.08)} x2="650" y2={184 - Math.round(progress * 1.08)} />
      </g>
      {architectureRows.map((row) => {
        const category = categoryById.get(row.id) || { label: displayEventType(row.id), items: [], state: "planned" };
        const stackNode = techStackNodeById.get(row.id);
        const StackIcon = stackNode?.icon || Code2;
        const color = stackNode?.color || "#475569";
        return (
          <g
            className={`tech-stack-architecture-block ${category.state} ${selectedStepId === row.id ? "selected" : ""}`}
            key={row.id}
            style={{ "--stack-color": color }}
            transform={`translate(${row.x} ${row.y})`}
          >
            <rect width={row.width} height={row.height} rx="8" />
            <g className="tech-stack-architecture-icon">
              <rect x="10" y="13" width="34" height="34" rx="7" />
              <StackIcon x={18} y={21} width={18} height={18} strokeWidth={2.2} />
            </g>
            <text className="tech-stack-architecture-lane" x="52" y="17">{row.lane}</text>
            <text className="tech-stack-architecture-title" x="52" y="35">{category.label}</text>
            <text className="tech-stack-architecture-detail" x="52" y="51">{isLarge ? stackText(category.items) || "Pending" : stackText(category.items).slice(0, 21) || "Pending"}</text>
          </g>
        );
      })}
    </svg>
  );
}

function ProjectTechStackGraph({ snapshots, selectedIndex, onSelectIndex, hasProject }) {
  const [isModalOpen, setModalOpen] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState("frontend");
  const snapshot = snapshots[selectedIndex] || snapshots.at(-1) || buildTechStackSnapshot({});
  const categoryById = new Map(snapshot.categories.map((category) => [category.id, category]));
  const flowSteps = serviceFlowSteps(snapshot);
  const selectedStep = flowSteps.find((step) => step.id === selectedStepId) || flowSteps[0];
  const progress = Math.max(0, Math.min(100, Number(snapshot.progress || 0)));
  const timelineLabel = snapshots.length > 1
    ? `${selectedIndex + 1}/${snapshots.length} · ${shortDate(snapshot.createdAt)}`
    : shortDate(snapshot.createdAt);

  return (
    <section className="tech-stack-panel" aria-label="Generated project technology stack">
      <div className="tech-stack-header">
        <div>
          <span>D3 stack topology</span>
          <strong>{hasProject ? snapshot.projectName : "Empty canvas"}</strong>
        </div>
        <div className="tech-stack-header-actions">
          <small>{hasProject ? (snapshot.buildId ? `Build ${snapshot.buildId.slice(-8)}` : snapshot.status) : "Select a project"}</small>
          <button className="tech-stack-expand" type="button" onClick={() => setModalOpen(true)} disabled={!hasProject}>
            <Maximize2 size={14} />
            Expand
          </button>
        </div>
      </div>
      {hasProject ? (
        <div className="tech-stack-graph-wrap">
          <button className="tech-stack-graph-button" type="button" onClick={() => setModalOpen(true)} aria-label="Open technology stack topology in larger view">
            <TechStackTopologySvg snapshot={snapshot} categoryById={categoryById} progress={progress} />
            <span>Open architecture</span>
          </button>
          <div className="tech-stack-cards high-level">
            {flowSteps.map((step) => {
              const stackNode = techStackNodeById.get(step.id);
              const StackIcon = stackNode?.icon || Code2;
              return (
                <article className={`tech-stack-card ${step.state || "planned"}`} key={step.id} style={{ "--stack-color": stackNode?.color }}>
                  <StackIcon className="tech-stack-card-icon" size={16} aria-hidden="true" />
                  <span>{step.label}</span>
                  <strong>{stackText(step.items)}</strong>
                </article>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="tech-stack-empty-canvas">
          <GitBranch size={24} />
          <strong>No project selected</strong>
          <span>Select a project to show its service control flow and stack topology.</span>
        </div>
      )}
      <div className="tech-stack-timeline">
        <label htmlFor="tech-stack-progress">Progress over time</label>
        <input
          id="tech-stack-progress"
          type="range"
          min="0"
          max={Math.max(0, snapshots.length - 1)}
          value={Math.min(selectedIndex, Math.max(0, snapshots.length - 1))}
          onChange={(event) => onSelectIndex(Number(event.target.value))}
          disabled={!hasProject || snapshots.length <= 1}
        />
        <span>{timelineLabel}</span>
      </div>
      {isModalOpen && hasProject ? (
        <div className="modal-backdrop agent-modal-backdrop" role="presentation" onMouseDown={() => setModalOpen(false)}>
          <section className="agent-modal tech-stack-modal" role="dialog" aria-modal="true" aria-label={`${snapshot.projectName} technology stack topology`} onMouseDown={(event) => event.stopPropagation()}>
            <header className="agent-modal-header">
              <div className="tech-stack-modal-mark">
                <GitBranch size={24} />
              </div>
              <div>
                <span>D3 stack topology</span>
                <h2>{snapshot.projectName}</h2>
                <p>{snapshot.buildId ? `Build ${snapshot.buildId}` : snapshot.status} · Progress {progress}% · {timelineLabel}</p>
              </div>
              <button className="icon-button" type="button" onClick={() => setModalOpen(false)} aria-label="Close technology stack topology">
                <X size={18} />
              </button>
            </header>
            <div className="tech-stack-control-detail">
              <div className="tech-stack-architecture-column">
                <div className="tech-stack-architecture-stage">
                  <TechStackTopologySvg snapshot={snapshot} categoryById={categoryById} progress={progress} variant="large" selectedStepId={selectedStep?.id} />
                </div>
                <div className="service-control-flow" aria-label="Detailed service architecture flow">
                  {flowSteps.map((step) => {
                    const stackNode = techStackNodeById.get(step.id);
                    const StackIcon = stackNode?.icon || Code2;
                    return (
                      <button
                        type="button"
                        className={`service-flow-block ${selectedStep?.id === step.id ? "active" : ""} ${step.state || "planned"}`}
                        key={step.id}
                        onClick={() => setSelectedStepId(step.id)}
                        style={{ "--stack-color": stackNode?.color }}
                      >
                        <i><StackIcon size={16} aria-hidden="true" /></i>
                        <strong>{step.label}</strong>
                        <span>{stackText(step.items)}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <aside className="service-insight-panel">
                <span>Insight panel</span>
                <h3>{selectedStep.label}</h3>
                <p>{selectedStep.insight}</p>
                <p className="service-insight-description">
                  {selectedStep.label} is shown as an architecture layer in the topology. Its stack choices define how the generated project moves from user experience, through orchestration, into persistence, integrations, and runtime deployment.
                </p>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedStep.state || "planned"}</dd>
                  </div>
                  <div>
                    <dt>Stack</dt>
                    <dd>{stackText(selectedStep.items) || "Pending"}</dd>
                  </div>
                  <div>
                    <dt>Progress</dt>
                    <dd>{progress}%</dd>
                  </div>
                </dl>
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function ProjectInstructionTimeline({ instructions, error }) {
  const visibleInstructions = instructions;
  const oldestIndex = visibleInstructions.length - 1;
  const expansionValue = (item, index) => {
    if (index === oldestIndex) return "Genesis";
    const fileScore = Array.isArray(item.changedFiles) ? item.changedFiles.length * 2 : 0;
    const scopeScore = item.taskType === "Large" ? 8 : item.taskType === "Medium" ? 5 : 3;
    const textScore = Math.min(12, Math.ceil(String(item.instruction || "").length / 220));
    return `+${Math.max(1, fileScore + scopeScore + textScore)} expansion`;
  };
  return (
    <section className="instruction-history-card" aria-label="Project instruction history">
      <div className="section-heading">
        <GitBranch size={16} />
        <h2>Project instructions</h2>
      </div>
      {error ? <p className="instruction-history-error">{error}</p> : null}
      <ol>
        {visibleInstructions.length ? (
          visibleInstructions.map((item, index) => {
            const failed = item.status === "failed";
            const isInitiation = index === oldestIndex;
            return (
              <li className={`instruction-history-row ${failed ? "failed" : "succeeded"}`} key={`${item.projectId || item.projectName}-${item.recordedAt}-${index}`}>
                <span className={`instruction-history-status ${isInitiation ? "initiation" : ""}`}>
                  {isInitiation ? <FolderUp size={14} /> : failed ? <XCircle size={14} /> : <GitBranch size={14} />}
                </span>
                <div>
                  <strong>{item.projectName || "BuilderX default workspace"}</strong>
                  <small>
                    {shortDate(item.recordedAt)} · {item.taskType || "Medium"} · {item.status || "received"}
                    {item.buildId ? ` · ${String(item.buildId).slice(-8)}` : ""}
                  </small>
                  <em>{expansionValue(item, index)}</em>
                  <p>{item.instruction}</p>
                  {item.flowPath?.activeAgents?.length ? (
                    <div className="instruction-agent-roster" aria-label="Agents used for this instruction">
                      {item.flowPath.activeAgents.map((agent) => (
                        <span key={agent.id} title={`${agent.name}: ${agent.action || agent.role}`}>
                          <AgentAvatar visual={agentVisualFromId(agent.id, { name: agent.name })} size="tiny" />
                          {agent.name}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })
        ) : (
          <li className="empty-state">Project instructions will appear here by time.</li>
        )}
      </ol>
    </section>
  );
}

function flowAgentCount(nodes = [], executedDecisions = []) {
  const agentTerms = /agent|orchestrator|qagent|human|gotham/i;
  const agentIds = new Set();
  [...nodes, ...executedDecisions].forEach((item) => {
    const value = `${item.id || ""} ${item.label || ""} ${item.value || ""} ${item.reason || ""}`;
    if (agentTerms.test(value)) agentIds.add(item.id || item.label || item.value);
  });
  return agentIds.size;
}

function flowFunctionalityCount(nodes = [], subObjectives = [], executedDecisions = []) {
  return [...nodes, ...subObjectives, ...executedDecisions].filter((item) => item?.id || item?.label).length;
}

function flowTraversalScore({ confidence, nodes, executedDecisions }) {
  const completed = nodes.filter((node) => ["completed", "selected"].includes(node.state)).length;
  const completionScore = nodes.length ? Math.round((completed / nodes.length) * 25) : 0;
  const decisionScore = Math.min(15, executedDecisions.length * 5);
  return Math.min(100, Math.round(Number(confidence || 0) * 0.6 + completionScore + decisionScore));
}

function DecisionTreeBranch({ node, depth = 0 }) {
  if (!node) return null;
  const isAgent = node.type === "agent";
  return (
    <li className={`adaptive-tree-node ${node.state || "pending"}`}>
      <div className="adaptive-tree-node-content">
        {isAgent ? <AgentAvatar visual={agentVisualFromId(node.id, { name: node.label })} size="table" /> : <GitBranch size={14} />}
        <div>
          <strong>{node.label || node.id}</strong>
          {node.role ? <span>{node.role}</span> : null}
          {node.detail || node.reason || node.action ? <small>{node.detail || node.reason || node.action}</small> : null}
        </div>
        <em>{node.state || node.type}</em>
      </div>
      {node.children?.length ? (
        <ul>{node.children.map((child) => <DecisionTreeBranch node={child} depth={depth + 1} key={`${node.id}-${child.id}`} />)}</ul>
      ) : null}
    </li>
  );
}

function OrchestrationD3Canvas({ snapshot }) {
  const svgRef = useRef(null);
  const viewportRef = useRef(null);
  const [selectedDatum, setSelectedDatum] = useState(null);
  const [agentRecords, setAgentRecords] = useState([]);
  const visualForAgent = (agentId) => {
    const snapshotAgent = (snapshot?.agents || []).find((agent) => agent.id === agentId);
    const record = agentRecords.find((agent) => agent.id === agentId) || agentRecords.find((agent) => snapshotAgent?.name && agent.name === snapshotAgent.name);
    if (record) return agentVisualFromRecord(record);
    return agentVisualFromId(agentId || "builderx-fullstack-agent", snapshotAgent || {});
  };

  useEffect(() => {
    let cancelled = false;
    fetch(`${BACKEND_URL}/api/agents/global`)
      .then((response) => response.json())
      .then((data) => { if (!cancelled) setAgentRecords(Array.isArray(data.agents) ? data.agents : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!snapshot || !svgRef.current || !viewportRef.current) return undefined;
    const svg = d3.select(svgRef.current);
    const viewport = viewportRef.current;
    const fallbackChoices = [
      ...(snapshot.selectedDecisions || []).map((item) => ({ ...item, state: "selected", responsibleAgentId: item.responsibleAgentId || "builderx-fullstack-agent" })),
      ...(snapshot.rejectedDecisions || []).map((item) => ({ ...item, label: item.label || item.id, detail: item.reason, state: "rejected", responsibleAgentId: item.responsibleAgentId || "builderx-fullstack-agent" }))
    ];
    const legacySelections = fallbackChoices.filter((item) => item.state === "selected");
    const legacyRejections = fallbackChoices.filter((item) => item.state === "rejected");
    const buildLegacyStage = (index = 0) => {
      const selection = legacySelections[index];
      if (!selection) return null;
      const rejectionStart = Math.floor((index * legacyRejections.length) / Math.max(1, legacySelections.length));
      const rejectionEnd = Math.floor(((index + 1) * legacyRejections.length) / Math.max(1, legacySelections.length));
      const selectedChoice = { ...selection, id: `legacy-selected-${index}-${selection.id}`, type: "choice", children: [] };
      const nextStage = buildLegacyStage(index + 1);
      if (nextStage) selectedChoice.children.push(nextStage);
      return {
        id: `legacy-stage-${index}`,
        label: selection.label || `Decision ${index + 1}`,
        type: "decision",
        state: "recorded",
        responsibleAgentId: selection.responsibleAgentId,
        children: [
          selectedChoice,
          ...legacyRejections.slice(rejectionStart, rejectionEnd).map((item, rejectionIndex) => ({ ...item, id: `legacy-rejected-${index}-${rejectionIndex}-${item.id}`, type: "choice", children: [] }))
        ]
      };
    };
    const graph = snapshot.decisionGraph || {
      id: `${snapshot.id}-start`, label: "Build instruction accepted", type: "start", state: "selected", responsibleAgentId: "builderx-fullstack-agent",
      children: [buildLegacyStage()].filter(Boolean)
    };
    const hierarchy = d3.hierarchy(graph);
    const leafCount = Math.max(1, hierarchy.leaves().length);
    const width = Math.max(viewport.clientWidth || 900, (hierarchy.height + 1) * 285 + 160);
    const height = Math.max(560, leafCount * 124 + 100);
    d3.tree().nodeSize([124, 285])(hierarchy);
    const minTreeX = d3.min(hierarchy.descendants(), (item) => item.x) || 0;
    const allNodes = hierarchy.descendants().map((item) => ({
      ...item.data,
      graphId: item.data.id,
      x: item.y + 72,
      y: item.x - minTreeX + 55,
      kind: item.data.type === "choice" ? item.data.state : item.data.type,
      agentId: item.data.responsibleAgentId || "builderx-fullstack-agent"
    }));
    const nodeById = new Map(allNodes.map((item) => [item.graphId, item]));
    const links = hierarchy.links().map((link) => ({
      source: nodeById.get(link.source.data.id),
      target: nodeById.get(link.target.data.id),
      kind: link.target.data.state || link.target.data.type || "recorded"
    }));

    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("height", height);
    const root = svg.append("g").attr("class", "orchestration-d3-root");
    const linkPath = (link) => {
      const midpoint = (link.source.x + link.target.x) / 2;
      return `M${link.source.x},${link.source.y} C${midpoint},${link.source.y} ${midpoint},${link.target.y} ${link.target.x},${link.target.y}`;
    };
    const linkSelection = root.append("g").selectAll("path").data(links).join("path")
      .attr("class", (link) => `d3-flow-link ${link.kind}`)
      .attr("d", linkPath);
    const node = root.append("g").selectAll("g").data(allNodes).join("g")
      .attr("class", (item) => `d3-flow-node ${item.kind} ${item.state || "recorded"}`)
      .attr("transform", (item) => `translate(${item.x},${item.y})`)
      .attr("tabindex", 0)
      .attr("role", "button")
      .on("click", (_event, item) => setSelectedDatum(item))
      .on("keydown", (event, item) => {
        if (event.key === "Enter" || event.key === " ") setSelectedDatum(item);
      });
    node.append("rect").attr("class", "d3-decision-card").attr("x", -110).attr("y", -39).attr("width", 220).attr("height", 78).attr("rx", 11);
    const avatarRoots = [];
    node.append("foreignObject")
      .attr("x", -12)
      .attr("y", 46)
      .attr("width", 24)
      .attr("height", 24)
      .each(function renderNodeAgent(item) {
        const mount = document.createElement("div");
        mount.className = "d3-agent-icon-mount";
        mount.title = `Inspect ${visualForAgent(item.agentId).name}`;
        mount.onpointerdown = (event) => event.stopPropagation();
        mount.onclick = (event) => {
          event.stopPropagation();
          const workRecord = (snapshot.agentWork || []).find((record) => record.agentId === item.agentId);
          setSelectedDatum({
            kind: "agent-insight",
            state: item.state,
            agentId: item.agentId || "builderx-fullstack-agent",
            label: workRecord?.name || visualForAgent(item.agentId).name,
            detail: workRecord?.role || "Responsible agent",
            work: workRecord?.work || [item.detail || item.reason || item.label].filter(Boolean)
          });
        };
        this.appendChild(mount);
        const avatarRoot = createRoot(mount);
        avatarRoot.render(<AgentAvatar visual={visualForAgent(item.agentId)} size="tiny" />);
        avatarRoots.push(avatarRoot);
      });
    node.append("text")
      .attr("class", "d3-flow-node-type")
      .attr("text-anchor", "middle")
      .attr("y", -16)
      .text((item) => displayEventType(item.kind || item.type));
    node.append("text")
      .attr("class", "d3-flow-node-label")
      .attr("text-anchor", "middle")
      .each(function wrapNodeLabel(item) {
        const words = String(item.label || "").split(/\s+/).filter(Boolean);
        const lines = [""];
        for (const word of words) {
          const candidate = `${lines.at(-1)} ${word}`.trim();
          if (candidate.length > 28 && lines.length < 3) lines.push(word);
          else lines[lines.length - 1] = candidate;
        }
        if (lines.length === 3 && lines[2].length > 28) lines[2] = `${lines[2].slice(0, 27)}…`;
        d3.select(this).selectAll("tspan").data(lines).join("tspan")
          .attr("x", 0)
          .attr("dy", (_line, index) => index === 0 ? 4 : 15)
          .text((line) => line);
      });
    node.call(d3.drag()
      .on("start", (event) => event.sourceEvent?.stopPropagation())
      .on("drag", function moveNode(event, item) {
        item.x = event.x;
        item.y = event.y;
        d3.select(this).attr("transform", `translate(${item.x},${item.y})`);
        linkSelection.attr("d", linkPath);
      })
      .on("end", (_event, item) => setSelectedDatum(item)));
    const zoom = d3.zoom().scaleExtent([0.55, 2.4]).on("zoom", (zoomEvent) => root.attr("transform", zoomEvent.transform));
    svg.call(zoom).call(zoom.transform, d3.zoomIdentity);
    return () => {
      svg.on(".zoom", null);
      avatarRoots.forEach((avatarRoot) => avatarRoot.unmount());
    };
  }, [agentRecords, snapshot]);

  if (!snapshot) return <div className="d3-flow-empty">No orchestration snapshot is available for this build.</div>;
  return (
    <div className="orchestration-d3-shell">
      <div className="orchestration-d3-toolbar">
        <div className="d3-flow-legend">
          <span className="selected">Selected</span><span className="rejected">Rejected</span><span className="agent">Agent</span><span className="failed">Failed</span>
        </div>
        <small>Drag nodes to arrange · drag background to pan · scroll to zoom</small>
      </div>
      <div className="orchestration-d3-workspace">
        <div className="orchestration-d3-viewport" ref={viewportRef}>
          <svg ref={svgRef} aria-label={`Orchestrator execution canvas for ${snapshot.snapshotBuildId || snapshot.buildId}`} />
        </div>
        <aside className={`d3-flow-inspector ${selectedDatum ? "visible" : ""}`}>
        {selectedDatum ? (
          <>
            <div>
              <span className="d3-inspector-agent"><AgentAvatar visual={visualForAgent(selectedDatum.agentId)} size="tiny" /><b>{selectedDatum.label || displayEventType(selectedDatum.type)}</b></span>
              <em>{selectedDatum.state || selectedDatum.kind}</em>
            </div>
            <p>{selectedDatum.detail || selectedDatum.reason || selectedDatum.message || "No additional evidence recorded."}</p>
            {selectedDatum.kind === "agent-insight" && selectedDatum.work?.length ? (
              <ul className="d3-agent-work-list">
                {selectedDatum.work.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ul>
            ) : null}
            {selectedDatum.kind !== "agent-insight" && selectedDatum.type === "choice" ? (
              <small className="d3-feature-evidence">{selectedDatum.state === "rejected" ? "This option was not generated." : "This selection contributed to the generated build."}</small>
            ) : null}
            <small>{selectedDatum.agentId ? `Agent: ${selectedDatum.agentId} · ` : ""}{selectedDatum.createdAt ? shortDate(selectedDatum.createdAt) : ""}</small>
          </>
        ) : <div className="d3-inspector-empty"><GitBranch size={22} /><b>Insights</b><p>Select a decision card or agent icon to inspect its evidence.</p></div>}
        </aside>
      </div>
    </div>
  );
}

function ProjectFlowPanel({ projectId = "", flowPath, decisionHistory = [], expanded, running, onToggle, onHumanChoice }) {
  const [detailPage, setDetailPage] = useState(() => typeof window !== "undefined" && window.location.hash === "#execution-snapshot" ? "snapshot" : "");
  const [historyCursor, setHistoryCursor] = useState(0);
  const [isHistoryPlaying, setHistoryPlaying] = useState(false);
  const [selectedSnapshotIndex, setSelectedSnapshotIndex] = useState(0);
  const historyStorageKey = `builderx-flow-path-history:${projectId || String(flowPath?.projectName || "builderx-default").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const [pathHistory, setPathHistory] = useState(() => {
    try {
      const scopedValue = localStorage.getItem(historyStorageKey);
      const legacy = JSON.parse(localStorage.getItem("builderx-flow-path-history") || "[]");
      const stored = scopedValue
        ? JSON.parse(scopedValue)
        : (Array.isArray(legacy) ? legacy.filter((entry) => entry.projectName === flowPath?.projectName) : []);
      return Array.isArray(stored) ? stored.slice(-20) : [];
    } catch {
      return [];
    }
  });
  const nodes = flowPath?.nodes?.length ? flowPath.nodes : defaultProjectFlowNodes;
  const subObjectives = flowPath?.subObjectives?.length ? flowPath.subObjectives : defaultSubObjectiveFlow;
  const executedDecisions = flowPath?.executedDecisions || [];
  const rejectedPaths = flowPath?.rejectedPaths || [];
  const activeAgents = flowPath?.activeAgents || [];
  const functionalities = flowPath?.functionalities || [];
  const featureActions = flowPath?.featureActions || [];
  const decisionTree = flowPath?.decisionTree || null;
  const persistedDecisionHistory = useMemo(
    () => decisionHistory.filter((entry) => entry?.flowPath?.decisionTree),
    [decisionHistory]
  );
  const buildSnapshots = useMemo(() => persistedDecisionHistory.map((entry) => entry.orchestrationSnapshot || {
    schemaVersion: 0,
    id: `${entry.parentWorkflowId || entry.buildId || entry.recordedAt}:legacy`,
    snapshotBuildId: entry.buildId || `legacy_${String(entry.parentWorkflowId || "build").slice(-10)}`,
    buildId: entry.buildId || "",
    parentWorkflowId: entry.parentWorkflowId || "",
    projectId: entry.projectId || projectId,
    projectName: entry.projectName,
    instruction: entry.instruction,
    taskType: entry.taskType,
    status: entry.status,
    startedAt: entry.recordedAt,
    completedAt: entry.recordedAt,
    durationMs: 0,
    route: entry.adaptiveRoute,
    agents: entry.flowPath?.activeAgents || [],
    selectedDecisions: entry.flowPath?.executedDecisions || [],
    rejectedDecisions: entry.flowPath?.rejectedPaths || [],
    decisionTree: entry.flowPath?.decisionTree || null,
    changedFiles: entry.changedFiles || [],
    validation: { status: entry.status === "succeeded" ? "passed" : "failed", error: entry.error || "" },
    timeline: [{
      id: `${entry.parentWorkflowId || entry.buildId || entry.recordedAt}-terminal`,
      sequence: 1,
      type: entry.status === "succeeded" ? "builderx-complete" : "builderx-failed",
      message: entry.error || `Legacy ${entry.status} build snapshot`,
      createdAt: entry.recordedAt,
      elapsedMs: 0,
      agentId: "builderx-fullstack-agent",
      status: entry.status
    }]
  }).reverse(), [persistedDecisionHistory, projectId]);
  const selectedBuildSnapshot = buildSnapshots[selectedSnapshotIndex] || buildSnapshots.at(-1) || null;
  const selectedNode = nodes.find((node) => node.state === "selected") || nodes.find((node) => node.id === flowPath?.selectedPath);
  const summary =
    flowPath?.summary ||
    (running ? "BuilderX is selecting the project creation path." : "Project creation path is ready for review.");
  const confidence = Number(flowPath?.confidence || (running ? 68 : 0));
  const agentCount = flowAgentCount(nodes, executedDecisions);
  const functionalityCount = flowFunctionalityCount(nodes, subObjectives, executedDecisions);
  const traversalScore = flowTraversalScore({ confidence, nodes, executedDecisions });
  const orderedPathHistory = useMemo(() => pathHistory.slice(), [pathHistory]);
  const activeHistoryEntry = orderedPathHistory[historyCursor] || orderedPathHistory.at(-1) || null;
  const canPlayHistory = orderedPathHistory.length > 1;
  const historyKey = [
    flowPath?.projectName || "Project creation",
    selectedNode?.id || flowPath?.selectedPath || "none",
    flowPath?.status || "ready",
    confidence,
    traversalScore
  ].join(":");
  const flowStatusIcon = (state) => {
    if (state === "completed") return <CheckCircle2 className="flow-status-icon success" size={16} aria-label="Completed" />;
    if (state === "blocked" || state === "failed") return <XCircle className="flow-status-icon failed" size={16} aria-label="Failed" />;
    return null;
  };

  const openDetailPage = (page) => {
    setDetailPage(page);
    if (page === "snapshot" && window.location.hash !== "#execution-snapshot") {
      window.history.pushState({ flowPage: "execution-snapshot" }, "", "#execution-snapshot");
    }
  };

  const closeDetailPage = () => {
    if (detailPage === "snapshot" && window.location.hash === "#execution-snapshot") {
      window.history.back();
      return;
    }
    setDetailPage("");
  };

  useEffect(() => {
    const syncPageFromHistory = () => setDetailPage(window.location.hash === "#execution-snapshot" ? "snapshot" : "");
    window.addEventListener("popstate", syncPageFromHistory);
    return () => window.removeEventListener("popstate", syncPageFromHistory);
  }, []);

  useEffect(() => {
    if (!selectedNode) return;
    setPathHistory((current) => {
      if (current.at(-1)?.key === historyKey) return current;
      const next = [
        ...current,
        {
          key: historyKey,
          recordedAt: new Date().toISOString(),
          projectName: flowPath?.projectName || "Project creation",
          selectedPath: selectedNode.label || selectedNode.id,
          status: flowPath?.status || "ready",
          traversalScore,
          agentCount,
          functionalityCount
        }
      ].slice(-20);
      localStorage.setItem(historyStorageKey, JSON.stringify(next));
      return next;
    });
  }, [agentCount, flowPath?.projectName, flowPath?.status, functionalityCount, historyKey, historyStorageKey, selectedNode, traversalScore]);

  useEffect(() => {
    if (!orderedPathHistory.length) {
      setHistoryCursor(0);
      setHistoryPlaying(false);
      return;
    }
    setHistoryCursor((current) => Math.min(current, orderedPathHistory.length - 1));
  }, [orderedPathHistory.length]);

  useEffect(() => {
    if (detailPage && orderedPathHistory.length) {
      setHistoryCursor(orderedPathHistory.length - 1);
    }
    if (detailPage && buildSnapshots.length) {
      setSelectedSnapshotIndex(buildSnapshots.length - 1);
    }
  }, [buildSnapshots.length, detailPage, orderedPathHistory.length]);

  useEffect(() => {
    if (!isHistoryPlaying || !canPlayHistory) return undefined;
    const timer = window.setInterval(() => {
      setHistoryCursor((current) => {
        if (current >= orderedPathHistory.length - 1) {
          setHistoryPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [canPlayHistory, isHistoryPlaying, orderedPathHistory.length]);

  const flowDetailModal =
    detailPage && typeof document !== "undefined"
      ? createPortal(
          <div className={detailPage === "snapshot" ? "flow-route-page" : "modal-backdrop agent-modal-backdrop flow-detail-backdrop"} role={detailPage === "snapshot" ? undefined : "presentation"} onMouseDown={detailPage === "snapshot" ? undefined : closeDetailPage}>
            <section className={`${detailPage === "snapshot" ? "flow-route-surface" : "agent-modal"} flow-detail-modal ${detailPage}-page`} role={detailPage === "snapshot" ? "main" : "dialog"} aria-modal={detailPage === "snapshot" ? undefined : "true"} aria-label={`${detailPage} flow page`} onMouseDown={(event) => event.stopPropagation()}>
              <header className="agent-modal-header">
                <div className="flow-detail-mark">
                  <GitBranch size={24} />
                </div>
                <div>
                  <span>{detailPage === "decision" ? "Decision path" : "Execution snapshot"}</span>
                  <h2>{flowPath?.projectName || "Project creation"}</h2>
                  <p>{selectedNode ? `Selected path: ${selectedNode.label}` : "No selected path yet"} · Score {traversalScore}/100</p>
                </div>
                <button className="icon-button" type="button" onClick={closeDetailPage} aria-label={detailPage === "snapshot" ? "Back to BuilderX" : "Close flow path detail"}>
                  {detailPage === "snapshot" ? <ChevronRight className="flow-back-icon" size={18} /> : <X size={18} />}
                </button>
              </header>
              <div className="flow-detail-body">
                {detailPage === "decision" ? <>
                <div className="flow-selected-path-card">
                  <span>Selected path</span>
                  <strong>{selectedNode?.label || flowPath?.selectedPath || "Not selected"}</strong>
                  <p>{selectedNode?.detail || summary}</p>
                </div>
                <div className="flow-detail-metrics">
                  <div>
                    <span>Traversal score</span>
                    <strong>{traversalScore}/100</strong>
                  </div>
                  <div>
                    <span>Total agents</span>
                    <strong>{agentCount}</strong>
                  </div>
                  <div>
                    <span>Total functionalities</span>
                    <strong>{functionalityCount}</strong>
                  </div>
                  <div>
                    <span>History</span>
                    <strong>{pathHistory.length}</strong>
                  </div>
                </div>
                </> : null}
                {detailPage === "snapshot" ? (
                <section className="flow-build-canvas-card" aria-label="Build orchestration snapshots">
                  <header>
                    <div>
                      <span>Execution snapshot</span>
                      <strong>{selectedBuildSnapshot?.snapshotBuildId || "No build recorded"}</strong>
                      <small>
                        {selectedBuildSnapshot
                          ? `${selectedBuildSnapshot.status} · ${selectedBuildSnapshot.timeline?.length || 0} timed events · ${selectedBuildSnapshot.agents?.length || 0} agents`
                          : "Run an instruction to create the first snapshot."}
                      </small>
                    </div>
                    {buildSnapshots.length ? (
                      <select value={selectedSnapshotIndex} onChange={(event) => setSelectedSnapshotIndex(Number(event.target.value))} aria-label="Select build snapshot">
                        {buildSnapshots.map((snapshot, index) => (
                          <option value={index} key={snapshot.id || snapshot.snapshotBuildId}>
                            {snapshot.status === "succeeded" ? "✓" : "×"} {snapshot.snapshotBuildId} · {shortDate(snapshot.completedAt)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </header>
                  <OrchestrationD3Canvas snapshot={selectedBuildSnapshot} />
                </section>
                ) : null}
                {detailPage === "decision" ? (
                <div className="flow-tree-layout flow-history-layout">
                  <div className="flow-tree-card">
                    <h3>Adaptive decision tree</h3>
                    {decisionTree ? <ul className="adaptive-decision-tree"><DecisionTreeBranch node={decisionTree} /></ul> : <ul className="flow-tree">
                      <li>
                        <span className="tree-root">{flowPath?.projectName || "Project creation"}</span>
                        <ul>
                          <li>
                            <span>Sub objectives</span>
                            <ul>
                              {subObjectives.map((item) => (
                                <li className={item.state || "pending"} key={item.id || item.label}>
                                  <span>{item.label}</span>
                                  <small>{item.detail}</small>
                                </li>
                              ))}
                            </ul>
                          </li>
                          <li>
                            <span>Path traversal</span>
                            <ul>
                              {nodes.map((node) => (
                                <li className={`${node.state || "pending"} ${node.id === selectedNode?.id ? "current" : ""}`} key={node.id}>
                                  <span>{node.label}</span>
                                  <small>{node.detail}</small>
                                </li>
                              ))}
                            </ul>
                          </li>
                          {executedDecisions.length ? (
                            <li>
                              <span>Executed decisions</span>
                              <ul>
                                {executedDecisions.map((decision) => (
                                  <li className="completed" key={decision.id || decision.label}>
                                    <span>{decision.label}</span>
                                    <small>{decision.reason}</small>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ) : null}
                          {rejectedPaths.length ? (
                            <li>
                              <span>Rejected paths</span>
                              <ul>
                                {rejectedPaths.map((pathOption) => (
                                  <li className="disabled" key={pathOption.id || pathOption.reason}>
                                    <span>{pathOption.id}</span>
                                    <small>{pathOption.reason}</small>
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ) : null}
                        </ul>
                      </li>
                    </ul>}
                  </div>
                  <div className="flow-history-card">
                    <h3>Decision history over time</h3>
                    <div className="flow-history-runtime" aria-label="Selected path history runtime">
                      <button
                        className="icon-button flow-history-play"
                        type="button"
                        onClick={() => {
                          if (isHistoryPlaying) {
                            setHistoryPlaying(false);
                            return;
                          }
                          if (historyCursor >= orderedPathHistory.length - 1) {
                            setHistoryCursor(0);
                          }
                          setHistoryPlaying(true);
                        }}
                        disabled={!canPlayHistory}
                        aria-label={isHistoryPlaying ? "Pause selected path history" : "Play selected path history"}
                        title={isHistoryPlaying ? "Pause" : "Play"}
                      >
                        {isHistoryPlaying ? <Pause size={16} /> : <Play size={16} />}
                      </button>
                      <div className="flow-history-slider-wrap">
                        <div className="flow-history-current">
                          <strong>{activeHistoryEntry?.selectedPath || "No history yet"}</strong>
                          <span>
                            {activeHistoryEntry
                              ? `${shortDate(activeHistoryEntry.recordedAt)} · Score ${activeHistoryEntry.traversalScore}/100`
                              : "Selected paths will appear after execution."}
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(0, orderedPathHistory.length - 1)}
                          value={Math.min(historyCursor, Math.max(0, orderedPathHistory.length - 1))}
                          disabled={!orderedPathHistory.length}
                          onChange={(event) => {
                            setHistoryPlaying(false);
                            setHistoryCursor(Number(event.target.value));
                          }}
                          aria-label="Scrub selected path history"
                        />
                        <div className="flow-history-runtime-meta">
                          <span>{orderedPathHistory.length ? historyCursor + 1 : 0}</span>
                          <span>{orderedPathHistory.length}</span>
                        </div>
                      </div>
                    </div>
                    <ol>
                      {persistedDecisionHistory.map((entry) => (
                        <li key={`${entry.recordedAt}-${entry.parentWorkflowId || entry.buildId}`}>
                          <strong>{entry.flowPath?.adaptiveRoute?.mode || entry.flowPath?.selectedPath || "workflow"}</strong>
                          <span>{shortDate(entry.recordedAt)} · {entry.taskType}</span>
                          <small>{entry.instruction}</small>
                          <small>{entry.flowPath?.activeAgents?.length || 0} agents · {entry.flowPath?.featureActions?.length || entry.changedFiles?.length || 0} actions</small>
                        </li>
                      ))}
                      {orderedPathHistory.slice().reverse().map((entry) => (
                        <li className={entry.key === activeHistoryEntry?.key ? "active" : ""} key={entry.key}>
                          <strong>{entry.selectedPath}</strong>
                          <span>{shortDate(entry.recordedAt)} · {entry.projectName}</span>
                          <small>Score {entry.traversalScore}/100 · {entry.agentCount} agents · {entry.functionalityCount} functionalities</small>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
                ) : null}
              </div>
            </section>
          </div>,
          document.body
        )
      : null;

  return (
    <section className={`project-flow-panel ${expanded ? "expanded" : "collapsed"} ${running ? "running" : ""}`} aria-label="Project creation flow path">
      <button className="project-flow-toggle" type="button" onClick={onToggle} aria-expanded={expanded} title={expanded ? "Collapse flow path" : "Expand flow path"}>
        {expanded ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        <GitBranch size={17} />
        <span>Flow path</span>
        {!expanded && selectedNode ? <b>{selectedNode.label}</b> : null}
      </button>
      {expanded ? (
        <div className="project-flow-body flow-matrix-only">
          <div className="flow-matrix-heading">
            <div><strong>{flowPath?.projectName || "Project creation"}</strong><span>Orchestration matrix</span></div>
            <b className={flowPath?.status || "idle"}>{flowPath?.status || "idle"}</b>
          </div>
          <dl className="path-score-grid" aria-label="Flow path matrix">
            <div><dt>Traversal</dt><dd>{traversalScore}/100</dd></div>
            <div><dt>Confidence</dt><dd>{confidence || 0}%</dd></div>
            <div><dt>Agents</dt><dd>{activeAgents.length || agentCount}</dd></div>
            <div><dt>Builds</dt><dd>{buildSnapshots.length}</dd></div>
            <div><dt>Selected</dt><dd>{executedDecisions.length}</dd></div>
            <div><dt>Rejected</dt><dd>{rejectedPaths.length}</dd></div>
          </dl>
          <div className="flow-page-actions">
            <button type="button" onClick={() => openDetailPage("decision")}>
              <GitBranch size={16} /><span><strong>Decision path</strong><small>Choices, reasons and history</small></span><ChevronRight size={15} />
            </button>
            <button type="button" onClick={() => openDetailPage("snapshot")}>
              <Activity size={16} /><span><strong>Execution snapshot</strong><small>Movable sequential graph</small></span><ChevronRight size={15} />
            </button>
          </div>
        </div>
      ) : null}
      {flowDetailModal}
    </section>
  );
}

export default function App() {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState("builder");
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
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
  const [projectInstructions, setProjectInstructions] = useState([]);
  const [instructionsError, setInstructionsError] = useState("");
  const [techStackSnapshots, setTechStackSnapshots] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("builderx-tech-stack-snapshots") || "[]");
      return Array.isArray(stored) ? stored.slice(-12) : [];
    } catch {
      return [];
    }
  });
  const [techStackIndex, setTechStackIndex] = useState(0);
  const [isGenerating, setGenerating] = useState(false);
  const [projectName, setProjectName] = useState("Bag commerce studio");
  const [projectResult, setProjectResult] = useState(null);
  const [projectFlowPath, setProjectFlowPath] = useState(null);
  const [isFlowExpanded, setFlowExpanded] = useState(false);
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
  const [resolvedTheme, setResolvedTheme] = useState(() => document.documentElement.dataset.theme || "light");
  const [isGoogleSsoReady, setGoogleSsoReady] = useState(false);
  const [googleSignInMessage, setGoogleSignInMessage] = useState("");
  const previewFrameRef = useRef(null);
  const googleIdentityRef = useRef(null);
  const googleButtonRef = useRef(null);

  const selectedProject = selectedProjectId ? projects.find((project) => project.id === selectedProjectId) : null;
  const selectedPreviewUrl = selectedProject?.previewUrl || "";
  const previewDevice = devicePresets.find((device) => device.id === previewDeviceId) || devicePresets.at(-1);
  const recommendedPalette = useMemo(
    () => recommendBrandPalette(`${instruction}\n${selectedProject?.name || projectName}`),
    [instruction, projectName, selectedProject?.name]
  );
  const activePalette = brandingPalette?.name === "Custom"
    ? { name: "Custom", colors: customPalette, reason: "Custom palette selected manually." }
    : brandingPalette || recommendedPalette;
  const activeAppIcon = selectedProject?.appIcon || selectedProject?.media?.find((item) => item.purpose === "app-icon");
  const canSubmit = Boolean(selectedProject) && instruction.trim().length > 12 && !isGenerating;
  const canCreateProject = projectName.trim().length > 1 && !isCreatingProject && !selectedProject;
  const workflowRunning = isGenerating || generatedStatus === "working" || isCreatingProject || isSelectingProject;
  const mcpWorkflowRunning = isGenerating || isCreatingProject;
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || import.meta.env.GOOGLE_CLIENT_ID;
  const latestPersistedFlowPath = projectInstructions.find((entry) => (!selectedProjectId || entry.projectId === selectedProjectId) && entry?.flowPath?.decisionTree)?.flowPath || null;
  const activeProjectFlowPath = projectResult?.flowPath || projectFlowPath || latestPersistedFlowPath;
  const selectedProjectFlowPath = activeProjectFlowPath || (selectedProject ? {
    projectName: selectedProject.name,
    status: "idle",
    summary: "No adaptive flow has been recorded for this project yet.",
    selectedPath: "none",
    nodes: defaultProjectFlowNodes.map((node) => ({ ...node, state: "pending", detail: "Waiting for this project's first instruction." })),
    subObjectives: defaultSubObjectiveFlow.map((node) => ({ ...node, state: "pending", detail: "No project-specific execution recorded." })),
    activeAgents: [],
    functionalities: [],
    featureActions: [],
    executedDecisions: [],
    rejectedPaths: []
  } : null);
  const showExpandedFlow = isFlowExpanded || isCreatingProject;
  const currentTechStackSnapshot = useMemo(
    () =>
      buildTechStackSnapshot({
        project: selectedProject,
        lastBuild,
        flowPath: activeProjectFlowPath,
        generatedStatus
      }),
    [activeProjectFlowPath, generatedStatus, lastBuild, selectedProject]
  );
  const visibleTechStackSnapshots = useMemo(() => {
    if (!selectedProject) return [currentTechStackSnapshot];
    const rows = techStackSnapshots.filter((snapshot) => snapshot.projectId === selectedProject.id);
    return rows.length ? rows : [currentTechStackSnapshot];
  }, [currentTechStackSnapshot, selectedProject, techStackSnapshots]);

  useEffect(() => {
    if (!selectedProject) return;
    setTechStackSnapshots((current) => {
      const previous = current.at(-1);
      if (previous?.key === currentTechStackSnapshot.key) return current;
      return [...current, currentTechStackSnapshot].slice(-24);
    });
  }, [currentTechStackSnapshot, selectedProject]);

  useEffect(() => {
    if (visibleTechStackSnapshots.length) setTechStackIndex(visibleTechStackSnapshots.length - 1);
  }, [selectedProject?.id, visibleTechStackSnapshots.length]);

  useEffect(() => {
    localStorage.setItem("builderx-tech-stack-snapshots", JSON.stringify(techStackSnapshots.slice(-24)));
  }, [techStackSnapshots]);

  useEffect(() => {
    function syncUser(event) {
      setCurrentUser(event.detail || getStoredUser());
      setSelectedProjectId("");
      setProjects([]);
    }
    window.addEventListener("builderx-user-updated", syncUser);
    return () => window.removeEventListener("builderx-user-updated", syncUser);
  }, []);

  useEffect(() => {
    setGoogleSsoReady(false);
    setGoogleSignInMessage("");
    googleIdentityRef.current = null;
    if (currentUser) return undefined;
    if (!googleClientId) {
      setGoogleSignInMessage("Google client ID is missing. Set VITE_GOOGLE_CLIENT_ID or GOOGLE_CLIENT_ID and restart the frontend.");
      return undefined;
    }
    let attempts = 0;
    const initializeGoogleSso = () => {
      const identity = window.google?.accounts?.id;
      if (!identity) return false;
      identity.initialize({
        client_id: googleClientId,
        ux_mode: "popup",
        cancel_on_tap_outside: true,
        callback: async (credentialResponse) => {
          try {
            if (!credentialResponse?.credential) throw new Error("Google did not return a sign-in credential.");
            const res = await fetch(`${BACKEND_URL}/api/auth/google`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ credential: credentialResponse.credential })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Google sign in failed");
            storeUser(data.user);
          } catch (error) {
            setRuntimeLogs((current) =>
              mergeRuntimeRows([{ id: `auth-${Date.now()}`, type: "error", message: error.message, createdAt: new Date().toISOString(), time: formatIstTime() }], current)
            );
          }
        }
      });
      googleIdentityRef.current = identity;
      if (googleButtonRef.current) {
        googleButtonRef.current.innerHTML = "";
        identity.renderButton(googleButtonRef.current, {
          type: "standard",
          theme: resolvedTheme === "dark" ? "filled_black" : "outline",
          size: "medium",
          text: "signin_with",
          shape: "rectangular"
        });
      }
      setGoogleSsoReady(true);
      setGoogleSignInMessage("");
      return true;
    };
    if (initializeGoogleSso()) return undefined;
    const retry = window.setInterval(() => {
      attempts += 1;
      if (initializeGoogleSso()) {
        window.clearInterval(retry);
        return;
      }
      if (attempts > 24) {
        window.clearInterval(retry);
        setGoogleSignInMessage("Google sign-in script did not initialize. Check network access to accounts.google.com and restart the frontend if the client ID changed.");
      }
    }, 250);
    return () => window.clearInterval(retry);
  }, [currentUser, resolvedTheme, googleClientId]);

  function startGoogleSignIn() {
    const identity = googleIdentityRef.current;
    if (!identity) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `auth-${Date.now()}`,
              type: "error",
              message:
                googleSignInMessage ||
                `Google sign-in is not ready from ${window.location.origin}. Add this exact JavaScript origin in Google Cloud Console and restart the frontend.`,
              createdAt: new Date().toISOString(),
              time: formatIstTime()
            }
          ],
          current
        )
      );
      return;
    }
    identity.prompt((notification) => {
      if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
        setRuntimeLogs((current) =>
          mergeRuntimeRows(
            [
              {
                id: `auth-${Date.now()}`,
                type: "error",
                message: `Google sign-in could not open from ${window.location.origin}. Add this exact JavaScript origin to the OAuth client in Google Cloud Console.`,
                createdAt: new Date().toISOString(),
                time: formatIstTime()
              }
            ],
            current
          )
        );
      }
    });
  }

  async function useLocalProfile() {
    const name = window.prompt("Name for this local BuilderX profile", "Local BuilderX User");
    if (!name) return;
    const user = {
      id: `local:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "user"}`,
      name,
      email: "",
      authProvider: "local-dev"
    };
    storeUser(user);
  }

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const resolvedTheme = themeMode === "system" ? (media.matches ? "dark" : "light") : themeMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themeMode = themeMode;
      setResolvedTheme(resolvedTheme);
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
    () => collapseAgentActivityThreads(markCurrentSession(normalizeRuntimeRows([...runtimeLogs, ...chatPrompts]).slice(0, 80), sessionStartedAt), selectedProject),
    [chatPrompts, runtimeLogs, selectedProject, sessionStartedAt]
  );
  const activeChatAgent = useMemo(() => {
    const activeEvent =
      chatMessages.find((event) => event.currentSession && event.role !== "user" && event.type !== "connected") ||
      chatMessages.find((event) => event.role !== "user" && event.type !== "connected");
    return activeEvent ? agentVisualFromEvent(activeEvent, selectedProject) : agentVisualFromId("builderx-fullstack-agent", { name: "BuilderX Fullstack Agent" });
  }, [chatMessages, selectedProject]);

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
    const res = await authFetch(`${BACKEND_URL}/api/projects`);
    const data = await res.json();
    if (Array.isArray(data.projects)) {
      setProjects(data.projects);
      if (selectedProjectId && !data.projects.some((project) => project.id === selectedProjectId)) {
        setSelectedProjectId("");
      }
    }
  }

  async function loadProjectInstructions(projectId = selectedProjectId) {
    setInstructionsError("");
    try {
      const url = projectId
        ? `${BACKEND_URL}/api/project-instructions?projectId=${encodeURIComponent(projectId)}`
        : `${BACKEND_URL}/api/project-instructions`;
      const res = await authFetch(url);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Project instructions could not be loaded.");
      setProjectInstructions(Array.isArray(data.instructions) ? data.instructions : []);
    } catch (error) {
      setInstructionsError(error.message);
      setProjectInstructions([]);
    }
  }

  useEffect(() => {
    loadProjects().catch(() => setProjects([]));
  }, [currentUser?.id]);

  useEffect(() => {
    loadProjectInstructions(selectedProjectId).catch(() => {});
  }, [selectedProjectId, currentUser?.id]);

  const exportUrl = selectedProject
    ? `${BACKEND_URL}/api/projects/${selectedProject.id}/export?userId=${encodeURIComponent(currentUser?.id || "")}&userName=${encodeURIComponent(currentUser?.name || "")}`
    : undefined;

  useEffect(() => {
    if (selectedProject && !selectedProject.isDefault) setProjectName(selectedProject.name);
    setProjectFlowPath(null);
    setProjectResult(null);
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
      const res = await authFetch(`${BACKEND_URL}/api/projects/${projectId}/select`, {
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

  function chooseHumanFlowPath(choice) {
    const applyChoice = (flow) => {
      if (!flow) return flow;
      return {
        ...flow,
        summary: `Human Agent selected ${choice.label}.`,
        humanInLoop: {
          ...(flow.humanInLoop || {}),
          required: false,
          choice: choice.id,
          choiceLabel: choice.label,
          choiceImpact: choice.impact
        },
        nextRecommendation: choice.impact
      };
    };
    setProjectFlowPath((current) => applyChoice(current));
    setProjectResult((current) => (current ? { ...current, flowPath: applyChoice(current.flowPath || projectFlowPath) } : current));
  }

  useEffect(() => {
    let cancelled = false;
    let source;
    let reconnectTimer;
    let pollTimer;
    let runtimeDisconnected = false;

    async function loadRuntimeLog() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/runtime-log`);
        if (!res.ok) throw new Error(`Runtime log request failed with ${res.status}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data.logs)) {
          setRuntimeLogs((current) => mergeRuntimeRows(data.logs, current));
          runtimeDisconnected = false;
        }
      } catch {
        if (!cancelled && !runtimeDisconnected) {
          runtimeDisconnected = true;
          const errorRow = {
            id: "runtime-log-disconnected",
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
        if (event.type === "adaptive-route-selected" && event.adaptiveRoute) {
          setProjectFlowPath((current) => {
            const projectLabel = event.projectName || current?.projectName || "Selected project";
            const projectAgentId = agentIdFromProjectName(projectLabel);
            const workingAgents = [
              { id: "builderx-fullstack-agent", name: "BuilderX Fullstack Agent", role: "Canonical authority", status: "working", action: "Selecting and supervising the adaptive execution path." },
              ...(event.adaptiveRoute.mode === "single" ? [] : [{ id: projectAgentId, name: `${projectLabel} Orchestrator Agent`, role: "Bounded project executor", status: "working", action: "Executing the selected project task." }]),
              ...(event.adaptiveRoute.requiresIndependentReview ? [{ id: "builderx-independent-reviewer", name: "BuilderX Independent Reviewer", role: "Read-only validator", status: "pending", action: "Will independently inspect execution evidence." }] : [])
            ];
            const routeChoices = ["single", "delegated", "delegated_reviewed"].map((mode) => ({
              id: mode,
              label: mode.replaceAll("_", " "),
              type: mode === event.adaptiveRoute.mode ? "decision" : "rejection",
              state: mode === event.adaptiveRoute.mode ? "selected" : "rejected",
              reason: mode === event.adaptiveRoute.mode ? event.adaptiveRoute.reasons?.join(" ") : "Not selected by the current task, risk, and model-call constraints."
            }));
            return {
              ...(current || {}),
              projectName: projectLabel,
              status: "running",
              selectedPath: "builderx-global-orchestration",
              adaptiveRoute: event.adaptiveRoute,
              activeAgents: workingAgents,
              decisionTree: {
                id: event.parentWorkflowId || `route-${Date.now()}`,
                label: `${projectLabel} adaptive workflow`,
                type: "workflow",
                state: "selected",
                children: [
                  { id: "adaptive-routing", label: `Adaptive route: ${event.adaptiveRoute.mode}`, type: "decision", state: "selected", children: routeChoices },
                  { id: "working-agents", label: "Working agents", type: "agents", state: "selected", children: workingAgents.map((agent) => ({ ...agent, label: agent.name, type: "agent", state: agent.status })) },
                  { id: "selected-functionalities", label: "Selected features and functionalities", type: "functionalities", state: "pending", detail: "Feature evidence will appear as the execution produces changes." },
                  { id: "rejected-choices", label: "Rejected or not selected", type: "rejections", state: "completed", children: routeChoices.filter((choice) => choice.state === "rejected") }
                ]
              },
              summary: `Adaptive route ${event.adaptiveRoute.mode} selected with ${event.adaptiveRoute.plannedModelCalls} planned model call${event.adaptiveRoute.plannedModelCalls === 1 ? "" : "s"}.`
            };
          });
        }
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
    const submittedInstruction = [
      baseInstruction,
      activePalette ? `Branding colours: ${activePalette.name} (${activePalette.colors.join(", ")}). ${activePalette.reason || "Selected manually."} Use these as brand direction while maintaining accessible text/background contrast.` : "",
      activeAppIcon ? `Use uploaded app icon asset "${activeAppIcon.name}" at ${activeAppIcon.urlPath || activeAppIcon.path}.` : ""
    ].filter(Boolean).join("\n\n");
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
    const runningFlowPath = gothamChatFlowPath({
      projectName: selectedProject && !selectedProject.isDefault ? selectedProject.name : "BuilderX default workspace",
      taskType,
      useProjectOrchestrator: Boolean(selectedProject && !selectedProject.isDefault)
    });
    setFlowExpanded(true);
    setProjectFlowPath(runningFlowPath);
    setProjectResult((current) => ({
      ...(current || {}),
      status: "running",
      projectName: runningFlowPath.projectName,
      flowPath: runningFlowPath
    }));
    setGenerating(true);
    setGeneratedStatus("working");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/generate`, {
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
      if (data.flowPath) {
        setProjectFlowPath(data.flowPath);
        setProjectResult((current) => ({
          ...(current || {}),
          status: data.status || "succeeded",
          projectName: data.flowPath.projectName,
          flowPath: data.flowPath
        }));
      }
      if (!res.ok) throw new Error(gothamText(data.error || "Gotham MCP workflow failed"));
      setLastBuild(data);
      await loadProjects();
      await loadProjectInstructions(selectedProjectId);
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
      const markFlowFailed = (current) => ({
        ...(current || runningFlowPath),
        status: "failed",
        selectedPath: "human-choice-review",
        summary: "Gotham chat instruction failed. Human Agent review is the next decision point.",
        humanInLoop: {
          required: true,
          reason: "A human choice is needed before retrying or changing the development path.",
          choices: [
            { id: "retry-same-path", label: "Retry same path", impact: "Use the same workflow path again." },
            { id: "simplify-scope", label: "Simplify scope", impact: "Reduce requirements before retrying." },
            { id: "change-architecture", label: "Change architecture", impact: "Choose a different technical direction before generation." }
          ]
        },
        nextRecommendation: "Choose retry, simplify scope, or change architecture."
      });
      setProjectFlowPath((current) => markFlowFailed(current));
      setProjectResult((current) => ({
        ...(current || {}),
        status: "failed",
        projectName: (current?.flowPath || runningFlowPath).projectName,
        flowPath: markFlowFailed(current?.flowPath)
      }));
      await loadProjectInstructions(selectedProjectId);
    } finally {
      setGenerating(false);
      setFlowExpanded(false);
      setGeneratedStatus("ready");
    }
  }

  async function createNewProject() {
    if (!canCreateProject) return;
    const startedAt = Date.now();
    const baseInstruction = instruction.trim();
    const submittedInstruction = [
      baseInstruction,
      activePalette ? `Branding colours: ${activePalette.name} (${activePalette.colors.join(", ")}). ${activePalette.reason || "Selected manually."} Use these as brand direction while maintaining accessible text/background contrast.` : "",
      activeAppIcon ? `Use uploaded app icon asset "${activeAppIcon.name}" at ${activeAppIcon.urlPath || activeAppIcon.path}.` : ""
    ].filter(Boolean).join("\n\n");
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
    setFlowExpanded(true);
    setProjectFlowPath({
      status: "running",
      selectedPath: "project-local-orchestrator",
      confidence: 68,
      projectName: projectName.trim(),
      taskType,
      summary: "BuilderX is selecting the project-local creation path and preparing Gotham handoff.",
      humanInLoop: { required: false, reason: "" },
      nodes: defaultProjectFlowNodes.map((node) => ({
        ...node,
        state:
          node.id === "intake" || node.id === "path-selection"
            ? "completed"
            : node.id === "project-local-orchestrator"
              ? "selected"
              : node.id === "template-only" || node.id === "human-choice-review"
                ? "disabled"
                : "pending"
      })),
      nextRecommendation: "Wait for Gotham generation to finish, then review the preview and generated files."
    });
    setProjectResult({ status: "running", projectName: projectName.trim(), previewUrl: selectedPreviewUrl });
    if (submittedInstruction.length > 12) setInstruction("");
    try {
      const res = await authFetch(`${BACKEND_URL}/api/projects/new`, {
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
      if (data.flowPath) setProjectFlowPath(data.flowPath);
      if (!res.ok) throw new Error(data.error || "Project creation failed");
      await loadProjects();
      await loadProjectInstructions(data.project?.id || selectedProjectId);
      applyReadyProject(data.project);
    } catch (error) {
      setProjectResult((current) => ({
        ...(current || { projectName: projectName.trim(), previewUrl: GENERATED_SITE_URL }),
        status: "failed",
        error: error.message,
        flowPath: current?.flowPath || projectFlowPath
      }));
      await loadProjectInstructions(selectedProjectId);
    } finally {
      setCreatingProject(false);
      setFlowExpanded(false);
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
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}/media`, {
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

  async function uploadAppIcon(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedProject || selectedProject.isDefault) return;
    setUploadingMedia(true);
    try {
      const body = new FormData();
      body.append("media", file);
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}/media?purpose=app-icon`, {
        method: "POST",
        body
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "App icon upload failed");
      await loadProjects();
      setProjectResult({
        status: "succeeded",
        projectName: selectedProject.name,
        container: `App icon uploaded: ${file.name}`
      });
    } catch (error) {
      setRuntimeLogs((current) =>
        mergeRuntimeRows(
          [
            {
              id: `app-icon-error-${Date.now()}`,
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
      const res = await authFetch(`${BACKEND_URL}/api/projects/import`, {
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
      const res = await authFetch(`${BACKEND_URL}/api/projects/${selectedProject.id}`, { method: "DELETE" });
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
        <button
          type="button"
          className={activeWorkspaceTab === "hosting" ? "active" : ""}
          onClick={() => setActiveWorkspaceTab("hosting")}
          aria-selected={activeWorkspaceTab === "hosting"}
        >
          <Server size={15} />
          Cloud Hosting
        </button>
        <div className="theme-switch" role="radiogroup" aria-label="Theme">
          {themeOptions.map((option) => {
            const ThemeIcon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                className={themeMode === option.id ? "active" : ""}
                onClick={() => setThemeMode(option.id)}
                role="radio"
                aria-checked={themeMode === option.id}
                aria-label={`${option.label} theme`}
                title={`${option.label} theme`}
              >
                <ThemeIcon size={15} />
              </button>
            );
          })}
        </div>
        {mcpWorkflowRunning ? <span className="workspace-running"><i />Gotham workflow running</span> : null}
        <div className="user-profile-control">
          {currentUser ? (
            <>
              <span title={currentUser.id}><UserRound size={14} />{currentUser.name}<small>{currentUser.id}</small></span>
              <button type="button" onClick={clearUser}>Sign out</button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="google-login-button"
                onClick={startGoogleSignIn}
                title={isGoogleSsoReady ? "Sign in with Google" : googleSignInMessage || "Google sign-in is not ready"}
              >
                <svg className="google-mark" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l3.66-2.84z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06L5.84 9.9C6.71 7.3 9.14 5.38 12 5.38z" />
                </svg>
                <span className="google-login-label">Sign in with Google</span>
              </button>
              <div ref={googleButtonRef} className="google-rendered-button" aria-label="Google sign-in button" />
              <button type="button" className="dev-profile-button" onClick={useLocalProfile} aria-label="Use local profile" title={googleSignInMessage || "Use local profile"}>
                <TerminalSquare size={16} />
              </button>
              {googleSignInMessage ? <small className="google-signin-status">{googleSignInMessage}</small> : null}
            </>
          )}
        </div>
      </nav>
      {activeWorkspaceTab === "builder" ? (
      <main className={`app-shell ${selectedProject ? (showExpandedFlow ? "flow-expanded" : "flow-collapsed") : "no-flow"}`}>
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
            <button
              className="text-button icon-only"
              onClick={() => setFitPreview((value) => !value)}
              title={fitPreview ? "Keep aspect" : "Fit screen"}
              aria-label={fitPreview ? "Keep aspect" : "Fit screen"}
            >
              <Maximize2 size={16} />
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

        <ProjectTechStackGraph
          snapshots={visibleTechStackSnapshots}
          selectedIndex={techStackIndex}
          onSelectIndex={setTechStackIndex}
          hasProject={Boolean(selectedProject)}
        />

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

      {selectedProject ? (
        <ProjectFlowPanel
          key={selectedProjectId}
          projectId={selectedProjectId}
          flowPath={selectedProjectFlowPath}
          decisionHistory={projectInstructions}
          expanded={showExpandedFlow}
          running={isGenerating}
          onToggle={() => setFlowExpanded((value) => !value)}
          onHumanChoice={chooseHumanFlowPath}
        />
      ) : null}

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
              href={exportUrl}
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
          <div className={`working-agent-window ${workflowRunning ? "active" : ""}`}>
            <AgentAvatar visual={activeChatAgent} size="small" />
            <div>
              <span>{workflowRunning ? "Working agent" : "Last active agent"}</span>
              <strong>{activeChatAgent.name}</strong>
              <small>{activeChatAgent.label}</small>
            </div>
          </div>
          <ol className="chat-thread">
            {chatMessages.length ? (
              chatMessages.map((event) => <ChatMessage key={event.id || `${event.type}-${event.createdAt}`} event={event} selectedProject={selectedProject} />)
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
            {activePalette || activeAppIcon
              ? `Task Type: ${taskType}.${activePalette ? ` Branding palette selected: ${activePalette.name}.` : ""}${activeAppIcon ? ` App icon selected: ${activeAppIcon.name}.` : ""}`
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
            <label className={`ghost-action app-icon-action ${!selectedProject || selectedProject.isDefault ? "disabled" : ""}`}>
              {isUploadingMedia ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
              App icon
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon"
                onChange={uploadAppIcon}
                disabled={!selectedProject || selectedProject.isDefault || isUploadingMedia}
              />
            </label>
          </div>
        </section>

        <details className="system-card runtime-collapse">
          <summary>
            <span>
              <Server size={15} />
              Runtime status
            </span>
            <b>{selectedProject ? (generatedStatus === "ready" ? "Live" : "Building") : "Idle"}</b>
          </summary>
          <div className="status-grid compact">
            {metrics.map((metric) => (
              <div className="metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                {metric.detail ? <small>{metric.detail}</small> : null}
              </div>
            ))}
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
        </details>

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
              activityEvents.map((event) => <EventRow key={`activity-${event.id || event.createdAt}`} event={event} sessionStartedAt={sessionStartedAt} selectedProject={selectedProject} />)
            ) : (
              <li className="empty-state">Activity events will appear here.</li>
            )}
          </ol>
        </section>

        <ProjectInstructionTimeline instructions={projectInstructions} error={instructionsError} />
      </aside>
      {showPalettePicker ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowPalettePicker(false)}>
          <section className="palette-modal" role="dialog" aria-modal="true" aria-label="Branding colour palettes" onMouseDown={(event) => event.stopPropagation()}>
            <header className="palette-modal-header">
              <div>
                <h2>Branding colours</h2>
                <p>Auto-matched to the instruction and business use case. Manual selection overrides it.</p>
              </div>
              <button className="icon-button" onClick={() => setShowPalettePicker(false)} title="Close palette picker">
                <X size={16} />
              </button>
            </header>
            <div className="palette-list">
              {colorPalettes.map((palette) => (
                <button
                  key={palette.name}
                  className={`palette-option ${activePalette?.name === palette.name ? "active" : ""}`}
                  onClick={() => setBrandingPalette({ ...palette, reason: "Selected manually from Color Hunt." })}
                  title={`Color Hunt palette: ${palette.url}`}
                >
                  <span>{palette.name}{!brandingPalette && recommendedPalette.name === palette.name ? <small>Recommended</small> : null}</span>
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
              <span>{`${activePalette.name}: ${activePalette.colors.join(" ")} · ${activePalette.reason || "Selected manually."}`}</span>
              <button className="ghost-action" onClick={() => setBrandingPalette(null)}>Use recommendation</button>
              <button className="primary-action" onClick={() => setShowPalettePicker(false)}>Done</button>
            </footer>
          </section>
        </div>
      ) : null}
      </main>
      ) : activeWorkspaceTab === "agentic-system" ? (
        <main className="agentic-workspace-tab">
          <iframe
            title="Agentic System D3"
            src={`/agentic-system/d3/index.html?embedded=1&theme=${encodeURIComponent(resolvedTheme)}&graphUrl=${encodeURIComponent(`${BACKEND_URL}/api/agentic-system/graph`)}`}
          />
        </main>
      ) : activeWorkspaceTab === "hosting" ? (
        <CloudHostingPage />
      ) : activeWorkspaceTab === "agents" ? (
        <AgentsWorkspace />
      ) : (
        <main className="app-shell" />
      )}
    </div>
  );
}
