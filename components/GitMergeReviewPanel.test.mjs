import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Module, { createRequire } from "node:module";
import ts from "typescript";
import vm from "node:vm";

const panel = await readFile(new URL("./GitMergeReviewPanel.tsx", import.meta.url), "utf8");
// Compile only this client component to exercise its pure selection logic in Node.
const compiled = ts.transpileModule(panel, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentModule = new Module(new URL("./GitMergeReviewPanel.tsx", import.meta.url).pathname);
componentModule.filename = new URL("./GitMergeReviewPanel.tsx", import.meta.url).pathname;
componentModule.require = (id) => id === "./GitCheckRecoveryPanel"
  ? { GitCheckRecoveryPanel: () => React.createElement("section", { "aria-label": "Check outcome information" }) }
  : createRequire(import.meta.url)(id);
componentModule._compile(compiled, componentModule.filename);
const { GitMergeReviewPanel, reviewSelection, matchingReceipts, proposalMatches } = componentModule.exports;
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");
const oid = (n) => n.toString(16).padStart(40, "0");
const review = { commits: Array.from({ length: 4 }, (_, i) => ({ oid: oid(i + 3), parentOid: oid(i + 2), treeOid: oid(i + 13) })) };

test("only whole merge or ordered inclusive, cumulative consecutive commits can be submitted", () => {
  assert.deepEqual(reviewSelection(review, { kind: "merge" }), { kind: "merge" });
  assert.deepEqual(reviewSelection(review, { kind: "commits", start: 1, end: 1 }), { kind: "commits", commitOids: [oid(4)] });
  assert.deepEqual(reviewSelection(review, { kind: "commits", start: 1, end: 3 }), { kind: "commits", commitOids: [oid(4), oid(5), oid(6)] });
  for (const [start, end] of [[-1, 1], [3, 2], [0, 4], [0.1, 2]]) {
    assert.equal(reviewSelection(review, { kind: "commits", start, end }), null);
  }
  assert.equal(reviewSelection({ commits: [] }, { kind: "commits", start: 0, end: 0 }), null);
});

test("persisted ordinary session only at its session cwd; no checkout or target supplied", () => {
  assert.match(chat, /session && !session\.transient && session\.relation\?\.kind !== "subagent" && createPortal/);
  assert.match(chat, /hidden=\{gitControlsPanel !== "merge"\}.*visitedGitDetails\.includes\("merge"\)/);
  assert.match(chat, /<GitMergeReviewPanel key=\{`merge:\$\{session\.id\}:\$\{session\.cwd\}`\} sessionId=\{session\.id\} cwd=\{session\.cwd\}/);
  assert.match(panel, /URLSearchParams\(\{ sessionId \}\)/);
  assert.match(panel, /JSON\.stringify\(\{ sessionId, expectedFeatureOid: review\.featureOid, expectedTargetOid: review\.targetOid, selection \}\)/);
  assert.doesNotMatch(panel, /JSON\.stringify\(\{[^}]*\b(?:cwd|targetBranch|featureBranch|checkout)\b/);
  const html = renderToStaticMarkup(React.createElement(GitMergeReviewPanel, { sessionId: "s", cwd: "/repo" }));
  assert.match(html, /Local integration review/);
  assert.doesNotMatch(html, /approve|Confirm exact plan|Merge now/i);
});

test("read-only diff displays exact tree identities and binary summaries, discards stale responses, bounds patches", () => {
  assert.match(panel, /Expected feature commit OID/);
  assert.match(panel, /Expected target commit OID/);
  assert.match(panel, /Whole merge result tree OID/);
  assert.match(panel, /Expected comparison trees/);
  assert.match(panel, /Actual comparison trees/);
  assert.match(panel, /bodyOrError<\{ diff: GitReviewDiff \}>\(response, sessionId\)/);
  assert.match(panel, /body\.diff\.fromTreeOid !== trees\.from \|\| body\.diff\.toTreeOid !== trees\.to/);
  assert.match(panel, /aria-pressed=\{choice\.kind === "commits" && index >= choice\.start && index <= choice\.end\}/);
  assert.match(panel, /event\.shiftKey && anchor !== null/);
  assert.match(panel, /Start.*End/s);
  assert.match(panel, /commitOids: review\.commits\.slice\(start, end \+ 1\)/);
  assert.match(panel, /failure\.status === 409[\s\S]*?setReview\(null\)/);
  assert.match(panel, /failure\.status === 413 \? oversizedPatchMessage/);
  assert.match(panel, /TextEncoder\(\)\.encode\(body\.diff\.patch\)\.byteLength > MAX_PATCH_BYTES/);
  assert.match(panel, /request\.current\?\.abort\(\)/);
  assert.match(panel, /Binary changes are summarized in the patch/);
  assert.match(panel, /<pre[^>]*>\{diff\.patch\}<\/pre>/);
  assert.doesNotMatch(panel, /dangerouslySetInnerHTML|Confirm merge|onClick=.*approve/i);
});

test("exact proposal and outcome distinguish FF from a newly created merge commit", () => {
  assert.match(panel, /Fast-forward to existing feature commit \(no new merge commit\)/);
  assert.match(panel, /Exact resulting target OID/);
  assert.match(panel, /fast-forwarded to existing feature tip/);
  assert.match(panel, /intended fast-forward \(ref update unproven\)/);
  assert.match(panel, /Exact merge commit OID/);
});

test("server-matched receipts require every saved check in order, current snapshot and unexpired metadata", () => {
  const snapshot = { ...review, featureBranch: "feature", targetBranch: "main", featureOid: oid(9), targetOid: oid(2), featureTreeOid: oid(20), targetTreeOid: oid(21), mergeTreeOid: oid(20) };
  const now = Date.now();
  const receipts = [0, 1].map((checkIndex) => ({ id: `receipt-${checkIndex}`, checkIndex, startedAt: now - 100, finishedAt: now, logDigest: "digest", batch: { id: "batch", checkIndexes: [0, 1] } }));
  const status = { review: snapshot, checks: [{ checkIndex: 0, label: "Lint" }, { checkIndex: 1, label: "Tests" }], receipts };
  assert.deepEqual(matchingReceipts(status, snapshot), receipts);
  assert.equal(matchingReceipts({ ...status, receipts: receipts.slice(0, 1) }, snapshot), null);
  assert.equal(matchingReceipts({ ...status, checks: [] }, snapshot), null);
  assert.equal(matchingReceipts({ ...status, receipts: receipts.map((r) => ({ ...r, finishedAt: now - 16 * 60_000 })) }, snapshot), null);
  assert.equal(matchingReceipts(status, { ...snapshot, featureOid: oid(99) }), null);
  assert.equal(matchingReceipts({ ...status, checks: [{ checkIndex: 1, label: "Wrong order" }, status.checks[1]] }, snapshot), null);
  const plan = { planId: "plan-1", sessionId: "s", expiresAt: now + 60_000, review: snapshot,
    receiptIds: receipts.map((r) => r.id), diff: { fromTreeOid: snapshot.targetTreeOid, toTreeOid: snapshot.featureTreeOid, patch: "diff", hasBinaryChanges: false },
    mergeOid: oid(30), message: "Merge" };
  assert.equal(proposalMatches(plan, snapshot, "s", receipts), true);
  assert.equal(proposalMatches({ ...plan, receiptIds: [...plan.receiptIds].reverse() }, snapshot, "s", receipts), false);
  assert.equal(proposalMatches({ ...plan, diff: { ...plan.diff, toTreeOid: oid(42) } }, snapshot, "s", receipts), false);
  assert.equal(proposalMatches({ ...plan, expiresAt: now - 1 }, snapshot, "s", receipts), false);
  assert.equal(proposalMatches({ ...plan, diff: { ...plan.diff, patch: "x".repeat(1024 * 1024 + 1) } }, snapshot, "s", receipts), false);
});

test("renderer shows the prepared authoritative proposal with one exact confirmation and no acknowledgement gate", () => {
  const snapshot = { ...review, featureBranch: "feature", targetBranch: "main", featureOid: oid(9), targetOid: oid(2), featureTreeOid: oid(20), targetTreeOid: oid(21), mergeTreeOid: oid(20) };
  const receipt = { id: "receipt-1", checkIndex: 0, startedAt: Date.now() - 10, finishedAt: Date.now(), logDigest: "digest", batch: { id: "batch", checkIndexes: [0] } };
  const status = { review: snapshot, checks: [{ checkIndex: 0, label: "Tests" }], receipts: [receipt] };
  const plan = { planId: "exact-plan", sessionId: "s", expiresAt: Date.now() + 60_000, review: snapshot, receiptIds: [receipt.id],
    diff: { fromTreeOid: snapshot.targetTreeOid, toTreeOid: snapshot.featureTreeOid, patch: "candidate patch", hasBinaryChanges: true }, mergeOid: oid(30), message: "Merge branch" };
  const base = [0, snapshot, { kind: "merge" }, null, null, null, false, false, status, null, null, null, null, false];
  function render(states) {
    let index = 0;
    const mod = new Module(componentModule.filename);
    mod.filename = componentModule.filename;
    const realRequire = createRequire(import.meta.url);
    mod.require = (id) => id === "react" ? { ...React, useState: () => [states[index++], () => {}], useRef: () => ({ current: null }), useEffect: () => {} }
      : id === "./GitCheckRecoveryPanel" ? { GitCheckRecoveryPanel: () => React.createElement("section", { "aria-label": "Check outcome information" }) }
        : realRequire(id);
    mod._compile(compiled, mod.filename);
    return renderToStaticMarkup(React.createElement(mod.exports.GitMergeReviewPanel, { sessionId: "s", cwd: "/repo" }));
  }
  const unavailable = render(base.map((value, index) => index === 8 ? null : index === 9 ? "Saved merge target and checks required" : value));
  assert.match(unavailable, /Saved merge target and checks required/);
  assert.match(unavailable, /Check outcome information/, "nonblocking information remains visible without integration status");
  assert.doesNotMatch(unavailable, /Run required checks|Prepare exact integration proposal|Confirm exact plan/);
  const before = render(base);
  assert.match(before, /Tests/);
  assert.match(before, /Prepare exact integration proposal/);
  assert.doesNotMatch(before, /Confirm exact plan|candidate patch/);
  const ready = base.map((value, index) => index === 10 ? { plan, actionId: "action" } : value);
  const pending = render(ready);
  assert.match(pending, /exact-plan/);
  assert.match(pending, /candidate patch/);
  assert.match(pending, new RegExp(oid(30)));
  assert.match(pending, /Binary changes are included/);
  assert.match(pending, /Confirm exact plan exact-plan/);
  assert.doesNotMatch(pending, /I have reviewed|type="checkbox"|disabled=""[^>]*>Confirm exact plan/);
  for (const changed of [
    ready.map((value, index) => index === 10 ? { plan, actionId: "" } : value),
    ready.map((value, index) => index === 10 ? { plan: { ...plan, expiresAt: Date.now() - 1 }, actionId: "action" } : value),
    ready.map((value, index) => index === 8 ? { ...status, receipts: [] } : value),
    ready.map((value, index) => index === 12 ? "verify" : value),
    ready.map((value, index) => index === 13 ? true : value),
  ]) assert.match(render(changed), /disabled=""[^>]*>Confirm exact plan/, "Missing authority, stale plans/receipts and busy/blocked state still disable confirmation");
  const partial = render(base.map((value, index) => index === 11 ? { status: "partial-state", targetBranch: "main", mergeOid: oid(30), recoveryPath: "/private/record", reason: "Failed" } : value));
  assert.match(partial, /Partial state — inspect manually; do not retry/);
  assert.match(partial, /intended merge commit \(ref update unproven\)/);
  assert.match(partial, /\/private\/record/);
  const blocked = render(base.map((value, index) => index === 13 ? true : value));
  assert.match(blocked, /Run required checks<\/button>/);
  assert.match(blocked, /disabled=""[^>]*>Run required checks/);
});

// Execute actual hooks and request handlers, not a receipt reducer. These HTTP
// DTO fixtures cover rendering races only; route/native tests prove real receipts.
function harness(fetch, clock) {
  let index = 0; const slots = [], effects = [], pending = [], events = [];
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], value => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++, old = effects[i];
      if (!old || deps.some((v, n) => !Object.is(v, old.deps[n]))) pending.push(() => { old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  class ClockDate extends Date { static now() { return clock.now; } }
  const mod = { exports: {} }, jsx = (type, props) => ({ type, props });
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports, require: id => id === "react" ? react
    : id === "./GitCheckRecoveryPanel" ? { GitCheckRecoveryPanel: () => null } : { jsx, jsxs: jsx },
    fetch, Date: ClockDate, AbortController, URLSearchParams, Response, TextEncoder,
    window: { dispatchEvent: event => events.push(event) }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } } });
  return { events, render(props) { index = 0; const tree = mod.exports.GitMergeReviewPanel(props); for (const effect of pending.splice(0)) effect(); return tree; },
    close() { for (const effect of effects) effect?.cleanup?.(); } };
}
function nodes(node) { if (!node || typeof node !== "object") return []; if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)]; }
function text(node) { if (Array.isArray(node)) return node.map(text).join(""); if (node && typeof node === "object") return text(node.props?.children);
  return node == null ? "" : String(node); }
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const respond = body => new Response(JSON.stringify(body), { status: 200 });
const snapshot = { ...review, featureBranch: "feature", targetBranch: "target", featureOid: oid(9), targetOid: oid(2), featureTreeOid: oid(20), targetTreeOid: oid(21), mergeTreeOid: oid(20) };

