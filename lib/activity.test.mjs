import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getActivitySections, activityProjectName, liveSessionActivityStatus } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./activity.ts");
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

test("starred and Activity views share live status precedence without marking idle sessions as active", () => {
  const running = new Set(["waiting", "working"]);
  const attention = new Map([["waiting", { sessionId: "waiting", method: "ask_user" }]]);
  assert.equal(liveSessionActivityStatus("waiting", running, attention), "needs-you");
  assert.equal(liveSessionActivityStatus("working", running, attention), "working");
  assert.equal(liveSessionActivityStatus("idle", running, attention), null);
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

test("interrupted saved sessions appear without visiting the chat, below live work and above review", () => {
  const sessions = [session("interrupted"), session("busy"), session("waiting"), session("done"),
    session("archived", { archived: true }), session("unsaved", { transient: true }),
    session("other", { projectKey: "another" })];
  const interrupted = new Set(["interrupted", "busy", "waiting", "done", "archived", "unsaved", "other", "missing"]);
  const sections = getActivitySections(sessions, new Set(["busy", "waiting"]),
    [{ sessionId: "waiting", method: "ask_user", summary: "Answer", since: 1 }],
    new Set(["done"]), "repo", new Set(), interrupted);
  assert.deepEqual(sections["needs-you"].map(({ session }) => session.id), ["waiting"]);
  assert.deepEqual(sections.working.map(({ session }) => session.id), ["busy"]);
  assert.deepEqual(sections.interrupted.map(({ session }) => session.id), ["done", "interrupted"]);
  assert.equal(sections.ready.length, 0);
  assert.equal(getActivitySections(sessions, new Set(), [], new Set(), "repo", new Set(), new Set()).interrupted.length, 0);
});

test("project concealment excludes every status, shared worktrees and cross-project subagent descendants without changing source state", () => {
  const secret = { projectKey: "private", projectRoot: "/private" };
  const sessions = [session("question", secret), session("working", { ...secret, cwd: "/private-worktrees/feature" }),
    session("queued", secret), session("interrupted", secret), session("ready", secret),
    child("cross-project-child", "working", { projectKey: "public", projectRoot: "/public" }),
    child("grandchild", "cross-project-child", { projectKey: "third" }), session("public", { projectKey: "public" })];
  const running = new Set(["working", "cross-project-child", "grandchild", "public"]);
  const attention = [{ sessionId: "question", method: "ask_user", summary: "private-summary" }];
  const reviews = new Set(["ready"]);
  const queued = new Set(["queued"]);
  const interrupted = new Set(["interrupted"]);
  const before = JSON.stringify(sessions);
  const concealed = getActivitySections(sessions, running, attention, reviews, null, queued, interrupted, new Set(["private"]));
  assert.deepEqual(Object.values(concealed).flat().map(({ session }) => session.id), ["public"]);
  assert.doesNotMatch(JSON.stringify(concealed), /private-summary|cross-project-child|grandchild/);
  const revealed = getActivitySections(sessions, running, attention, reviews, null, queued, interrupted);
  assert.equal(Object.values(revealed).flat().length, 8);
  assert.equal(revealed.ready[0].session.id, "ready");
  assert.equal(JSON.stringify(sessions), before);
  assert.deepEqual([...reviews], ["ready"]);
  const filtered = getActivitySections(sessions, running, attention, reviews, "private", queued, interrupted, new Set(["private"]));
  assert.equal(Object.values(filtered).flat().length, 0);
});

test("unresolved project identities and orphan subagents are withheld when privacy is configured", () => {
  const sessions = [session("fresh-worktree", { cwd: "/private-worktrees/fresh", projectRoot: undefined, projectKey: undefined }),
    child("orphan", "missing-private-parent"), session("public")];
  const running = new Set(sessions.map((session) => session.id));
  const concealed = getActivitySections(sessions, running, [], new Set(), null, new Set(), new Set(), new Set(["private"]));
  assert.deepEqual(concealed.working.map(({ session }) => session.id), ["public"]);
  assert.equal(getActivitySections(sessions, running, [], new Set()).working.length, 3, "explicit reveal preserves unresolved/orphan work");
});

test("hidden-family traversal terminates with cyclic subagent metadata", () => {
  const sessions = [child("a", "b"), child("b", "a")];
  assert.equal(getActivitySections(sessions, new Set(["a", "b"]), [], new Set(), null, new Set(), new Set(), new Set(["unrelated"])).working.length, 2);
});

test("project filter uses server identity shared across worktrees, not displayed cwd", () => {
  const sessions = [session("a", { cwd: "/repo/worktree-a", projectKey: "shared" }),
    session("b", { cwd: "/repo/worktree-b", projectKey: "shared" }),
    session("c", { cwd: "/elsewhere", projectKey: "other" })];
  const sections = getActivitySections(sessions, new Set(["a", "b", "c"]), [], new Set(), "shared");
  assert.deepEqual(sections.working.map((item) => item.session.id), ["a", "b"]);
  assert.equal(activityProjectName(session("win", { projectRoot: "C:\\code\\my-project" })), "my-project");
});
