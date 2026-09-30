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
const oid = (n) => n.toString(16).padStart(40, "0");
const preview = () => ({ eligible: true, actionId: "quarantined-action", revision: "exact-revision", unit: "pi-web-git-check-unit.service",
  feature: { path: "/repo/worktrees/feature", branch: "feature/x", head: oid(1), status: [" M tracked.txt", "?? new.txt"] },
  target: { path: "/repo", branch: "main", head: oid(2), status: ["No tracked changes"] },
  containment: { emptyEvidence: "pinned-populated-zero", payload: "release-attempted" }, expiresAt: Date.now() + 60_000 });

function harness(onRecovered = () => {}, onRecoveringChange = () => {}) {
  const states = [], refs = [];
  let stateIndex = 0, refIndex = 0;
  const mod = new Module(filename);
  mod.filename = filename;
  const realRequire = createRequire(import.meta.url);
  mod.require = (id) => id === "react" ? {
    ...React,
    useState(initial) {
      const i = stateIndex++;
      if (!(i in states)) states[i] = typeof initial === "function" ? initial() : initial;
      return [states[i], (next) => { states[i] = typeof next === "function" ? next(states[i]) : next; }];
    },
    useRef(initial) { const i = refIndex++; return refs[i] ??= { current: initial }; },
    useEffect() {},
  } : realRequire(id);
  mod._compile(compiled, filename);
  function tree() { stateIndex = 0; refIndex = 0; return mod.exports.GitCheckRecoveryPanel({ sessionId: "chat-id", onRecovered, onRecoveringChange }); }
  function html() { return renderToStaticMarkup(tree()); }
  function button(label) {
    const walk = (node) => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) return node.map(walk).find(Boolean) ?? null;
      if (typeof node.type === "function") return walk(node.type(node.props));
      if (node.type === "button" && String(node.props.children).includes(label)) return node;
      return walk(node.props?.children);
    };
    const match = walk(tree());
    assert.ok(match, `missing button ${label}`);
    return match;
  }
  return { html, button, valid: mod.exports.isCheckRecoveryPreview };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

// Fetch and window are set per test; no DOM or live server is needed.
test("recovery is opt-in and refuses incomplete identity snapshots", () => {
  const ui = harness();
  assert.match(ui.html(), /Load recovery review/);
  assert.doesNotMatch(ui.html(), /Approve recovery|type="checkbox"/);
  assert.equal(ui.valid(preview()), true);
  for (const invalid of [{ ...preview(), revision: "" }, { ...preview(), target: { ...preview().target, status: "clean" } },
    { ...preview(), expiresAt: NaN }, { eligible: false, reason: "No safe candidate" }]) assert.equal(ui.valid(invalid), false);
});

test("exact resource identities, status, unit and evidence precede single approval; success refreshes without receipts", async (t) => {
  const calls = [], events = [], busy = [];
  let refreshes = 0;
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  globalThis.window = { dispatchEvent: (event) => events.push(event) };
  globalThis.fetch = async (url, options) => {
    calls.push([url, options]);
    return Response.json(url.includes("?") ? preview() : { recovered: true });
  };
  const ui = harness(() => refreshes++, (value) => busy.push(value));
  ui.button("Load recovery review").props.onClick();
  await settle();
  const review = ui.html();
  for (const text of ["/repo/worktrees/feature", "/repo", "feature/x", "main", oid(1), oid(2), " M tracked.txt", "?? new.txt",
    "pi-web-git-check-unit.service", "pinned-populated-zero", "release-attempted", "ignored files", "non-Git", "quarantined-action", "exact-revision"])
    assert.ok(review.includes(text), `missing ${text}`);
  assert.equal((review.match(/>Approve recovery</g) ?? []).length, 1);
  ui.button("Approve recovery").props.onClick();
  await settle();
  assert.deepEqual(JSON.parse(calls[1][1].body), { sessionId: "chat-id", actionId: "quarantined-action", revision: "exact-revision", acknowledged: true });
  assert.deepEqual(busy, [true, false]);
  assert.equal(refreshes, 1);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "pi-web:git-actions-changed");
  assert.deepEqual(events[0].detail, { sessionId: "chat-id" });
  assert.match(ui.html(), /no verification check has been rerun or receipt created/);
  assert.doesNotMatch(ui.html(), /Approve recovery|Passed: receipt/);
});

test("ineligible and expired previews never approve; a 409 clears stale authority without retrying", async (t) => {
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window;
  t.after(() => { globalThis.fetch = oldFetch; globalThis.window = oldWindow; });
  let mode = "ineligible", posts = 0, refreshes = 0;
  globalThis.window = { dispatchEvent() { throw new Error("no event expected"); } };
  globalThis.fetch = async (url) => {
    if (!url.includes("?")) { posts++; return Response.json({ error: "Recovery identities changed" }, { status: 409 }); }
    return Response.json(mode === "ineligible" ? { eligible: false, reason: "Cannot prove empty containment" }
      : mode === "expired" ? { ...preview(), expiresAt: Date.now() - 1 } : preview());
  };
  const ui = harness(() => refreshes++);
  ui.button("Load recovery review").props.onClick(); await settle();
  assert.match(ui.html(), /Cannot prove empty containment.*Investigate/);
  assert.doesNotMatch(ui.html(), /Approve recovery/);
  mode = "expired";
  ui.button("Load recovery review").props.onClick(); await settle();
  assert.match(ui.html(), /Recovery preview expired/);
  assert.match(ui.html(), /disabled=""[^>]*>Approve recovery/);
  ui.button("Approve recovery").props.onClick(); await settle();
  assert.equal(posts, 0);
  mode = "ready";
  ui.button("Load recovery review").props.onClick(); await settle();
  ui.button("Approve recovery").props.onClick(); await settle();
  assert.equal(posts, 1);
  assert.equal(refreshes, 0);
  assert.doesNotMatch(ui.html(), /Approve recovery/);
  assert.match(ui.html(), /Recovery identities changed.*Inspect both worktrees and refs.*Do not retry the check or merge automatically/);
});
