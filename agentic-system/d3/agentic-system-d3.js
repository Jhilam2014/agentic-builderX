const graphEl = document.getElementById("graph");
const statusEl = document.getElementById("status");
const legendEl = document.getElementById("legend");
const insightEl = document.getElementById("insight");

if (new URLSearchParams(window.location.search).has("embedded")) {
  document.documentElement.classList.add("embedded");
}

const colors = {
  project: "#a855f7",
  agent: "#3b82f6",
  cluster: "#14b8a6",
  feature: "#8b5cf6",
  service: "#06b6d4",
  api: "#f59e0b",
  vector_store: "#84cc16",
  graph_store: "#64748b",
  human_review: "#f43f5e"
};

const typeDescriptions = {
  project: (node) => `${node.label} is a managed BuilderX project and the parent context for its project-scoped agents.`,
  agent: (node) => `${node.label} is an active agent responsible for ${humanize(node.cluster_id || node.metadata?.domain || "system coordination")} work.`,
  cluster: (node) => `${node.label} groups related system capabilities into one functional ownership boundary.`,
  feature: (node) => `${node.label} is an implemented ${humanize(node.group || "product")} capability owned by ${humanize(node.agent_id || "the BuilderX system")}.`,
  service: (node) => `${node.label} is a running service${node.metadata?.port ? ` exposed on port ${node.metadata.port}` : ""} in the BuilderX runtime.`,
  api: (node) => `${node.label} is an API boundary used for ${humanize(node.cluster_id || "system communication")}.`,
  vector_store: (node) => `${node.label} provides vector retrieval and semantic memory capabilities for the agentic system.`,
  graph_store: (node) => `${node.label} stores or represents graph relationships, topology, and ownership artifacts.`,
  human_review: (node) => `${node.label} represents the human review and approval boundary for sensitive or consequential actions.`
};

