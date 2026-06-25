import crypto from "node:crypto";

const defaultSections = ["hero", "proof", "workflow", "cta"];
const knownTones = ["premium", "professional", "minimal", "enterprise", "playful", "bold", "calm"];
const knownAudiences = ["founders", "executives", "operators", "developers", "finance teams", "sales teams", "customers"];

function compactText(value) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000);
}

function findMatches(text, options) {
  const lower = text.toLowerCase();
  return options.filter((option) => lower.includes(option));
}

function inferPageType(text) {
  const lower = text.toLowerCase();
  if (lower.includes("shop") || lower.includes("store") || lower.includes("bag")) return "commerce_landing_page";
  if (lower.includes("dashboard")) return "dashboard_landing_page";
  if (lower.includes("pricing")) return "pricing_page";
  if (lower.includes("portfolio")) return "portfolio_page";
  if (lower.includes("saas")) return "saas_landing_page";
  if (lower.includes("product")) return "product_landing_page";
  return "professional_landing_page";
}

function inferTopic(text) {
  const lower = text.toLowerCase();
  const candidates = [
    "finance",
    "bag",
    "bags",
    "handbag",
    "luggage",
    "treasury",
    "compliance",
    "analytics",
    "automation",
    "agentic",
    "builder",
    "operations",
    "developer",
    "sales",
    "support"
  ];
  return candidates.find((candidate) => lower.includes(candidate)) || "digital product";
}

function inferSections(text) {
  const lower = text.toLowerCase();
  const sections = new Set(defaultSections);
  if (lower.includes("pricing")) sections.add("pricing");
  if (lower.includes("testimonial") || lower.includes("customer")) sections.add("testimonials");
  if (lower.includes("feature")) sections.add("features");
  if (lower.includes("kpi") || lower.includes("metric")) sections.add("metrics");
  if (lower.includes("faq")) sections.add("faq");
  if (lower.includes("bag") || lower.includes("shop") || lower.includes("store")) {
    sections.add("catalog");
    sections.add("materials");
  }
  return Array.from(sections);
}

function buildFileOperationPlan(structuredRequest) {
  return [
    {
      action: "modify",
      path: "src/generated/generatedPage.jsx",
      reason: `Render the generated ${structuredRequest.pageType} React page.`
    },
    {
      action: "modify",
      path: "src/generated/generatedPage.css",
      reason: "Apply generated responsive visual styling."
    },
    {
      action: "add",
      path: "src/generated/catalogData.js",
      reason: "Store generated catalog, metrics, and feature data separately from the page component."
    },
    {
      action: "add",
      path: "src/generated/README.generated.md",
      reason: "Document the generated app handoff and latest orchestrator plan."
    },
    {
      action: "modify",
      path: "src/generated/metadata.json",
      reason: "Record build metadata and orchestrator handoff details."
    },
    {
      action: "delete",
      path: "src/generated/deprecatedGeneratedPage.jsx",
      reason: "Remove obsolete generated page modules if present."
    }
  ];
}

export function orchestrateBuilderInstruction(rawInstruction) {
  const sourceInstruction = compactText(rawInstruction);
  const tone = findMatches(sourceInstruction, knownTones);
  const audience = findMatches(sourceInstruction, knownAudiences);
  const topic = inferTopic(sourceInstruction);
  const pageType = inferPageType(sourceInstruction);
  const sections = inferSections(sourceInstruction);
  const instructionHash = crypto.createHash("sha256").update(sourceInstruction).digest("hex");

  const structuredRequest = {
    orchestrator: "builderx-fullstack-agent",
    instructionHash,
    sourceInstruction,
    objective: `Generate a ${pageType.replaceAll("_", " ")} for ${topic}.`,
    pageType,
    topic,
    audience: audience.length ? audience : ["professional users"],
    tone: tone.length ? tone : ["professional", "premium"],
    sections,
    constraints: [
      "Render as a polished responsive React webpage.",
      "Use professional visual hierarchy and strong spacing.",
      "Avoid unsafe scripts, external tracking, or credential handling.",
      "Write only to the generated-site source directory."
    ],
    handoff: {
      target: "codex.generate_webpage",
      generatedAppContainer: process.env.GENERATED_SITE_CONTAINER || "agentic-builderx-generated-site",
      restartRequired: true
    },
    fileOperations: []
  };

  structuredRequest.fileOperations = buildFileOperationPlan(structuredRequest);

  const codexInstruction = [
    structuredRequest.objective,
    `Audience: ${structuredRequest.audience.join(", ")}.`,
    `Tone: ${structuredRequest.tone.join(", ")}.`,
    `Sections: ${structuredRequest.sections.join(", ")}.`,
    `Original request: ${structuredRequest.sourceInstruction}`
  ].join("\n");

  return {
    structuredRequest,
    codexInstruction
  };
}
