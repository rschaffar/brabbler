import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Module, { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("./GitProjectAuthorizations.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function render({ scope = "global", decisions = {}, drafts = {}, projectRoot = "/repo", sessionId = "saved-chat" } = {}) {
  let index = 0;
  const actions = Object.fromEntries(["workspace", "commit", "checks", "prepare", "integration", "cleanup"].map((action) => [action,
    { global: "inherit", project: "inherit", session: "inherit", effective: "none", source: "none", ...decisions[action] }]));
  const key = JSON.stringify([scope, scope === "global" ? null : projectRoot, scope === "session" ? sessionId : null]);
  const snapshot = { key, settingsRevision: "settings-revision", value: { actions } };
  const component = new Module(new URL("./GitProjectAuthorizations.tsx", import.meta.url).pathname);
  component.filename = new URL("./GitProjectAuthorizations.tsx", import.meta.url).pathname;
  const realRequire = createRequire(import.meta.url);
  component.require = (id) => id === "react" ? { ...React, useState: (initial) => {
    const seeded = index === 0 ? snapshot : index === 1 ? { [key]: drafts } : initial;
    index++; return [seeded, () => {}];
  } } : realRequire(id);
  component._compile(compiled, component.filename);
  return renderToStaticMarkup(React.createElement(component.exports.GitProjectAuthorizations, { visible: true, scope, projectRoot, sessionId, settingsRevision: "settings-revision" }));
}

test("all six independent saved-action selectors describe bounded public source support, not unconditional execution or deployment", () => {
  for (const scope of ["global", "project", "session"]) {
    const html = render({ scope });
    for (const action of ["workspace", "commit", "checks", "prepare", "integration", "cleanup"]) {
      assert.ok(html.includes(`id="workflow-auth-${action}"`));
    }
    assert.equal((html.match(/<select /g) ?? []).length, 6);
    assert.match(html, /Feature preparation onto project main/);
    assert.match(html, /Feature resource cleanup/);
    assert.match(html, /Each action has an independent decision and confirmation preference/);
    assert.match(html, /saving a decision starts no operation/);
    assert.match(html, /Selected public workspace\/check\/preparation\/integration\/cleanup paths are supported on eligible Linux hosts/);
    assert.match(html, /a saved decision is not proof that a particular request is executable/);
    assert.match(html, /supported Linux path/);
    assert.match(html, /saved Allow, its separately saved confirmation:none, an explicit request/);
    assert.match(html, /Ask remains the default even with Allow/);
    assert.match(html, /stricter instructions/);
    assert.match(html, /Preparation uses the saved Project main branch/);
    assert.match(html, /cleanup Retain blocks deletion and resource eligibility is not a grant/);
    assert.match(html, /No Automatic mode, scheduling, chained approvals or remote permission/);
    assert.match(html, /required native evidence and compliance with stricter instructions/);
    assert.match(html, /Unknown session\/terminal usage or native evidence fails closed/);
    assert.match(html, /Unsupported platforms, branches or native states fail closed/);
    assert.match(html, /Fresh eligible agent commits/);
    assert.match(html, /fresh persisted ordinary-chat provenance/);
    assert.match(html, /Manual human commit routes remain exact Ask/);
    assert.doesNotMatch(html, /runtime verification is pending|remain unexposed|foundation only|Only selected-project.*can consume|Allow without repeated confirmation|installed|activated/);
  }
});

test("prepare and cleanup use their own human Save and stale removal, never a preferences write or blanket grant", () => {
  const html = render({ scope: "project", drafts: { prepare: "allow", cleanup: "deny" } });
  assert.match(html, /Save Feature preparation onto project main allow for project/);
  assert.match(html, /Save Feature resource cleanup deny for project/);
  assert.doesNotMatch(html, /Save Selected commits/);
  assert.match(html, /Allow eligible explicit action · confirmation remains separate/);
  assert.match(render({ scope: "session", decisions: { cleanup: { session: "stale" } } }), /Remove stale Feature resource cleanup decision/);
  assert.match(source, /body: JSON.stringify\(\{ \.\.\.identity, action, decision, revision: current.revision, policyRevision: current.policyRevision \}\)/);
  assert.doesNotMatch(source, /\/api\/git\/workflow\/settings|scope: "task"|scope: "pause"/);
  assert.match(render({ scope: "session", projectRoot: null }), /Select a canonical project and a saved ordinary chat first/);
});
