import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Module, { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = await readFile(new URL("./GitCheckRecoveryPanel.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const filename = new URL("./GitCheckRecoveryPanel.tsx", import.meta.url).pathname;
const mod = new Module(filename);
mod.filename = filename;
mod.require = createRequire(import.meta.url);
mod._compile(compiled, filename);
const { GitCheckRecoveryPanel } = mod.exports;

test("static nonblocking outcome note has no approval, rerun, merge or cleanup controls", () => {
  const html = renderToStaticMarkup(React.createElement(GitCheckRecoveryPanel));
  assert.match(html, /aria-label="Check outcome information"/);
  assert.match(html, /Failed or uncertain checks produce no passing receipt/);
  assert.match(html, /history does not block other invocations/);
  assert.match(html, /no recovery approval is needed/);
  assert.match(html, /recorded effects in action cards/);
  assert.match(html, /current checkout files and processes/);
  assert.match(html, /ignored files and effects outside the checkout/);
  assert.match(html, /does not prove that descendants stopped or that changes are safe/);
  assert.doesNotMatch(html, /<(?:button|input|form|a)\b|quarantine|Approve recovery|Load recovery|disabled=/i);
});

test("old or malformed metadata and callbacks cannot create authority, requests or effects", async (t) => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (...args) => { calls.push(args); throw new Error("No request expected"); };
  t.after(() => { globalThis.fetch = oldFetch; });
  const fail = () => { throw new Error("Retired callback invoked"); };
  const baseline = renderToStaticMarkup(React.createElement(GitCheckRecoveryPanel));
  for (const status of [null, { eligible: true, revision: "forged", expiresAt: Infinity },
    { eligible: false, reason: "PRIVATE HISTORY" }, { admitted: true, processStopped: true }]) {
    assert.equal(renderToStaticMarkup(React.createElement(GitCheckRecoveryPanel, {
      sessionId: "old-chat", status, disabled: true, onRecovered: fail, onRecoveringChange: fail,
    })), baseline);
  }
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
  assert.doesNotMatch(source, /fetch\(|POST|useEffect|useState|useRef|setTimeout|onClick|dispatchEvent/);
  assert.deepEqual(Object.keys(mod.exports), ["GitCheckRecoveryPanel"]);
});
