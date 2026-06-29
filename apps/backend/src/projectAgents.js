import fs from "fs-extra";
import path from "node:path";

function projectRoot() {
  return process.env.BUILDERX_PROJECT_ROOT || "/workspace/project";
}

function agentRuntimeRoot() {
  return process.env.PROJECT_AGENT_RUNTIME_ROOT || path.join(projectRoot(), "runtime", "agents", "projects");
}

function generatedAgentsRoot() {
  return process.env.PROJECT_AGENT_MARKDOWN_ROOT || path.join(projectRoot(), "agents", "generated");
}

function generatedGraphPath() {
  return process.env.PROJECT_AGENT_NEO4J_PATH || path.join(projectRoot(), "graph", "neo4j", "generated-project-agents.cypher");
}

function topologyGraphPath() {
  return process.env.AGENTIC_SYSTEM_GRAPH_PATH || path.join(projectRoot(), "topology", "d3", "agentic-system-graph.json");
}

function frontendGraphPath() {
  return process.env.FRONTEND_AGENTIC_SYSTEM_GRAPH_PATH || path.join(projectRoot(), "apps", "frontend", "public", "topology", "d3", "agentic-system-graph.json");
}

function sanitizeAgentId(value) {
  return String(value || "project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "project";
}

function titleCase(value) {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

const managedBlockStart = "<!-- agentic-builderx-project-orchestrator:start -->";
const managedBlockEnd = "<!-- agentic-builderx-project-orchestrator:end -->";

async function writeManagedEntryFile(filePath, title) {
  const block = [
    managedBlockStart,
    `# ${title}`,
    "",
    "Before planning or editing this project, read `.agentic/orchestrator-agent.md` and follow it as the authoritative project policy.",
    "BuilderX is only the launcher and registry; project-local orchestration owns task scope, context selection, MCP routing, validation, and handoff.",
    managedBlockEnd
  ].join("\n");
  const existing = (await fs.pathExists(filePath)) ? await fs.readFile(filePath, "utf8") : "";
  const pattern = new RegExp(`${managedBlockStart}[\\s\\S]*?${managedBlockEnd}`, "m");
  if (existing.trim() && !pattern.test(existing)) return;
  const next = pattern.test(existing)
    ? existing.replace(pattern, block)
    : `${existing.trim()}${existing.trim() ? "\n\n" : ""}${block}\n`;
  await fs.writeFile(filePath, next);
}

async function writeProjectLocalOrchestrator(topology) {
  const workspaceDir = topology.project.workspaceDir;
  if (!workspaceDir) return;
  const orchestrator = topology.agents.find((agent) => agent.role === "project-orchestrator");
  const specialists = topology.agents.filter((agent) => agent.role !== "project-orchestrator");
  const policyDir = path.join(workspaceDir, ".agentic");
  const localAgentsDir = path.join(policyDir, "agents");
  await fs.ensureDir(localAgentsDir);

  const policy = [
    `# ${orchestrator?.name || "Project Orchestrator Agent"}`,
    "",
    `project_id: ${topology.project.id}`,
    `project_name: ${topology.project.name}`,
    `workspace: ${topology.project.workspaceDir}`,
    `preview_port: ${topology.project.port}`,
    "authority: project-local-context",
    "",
    "## Core Objective",
    "Deliver the highest achievable implementation accuracy with the lowest justified token and tool cost.",
    "Use current workspace evidence as truth, retrieve only task-relevant context, and expand scope only when verified dependencies require it.",
    "",
    "## Orchestration Contract",
    "1. Classify each request as tiny, small, medium, or large before using tools.",
    "2. Inspect the smallest relevant set of files, symbols, routes, schemas, tests, and runtime state.",
    "3. Reuse project-local patterns and agents before creating a new specialist or abstraction.",
    "4. Produce an explicit, dependency-aware handoff for Gotham or Claude; never delegate an unverified path, API, import, schema, or command.",
    "5. Apply the narrowest complete change, preserve unrelated behavior, and validate in proportion to risk.",
    "6. Record topology changes only when ownership, services, data boundaries, or agent responsibilities actually change.",
    "",
    "## Context And Token Economy",
    "- Tiny: inspect up to 3 relevant files; no graph regeneration or specialist creation.",
    "- Small: inspect up to 8 relevant files; use existing agents and targeted validation.",
    "- Medium: perform focused dependency discovery; load only affected contracts and update topology if ownership changes.",
    "- Large: map architecture and risk first; use staged context, explicit review gates, and broader validation.",
    "- Summarize long logs and retrieved memory. Do not resend unchanged context between steps.",
    "- Stop discovery when the edit location, dependencies, acceptance criteria, and validation path are proven.",
    "",
    "## MCP Task Control",
    "- Treat MCP tools as scoped capabilities, not autonomous sources of truth.",
    "- Send the selected project ID, workspace, objective, constraints, relevant media, and acceptance criteria with every delegated task.",
    "- Prefer local project resources before remote retrieval. Verify external results against current files before editing.",
    "- Keep credentials and secrets out of prompts, logs, memory, graph artifacts, and generated source.",
    "- Require approval before destructive data changes, production deployment, credential mutation, or irreversible migration.",
    "",
    "## Accuracy Gates",
    "- Files prove implementation state; memory and generated plans are guidance only.",
    "- Run the most focused available test or build after changes. Report any check that could not run.",
    "- A task is complete only when requested behavior is present, runtime impact is understood, and validation evidence exists.",
    "",
    "## Project Context",
    `Objective: ${topology.instruction.objective || "Maintain and improve this application."}`,
    `Page type: ${topology.instruction.pageType || "managed_app_project"}`,
    `Topic: ${topology.instruction.topic || topology.project.name}`,
    `Sections: ${(topology.instruction.sections || []).join(", ") || "project, runtime, playground"}`,
    "",
    "## Available Specialists",
    ...specialists.map((agent) => `- ${agent.name} (${agent.role}): ${agent.responsibility}`),
    "",
    "## Execution Handoff",
    "Gotham and Claude must follow the canonical root AGENTS.md policy and use this file for project identity, scope, specialist context, and local accuracy/token constraints. BuilderX only selects the project and delivers the user instruction.",
    ""
  ].join("\n");
  await fs.writeFile(path.join(policyDir, "orchestrator-agent.md"), policy);

  for (const agent of topology.agents) {
    const body = [
      `# ${agent.name}`,
      "",
      `agent_id: ${agent.id}`,
      `project_id: ${topology.project.id}`,
      `role: ${agent.role}`,
      "",
      "## Responsibility",
      agent.responsibility,
      "",
      "## Governing Policy",
      "Follow `../orchestrator-agent.md`. Return concise evidence, changed contracts, validation results, and unresolved risk to the project orchestrator.",
      ""
    ].join("\n");
    await fs.writeFile(path.join(localAgentsDir, `${agent.id}.agent.md`), body);
  }

  await writeManagedEntryFile(path.join(workspaceDir, "AGENTS.md"), "Gotham Project Entry");
  await writeManagedEntryFile(path.join(workspaceDir, "CLAUDE.md"), "Claude Project Entry");
}

function requiredSpecialists(structuredRequest = {}) {
  const sections = new Set(structuredRequest.sections || []);
  const agents = [
    {
      key: "ui-composition",
      name: "UI Composition Agent",
      responsibility: "Translate the project brief into responsive React views, layout, and interaction states."
    },
    {
      key: "content-data",
      name: "Content Data Agent",
      responsibility: "Shape generated copy, metadata, reusable data modules, and handoff documentation."
    },
    {
      key: "runtime-packaging",
      name: "Runtime Packaging Agent",
      responsibility: "Maintain Vite scripts, environment defaults, export readiness, and container handoff files."
    }
  ];

  if (sections.has("catalog") || sections.has("materials") || String(structuredRequest.pageType || "").includes("commerce")) {
    agents.push({
      key: "commerce-catalog",
      name: "Commerce Catalog Agent",
      responsibility: "Model product catalog sections, material details, product imagery hooks, and storefront conversion paths."
    });
  }
  if (sections.has("pricing")) {
    agents.push({
      key: "pricing-conversion",
      name: "Pricing Conversion Agent",
      responsibility: "Create pricing, plan comparison, offer framing, and conversion CTA structure."
    });
  }
  if (String(structuredRequest.pageType || "").includes("dashboard") || sections.has("metrics")) {
    agents.push({
      key: "analytics-dashboard",
      name: "Analytics Dashboard Agent",
      responsibility: "Plan metric cards, dashboard panels, operational states, and dense scanning views."
    });
  }
  if ((structuredRequest.media || []).length) {
    agents.push({
      key: "media-asset",
      name: "Media Asset Agent",
      responsibility: "Track uploaded media references and expose them safely to the project generation workflow."
    });
  }

  return agents;
}

export function buildProjectAgentTopology(project, structuredRequest = {}) {
  const projectSlug = sanitizeAgentId(project.folderName || project.name || project.id);
  const orchestratorAgentId = `${projectSlug}-orchestrator-agent`;
  const specialistAgents = requiredSpecialists(structuredRequest).map((agent) => ({
    id: `${projectSlug}-${agent.key}-agent`,
    name: `${titleCase(projectSlug)} ${agent.name}`,
    role: agent.key,
    responsibility: agent.responsibility,
    source: "instruction-derived",
    projectId: project.id,
    projectName: project.name
  }));

  const orchestrator = {
    id: orchestratorAgentId,
    name: `${titleCase(projectSlug)} Orchestrator Agent`,
    role: "project-orchestrator",
    responsibility: "Read the project instruction, decide required specialist agents, and coordinate Gotham workflow handoff.",
    source: "project-create",
    projectId: project.id,
    projectName: project.name
  };

  return {
    project: {
      id: project.id,
      name: project.name,
      folderName: project.folderName,
      workspaceDir: project.workspaceDir,
      port: project.port,
      previewUrl: project.previewUrl
    },
    instruction: {
      hash: structuredRequest.instructionHash,
      objective: structuredRequest.objective,
      pageType: structuredRequest.pageType,
      topic: structuredRequest.topic,
      sections: structuredRequest.sections || []
    },
    agents: [orchestrator, ...specialistAgents],
    relationships: [
      {
        source: project.id,
        target: orchestrator.id,
        type: "HAS_ORCHESTRATOR"
      },
      ...specialistAgents.map((agent) => ({
        source: orchestrator.id,
        target: agent.id,
        type: "DELEGATES_TO"
      }))
    ],
    createdAt: new Date().toISOString()
  };
}

async function readProjectAgentTopologies() {
  const root = agentRuntimeRoot();
  if (!(await fs.pathExists(root))) return [];
  const files = (await fs.readdir(root)).filter((file) => file.endsWith(".agents.json"));
  const topologies = [];
  for (const file of files) {
    try {
      topologies.push(await fs.readJson(path.join(root, file)));
    } catch {
      // Ignore partial files and keep the graph readable.
    }
  }
  return topologies;
}

async function writeAgentMarkdown(topology) {
  await fs.ensureDir(generatedAgentsRoot());
  for (const agent of topology.agents) {
    const body = [
      `# ${agent.name}`,
      "",
      `agent_id: "${agent.id}"`,
      `project_id: "${topology.project.id}"`,
      `project_name: "${topology.project.name}"`,
      `role: "${agent.role}"`,
      `source: "${agent.source}"`,
      "",
      "## Responsibility",
      agent.responsibility,
      "",
      "## Instruction Context",
      `Objective: ${topology.instruction.objective || "Not specified"}`,
      `Page type: ${topology.instruction.pageType || "unknown"}`,
      `Topic: ${topology.instruction.topic || "unknown"}`,
      `Sections: ${(topology.instruction.sections || []).join(", ") || "none"}`,
      ""
    ].join("\n");
    await fs.writeFile(path.join(generatedAgentsRoot(), `${agent.id}.agent.md`), body);
  }
}

async function writeGeneratedNeo4jSeed(topologies) {
  await fs.ensureDir(path.dirname(generatedGraphPath()));
  const lines = [
    "// Generated by Agentic BuilderX project-agent registry.",
    "// This file keeps managed app projects related to their project-scoped agents.",
    ""
  ];
  for (const topology of topologies) {
    const projectId = `project:${topology.project.id}`;
    lines.push(
      `MERGE (p:Project {id: '${projectId}'})`,
      `SET p.name = ${JSON.stringify(topology.project.name)}, p.folder_name = ${JSON.stringify(topology.project.folderName)}, p.workspace_dir = ${JSON.stringify(topology.project.workspaceDir)}, p.port = ${Number(topology.project.port || 0)}`
    );
    for (const agent of topology.agents) {
      lines.push(
        `MERGE (a:Agent {id: ${JSON.stringify(agent.id)}})`,
        `SET a.name = ${JSON.stringify(agent.name)}, a.role = ${JSON.stringify(agent.role)}, a.project_id = ${JSON.stringify(topology.project.id)}, a.status = 'active'`,
        "MERGE (p)-[:OWNS]->(a)"
      );
    }
    for (const relationship of topology.relationships) {
      if (relationship.type === "HAS_ORCHESTRATOR") {
        lines.push(`MATCH (p:Project {id: '${projectId}'}), (a:Agent {id: ${JSON.stringify(relationship.target)}}) MERGE (p)-[:HAS_ORCHESTRATOR]->(a)`);
      }
      if (relationship.type === "DELEGATES_TO") {
        lines.push(`MATCH (a:Agent {id: ${JSON.stringify(relationship.source)}}), (b:Agent {id: ${JSON.stringify(relationship.target)}}) MERGE (a)-[:DELEGATES_TO]->(b)`);
      }
    }
    lines.push("");
  }
  await fs.writeFile(generatedGraphPath(), `${lines.join("\n")}\n`);
}

function graphRowsForTopology(topology) {
  const projectNodeId = `project:${topology.project.id}`;
  const nodes = [
    {
      id: projectNodeId,
      type: "project",
      label: topology.project.name,
      group: "project",
      risk_level: "medium",
      status: "managed",
      agent_id: "",
      cluster_id: "",
      metadata: {
        dynamicProjectGraph: true,
        projectId: topology.project.id,
        folderName: topology.project.folderName,
        workspaceDir: topology.project.workspaceDir,
        port: topology.project.port,
        previewUrl: topology.project.previewUrl,
        description: topology.instruction.objective || `Managed BuilderX project for ${topology.project.name}.`
      }
    },
    ...topology.agents.map((agent) => ({
      id: `agent:${agent.id}`,
      type: "agent",
      label: agent.name,
      group: "project-agent",
      risk_level: agent.role === "project-orchestrator" ? "medium" : "low",
      status: "active",
      agent_id: agent.id,
      cluster_id: agent.role,
      metadata: {
        dynamicProjectGraph: true,
        projectId: topology.project.id,
        projectName: topology.project.name,
        responsibility: agent.responsibility,
        description: agent.responsibility
      }
    }))
  ];
  const links = [
    {
      source: "agent:builderx-fullstack-agent",
      target: projectNodeId,
      type: "creates_project",
      weight: 2,
      metadata: { dynamicProjectGraph: true, projectId: topology.project.id }
    },
    ...topology.relationships.map((relationship) => ({
      source: relationship.type === "HAS_ORCHESTRATOR" ? projectNodeId : `agent:${relationship.source}`,
      target: `agent:${relationship.target}`,
      type: relationship.type.toLowerCase(),
      weight: relationship.type === "HAS_ORCHESTRATOR" ? 2 : 1,
      metadata: { dynamicProjectGraph: true, projectId: topology.project.id }
    }))
  ];
  return { nodes, links };
}

export async function buildAgenticSystemGraph() {
  const basePath = topologyGraphPath();
  const baseGraph = (await fs.pathExists(basePath))
    ? await fs.readJson(basePath)
    : { metadata: {}, nodes: [], links: [] };
  const baseNodes = (baseGraph.nodes || []).filter((node) => !node.metadata?.dynamicProjectGraph);
  const baseLinks = (baseGraph.links || []).filter((link) => !link.metadata?.dynamicProjectGraph);
  const topologies = await readProjectAgentTopologies();
  const projectRows = topologies.map(graphRowsForTopology);
  return {
    metadata: {
      ...baseGraph.metadata,
      generated_at: new Date().toISOString(),
      graph_version: "1.2.0",
      managed_project_count: topologies.length,
      project_agent_source: "runtime/agents/projects"
    },
    nodes: [...baseNodes, ...projectRows.flatMap((row) => row.nodes)],
    links: [...baseLinks, ...projectRows.flatMap((row) => row.links)]
  };
}

export async function syncProjectAgentTopology(project, structuredRequest = {}) {
  structuredRequest.projectOrchestrator = {
    authority: "project-local",
    policyPath: "AGENTS.md",
    contextPath: ".agentic/orchestrator-agent.md",
    bootstrapPromptPath: ".codex/prompts/bootstrap-orchestrator.md",
    codexEntryPath: "AGENTS.md",
    claudeEntryPath: "CLAUDE.md",
    coreObjective: "Highest implementation accuracy at the lowest justified token and tool cost."
  };
  const topology = buildProjectAgentTopology(project, structuredRequest);
  await writeProjectLocalOrchestrator(topology);
  await fs.ensureDir(agentRuntimeRoot());
  await fs.writeJson(path.join(agentRuntimeRoot(), `${project.id}.agents.json`), topology, { spaces: 2 });
  await writeAgentMarkdown(topology);
  const topologies = await readProjectAgentTopologies();
  await writeGeneratedNeo4jSeed(topologies);
  const graph = await buildAgenticSystemGraph();
  await fs.ensureDir(path.dirname(topologyGraphPath()));
  await fs.writeJson(topologyGraphPath(), graph, { spaces: 2 });
  await fs.ensureDir(path.dirname(frontendGraphPath()));
  await fs.writeJson(frontendGraphPath(), graph, { spaces: 2 });
  return topology;
}

export async function ensureProjectAgentTopologies(projects) {
  const existingTopologies = await readProjectAgentTopologies();
  const existing = new Map(existingTopologies.map((topology) => [topology.project.id, topology]));
  const created = [];
  for (const project of projects) {
    if (!project || project.isDefault) continue;
    if (existing.has(project.id)) {
      await writeProjectLocalOrchestrator(existing.get(project.id));
      continue;
    }
    const topology = await syncProjectAgentTopology(project, {
      objective: `Maintain the managed app project ${project.name}.`,
      pageType: "managed_app_project",
      topic: project.name,
      sections: ["project", "runtime", "playground"],
      media: []
    });
    created.push(topology);
  }
  return created;
}

export async function removeProjectAgentTopology(project) {
  if (!project?.id) return;
  const topologyPath = path.join(agentRuntimeRoot(), `${project.id}.agents.json`);
  let topology = null;
  if (await fs.pathExists(topologyPath)) {
    try {
      topology = await fs.readJson(topologyPath);
    } catch {
      topology = null;
    }
  }
  await fs.remove(topologyPath);
  for (const agent of topology?.agents || []) {
    await fs.remove(path.join(generatedAgentsRoot(), `${agent.id}.agent.md`));
  }
  const topologies = await readProjectAgentTopologies();
  await writeGeneratedNeo4jSeed(topologies);
  const graph = await buildAgenticSystemGraph();
  await fs.ensureDir(path.dirname(topologyGraphPath()));
  await fs.writeJson(topologyGraphPath(), graph, { spaces: 2 });
  await fs.ensureDir(path.dirname(frontendGraphPath()));
  await fs.writeJson(frontendGraphPath(), graph, { spaces: 2 });
}
