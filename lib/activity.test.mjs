import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getActivitySections, activityProjectName } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./activity.ts");
const session = (id, props = {}) => ({
  id, cwd: "/repo", projectRoot: "/repo", projectKey: "repo", created: "2026-01-01T00:00:00Z",
  modified: "2026-01-02T00:00:00Z", firstMessage: `Work ${id}`, messageCount: 1, path: `/tmp/${id}.jsonl`,
  ...props,
});
const child = (id, parentId, props = {}) => session(id, {
  relation: { kind: "subagent", parentSessionId: parentId, profile: "explore", status: "running" }, ...props,
});

test("only live Pi Web sessions and browser-unreviewed results enter Activity, with attention first", () => {
  const sessions = [session("waiting"), session("running"), session("done"), session("idle"),
    session("external"), session("archived", { archived: true })];
  const sections = getActivitySections(sessions, new Set(["waiting", "running", "archived"]),
    [{ sessionId: "waiting", method: "ask_user", summary: "Choose?", since: 42 },
      { sessionId: "external-not-in-catalogue", method: "custom", summary: "", since: 1 }],
    new Set(["waiting", "done", "archived"]));
  assert.deepEqual(sections["needs-you"].map((item) => item.session.id), ["waiting"]);
  assert.deepEqual(sections.working.map((item) => item.session.id), ["running"]);
  assert.deepEqual(sections.ready.map((item) => item.session.id), ["done"]);
});

test("nested subagents remain selectable in their section; cross-section children show parent context", () => {
  const sessions = [session("root"), child("child", "root"), child("grandchild", "child"),
    child("question", "root"), child("hidden", "archived"), session("archived", { archived: true })];
  const sections = getActivitySections(sessions, new Set(["root", "child", "grandchild", "question", "hidden"]),
    [{ sessionId: "question", method: "select", summary: "Choose", since: 2 }], new Set());
  assert.deepEqual(sections.working.map((item) => item.session.id), ["root", "child", "grandchild"]);
  assert.deepEqual(sections.working.map((item) => item.nested), [false, true, true]);
  assert.equal(sections["needs-you"][0].nested, false);
  assert.equal(sections["needs-you"][0].parentName, "Work root");
  assert.equal(sections.working.some((item) => item.session.id === "hidden"), false);
});

test("only live queue entries appear; persisted queued status after restart is not treated as live", () => {
  const sessions = [session("root"), child("queued", "root", {
    relation: { kind: "subagent", parentSessionId: "root", status: "queued" },
  })];
  assert.equal(getActivitySections(sessions, new Set(), [], new Set()).queued.length, 0);
  assert.deepEqual(getActivitySections(sessions, new Set(), [], new Set(), null, new Set(["queued"]))
    .queued.map((item) => item.session.id), ["queued"]);
});

test("project filter uses server identity shared across worktrees, not displayed cwd", () => {
  const sessions = [session("a", { cwd: "/repo/worktree-a", projectKey: "shared" }),
    session("b", { cwd: "/repo/worktree-b", projectKey: "shared" }),
    session("c", { cwd: "/elsewhere", projectKey: "other" })];
  const sections = getActivitySections(sessions, new Set(["a", "b", "c"]), [], new Set(), "shared");
  assert.deepEqual(sections.working.map((item) => item.session.id), ["a", "b"]);
  assert.equal(activityProjectName(session("win", { projectRoot: "C:\\code\\my-project" })), "my-project");
});
