import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-web-integration-route-home-"));
const agentDir = join(home, "agent");
await mkdir(agentDir);
const previous = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { appendSessionGitWorkflow } = await jiti.import("../../../../lib/git-workflow-policy.ts");
const { getRpcSession } = await jiti.import("../../../../lib/rpc-manager.ts");
const { acquireGitCheckoutGate, isGitCheckoutGated } = await jiti.import("../../../../lib/git-checkout-gate.ts");
const { readGitAction, subscribeGitActionUpdates } = await jiti.import("../../../../lib/git-action-journal.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout.trim();
const get = (id) => GET(new Request(`http://localhost/api/git/integration?sessionId=${encodeURIComponent(id)}`));
const post = (body, signal) => POST(new Request("http://localhost/api/git/integration", { method: "POST", body: JSON.stringify(body), signal }));
const op = (id, operation, extra = {}) => ({ sessionId: id, operation, ...extra });
const confirm = (id, { plan, actionId }) => op(id, "confirm", { planId: plan.planId, approvePlanId: plan.planId, actionId });
const history = (id) => readGitAction(id, { includeArtifact: true });
const anchors = (sm) => SessionManager.open(sm.getSessionFile()).getEntries().filter((e) => e.type === "custom" && e.customType === "pi-web:git-action");
const actionFile = (actionId, name = "record.json") => join(agentDir, "pi-web/git-actions/v1", actionId, name);
const actionRecord = (id) => JSON.parse(readFileSync(actionFile(id), "utf8")).record;
async function jsonOK(response) {
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
after(async () => {
  const pending = globalThis[Symbol.for("pi-web:git-action-human:v1")]?.pending;
  for (const item of pending?.values() ?? []) { clearTimeout(item.timer); item.handle.release(); }
  pending?.clear();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
});

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-integration-route-"));
  const target = join(dir, "target"), feature = join(dir, "feature");
  await exec("git", ["init", "-qb", "target", target]);
  await git(target, "config", "user.name", "Tester");
  await git(target, "config", "user.email", "tester@example.invalid");
  await git(target, "config", "core.autocrlf", "false");
  await writeFile(join(target, "note"), "base\n");
  await git(target, "add", "note"); await git(target, "commit", "-qm", "base");
  await git(target, "worktree", "add", "-qb", "feature", feature);
  await writeFile(join(feature, "note"), "feature\n");
  await git(feature, "add", "note"); await git(feature, "commit", "-qm", "feature");
  const sm = SessionManager.create(feature);
  sm.appendMessage({ role: "user", content: "review", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "target", method: "merge" },
    checks: [{ label: "Test check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  appendSessionGitWorkflow(sm, policy);
  const id = sm.getSessionId();
  cacheSessionPath(id, sm.getSessionFile());
  allowFileRoot(feature); allowFileRoot(target);
  t.after(async () => { invalidateSessionPathCache(id); invalidateSessionListCache(); await rm(dir, { recursive: true, force: true }); });
  return { id, feature, target, policy, sm };
}
async function proposal(f) {
  const receipts = [];
  for (let checkIndex = 0; checkIndex < f.policy.checks.length; checkIndex++) {
    receipts.push((await jsonOK(await post(op(f.id, "verify", { checkIndex })))).receipt.id);
  }
  return jsonOK(await post(op(f.id, "plan", { receiptIds: receipts })));
}

test("human checks and exact plan share durable metadata-only anchors, explicit confirmation and actual result facts", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await jsonOK(await get(f.id))).checks, [{ checkIndex: 0, label: "Test check" }]);
  assert.deepEqual((await jsonOK(await get(f.id))).receipts, []);
  assert.equal(anchors(f.sm).length, 0); // read-only GET never journals
  const { receipt, actionId: checkAction } = await jsonOK(await post(op(f.id, "verify", { checkIndex: 0 })));
  assert.ok(receipt.id);
  assert.equal(JSON.stringify(receipt).includes("argv"), false);
  assert.deepEqual((await jsonOK(await get(f.id))).receipts, [receipt]);
  const checked = await history(checkAction);
  assert.equal(checked.record.source, "human");
  assert.equal(checked.record.state, "succeeded");
  assert.equal(checked.record.decision, "approved");
  assert.equal(checked.record.outcome.status, "passed");
  assert.deepEqual(checked.candidate.checks, f.policy.checks);
  assert.equal(checked.candidate.featureOid, await git(f.feature, "rev-parse", "HEAD"));
  assert.equal((await post(op(f.id, "plan", { receiptIds: ["not-a-receipt"] }))).status, 409);
  const p = await jsonOK(await post(op(f.id, "plan", { receiptIds: [receipt.id] })));
  const { plan, actionId } = p;
  const pending = await history(actionId);
  assert.equal(pending.record.state, "awaiting-decision");
  assert.equal(pending.record.outcome, undefined);
  assert.equal(pending.candidate.message, plan.message);
  assert.deepEqual(pending.candidate.diff, plan.diff);
  assert.deepEqual(pending.candidate.checks, f.policy.checks);
  assert.doesNotMatch(JSON.stringify(pending), /planId|receiptIds|reviewToken/);
  assert.doesNotMatch(await readFile(f.sm.getSessionFile(), "utf8"), /diff --git|planId|receiptIds/);
  assert.deepEqual(anchors(f.sm).map((e) => e.data), [checkAction, actionId].map((id) => ({ version: 1, actionId: id })));
  assert.equal((await post({ ...confirm(f.id, p), approvePlanId: "wrong" })).status, 400);
  const other = await fixture(t);
  assert.equal((await post(confirm(other.id, p))).status, 409);
  assert.equal((await post({ ...confirm(f.id, p), actionId: checkAction })).status, 409);
  const result = await jsonOK(await post(confirm(f.id, p)));
  assert.equal(result.status, "integrated");
  assert.doesNotMatch(JSON.stringify(result), /patch|diff/);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), plan.mergeOid);
  const completed = await history(actionId);
  assert.equal(completed.record.state, "succeeded");
  assert.equal(completed.record.decision, "approved");
  assert.equal(completed.record.outcome.mergeOid, plan.mergeOid);
  assert.equal(completed.record.outcome.authorEmail, "tester@example.invalid");
  assert.deepEqual(completed.record.outcome.parents, [plan.review.targetOid, plan.review.featureOid]);
  assert.equal(completed.record.intended.mergeOid, plan.mergeOid);
  assert.equal((await post(confirm(f.id, p))).status, 409);
  assert.equal((await get(f.id)).status, 409); // target no longer on the feature's first-parent chain
  await git(f.target, "worktree", "remove", f.feature);
  assert.deepEqual((await history(actionId)).candidate, pending.candidate);
});

