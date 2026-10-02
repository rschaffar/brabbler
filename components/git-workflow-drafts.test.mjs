import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { changedWorkflowFields, configureNewAgentCommits, editWorkflowCheck, resetWorkflowField, workflowDraftKey, receiveWorkflowSettings, resolveWorkflowDraft, workflowRequestTarget, isUnpersistedWorkflowSession } = await jiti.import("./git-workflow-drafts.ts");
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
  const explicit = { enabled: false, managedGitToolsOnly: false, checks: [], targetBranch: null, commits: "off" };
  assert.deepEqual(changedWorkflowFields({}, explicit), ["enabled", "managedGitToolsOnly", "commits", "checks", "targetBranch"]);
  assert.deepEqual(resetWorkflowField(explicit, "enabled"), { managedGitToolsOnly: false, checks: [], targetBranch: null, commits: "off" });
  assert.equal(explicit.enabled, false);
  assert.deepEqual(changedWorkflowFields({ enabled: false, commits: "off" }, { commits: "off", enabled: false }), []);
});

test("new agent-commit draft is an explicit paired edit, not an automatic migration or saved authorization", () => {
  for (const old of ["off", "manual", "ask"]) {
    const saved = { commits: old, workspace: "current", commitConfirmation: "ask" };
    const draft = configureNewAgentCommits(saved);
    assert.deepEqual(draft, { commits: "ask", workspace: "current", commitConfirmation: "none" });
    assert.deepEqual(saved, { commits: old, workspace: "current", commitConfirmation: "ask" });
  }
  const settings = response({ global: { commits: "off" }, project: { commits: "manual" }, session: { commits: "off" } });
  const drafts = receiveWorkflowSettings({}, settings, "chat");
  const selected = edit(drafts, "session:chat", configureNewAgentCommits(drafts["session:chat"].overrides));
  assert.equal(resolveWorkflowDraft(settings, "session", selected["session:chat"].overrides).values.commitConfirmation, "none");
  assert.deepEqual(settings.session, { commits: "off" });
  assert.deepEqual(drafts["session:chat"].baseline, { commits: "off" });
  assert.deepEqual(drafts["project:/repo"].overrides, { commits: "manual" });
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

test("recipe draft edits preserve all optional fields and exact omission across navigation and refresh", () => {
  const old = { label: "Legacy", argv: ["npm", "test"] };
  const extended = { label: "Extended", argv: ["node", "check.mjs"], cwd: "packages/web", env: { CI: "1" }, requiredStage: "handoff" };
  for (const [part, value] of [["label", "New label"], ["executable", "npm"], ["arguments", "run\ntest"], ["arguments", ""]]) {
    const edited = editWorkflowCheck(extended, part, value);
    assert.equal(edited.cwd, extended.cwd);
    assert.deepEqual(edited.env, extended.env);
    assert.equal(edited.requiredStage, extended.requiredStage);
    assert.notEqual(edited.env, extended.env);
    assert.notEqual(edited.argv, extended.argv);
    assert.deepEqual(Object.keys(editWorkflowCheck(old, part, value)), ["label", "argv"]);
  }
  const data = response({ project: { checks: [old, extended] } });
  const draft = { checks: [old, editWorkflowCheck(extended, "label", "Changed")] };
  let drafts = edit(receiveWorkflowSettings({}, data, "chat"), "project:/repo", draft);
  drafts = receiveWorkflowSettings(drafts, response({ projectRoot: "/other", project: {} }), "chat");
  drafts = receiveWorkflowSettings(drafts, data, "chat");
  assert.deepEqual(drafts["project:/repo"].overrides, draft);
  assert.deepEqual(resolveWorkflowDraft(data, "project", draft).values.checks, draft.checks);
  const incomplete = { checks: [old, editWorkflowCheck(extended, "executable", "")] };
  const result = resolveWorkflowDraft(data, "project", incomplete);
  assert.ok(result.validationError);
  assert.deepEqual(result.values.checks, incomplete.checks);
  assert.deepEqual(data.project.checks, [old, extended], "saved baseline remains untouched");
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

test("explicit project requests and chat×project draft keys never inherit another project's draft", () => {
  assert.deepEqual(workflowRequestTarget("chat", "/sidebar", "/selected"), { sessionId: "chat", projectPath: "/selected" });
  assert.deepEqual(workflowRequestTarget(undefined, "/sidebar", "/selected"), { projectPath: "/selected" });
  const key = (project) => workflowDraftKey("session", project, "chat", "project");
  assert.notEqual(key("/a"), key("/b"));
  assert.notEqual(key("/a"), workflowDraftKey("session", "/a", "chat"));
  assert.equal(workflowDraftKey("session", undefined, "chat", "project"), null);
  const a = response({ sessionScope: "project", projectRoot: "/a", session: { targetBranch: "a-main" } });
  const b = response({ sessionScope: "project", projectRoot: "/b", session: { targetBranch: "b-main" } });
  let drafts = receiveWorkflowSettings({}, a, "chat");
  drafts = edit(drafts, key("/a"), { targetBranch: "a-unsaved" });
  drafts = receiveWorkflowSettings(drafts, b, "chat");
  drafts = edit(drafts, key("/b"), { targetBranch: "b-unsaved" });
  drafts = receiveWorkflowSettings(drafts, a, "chat");
  assert.equal(drafts[key("/a")].overrides.targetBranch, "a-unsaved");
  assert.equal(drafts[key("/b")].overrides.targetBranch, "b-unsaved");
  const savedB = response({ sessionScope: "project", projectRoot: "/b", revision: "r2", session: { targetBranch: "b-unsaved" } });
  drafts = receiveWorkflowSettings(drafts, savedB, "chat", key("/b"));
  assert.equal(drafts[key("/a")].overrides.targetBranch, "a-unsaved");
  assert.deepEqual(changedWorkflowFields(drafts[key("/b")].overrides, drafts[key("/b")].baseline), []);
});
