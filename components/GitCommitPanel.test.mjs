import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const panel = await readFile(new URL("./GitCommitPanel.tsx", import.meta.url), "utf8");
const chat = await readFile(new URL("./ChatWindow.tsx", import.meta.url), "utf8");

test("commit review is only mounted for a persisted ordinary chat at the chat cwd", () => {
  assert.match(chat, /session && !session\.transient && session\.relation\?\.kind !== "subagent" && createPortal/);
  assert.match(chat, /hidden=\{gitControlsPanel !== "commit"\}.*visitedGitDetails\.includes\("commit"\)/);
  assert.match(chat, /session && !session\.transient && session\.relation\?\.kind !== "subagent"/);
  assert.match(chat, /<GitCommitPanel key=\{`commit:\$\{session\.id\}:\$\{session\.cwd\}`\} sessionId=\{session\.id\} cwd=\{session\.cwd\}/);
  assert.match(chat, /<GitCommitPanel[\s\S]*?busy=\{sessionBusy \|\| isCompacting \|\| modelSwitching \|\| Boolean\(forkingEntryId\) \|\| quoteSubmitting \|\| Boolean\(sessionRunning\)\}/);
});

test("review keeps diff read-only and requires explicit paths, message, preview, and confirm", () => {
  assert.match(panel, /\/api\/git\/status\?/);
  assert.match(panel, /\/api\/git\/diff\?/);
  assert.match(panel, /checked=\{selected\.includes\(path\)\}/);
  assert.match(panel, /NOT the authoritative commit candidate/);
  assert.match(panel, /non-authoritative working-tree diff/);
  assert.match(panel, /Authoritative candidate patch \(HEAD tree → candidate tree\)/);
  assert.match(panel, /candidate\.candidateDiff\.hasBinaryChanges/);
  assert.match(panel, /candidate\.candidateDiff\.patch/);
  assert.match(panel, /candidateDiffUnavailable/);
  assert.match(panel, /preview\.reviewToken/);
  assert.match(panel, /unsupported diffs do not exclude a file/);
  assert.match(panel, /JSON\.stringify\(\{ operation: "preview", sessionId, paths, mode, message, receiptIds \}\)/);
  assert.match(panel, /mode === "staged" \? \[\.\.\.new Set\(selected\.flatMap/);
  assert.match(panel, /file\.originalFilePath/);
  assert.match(panel, /setSelected\(\[\]\); setMode\(event\.target\.value as typeof mode\)/);
  assert.match(panel, /JSON\.stringify\(\{ operation: "confirm", sessionId, preview, message, actionId: candidate\.actionId, receiptIds: candidate\.verification\.receiptIds \}\)/);
  assert.match(panel, /new CustomEvent\("pi-web:git-actions-changed", \{ detail: \{ sessionId \} \}\)/);
  assert.match(panel, /body\.recoveryRequired/);
  assert.match(panel, /result\.recoveryWarning/);
  assert.match(panel, /onClick=\{\(\) => void confirm\(\)\}/);
  assert.doesNotMatch(panel, /location\.reload|window\.location/);
});

test("selection, message, refresh and busy invalidate preview; stale errors and partial success remain visible", () => {
  assert.match(panel, /const invalidate = \(\) => \{ generation\.current\+\+; setCandidate\(null\); setReceipts\(\[\]\); setCheckPreview\(null\); \}/);
  assert.match(panel, /if \(busy\) \{ generation\.current\+\+; setCandidate\(null\); setReceipts\(\[\]\); setCheckPreview\(null\); checkRun\.current\?\.abort\(\); \}/);
  assert.match(panel, /const refresh = \(\) => \{\s*invalidate\(\)/);
  assert.match(panel, /onChange=\{\(event\) => \{ invalidate\(\); setSelected/);
  assert.match(panel, /onChange=\{\(event\) => \{ invalidate\(\); setMessage/);
  assert.match(panel, /if \(generation\.current === version\) setCandidate\(body\)/);
  assert.match(panel, /const preview = candidate\?\.preview \?\? null/);
  assert.match(panel, /response\.status === 409/);
  assert.match(panel, /setResult\(body\)/);
  assert.match(panel, /status === "partial-success"/);
  assert.match(panel, /<dt>Commit ID<\/dt>/);
  assert.match(panel, /<dt>Author email<\/dt>/);
  assert.match(panel, /setRevision\(\(value\) => value \+ 1\)/);
});

test("check execution and commit confirmation are separate, with explicit workspace-not-tree limitation", () => {
  assert.match(panel, /Run selected required checks/);
  assert.match(panel, /Decline check run/);
  assert.match(panel, /Check evidence freshness/);
  assert.match(panel, /NOT the selected commit tree/);
  assert.match(panel, /candidateTreeVerified: false/);
  assert.match(panel, /repositoryChecksWaived: false/);
  assert.match(panel, /project instructions still apply/);
  assert.match(panel, /receiptIds: candidate\.verification\.receiptIds/);
  assert.match(panel, /disabled=\{disabled \|\| !checksReady\}/);
  assert.doesNotMatch(panel.slice(panel.indexOf("async function checksRequest"), panel.indexOf("async function submitPreview")), /confirm\(|\/api\/git\/commit/);
});

// Lightweight hook/JSX harness: execute the actual component, not a reimplemented
// reducer. No browser, React DOM or network; deferred HTTP fixtures exercise races.
function harness(fetch, runtime = {}) {
  let index = 0; const slots = [], effects = [], pending = [];
  const react = {
    useState(initial) { const i = index++; if (!(i in slots)) slots[i] = initial;
      return [slots[i], (value) => { slots[i] = typeof value === "function" ? value(slots[i]) : value; }]; },
    useRef(initial) { const i = index++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = index++, old = effects[i];
      if (!old || deps.some((value, n) => !Object.is(value, old.deps[n]))) pending.push(() => {
        old?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const compiled = { exports: {} };
  const code = ts.transpileModule(panel, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module: compiled, exports: compiled.exports, require: (id) => id === "react" ? react : { jsx, jsxs: jsx },
    fetch, AbortController, URLSearchParams, Response, Date, setInterval, clearInterval, ...runtime,
    window: { dispatchEvent() {} }, CustomEvent: class {} });
  return { render(props) { index = 0; const tree = compiled.exports.GitCommitPanel(props); for (const effect of pending.splice(0)) effect(); return tree; },
    close() { for (const effect of effects) effect?.cleanup?.(); } };
}
function nodes(node) { if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)]; }
function text(node) { if (Array.isArray(node)) return node.map(text).join("");
  if (node && typeof node === "object") return text(node.props?.children); return node == null ? "" : String(node); }
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const checkRequirements = { revision: "saved", status: "required", checks: [{ checkIndex: 1, label: "saved prerequisite" }], receipts: [],
  evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false };
const checkCandidate = { previewId: "preview", revision: "exact", source: "/fixture/A", expiresAt: Date.now() + 60000,
  checks: [{ checkIndex: 1, label: "saved prerequisite", argv: ["native-fixture"], cwd: ".", environmentDigest: "fixture-env" }] };
function respond(body) { return new Response(JSON.stringify(body), { status: 200 }); }

function fakeClock() {
  let now = Date.now(), nextId = 0; const timers = new Map();
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  return { now: () => now, advance(ms) { now += ms; for (const fn of [...timers.values()]) fn(); },
    runtime: { Date: ClockDate, setInterval(fn) { const id = ++nextId; timers.set(id, fn); return id; }, clearInterval(id) { timers.delete(id); } } };
}
const find = (tree, id) => nodes(tree).find((node) => node.props?.["data-testid"] === id);

// These are deferred HTTP DTO fixtures executing the actual component and its
// timer effects, not native evidence/containment proofs. Native route tests own
// receipt authenticity; UI tests must accept only the live, unrevoked response.
test("consumed check preview expiry cannot retire a long awaited run; fresh returned receipts remain usable", async () => {
  const clock = fakeClock(), late = deferred(), requests = [];
  const consent = { ...checkCandidate, expiresAt: clock.now() + 60000 };
  const h = harness((url, init) => {
    if (url.startsWith("/api/git/status")) return Promise.resolve(respond({ isGitRepository: true, repositoryRoot: "/fixture/A", files: [] }));
    if (init?.method === "POST") {
      const input = JSON.parse(init.body); requests.push({ url, input });
      return input.operation === "preview" ? Promise.resolve(respond(consent)) : late.promise;
    }
    return Promise.resolve(respond(checkRequirements));
  }, clock.runtime);
  try {
    const props = { sessionId: "A", cwd: "/fixture/A", busy: false };
    h.render(props); await settle(); let tree = h.render(props);
    find(tree, "git-commit-check-preview").props.onClick(); await settle(); tree = h.render(props);
    const run = find(tree, "git-commit-check-run").props.onClick; run(); run(); tree = h.render(props);
    assert.equal(find(tree, "git-commit-check-run"), undefined, "the approval capability is consumed immediately");
    assert.ok(find(tree, "git-commit-check-cancel"));
    assert.deepEqual(requests[1].input, { sessionId: "A", operation: "run", previewId: consent.previewId, revision: consent.revision });
    assert.equal(requests.length, 2, "consent is single-use, without retries");
    clock.advance(120000); tree = h.render({ ...props });
    assert.doesNotMatch(text(tree), /Current evidence/); assert.ok(find(tree, "git-commit-check-cancel"));
    late.resolve(respond({ status: "passed", receipts: [{ id: "returned-receipt", checkIndex: 1, finishedAt: clock.now(),
      expiresAt: clock.now() + 15 * 60000, freshness: "current", evidenceScope: "working-workspace", candidateTreeVerified: false, repositoryChecksWaived: false }] }));
    await settle(); tree = h.render(props);
    assert.match(text(find(tree, "git-commit-check-freshness-1")), /Current evidence; expires/);
    assert.equal(find(tree, "git-commit-check-cancel"), undefined);
    assert.equal(requests.some(({ url }) => url === "/api/git/commit"), false, "checks never automatically commit");
    clock.advance(15 * 60000 + 1); tree = h.render(props);
    assert.doesNotMatch(text(tree), /Current evidence/, "actual receipt expiry remains enforced");
  } finally { h.close(); }
});

test("expired unconsumed check approval cannot start a run, even from a saved click handler", async () => {
  const clock = fakeClock(), requests = [];
  const h = harness((url, init) => {
    if (url.startsWith("/api/git/status")) return Promise.resolve(respond({ isGitRepository: true, repositoryRoot: "/fixture/A", files: [] }));
    if (init?.method === "POST") { requests.push(JSON.parse(init.body)); return Promise.resolve(respond({ ...checkCandidate, expiresAt: clock.now() + 60000 })); }
    return Promise.resolve(respond(checkRequirements));
  }, clock.runtime);
  try {
    const props = { sessionId: "A", cwd: "/fixture/A", busy: false };
    h.render(props); await settle(); let tree = h.render(props);
    find(tree, "git-commit-check-preview").props.onClick(); await settle(); tree = h.render(props);
    const run = find(tree, "git-commit-check-run").props.onClick;
    clock.advance(60001); run(); tree = h.render(props);
    assert.deepEqual(requests.map((r) => r.operation), ["preview"]);
    assert.equal(find(tree, "git-commit-check-run"), undefined); assert.doesNotMatch(text(tree), /Current evidence/);
  } finally { h.close(); }
});

test("scope/busy/cancel revocation still discards long-run responses after consuming approval", async (t) => {
  for (const revocation of ["scope", "busy", "cancel"]) await t.test(revocation, async () => {
    const clock = fakeClock(), late = deferred(); let signal;
    const h = harness((url, init) => {
      if (url.startsWith("/api/git/status")) return Promise.resolve(respond({ isGitRepository: true, repositoryRoot: url.includes("B") ? "/fixture/B" : "/fixture/A", files: [] }));
      if (init?.method === "POST") {
        if (JSON.parse(init.body).operation === "preview") return Promise.resolve(respond({ ...checkCandidate, expiresAt: clock.now() + 60000 }));
        signal = init.signal; return late.promise;
      }
      return Promise.resolve(respond(checkRequirements));
    }, clock.runtime);
    try {
      const props = { sessionId: "A", cwd: "/fixture/A", busy: false };
      h.render(props); await settle(); let tree = h.render(props);
      find(tree, "git-commit-check-preview").props.onClick(); await settle(); tree = h.render(props);
      find(tree, "git-commit-check-run").props.onClick(); tree = h.render(props);
      clock.advance(120000); tree = h.render(props);
      const current = revocation === "scope" ? { ...props, sessionId: "B", cwd: "/fixture/B" }
        : revocation === "busy" ? { ...props, busy: true } : props;
      if (revocation === "cancel") find(tree, "git-commit-check-cancel").props.onClick();
      else h.render(current);
      assert.equal(signal.aborted, true);
      // Even a transport that completes JSON despite abort cannot publish it.
      late.resolve(respond({ status: "passed", receipts: [{ id: "revoked", checkIndex: 1, finishedAt: clock.now(), expiresAt: clock.now() + 60000 }] }));
      await settle(); tree = h.render(current);
      assert.doesNotMatch(text(tree), /Current evidence/);
      assert.equal(find(tree, "git-commit-check-run"), undefined);
    } finally { h.close(); }
  });
});

test("late check previews and receipts from a previous saved session scope are discarded", async () => {
  const late = deferred();
  const h = harness((url, init) => {
    if (url.startsWith("/api/git/status")) return Promise.resolve(respond({ isGitRepository: true, repositoryRoot: url.includes("B") ? "/fixture/B" : "/fixture/A", files: [] }));
    if (init?.method === "POST") return late.promise;
    return Promise.resolve(respond(checkRequirements));
  });
  try {
    const A = { sessionId: "A", cwd: "/fixture/A", busy: false }, B = { sessionId: "B", cwd: "/fixture/B", busy: false };
    h.render(A); await settle(); let tree = h.render(A);
    nodes(tree).find((n) => n.type === "button" && text(n) === "Review required check run").props.onClick();
    h.render(B); await settle();
    late.resolve(respond(checkCandidate)); await settle(); tree = h.render(B);
    assert.equal(nodes(tree).some((n) => n.props?.["aria-label"] === "Check execution preview"), false);
    assert.doesNotMatch(text(tree), /native-fixture|Current evidence/);
  } finally { h.close(); }
});

test("busy/refresh revocation discards a late check-run response; a Run click never calls the commit endpoint", async () => {
  const late = deferred(), requests = [];
  const h = harness((url, init) => {
    requests.push(url);
    if (url.startsWith("/api/git/status")) return Promise.resolve(respond({ isGitRepository: true, repositoryRoot: "/fixture/A", files: [] }));
    if (init?.method === "POST") return JSON.parse(init.body).operation === "preview" ? Promise.resolve(respond(checkCandidate)) : late.promise;
    return Promise.resolve(respond(checkRequirements));
  });
  try {
    const props = { sessionId: "A", cwd: "/fixture/A", busy: false };
    h.render(props); await settle(); let tree = h.render(props);
    nodes(tree).find((n) => n.type === "button" && text(n) === "Review required check run").props.onClick(); await settle(); tree = h.render(props);
    nodes(tree).find((n) => n.type === "button" && text(n) === "Run selected required checks").props.onClick();
    h.render({ ...props, busy: true });
    late.resolve(respond({ receipts: [{ id: "stale", checkIndex: 1, finishedAt: Date.now(), expiresAt: Date.now() + 60000, freshness: "current" }] }));
    await settle(); tree = h.render({ ...props, busy: true });
    assert.doesNotMatch(text(tree), /Current evidence/);
    assert.equal(requests.includes("/api/git/commit"), false);
  } finally { h.close(); }
});

test("late post-CAS commit facts remain visible with their original checkout without wiping fresh scope data", async () => {
  const late = deferred();
  const receipt = { id: "receipt-A", checkIndex: 1, finishedAt: Date.now(), expiresAt: Date.now() + 60000, freshness: "current" };
  const candidate = { actionId: "commit-A", verification: { receiptIds: [receipt.id] }, candidateDiffUnavailable: "fixture",
    preview: { repositoryRoot: "/fixture/A", paths: ["a"], mode: "whole-file", branch: "refs/heads/main", head: "parent-A", tree: "tree-A", reviewToken: "exact-A" } };
  const h = harness((url, init) => {
    if (url.startsWith("/api/git/status")) {
      const B = url.includes("%2FB"); const root = B ? "/fixture/B" : "/fixture/A", file = B ? "b" : "a";
      return Promise.resolve(respond({ isGitRepository: true, repositoryRoot: root, files: [{ filePath: `${root}/${file}`, status: "modified", indexStatus: " ", worktreeStatus: "M" }] }));
    }
    if (url === "/api/git/commit") return JSON.parse(init.body).operation === "preview" ? Promise.resolve(respond(candidate)) : late.promise;
    return Promise.resolve(respond({ ...checkRequirements, receipts: url.includes("sessionId=A") ? [receipt] : [] }));
  });
  try {
    const A = { sessionId: "A", cwd: "/fixture/A", busy: false }, B = { sessionId: "B", cwd: "/fixture/B", busy: false };
    const find = (tree, id) => nodes(tree).find((node) => node.props?.["data-testid"] === id);
    h.render(A); await settle(); let tree = h.render(A);
    find(tree, "git-commit-message").props.onChange({ target: { value: "exact message" } });
    tree = h.render(A); find(tree, "git-commit-path-a").props.onChange({ target: { checked: true } });
    tree = h.render(A); find(tree, "git-commit-check-status").props.onClick(); await settle(); tree = h.render(A);
    nodes(tree).find((node) => node.type === "form").props.onSubmit({ preventDefault() {} }); await settle(); tree = h.render(A);
    find(tree, "git-commit-confirm").props.onClick();
    h.render(B); await settle(); h.render(B);
    late.resolve(respond({ status: "committed", commit: "CREATED-A", tree: "tree-A", parents: ["parent-A"], authorEmail: "fixture@example.invalid" }));
    await settle(); tree = h.render(B);
    assert.match(text(tree), /CREATED-A/); assert.match(text(tree), /Checkout: \/fixture\/A/);
    assert.ok(find(tree, "git-commit-path-b"), "a stale old confirmation must not clear the new checkout's fresh status");
    assert.equal(find(tree, "git-commit-message").props.value, "");
    assert.equal(nodes(tree).some((node) => node.props?.["aria-label"] === "Commit preview"), false);
  } finally { h.close(); }
});
