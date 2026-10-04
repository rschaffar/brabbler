import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const jiti = createJiti(import.meta.url);
const { superviseGitCheck, registerGitCheckReceiptEpoch, gitCheckReceiptEpochStatus,
  createGitCheckCohort, beginGitCheckAttempt, assertGitCheckSelectionSync, assertGitCheckReceiptBatchCurrent: assertBatch,
  retireGitCheckCohort } = await jiti.import("./git-check-runner.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const sha = (value) => createHash("sha256").update(value).digest("hex");
// Trusted supervisor-unit fixture only: leaf suites exercise actual policy and
// physical source snapshots. The protocol simulator runs/stops real children;
// it is NOT Linux cgroup proof and cannot account for escaped descendants.
function snapshot() {
  return { version: 2, dependencyVersion: 2, relevantRefs: ["refs/heads/main"],
    ...Object.fromEntries(["checkoutPath", "checkoutIdentity", "resourceIdentity", "branch", "head", "tree",
      "index", "status", "refs", "policyDigest", "policyRevision", "recipeDigest", "checkDigest", "cwdIdentity", "environmentDigest", "stageDigest"]
      .map((key) => [key, sha(key)])) };
}
async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-web-check-supervisor-")), cwd = join(root, "repo"), agentDir = join(root, "agent");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  execFileSync("git", ["-C", root, "init", "-q", "-b", "main", cwd], { stdio: "pipe" });
  execFileSync("git", ["-C", cwd, "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-qm", "base"]);
  mkdirSync(agentDir, { mode: 0o700 }); allowFileRoot(cwd);
  const selection = await selectGitProjectResources(cwd), before = snapshot(), s = statSync(cwd, { bigint: true });
  before.cwdIdentity = sha(JSON.stringify({ cwd, device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }));
  function attempt(extra = {}, indexes = [0]) {
    const cohort = createGitCheckCohort(indexes), base = createTestContainmentBackend();
    const observed = { starts: 0, releases: 0, stops: 0, disposals: [], execution: undefined, passing: undefined, outputDiagnosticId: undefined };
    const spool = join(root, `raw-${randomUUID()}`);
    const backend = { ...base, start(options) {
      observed.starts++; writeFileSync(spool, "", { mode: 0o600 });
      const transport = base.start(options);
      return { ...transport,
        release(payload) { observed.releases++; transport.release(payload); },
        output(callback) { transport.output(data => { appendFileSync(spool, data); callback(data); }); },
        dispose(terminal) { observed.disposals.push(terminal); transport.dispose(terminal); if (terminal) rmSync(spool); },
      };
    }, async stop(...args) { await base.stop(...args); observed.stops++; } };
    const options = { selection, before, agentDir, cwd, cohortBinding: "trusted-supervisor-fixture",
      attempt: beginGitCheckAttempt(cohort, indexes[0]), actionId: randomUUID(), unit: `pi-web-git-check-${randomUUID()}.service`,
      argv: [process.execPath, "-e", "process.exit(0)"], env: process.env, timeoutMs: 10000, backend,
      revalidate: async () => before, assertCurrentSync: () => assertGitCheckSelectionSync(selection), captureAfter: async () => before,
      onExecution: async (facts, id, passing, diagnostics, outputDiagnosticId) => {
        Object.assign(observed, { execution: facts, id, passing, diagnostics, outputDiagnosticId });
      }, ...extra };
    return { cohort, options, observed, spool, backend };
  }
  return { root, selection, before, agentDir, attempt };
}
function publish(f, invocation, result) {
  registerGitCheckReceiptEpoch(result.id, f.agentDir, f.selection.commonDir,
    { cohort: invocation.cohort, snapshot: f.before, settlement: result.settlement });
  assert.equal(gitCheckReceiptEpochStatus(result.id), "current");
  return result;
}
async function independent(f) {
  const invocation = f.attempt();
  return publish(f, invocation, await superviseGitCheck(invocation.options));
}
function assertRetired(invocation) {
  assert.throws(() => beginGitCheckAttempt(invocation.cohort, 1), /fresh original batch member/);
  if (invocation.observed.id) assert.equal(gitCheckReceiptEpochStatus(invocation.observed.id), "stale");
}

