import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import { createJiti } from "jiti";

const home = await readFile(new URL("./GitWorkflowHome.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("./GitWorkflowHome.css", import.meta.url), "utf8");
const jiti = createJiti(import.meta.url);
const settings = await jiti.import("../lib/git-workflow-settings.ts");
const recipes = await jiti.import("../lib/git-check-recipe.ts");
const permissions = await jiti.import("../lib/git-workflow-permissions.ts");
const helpers = await jiti.import("./git-workflow-drafts.ts");
const compiled = ts.transpileModule(home, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const session = { id: "saved-chat", cwd: "/repo-worktrees/chat", name: "A task" };
function fixture(options = {}) {
  const data = { revision: "r1", paused: false, cwd: session.cwd, projectRoot: "/repo", global: { commits: "manual" }, project: { commits: "ask", targetBranch: "local-target" }, session: {}, task: { kind: "none" }, sessionEditable: true, ...options };
  data.resolved = Object.fromEntries(["global", "project", "session"].map((scope) => [scope, settings.resolveGitWorkflowSettings(data.global, scope !== "global" ? data.project : undefined, scope === "session" ? data.session ?? {} : undefined)]));
  return data;
}
function render({ data = fixture(), scope = "session", overrides, recipeEditors, props = {} } = {}) {
  const actualProps = { visible: true, session, cwd: "/sidebar", busy: false, attention: false, detail: null, onClose() {}, onDetailChange() {}, onDetailHost() {}, ...props };
  const context = JSON.stringify([actualProps.session?.id ?? null, actualProps.session?.cwd ?? actualProps.cwd ?? null, Boolean(actualProps.session?.transient), null]);
  let drafts = helpers.receiveWorkflowSettings({}, data, actualProps.session?.id);
  if (overrides) {
    const key = helpers.workflowDraftKey(scope, data.projectRoot, actualProps.session?.id, data.sessionScope);
    drafts = { ...drafts, [key]: { ...drafts[key], overrides,
      recipeEditors: recipeEditors ?? (overrides.checks ? helpers.createWorkflowRecipeEditors(overrides.checks, key) : drafts[key].recipeEditors) } };
  }
  // Seed only server-loaded state; event/fetch behavior is exercised by browser tests.
  const states = { 2: scope, 4: drafts, 5: { context, data, sessionBound: !!actualProps.session } };
  let index = 0;
  const component = new Module(new URL("./GitWorkflowHome.tsx", import.meta.url).pathname);
  component.filename = new URL("./GitWorkflowHome.tsx", import.meta.url).pathname;
  const realRequire = createRequire(import.meta.url);
  component.require = (id) => {
    if (id === "react") return { ...React, useState: (initial) => {
      const value = Object.hasOwn(states, index) ? states[index] : typeof initial === "function" ? initial() : initial;
      index++; return [value, () => {}];
    } };
    if (id === "@/hooks/useResizablePanel") return { useResizablePanel: () => ({ panelRef: { current: null }, separatorProps: { role: "separator" } }) };
    if (id === "@/lib/git-workflow-settings") return settings;
    if (id === "@/lib/git-check-recipe") return recipes;
    if (id === "@/lib/git-workflow-permissions") return permissions;
    if (id === "./git-workflow-drafts") return helpers;
    if (id === "./GitWorkflowTaskBinding") return { GitWorkflowTaskBinding: () => React.createElement("div", { "data-task-binding": true }) };
    if (id === "./GitProjectAuthorizations") return { GitProjectAuthorizations: (props) => React.createElement("div", { "data-authorization-scope": props.scope }) };
    if (id.endsWith(".css")) return {};
    return realRequire(id);
  };
  component._compile(compiled, component.filename);
  return renderToStaticMarkup(React.createElement(component.exports.GitWorkflowHome, actualProps));
}

test("every scope renders the same five expandable stages with its own resolved values", () => {
  for (const scope of ["global", "project", "session"]) {
    const html = render({ scope });
    assert.equal(html.match(/class="workflow-stage-heading"/g)?.length, 5);
    for (const stage of ["workspace", "commits", "checks", "integration", "cleanup"]) assert.match(html, new RegExp(`aria-controls="workflow-stage-${stage}"`));
    assert.match(html, /aria-label="Edit scope"/);
    assert.match(html, /Inheritance/);
    assert.match(html, /role="switch"/);
  }
  const global = render({ scope: "global" });
  assert.match(global, /value="manual" selected=""/);
  assert.match(global, /id="workflow-targetBranch"[^>]*value=""/);
  assert.match(render({ scope: "project" }), /id="workflow-targetBranch"[^>]*value="local-target"/);
});

test("new commit draft affordance is explicit for Off/Manual, while existing Ask remains untouched", () => {
  const off = render({ data: fixture({ project: { commits: "off" } }), scope: "project" });
  const manual = render({ data: fixture({ project: { commits: "manual" } }), scope: "project" });
  const ask = render({ data: fixture({ project: { commits: "ask" } }), scope: "project" });
  for (const html of [off, manual]) {
    assert.match(html, /Draft new agent commits: Ask \+ no-confirm preference/);
    assert.match(html, /Drafting does not save settings, approve a candidate or grant execution/);
  }
  assert.doesNotMatch(ask, /Draft new agent commits: Ask \+ no-confirm preference/);
  assert.match(ask, /eligible fresh agent commit request in a persisted ordinary chat/);
  assert.match(ask, /FF is supported for eligible session-bound local integration/);
  assert.doesNotMatch(ask, /FF and squash cannot execute yet/);
});

test("commit no-confirm copy retains fresh agent provenance and manual Ask while selected stages state independent live gates", () => {
  const html = render({ overrides: { commitConfirmation: "none" } });
  const commits = html.match(/<div id="workflow-stage-commits"[\s\S]*?<\/section>/)[0];
  assert.match(commits, /<option value="none" selected="">No confirmation preference · eligible fresh agent commits still need saved Allow and live guards/);
  assert.match(commits, /explicit eligible fresh agent commit request in a persisted ordinary chat/);
  assert.match(commits, /confirmation:none, a fresh saved Allow and live guards/);
  assert.match(commits, /subject to stricter instructions/);
  assert.match(commits, /Manual human commit routes still require exact Ask approval/);
  assert.match(commits, /Drafting does not save settings, approve a candidate or grant execution/);
  assert.doesNotMatch(commits, /execution not yet available/);
  const workspace = html.match(/<div id="workflow-stage-workspace"[\s\S]*?<\/section>/)[0];
  assert.match(workspace, /No confirmation preference · explicit request, saved Allow and live gates required/);
  const cleanup = html.match(/<div id="workflow-stage-cleanup"[\s\S]*?<\/section>/)[0];
  assert.match(cleanup, /Selected public cleanup is supported on eligible Linux paths/);
});

test("no-chat Global editing is usable and cannot initialize a chat", () => {
  const html = render({ data: fixture({ projectRoot: undefined, cwd: undefined, session: null, sessionEditable: false }), scope: "global", props: { session: null, cwd: null } });
  assert.match(html, /No active task/);
  assert.match(html, /Configuration project/);
  assert.match(html, /No chat is created here/);
  assert.equal(html.match(/class="workflow-stage-heading"/g)?.length, 5);
  assert.doesNotMatch(home, /\/api\/agent\/new|setNewChatOverride|queued policy/);
});

test("current task is pinned outside the editor and adoption is separate from scoped save", () => {
  const data = fixture({ task: { kind: "managed", settings: { ...settings.DEFAULT_GIT_WORKFLOW_SETTINGS, commits: "manual", targetBranch: "pinned-target" } } });
  for (const scope of ["global", "project", "session"]) {
    const html = render({ data, scope, overrides: { enabled: false } });
    assert.match(html, /Using captured task settings/);
    assert.match(html, /Task: pinned-target/);
    assert.match(html, /Defaults differ — compare/);
    assert.match(html, /Apply saved settings to this task/);
    assert.match(html, /Only this scope is saved/);
    assert.match(html, /Explicit Project or Session overrides may still enable them/);
    assert.match(html, /aria-label="Integrated Git workflow · [^"]+"[^>]*>Off/);
  }
});

test("Project recipes expose optional literal fields without claiming execution, authorization or default serialization", () => {
  const check = { label: "Subproject", argv: ["npm", "test"], cwd: "packages/web", env: { CI: "1" }, requiredStage: "handoff" };
  const data = fixture({ project: { checks: [check] } });
  const edited = helpers.editWorkflowCheck(check, "label", "Renamed");
  const html = render({ data, scope: "project", overrides: { checks: [edited] } });
  assert.match(html, /Renamed/);
  assert.match(html, /packages\/web/);
  assert.match(html, /handoff/);
  assert.match(html, /Environment name<input maxLength="64" value="CI"/);
  assert.match(html, /Literal value<input maxLength="512" value="1"/);
  assert.match(html, /Checkout-relative directory · optional<input maxLength="256"[^>]*value="packages\/web"/);
  assert.match(html, /Required stage · recipe prerequisite/);
  assert.match(html, /<option value="handoff" selected="">Handoff<\/option>/);
  assert.match(html, /<option value="commit">Commit<\/option>/);
  assert.match(html, /<option value="integration">Integration · explicit<\/option>/);
  assert.match(html, /<option value="none">None · optional\/manual only<\/option>/);
  assert.match(html, /not human confirmation or permission to execute/);
  assert.match(html, /Saving does not run checks or grant execution/);
  assert.match(html, /An empty list does not waive project-required verification/);
  assert.match(html, /Up to 32 rows, 8192 UTF-8 bytes total/);
  assert.match(html, /removing all rows omits env/);
  assert.deepEqual(data.project.checks, [check]);
  const old = render({ data: fixture({ project: { checks: [{ label: "Old", argv: ["npm", "test"] }] } }), scope: "project" });
  assert.match(old, /value="" selected="">Default · integration \(field omitted\)/);
  assert.match(old, /placeholder="Checkout root \(field omitted\)" value=""/);
  assert.doesNotMatch(old, /Environment name<input/);
  assert.doesNotMatch(old, /Extended recipe fields retained|editing and execution are not supported yet/);
});

test("recipe controls are Project-only and Global/Session never enable recipe definitions", () => {
  const data = fixture({ project: { checks: [{ label: "Scoped", argv: ["true"], cwd: ".", env: { CI: "1" }, requiredStage: "integration" }] } });
  const session = render({ data, scope: "session" }).match(/<div id="workflow-stage-checks"[\s\S]*?<\/section>/)[0];
  assert.match(session, /Checkout-relative directory · optional<input disabled=""/);
  assert.match(session, /Required stage · recipe prerequisite<select disabled=""/);
  assert.match(session, /<fieldset disabled=""><legend>Literal environment overrides/);
  assert.match(session, /<button type="button" disabled="">Add check/);
  assert.match(session, /<button type="button" disabled="">No checks at this scope/);
  const global = render({ data, scope: "global" });
  assert.doesNotMatch(global, /Environment name<input/);
  assert.match(global, /<button type="button" disabled="">Add check/);
  assert.match(global, /Recipes belong to Project, not Global or Chat/);
  assert.match(render({ data, scope: "project" }), /<option value="integration" selected="">Integration · explicit/);
});

test("invalid raw environment rows and optional recipe fields remain visible with an error and Save blocked", () => {
  const check = { label: "Test", argv: ["true"] };
  const data = fixture({ project: { checks: [check] } });
  const entry = helpers.receiveWorkflowSettings({}, data, "saved-chat")["project:/repo"];
  const cases = [
    [{ id: "one", name: "CI", value: "first" }, { id: "two", name: "CI", value: "second" }],
    [{ id: "one", name: "", value: "$LITERAL" }], [{ id: "one", name: "API_TOKEN", value: "value" }],
    Array.from({ length: recipes.MAX_GIT_CHECK_ENV_ENTRIES }, (_, i) => ({ id: String(i), name: `VAR_${i}`, value: "" })),
  ];
  for (const rows of cases) {
    const edited = helpers.editWorkflowCheckEnvironment(entry, [check], 0, rows);
    const html = render({ data, scope: "project", overrides: edited.overrides, recipeEditors: edited.recipeEditors });
    assert.equal(html.match(/Environment name<input/g)?.length, rows.length);
    if (rows.length < recipes.MAX_GIT_CHECK_ENV_ENTRIES) {
      assert.match(html, /id="workflow-error"/);
      assert.match(html, /class="workflow-primary" disabled="">Save project defaults/);
      assert.match(html, /1 project change/);
    } else assert.match(html, /<button type="button" disabled="">Add environment row/);
  }
  for (const cwd of ["../outside", "packages/", "a".repeat(recipes.MAX_GIT_CHECK_CWD + 1)]) {
    const html = render({ data, scope: "project", overrides: { checks: [helpers.editWorkflowCheckOptional(check, "cwd", cwd)] } });
    assert.ok(html.includes(`value="${cwd}"`));
    assert.match(html, /id="workflow-error"/);
    assert.match(html, /class="workflow-primary" disabled="">Save project defaults/);
  }
  assert.match(home, /key=\{recipeEditors\[index\]\.id\}/);
  assert.match(home, /key=\{row\.id\}/);
  assert.doesNotMatch(home, /key=\{row\.name\}|key=\{check\.label\}/);
  assert.match(home, /overrides: workflowDraftOverrides\(entry!\)/);
  assert.match(home, /resolveWorkflowDraft\(data, scope, draft, entry\?\.recipeEditors\)/);
});

test("cleanup excerpt distinguishes retain blocking and independently authorized native requests from automation", () => {
  for (const scope of ["global", "project", "session"]) {
    const html = render({ scope, overrides: { cleanup: "worktree-and-branch" } });
    const excerpt = html.match(/<div id="workflow-stage-cleanup"[\s\S]*?<\/section>/)?.[0];
    assert.ok(excerpt);
    assert.match(excerpt, /Eligible feature resources/);
    assert.doesNotMatch(excerpt, />After integration</);
    assert.match(excerpt, /<option value="retain">Retain<\/option>/);
    assert.match(excerpt, /<option value="worktree-and-branch" selected="">Allow separate worktree \+ branch cleanup<\/option>/);
    assert.doesNotMatch(excerpt, /value="automatic"|Ask to clean up/);
    assert.match(excerpt, /named worktree or local branch may be independently requested for deletion/);
    assert.match(excerpt, /Cleanup confirmation is independent/);
    assert.match(excerpt, /fresh saved Allow or exact Ask approval, plus resource safety checks/);
    assert.match(excerpt, /Saving settings grants no cleanup permission and removes nothing/);
    assert.match(excerpt, /Never automatic or scheduled, including after integration/);
    assert.match(excerpt, /Selected public cleanup is supported on eligible Linux paths/);
    assert.match(excerpt, /native managed-creation, integration and current session\/terminal-usage proofs/);
    assert.match(excerpt, /Unknown usage or native evidence fails closed/);
    assert.match(excerpt, /Existing or attached resources are not made eligible/);
    assert.match(excerpt, /Retain blocks managed cleanup/);
    assert.match(html, /Allow separate worktree \+ branch cleanup · separate authorized requests/);
    assert.match(html, /No confirmation changes/);
    assert.match(html, /No confirmation-free permission is granted/);
  }
  const none = render({ overrides: { cleanup: "worktree-and-branch", cleanupConfirmation: "none" } });
  assert.match(none, /No confirmation preference · explicit request, saved Allow and live gates required/);
  const retained = render({ overrides: { cleanup: "retain", cleanupConfirmation: "ask" } });
  assert.match(retained, /<option value="retain" selected="">Retain<\/option>/);
  assert.match(retained, /Retain · cleanup blocked/);
  assert.match(render(), /<option value="inherit" selected="">Use inherited value · Retain<\/option>/);
  const legacy = render({ data: fixture({ project: { cleanup: "worktree-and-branch" }, task: { kind: "legacy",
    policy: { mode: "current", onCreate: "stay", commits: "manual" } } }) });
  assert.match(legacy, /Eligible feature resources<\/dt><dd>Task: Retain/);
});

test("selected public support remains bounded by independent requests, native evidence and fail-closed platform/usage limits", () => {
  const data = fixture({ sessionScope: "project", selection: { projectRoot: "/repo", cwd: "/repo-worktrees/feature", branch: "feature" } });
  for (const field of ["workspaceConfirmation", "prepareConfirmation", "checkConfirmation", "integrateConfirmation", "cleanupConfirmation"]) {
    const html = render({ data, scope: "project", overrides: { [field]: "none", method: "ff" } });
    assert.match(html, new RegExp(`id="workflow-${field}"[^>]*><option[\\s\\S]*?<option value="none" selected="">No confirmation preference · explicit request, saved Allow and live gates required`));
    assert.match(html, /Selected public workspace creation\/attach, saved checks, feature preparation, local integration and eligible cleanup are supported through bounded Linux paths/);
    assert.match(html, /Each operation requires an explicit request and independent authorization/);
    assert.match(html, /Ask is the default, even with saved Allow/);
    assert.match(html, /that action&#x27;s separately saved none preference, fresh saved Allow and live caller\/resource\/recovery guards/);
    assert.match(html, /required native evidence, subject to stricter instructions/);
    assert.match(html, /Unknown session\/terminal usage or native evidence fails closed/);
    assert.match(html, /Unsupported platforms, branches and native states fail closed/);
    assert.match(html, /No Automatic mode, scheduling or chained approvals are enabled/);
    assert.match(html, /Selected feature preparation uses the saved Project main branch, not the integration target/);
    assert.match(html, /authorizing one never authorizes the others/);
    assert.match(html, /eligible whole-file or explicitly staged commits/);
    assert.doesNotMatch(html, /runtime verification is pending|other selected mutations are unavailable|dispatch unavailable|execution not yet available|Fast-forward \(unsupported\)|installed|activated/);
    assert.match(html, /No confirmation-free permission is granted/);
  }
});

test("FF method is a preference, squash/automatic stay disabled, and invalid drafts do not crash rendering", () => {
  const html = render({ overrides: { method: "ff", checks: [{ label: "", argv: [""] }] } });
  assert.match(html, /value="ff" selected=""/);
  assert.match(html, /value="squash" disabled=""/);
  assert.match(html, /value="automatic" disabled=""/);
  assert.match(html, /scoped authorization and operation-level recovery admission/);
  assert.doesNotMatch(html, /Requires durable action/);
  assert.match(html, /id="workflow-error"/);
  assert.match(html, /class="workflow-primary" disabled="">Save session settings/);
});

test("current-task blockers use saved server facts rather than the selected scope's unsaved draft", () => {
  const data = fixture({ task: { kind: "managed", settings: { ...settings.DEFAULT_GIT_WORKFLOW_SETTINGS, commits: "manual" } } });
  data.permissions = permissions.managedGitPermissions(data, { subagent: false, tools: ["read", "edit"] });
  const html = render({ data, scope: "global", overrides: { commits: "ask" } });
  assert.match(html, /aria-label="Current task permissions"/);
  assert.match(html, /Agent: Blocked/);
  assert.match(html, /Commits are manual for this task/);
  assert.match(html, /You: Approval required/);
  assert.match(html, /not editor drafts/);
  assert.match(html, /do not approve an action or inspect Git state/);
  assert.doesNotMatch(html, /requires durable action support/i);
  data.task = { kind: "legacy", policy: { mode: "worktree", baseBranch: "base", onCreate: "stay", commits: "agent" } };
  data.permissions = permissions.managedGitPermissions(data, { subagent: false, tools: ["edit"] });
  const legacy = render({ data });
  assert.match(legacy, /Agent: Saved policy/);
  assert.match(legacy, /without a new per-start approval/);
  assert.match(legacy, /Legacy preview\/confirm retains/);
});

test("a waiting chat explains idle-only Save/Apply and the create-only missing-base proposal", () => {
  const data = fixture({ task: { kind: "managed", settings: { ...settings.DEFAULT_GIT_WORKFLOW_SETTINGS,
    workspace: "worktree", baseBranch: null, onCreate: "continue" } }, sessionEditable: false,
    sessionReason: "Stop the chat before changing its session settings." });
  const html = render({ data, props: { busy: true, attention: true } });
  assert.match(html, /Session Save and Apply are unavailable/);
  assert.match(html, /Stop the chat, save and apply the base, then resume/);
  assert.match(html, /one new worktree only/);
  assert.match(html, /does not save settings or move this chat/);
  assert.match(html, /disabled=""[^>]*>Apply saved settings to this task/);
  assert.doesNotMatch(render({ data, props: { busy: false } }), /one new worktree only/);
});

test("stable visibility, scope-specific conflicts, focus containment/restoration and responsive token styling", () => {
  assert.match(home, /response\.status === 409/);
  assert.match(home, /Reload saved &amp; discard this draft/);
  assert.match(home, /receiveWorkflowSettings\(current, body/);
  assert.match(home, /workflowRequestTarget\(snapshot\?\.sessionBound \? sessionId : undefined/);
  assert.match(home, /returnFocusRef\.current\.focus\(\{ preventScroll: true \}\)/);
  assert.match(home, /event\.key !== "Tab"/);
  assert.match(home, /document\.addEventListener\("focusin", containFocus\)/);
  assert.match(home, /aria-modal=\{covering \|\| undefined\}/);
  assert.match(css, /--workflow-width, 500px/);
  assert.match(css, /data-covering=true.*position: fixed/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /color: var\(--accent-contrast\)/);
});

test("policy editor labels origins, delivery restrictions and scope-specific confirmation drafts without task adoption", () => {
  const data = fixture({ sessionScope: "project", projectRoot: "/other", project: { mainBranch: "trunk", delivery: "pr", targetBranch: "project-main", checks: [] } });
  const project = render({ data, scope: "project", overrides: { ...data.project, delivery: "leave", commitConfirmation: "none" } });
  assert.match(project, /Project main branch/);
  assert.match(project, /Use project main/);
  assert.match(project, /PR and leave prohibit local integration/);
  assert.match(project, /Local merge disabled/);
  assert.match(project, /Commit confirmation: No confirmation preference \(not authorized\)/);
  assert.match(project, /No confirmation-free permission is granted/);
  assert.match(project, /No Git operation starts/);
  assert.doesNotMatch(project, /data-task-binding/);
  const chat = render({ data, scope: "session", overrides: { delivery: "leave", commitConfirmation: "none" } });
  assert.match(chat, /A task × \/other/);
  assert.match(chat, /Define branch in Project/);
  assert.match(chat, /Local merge disabled/);
  assert.match(chat, /value="none" selected=""/);
  const global = render({ data, scope: "global" });
  assert.match(global, /Define branch in Project/);
  assert.match(global, /Recipes belong to Project, not Global or Chat/);
  assert.match(global, /id="workflow-managedGitToolsOnly"[^>]*aria-checked="true"/);
  const relaxed = render({ data, scope: "session", overrides: { managedGitToolsOnly: false } });
  assert.match(relaxed, /id="workflow-managedGitToolsOnly"[^>]*aria-checked="false"/);
  assert.match(relaxed, /neither blocks shell commands/);
});

test("a saved chat can select another configuration project without task or source adoption", () => {
  const html = render({ data: fixture({ sessionScope: "project", projectRoot: "/other", legacySessionSettings: true }) });
  assert.match(html, /Configuration project/);
  assert.match(html, /This project only/);
  assert.match(html, /This chat × selected project/);
  assert.match(html, /not copied to this project/);
  assert.match(html, /Actions still use the chat checkout/);
  assert.match(html, /Action source: <code>\/repo-worktrees\/chat/);
  assert.doesNotMatch(html, /Apply saved settings to this task|data-task-binding/);
  assert.match(html, /<details class="workflow-legacy"><summary>Existing chat actions/);
  assert.match(home, /sourceEvidenceOpen/);
  assert.match(home, /Source evidence · optional legacy metadata/);
  assert.doesNotMatch(home, /!session && <form className="workflow-project-picker"/);
});