test("actual verify → current GET survives own history notification and same-scope rerenders; changed server review/evidence still refuses", async (t) => {
  for (const change of ["none", "ref", "policy"]) await t.test(change, async () => {
    const now = Date.now(), late = deferred(), requests = [], clock = { now: now + 1 };
    const receipt = { id: "returned-from-server", checkIndex: 0, startedAt: now - 100, finishedAt: now, logDigest: "digest", batch: { id: "batch", checkIndexes: [0] } };
    let verified = false;
    const h = harness((url, init) => {
      requests.push({ url, input: init?.body ? JSON.parse(init.body) : null });
      if (url.startsWith("/api/git/review")) return Promise.resolve(respond({ review: snapshot }));
      if (init?.method === "POST") { verified = true; return late.promise; }
      return Promise.resolve(respond({ review: verified && change === "ref" ? { ...snapshot, targetOid: oid(99) } : snapshot,
        checks: [{ checkIndex: 0, label: "Check" }], receipts: verified && change !== "policy" ? [receipt] : [] }));
    }, clock);
    try {
      const props = { sessionId: "A", cwd: "/fixture/A" };
      h.render(props); await settle(); let tree = h.render(props);
      nodes(tree).find(node => node.type === "button" && text(node) === "Run required checks").props.onClick();
      h.render({ ...props }); h.render({ ...props });
      late.resolve(respond({ receipts: [receipt], actionIds: ["action"] })); await settle(); await settle(); tree = h.render({ ...props });
      assert.equal(h.events.length, 1, "ordinary history refresh notification is not a policy revision");
      assert.deepEqual(requests.filter(r => r.input).map(r => r.input), [{ sessionId: "A", operation: "verify", checkIndexes: [0] }]);
      const proposalButton = nodes(tree).find(node => node.type === "button" && text(node) === "Prepare exact integration proposal");
      if (change === "none") {
        assert.match(text(tree), /Passed: receipt returned-from-server/); assert.equal(proposalButton.props.disabled, false);
      } else {
        assert.doesNotMatch(text(tree), /Passed: receipt/); assert.equal(proposalButton.props.disabled, true);
        assert.match(text(tree), /Verification batch no longer matches this checkout/);
      }
    } finally { h.close(); }
  });
});

