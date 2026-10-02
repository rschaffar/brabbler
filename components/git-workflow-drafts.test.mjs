import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { changedWorkflowFields, changedWorkflowDraftFields, configureNewAgentCommits, createWorkflowRecipeEditors,
  editWorkflowCheck, editWorkflowCheckEnvironment, editWorkflowCheckOptional, parseWorkflowEnvironment, workflowDraftOverrides,
  resetWorkflowField, workflowDraftKey, receiveWorkflowSettings, resolveWorkflowDraft, workflowRequestTarget, isUnpersistedWorkflowSession } = await jiti.import("./git-workflow-drafts.ts");
const { MAX_GIT_CHECK_CWD, MAX_GIT_CHECK_ENV_ENTRIES, MAX_GIT_CHECK_ENV_NAME, MAX_GIT_CHECK_ENV_VALUE,
  MAX_GIT_CHECK_ENV_BYTES } = await jiti.import("../lib/git-check-recipe.ts");
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

test("cleanup drafts inherit saved ancestors, keep confirmation independent and preserve omission across navigation", () => {
  const data = response({ global: { cleanup: "retain" }, project: { cleanup: "worktree-and-branch", cleanupConfirmation: "ask" } });
  const original = structuredClone(data);
  let drafts = receiveWorkflowSettings({}, data, "chat");
  assert.deepEqual(drafts["session:chat"].overrides, {}, "reading does not mint a retain override");
  const globalDraft = { cleanup: "worktree-and-branch" };
  const projectDraft = { cleanup: "retain" };
  assert.equal(resolveWorkflowDraft(data, "global", globalDraft).values.cleanup, "worktree-and-branch");
  assert.equal(resolveWorkflowDraft(data, "project", {}).values.cleanup, "retain", "unsaved Global draft does not inherit");
  const inherited = resolveWorkflowDraft(data, "session", {});
  assert.equal(inherited.values.cleanup, "worktree-and-branch", "unsaved Project draft does not inherit");
  assert.equal(inherited.origins.cleanup, "project");
  assert.equal(inherited.values.cleanupConfirmation, "ask");
  const selected = { cleanup: "retain", cleanupConfirmation: "none" };
  assert.deepEqual(changedWorkflowFields({}, selected), ["cleanup", "cleanupConfirmation"]);
  const reset = resetWorkflowField(selected, "cleanup");
  assert.deepEqual(reset, { cleanupConfirmation: "none" });
  assert.equal(resolveWorkflowDraft(data, "session", reset).values.cleanup, "worktree-and-branch");
  assert.equal(resolveWorkflowDraft(data, "session", reset).values.cleanupConfirmation, "none");
  assert.equal(resolveWorkflowDraft(data, "session", selected).origins.cleanup, "session");
  drafts = edit(drafts, "global", globalDraft);
  drafts = edit(drafts, "project:/repo", projectDraft);
  drafts = edit(drafts, "session:chat", selected);
  drafts = receiveWorkflowSettings(drafts, response({ projectRoot: "/other", session: null }), "other");
  drafts = receiveWorkflowSettings(drafts, data, "chat");
  assert.deepEqual(drafts["session:chat"].overrides, selected);
  assert.deepEqual(drafts["session:chat"].baseline, {});
  assert.deepEqual(drafts["project:/repo"].overrides, projectDraft);
  assert.equal(resolveWorkflowDraft(data, "session", { cleanup: "automatic" }).validationError, "Invalid workflow setting: cleanup");
  assert.deepEqual(data, original, "draft edits never change saved settings or task");
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

test("optional recipe edits preserve omission and exact defaults, labels/argv and unrelated fields", () => {
  const old = { label: "Old", argv: ["npm", "test"] };
  const data = response({ project: { checks: [old] } });
  const entry = receiveWorkflowSettings({}, data, "chat")["project:/repo"];
  assert.deepEqual(workflowDraftOverrides(entry), { checks: [old] });
  assert.deepEqual(Object.keys(workflowDraftOverrides(entry).checks[0]), ["label", "argv"]);
  assert.deepEqual(editWorkflowCheckOptional(old, "cwd", ""), old);
  assert.deepEqual(editWorkflowCheckOptional(old, "requiredStage", ""), old);
  for (const stage of ["commit", "integration", "handoff", "none"]) {
    const edited = editWorkflowCheckOptional(old, "requiredStage", stage);
    assert.deepEqual(edited, { ...old, requiredStage: stage });
    assert.equal(resolveWorkflowDraft(data, "project", { checks: [edited] }).validationError, undefined);
    assert.deepEqual(editWorkflowCheckOptional(edited, "requiredStage", ""), old);
  }
  const extended = { ...old, cwd: ".", env: { CI: "1", EMPTY: "" }, requiredStage: "integration" };
  assert.deepEqual(editWorkflowCheckOptional(extended, "cwd", "packages/web"), { ...extended, cwd: "packages/web" });
  assert.deepEqual(editWorkflowCheckOptional(extended, "cwd", ""), { ...old, env: extended.env, requiredStage: "integration" });
  assert.deepEqual(editWorkflowCheckOptional(extended, "requiredStage", ""), { ...old, cwd: ".", env: extended.env });
  assert.deepEqual(old, { label: "Old", argv: ["npm", "test"] });
  for (const [field, value] of [["cwd", "../outside"], ["cwd", "/absolute"], ["cwd", "packages/"], ["cwd", "a".repeat(MAX_GIT_CHECK_CWD + 1)], ["requiredStage", "automatic"]]) {
    const raw = editWorkflowCheckOptional(extended, field, value);
    const result = resolveWorkflowDraft(data, "project", { checks: [raw] });
    assert.ok(result.validationError);
    assert.equal(result.values.checks[0][field], value, "invalid text is not silently trimmed, dropped or defaulted");
  }
});

test("literal environment rows are lossless and stable across name edits, invalid duplicates, navigation and correction", () => {
  const old = { label: "Old", argv: ["npm", "test"], cwd: "packages/web", requiredStage: "handoff" };
  const data = response({ project: { checks: [old] } });
  let drafts = receiveWorkflowSettings({}, data, "chat");
  let entry = drafts["project:/repo"];
  const recipeId = entry.recipeEditors[0].id;
  const rows = [{ id: "stable-row", name: "", value: "literal $VALUE = untouched" }];
  entry = editWorkflowCheckEnvironment(entry, [old], 0, rows);
  assert.deepEqual(entry.recipeEditors[0].envRows, rows);
  assert.equal(entry.recipeEditors[0].id, recipeId);
  assert.ok(changedWorkflowDraftFields(entry).includes("checks"), "invalid raw rows are dirty even if saved env did not change");
  assert.ok(resolveWorkflowDraft(data, "project", entry.overrides, entry.recipeEditors).validationError);
  assert.throws(() => workflowDraftOverrides(entry));
  rows[0].name = "CI";
  assert.equal(entry.recipeEditors[0].envRows[0].name, "", "raw input was copied");
  entry = editWorkflowCheckEnvironment(entry, entry.overrides.checks, 0, rows);
  assert.equal(entry.recipeEditors[0].envRows[0].id, "stable-row");
  assert.deepEqual(workflowDraftOverrides(entry).checks[0], { ...old, env: { CI: "literal $VALUE = untouched" } });
  const duplicated = [...rows, { id: "second-row", name: "ci", value: "second" }];
  entry = editWorkflowCheckEnvironment(entry, entry.overrides.checks, 0, duplicated);
  assert.equal(entry.recipeEditors[0].envRows.length, 2);
  assert.throws(() => workflowDraftOverrides(entry), /Duplicate/);
  assert.match(resolveWorkflowDraft(data, "project", entry.overrides, entry.recipeEditors).validationError, /Duplicate/);
  entry = { ...entry, overrides: { ...entry.overrides, checks: [editWorkflowCheck(entry.overrides.checks[0], "label", "Renamed")] } };
  drafts = { ...drafts, "project:/repo": entry };
  drafts = receiveWorkflowSettings(drafts, response({ projectRoot: "/other", project: {} }), "other");
  drafts = receiveWorkflowSettings(drafts, data, "chat");
  entry = drafts["project:/repo"];
  assert.deepEqual(entry.recipeEditors[0].envRows, duplicated, "closure/scope refresh cannot drop or overwrite duplicates");
  assert.equal(entry.overrides.checks[0].label, "Renamed");
  assert.throws(() => workflowDraftOverrides(entry), /Duplicate/);
  entry = editWorkflowCheckEnvironment(entry, entry.overrides.checks, 0, [rows[0], { ...duplicated[1], name: "EMPTY", value: "" }]);
  const payload = workflowDraftOverrides(entry);
  assert.deepEqual(payload.checks[0], { ...old, label: "Renamed", env: { CI: "literal $VALUE = untouched", EMPTY: "" } });
  assert.doesNotMatch(JSON.stringify(payload), /stable-row|second-row|envRows|envEdited|recipeEditors/);
  entry = editWorkflowCheckEnvironment(entry, entry.overrides.checks, 0, []);
  assert.equal(Object.hasOwn(workflowDraftOverrides(entry).checks[0], "env"), false);
  assert.equal(resolveWorkflowDraft(data, "project", entry.overrides, entry.recipeEditors).validationError, undefined);
  assert.equal(Object.hasOwn(old, "env"), false);
});

test("environment parsing rejects exact/case duplicates, incomplete rows, unsafe names/values, types and bounds without last-wins", () => {
  const row = (name = "CI", value = "1", id = "a") => ({ id, name, value });
  assert.deepEqual(parseWorkflowEnvironment([row("CI", "$literal"), row("EMPTY", "", "b")]), { CI: "$literal", EMPTY: "" });
  assert.equal(parseWorkflowEnvironment([]), undefined);
  const invalid = [
    [row(), row("CI", "second", "b")], [row(), row("ci", "second", "b")], [row(), row("OTHER", "value")],
    [row("")], [row("with space")], [row("GIT_DIR")], [row("api_token")], [row("NEXT_SECRET")], [row("PORT")],
    [row("CI", "https://example.invalid")], [row("CI", "token=secret-value")], [row("CI", "two\nlines")],
    [row(42)], [row("CI", 42)], [row("CI", "1", null)],
    [row("A".repeat(MAX_GIT_CHECK_ENV_NAME + 1))], [row("CI", "x".repeat(MAX_GIT_CHECK_ENV_VALUE + 1))],
    [row("CI", "é".repeat(MAX_GIT_CHECK_ENV_VALUE / 2 + 1))],
    Array.from({ length: MAX_GIT_CHECK_ENV_ENTRIES + 1 }, (_, i) => row(`VAR_${i}`, "", String(i))),
    Array.from({ length: 17 }, (_, i) => row(`VAR_${i}`, "x".repeat(MAX_GIT_CHECK_ENV_VALUE), String(i))),
  ];
  assert.ok(17 * MAX_GIT_CHECK_ENV_VALUE > MAX_GIT_CHECK_ENV_BYTES);
  const data = response({ project: { checks: [{ label: "Test", argv: ["true"] }] } });
  const original = receiveWorkflowSettings({}, data, "chat")["project:/repo"];
  for (const rows of invalid) {
    const before = structuredClone(rows);
    assert.throws(() => parseWorkflowEnvironment(rows));
    const draft = editWorkflowCheckEnvironment(original, data.project.checks, 0, rows);
    assert.ok(resolveWorkflowDraft(data, "project", draft.overrides, draft.recipeEditors).validationError);
    assert.deepEqual(draft.recipeEditors[0].envRows, before);
    assert.throws(() => workflowDraftOverrides(draft));
  }
});

test("untouched explicit empty env survives; explicit removal omits it; row and recipe IDs survive reorder", () => {
  const checks = [{ label: "First", argv: ["true"], env: {} }, { label: "Second", argv: ["true"], env: { CI: "1" } }];
  const data = response({ project: { checks } });
  const entry = receiveWorkflowSettings({}, data, "chat")["project:/repo"];
  assert.deepEqual(workflowDraftOverrides(entry).checks, checks);
  const removed = editWorkflowCheckEnvironment(entry, checks, 0, []);
  assert.equal(Object.hasOwn(workflowDraftOverrides(removed).checks[0], "env"), false);
  const edited = editWorkflowCheckEnvironment(entry, checks, 1, [{ ...entry.recipeEditors[1].envRows[0], name: "CI_CHANGED" }]);
  const moved = { ...edited, overrides: { checks: [...edited.overrides.checks].reverse() }, recipeEditors: [...edited.recipeEditors].reverse() };
  assert.equal(moved.recipeEditors[0].id, entry.recipeEditors[1].id);
  assert.equal(moved.recipeEditors[0].envRows[0].id, entry.recipeEditors[1].envRows[0].id);
  assert.deepEqual(workflowDraftOverrides(moved).checks[0].env, { CI_CHANGED: "1" });
  assert.deepEqual(createWorkflowRecipeEditors(checks, "stable"), createWorkflowRecipeEditors(checks, "stable"));
});

test("a dirty non-recipe draft refreshes inherited recipe rows from saved ancestors only", () => {
  const data = response({ project: { checks: [{ label: "One", argv: ["true"] }] } });
  let drafts = edit(receiveWorkflowSettings({}, data, "chat"), "session:chat", { commits: "off" });
  const next = response({ revision: "r2", project: { checks: [{ label: "Two", argv: ["true"], env: { CI: "1" } }, { label: "Three", argv: ["true"] }] } });
  drafts = receiveWorkflowSettings(drafts, next, "chat");
  assert.equal(drafts["session:chat"].recipeEditors.length, 2);
  assert.equal(drafts["session:chat"].recipeEditors[0].envRows[0].name, "CI");
  assert.deepEqual(drafts["session:chat"].overrides, { commits: "off" });
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
