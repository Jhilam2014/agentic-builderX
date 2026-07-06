const graphEl = document.getElementById("graph");
const statusEl = document.getElementById("status");

async function loadGraph() {
  const response = await fetch("../../topology/d3/agentic-system-graph.json");
  if (!response.ok) throw new Error(`Unable to load graph: ${response.status}`);
  return response.json();
}

function color(type) {
  return {
    agent: "#2f6fed",
    project: "#0f766e",
    workflow: "#8a5cf6",
    cluster: "#d97706",
    graph_store: "#475569",
    vector_store: "#16a34a",
    page: "#db2777",
    validation: "#64748b"
  }[type] || "#64748b";
}

function render(data) {
  graphEl.innerHTML = "";
  const width = graphEl.clientWidth || 960;
  const height = Math.max(680, window.innerHeight - 112);
  const svg = d3.select(graphEl).append("svg")
    .attr("viewBox", [0, 0, width, height])
    .attr("width", "100%")
    .attr("height", height);

  const simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.links).id(d => d.id).distance(140))
    .force("charge", d3.forceManyBody().strength(-520))
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force("collide", d3.forceCollide(42));

  const link = svg.append("g")
    .selectAll("line")
    .data(data.links)
    .join("line")
    .attr("class", "link")
    .attr("stroke-width", d => Math.max(1, d.weight || 1));

  const node = svg.append("g")
    .selectAll("g")
    .data(data.nodes)
    .join("g")
    .attr("class", "node")
    .call(d3.drag()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x; d.fy = d.y;
      })
      .on("drag", (event, d) => {
        d.fx = event.x; d.fy = event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null; d.fy = null;
      }));

  node.append("circle")
    .attr("r", 22)
    .attr("fill", d => color(d.type))
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 2);

  node.append("title")
    .text(d => `${d.label}\n${d.type}\n${d.status}`);

  node.append("text")
    .attr("x", 28)
    .attr("y", 4)
    .text(d => d.label);

  simulation.on("tick", () => {
    link
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    node.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  statusEl.textContent = `${data.nodes.length} nodes, ${data.links.length} links. Neo4j: ${data.metadata.neo4j_status}. Vector: ${data.metadata.vector_provider} (${data.metadata.vector_status}).`;
}

loadGraph().then(render).catch(error => {
  statusEl.textContent = error.message;
});