test("refuses browser authority, missing policy, stale receipts and disallowed scope without journal writes", async (t) => {
  const f = await fixture(t);
  for (const extra of [{ cwd: f.feature }, { argv: ["true"] }, { featureBranch: "feature" }, { targetBranch: "target" }]) {
    assert.equal((await post(op(f.id, "verify", { checkIndex: 0, ...extra }))).status, 400);
  }
  assert.equal((await post(op(f.id, "verify", { checkIndex: -1 }))).status, 400);
  assert.equal((await post(op(f.id, "verify", { checkIndex: 5 }))).status, 409);
  assert.equal((await post(op(f.id, "plan", { receiptIds: Array(13).fill("id") }))).status, 400);
  assert.equal((await get("absent")).status, 404);
  assert.equal(anchors(f.sm).length, 0);
  const { receipt } = await jsonOK(await post(op(f.id, "verify", { checkIndex: 0 })));
  f.policy.checks[0].label = "changed";
  appendSessionGitWorkflow(f.sm, f.policy);
  assert.deepEqual((await jsonOK(await get(f.id))).receipts, []);
  assert.equal((await post(op(f.id, "plan", { receiptIds: [receipt.id] }))).status, 409);
  appendSessionGitWorkflow(f.sm, null);
  assert.equal((await get(f.id)).status, 409);
  const roots = globalThis.__piAllowedRootsCache;
  const before = await readdir(join(agentDir, "pi-web/git-actions/v1"));
  globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
  try {
    assert.equal((await get(f.id)).status, 403);
    assert.equal((await post(op(f.id, "verify", { checkIndex: 0 }))).status, 403);
  } finally { globalThis.__piAllowedRootsCache = roots; }
  assert.deepEqual(await readdir(join(agentDir, "pi-web/git-actions/v1")), before);
});

