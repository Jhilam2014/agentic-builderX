import crypto from "node:crypto";

const defaultSections = ["hero", "proof", "workflow", "cta"];
const knownTones = ["premium", "professional", "minimal", "enterprise", "playful", "bold", "calm"];
const knownAudiences = ["founders", "executives", "operators", "developers", "finance teams", "sales teams", "customers"];
const multiPageSignals = [
  "platform",
  "projects",
  "project showcase",
  "services",
  "service business",
  "agency",
  "company website",
  "business website",
  "saas",
  "portal",
  "marketplace",
  "ecommerce",
  "shop",
  "store",
  "dashboard",
  "admin",
  "case studies",
  "pricing",
  "docs",
  "blog",
  "contact page"
];
const singlePageSignals = [
  "portfolio",
  "resume",
  "cv",
  "banner",
  "poster",
  "flyer",
  "advertisement",
  "ad display",
  "simple ad",
  "coming soon",
  "link in bio",
  "one page",
  "single page",
  "landing page only"
];

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
  if (lower.includes("platform")) return "platform_website";
  if (lower.includes("services") || lower.includes("service business") || lower.includes("agency")) return "services_website";
  if (lower.includes("projects") || lower.includes("case stud")) return "project_showcase_website";
  if (hasAnySignal(lower, ["shop", "store", "bag", "bags", "handbag", "luggage", "ecommerce", "commerce"])) return "commerce_website";
  if (lower.includes("dashboard") || lower.includes("admin") || lower.includes("portal")) return "dashboard_website";
  if (lower.includes("pricing")) return "pricing_page";
  if (lower.includes("portfolio")) return "portfolio_page";
  if (lower.includes("saas")) return "saas_website";
  if (lower.includes("product")) return "product_landing_page";
  return "professional_landing_page";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function includesSignal(lower, signal) {
  if (signal.includes(" ")) return lower.includes(signal);
  return new RegExp(`\\b${escapeRegExp(signal)}\\b`).test(lower);
}

function hasAnySignal(lower, signals) {
  return signals.some((signal) => includesSignal(lower, signal));
}

function inferSiteScale(text, pageType, sections) {
  const lower = text.toLowerCase();
  const strongMultiPage =
    lower.includes("platform") ||
    lower.includes("projects") ||
    lower.includes("services") ||
    lower.includes("service business") ||
    lower.includes("saas") ||
    lower.includes("portal") ||
    lower.includes("marketplace") ||
    lower.includes("admin") ||
    lower.includes("dashboard") ||
    lower.includes("ecommerce") ||
    lower.includes("case stud");
  const explicitSinglePage = lower.includes("single page") || lower.includes("one page") || lower.includes("landing page only");
  const simpleSurface = hasAnySignal(lower, singlePageSignals);
  let complexityScore = 0;
  if (hasAnySignal(lower, multiPageSignals)) complexityScore += 2;
  if (strongMultiPage) complexityScore += 3;
  if ((sections || []).length >= 5) complexityScore += 1;
  if (/website|web app|application|system|workflow|booking|login|auth|account|checkout|catalog|crm|erp/i.test(text)) complexityScore += 1;
  if (/platform|website|dashboard|commerce|saas|services|project_showcase/.test(pageType)) complexityScore += 1;
  if (simpleSurface) complexityScore -= 2;
  if (pageType === "portfolio_page") complexityScore -= 1;
  if (explicitSinglePage && !strongMultiPage) complexityScore -= 3;

  const siteStructure = strongMultiPage || complexityScore >= 2 ? "multi_page" : "single_page";
  return {
    siteStructure,
    complexityScore,
    decisionBias: "slightly_prefer_multi_page_when_scope_is_ambiguous",
    decisionReason:
      siteStructure === "multi_page"
        ? "The request has platform/project/service/application signals or enough scope complexity to justify routes."
        : "The request is a simple self-contained surface such as a portfolio, banner, advertisement, or compact landing page."
  };
}

function addRoute(routes, key, path, title, description, sections = []) {
  if (routes.some((route) => route.key === key || route.path === path)) return;
  routes.push({ key, path, title, description, sections });
}

