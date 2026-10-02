import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const jiti = createJiti(import.meta.url);
const { superviseGitCheck, registerGitCheckReceiptEpoch, gitCheckReceiptEpochStatus, settleLiveGitCheck } = await jiti.import("./git-check-runner.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { inspectGitOperationAdmission: inspect, readUnresolvedGitCheckRecovery: read } = await jiti.import("./git-operation-admission.ts");
const sha = (value) => createHash("sha256").update(value).digest("hex");
function snapshot() {
  return { version: 2, ...Object.fromEntries(["checkoutPath", "checkoutIdentity", "resourceIdentity", "branch", "head", "tree",
    "index", "status", "refs", "policyDigest", "policyRevision", "recipeDigest", "checkDigest", "cwdIdentity", "environmentDigest", "stageDigest"]
    .map((key) => [key, sha(key)])) };
}
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-check-supervisor-")), cwd = join(root, "repo"), agentDir = join(root, "agent");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { stdio: "pipe" });
  git("init", "-q", "-b", "main", cwd);
  execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "base"]);
  mkdirSync(agentDir, { mode: 0o700 }); allowFileRoot(cwd);
  const selection = await selectGitProjectResources(cwd), before = snapshot(), fake = createTestContainmentBackend();
  const s = statSync(cwd, { bigint: true });
  before.cwdIdentity = sha(JSON.stringify({ cwd, device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }));
  const backend = { ...fake, async observe(...args) {
    const state = await fake.observe(...args);
    return { ...state, identity: `1:2:${state.unit.InvocationID}:${state.unit.ControlGroup}` };
  }, async originalEmpty() { return "pinned-populated-zero"; } };
  const options = { selection, before, agentDir, cwd, actionId: randomUUID(), unit: `pi-web-git-check-${randomUUID()}.service`,
    argv: [process.execPath, "-e", "process.exit(0)"], env: process.env, timeoutMs: 10000, backend,
    testRecoveryEvidence: true, revalidate: async () => before, assertCurrentSync: () => {}, captureAfter: async () => before };
  return { selection, before, agentDir, options };
}

test("generic supervisor only resolves a positive original-unit/equal-snapshot success", async (t) => {
  const f = await fixture(t), result = await superviseGitCheck(f.options);
  assert.match(result.logDigest, /^[a-f0-9]{64}$/); assert.equal(inspect(f.agentDir, f.selection.commonDir).reason, "clear");
  assert.throws(() => read(f.agentDir, f.selection.commonDir));
});

test("a historical epoch/plain settlement object cannot mint a new receipt capability", async (t) => {
  const f = await fixture(t), result = await superviseGitCheck(f.options), id = randomUUID();
  assert.throws(() => registerGitCheckReceiptEpoch(id, f.agentDir, f.selection.commonDir,
    { cohort: "same", snapshot: f.before, settlement: { kind: "live-check-settlement" } }), /live owned/);
  registerGitCheckReceiptEpoch(id, f.agentDir, f.selection.commonDir, { cohort: "same", snapshot: f.before, settlement: result.settlement });
  assert.equal(gitCheckReceiptEpochStatus(id), "current");
  assert.throws(() => registerGitCheckReceiptEpoch(randomUUID(), f.agentDir, f.selection.commonDir,
    { cohort: "same", snapshot: f.before, settlement: result.settlement }), /live owned/, "attestation is single-use");
  assert.throws(() => settleLiveGitCheck({ reservation: { assertOwned() {} }, result: { unit: f.options.unit, status: 0, containmentComplete: true,
    timedOut: false, overflow: false, log: Buffer.alloc(0) }, agentDir: f.agentDir, commonDir: f.selection.commonDir,
    before: f.before, after: f.before }), /live equal-snapshot/, "plain recorded successful unit result is not the actual live result");
});

test("last asynchronous revalidation cannot swallow abort and release a check", async (t) => {
  const f = await fixture(t), controller = new AbortController(); let captures = 0;
  await assert.rejects(superviseGitCheck({ ...f.options, signal: controller.signal,
    revalidate: async () => { if (++captures === 4) controller.abort(); return f.before; } }));
  assert.equal(captures, 4);
  const evidence = read(f.agentDir, f.selection.commonDir);
  assert.deepEqual(evidence.before, evidence.after); assert.equal(evidence.outcome.status, 0);
  assert.equal(evidence.cleanupProof.empty, true);
  assert.equal(inspect(f.agentDir, f.selection.commonDir).reason, "unresolved");
});

test("pre-intent drift refuses without quarantine; post-intent validation failure preserves the baseline", async (t) => {
  for (const boundary of [1, 2]) {
    const f = await fixture(t); let captures = 0;
    await assert.rejects(superviseGitCheck({ ...f.options, revalidate: async () => {
      if (++captures === boundary) throw new Error("revoked"); return f.before;
    } }));
    const status = inspect(f.agentDir, f.selection.commonDir);
    if (boundary === 1) assert.notEqual(status.reason, "unresolved");
    else {
      assert.equal(status.reason, "unresolved");
      assert.deepEqual(read(f.agentDir, f.selection.commonDir).before, f.before);
      assert.equal(read(f.agentDir, f.selection.commonDir).after, undefined);
    }
  }
});

test("unavailable post-state or private log publication retains the original cgroup intent", async (t) => {
  for (const damage of ["snapshot", "log"]) {
    const f = await fixture(t);
    await assert.rejects(superviseGitCheck({ ...f.options, captureAfter: async () => {
      if (damage === "snapshot") throw new Error("missing checkout");
      // A regular file at the log parent makes publication impossible; never undo it.
      writeFileSync(join(f.agentDir, "pi-web", "git-verification-logs"), "blocked");
      return f.before;
    } }));
    assert.equal(inspect(f.agentDir, f.selection.commonDir).reason, "unresolved");
    const evidence = read(f.agentDir, f.selection.commonDir);
    if (damage === "snapshot") assert.equal(evidence.cleanupProof, undefined);
    else assert.equal(evidence.cleanupProof.empty, true);
  }
});
