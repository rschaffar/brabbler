import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createJiti } from "jiti";

const { newGitCheckUnit, runContainedGitCheck, __testRunContainedGitCheck, assertGitCheckContainmentAvailable } =
  await createJiti(import.meta.url).import("./git-check-containment.ts");
const unit = newGitCheckUnit();
const options = { cwd: "/tmp", argv: ["not-executed", "arg"], unit, timeoutMs: 200 };
process.env.NODE_ENV = "test";

function fake(sequence, { available = true, terminal = true, empty = false, output = [], onRelease,
  onObserve, stopError = false, releaseError = false } = {}) {
  const calls = { start: 0, stop: 0, release: 0, terminal: 0, originalEmpty: 0 };
  let original;
  let emit;
  const backend = {
    async absent() { return available; },
    start() {
      calls.start++;
      return { started: Promise.resolve(), evidenceDir: "/fake-private-output",
        output(fn) { emit = fn; for (const chunk of output) fn(Buffer.from(chunk)); },
        release(payload) {
          calls.release++;
          assert.deepEqual(JSON.parse(payload).argv, options.argv);
          onRelease?.(emit);
          if (releaseError) throw new Error("release may already have written");
        },
        closeInput() {}, dispose() {} };
    },
    async observe() {
      const observation = sequence.length ? sequence.shift() : completed();
      if (observation?.launcherPlaced && observation.populated && !original) original = observation;
      onObserve?.(observation);
      return observation;
    },
    async stop() { calls.stop++; if (stopError) throw new Error("stop failed"); },
    async terminal() { calls.terminal++; return terminal; },
    async originalEmpty(name, identity, invocation) {
      calls.originalEmpty++;
      // The fake can report a post-stop empty pin only if the launcher was
      // placed and the request names precisely that original observation.
      if (empty && name === unit && identity === original?.identity && invocation === original.unit.InvocationID)
        return "pinned-populated-zero";
    },
  };
  return { backend, calls };
}
function observed({ identity = "1:2:invocation:/unit", populated = true, launcherPlaced = true,
  state = "active", sub = "running", status = "0", pid = "42", invocation = "invocation" } = {}) {
  return { identity, populated, launcherPlaced, unit: { ActiveState: state, SubState: sub,
    MainPID: pid, Result: "success", ExecMainCode: "1", ExecMainStatus: status, InvocationID: invocation } };
}
function completed(patch = {}) { return observed({ populated: false, launcherPlaced: false, sub: "exited", pid: "0", ...patch }); }

test("refuses unavailable backend before any command or unit start", async () => {
  const f = fake([], { available: false });
  const r = await __testRunContainedGitCheck(options, f.backend);
  assert.equal(r.containmentComplete, false);
  assert.equal(r.status, null);
  assert.deepEqual(f.calls, { start: 0, stop: 0, release: 0, terminal: 0, originalEmpty: 0 });
});

test("polls a not-yet-registered service before proving placement", async () => {
  const f = fake([null, observed(), completed()]);
  const r = await __testRunContainedGitCheck(options, f.backend);
  assert.equal(r.containmentComplete, true);
  assert.equal(f.calls.release, 1);
});

test("never releases until live launcher placement and population are proven", async () => {
  const f = fake([observed({ launcherPlaced: false })]);
  const r = await __testRunContainedGitCheck(options, f.backend);
  assert.equal(r.containmentComplete, false);
  assert.equal(f.calls.release, 0);
  assert.equal(f.calls.stop, 1);
});

test("closed streams and successful main exit alone do not establish descendant completion", async () => {
  const f = fake([observed(), observed({ sub: "exited", pid: "0", launcherPlaced: false })]);
  const r = await __testRunContainedGitCheck({ ...options, timeoutMs: 24 }, f.backend);
  assert.equal(f.calls.release, 1);
  assert.equal(r.containmentComplete, false);
  assert.equal(r.timedOut, true);
  assert.equal(f.calls.stop, 1);
});

test("successful status requires same cgroup and manager invocation, empty population and terminal stop", async () => {
  const f = fake([observed(), completed()], { output: ["hello"] });
  const r = await __testRunContainedGitCheck(options, f.backend);
  assert.equal(r.status, 0);
  assert.equal(r.log.toString(), "hello");
  assert.equal(r.containmentComplete, true);
  assert.equal(r.cleanupProof, undefined); // fake made no post-stop empty observation
  assert.equal(f.calls.release, 1);
  assert.equal(f.calls.terminal, 1);
});

