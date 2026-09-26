import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const previous = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-integration-route-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { appendSessionGitWorkflow } = await jiti.import("../../../../lib/git-workflow-policy.ts");
const { getRpcSession } = await jiti.import("../../../../lib/rpc-manager.ts");
const { acquireGitCheckoutGate, isGitCheckoutGated } = await jiti.import("../../../../lib/git-checkout-gate.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout.trim();
const get = (id) => GET(new Request(`http://localhost/api/git/integration?sessionId=${encodeURIComponent(id)}`));
const post = (body) => POST(new Request("http://localhost/api/git/integration", { method: "POST", body: JSON.stringify(body) }));
const op = (id, operation, extra = {}) => ({ sessionId: id, operation, ...extra });
after(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  await rm(agentDir, { recursive: true, force: true });
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

test("saved check metadata and exact-session receipts, plan, and explicit confirmation", async (t) => {
  const f = await fixture(t);
  let result = await get(f.id);
  assert.equal(result.status, 200, await result.clone().text());
  assert.deepEqual((await result.json()).checks, [{ checkIndex: 0, label: "Test check" }]);
  assert.deepEqual((await (await get(f.id)).json()).receipts, []);
  result = await post(op(f.id, "verify", { checkIndex: 0 }));
  assert.equal(result.status, 200);
  const { receipt } = await result.json();
  assert.ok(receipt.id);
  assert.equal(JSON.stringify(receipt).includes("argv"), false);
  assert.deepEqual((await (await get(f.id)).json()).receipts, [receipt]);
  assert.equal((await post(op(f.id, "plan", { receiptIds: ["not-a-receipt"] }))).status, 409);
  result = await post(op(f.id, "plan", { receiptIds: [receipt.id] }));
  assert.equal(result.status, 200);
  const { plan } = await result.json();
  assert.equal((await post(op(f.id, "confirm", { planId: plan.planId, approvePlanId: "wrong" }))).status, 400);
  const other = await fixture(t);
  assert.equal((await post(op(other.id, "confirm", { planId: plan.planId, approvePlanId: plan.planId }))).status, 409);
  result = await post(op(f.id, "confirm", { planId: plan.planId, approvePlanId: plan.planId }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).status, "integrated");
  assert.equal(await git(f.target, "rev-parse", "HEAD"), plan.mergeOid);
  assert.equal((await get(f.id)).status, 409); // target is no longer on the feature's first-parent chain
});

test("refuses browser authority, missing policy, stale receipts, and disallowed checkout", async (t) => {
  const f = await fixture(t);
  for (const extra of [{ cwd: f.feature }, { argv: ["true"] }, { featureBranch: "feature" }, { targetBranch: "target" }]) {
    assert.equal((await post(op(f.id, "verify", { checkIndex: 0, ...extra }))).status, 400);
  }
  assert.equal((await post(op(f.id, "verify", { checkIndex: -1 }))).status, 400);
  assert.equal((await post(op(f.id, "plan", { receiptIds: Array(13).fill("id") }))).status, 400);
  assert.equal((await get("absent")).status, 404);
  const { receipt } = await (await post(op(f.id, "verify", { checkIndex: 0 }))).json();
  f.policy.checks[0].label = "changed";
  appendSessionGitWorkflow(f.sm, f.policy);
  assert.deepEqual((await (await get(f.id)).json()).receipts, []);
  assert.equal((await post(op(f.id, "plan", { receiptIds: [receipt.id] }))).status, 409);
  appendSessionGitWorkflow(f.sm, null);
  assert.equal((await get(f.id)).status, 409);
  const roots = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
  try { assert.equal((await get(f.id)).status, 403); }
  finally { globalThis.__piAllowedRootsCache = roots; }
});

test("an in-flight saved check gates both checkouts against a previously approved merge", async (t) => {
  const f = await fixture(t);
  f.policy.checks[0].argv = [process.execPath, "-e", "setTimeout(() => process.exit(0), 2000)"];
  appendSessionGitWorkflow(f.sm, f.policy);
  const { receipt } = await (await post(op(f.id, "verify", { checkIndex: 0 }))).json();
  const planned = await post(op(f.id, "plan", { receiptIds: [receipt.id] }));
  assert.equal(planned.status, 200);
  const { plan } = await planned.json();
  const checking = post(op(f.id, "verify", { checkIndex: 0 }));
  for (let i = 0; i < 100 && !isGitCheckoutGated(f.target); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(isGitCheckoutGated(f.target), true);
  assert.equal(isGitCheckoutGated(f.feature), true);
  assert.equal((await post(op(f.id, "confirm", { planId: plan.planId, approvePlanId: plan.planId }))).status, 409);
  assert.equal((await checking).status, 200);
  assert.equal((await post(op(f.id, "confirm", { planId: plan.planId, approvePlanId: plan.planId }))).status, 200);
});

test("busy source or target blocks confirmation without consuming approval", async (t) => {
  const f = await fixture(t);
  const { receipt } = await (await post(op(f.id, "verify", { checkIndex: 0 }))).json();
  const { plan } = await (await post(op(f.id, "plan", { receiptIds: [receipt.id] }))).json();
  const registry = globalThis.__piSessions;
  // hasBusyRpcSessionForCwd scans the live registry; a fixture wrapper is enough to exercise the guard.
  const busy = { cwd: f.target, isRunning: () => true, isAlive: () => true };
  globalThis.__piSessions = new Map([...(registry ?? []), ["busy-integration-fixture", busy]]);
  try { assert.equal((await post(op(f.id, "confirm", { planId: plan.planId, approvePlanId: plan.planId }))).status, 409); }
  finally { globalThis.__piSessions = registry; }
  assert.equal(getRpcSession("busy-integration-fixture"), undefined);
  const release = acquireGitCheckoutGate([f.target]);
  try { assert.equal((await post(op(f.id, "confirm", { planId: plan.planId, approvePlanId: plan.planId }))).status, 409); }
  finally { release(); }
  const confirmation = await post(op(f.id, "confirm", { planId: plan.planId, approvePlanId: plan.planId }));
  assert.equal(confirmation.status, 200);
  assert.equal(isGitCheckoutGated(f.target), false);
  assert.equal(isGitCheckoutGated(f.feature), false);
});
