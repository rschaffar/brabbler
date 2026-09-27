import assert from "node:assert/strict";
import test from "node:test";

const { layoutGitGraph } = await import("./git-graph-layout.ts");

test("graph draws both merge parents in topological order and ends at the root", () => {
  const commits = [
    { oid: "merge", parents: ["main", "side"] },
    { oid: "main", parents: ["root"] },
    { oid: "side", parents: ["root"] },
    { oid: "root", parents: [] },
  ];
  const graph = layoutGitGraph(commits);
  assert.deepEqual(graph.lanes, [0, 0, 1, 0]);
  assert.equal(graph.laneCount, 2);
  assert.deepEqual(graph.links.map(({ childRow, parentRow }) => [childRow, parentRow]), [[0, 1], [0, 2], [1, 3], [2, 3]]);
});

test("truncated history omits missing-parent edges until another page is appended", () => {
  const recent = [{ oid: "second", parents: ["first"] }];
  assert.deepEqual(layoutGitGraph(recent).links, []);
  const extended = layoutGitGraph([...recent, { oid: "first", parents: [] }]);
  assert.deepEqual(extended.lanes, [0, 0]);
  assert.deepEqual(extended.links.map(({ childRow, parentRow }) => [childRow, parentRow]), [[0, 1]]);
});

test("independent visible tips take separate lanes until ancestors meet", () => {
  const graph = layoutGitGraph([
    { oid: "left", parents: ["root"] },
    { oid: "right", parents: ["root"] },
    { oid: "root", parents: [] },
  ]);
  assert.equal(graph.laneCount, 2);
  assert.deepEqual(graph.lanes, [0, 1, 0]);
});