test("an in-flight saved check gates both checkouts against a previously approved merge", async (t) => {
  const f = await fixture(t);
  f.policy.checks[0].argv = [process.execPath, "-e", "setTimeout(() => process.exit(0), 1000)"];
  appendSessionGitWorkflow(f.sm, f.policy);
  const p = await proposal(f);
  const checking = post(op(f.id, "verify", { checkIndex: 0 }));
  for (let i = 0; i < 100 && !isGitCheckoutGated(f.target); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(isGitCheckoutGated(f.target), true);
  assert.equal(isGitCheckoutGated(f.feature), true);
  assert.equal((await post(confirm(f.id, p))).status, 409);
  assert.equal((await checking).status, 200);
  assert.equal((await post(confirm(f.id, p))).status, 200);
});

test("busy source or target blocks confirmation without consuming approval", async (t) => {
  const f = await fixture(t);
  const p = await proposal(f);
  const registry = globalThis.__piSessions;
  const busy = { cwd: f.target, isRunning: () => true, isAlive: () => true };
  globalThis.__piSessions = new Map([...(registry ?? []), ["busy-integration-fixture", busy]]);
  try { assert.equal((await post(confirm(f.id, p))).status, 409); }
  finally { globalThis.__piSessions = registry; }
  assert.equal(getRpcSession("busy-integration-fixture"), undefined);
  const release = acquireGitCheckoutGate([f.target]);
  try { assert.equal((await post(confirm(f.id, p))).status, 409); }
  finally { release(); }
  assert.equal((await history(p.actionId)).record.state, "awaiting-decision");
  assert.equal((await post(confirm(f.id, p))).status, 200);
  assert.equal(isGitCheckoutGated(f.target), false);
  assert.equal(isGitCheckoutGated(f.feature), false);
});

test("each selected exact check has its own candidate and failed checks retain sanitized outcomes, never successful receipts", async (t) => {
  const f = await fixture(t);
  f.policy.checks.push({ label: "Expected failure", argv: [process.execPath, "-e", "process.stderr.write('secret raw output');process.exit(7)"] });
  appendSessionGitWorkflow(f.sm, f.policy);
  const response = await post(op(f.id, "verify", { checkIndex: 1 }));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.doesNotMatch(JSON.stringify(body), /secret raw output|process.exit/);
  const stored = await history(body.actionId);
  assert.equal(stored.record.source, "human");
  assert.equal(stored.record.state, "failed");
  assert.equal(stored.record.decision, "approved");
  assert.equal(stored.record.outcome.status, "failed");
  assert.deepEqual(stored.candidate.checks, [f.policy.checks[1]]);
  assert.doesNotMatch(stored.record.reason, /secret raw output/);
  assert.deepEqual((await jsonOK(await get(f.id))).receipts, []);
});

test("cancelled verification remains cancelled, with no passing receipt", async (t) => {
  const f = await fixture(t);
  f.policy.checks[0].argv = [process.execPath, "-e", "setTimeout(() => {}, 10000)"];
  appendSessionGitWorkflow(f.sm, f.policy);
  const controller = new AbortController();
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionRecord(actionId).state === "executing") setTimeout(() => controller.abort(), 200);
  });
  let response;
  try { response = await post(op(f.id, "verify", { checkIndex: 0 }), controller.signal); }
  finally { off(); }
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal((await history(body.actionId)).record.state, "cancelled");
  assert.equal((await history(body.actionId)).record.outcome.status, "cancelled");
  assert.deepEqual((await jsonOK(await get(f.id))).receipts, []);
  assert.equal(isGitCheckoutGated(f.target), false);
});

