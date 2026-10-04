import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fstatSync, mkdtempSync, openSync, readFileSync, readdirSync, readSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const jiti = createJiti(import.meta.url);
const { runGitVerification: run, lookupGitVerificationReceipt: lookup, inspectGitVerificationReceipts: inspect,
  isGitVerificationRunning: isRunning, captureGitCheckRecoverySnapshot: snapshot, gitCheckRecoveryDigest,
  assertGitVerificationReceiptSourceCurrentSync: assertSource } = await jiti.import("./git-verification.ts");
const { createGitCheckCohort, retireGitCheckCohort, beginGitCheckAttempt,
  readGitCheckReceiptCohortMetadata: cohortMetadata } = await jiti.import("./git-check-runner.ts");
const { reviewGitBranches } = await jiti.import("./git-review.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { openGitDiagnosticStore } = await jiti.import("./git-diagnostic-retention.ts");
function readOutput(agentDir, id) {
  const opened = openGitDiagnosticStore(agentDir, { application: true }); assert.equal(opened.status, "stored");
  try { const output = opened.store.readCompletedLog(id); assert.equal(output.status, "stored"); return output.value.toString(); }
  finally { opened.store.close(); }
}
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
// Failure-only test evidence; never logs argv, environment, output or exception text.
function failureEvidence(t) {
  const evidence = { failed: false, phase: "run", events: [], count: 0 };
  const record = (method, value, threw = false, errorCode) => {
    const unit = value?.unit;
    evidence.events.push({ method, phase: evidence.phase, threw,
      ...(typeof errorCode === "string" && /^[A-Z_0-9]{1,48}$/.test(errorCode) ? { errorCode } : {}),
      ...(typeof value === "boolean" ? { value } : {}),
      ...(unit ? { populated: value.populated, launcherPlaced: value.launcherPlaced,
        active: unit.ActiveState, sub: unit.SubState, exit: unit.ExecMainStatus } : {}) });
    evidence.count++; if (evidence.events.length > 32) evidence.events.shift();
  };
  const wrap = (target) => new Proxy({ ...target }, { get(object, key) {
    const value = Reflect.get(object, key);
    if (typeof value !== "function") return value;
    return (...args) => {
      const done = (result) => { record(String(key), result); return key === "start" ? wrap(result) : result; };
      const failed = (error) => { record(String(key), undefined, true, error?.code); throw error; };
      try {
        const result = value.apply(object, args);
        return result && typeof result.then === "function" ? result.then(done, failed) : done(result);
      } catch (error) { return failed(error); }
    };
  } });
  const snapshot = () => evidence.files.map(file => {
    let fd;
    try {
      fd = openSync(join(evidence.home, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const s = fstatSync(fd), bytes = Buffer.alloc(64 * 1024);
      const length = s.isFile() ? readSync(fd, bytes, 0, bytes.length, 0) : 0;
      return { file, size: s.size, mode: s.mode, inode: s.ino, mtime: s.mtimeMs, ctime: s.ctimeMs,
        digest: createHash("sha256").update(bytes.subarray(0, length)).digest("hex"), truncated: s.size > length };
    } catch { return { file, unavailable: true }; }
    finally { if (fd !== undefined) closeSync(fd); }
  });
  return Object.assign(evidence, { backend: wrap,
    begin(home, files) { evidence.home = home; evidence.files = files; evidence.before = snapshot(); },
    preserve() {
      evidence.failed = true; // cleanup must retain the fixture even if diagnostics fail
      const file = join(evidence.home, "failure-evidence.json");
      let stored = false;
      try {
        const report = { phase: evidence.phase, count: evidence.count, events: evidence.events,
          measured: evidence.measured, before: evidence.before, after: snapshot() };
        const bytes = JSON.stringify(report, null, 2);
        writeFileSync(file, Buffer.byteLength(bytes) <= 16 * 1024 ? bytes : JSON.stringify({ phase: evidence.phase, truncated: true }),
          { mode: 0o600, flag: "wx" }); stored = true;
      } catch { /* never replace the original test failure */ }
      try {
        const last = evidence.events.findLast(row => row.active);
        t.diagnostic(`Retained failure fixture: ${evidence.home}; evidence=${stored ? file : "unavailable"}; phase=${evidence.phase}; protocolEvents=${evidence.count}; lastObservation=${JSON.stringify(last)}; exit=${evidence.measured?.exitStatus}; complete=${evidence.measured?.containmentComplete}; timedOut=${evidence.measured?.timedOut}`);
      } catch { /* diagnostic reporting must not replace the failure either */ }
    },
  });
}
const fixtureEnvironmentOwners = new WeakSet();
function fixture(t, evidence) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-verify-"));
  t.after(() => { if (!evidence?.failed) rmSync(home, { recursive: true, force: true }); });
  if (!fixtureEnvironmentOwners.has(t)) {
    fixtureEnvironmentOwners.add(t);
    const previous = new Map(["HOME", "XDG_CONFIG_HOME"].map(key => [key, process.env[key]]));
    t.after(() => { for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  }
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = join(home, "xdg");
  const target = join(home, "target"), feature = join(home, "feature"), agentDir = join(home, "agent");
  git(home, "init", "-q", "-b", "target", target); git(target, "config", "user.name", "Test"); git(target, "config", "user.email", "test@example.com");
  writeFileSync(join(target, "note"), "base\n"); git(target, "add", "note"); git(target, "commit", "-qm", "base");
  git(target, "worktree", "add", "-qb", "feature", feature); allowFileRoot(target); allowFileRoot(feature);
  writeFileSync(join(feature, "note"), "feature\n"); git(feature, "add", "note"); git(feature, "commit", "-qm", "feature");
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual",
    integration: { targetBranch: "target", method: "merge" }, checks: [{ label: "check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  const options = async (extra = {}) => ({ sessionId: "test-session", cwd: feature, agentDir, testContainmentBackend: createTestContainmentBackend(),
    review: await reviewGitBranches(feature, "feature", "target"), checkIndex: 0, getPolicy: () => policy, isTrusted: () => true, ...extra });
  return { home, target, feature, agentDir, policy, options };
}

for (const checkout of ["feature", "target"]) for (const change of ["chmod", "hidden-bytes"]) for (const boundary of ["registration", "fresh-use"])
  test(`paired physical ${checkout} ${change} at ${boundary} is not hidden by Git's stat cache`, async (t) => {
    const f = fixture(t), cwd = f[checkout], file = join(cwd, "note");
    git(cwd, "config", "core.fileMode", "false"); git(cwd, "config", "core.trustctime", "false"); git(cwd, "config", "core.checkStat", "minimal");
    const old = new Date(Date.now() - 120_000); utimesSync(file, old, old); git(cwd, "update-index", "--refresh");
    const initial = statSync(file), indexPath = git(cwd, "rev-parse", "--path-format=absolute", "--git-path", "index"), index = readFileSync(indexPath);
    let mutated = false;
    const mutate = () => {
      mutated = true;
      if (change === "chmod") chmodSync(file, initial.mode ^ 0o100);
      else { writeFileSync(file, checkout === "target" ? "evil\n" : "altered\n"); utimesSync(file, initial.atime, initial.mtime); }
      assert.equal(git(cwd, "status", "--porcelain=v1"), "", "repro must remain Git-clean"); assert.deepEqual(readFileSync(indexPath), index);
    };
    if (boundary === "registration") await assert.rejects(run(await f.options({ testBeforeReceiptRegistration: async () => mutate() })));
    else { const receipt = await run(await f.options()); assertSource(receipt.id); mutate(); assert.throws(() => assertSource(receipt.id)); }
    assert.equal(mutated, true, "must reach the intended mutation boundary");
  });

test("one saved argv yields a private bounded log and live paired receipt, not all-checks approval", async (t) => {
  const f = fixture(t); f.policy.checks.push({ label: "not run", argv: [process.execPath, "-e", "process.exit(9)"] });
  const receipt = await run(await f.options());
  assert.equal(receipt.exitStatus, 0); assert.equal(receipt.checkIndex, 0); assert.deepEqual(receipt.argv, f.policy.checks[0].argv);
  assert.equal(receipt.dependencyVersion, 2); assert.deepEqual(receipt.relevantRefs, ["refs/heads/feature", "refs/heads/target"]);
  assert.equal(lookup(receipt.id), receipt); assert.equal(lookup("unknown"), undefined);
  assert.deepEqual(inspect("test-session").filter(r => r.id === receipt.id), [receipt]);
  const log = join(f.agentDir, "git-diagnostics-v2", `${receipt.outputDiagnosticId}.log`);
  assert.equal(readOutput(f.agentDir, receipt.outputDiagnosticId), ""); assert.equal(statSync(log).mode & 0o777, 0o600);
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

test("successful explicit sibling checks keep prior receipts visible during their own actual execution", async (t) => {
  const evidence = failureEvidence(t), f = fixture(t, evidence);
  evidence.begin(f.home, ["target/.git/HEAD", "target/.git/index", "target/.git/refs/heads/target",
    "target/.git/refs/heads/feature", "target/.git/worktrees/feature/HEAD", "target/.git/worktrees/feature/index", "target/note", "feature/note"]);
  const options = async (extra = {}) => {
    const value = await f.options(extra);
    return { ...value, testContainmentBackend: evidence.backend(value.testContainmentBackend) };
  };
  try {
    f.policy.checks.push({ label: "second", argv: [process.execPath, "-e", "setTimeout(()=>{},150)"] });
    evidence.phase = "independent";
    const independent = await run(await options()), indexes = [0, 1], cohort = createGitCheckCohort(indexes);
    indexes[1] = 63; // neither private declaration nor returned metadata borrows this mutable array
    evidence.phase = "first-sibling";
    const first = await run(await options({ cohort })), base = createTestContainmentBackend(); let observed = false;
    const metadata = cohortMetadata(first.id);
    assert.deepEqual(metadata.checkIndexes, [0, 1]); assert.match(metadata.id, /^[a-f0-9-]{36}$/);
    assert.ok(Object.isFrozen(metadata)); assert.ok(Object.isFrozen(metadata.checkIndexes));
    assert.deepEqual(cohortMetadata(independent.id).checkIndexes, [0]); assert.notEqual(cohortMetadata(independent.id).id, metadata.id);
    assert.equal(cohortMetadata(metadata.id), undefined); assert.equal(cohortMetadata("unknown"), undefined);
    assert.equal(cohortMetadata({ ...first }), undefined);
    assert.throws(() => beginGitCheckAttempt(JSON.parse(JSON.stringify(metadata)), 0));
    evidence.phase = "second-sibling";
    const second = await run(await options({ cohort, checkIndex: 1, testContainmentBackend: { ...base, async observe(...args) {
      const observation = await base.observe(...args);
      if (observation.launcherPlaced) { observed = true; assert.equal(lookup(first.id), first); }
      return observation;
    } } }));
    evidence.phase = "receipt-assertions";
    assert.equal(observed, true); assert.equal(lookup(first.id), first); assert.equal(lookup(second.id), second);
    assert.deepEqual(cohortMetadata(second.id), metadata);
    retireGitCheckCohort(cohort); assert.equal(lookup(first.id), undefined); assert.equal(lookup(second.id), undefined);
    assert.equal(cohortMetadata(first.id), undefined); assert.equal(cohortMetadata(second.id), undefined);
    assert.equal(lookup(independent.id), independent); assert.ok(cohortMetadata(independent.id));
  } catch (error) { evidence.preserve(); throw error; }
});

test("original paired authority writer change-and-restore, unreadable and thenable revisions retire receipts", async (t) => {
  for (const change of ["writer", "unknown", "thenable"]) {
    const f = fixture(t); let revision = 1, unreadable = false;
    const receipt = await run(await f.options({ getPolicy: async () => f.policy, isTrusted: async () => true,
      readAuthorityRevisionSync: () => unreadable ? change === "thenable" ? Promise.resolve(`writer:${revision}`) : "" : `writer:${revision}` }));
    assert.equal(lookup(receipt.id), receipt);
    if (change === "writer") { revision++; f.policy.commits = "agent"; revision++; f.policy.commits = "manual"; } else unreadable = true;
    assert.equal(lookup(receipt.id), undefined); unreadable = false; assert.equal(lookup(receipt.id), undefined);
    assert.equal(inspect("test-session").some(r => r.id === receipt.id), false);
  }
});

test("last awaited trust cannot release after authority/environment/source revocation", async (t) => {
  for (const change of ["policy", "environment", "trust", "source"]) {
    const f = fixture(t), marker = join(f.home, "no-payload"), base = createTestContainmentBackend();
    f.policy.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    let placed = false, changed = false, revision = 0; const previous = process.env.CI_FENCE_TEST;
    try {
      await assert.rejects(run(await f.options({ readAuthorityRevisionSync: () => String(revision),
        testContainmentBackend: { ...base, async observe(...args) { const state = await base.observe(...args); if (state.launcherPlaced) placed = true; return state; } },
        isTrusted: async () => {
          if (placed && !changed) {
            await Promise.resolve(); changed = true;
            if (change === "policy" || change === "trust") revision++;
            if (change === "environment") process.env.CI_FENCE_TEST = "changed";
            if (change === "source") writeFileSync(join(f.feature, "note"), "changed\n");
          }
          return true;
        } })));
      assert.equal(changed, true); assert.equal(existsSync(marker), false);
    } finally { if (previous === undefined) delete process.env.CI_FENCE_TEST; else process.env.CI_FENCE_TEST = previous; }
  }
});

test("async authority without genuine synchronous revision refuses before payload", async (t) => {
  const f = fixture(t), marker = join(f.home, "no-payload");
  f.policy.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
  await assert.rejects(run(await f.options({ isTrusted: async () => true }))); assert.equal(existsSync(marker), false);
});

test("saved checks do not inherit server-only variables", async (t) => {
  const f = fixture(t), previous = Object.fromEntries(["PI_WEB_PASSWORD", "NEXT_RUNTIME", "PORT"].map(key => [key, process.env[key]]));
  Object.assign(process.env, { PI_WEB_PASSWORD: "test-only-password", NEXT_RUNTIME: "server", PORT: "30141" });
  try {
    f.policy.checks[0].argv = [process.execPath, "-e", "process.stdout.write(JSON.stringify([process.env['PI_WEB_'+'P'+'ASSWORD'],process.env.NEXT_RUNTIME,process.env.PORT,Boolean(process.env.PATH)]))"];
    const receipt = await run(await f.options());
    assert.deepEqual(JSON.parse(readOutput(f.agentDir, receipt.outputDiagnosticId)), [null, null, null, true]);
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("paired argv engine rejects extended recipes instead of ignoring cwd/env/stage", async (t) => {
  for (const extra of [{ cwd: "." }, { cwd: "checks" }, { env: {} }, { env: { CI: "1" } }, ...["commit", "integration", "handoff", "none"].map(requiredStage => ({ requiredStage }))]) {
    const f = fixture(t), marker = join(f.home, "must-not-run");
    f.policy.checks[0] = { label: "check", argv: [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`], ...extra };
    let probes = 0;
    await assert.rejects(run(await f.options({ testContainmentBackend: { ...createTestContainmentBackend(), absent: async () => { probes++; return true; } } })), /extended check recipe execution unsupported/);
    assert.equal(probes, 0); assert.equal(existsSync(marker), false); assert.equal(existsSync(f.agentDir), false); assert.equal(isRunning(f.feature), false);
  }
});

test("unsupported containment, stale reviews and dirty source/target refuse without effects", async (t) => {
  const f = fixture(t), options = await f.options();
  await assert.rejects(run({ ...options, testContainmentBackend: { ...createTestContainmentBackend(), absent: async () => false } }), /containment unavailable/);
  await assert.rejects(run({ ...options, review: { ...options.review, featureOid: "a".repeat(40) } }), /stale review/);
  for (const cwd of [f.feature, f.target]) { writeFileSync(join(cwd, "note"), "dirty"); await assert.rejects(run(options)); git(cwd, "restore", "note"); }
  assert.equal(existsSync(f.agentDir), false);
});

test("actual failure creates no pass and does not disclose output through public errors", async (t) => {
  const f = fixture(t), secret = "SENSITIVEVALUE987xyz";
  f.policy.checks[0].argv = [process.execPath, "-e", `process.stdout.write(${JSON.stringify(secret)});process.exit(1)`];
  await assert.rejects(run(await f.options()), error => !String(error).includes(secret));
  assert.equal(inspect("test-session").filter(r => r.cwd === f.feature).length, 0);
  const logs = readdirSync(join(f.agentDir, "git-diagnostics-v2")).filter(name => name.endsWith(".log")); assert.equal(logs.length, 1);
  assert.equal(readOutput(f.agentDir, logs[0].slice(0, -4)), secret);
});

test("paired snapshots depend only on feature/target refs and their physical state", async (t) => {
  const f = fixture(t), options = await f.options(), checkDigest = gitCheckRecoveryDigest(0, f.policy.checks[0].argv), policyDigest = "a".repeat(64);
  const before = await snapshot(f.feature, f.target, options.review, policyDigest, checkDigest), receipt = await run(options);
  assertSource(receipt.id);
  git(f.feature, "update-ref", "refs/heads/unrelated", "HEAD");
  assert.deepEqual(await snapshot(f.feature, f.target, options.review, policyDigest, checkDigest), before); assertSource(receipt.id);
  const index = readFileSync(join(f.target, ".git", "index"));
  git(f.target, "update-index", "--index-version", "4"); assert.throws(() => assertSource(receipt.id));
  writeFileSync(join(f.target, ".git", "index"), index); assertSource(receipt.id);
  writeFileSync(join(f.target, "note"), "changed target"); assert.throws(() => assertSource(receipt.id));
  assert.notDeepEqual(await snapshot(f.feature, f.target, options.review, policyDigest, checkDigest), before);
});

test("failure in one explicit paired batch retires only its members, independent previous batch survives", async (t) => {
  const f = fixture(t); f.policy.checks.push({ label: "failure", argv: [process.execPath, "-e", "process.exit(1)"] });
  const prior = await run(await f.options()), cohort = createGitCheckCohort([0, 1]), own = await run(await f.options({ cohort }));
  await assert.rejects(run(await f.options({ cohort, checkIndex: 1 })));
  assert.equal(lookup(own.id), undefined); assert.equal(lookup(prior.id), prior);
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
});