test("replaced cgroup is never accepted as empty, even with status zero", async () => {
  const f = fake([observed(), completed({ identity: "1:3:invocation:/unit" })]);
  const r = await __testRunContainedGitCheck(options, f.backend);
  assert.equal(r.containmentComplete, false);
  assert.equal(r.status, null);
  assert.equal(f.calls.stop, 1);
  assert.equal(r.cleanupProof, undefined);
});

test("manager restart or terminal-stop failure cannot prove completion", async () => {
  const restarted = fake([observed(), completed({ invocation: "another" })]);
  assert.equal((await __testRunContainedGitCheck(options, restarted.backend)).containmentComplete, false);
  const notStopped = fake([observed(), completed()], { terminal: false });
  assert.equal((await __testRunContainedGitCheck(options, notStopped.backend)).containmentComplete, false);
});

test("overflow, abort, and timeout bound execution and retain durable unit for recovery", async () => {
  const overflow = fake([observed()], { output: ["12345"] });
  const r = await __testRunContainedGitCheck({ ...options, maxLogBytes: 3 }, overflow.backend);
  assert.equal(r.log.toString(), "123");
  assert.equal(r.overflow, true);
  assert.equal(r.containmentComplete, false);
  assert.equal(overflow.calls.stop, 1);
  const ctrl = new AbortController();
  const aborted = fake([observed()], { onRelease: () => ctrl.abort() });
  const a = await __testRunContainedGitCheck({ ...options, signal: ctrl.signal }, aborted.backend);
  assert.equal(a.timedOut, true);
  assert.equal(a.containmentComplete, false);
  assert.equal(a.unit, unit);
});

test("failed check receives positive post-stop proof without becoming a successful check", async () => {
  const f = fake([observed(), observed({ state: "failed", sub: "failed", populated: true })], { empty: true });
  const r = await __testRunContainedGitCheck(options, f.backend);
  assert.equal(r.status, null);
  assert.equal(r.containmentComplete, false);
  assert.deepEqual(r.cleanupProof, { unit, cgroupIdentity: "1:2:invocation:/unit", invocation: "invocation",
    empty: true, emptyEvidence: "pinned-populated-zero", terminal: true, payload: "release-attempted" });
  assert.equal(f.calls.originalEmpty, 1);
  const nonzero = fake([observed(), completed({ status: "7" })], { empty: true });
  const n = await __testRunContainedGitCheck(options, nonzero.backend);
  assert.equal(n.status, 7);
  assert.equal(n.cleanupProof?.empty, true);
});

test("abort after release can prove cleanup only after original pin drains", async () => {
  const ctrl = new AbortController();
  const f = fake([observed()], { empty: true, onRelease: () => ctrl.abort() });
  const r = await __testRunContainedGitCheck({ ...options, signal: ctrl.signal }, f.backend);
  assert.equal(r.timedOut, true);
  assert.equal(r.containmentComplete, false);
  assert.equal(r.cleanupProof?.payload, "release-attempted");
  assert.equal(r.cleanupProof?.cgroupIdentity, "1:2:invocation:/unit");
});

test("timeout and output overflow can prove post-stop cleanup without proving check completion", async () => {
  const timeout = fake([observed(), observed({ sub: "exited", pid: "0", launcherPlaced: false })], { empty: true });
  const t = await __testRunContainedGitCheck({ ...options, timeoutMs: 24 }, timeout.backend);
  assert.equal(t.timedOut, true);
  assert.equal(t.containmentComplete, false);
  assert.equal(t.cleanupProof?.empty, true);
  const overflow = fake([observed()], { empty: true, onRelease: (emit) => emit(Buffer.from("overflow")) });
  const o = await __testRunContainedGitCheck({ ...options, maxLogBytes: 3 }, overflow.backend);
  assert.equal(o.overflow, true);
  assert.equal(o.containmentComplete, false);
  assert.equal(o.cleanupProof?.empty, true);
});

test("abort before gate write can prove cleanup only with original pin", async () => {
  const ctrl = new AbortController();
  const f = fake([observed()], { empty: true, onObserve: () => ctrl.abort() });
  const r = await __testRunContainedGitCheck({ ...options, signal: ctrl.signal }, f.backend);
  assert.equal(r.containmentComplete, false);
  assert.equal(f.calls.release, 0);
  assert.equal(r.cleanupProof?.payload, "prevented-before-write");
});