test("stale native preflight consumes only its live action and preserves immutable history with retry-new-preview guidance", async (t) => {
  const f = await fixture(t);
  const p = await proposal(f);
  const before = await history(p.actionId);
  await writeFile(join(f.feature, "note"), "later unreviewed files\n");
  const response = await post(confirm(f.id, p));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.recoveryRequired, undefined);
  assert.match(body.error, /new proposal/);
  assert.equal((await history(p.actionId)).record.state, "blocked");
  assert.deepEqual((await history(p.actionId)).candidate, before.candidate);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
  await writeFile(join(f.feature, "note"), "feature\n");
  assert.equal((await post(confirm(f.id, p))).status, 409); // no replay even after restoring checkout
});

test("expired/historical plans and missing action identities cannot revive native approvals", async (t) => {
  const f = await fixture(t);
  const p = await proposal(f);
  assert.equal((await post({ ...confirm(f.id, p), actionId: undefined })).status, 400);
  assert.equal((await post({ ...confirm(f.id, p), actionId: "00000000-0000-0000-0000-000000000000" })).status, 409);
  const now = Date.now;
  Date.now = () => p.expiresAt + 1;
  try { assert.equal((await post(confirm(f.id, p))).status, 409); }
  finally { Date.now = now; }
  assert.equal((await history(p.actionId)).record.state, "expired");
  assert.equal((await post(confirm(f.id, p))).status, 409);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
});

test("beforeApply persists intended facts, then rechecks cancellation before any checkout mutation", async (t) => {
  const f = await fixture(t);
  const p = await proposal(f);
  const controller = new AbortController();
  let intended;
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionId !== p.actionId) return;
    const value = actionRecord(actionId);
    if (value.state === "executing" && value.intended) { intended = value.intended; controller.abort(); }
  });
  try { assert.equal((await post(confirm(f.id, p), controller.signal)).status, 409); }
  finally { off(); }
  assert.equal(intended.mergeOid, p.plan.mergeOid);
  assert.equal((await history(p.actionId)).record.state, "cancelled");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
  assert.equal(await readFile(join(f.target, "note"), "utf8"), "base\n");
  assert.equal(await git(f.target, "status", "--porcelain"), "");
});

test("failed pre-apply journaling prevents integration; failed outcome journaling returns actual result with recovery warning", async (t) => {
  const f = await fixture(t);
  const unavailable = await proposal(f);
  await rm(actionFile(unavailable.actionId, "candidate.json"));
  assert.equal((await post(confirm(f.id, unavailable))).status, 409);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), unavailable.plan.review.targetOid);
  const p = await proposal(f);
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionId === p.actionId && actionRecord(actionId).intended) writeFileSync(actionFile(actionId), "injected invalid journal");
  });
  let response;
  try { response = await post(confirm(f.id, p)); }
  finally { off(); }
  const result = await jsonOK(response);
  assert.equal(result.status, "integrated");
  assert.equal(result.mergeOid, p.plan.mergeOid);
  assert.equal(result.recoveryRequired, true);
  assert.match(result.recoveryWarning, /do not repeat/i);
  assert.doesNotMatch(JSON.stringify(result), /refresh|no mutation|injected invalid journal/i);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), result.mergeOid);
});

