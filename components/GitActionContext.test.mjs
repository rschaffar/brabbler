import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import Module, { createRequire } from "node:module";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const filename = new URL("./GitActionContext.tsx", import.meta.url).pathname;
const source = await readFile(filename, "utf8");
let context;
const require = createRequire(import.meta.url);
const mod = new Module(filename);
mod.filename = filename;
mod.require = (id) => id === "react" ? { ...React, useContext: () => context } : require(id);
mod._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { GitActionLiveFallback, matchingLiveGitRequest } = mod.exports;
const request = { method: "git_action", id: "live", candidate: { kind: "commit", actionId: "a" } };
const render = () => renderToStaticMarkup(React.createElement(GitActionLiveFallback, null, React.createElement("p", null, "question fallback")));

test("live fallback is suppressed only for an actually mounted matching anchor", () => {
  context = { liveRequest: request, mountedActions: new Map() };
  assert.match(render(), /question fallback/);
  context.mountedActions = new Map([["different", 1]]);
  assert.match(render(), /question fallback/);
  context.mountedActions = new Map([["a", 1]]);
  assert.equal(render(), "");
  context.mountedActions = new Map(); // windowed/unmounted card
  assert.match(render(), /question fallback/);
  assert.equal(matchingLiveGitRequest(request, "a"), request);
  assert.equal(matchingLiveGitRequest(request, "different"), null);
});

test("legacy preferences and unrelated dialogs always retain their existing fallback", () => {
  for (const liveRequest of [null, { ...request, candidate: { kind: "commit" } }, { ...request, candidate: { kind: "preferences", actionId: "a" } }]) {
    context = { liveRequest, mountedActions: new Map([["a", 1]]) };
    assert.match(render(), /question fallback/);
  }
});

test("ChatWindow keeps cards outside process folding, uses mounted registration and preserves Workflow redirect", async () => {
  const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
  assert.match(chat, /isOrdinaryMessageGroupAnchor\(message\) \|\| gitActionId\(message\) !== null/);
  assert.match(chat, /visibleMessages = messages.filter\(\(m\) => isOrdinaryMessageGroupAnchor\(m\) \|\| m.role === "assistant"\)/);
  assert.match(chat, /if \(isOrdinaryMessageGroupAnchor\(msg\) \|\| msg.role === "assistant"\) \{\s*visibleRefIndexByMessage.set/);
  assert.match(chat, /data-entry-id=\{entryIds\[idx\]\} ref=\{options.attachRef === false \|\| currentRefIdx === undefined/);
  assert.match(chat, /<GitActionProvider[\s\S]*liveRequest=\{extensionDialog\?\.method === "git_action" \? extensionDialog : null\}/);
  assert.match(chat, /<GitActionLiveFallback>[\s\S]*<AskUserDialog[\s\S]*Dismiss request &amp; open Workflow[\s\S]*<ExtensionDialog[\s\S]*<\/GitActionLiveFallback>/);
  assert.match(source, /return \(\) => setMountedActions/);
  assert.match(source, /next.delete\(actionId\)/);
});