test("required batch uses authentic settled index associations, exact declarations and original handle identity", async (t) => {
  const f = await fixture(t);
  const member = async (cohort, index, register = true) => {
    const invocation = f.attempt(); invocation.cohort = cohort;
    invocation.options.attempt = beginGitCheckAttempt(cohort, index);
    const result = await superviseGitCheck(invocation.options);
    if (register) publish(f, invocation, result);
    return { invocation, result };
  };
  const cohort = createGitCheckCohort([0, 1]), first = await member(cohort, 0);
  assert.throws(() => assertBatch([first.result.id], [0]), /batch/);
  const second = await member(cohort, 1, false), ids = [first.result.id, second.result.id];
  assert.throws(() => assertBatch(ids, [0, 1]), /batch/, "settled but unpublished is insufficient");
  publish(f, second.invocation, second.result); assertBatch(ids, [0, 1]);
  for (const [values, indexes] of [[[], []], [ids, [0, 0]], [[ids[1], ids[0]], [0, 1]],
    [ids, [1, 0]], [[ids[0], ids[0]], [0, 1]], [[ids[0]], [0]], [[randomUUID(), ids[1]], [0, 1]]])
    assert.throws(() => assertBatch(values, indexes), /batch/);
  const independent0 = await member(createGitCheckCohort([0]), 0), independent1 = await member(createGitCheckCohort([1]), 1);
  assert.throws(() => assertBatch([independent0.result.id, independent1.result.id], [0, 1]), /batch/);
  for (const declared of [[1, 0], [0, 1, 2]]) {
    const other = createGitCheckCohort(declared), byIndex = new Map();
    for (const index of declared) byIndex.set(index, (await member(other, index)).result.id);
    assert.throws(() => assertBatch([byIndex.get(0), byIndex.get(1)], [0, 1]), /batch/);
  }
  assert.throws(() => createGitCheckCohort([0, 0]), /exact batch indexes/);
  assertBatch(ids, [0, 1]); // rejected partial/mixed/duplicate inputs did not retire the valid batch
  retireGitCheckCohort(cohort); assert.throws(() => assertBatch(ids, [0, 1]), /batch/);
  assertBatch([independent0.result.id], [0]); assertBatch([independent1.result.id], [1]);
});

test("next sibling entry waits for predecessor publication, not ready/running/settled native success", async (t) => {
  const f = await fixture(t), first = f.attempt({}, [0, 1]);
  assert.throws(() => beginGitCheckAttempt(first.cohort, 1), /fresh original batch member/, "ready predecessor is not fulfillment");
  const pending = superviseGitCheck(first.options);
  assert.throws(() => beginGitCheckAttempt(first.cohort, 1), /fresh original batch member/, "running predecessor is not fulfillment");
  const result = await pending;
  assert.equal(first.observed.execution.exitStatus, 0); assert.equal(first.observed.execution.containmentComplete, true);
  assert.throws(() => beginGitCheckAttempt(first.cohort, 1), /fresh original batch member/, "settled but unpublished is not fulfillment");
  publish(f, first, result);
  const second = f.attempt(); second.cohort = first.cohort;
  second.options.attempt = beginGitCheckAttempt(first.cohort, 1);
  assert.throws(() => beginGitCheckAttempt(first.cohort, 1), /fresh original batch member/);
  const next = publish(f, second, await superviseGitCheck(second.options));
  assertBatch([result.id, next.id], [0, 1]);
});

