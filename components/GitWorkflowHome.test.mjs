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
  const context = JSON.stringify([actualProps.session?.id ?? null, actualProps.session?.cwd ?? actualProps.cwd ?? null, Boolean(actualProps.session?.transient)]);
  let drafts = helpers.receiveWorkflowSettings({}, data, actualProps.session?.id);
  if (overrides) {
    const key = helpers.workflowDraftKey(scope, data.projectRoot, actualProps.session?.id);
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

test("unsupported modes are disabled, saved unsupported integration remains visible, and invalid drafts do not crash rendering", () => {
  const html = render({ overrides: { method: "ff", checks: [{ label: "", argv: [""] }] } });
  assert.match(html, /value="ff" disabled="" selected=""/);
  assert.match(html, /value="automatic" disabled=""/);
  assert.match(html, /scoped grants, reviewed instruction profiles and task-bound workspace admission/);
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