function inferRoutePlan(text, pageType, sections, siteStructure) {
  if (siteStructure !== "multi_page") return [];
  const lower = text.toLowerCase();
  const routes = [];
  addRoute(routes, "home", "/", "Home", "Primary positioning, proof, and conversion entry point.", ["hero", "proof", "cta"]);

  if (lower.includes("platform") || lower.includes("saas") || lower.includes("product") || pageType.includes("platform") || pageType.includes("saas")) {
    addRoute(routes, "features", "/features", "Features", "Product capabilities, modules, and user outcomes.", ["features", "workflow", "metrics"]);
  }
  if (lower.includes("services") || lower.includes("service business") || lower.includes("agency") || pageType.includes("services")) {
    addRoute(routes, "services", "/services", "Services", "Service packages, delivery model, and engagement options.", ["services", "workflow", "proof"]);
  }
  if (lower.includes("projects") || lower.includes("case stud") || pageType.includes("project_showcase")) {
    addRoute(routes, "projects", "/projects", "Projects", "Project portfolio, case studies, and measurable outcomes.", ["projects", "case-studies", "metrics"]);
  }
  if (hasAnySignal(lower, ["shop", "store", "catalog", "ecommerce", "commerce", "bag", "bags", "handbag", "luggage"]) || pageType.includes("commerce")) {
    addRoute(routes, "catalog", "/catalog", "Catalog", "Product catalog, merchandising, materials, and buying path.", ["catalog", "materials", "checkout"]);
  }
  if (lower.includes("dashboard") || lower.includes("admin") || lower.includes("portal") || pageType.includes("dashboard")) {
    addRoute(routes, "dashboard", "/dashboard", "Dashboard", "Operational panels, metrics, states, and workflow visibility.", ["metrics", "workflow", "states"]);
  }
  if (lower.includes("pricing") || (sections || []).includes("pricing")) {
    addRoute(routes, "pricing", "/pricing", "Pricing", "Plans, comparison, offer framing, and conversion CTAs.", ["pricing", "faq", "cta"]);
  }

  addRoute(routes, "about", "/about", "About", "Brand story, credibility, operating principles, and trust cues.", ["story", "team", "trust"]);
  addRoute(routes, "contact", "/contact", "Contact", "Lead capture, contact methods, and next-step CTA.", ["form", "cta", "faq"]);

  if (routes.length < 4) {
    addRoute(routes, "services", "/services", "Services", "Service and capability details.", ["services", "workflow"]);
    addRoute(routes, "projects", "/projects", "Projects", "Project examples and proof.", ["projects", "proof"]);
  }
  return routes;
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
  if (hasAnySignal(lower, ["bag", "bags", "handbag", "luggage", "shop", "store", "ecommerce", "commerce"])) {
    sections.add("catalog");
    sections.add("materials");
  }
  return Array.from(sections);
}

function normalizeTaskType(taskType) {
  const normalized = String(taskType || "Medium").trim().toLowerCase();
  if (normalized === "simple" || normalized === "small") return "Simple";
  if (normalized === "hard" || normalized === "large" || normalized === "complex") return "Large";
  return "Medium";
}

export function formatProjectOrchestratorInstruction(instruction, taskType = "Medium") {
  const sourceInstruction = compactText(instruction);
  return [`Task Type: ${normalizeTaskType(taskType)}`, `Task: ${sourceInstruction}`].join("\n");
}

function toPageComponentName(routeKey) {
  return `${String(routeKey || "page")
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("")}Page`;
}

function buildFileOperationPlan(structuredRequest) {
  const operations = [
    {
      action: "modify",
      path: "src/generated/generatedPage.jsx",
      reason:
        structuredRequest.siteStructure === "multi_page"
          ? `Render the generated ${structuredRequest.pageType} multi-page React shell and route navigation.`
          : `Render the generated ${structuredRequest.pageType} React page.`
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
    }
  ];

  if (structuredRequest.siteStructure === "multi_page") {
    operations.push({
      action: "add",
      path: "src/generated/siteStructure.js",
      reason: "Store the route plan and site-complexity decision separately from page components."
    });
    for (const route of structuredRequest.routePlan || []) {
      operations.push({
        action: "add",
        path: `src/generated/pages/${toPageComponentName(route.key)}.jsx`,
        reason: `Create the ${route.title} route/page required by the multi-page site plan.`
      });
    }
  }

  operations.push(
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
  );

  return operations;
}

export function orchestrateBuilderInstruction(rawInstruction) {
  const sourceInstruction = compactText(rawInstruction);
  const tone = findMatches(sourceInstruction, knownTones);
  const audience = findMatches(sourceInstruction, knownAudiences);
  const topic = inferTopic(sourceInstruction);
  const pageType = inferPageType(sourceInstruction);
  const sections = inferSections(sourceInstruction);
  const complexityScaling = inferSiteScale(sourceInstruction, pageType, sections);
  const routePlan = inferRoutePlan(sourceInstruction, pageType, sections, complexityScaling.siteStructure);
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
    siteStructure: complexityScaling.siteStructure,
    routePlan,
    complexityScaling,
    constraints: [
      "Render as a polished responsive React webpage.",
      "Use Site Complexity Scaling before implementation: platform, projects, services, SaaS, dashboards, marketplaces, commerce, portals, and service-business websites should become multi-page unless the user explicitly asks for a one-page artifact.",
      "Keep single-page output mainly for simple portfolios, banners, simple advertisement displays, coming-soon pages, compact campaigns, and other low-complexity surfaces.",
      "When scope is ambiguous, bias slightly toward a multi-page website and document the route decision in metadata and README.",
      "Do not flatten platform/projects/services requirements into one long landing page when separate routes would make the product clearer.",
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
    `Site structure: ${structuredRequest.siteStructure}.`,
    structuredRequest.routePlan.length
      ? `Route plan: ${structuredRequest.routePlan.map((route) => `${route.title} ${route.path}`).join(", ")}.`
      : "Route plan: single-page surface.",
    `Original request: ${structuredRequest.sourceInstruction}`
  ].join("\n");

  return {
    structuredRequest,
    codexInstruction
  };
}