function humanize(value) {
  return String(value || "unknown").replaceAll(/[_-]/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function valueText(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function nodeDescription(node) {
  return (
    node.metadata?.description ||
    node.metadata?.responsibility ||
    typeDescriptions[node.type]?.(node) ||
    `${node.label} is a ${humanize(node.type)} node in the Agentic BuilderX topology.`
  );
}

function agentProfile(node) {
  const haystack = [
    node.label,
    node.cluster_id,
    node.agent_id,
    node.metadata?.role,
    node.metadata?.domain,
    node.metadata?.responsibility,
    node.metadata?.description
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (node.type === "project") return { icon: "📦", label: "Project" };
  if (node.type === "service") return { icon: "🖥️", label: "Service" };
  if (node.type === "api") return { icon: "🔌", label: "API" };
  if (node.type === "vector_store") return { icon: "🧠", label: "Vector memory" };
  if (node.type === "graph_store") return { icon: "🕸️", label: "Graph memory" };
  if (node.type === "human_review") return { icon: "👤", label: "Human review" };
  if (node.type === "cluster") return { icon: "🧩", label: "Cluster" };
  if (node.type === "feature") return { icon: "✨", label: "Feature" };
  if (haystack.includes("execution")) return { icon: "🛠️", label: "Execution" };
  if (haystack.includes("orchestrator")) return { icon: "🧭", label: "Orchestrator" };
  if (haystack.includes("fullstack") || haystack.includes("backend")) return { icon: "🧱", label: "Fullstack" };
  if (haystack.includes("ui") || haystack.includes("react") || haystack.includes("composition")) return { icon: "🎨", label: "UI / Experience" };
  if (haystack.includes("runtime") || haystack.includes("docker") || haystack.includes("packaging")) return { icon: "⚙️", label: "Runtime" };
  if (haystack.includes("content") || haystack.includes("data")) return { icon: "🗂️", label: "Content / Data" };
  if (haystack.includes("commerce") || haystack.includes("catalog")) return { icon: "🛍️", label: "Commerce" };
  if (haystack.includes("map") || haystack.includes("geo") || haystack.includes("search")) return { icon: "🗺️", label: "Geo / Search" };
  return { icon: "🤖", label: "Agent" };
}

async function loadGraph() {
  const sources = [
    "http://localhost:8080/api/agentic-system/graph",
    "../../topology/d3/agentic-system-graph.json"
  ];
  let lastError;
  for (const source of sources) {
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`Graph request failed: ${response.status}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function drag(simulation) {
  return d3
    .drag()
    .on("start", (event, node) => {
      if (!event.active) simulation.alphaTarget(0.25).restart();
      node.fx = node.x;
      node.fy = node.y;
    })
    .on("drag", (event, node) => {
      node.fx = event.x;
      node.fy = event.y;
    })
    .on("end", (event, node) => {
      if (!event.active) simulation.alphaTarget(0);
      node.fx = null;
      node.fy = null;
    });
}

loadGraph()
  .then((data) => {
    const nodes = data.nodes.map((node) => ({ ...node, metadata: { ...(node.metadata || {}) } }));
    const links = data.links.map((link) => ({ ...link, metadata: { ...(link.metadata || {}) } }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const groups = Array.from(new Set(nodes.map((node) => node.type)));

    statusEl.textContent = `${nodes.length} nodes · ${links.length} relationships · Click a node for insight`;
    legendEl.innerHTML = groups
      .map((group) => `<span><i style="background:${colors[group] || "#64748b"}"></i>${humanize(group)}</span>`)
      .join("");

    const width = Math.max(graphEl.clientWidth, 640);
    const height = Math.max(graphEl.clientHeight, 560);
    const svg = d3
      .select(graphEl)
      .append("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("role", "img")
      .attr("aria-label", "Interactive force-directed agentic system topology");
    const viewport = svg.append("g").attr("class", "graph-viewport");

    const zoom = d3
      .zoom()
      .scaleExtent([0.15, 4])
      .on("zoom", (event) => viewport.attr("transform", event.transform));
    svg.call(zoom).on("dblclick.zoom", null);

    const defs = svg.append("defs");
    defs
      .append("filter")
      .attr("id", "node-shadow")
      .attr("x", "-60%")
      .attr("y", "-60%")
      .attr("width", "220%")
      .attr("height", "220%")
      .html('<feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#020617" flood-opacity="0.28"/>');
    defs
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 29)
      .attr("markerWidth", 5)
      .attr("markerHeight", 5)
      .attr("orient", "auto")
      .append("path")
      .attr("fill", "#64748b")
      .attr("d", "M0,-5L10,0L0,5");

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((node) => node.id)
          .distance((link) => (link.type === "contains" || link.type === "has_orchestrator" ? 115 : 175))
          .strength(0.72)
      )
      .force("charge", d3.forceManyBody().strength(-760).distanceMax(720))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("x", d3.forceX(width / 2).strength(0.035))
      .force("y", d3.forceY(height / 2).strength(0.035))
      .force("collision", d3.forceCollide().radius((node) => (node.type === "agent" ? 76 : 62)).iterations(2));

    const link = viewport.append("g").attr("class", "links").selectAll("g").data(links).join("g").attr("class", "link-group");
    link
      .append("line")
      .attr("class", "link")
      .attr("stroke-width", (row) => Math.max(1.1, row.weight || 1))
      .attr("marker-end", "url(#arrow)");
    link.append("text").attr("class", "link-label").text((row) => humanize(row.type));

    const node = viewport
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", "node")
      .attr("tabindex", 0)
      .attr("role", "button")
      .attr("aria-label", (row) => `${row.label}, ${humanize(row.type)}`)
      .call(drag(simulation));

    node
      .append("circle")
      .attr("r", (row) => (row.type === "agent" ? 28 : row.type === "project" ? 27 : row.type === "cluster" ? 24 : 20))
      .attr("fill", (row) => colors[row.type] || "#64748b");
    node
      .append("text")
      .attr("class", "node-glyph")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .text((row) => agentProfile(row).icon);
    node.append("text").attr("class", "node-label").attr("x", 36).attr("y", -2).text((row) => row.label);
    node.append("text").attr("class", "node-subtitle").attr("x", 36).attr("y", 16).text((row) => `${agentProfile(row).label} · ${humanize(row.status)}`);

    function nodeId(value) {
      return typeof value === "object" ? value.id : value;
    }

    function connectionsFor(selected) {
      return links
        .filter((row) => nodeId(row.source) === selected.id || nodeId(row.target) === selected.id)
        .map((row) => ({
          relation: humanize(row.type),
          direction: nodeId(row.source) === selected.id ? "to" : "from",
          node: nodeById.get(nodeId(nodeId(row.source) === selected.id ? row.target : row.source))
        }))
        .filter((row) => row.node);
    }

    function selectNode(selected) {
      const connections = connectionsFor(selected);
      const connectedIds = new Set(connections.map((row) => row.node.id));
      connectedIds.add(selected.id);
      node.classed("selected", (row) => row.id === selected.id).classed("muted", (row) => !connectedIds.has(row.id));
      link.classed("muted", (row) => !connectedIds.has(nodeId(row.source)) || !connectedIds.has(nodeId(row.target)));

      const metadata = Object.entries(selected.metadata || {}).filter(
        ([key, value]) => !["description", "responsibility", "dynamicProjectGraph"].includes(key) && value !== "" && value != null
      );
      insightEl.innerHTML = `
        <div class="insight-heading">
          <span style="color:${colors[selected.type] || "#94a3b8"}">${escapeHtml(humanize(selected.type))} · ${escapeHtml(agentProfile(selected).label)}</span>
          <h2><i>${escapeHtml(agentProfile(selected).icon)}</i>${escapeHtml(selected.label)}</h2>
          <div class="insight-badges"><b>${escapeHtml(humanize(selected.status))}</b><b class="risk-${escapeHtml(selected.risk_level)}">${escapeHtml(selected.risk_level)} risk</b></div>
        </div>
        <section class="insight-section">
          <h3>Description</h3>
          <p>${escapeHtml(nodeDescription(selected))}</p>
        </section>
        ${
          metadata.length
            ? `<section class="insight-section"><h3>Metadata</h3><dl>${metadata
                .map(([key, value]) => `<div><dt>${escapeHtml(humanize(key))}</dt><dd>${escapeHtml(valueText(value))}</dd></div>`)
                .join("")}</dl></section>`
            : ""
        }
        <section class="insight-section connections">
          <h3>Connections <small>${connections.length}</small></h3>
          ${
            connections.length
              ? connections
                  .map(
                    (row) => `<button type="button" data-node-id="${escapeHtml(row.node.id)}"><span>${escapeHtml(row.direction)} · ${escapeHtml(row.relation)}</span><strong>${escapeHtml(row.node.label)}</strong></button>`
                  )
                  .join("")
              : "<p>No direct connections.</p>"
          }
        </section>`;

      insightEl.querySelectorAll("[data-node-id]").forEach((button) => {
        button.addEventListener("click", () => {
          const next = nodeById.get(button.dataset.nodeId);
          if (next) selectNode(next);
        });
      });
    }

    node.on("click", (event, row) => {
      event.stopPropagation();
      selectNode(row);
    });
    node.on("keydown", (event, row) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(row);
      }
    });
    svg.on("click", () => {
      node.classed("selected", false).classed("muted", false);
      link.classed("muted", false);
    });

    simulation.on("tick", () => {
      link
        .select("line")
        .attr("x1", (row) => row.source.x)
        .attr("y1", (row) => row.source.y)
        .attr("x2", (row) => row.target.x)
        .attr("y2", (row) => row.target.y);
      link
        .select("text")
        .attr("x", (row) => (row.source.x + row.target.x) / 2)
        .attr("y", (row) => (row.source.y + row.target.y) / 2 - 5);
      node.attr("transform", (row) => `translate(${row.x},${row.y})`);
    });

    function fitGraph(duration = 500) {
      const bounds = viewport.node().getBBox();
      if (!bounds.width || !bounds.height) return;
      const padding = 72;
      const scale = Math.min(1.2, (width - padding * 2) / bounds.width, (height - padding * 2) / bounds.height);
      const x = width / 2 - scale * (bounds.x + bounds.width / 2);
      const y = height / 2 - scale * (bounds.y + bounds.height / 2);
      svg.transition().duration(duration).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(scale));
    }

    simulation.on("end", () => fitGraph(650));
    window.setTimeout(() => fitGraph(650), 1100);
    document.getElementById("zoom-in").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 1.3));
    document.getElementById("zoom-out").addEventListener("click", () => svg.transition().call(zoom.scaleBy, 0.77));
    document.getElementById("fit-graph").addEventListener("click", () => fitGraph());
    document.getElementById("restart-force").addEventListener("click", () => simulation.alpha(0.95).restart());

    const forceButton = document.getElementById("toggle-force");
    let forceEnabled = true;
    forceButton.addEventListener("click", () => {
      forceEnabled = !forceEnabled;
      forceButton.classList.toggle("active", forceEnabled);
      forceButton.setAttribute("aria-pressed", String(forceEnabled));
      forceButton.textContent = forceEnabled ? "Force on" : "Force off";
      if (forceEnabled) simulation.alpha(0.75).restart();
      else simulation.stop();
    });
  })
  .catch((error) => {
    statusEl.textContent = error.message;
    statusEl.classList.add("error");
  });
