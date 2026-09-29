import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { changedWorkflowFields, resetWorkflowField, workflowDraftKey, receiveWorkflowSettings, resolveWorkflowDraft, workflowRequestTarget, isUnpersistedWorkflowSession } = await jiti.import("./git-workflow-drafts.ts");
const { resolveGitWorkflowSettings } = await jiti.import("../lib/git-workflow-settings.ts");
function response(options = {}) {
  const data = { revision: "r1", paused: false, projectRoot: "/repo", cwd: "/repo-worktrees/topic", global: { commits: "manual" }, project: { commits: "ask" }, session: {}, task: { kind: "none" }, sessionEditable: true, ...options };
  data.resolved = { global: resolveGitWorkflowSettings(data.global), project: resolveGitWorkflowSettings(data.global, data.project), session: resolveGitWorkflowSettings(data.global, data.project, data.session ?? {}) };
  return data;
}
const edit = (drafts, key, overrides) => ({ ...drafts, [key]: { ...drafts[key], overrides } });

test("keys use canonical projects and session IDs, never the sidebar/worktree or selected scope alone", () => {
  assert.equal(workflowDraftKey("global", "/repo", "a"), "global");
  assert.equal(workflowDraftKey("project", "/repo", "a"), workflowDraftKey("project", "/repo", "b"));
  assert.notEqual(workflowDraftKey("project", "/repo"), workflowDraftKey("project", "/other"));
  assert.notEqual(workflowDraftKey("session", "/repo", "a"), workflowDraftKey("session", "/repo", "b"));
  assert.equal(workflowDraftKey("session", "/repo", "a"), workflowDraftKey("session", "/moved", "a"));
  assert.equal(workflowDraftKey("project"), null);
  assert.equal(workflowDraftKey("session", "/repo"), null);
});

test("Off, null targets and empty checks differ from inherit; resetting touches only one field", () => {
  const explicit = { enabled: false, checks: [], targetBranch: null, commits: "off" };
  assert.deepEqual(changedWorkflowFields({}, explicit), ["enabled", "commits", "checks", "targetBranch"]);
  assert.deepEqual(resetWorkflowField(explicit, "enabled"), { checks: [], targetBranch: null, commits: "off" });
  assert.equal(explicit.enabled, false);
  assert.deepEqual(changedWorkflowFields({ enabled: false, commits: "off" }, { commits: "off", enabled: false }), []);
});

test("resolution shows selected scope only, with saved parents, not an unsaved parent or a downstream override", () => {
  const data = response({ session: { commits: "off" } });
  const globalDraft = { commits: "ask" };
  assert.equal(resolveWorkflowDraft(data, "global", globalDraft).values.commits, "ask");
  assert.equal(resolveWorkflowDraft(data, "project", {}).values.commits, "manual");
  assert.equal(resolveWorkflowDraft(data, "session", {}).values.commits, "ask");
  assert.equal(resolveWorkflowDraft(data, "session", {}).origins.commits, "project");
  assert.equal(resolveWorkflowDraft(data, "session", { commits: "off" }).origins.commits, "session");
});

test("incomplete text/recipe drafts stay renderable and non-saveable until the shared validator accepts them", () => {
  const data = response();
  for (const draft of [{ baseBranch: "topic " }, { checks: [{ label: "", argv: [""] }] }]) {
    const result = resolveWorkflowDraft(data, "project", draft);
    assert.ok(result.validationError);
    for (const key of Object.keys(draft)) assert.deepEqual(result.values[key], draft[key]);
  }
  const valid = resolveWorkflowDraft(data, "project", { checks: [{ label: "Types", argv: ["tsc", "--noEmit"] }] });
  assert.equal(valid.validationError, undefined);
});

test("close/reopen, detail navigation and switching identities preserve drafts, and one save does not save the other scopes", () => {
  const a = response();
  let drafts = receiveWorkflowSettings({}, a, "a");
  drafts = edit(drafts, "global", { enabled: false });
  drafts = edit(drafts, "project:/repo", { branch: "topic" });
  drafts = edit(drafts, "session:a", { commits: "off" });
  drafts = receiveWorkflowSettings(drafts, response({ projectRoot: "/other", project: {}, revision: "r2" }), "b");
  drafts = edit(drafts, "session:b", { cleanup: "retain" });
  drafts = receiveWorkflowSettings(drafts, a, "a");
  assert.deepEqual(drafts["session:a"].overrides, { commits: "off" });
  assert.deepEqual(drafts["session:b"].overrides, { cleanup: "retain" });
  const saved = response({ revision: "r3", global: { enabled: false } });
  drafts = receiveWorkflowSettings(drafts, saved, "a", "global");
  assert.deepEqual(changedWorkflowFields(drafts.global.baseline, drafts.global.overrides), []);
  assert.deepEqual(drafts["project:/repo"].overrides, { branch: "topic" });
  assert.deepEqual(drafts["session:a"].overrides, { commits: "off" });
  assert.equal(drafts["session:a"].revision, "r3");
});

test("changed saved baseline and explicit 409 retain draft and revision until explicit reload/discard", () => {
  const a = response();
  let drafts = edit(receiveWorkflowSettings({}, a, "a"), "project:/repo", { commits: "off" });
  drafts = receiveWorkflowSettings(drafts, response({ revision: "r2", project: { commits: "manual" } }), "a");
  assert.equal(drafts["project:/repo"].conflict, true);
  assert.equal(drafts["project:/repo"].revision, "r1");
  assert.deepEqual(drafts["project:/repo"].overrides, { commits: "off" });
  // Even a later matching GET (or another successful scope save) cannot silently retry a 409.
  drafts = receiveWorkflowSettings(drafts, a, "a");
  assert.equal(drafts["project:/repo"].conflict, true);
  drafts = receiveWorkflowSettings(drafts, response({ revision: "r3" }), "a", "project:/repo");
  assert.equal(drafts["project:/repo"].conflict, undefined);
  assert.equal(drafts["project:/repo"].revision, "r3");
  assert.deepEqual(drafts["project:/repo"].overrides, { commits: "ask" });
});

test("unsent session fallback does not create a queued settings slice; chat requests never send sidebar cwd", () => {
  assert.deepEqual(workflowRequestTarget("saved-chat", "/sidebar"), { sessionId: "saved-chat" });
  assert.deepEqual(workflowRequestTarget(undefined, "/supplied"), { cwd: "/supplied" });
  assert.deepEqual(workflowRequestTarget(), {});
  assert.equal(isUnpersistedWorkflowSession(409, "Session not persisted"), true);
  assert.equal(isUnpersistedWorkflowSession(409, "Session identity mismatch"), false);
  assert.equal(isUnpersistedWorkflowSession(403, "Access denied"), false);
  const drafts = receiveWorkflowSettings({}, response({ session: null, sessionEditable: false }));
  assert.deepEqual(Object.keys(drafts).sort(), ["global", "project:/repo"]);
});
