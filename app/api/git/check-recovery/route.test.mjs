import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-web-check-recovery-route-"));
const agentDir = join(home, "agent");
await mkdir(agentDir, { mode: 0o700 });
const keys = ["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
// Only this node:test import replaces the engine's OS backend. The recovery
// route itself always uses the real systemctl query and rejects simulated proof.
const shim = join(home, "fake-verification.ts");
const verification = new URL("../../../../lib/git-verification.ts", import.meta.url).pathname;
const fake = new URL("../../../../lib/git-check-containment-test-backend.mjs", import.meta.url).pathname;
await writeFile(shim, `import { runGitVerification as run } from ${JSON.stringify(verification)};
import { createTestContainmentBackend } from ${JSON.stringify(fake)};
export * from ${JSON.stringify(verification)};
const base = createTestContainmentBackend();
const backend = { ...base, async observe(...args) {
  const observation = await base.observe(...args);
  return { ...observation, identity: \`1:2:\${observation.unit.InvocationID}:\${observation.unit.ControlGroup}\` };
}, async originalEmpty() { return "pinned-populated-zero"; } };
export const runGitVerification = (options: Parameters<typeof run>[0]) =>
  run({ ...options, testContainmentBackend: backend, testRecoveryEvidence: true });
`);
const jiti = createJiti(import.meta.url, { alias: { "@/lib/git-verification": shim, "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { POST: verify } = await jiti.import("../integration/route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { appendSessionGitWorkflow, validateGitWorkflowPolicy } = await jiti.import("../../../../lib/git-workflow-policy.ts");
const { inspectGitOperationAdmission, readUnresolvedGitCheckRecovery } = await jiti.import("../../../../lib/git-operation-admission.ts");
const { selectGitProjectResources } = await jiti.import("../../../../lib/git-project-resources.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("../../../../lib/git-workflow-settings-store.ts");
const { beginGitAction, gitActionSink, snapshotGitActionCandidate } = await jiti.import("../../../../lib/git-action-controller.ts");
const { runGitVerification } = await jiti.import("../../../../lib/git-verification.ts");
const { createTestContainmentBackend } = await import("../../../../lib/git-check-containment-test-backend.mjs");
const { reviewGitBranches } = await jiti.import("../../../../lib/git-review.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout.trim();
const get = (id) => GET(new Request(`http://localhost/api/git/check-recovery?sessionId=${encodeURIComponent(id)}`));
const post = (body) => POST(new Request("http://localhost/api/git/check-recovery", { method: "POST", body: JSON.stringify(body) }));
const admission = async (f) => inspectGitOperationAdmission(agentDir, (await selectGitProjectResources(f.feature)).commonDir);
after(async () => {
  const pending = globalThis[Symbol.for("pi-web:git-check-recovery:reviews")];
  pending?.clear();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
});
async function fixture(t, script = "process.stderr.write('PRIVATE CHECK OUTPUT'); process.exit(7)") {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-check-recovery-repo-"));
  const target = join(dir, "target"), feature = join(dir, "feature");
  await exec("git", ["init", "-qb", "target", target]);
  await git(target, "config", "user.name", "Tester");
  await git(target, "config", "user.email", "tester@example.invalid");
  await writeFile(join(target, "note"), "base\n");
  await git(target, "add", "note"); await git(target, "commit", "-qm", "base");
  await git(target, "worktree", "add", "-qb", "feature", feature);
  await writeFile(join(feature, "note"), "feature\n");
  await git(feature, "add", "note"); await git(feature, "commit", "-qm", "feature");
  const sm = SessionManager.create(feature);
  sm.appendMessage({ role: "user", content: "review", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "target", method: "merge" }, checks: [{ label: "Private check", argv: [process.execPath, "-e", script] }] };
  appendSessionGitWorkflow(sm, policy);
  const id = sm.getSessionId();
  cacheSessionPath(id, sm.getSessionFile());
  allowFileRoot(feature); allowFileRoot(target);
  t.after(async () => {
    invalidateSessionPathCache(id); invalidateSessionListCache();
    await rm(dir, { recursive: true, force: true });
  });
  return { id, sm, target, feature, policy };
}
async function failCheck(f) {
  const result = await verify(new Request("http://localhost/api/git/integration", {
    method: "POST", body: JSON.stringify({ sessionId: f.id, operation: "verify", checkIndex: 0 }),
  }));
  assert.equal(result.status, 409, await result.clone().text());
  const body = await result.json();
  assert.match(body.actionId, /^[a-f0-9-]{36}$/);
  return body;
}

test("invalid, oversized, absent, and unreviewed confirmations never settle admission", async (t) => {
  const f = await fixture(t);
  assert.equal((await GET(new Request("http://localhost/api/git/check-recovery?sessionId=../bad"))).status, 400);
  assert.equal((await get("absent")).status, 200);
  assert.equal((await (await get("absent")).json()).eligible, false);
  assert.equal((await post({ sessionId: f.id, actionId: "not-an-id", revision: 1, acknowledged: true })).status, 400);
  const { actionId } = await failCheck(f);
  assert.equal((await post({ sessionId: f.id, actionId, revision: randomUUID(), acknowledged: true })).status, 409);
  assert.equal((await post({ sessionId: f.id, actionId, revision: randomUUID(), acknowledged: true, cwd: f.feature })).status, 400);
  assert.equal((await POST(new Request("http://localhost/api/git/check-recovery", { method: "POST", body: "x".repeat(5000) }))).status, 400);
  assert.equal((await admission(f)).reason, "unresolved");
});

test("simulated containment proof cannot be promoted into Linux recovery, even on paused/Off workflows", async (t) => {
  const f = await fixture(t);
  const { actionId } = await failCheck(f);
  const selected = await selectGitProjectResources(f.feature);
  const evidence = readUnresolvedGitCheckRecovery(agentDir, selected.commonDir);
  assert.equal(evidence.actionId, actionId);
  assert.equal(evidence.source, "node-test-simulated");
  assert.equal(evidence.cleanupProof.empty, true);
  const response = await get(f.id);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.eligible, false);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE CHECK OUTPUT|process\.stderr|node-test-simulated|argv/);
  writeGitWorkflowSettingsDocument({ version: 1, paused: true, global: { enabled: false }, projects: {} }, agentDir);
  assert.equal((await get(f.id)).status, 200, "GET inspection works while paused/Off");
  assert.equal((await (await get(f.id)).json()).eligible, false);
  assert.equal((await post({ sessionId: f.id, actionId, revision: randomUUID(), acknowledged: true })).status, 409);
  assert.equal((await admission(f)).reason, "unresolved");
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: {} }, agentDir);
});

test("missing, corrupted or stale evidence remains quarantined; no rollback or Git write", async (t) => {
  const f = await fixture(t);
  await failCheck(f);
  const selection = await selectGitProjectResources(f.feature);
  const evidence = readUnresolvedGitCheckRecovery(agentDir, selection.commonDir);
  const folder = join(agentDir, "pi-web/git-operation-admission/v1", createHash("sha256").update(selection.commonDir).digest("hex"));
  const postFile = join(folder, `${evidence.id}.post`);
  const original = readFileSync(postFile);
  await rm(postFile);
  assert.equal((await (await get(f.id)).json()).eligible, false);
  assert.equal((await admission(f)).reason, "unresolved", "missing recovery proof fails closed");
  writeFileSync(postFile, original.toString().replace("node-test-simulated", "linux-systemd"), { mode: 0o600 });
  assert.equal((await (await get(f.id)).json()).eligible, false);
  assert.equal((await admission(f)).reason, "unavailable");
  writeFileSync(postFile, original);
  await writeFile(join(f.feature, "untracked"), "changed\n");
  assert.equal((await (await get(f.id)).json()).eligible, false);
  const restored = await admission(f);
  assert.equal(restored.reason, "unresolved", "restoring valid proof bytes does not release quarantine");
  assert.equal(restored.admitted, false);
  assert.equal(existsSync(join(f.feature, "untracked")), true);
});

test("agent multi-check action in another registered feature worktree remains quarantined with simulated proof", async (t) => {
  const f = await fixture(t);
  const chat = SessionManager.create(f.target);
  chat.appendMessage({ role: "user", content: "check the feature", timestamp: Date.now() });
  chat.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  f.policy.checks.unshift({ label: "Earlier check", argv: [process.execPath, "-e", "process.exit(0)"] });
  appendSessionGitWorkflow(chat, f.policy);
  const sessionId = chat.getSessionId();
  cacheSessionPath(sessionId, chat.getSessionFile());
  t.after(() => invalidateSessionPathCache(sessionId));
  const sink = gitActionSink(chat, (type, data) => chat.appendCustomEntry(type, data));
  const action = await beginGitAction(sink, "agent", snapshotGitActionCandidate({
    kind: "checks", featureCwd: f.feature, targetCwd: f.target, featureBranch: "feature", targetBranch: "target", checks: f.policy.checks,
  }));
  try {
    await action.update("awaiting-decision");
    await action.update("executing", { decision: "approved" });
    const base = createTestContainmentBackend();
    const backend = { ...base, async observe(...args) {
      const observation = await base.observe(...args);
      return { ...observation, identity: `1:2:${observation.unit.InvocationID}:${observation.unit.ControlGroup}` };
    }, async originalEmpty() { return "pinned-populated-zero"; } };
    await assert.rejects(runGitVerification({ sessionId, cwd: f.feature, agentDir, review: await reviewGitBranches(f.feature, "feature", "target"),
      checkIndex: 1, actionId: action.record.id, getPolicy: () => f.policy, isTrusted: () => true,
      testContainmentBackend: backend, testRecoveryEvidence: true }), /check failed/);
    await action.update("failed", { reason: "Saved check failed" });
  } finally { action.release(); }
  const resource = await selectGitProjectResources(f.feature);
  const evidence = readUnresolvedGitCheckRecovery(agentDir, resource.commonDir);
  assert.equal(evidence.actionId, action.record.id);
  assert.equal(evidence.after.checkDigest.length, 64);
  const response = await get(sessionId);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).eligible, false, "fake cleanup never settles an agent check");
  assert.equal((await admission(f)).reason, "unresolved");
});

