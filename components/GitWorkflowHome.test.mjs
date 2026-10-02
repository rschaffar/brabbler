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
const policy = await jiti.import("../lib/git-workflow-policy.ts");
const permissions = await jiti.import("../lib/git-workflow-permissions.ts");
const helpers = await jiti.import("./git-workflow-drafts.ts");
const compiled = ts.transpileModule(home, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const session = { id: "saved-chat", cwd: "/repo-worktrees/chat", name: "A task" };
function fixture(options = {}) {
  const data = { revision: "r1", paused: false, cwd: session.cwd, projectRoot: "/repo", global: { commits: "manual" }, project: { commits: "ask", targetBranch: "local-target" }, session: {}, task: { kind: "none" }, sessionEditable: true, ...options };
  data.resolved = Object.fromEntries(["global", "project", "session"].map((scope) => [scope, settings.resolveGitWorkflowSettings(data.global, scope !== "global" ? data.project : undefined, scope === "session" ? data.session ?? {} : undefined)]));
  return data;
}
function render({ data = fixture(), scope = "session", overrides, props = {} } = {}) {
  const actualProps = { visible: true, session, cwd: "/sidebar", busy: false, attention: false, detail: null, onClose() {}, onDetailChange() {}, onDetailHost() {}, ...props };
  const context = JSON.stringify([actualProps.session?.id ?? null, actualProps.session?.cwd ?? actualProps.cwd ?? null, Boolean(actualProps.session?.transient), null]);
  let drafts = helpers.receiveWorkflowSettings({}, data, actualProps.session?.id);
  if (overrides) {
    const key = helpers.workflowDraftKey(scope, data.projectRoot, actualProps.session?.id, data.sessionScope);
    drafts = { ...drafts, [key]: { ...drafts[key], overrides } };
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
    if (id === "@/lib/git-workflow-policy") return policy;
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
  assert.match(ask, /selected-project request with a fresh saved Allow/);
  assert.match(ask, /FF is supported for eligible session-bound local integration/);
  assert.doesNotMatch(ask, /FF and squash cannot execute yet/);
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

test("extended recipes remain visible and retained without claiming runner support", () => {
  const check = { label: "Subproject", argv: ["npm", "test"], cwd: "packages/web", env: { CI: "1" }, requiredStage: "handoff" };
  const data = fixture({ project: { checks: [check] } });
  const edited = helpers.editWorkflowCheck(check, "label", "Renamed");
  const html = render({ data, scope: "project", overrides: { checks: [edited] } });
  assert.match(html, /Renamed/);
  assert.match(html, /packages\/web/);
  assert.match(html, /handoff/);
  assert.match(html, /&quot;CI&quot;:&quot;1&quot;/);
  assert.match(html, /Extended recipe execution is not supported yet/);
  assert.match(html, /fields are preserved when editing labels or arguments/);
  assert.deepEqual(data.project.checks, [check]);
  assert.doesNotMatch(render({ data: fixture({ project: { checks: [{ label: "Old", argv: ["npm", "test"] }] } }), scope: "project" }), /Extended recipe fields retained/);
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