test("clock skew or expired batch metadata never waives frontend freshness", () => {
  const now = Date.now(), batch = { id: "batch", checkIndexes: [0] };
  for (const finishedAt of [now + 60000, now - 16 * 60000]) {
    const status = { review: snapshot, checks: [{ checkIndex: 0 }], receipts: [
      { id: "server-current", checkIndex: 0, startedAt: finishedAt - 100, finishedAt, logDigest: "digest", batch },
    ] };
    assert.equal(matchingReceipts(status, snapshot), null);
  }
});

test("complete ordered batches only; independent single runs, missing metadata and mixed cohorts cannot match", () => {
  const now = Date.now();
  const receipts = [0, 1].map(checkIndex => ({ id: `r${checkIndex}`, checkIndex, startedAt: now - 100,
    finishedAt: now, logDigest: "digest", batch: { id: "batch", checkIndexes: [0, 1] } }));
  const status = { review: snapshot, checks: [{ checkIndex: 0 }, { checkIndex: 1 }], receipts };
  assert.deepEqual(matchingReceipts(status, snapshot), receipts);
  for (const invalid of [receipts.slice(0, 1), [...receipts, receipts[0]],
    receipts.map(r => ({ ...r, batch: undefined })),
    receipts.map(r => ({ ...r, batch: { id: `independent-${r.checkIndex}`, checkIndexes: [r.checkIndex] } })),
    receipts.map(r => ({ ...r, batch: { ...r.batch, id: `different-${r.checkIndex}` } }))]) {
    assert.equal(matchingReceipts({ ...status, receipts: invalid }, snapshot), null);
  }
  assert.equal(matchingReceipts(status, snapshot, []), null, "failed own attempt cannot use the old complete batch");
  assert.equal(matchingReceipts(status, snapshot, ["r1", "r0"]), null);
});

