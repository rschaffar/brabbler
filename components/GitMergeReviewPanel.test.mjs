import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Module, { createRequire } from "node:module";
import ts from "typescript";

const panel = await readFile(new URL("./GitMergeReviewPanel.tsx", import.meta.url), "utf8");
// Compile only this client component to exercise its pure selection logic in Node.
const compiled = ts.transpileModule(panel, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const componentModule = new Module(new URL("./GitMergeReviewPanel.tsx", import.meta.url).pathname);
componentModule.filename = new URL("./GitMergeReviewPanel.tsx", import.meta.url).pathname;
componentModule.require = createRequire(import.meta.url);
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

test("server-matched receipts require every saved check in order, current snapshot and unexpired metadata", () => {
  const snapshot = { ...review, featureBranch: "feature", targetBranch: "main", featureOid: oid(9), targetOid: oid(2), featureTreeOid: oid(20), targetTreeOid: oid(21), mergeTreeOid: oid(20) };
  const now = Date.now();
  const receipts = [0, 1].map((checkIndex) => ({ id: `receipt-${checkIndex}`, checkIndex, startedAt: now - 100, finishedAt: now, logDigest: "digest" }));
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

test("renderer shows full authoritative proposal only after prepare, with a separate acknowledgement and confirmation", () => {
  const snapshot = { ...review, featureBranch: "feature", targetBranch: "main", featureOid: oid(9), targetOid: oid(2), featureTreeOid: oid(20), targetTreeOid: oid(21), mergeTreeOid: oid(20) };
  const receipt = { id: "receipt-1", checkIndex: 0, startedAt: Date.now() - 10, finishedAt: Date.now(), logDigest: "digest" };
  const status = { review: snapshot, checks: [{ checkIndex: 0, label: "Tests" }], receipts: [receipt] };
  const plan = { planId: "exact-plan", sessionId: "s", expiresAt: Date.now() + 60_000, review: snapshot, receiptIds: [receipt.id],
    diff: { fromTreeOid: snapshot.targetTreeOid, toTreeOid: snapshot.featureTreeOid, patch: "candidate patch", hasBinaryChanges: true }, mergeOid: oid(30), message: "Merge branch" };
  const base = [0, snapshot, { kind: "merge" }, null, null, null, false, false, status, null, null, null, null, false];
  function render(states) {
    let index = 0;
    const mod = new Module(componentModule.filename);
    mod.filename = componentModule.filename;
    const realRequire = createRequire(import.meta.url);
    mod.require = (id) => id === "react" ? { ...React, useState: () => [states[index++], () => {}], useRef: () => ({ current: null }), useEffect: () => {} } : realRequire(id);
    mod._compile(compiled, mod.filename);
    return renderToStaticMarkup(React.createElement(mod.exports.GitMergeReviewPanel, { sessionId: "s", cwd: "/repo" }));
  }
  const unavailable = render(base.map((value, index) => index === 8 ? null : index === 9 ? "Saved merge target and checks required" : value));
  assert.match(unavailable, /Saved merge target and checks required/);
  assert.doesNotMatch(unavailable, /Run check 1|Prepare exact integration proposal|Confirm exact plan/);
  const before = render(base);
  assert.match(before, /Tests/);
  assert.match(before, /Prepare exact integration proposal/);
  assert.doesNotMatch(before, /Confirm exact plan|candidate patch/);
  const pending = render(base.map((value, index) => index === 10 ? { plan, viewed: false } : value));
  assert.match(pending, /exact-plan/);
  assert.match(pending, /candidate patch/);
  assert.match(pending, new RegExp(oid(30)));
  assert.match(pending, /Binary changes are included/);
  assert.match(pending, /I have reviewed this exact proposal/);
  assert.doesNotMatch(pending, /Confirm exact plan/);
  const viewed = render(base.map((value, index) => index === 10 ? { plan, viewed: true } : value));
  assert.match(viewed, /Confirm exact plan exact-plan/);
  assert.doesNotMatch(viewed, /I have reviewed this exact proposal/);
  const partial = render(base.map((value, index) => index === 11 ? { status: "partial-state", targetBranch: "main", mergeOid: oid(30), recoveryPath: "/private/record", reason: "Failed" } : value));
  assert.match(partial, /Partial state — inspect manually; do not retry/);
  assert.match(partial, /intended merge commit \(ref update unproven\)/);
  assert.match(partial, /\/private\/record/);
  const blocked = render(base.map((value, index) => index === 13 ? true : value));
  assert.match(blocked, /Run check 1<\/button>/);
  assert.match(blocked, /disabled=""[^>]*>Run check 1/);
});

test("integration contract renders a separate deliberate review and exact-state approval, never auto-confirms", () => {
  assert.match(panel, /fetch\(`\/api\/git\/integration\?\$\{new URLSearchParams\(\{ sessionId \}\)\}`/);
  assert.match(panel, /operation: "verify", checkIndex/);
  assert.match(panel, /operation: "plan", receiptIds: receipts!\.map\(\(receipt\) => receipt\.id\)/);
  assert.match(panel, /operation: "confirm", planId: proposal!\.plan\.planId, approvePlanId: proposal!\.plan\.planId, actionId: proposal!\.actionId/);
  assert.match(panel, /new CustomEvent\("pi-web:git-actions-changed", \{ detail: \{ sessionId \} \}\)/);
  assert.match(panel, /body\.recoveryWarning/);
  assert.match(panel, /result\.recoveryWarning/);
  assert.match(panel, /onClick=\{\(\) => void integrationAction\("verify", index\)\}/);
  assert.match(panel, /disabled=\{!matchingReceipts\(integration, review\) \|\| blocked \|\| !!result \|\| operation !== null\}/);
  assert.match(panel, /I have reviewed this exact proposal/);
  assert.match(panel, /proposal\.viewed/);
  assert.match(panel, /aria-label="Authoritative integration candidate diff"/);
  assert.match(panel, /\{proposal\.plan\.diff\.patch\}<\/pre>/);
  assert.match(panel, /Exact plan ID|Exact merge commit OID|Verification receipt IDs/);
  assert.match(panel, /Partial state — inspect manually; do not retry/);
  assert.match(panel, /if \(action === "confirm" && \(!proposal\?\.viewed/);
  assert.match(panel, /onClick=\{\(\) => void integrationAction\("confirm"\)\}/);
});
