import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import * as panelFocus from "../lib/panel-focus.ts";

const source = await readFile(new URL("./GitExplorerPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const messages = { "gitExplorer.expand": "Expand Git Explorer", "gitExplorer.restore": "Restore Git Explorer", "gitExplorer.close": "Close Git Explorer" };
function fixture(overrides = {}) {
  const component = new Module(new URL("./GitExplorerPanel.tsx", import.meta.url).pathname);
  component.filename = new URL("./GitExplorerPanel.tsx", import.meta.url).pathname;
  const realRequire = createRequire(import.meta.url);
  component.require = (id) => {
    if (id === "react") return { ...React, useState: (initial) => [initial, () => {}], useRef: (initial) => ({ current: initial }), useEffect() {} };
    if (id === "@/lib/panel-focus") return panelFocus;
    if (id === "@/hooks/useI18n") return { useI18n: () => ({ t: (key) => messages[key] }) };
    if (id === "./GitExplorer") return { GitExplorer: () => React.createElement("div", { "aria-label": "Commit graph" }) };
    if (id === "./GitCommitViewer") return { GitCommitViewer: () => null };
    return realRequire(id);
  };
  component._compile(compiled, component.filename);
  let toggles = 0;
  const tree = component.exports.GitExplorerPanel({ cwd: "/repo", onClose() {}, expanded: false, canExpand: true, onToggleExpanded() { toggles++; }, ...overrides });
  return { tree, html: renderToStaticMarkup(tree), toggles: () => toggles };
}

test("whole-Explorer expansion has labeled independent restore and close controls", async () => {
  const normal = fixture();
  assert.match(normal.html, /aria-controls="git-explorer-panel" aria-pressed="false" aria-label="Expand Git Explorer"/);
  const expanded = fixture({ expanded: true });
  assert.match(expanded.html, /aria-pressed="true" aria-label="Restore Git Explorer"/);
  assert.match(expanded.html, /aria-label="Close Git Explorer"/);
  assert.match(expanded.html, /aria-label="Commit graph"/);
  const catalog = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
  for (const [key, value] of Object.entries(messages)) assert.ok(catalog.includes(`"${key}": "${value}"`));
});

test("mobile omits expansion; a no-checkout Explorer can still expand and close", () => {
  assert.doesNotMatch(fixture({ canExpand: false }).html, /aria-label="Expand Git Explorer"/);
  const { html } = fixture({ cwd: null, expanded: true });
  assert.match(html, /Restore Git Explorer/);
  assert.match(html, /Select a worktree to browse its local branches/);
});

function keyEvent(key, overrides = {}) {
  const calls = [];
  return { key, calls, defaultPrevented: false, target: { closest: () => null }, preventDefault() { calls.push("prevent"); }, stopPropagation() { calls.push("stop"); }, ...overrides };
}

test("fullscreen Escape restores once and cannot reach the agent-stop listener", () => {
  const { tree, toggles } = fixture({ expanded: true });
  const event = keyEvent("Escape");
  tree.props.onKeyDown(event);
  assert.deepEqual(event.calls, ["prevent", "stop"]);
  assert.equal(toggles(), 1);
  const normal = fixture();
  const untouched = keyEvent("Escape");
  normal.tree.props.onKeyDown(untouched);
  assert.deepEqual(untouched.calls, []);
  assert.equal(normal.toggles(), 0);
});

test("nested native dialogs and already-consumed Escape retain first refusal", () => {
  const { tree, toggles } = fixture({ expanded: true });
  for (const overrides of [{ defaultPrevented: true }, { target: { closest: () => ({ open: true }) } }]) {
    const event = keyEvent("Escape", overrides);
    tree.props.onKeyDown(event);
    assert.deepEqual(event.calls, []);
  }
  assert.equal(toggles(), 0);
});

test("Tab wraps only across visible non-inert Explorer controls", () => {
  const { tree } = fixture({ expanded: true });
  const focused = [];
  const control = (name, visible = true, inert = false) => ({
    children: [], tabIndex: 0, matches: () => false, ownerDocument: {},
    getClientRects: () => visible ? [{}] : [], closest: () => inert ? {} : null, focus: () => focused.push(name),
  });
  const first = control("first"), last = control("last"), hidden = control("hidden", false), inert = control("inert", true, true);
  const panel = { children: [first, hidden, last, inert] };
  const previousDocument = globalThis.document;
  try {
    globalThis.document = { activeElement: last };
    const forward = keyEvent("Tab", { currentTarget: panel });
    tree.props.onKeyDown(forward);
    assert.deepEqual(forward.calls, ["prevent"]);
    assert.deepEqual(focused, ["first"]);
    globalThis.document.activeElement = first;
    tree.props.onKeyDown(keyEvent("Tab", { currentTarget: panel, shiftKey: true }));
    assert.deepEqual(focused, ["first", "last"]);
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