test("two required checks use one explicit request; failures never fall back to an older batch even after refresh", async t => {
  for (const outcome of ["passed", "diagnostics", "legacy-warning", "failed", "missing", "mixed"]) await t.test(outcome, async () => {
    const now = Date.now(), clock = { now: now + 1 }, requests = [], late = deferred();
    const batch = id => [0, 1].map(checkIndex => ({ id: `${id}-${checkIndex}`, checkIndex,
      startedAt: now - 100, finishedAt: now, logDigest: "digest", batch: { id, checkIndexes: [0, 1] } }));
    const old = batch("old"), current = batch("current"), checks = [{ checkIndex: 0, label: "First" }, { checkIndex: 1, label: "Second" }];
    let ran = false;
    const h = harness((url, init) => {
      if (url.startsWith("/api/git/review")) return Promise.resolve(respond({ review: snapshot }));
      if (init?.method === "POST") { requests.push(JSON.parse(init.body)); ran = true; return late.promise; }
      const fresh = outcome === "missing" ? current.slice(0, 1) : outcome === "mixed"
        ? current.map(r => ({ ...r, batch: { ...r.batch, id: `split-${r.checkIndex}` } })) : current;
      return Promise.resolve(respond({ review: snapshot, checks, receipts: [...old, ...(ran && outcome !== "failed" ? fresh : [])] }));
    }, clock);
    const props = { sessionId: "two-check-chat", cwd: "/fixture/two" };
    const button = (tree, name) => nodes(tree).find(node => node.type === "button" && text(node) === name);
    try {
      h.render(props); await settle(); let tree = h.render(props);
      button(tree, "Run required checks").props.onClick(); tree = h.render(props);
      assert.doesNotMatch(text(tree), /Passed: receipt/, "starting a new attempt drops older display evidence immediately");
      assert.equal(button(tree, "Prepare exact integration proposal").props.disabled, true);
      late.resolve(outcome === "failed" ? Response.json({ error: "Required check failed" }, { status: 409 })
        : respond({ receipts: current, actionIds: ["a0", "a1"],
          ...(outcome === "diagnostics" ? { diagnostics: { status: "unavailable", reason: "storage-unavailable" } } : {}),
          ...(outcome === "legacy-warning" ? { recoveryWarning: "old optional history warning" } : {}) }));
      await settle(); await settle(); tree = h.render(props);
      assert.deepEqual(requests, [{ sessionId: props.sessionId, operation: "verify", checkIndexes: [0, 1] }]);
      const success = ["passed", "diagnostics", "legacy-warning"].includes(outcome);
      assert.equal(button(tree, "Prepare exact integration proposal").props.disabled, !success);
      if (success) {
        assert.match(text(tree), /Passed: receipt current-0/); assert.match(text(tree), /Passed: receipt current-1/);
        assert.doesNotMatch(text(tree), /Passed: receipt old-/);
        if (outcome !== "passed") assert.match(text(tree), /Optional action history or output is unavailable/);
      } else {
        assert.doesNotMatch(text(tree), /Passed: receipt/);
        button(tree, "Refresh review").props.onClick(); h.render(props); await settle(); tree = h.render(props);
        assert.equal(button(tree, "Prepare exact integration proposal").props.disabled, true);
        assert.equal(button(tree, "Run required checks").props.disabled, false, "a fresh explicit attempt remains possible");
        assert.doesNotMatch(text(tree), /Passed: receipt/, "refresh does not silently select an older batch");
        assert.equal(requests.length, 1, "no automatic rerun or rebaseline");
      }
    } finally { h.close(); }
  });
});

