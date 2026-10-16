import assert from "node:assert/strict";

/** Compare actual rendered geometry, not the shared assumptions in the layout data. */
export async function checkGitGraphAlignment(graph) {
  const geometry = await graph.evaluate((element) => {
    const center = (node) => {
      const bounds = node.getBoundingClientRect();
      return bounds.top + bounds.height / 2;
    };
    return {
      nodes: [...element.querySelectorAll("svg circle")].map(center),
      rows: [...element.querySelectorAll("button[title]")].map((row) => ({
        oid: row.title.split("\n")[0],
        center: center(row),
      })),
    };
  });
  assert.ok(geometry.rows.length > 0, "Graph contains commit rows");
  assert.equal(geometry.nodes.length, geometry.rows.length, "Each commit row has one graph node");
  for (const [index, row] of geometry.rows.entries()) {
    assert.ok(Math.abs(geometry.nodes[index] - row.center) <= 1,
      `Graph node aligns with commit ${row.oid}: node=${geometry.nodes[index]}, row=${row.center}`);
  }
}
