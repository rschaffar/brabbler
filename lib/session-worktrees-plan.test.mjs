import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { sessionFamilyGraph: graph, parseSessionMovePlan: parse, parseSessionMoveRequest: request,
  readSessionMoveRequest: read, effectiveSessionArchived: archived, familyAlreadyThere, SESSION_MOVE_BODY_LIMIT: bodyLimit } = await jiti.import("./session-worktrees-plan.ts");
const { sessionWorktreeInventory: inventory, sessionDirectoryState: state } = await jiti.import("./session-worktrees-inventory.ts");
const s = (id, cwd = "/old", parent, extra = {}) => ({ id, cwd, path: `/sessions/${id}.jsonl`,
  ...(parent ? { relation: { kind: "subagent", parentSessionId: parent } } : {}), ...extra });
const sample = () => ({ project: "/main", cwd: "/new", missingOnly: false,
  roots: [{ id: "root", sourceCwd: "/old", memberIds: ["root"], bindings: [{ id: "root", cwd: "/old", path: "/sessions/root.jsonl" }] }], sessionCount: 1, archivedCount: 0 });

test("family roots deduplicate ancestor/descendant selection, preserve independent forks and missing-child subtrees", () => {
  const sessions = [s("root"), s("child", "/missing", "root"), s("grand", "/live", "child"), s("fork", "/old", null, { relation: { kind: "fork", originSessionId: "root" } })];
  assert.deepEqual(graph(sessions).roots(["root", "child", "fork"]), ["root", "fork"]);
  assert.deepEqual(graph(sessions).roots(["child"]), ["child"]);
  assert.deepEqual(graph(sessions).family("child"), ["child", "grand"]);
  assert.deepEqual(graph(sessions).family("root"), ["child", "grand", "root"]);
  assert.ok(!familyAlreadyThere(sessions.slice(0, 2), "/missing"));
  assert.ok(familyAlreadyThere([s("a", "/new"), s("b", "/new")], "/new"));
});

test("unrelated orphan history does not block a move; selected cycles and duplicates refuse", () => {
  const g = graph([s("root"), s("orphan", "/old", "gone"), s("a", "/old", "b"), s("b", "/old", "a")]);
  assert.deepEqual(g.family("root"), ["root"]);
  assert.deepEqual(g.family("orphan"), ["orphan"]);
  assert.throws(() => g.family("a"), /Cyclic/);
  assert.throws(() => g.roots(["a"]), /Cyclic/);
  assert.throws(() => g.roots(["a", "b"]), /Cyclic/);
  assert.throws(() => graph([s("a"), s("a")]), /Duplicate/);
  assert.throws(() => g.roots(["unknown"]), /not found/);
});

test("archive counts follow complete ancestry, not just child-local markers", () => {
  const sessions = [s("parent", "/live", null, { archived: true }), s("child", "/missing", "parent"), s("grand", "/missing", "child")];
  const byId = new Map(sessions.map(session => [session.id, session]));
  assert.ok(sessions.every(session => archived(session, byId)));
});

test("closed plans bind every member directory/path; reject overlap, missing bindings, invented counts and fields", () => {
  assert.deepEqual(parse(sample()), sample());
  for (const mutate of [p => { p.extra = true; }, p => { p.roots[0].bindings = []; }, p => { p.roots[0].bindings[0].id = "other"; },
    p => { p.roots[0].memberIds = ["root", "root"]; }, p => { p.roots.push(structuredClone(p.roots[0])); },
    p => { p.sessionCount = 0; }, p => { p.archivedCount = 2; }, p => { p.roots[0].sourceCwd = "relative"; },
    p => { p.roots[0].bindings[0].path = "relative"; }, p => { p.roots[0].memberIds = Array(4097).fill("root"); }]) {
    const p = sample(); mutate(p); assert.throws(() => parse(p));
  }
  assert.throws(() => request({ mode: "preview", project: "/main", missingOnly: true, ids: ["root"] }));
  assert.throws(() => request({ mode: "preview", project: "/main" }));
  assert.throws(() => request({ mode: "preview", project: "/main", cwd: "/new", ids: ["root"], grant: true }));
  assert.deepEqual(request({ mode: "preview", project: "/main", missingOnly: true }), { mode: "preview", project: "/main", missingOnly: true });
});

test("request byte bound applies to streamed bodies even without Content-Length", async () => {
  const req = body => new Request("http://localhost/api/sessions/move", { method: "POST", body });
  await assert.rejects(read(req("x".repeat(bodyLimit + 1))), error => error.status === 413);
  await assert.rejects(read(req("{broken")), /valid JSON/);
  const valid = { mode: "preview", project: "/main", missingOnly: true };
  assert.deepEqual(await read(req(JSON.stringify(valid))), valid);
});

test("only actual ENOENT is missing, never permissions, IO, non-directory or registration omission", () => {
  assert.equal(state("/x", () => ({ isDirectory: () => true })), "present");
  assert.equal(state("/x", () => ({ isDirectory: () => false })), "unavailable");
  for (const code of ["EACCES", "EIO", "ENOTDIR", "ENOENT"]) assert.equal(state("/x", () => { throw { code }; }), code === "ENOENT" ? "missing" : "unavailable");
});

test("inventory merges session-only missing/archived paths, does not promote a surviving linked checkout to main", async () => {
  const sessions = [s("a", "/missing", null, { archived: true }), s("b", "/linked"), s("c", "/foreign"), s("d", "/not-admitted")];
  const result = await inventory("/main", sessions, [{ path: "/linked", branch: "feature" }], null, {
    state: p => p === "/missing" ? "missing" : p === "/not-admitted" ? "unavailable" : "present",
    project: async p => p === "/foreign" ? "/other" : "/main",
  });
  assert.equal(result.mainCwd, null); assert.ok(result.worktrees.every(row => !row.isMain));
  assert.equal(result.worktrees.find(row => row.path === "/missing").archivedCount, 1);
  assert.equal(result.worktrees.find(row => row.path === "/linked").sessionCount, 1);
  assert.equal(result.worktrees.find(row => row.path === "/not-admitted").state, "unavailable");
  assert.ok(!result.worktrees.some(row => row.path === "/foreign"));
});