test("partial-state native result becomes recovery-required, with intended merge identity and without raw diagnostics in history", async (t) => {
  const f = await fixture(t);
  const p = await proposal(f);
  const bin = await mkdtemp(join(tmpdir(), "pi-web-integration-partial-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await exec("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" read-tree -u -m "*) "${realGit}" "$@" || exit $?; echo 'secret git stderr' >&2; exit 1 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirm(f.id, p)); }
  finally { process.env.PATH = oldPath; }
  const result = await jsonOK(response);
  assert.equal(result.status, "partial-state");
  assert.equal(result.mergeOid, p.plan.mergeOid);
  const stored = await history(p.actionId);
  assert.equal(stored.record.state, "recovery-required");
  assert.equal(stored.record.outcome.status, "partial-state");
  assert.equal(stored.record.outcome.mergeOid, result.mergeOid);
  assert.equal(stored.record.outcome.recoveryPath, undefined);
  assert.equal(stored.record.outcome.reason, undefined);
  assert.equal(stored.record.outcome.tree, undefined); // not evidence that this tree was installed
  assert.equal(stored.record.intended.tree, p.plan.review.mergeTreeOid);
  assert.doesNotMatch(JSON.stringify(stored), /secret git stderr/);
  assert.equal(await readFile(join(f.target, "note"), "utf8"), "feature\n");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
});

test("beforeApply journal failure prevents checkout mutation even after native preflight succeeds", async (t) => {
  const f = await fixture(t);
  const p = await proposal(f);
  let injected = false;
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionId === p.actionId && actionRecord(actionId).state === "executing" && !injected) {
      injected = true;
      writeFileSync(actionFile(actionId, "candidate.json"), "invalidated before intended write");
    }
  });
  try { assert.equal((await post(confirm(f.id, p))).status, 409); }
  finally { off(); }
  assert.equal(injected, true);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
  assert.equal(await readFile(join(f.target, "note"), "utf8"), "base\n");
  assert.equal(await git(f.target, "status", "--porcelain"), "");
});

test("successful check retains its actual receipt if final history recording fails", async (t) => {
  const f = await fixture(t);
  let action;
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionRecord(actionId).state === "executing") {
      action = actionId;
      writeFileSync(actionFile(actionId), "invalid outcome journal");
    }
  });
  let response;
  try { response = await post(op(f.id, "verify", { checkIndex: 0 })); }
  finally { off(); }
  const result = await jsonOK(response);
  assert.equal(result.actionId, action);
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.outcome.status, "passed");
  assert.ok(result.receipt.id);
  assert.match(result.recoveryWarning, /do not repeat/i);
  assert.deepEqual((await jsonOK(await get(f.id))).receipts, [result.receipt]);
});

test("unknown post-apply exception reports intended facts and recovery, never stale/refresh guidance", async (t) => {
  const f = await fixture(t);
  const p = await proposal(f);
  const dir = await mkdtemp(join(tmpdir(), "pi-web-integration-unknown-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const wrapper = join(dir, "engine.ts");
  // Fault seam only: exercise the real engine/guards, then simulate loss of its return value.
  const nativePath = new URL("../../../../lib/git-integration.ts", import.meta.url).pathname;
  await writeFile(wrapper, `import { prepareIntegration, confirmIntegration as apply } from ${JSON.stringify(nativePath)};\nexport { prepareIntegration };\nexport async function confirmIntegration(...args) { await apply(...args); throw new Error("secret post-apply exception"); }\n`);
  const faultJiti = createJiti(import.meta.url, { alias: { "@/lib/git-integration": wrapper, "@": process.cwd() }, interopDefault: true, moduleCache: false });
  const { POST: faultPost } = await faultJiti.import("./route.ts");
  const response = await faultPost(new Request("http://localhost/api/git/integration", { method: "POST", body: JSON.stringify(confirm(f.id, p)) }));
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.intended.mergeOid, p.plan.mergeOid);
  assert.equal(result.outcome, undefined);
  assert.match(result.error, /uncertain execution result/);
  assert.match(result.recoveryWarning, /do not retry/);
  assert.doesNotMatch(JSON.stringify(result), /refresh|new proposal|secret post-apply/);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), result.intended.mergeOid);
  assert.equal((await history(p.actionId)).record.state, "recovery-required");
});
