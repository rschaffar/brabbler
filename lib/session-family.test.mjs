import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getSessionFamily, listSessionFamilies, countRunningSubagents, getAgentsBadge } = await createJiti(import.meta.url).import("./session-family.ts");

function session(id, modified, relation) {
  return {
    path: `/tmp/${id}.jsonl`,
    id,
    cwd: "/tmp",
    created: modified,
    modified,
    messageCount: 1,
    firstMessage: id,
    ...(relation ? { relation } : {}),
  };
}

test("groups nested subagents under their main session and uses family activity for sorting", () => {
  const main = session("main", "2026-01-01T00:00:00.000Z");
  const child = session("child", "2026-01-04T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "main", profile: "explore", description: "Explore", status: "completed",
  });
  const grandchild = session("grandchild", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "child", profile: "review", description: "Review", status: "running",
  });
  const newerRoot = session("newer-root", "2026-01-02T00:00:00.000Z");

  const families = listSessionFamilies([main, child, grandchild, newerRoot]);
  assert.deepEqual(families.map((family) => family.root.id), ["main", "newer-root"]);
  assert.deepEqual(families[0].subagents.map((item) => item.id), ["child", "grandchild"]);
  assert.equal(getSessionFamily([main, child, grandchild], "grandchild")?.root.id, "main");
});

test("badge counts only distinct running descendants of this family, not roots, queues or persisted status", () => {
  const children = [session("child", "2026-01-01", { kind: "subagent", parentSessionId: "main", status: "running" }),
    session("nested", "2026-01-01", { kind: "subagent", parentSessionId: "child", status: "completed" })];
  assert.equal(countRunningSubagents(children, new Set(["main", "foreign"])), 0);
  assert.deepEqual(getAgentsBadge(children, new Set(["main", "foreign"])), { count: 2, running: false });
  assert.deepEqual(getAgentsBadge([...children, children[1]], new Set(["main", "nested", "foreign"])), { count: 1, running: true });
  assert.deepEqual(getAgentsBadge(children, new Set(["child", "nested"])), { count: 2, running: true });
  assert.deepEqual(getAgentsBadge([], new Set(["main"])), { count: 0, running: false });
});

test("does not promote orphaned or cyclic subagent metadata into the main session list", () => {
  const orphan = session("orphan", "2026-01-03T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "missing", profile: "explore", description: "Explore", status: "interrupted",
  });
  const a = session("a", "2026-01-01T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "b", profile: "a", description: "A", status: "interrupted",
  });
  const b = session("b", "2026-01-02T00:00:00.000Z", {
    kind: "subagent", parentSessionId: "a", profile: "b", description: "B", status: "interrupted",
  });

  assert.deepEqual(listSessionFamilies([orphan, a, b]), []);
  assert.equal(getSessionFamily([orphan, a, b], "orphan"), null);
});