test("a stale/forged process-local review latch is consumed without clearing its check", async (t) => {
  const f = await fixture(t);
  const { actionId } = await failCheck(f);
  const selected = await selectGitProjectResources(f.feature);
  const evidence = readUnresolvedGitCheckRecovery(agentDir, selected.commonDir);
  const store = globalThis[Symbol.for("pi-web:git-check-recovery:reviews")] ??= new Map();
  const revision = randomUUID();
  const name = revision;
  store.set(name, { sessionId: f.id, sessionFile: f.sm.getSessionFile(), cwd: f.feature, featureCwd: f.feature, target: f.target,
    commonDir: selected.commonDir, id: evidence.id, actionId, actionRevision: 3, snapshot: "forged", invocation: "0".repeat(32),
    expiresAt: Date.now() + 60_000 });
  const request = { sessionId: f.id, actionId, revision, acknowledged: true };
  assert.equal((await post({ ...request, revision: 3 })).status, 400, "journal revision is not a review token");
  assert.equal((await post(request)).status, 409);
  assert.equal(store.has(name), false);
  assert.equal((await post(request)).status, 409);
  assert.equal((await admission(f)).reason, "unresolved");
});

// Opt-in only: requires a real Linux user manager, cgroup v2 and systemd >=256.
// No simulated backend or patched systemctl output may make recovery eligible.
test("real OS failed-check recovery invalidates old capabilities and settles once", { skip: process.platform !== "linux" || process.env.PI_WEB_TEST_REAL_SYSTEMD_RECOVERY !== "1" }, async (t) => {
  // Leave enough time for the manager/cgroup observation to pin the original
  // unit; an immediate failure before pre-release proof is intentionally unrecoverable.
  const f = await fixture(t, "setTimeout(() => process.exit(7), 600)");
  const { POST: realVerify } = await createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false }).import("../integration/route.ts");
  const result = await realVerify(new Request("http://localhost/api/git/integration", {
    method: "POST", body: JSON.stringify({ sessionId: f.id, operation: "verify", checkIndex: 0 }),
  }));
  assert.equal(result.status, 409);
  const { actionId } = await result.json();
  const selected = await selectGitProjectResources(f.feature);
  const evidence = readUnresolvedGitCheckRecovery(agentDir, selected.commonDir);
  assert.equal(evidence.source, "linux-systemd", "real check must record a validated OS post-check proof");
  assert.equal(evidence.cleanupProof?.empty, true);
  const sessions = globalThis.__piSessions;
  globalThis.__piSessions = new Map([...(sessions ?? []), ["another-active-chat", {
    cwd: f.target, sessionId: "another-active-chat", isAlive: () => true, isRunning: () => true,
  }]]);
  t.after(() => { globalThis.__piSessions = sessions; });
  const preview = await (await get(f.id)).json();
  assert.equal(preview.eligible, true, JSON.stringify(preview));
  assert.equal(preview.actionId, actionId);
  assert.match(preview.revision, /^[a-f0-9-]{36}$/);
  assert.deepEqual(preview.feature.status, []);
  const request = { sessionId: f.id, actionId, revision: preview.revision, acknowledged: true };
  assert.equal((await post(request)).status, 200);
  assert.equal((await admission(f)).reason, "clear");
  assert.equal((await post(request)).status, 409);
});

