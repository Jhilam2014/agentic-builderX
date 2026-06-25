const graphEl = document.getElementById("graph");
const statusEl = document.getElementById("status");
const legendEl = document.getElementById("legend");

const colors = {
  agent: "#2563eb",
  cluster: "#0f766e",
  feature: "#7c3aed",
  service: "#0891b2",
  api: "#d97706",
  vector_store: "#65a30d",
  graph_store: "#475569",
  human_review: "#be123c"
};

function drag(simulation) {
  return d3.drag()
    .on("start", (event, d) => {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    })
    .on("drag", (event, d) => {
      d.fx = event.x;
      d.fy = event.y;
    })
    .on("end", (event, d) => {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    });
}

fetch("/topology/d3/agentic-system-graph.json")
  .then((response) => response.json())
  .then((data) => {
    statusEl.textContent = `${data.nodes.length} nodes, ${data.links.length} links · ${data.metadata.time_zone || "Asia/Kolkata"}`;
    const groups = Array.from(new Set(data.nodes.map((node) => node.type)));
    legendEl.innerHTML = groups
      .map((group) => `<span><i style="background:${colors[group] || "#64748b"}"></i>${group.replaceAll("_", " ")}</span>`)
      .join("");

    const width = graphEl.clientWidth || 1180;
    const height = Math.max(760, window.innerHeight - 132);
    const svg = d3.select(graphEl).append("svg").attr("viewBox", [0, 0, width, height]).attr("width", "100%").attr("height", height);

    svg.append("defs").append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 24)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("fill", "#94a3b8")
      .attr("d", "M0,-5L10,0L0,5");

    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id((d) => d.id).distance((d) => d.type === "contains" ? 92 : 145).strength(0.74))
      .force("charge", d3.forceManyBody().strength(-620))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(58));

    const link = svg.append("g").attr("class", "links").selectAll("g").data(data.links).join("g");
    link.append("line").attr("class", "link").attr("stroke-width", (d) => Math.max(1.2, d.weight || 1)).attr("marker-end", "url(#arrow)");
    link.append("text").attr("class", "link-label").text((d) => d.type.replaceAll("_", " "));

    const node = svg.append("g").attr("class", "nodes").selectAll("g").data(data.nodes).join("g").attr("class", "node").call(drag(simulation));
    node.append("circle").attr("r", (d) => d.type === "agent" ? 28 : d.type === "cluster" ? 24 : 19).attr("fill", (d) => colors[d.type] || "#64748b");
    node.append("text").attr("class", "node-label").attr("x", 31).attr("y", 0).text((d) => d.label);
    node.append("text").attr("class", "node-subtitle").attr("x", 31).attr("y", 16).text((d) => `${d.type.replaceAll("_", " ")} · ${d.status}`);
    node.append("title").text((d) => `${d.label}\n${d.type}\n${d.status}\n${d.metadata?.description || d.cluster_id || ""}`);

    simulation.on("tick", () => {
      link.select("line")
        .attr("x1", (d) => d.source.x)
        .attr("y1", (d) => d.source.y)
        .attr("x2", (d) => d.target.x)
        .attr("y2", (d) => d.target.y);
      link.select("text")
        .attr("x", (d) => (d.source.x + d.target.x) / 2)
        .attr("y", (d) => (d.source.y + d.target.y) / 2);
      node.attr("transform", (d) => `translate(${d.x},${d.y})`);
    });
  })
  .catch((error) => {
    statusEl.textContent = error.message;
  });