test("throwing release is attempted, never mislabeled prevented-before-write", async () => {
  const f = fake([observed()], { empty: true, releaseError: true });
  const r = await __testRunContainedGitCheck(options, f.backend);
  assert.equal(r.containmentComplete, false);
  assert.equal(r.cleanupProof?.payload, "release-attempted");
});

test("terminal stop alone, replacement observations, and absent pin never prove cleanup", async () => {
  const stillPopulated = fake([observed(), observed({ state: "failed", sub: "failed" })]);
  assert.equal((await __testRunContainedGitCheck(options, stillPopulated.backend)).cleanupProof, undefined);
  assert.equal(stillPopulated.calls.originalEmpty, 1);
  const ctrl = new AbortController();
  const noPin = fake([null], { empty: true, onObserve: () => ctrl.abort() });
  const missingPin = await __testRunContainedGitCheck({ ...options, signal: ctrl.signal }, noPin.backend);
  assert.equal(noPin.calls.stop, 1);
  assert.equal(missingPin.cleanupProof, undefined);
  assert.equal(missingPin.evidenceDir, "/fake-private-output"); // quarantine, not discard
  assert.equal(noPin.calls.originalEmpty, 0);
  const replaced = fake([observed(), completed({ identity: "new-cgroup" })], { empty: false });
  assert.equal((await __testRunContainedGitCheck(options, replaced.backend)).cleanupProof, undefined);
  const restarted = fake([observed(), completed({ invocation: "new-invocation" })], { empty: false });
  assert.equal((await __testRunContainedGitCheck(options, restarted.backend)).cleanupProof, undefined);
});

test("empty original without terminal manager stop or successful stop never proves cleanup", async () => {
  for (const overrides of [{ terminal: false }, { stopError: true }]) {
    const f = fake([observed(), completed()], { empty: true, ...overrides });
    const r = await __testRunContainedGitCheck(options, f.backend);
    assert.equal(r.cleanupProof, undefined);
    assert.equal(r.evidenceDir, "/fake-private-output");
    assert.equal(f.calls.originalEmpty, 0);
  }
});

test("invalid input never starts a service; preflight is non-launching", async () => {
  const f = fake([]);
  assert.equal((await __testRunContainedGitCheck({ ...options, unit: "other.service" }, f.backend)).containmentComplete, false);
  assert.equal(f.calls.start, 0);
  await assert.rejects(assertGitCheckContainmentAvailable("other.service"));
});

// Explicit opt-in only: this creates a disposable transient user unit. Never
// infer OS confinement from the protocol fake tests above.
test("Linux user manager: setsid + closed stdio descendant must drain", { skip: process.env.PI_WEB_TEST_CGROUP !== "1" }, async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "pi-web-cgroup-test-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const marker = join(temp, "descendant-finished");
  const realUnit = newGitCheckUnit();
  await assertGitCheckContainmentAvailable(realUnit);
  const writer = `setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'finished'), 450)`;
  const script = `const {spawn}=require('node:child_process'); spawn(process.execPath,['-e',${JSON.stringify(writer)},process.argv[1]],{detached:true,stdio:'ignore'}).unref();`;
  const r = await runContainedGitCheck({ cwd: temp, argv: [process.execPath, "-e", script, marker], unit: realUnit, timeoutMs: 8_000 });
  assert.equal(r.containmentComplete, true, `containment failed; inspect ${realUnit}; status=${r.status} timedOut=${r.timedOut} overflow=${r.overflow} logBytes=${r.log.length}`);
  assert.equal(r.status, 0);
  assert.equal(existsSync(marker), true, "a detached writer was still running after return");
});

test("Linux user manager: nonzero exit proves original pin empty despite systemd failed unit state",
  { skip: process.env.PI_WEB_TEST_CGROUP !== "1" }, async (t) => {
    const temp = mkdtempSync(join(tmpdir(), "pi-web-cgroup-failed-"));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const realUnit = newGitCheckUnit();
    await assertGitCheckContainmentAvailable(realUnit);
    const r = await runContainedGitCheck({ cwd: temp, argv: [process.execPath, "-e", "setTimeout(() => process.exit(7), 600)"], unit: realUnit, timeoutMs: 8_000 });
    assert.equal(r.status, 7, `inspect ${realUnit}; complete=${r.containmentComplete}; timedOut=${r.timedOut}`);
    assert.equal(r.cleanupProof?.empty, true, `inspect ${realUnit}; evidence=${r.evidenceDir}`);
    if (r.evidenceDir) rmSync(r.evidenceDir, { recursive: true, force: true });
  });

