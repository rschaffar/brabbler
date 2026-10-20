import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { sameSessionDirectory: same, sessionFamiliesForWorktree: rows } = await jiti.import("./session-worktree-filter.ts");
const session = (id, cwd, parent, extra = {}) => ({ id, cwd, projectKey: "project", projectRoot: "/main", modified: "2026-01-01",
  ...(parent ? { relation: { kind: "subagent", parentSessionId: parent } } : {}), ...extra });

test("worktree equality preserves POSIX literals and normalizes drive/UNC identities", () => {
  assert.ok(same("/main/", "/main")); assert.ok(!same("/Main", "/main"));
  assert.ok(!same("/main\\literal", "/main/literal"));
  assert.ok(same("C:\\Work\\Repo", "c:/work/repo/"));
  assert.ok(same("\\\\Host\\Share\\Repo", "//host/share/repo"));
  assert.ok(!same("/main", "/main/sub"));
});

test("exact filtering exposes child-only matches without including the live parent", () => {
  const input = [session("parent", "/main"), session("child", "/missing", "parent"),
    session("grand", "/missing", "child"), session("other", "/elsewhere", "child")];
  const before = structuredClone(input), result = rows(input, "project", "/missing", "active");
  assert.equal(result.length, 1); assert.equal(result[0].root.id, "child");
  assert.deepEqual(result[0].subagents.map(s => s.id), ["grand"]);
  assert.deepEqual(input, before);
  assert.deepEqual(rows(input, "project", "/elsewhere", "active").map(f => f.root.id), ["other"]);
});

test("archive status follows complete ancestry, even across worktrees/projects", () => {
  const input = [session("parent", "/main", null, { archived: true, projectKey: "other" }), session("child", "/missing", "parent")];
  assert.deepEqual(rows(input, "project", "/missing", "active"), []);
  assert.equal(rows(input, "project", "/missing", "archived")[0].root.id, "child");
  assert.equal(rows(input, "project", "/missing", "both").length, 1);
  const all = rows(input, "project", null, "archived");
  assert.equal(all[0].root.id, "child", "All worktrees must not lose cross-project children");
  assert.equal(all[0].archiveOwnerId, "parent");
  assert.equal(all[0].familyArchived, true);
  assert.deepEqual(rows(input, "project", null, "active"), []);
});

test("unknown projects never widen scope; forks stay independent; matching descendants group across gaps", () => {
  const input = [session("parent", "/missing"), session("middle", "/main", "parent"), session("leaf", "/missing", "middle"),
    session("fork", "/missing", null, { relation: { kind: "fork", originSessionId: "parent" } })];
  assert.deepEqual(rows(input, "unknown", "/missing", "both"), []);
  assert.deepEqual(rows(input, "project", "/missing", "both").map(f => [f.root.id, f.subagents.map(s => s.id)]), [["parent", ["leaf"]], ["fork", []]]);
  assert.equal(rows(input, "project", null, "both").length, 2);
});

test("missing parent and cyclic relationships do not lose rows or loop", () => {
  const input = [session("orphan", "/missing", "gone"), session("a", "/missing", "b"), session("b", "/missing", "a")];
  const result = rows(input, "project", "/missing", "both");
  const ids = result.flatMap(f => [f.root.id, ...f.subagents.map(s => s.id)]);
  assert.deepEqual(new Set(ids), new Set(["orphan", "a", "b"]));
  assert.equal(ids.length, 3, "cycles must not duplicate selectable sessions");
});