test("supervisor resolves only actual original-unit/equal-snapshot success and single-use receipt settlement", async (t) => {
  const f = await fixture(t), invocation = f.attempt(), result = await superviseGitCheck(invocation.options);
  assert.match(result.logDigest, /^[a-f0-9]{64}$/);
  assert.equal(invocation.observed.execution.exitStatus, 0); assert.equal(invocation.observed.execution.containmentComplete, true);
  assert.equal(invocation.observed.passing, true); assert.equal(invocation.observed.releases, 1); assert.equal(invocation.observed.stops, 1);
  assert.deepEqual(invocation.observed.disposals, [true]); assert.equal(existsSync(invocation.spool), false);
  assert.equal(await invocation.backend.absent(invocation.options.unit), true);
  assert.equal(gitCheckReceiptEpochStatus(result.id), "stale", "execution alone has not registered a receipt");
  assert.throws(() => registerGitCheckReceiptEpoch(result.id, f.agentDir, f.selection.commonDir,
    { cohort: invocation.cohort, snapshot: f.before, settlement: { ...result.settlement } }), /original live successful settlement/);
  publish(f, invocation, result);
  assert.throws(() => registerGitCheckReceiptEpoch(result.id, f.agentDir, f.selection.commonDir,
    { cohort: invocation.cohort, snapshot: f.before, settlement: result.settlement }), /original live successful settlement/);
  await assert.rejects(superviseGitCheck(invocation.options), /fresh original invocation/);
  assert.equal(gitCheckReceiptEpochStatus(result.id), "current", "attempt replay cannot retire its already published result");
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

test("settlement binds its original receipt ID; recorded/copy objects cannot mint or restore success", async (t) => {
  const f = await fixture(t), invocation = f.attempt(), result = await superviseGitCheck(invocation.options), foreignId = randomUUID();
  assert.throws(() => registerGitCheckReceiptEpoch(foreignId, f.agentDir, f.selection.commonDir,
    { cohort: invocation.cohort, snapshot: f.before, settlement: result.settlement }), /original live successful settlement/);
  assert.throws(() => publish(f, invocation, result), /original live successful settlement/, "even rejected use consumes the one-shot token");
  assert.equal(gitCheckReceiptEpochStatus(foreignId), "stale"); assert.equal(gitCheckReceiptEpochStatus(result.id), "stale");
  const independentResult = await independent(f); assert.equal(gitCheckReceiptEpochStatus(independentResult.id), "current");
});

test("copied and concurrently replayed attempt handles cannot launch a second child", async (t) => {
  const f = await fixture(t), invocation = f.attempt();
  await assert.rejects(superviseGitCheck({ ...invocation.options, attempt: { ...invocation.options.attempt } }), /fresh original invocation/);
  const first = superviseGitCheck(invocation.options);
  await assert.rejects(superviseGitCheck(invocation.options), /fresh original invocation/);
  publish(f, invocation, await first); assert.equal(invocation.observed.starts, 1); assert.equal(invocation.observed.releases, 1);
});

test("final asynchronous revalidation cannot swallow abort; measured completion is not a publishable receipt", async (t) => {
  const f = await fixture(t), priorB = await independent(f), controller = new AbortController(); let captures = 0;
  const invocation = f.attempt({ signal: controller.signal, revalidate: async () => {
    if (++captures === 3) controller.abort(); return f.before;
  } }, [0, 1]);
  await assert.rejects(superviseGitCheck(invocation.options)); assert.equal(captures, 3);
  assert.equal(invocation.observed.execution.exitStatus, 0); assert.equal(invocation.observed.execution.containmentComplete, true);
  assert.equal(invocation.observed.stops, 1); assert.equal(await invocation.backend.absent(invocation.options.unit), true);
  assertRetired(invocation); assert.equal(gitCheckReceiptEpochStatus(priorB.id), "current"); await independent(f);
});

for (const boundary of [1, 2]) test(`source/authority rejection at revalidation ${boundary} prevents payload and retires only its own batch`, async (t) => {
  const f = await fixture(t), priorB = await independent(f), marker = join(f.root, "must-not-run"); let captures = 0;
  const invocation = f.attempt({ argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`],
    revalidate: async () => { if (++captures === boundary) throw new Error("revoked"); return f.before; } }, [0, 1]);
  await assert.rejects(superviseGitCheck(invocation.options)); assert.equal(captures, boundary);
  assert.equal(invocation.observed.releases, 0); assert.equal(existsSync(marker), false);
  assert.equal(invocation.observed.starts, boundary - 1); assert.equal(invocation.observed.stops, boundary - 1);
  if (boundary === 2) {
    assert.equal(invocation.observed.execution.payload, "prevented-before-write");
    assert.equal(invocation.observed.execution.containmentComplete, false); assert.deepEqual(invocation.observed.disposals, [false]);
    assert.equal(await invocation.backend.absent(invocation.options.unit), true);
  }
  assertRetired(invocation); assert.equal(gitCheckReceiptEpochStatus(priorB.id), "current"); await independent(f);
});

test("unavailable post-state refuses receipt despite actual stopped success; independent B survives", async (t) => {
  const f = await fixture(t), priorB = await independent(f);
  const invocation = f.attempt({ captureAfter: async () => { throw new Error("missing checkout"); } }, [0, 1]);
  await assert.rejects(superviseGitCheck(invocation.options));
  assert.equal(invocation.observed.execution.exitStatus, 0); assert.equal(invocation.observed.execution.containmentComplete, true);
  assert.equal(invocation.observed.passing, false); assert.equal(invocation.observed.stops, 1);
  assertRetired(invocation); assert.equal(gitCheckReceiptEpochStatus(priorB.id), "current"); await independent(f);
});

test("private diagnostic storage failure cannot veto measured native success or delete the obstacle", async (t) => {
  const f = await fixture(t), blocked = join(f.agentDir, "git-diagnostics-v2"); writeFileSync(blocked, "unavailable storage");
  const invocation = f.attempt(), result = publish(f, invocation, await superviseGitCheck(invocation.options));
  assert.deepEqual(result.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  assert.equal(result.outputDiagnosticId, undefined); assert.equal(invocation.observed.execution.containmentComplete, true);
  assert.equal(readFileSync(blocked, "utf8"), "unavailable storage"); await independent(f);
});

test("nonzero process exit refuses only its own cohort; historical failure/pass JSON is inert and untouched", async (t) => {
  const f = await fixture(t), history = join(f.agentDir, "pi-web", "git-operation-admission", "v1");
  mkdirSync(history, { recursive: true });
  const historicalId = randomUUID(), failed = '{"unresolved":true,"owner":"foreign"}', passed = JSON.stringify({ id: historicalId,
    outcome: { status: 0, containmentComplete: true }, settlement: { kind: "live-check-settlement" }, snapshot: f.before });
  writeFileSync(join(history, "failed.json"), failed); writeFileSync(join(history, "passed.json"), passed);
  writeFileSync(join(history, "corrupt.json"), "{broken");
  const priorB = await independent(f), invocation = f.attempt({ argv: [process.execPath, "-e", "process.exit(7)"] }, [0, 1]);
  await assert.rejects(superviseGitCheck(invocation.options));
  assert.equal(invocation.observed.execution.exitStatus, 7); assert.equal(invocation.observed.execution.containmentComplete, true);
  assert.equal(invocation.observed.stops, 1); assertRetired(invocation);
  const restored = JSON.parse(readFileSync(join(history, "passed.json"), "utf8"));
  assert.throws(() => registerGitCheckReceiptEpoch(restored.id, f.agentDir, f.selection.commonDir,
    { cohort: invocation.cohort, snapshot: restored.snapshot, settlement: restored.settlement }), /original live successful settlement/);
  assert.equal(gitCheckReceiptEpochStatus(historicalId), "stale"); assert.equal(gitCheckReceiptEpochStatus(priorB.id), "current");
  await independent(f);
  assert.equal(readFileSync(join(history, "failed.json"), "utf8"), failed);
  assert.equal(readFileSync(join(history, "passed.json"), "utf8"), passed);
  assert.equal(readFileSync(join(history, "corrupt.json"), "utf8"), "{broken");
});

test("unknown terminal evidence refuses success and retains raw output without blocking later B", async (t) => {
  const f = await fixture(t), priorB = await independent(f), invocation = f.attempt({ argv: [process.execPath, "-e", "process.stdout.write('private stopped output')"] }, [0, 1]);
  invocation.options.backend = { ...invocation.backend, async terminal() { return false; } };
  await assert.rejects(superviseGitCheck(invocation.options));
  assert.equal(invocation.observed.execution.exitStatus, 0); assert.equal(invocation.observed.execution.containmentComplete, false);
  assert.equal(invocation.observed.stops, 1); assert.equal(await invocation.backend.absent(invocation.options.unit), true);
  assert.deepEqual(invocation.observed.disposals, [false]); assert.equal(readFileSync(invocation.spool, "utf8"), "private stopped output");
  assert.equal(invocation.observed.outputDiagnosticId, undefined, "uncertain output must not enter completed retention");
  assertRetired(invocation); assert.equal(gitCheckReceiptEpochStatus(priorB.id), "current"); await independent(f);
  assert.equal(readFileSync(invocation.spool, "utf8"), "private stopped output");
});

test("abort after real child startup stops that original process before refusal; no foreign cohort fence", async (t) => {
  const f = await fixture(t), priorB = await independent(f), controller = new AbortController(), pidFile = join(f.root, "child.pid");
  const invocation = f.attempt({ signal: controller.signal, argv: [process.execPath, "-e",
    `require('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`] }, [0, 1]);
  invocation.options.backend = { ...invocation.backend, async observe(...args) {
    const state = await invocation.backend.observe(...args);
    if (existsSync(pidFile)) controller.abort();
    return state;
  } };
  await assert.rejects(superviseGitCheck(invocation.options));
  const pid = Number(readFileSync(pidFile, "utf8")); assert.ok(Number.isSafeInteger(pid) && pid > 0);
  assert.throws(() => process.kill(pid, 0), error => error.code === "ESRCH", "the actual original child was stopped");
  assert.equal(invocation.observed.releases, 1); assert.equal(invocation.observed.stops, 1);
  assert.equal(invocation.observed.execution.containmentComplete, false); assert.deepEqual(invocation.observed.disposals, [false]);
  assertRetired(invocation); assert.equal(gitCheckReceiptEpochStatus(priorB.id), "current"); await independent(f);
});