test("real OS agent check needs separate review after both refs move; stale or dirty reviews cannot release", {
  skip: process.platform !== "linux" || process.env.PI_WEB_TEST_REAL_SYSTEMD_RECOVERY !== "1",
}, async (t) => {
  const f = await fixture(t, "setTimeout(() => process.exit(7), 600)");
  const chat = SessionManager.create(f.target);
  chat.appendMessage({ role: "user", content: "check the feature", timestamp: Date.now() });
  chat.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  appendSessionGitWorkflow(chat, f.policy);
  const sessionId = chat.getSessionId();
  cacheSessionPath(sessionId, chat.getSessionFile());
  t.after(() => invalidateSessionPathCache(sessionId));
  const sink = gitActionSink(chat, (type, data) => chat.appendCustomEntry(type, data));
  const action = await beginGitAction(sink, "agent", snapshotGitActionCandidate({
    kind: "checks", featureCwd: f.feature, targetCwd: f.target,
    featureBranch: "feature", targetBranch: "target", checks: f.policy.checks,
  }));
  try {
    await action.update("awaiting-decision");
    await action.update("executing", { decision: "approved" });
    const { runGitVerification: realRun } = await createJiti(import.meta.url, {
      alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false,
    }).import("../../../../lib/git-verification.ts");
    const ephemeral = validateGitWorkflowPolicy({ mode: "current", onCreate: "stay", commits: "manual",
      integration: { targetBranch: "target", method: "merge" }, checks: f.policy.checks });
    await assert.rejects(realRun({ sessionId, cwd: f.feature, agentDir,
      review: await reviewGitBranches(f.feature, "feature", "target"), checkIndex: 0,
      actionId: action.record.id, getPolicy: () => ephemeral, isTrusted: () => true }), /check failed/);
    await action.update("failed", { reason: "Saved check failed" });
  } finally { action.release(); }
  const resource = await selectGitProjectResources(f.feature);
  const evidence = readUnresolvedGitCheckRecovery(agentDir, resource.commonDir);
  assert.equal(evidence.source, "linux-systemd");
  assert.deepEqual(evidence.before, evidence.after, "the check itself left Git unchanged");
  const originalFeature = await git(f.feature, "rev-parse", "HEAD");
  const originalTarget = await git(f.target, "rev-parse", "HEAD");
  await writeFile(join(f.feature, "feature-added"), "later feature work\n");
  await git(f.feature, "add", "feature-added"); await git(f.feature, "commit", "-qm", "later feature work");
  await writeFile(join(f.target, "target-added"), "later target work\n");
  await git(f.target, "add", "target-added"); await git(f.target, "commit", "-qm", "later target work");
  const marker = join(agentDir, "fsmonitor-invoked"), monitor = join(agentDir, "fsmonitor.sh");
  await writeFile(monitor, `#!/bin/sh\nprintf invoked > "${marker}"\n`);
  chmodSync(monitor, 0o700);
  await git(f.feature, "config", "core.fsmonitor", monitor);
  const preview = await (await get(sessionId)).json();
  assert.equal(existsSync(marker), false, "recovery inspection must never execute a project fsmonitor command");
  assert.equal(preview.eligible, true, JSON.stringify(preview));
  assert.equal(preview.mode, "moved");
  assert.equal(preview.original.featureHead, originalFeature);
  assert.equal(preview.original.targetHead, originalTarget);
  assert.equal(preview.original.featureHeadDigest, evidence.after.featureOid);
  assert.equal(preview.original.targetHeadDigest, evidence.after.targetOid);
  assert.equal(preview.feature.head, await git(f.feature, "rev-parse", "HEAD"));
  assert.equal(preview.target.head, await git(f.target, "rev-parse", "HEAD"));
  assert.deepEqual(preview.feature.status, []);
  const request = { sessionId, actionId: action.record.id, revision: preview.revision, acknowledged: true };
  assert.equal((await post(request)).status, 409, "unchanged-state approval cannot release a moved review");
  assert.equal((await admission(f)).reason, "unresolved");
  const next = await (await get(sessionId)).json();
  assert.equal(next.eligible, true);
  await writeFile(join(f.target, "unreviewed"), "not reviewed\n");
  assert.equal((await post({ ...request, revision: next.revision, reviewedMovement: true })).status, 409);
  assert.equal((await (await get(sessionId)).json()).eligible, false, "dirty drift remains quarantined");
  await git(f.target, "add", "unreviewed"); await git(f.target, "commit", "-qm", "reviewed later work");
  const final = await (await get(sessionId)).json();
  assert.equal(final.eligible, true, JSON.stringify(final));
  assert.equal(final.mode, "moved");
  assert.equal((await post({ ...request, revision: final.revision, reviewedMovement: true })).status, 200);
  assert.equal((await admission(f)).reason, "clear");
  assert.equal((await post({ ...request, revision: final.revision, reviewedMovement: true })).status, 409);
});