test("Linux user manager: abort stops a detached, closed-stdio descendant and proves original pin empty",
  { skip: process.env.PI_WEB_TEST_CGROUP !== "1" }, async (t) => {
    const temp = mkdtempSync(join(tmpdir(), "pi-web-cgroup-abort-"));
    t.after(() => rmSync(temp, { recursive: true, force: true }));
    const ready = join(temp, "spawned");
    const marker = join(temp, "escaped-writer");
    const realUnit = newGitCheckUnit();
    await assertGitCheckContainmentAvailable(realUnit);
    const writer = `setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'escaped'), 1800)`;
    const script = `const {spawn}=require('node:child_process'); const fs=require('node:fs');
      spawn(process.execPath,['-e',${JSON.stringify(writer)},process.argv[2]],{detached:true,stdio:'ignore'}).unref();
      fs.writeFileSync(process.argv[1],'ready'); setInterval(() => {}, 1000);`;
    const ctrl = new AbortController();
    const check = runContainedGitCheck({ cwd: temp, argv: [process.execPath, "-e", script, ready, marker],
      unit: realUnit, signal: ctrl.signal, timeoutMs: 8_000 });
    const start = Date.now();
    while (!existsSync(ready) && Date.now() - start < 5_000) await new Promise((resolve) => setTimeout(resolve, 30));
    const readySeen = existsSync(ready);
    ctrl.abort();
    const r = await check;
    assert.equal(readySeen, true, `launcher did not start; inspect ${realUnit}`);
    assert.equal(r.containmentComplete, false);
    assert.equal(r.timedOut, true);
    assert.deepEqual(r.cleanupProof && { unit: r.cleanupProof.unit, invocation: !!r.cleanupProof.invocation,
      identity: !!r.cleanupProof.cgroupIdentity, empty: r.cleanupProof.empty, terminal: r.cleanupProof.terminal,
      payload: r.cleanupProof.payload }, { unit: realUnit, invocation: true, identity: true, empty: true,
      terminal: true, payload: "release-attempted" }, `inspect ${realUnit}; evidence=${r.evidenceDir}`);
    assert.ok(["pinned-populated-zero", "verified-removed"].includes(r.cleanupProof.emptyEvidence));
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.equal(existsSync(marker), false, "detached descendant wrote after abort");
    if (r.evidenceDir) rmSync(r.evidenceDir, { recursive: true, force: true }); // proven only
  });

test("Linux user manager: private output is captured with a hard file-size limit", { skip: process.env.PI_WEB_TEST_CGROUP !== "1" }, async () => {
  const okUnit = newGitCheckUnit();
  await assertGitCheckContainmentAvailable(okUnit);
  const ok = await runContainedGitCheck({ cwd: "/tmp", argv: [process.execPath, "-e", "process.stdout.write('private-output')"],
    unit: okUnit, maxLogBytes: 4096, timeoutMs: 8_000 });
  assert.equal(ok.containmentComplete, true, `inspect ${okUnit}; status=${ok.status} timedOut=${ok.timedOut} overflow=${ok.overflow} bytes=${ok.log.length}`);
  assert.equal(ok.log.toString(), "private-output");
  assert.equal(ok.evidenceDir, undefined);

  const bigUnit = newGitCheckUnit();
  await assertGitCheckContainmentAvailable(bigUnit);
  const big = await runContainedGitCheck({ cwd: "/tmp", argv: [process.execPath, "-e", "process.stdout.write('x'.repeat(4096))"],
    unit: bigUnit, maxLogBytes: 128, timeoutMs: 8_000 });
  assert.equal(big.containmentComplete, false);
  assert.equal(big.overflow, true);
  assert.ok(big.log.length <= 128, `inspect ${bigUnit}`);
  // Failure evidence remains by default. The opt-in test removes its own
  // disposable output only after independently confirming manager termination.
  if (big.evidenceDir) {
    const state = execFileSync("systemctl", ["--user", "show", "--property=ActiveState", "--", bigUnit], { encoding: "utf8" });
    assert.match(state, /^ActiveState=inactive$/m);
    rmSync(big.evidenceDir, { recursive: true, force: true });
  }
});