test("check outcome note has no callbacks, recovery requests or busy state", () => {
  assert.match(panel, /<GitCheckRecoveryPanel \/>/);
  assert.doesNotMatch(panel, /onRecovered|onRecoveringChange|recoveryAccepted|recoveryBusy|recoveryInFlight|check-recovery|quarantine/);
  assert.match(panel, /setRevision\(\(value\) => value \+ 1\)/, "ordinary explicit refresh remains");
});

test("integration contract renders a separate deliberate review and exact-state approval, never auto-confirms", () => {
  assert.match(panel, /fetch\(`\/api\/git\/integration\?\$\{new URLSearchParams\(\{ sessionId \}\)\}`/);
  assert.match(panel, /operation: "verify", checkIndex/);
  assert.match(panel, /operation: "plan", receiptIds: receipts!\.map\(\(receipt\) => receipt\.id\)/);
  assert.match(panel, /operation: "confirm", planId: proposal!\.plan\.planId, approvePlanId: proposal!\.plan\.planId, actionId: proposal!\.actionId/);
  assert.match(panel, /new CustomEvent\("pi-web:git-actions-changed", \{ detail: \{ sessionId \} \}\)/);
  assert.match(panel, /body\.recoveryWarning/);
  assert.doesNotMatch(panel, /if \(body\.recoveryWarning\).*setBlocked/);
  assert.match(panel, /onClick=\{\(\) => void integrationAction\("verify"\)\}/);
  assert.match(panel, /disabled=\{!matchingReceipts\(integration, review, ownReceiptIds\) \|\| blocked \|\| !!result \|\| operation !== null\}/);
  assert.doesNotMatch(panel, /I have reviewed this exact proposal|proposal\.viewed/);
  assert.match(panel, /aria-label="Authoritative integration candidate diff"/);
  assert.match(panel, /\{proposal\.plan\.diff\.patch\}<\/pre>/);
  assert.match(panel, /Exact plan ID|Exact merge commit OID|Verification receipt IDs/);
  assert.match(panel, /Partial state — inspect manually; do not retry/);
  assert.match(panel, /if \(action === "confirm" && \(!proposal\?\.actionId \|\| !receipts \|\| !proposalMatches\(proposal\.plan, review, sessionId, receipts\)\)\) return/);
  assert.match(panel, /onClick=\{\(\) => void integrationAction\("confirm"\)\}/);
});
