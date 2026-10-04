import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { prepareNativeRefTransaction: prepare, getNativeRefTransactionOutcome: outcome, getNativeRefTransactionReaped: reaped } = await jiti.import("./git-native-ref-transaction.ts");
const { gitExecEnv } = await jiti.import("./git-exec.ts");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t, format) {
  const root = await mkdtemp(join(tmpdir(), "pi-native-ref-"));
  const env = { ...gitExecEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid" };
  const git = (...args) => {
    const result = spawnSync("git", ["-C", root, "-c", "commit.gpgSign=false", ...args], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "-b", "main", ...(format ? [`--object-format=${format}`] : []));
  await writeFile(join(root, "file"), "original bytes\n");
  git("add", "file"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-qm", "next");
  const next = git("rev-parse", "HEAD");
  git("branch", "source", next); git("branch", "target", base); git("branch", "third", base);
  const gitDir = join(root, ".git");
  const dirs = await Promise.all([open(gitDir, "r"), open(root, "r")]);
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    await Promise.all(dirs.map((fd) => fd.close())); await rm(root, { recursive: true, force: true });
  });
  const pinned = (fd, fallback) => process.platform === "linux" ? `/proc/${process.pid}/fd/${fd.fd}` : fallback;
  let authorized = true;
  const request = { gitDir: pinned(dirs[0], gitDir), commonDir: pinned(dirs[0], gitDir), workTree: pinned(dirs[1], root),
    sourceBranch: "refs/heads/source", targetBranch: "refs/heads/target", expectedSourceOid: next,
    expectedTargetOid: base, updateOid: next, assertAuthoritySync() { if (!authorized) throw new Error("owner authority revoked"); } };
  return { root, gitDir, git, base, next, request, cleanup(fn) { cleanups.push(fn); }, revoke() { authorized = false; } };
}

async function rejected(promise, pattern) {
  try { await promise; assert.fail("Expected rejection"); }
  catch (error) { if (pattern) assert.match(error.message, pattern); return error; }
}

async function noLocks(f) {
  for (const branch of ["source", "target"]) {
    await assert.rejects(stat(join(f.gitDir, "refs/heads", `${branch}.lock`)), { code: "ENOENT" });
  }
}

test("prepare holds real source/target locks before mutation; commit changes only target; identity and single use", async (t) => {
  const f = await fixture(t);
  const index = await readFile(join(f.gitDir, "index"));
  const h = await prepare(f.request);
  for (const ref of ["source", "target"]) assert.ok((await stat(join(f.gitDir, "refs/heads", `${ref}.lock`))).isFile());
  assert.equal(f.git("rev-parse", "target"), f.base);
  assert.deepEqual(outcome(h), { preparationAcknowledged: true, commitSent: false, commitAcknowledged: false,
    abortAcknowledged: false, childReaped: false, observedSourceOid: f.next, observedTargetOid: f.base });
  assert.equal(outcome({ ...h }), undefined);
  const notification = reaped(h);
  assert.ok(notification instanceof Promise);
  let hasReaped = false; void notification.then(() => { hasReaped = true; });
  await Promise.resolve(); assert.equal(hasReaped, false);
  for (const copy of [{ ...h }, Object.create(h), { childReaped: true }, true, new Error("forged")]) assert.equal(reaped(copy), undefined);
  await assert.rejects(({ ...h }).commit(), /Original/);
  await assert.rejects(h.commit.call(Object.create(h)), /Original/);
  await assert.rejects(h.commit.call({ commitAcknowledged: true }), /Original/);
  const done = h.commit();
  await assert.rejects(h.commit(), /consumed/);
  await assert.rejects(h.abort(), /consumed/);
  const result = await done;
  await notification; assert.equal(hasReaped, true);
  assert.equal(result.commitSent, true); assert.equal(result.commitAcknowledged, true); assert.equal(result.childReaped, true);
  assert.ok(Object.isFrozen(result)); assert.equal(outcome({ ...result }), undefined);
  assert.equal(f.git("rev-parse", "target"), f.next); assert.equal(f.git("rev-parse", "source"), f.next);
  assert.equal(await readFile(join(f.root, "file"), "utf8"), "original bytes\n");
  assert.deepEqual(await readFile(join(f.gitDir, "index")), index);
  await noLocks(f);
});

test("prepared locks reject real overlapping writers but allow an unrelated native write", async (t) => {
  const f = await fixture(t), h = await prepare(f.request);
  try {
    for (const [ref, value] of [["source", f.base], ["target", f.next]]) {
      const writer = spawnSync("git", ["-C", f.root, "update-ref", `refs/heads/${ref}`, value], { env: gitExecEnv(), encoding: "utf8" });
      assert.notEqual(writer.status, 0); assert.match(writer.stderr, /cannot lock ref/);
    }
    f.git("update-ref", "refs/heads/third", f.next);
    assert.equal(f.git("rev-parse", "third"), f.next);
    assert.equal(f.git("rev-parse", "source"), f.next); assert.equal(f.git("rev-parse", "target"), f.base);
  } finally { await h.abort(); }
  await noLocks(f);
});

test("abort is single-use and needs no fresh authority", async (t) => {
  const f = await fixture(t), h = await prepare(f.request);
  f.revoke();
  const result = await h.abort();
  assert.equal(result.abortAcknowledged, true); assert.equal(result.commitSent, false); assert.equal(result.childReaped, true);
  assert.equal(f.git("rev-parse", "target"), f.base);
  await assert.rejects(h.abort(), /consumed/); await noLocks(f);
});

for (const field of ["expectedSourceOid", "expectedTargetOid"]) {
  test(`stale ${field} rejects without ref effects`, async (t) => {
    const f = await fixture(t);
    const error = await rejected(prepare({ ...f.request, [field]: field === "expectedSourceOid" ? f.base : f.next }));
    assert.equal(outcome(error).preparationAcknowledged, false); assert.equal(outcome(error).commitSent, false);
    assert.equal(outcome(error).childReaped, true); assert.equal(outcome({ ...error }), undefined);
    assert.equal(f.git("rev-parse", "target"), f.base); await noLocks(f);
  });
}

for (const branch of ["source", "target"]) {
  test(`symbolic ${branch} with same resolved OID cannot commit or move third branch`, async (t) => {
    const f = await fixture(t);
    f.git("update-ref", "refs/heads/third", branch === "source" ? f.next : f.base);
    f.git("symbolic-ref", `refs/heads/${branch}`, "refs/heads/third");
    const error = await rejected(prepare(f.request));
    assert.equal(outcome(error).commitSent, false); assert.equal(outcome(error).childReaped, true);
    // In particular, Git accepts the same-OID symbolic target at prepare on
    // supported versions; the post-prepare binding inspection must reject it.
    if (branch === "target") assert.equal(outcome(error).preparationAcknowledged, true);
    assert.equal(f.git("symbolic-ref", `refs/heads/${branch}`), "refs/heads/third");
    assert.equal(f.git("rev-parse", "third"), branch === "source" ? f.next : f.base);
    assert.equal(f.git("rev-parse", "target"), f.base); await noLocks(f);
  });
}

test("foreign native lock is neither removed nor overwritten", async (t) => {
  const f = await fixture(t), lock = join(f.gitDir, "refs/heads/target.lock");
  await writeFile(lock, "foreign lock\n");
  const error = await rejected(prepare(f.request));
  assert.equal(outcome(error).commitSent, false); assert.equal(outcome(error).childReaped, true);
  assert.equal(await readFile(lock, "utf8"), "foreign lock\n");
  assert.equal(f.git("rev-parse", "target"), f.base);
});

test("rejects bounded-input violations before invoking owner's guard", async (t) => {
  const f = await fixture(t);
  let calls = 0;
  const invalid = [ { gitDir: "relative" }, { commonDir: "/x\nprepare" }, { workTree: `/${"x".repeat(4096)}` },
    { sourceBranch: "HEAD" }, { targetBranch: f.request.sourceBranch }, { targetBranch: "refs/heads/a\ncommit" },
    { targetBranch: "refs/heads/a.lock/b" }, { targetBranch: "refs/heads/a..b" }, { targetBranch: "refs/heads/a@{b" },
    { targetBranch: "refs/heads/.a" }, { targetBranch: "refs/heads/a\\b" }, { targetBranch: "refs/heads/a/" },
    { expectedSourceOid: "0".repeat(40) }, { updateOid: f.next.slice(0, 12) }, { expectedTargetOid: "a".repeat(64) },
    { timeoutMs: 0 }, { timeoutMs: 30_001 }, { timeoutMs: NaN }, { assertAuthoritySync: undefined },
    { assertAuthoritySync: async () => { throw new Error("must not invoke async guard"); } } ];
  for (const patch of invalid) await assert.rejects(prepare({ ...f.request, assertAuthoritySync() { calls++; }, ...patch }));
  assert.equal(calls, 0); assert.equal(f.git("rev-parse", "target"), f.base); await noLocks(f);
});

test("owner guard revoked before spawn or before commit prevents effects; original guard is captured", async (t) => {
  const f = await fixture(t);
  f.revoke(); const error = await rejected(prepare(f.request), /revoked/);
  assert.equal(outcome(error).preparationAcknowledged, false); assert.equal(outcome(error).childReaped, true);
  const second = await fixture(t), h = await prepare(second.request);
  second.revoke(); second.request.assertAuthoritySync = () => { throw new Error("replacement must not run"); };
  const commitError = await rejected(h.commit(), /revoked/);
  assert.equal(outcome(commitError).preparationAcknowledged, true); assert.equal(outcome(commitError).commitSent, false);
  assert.equal(outcome(commitError).childReaped, true); assert.equal(second.git("rev-parse", "target"), second.base);
  await noLocks(second);
});

test("prepare send repeats original authority/deadline fence after spawn and before native effects", async (t) => {
  for (const mode of ["revoked", "thenable", "deadline", "cancelled"]) {
    const f = await fixture(t), cancel = new AbortController();
    let calls = 0;
    const error = await rejected(prepare({ ...f.request, timeoutMs: 400, signal: cancel.signal, assertAuthoritySync() {
      f.request.assertAuthoritySync();
      if (++calls !== 2) return;
      if (mode === "revoked") { f.revoke(); f.request.assertAuthoritySync(); }
      if (mode === "thenable") return Promise.reject(new Error("not authority"));
      if (mode === "cancelled") cancel.abort();
      if (mode === "deadline") {
        const until = performance.now() + 450;
        while (performance.now() < until) { /* Hold back timer dispatch at send fence. */ }
      }
    } }), mode === "thenable" ? /synchronous void/ : new RegExp(mode));
    assert.equal(calls, 2); assert.equal(outcome(error).preparationAcknowledged, false);
    assert.equal(outcome(error).commitSent, false); assert.equal(outcome(error).childReaped, true);
    assert.ok(reaped(error) instanceof Promise); await reaped(error);
    assert.equal(reaped({ ...error }), undefined);
    assert.equal(f.git("rev-parse", "target"), f.base); await noLocks(f);
  }
});

test("nonvoid/rejected promise/thenable guards never authorize; rejected promises are handled", async (t) => {
  const f = await fixture(t);
  for (const guard of [() => true, () => Promise.reject(new Error("rejected guard")),
    () => ({ then(_resolve, reject) { reject(new Error("thenable guard")); } })]) {
    await rejected(prepare({ ...f.request, assertAuthoritySync: guard }), /synchronous void/);
  }
  let phase = "prepare";
  const h = await prepare({ ...f.request, assertAuthoritySync() {
    f.request.assertAuthoritySync();
    if (phase === "commit") return Promise.reject(new Error("commit thenable"));
  } });
  phase = "commit";
  const error = await rejected(h.commit(), /synchronous void/);
  assert.equal(outcome(error).commitSent, false); assert.equal(outcome(error).childReaped, true);
  await delay(10); await noLocks(f);
});

test("synchronous guard reentrant commit is blocked before commit send", async (t) => {
  const f = await fixture(t);
  let h, reentrant;
  const request = { ...f.request, assertAuthoritySync() {
    f.request.assertAuthoritySync();
    if (h) reentrant = rejected(h.commit(), /consumed/);
  } };
  h = await prepare(request);
  assert.equal((await h.commit()).commitAcknowledged, true); await reentrant;
});

test("pre-cancel, prepared cancellation, and guard-triggered cancellation reap owned Git", async (t) => {
  const f = await fixture(t);
  const before = new AbortController(); before.abort();
  const initial = await rejected(prepare({ ...f.request, signal: before.signal }), /cancelled/);
  assert.equal(outcome(initial).preparationAcknowledged, false); assert.equal(outcome(initial).childReaped, true);
  const cancel = new AbortController(), h = await prepare({ ...f.request, signal: cancel.signal });
  cancel.abort();
  const error = await rejected(h.commit(), /cancelled/);
  assert.equal(outcome(error).commitSent, false); assert.equal(outcome(error).childReaped, true); await noLocks(f);
  let commit = false;
  const during = new AbortController();
  const h2 = await prepare({ ...f.request, signal: during.signal, assertAuthoritySync() {
    f.request.assertAuthoritySync(); if (commit) during.abort();
  } });
  commit = true;
  const e2 = await rejected(h2.commit(), /cancelled/);
  assert.equal(outcome(e2).commitSent, false); await noLocks(f);
});

test("deadline covers idle prepared handle and frees native locks", async (t) => {
  const f = await fixture(t), h = await prepare({ ...f.request, timeoutMs: 500 });
  await delay(650);
  const error = await rejected(h.commit(), /deadline/);
  assert.equal(outcome(error).preparationAcknowledged, true); assert.equal(outcome(error).commitSent, false);
  assert.equal(outcome(error).childReaped, true); await noLocks(f);
});

test("stopped real Git loses commit acknowledgement: sent is not acknowledged, even when observed target matches", { skip: process.platform !== "linux" }, async (t) => {
  const f = await fixture(t);
  // A legitimate same-OID update gives an observed matching target without any
  // evidence that a submitted commit ran. Stop the actual Git child, not a fake.
  const h = await prepare({ ...f.request, updateOid: f.base, timeoutMs: 500 });
  const children = (await readFile(`/proc/self/task/${process.pid}/children`, "utf8")).trim().split(/\s+/);
  let pid;
  for (const child of children) {
    try {
      const args = await readFile(`/proc/${child}/cmdline`, "utf8");
      if (args.includes(f.request.gitDir) && args.includes("update-ref\0--stdin")) pid = Number(child);
    } catch { /* A different test child may already have exited. */ }
  }
  assert.ok(pid); process.kill(pid, "SIGSTOP");
  const error = await rejected(h.commit(), /deadline/), result = outcome(error);
  assert.equal(result.preparationAcknowledged, true); assert.equal(result.commitSent, true);
  assert.equal(result.commitAcknowledged, false); assert.equal(result.childReaped, true);
  assert.equal(result.observedTargetOid, f.base); assert.equal(f.git("rev-parse", "target"), f.base);
});

test("a slow synchronous owner guard cannot send commit after the absolute deadline", async (t) => {
  const f = await fixture(t);
  let committing = false;
  const h = await prepare({ ...f.request, timeoutMs: 500, assertAuthoritySync() {
    f.request.assertAuthoritySync();
    if (committing) {
      const until = performance.now() + 550;
      while (performance.now() < until) { /* Deliberately block timer dispatch. */ }
    }
  } });
  committing = true;
  const error = await rejected(h.commit(), /deadline/);
  assert.equal(outcome(error).commitSent, false); assert.equal(outcome(error).childReaped, true);
  assert.equal(f.git("rev-parse", "target"), f.base); await noLocks(f);
});

test("oversized real Git binding output is bounded and children reaped", async (t) => {
  const f = await fixture(t), packed = join(f.gitDir, "packed-refs");
  // Deliberately malformed namespace from an external writer: packed children
  // coexist with the loose target. for-each-ref's prefix matching must be bounded.
  const rows = Array.from({ length: 1000 }, (_, i) => `${f.base} refs/heads/target/child-${String(i).padStart(4, "0")}\n`);
  await writeFile(packed, `# pack-refs with: sorted\n${rows.join("")}`);
  try {
    const error = await rejected(prepare(f.request), /output limit/);
    assert.equal(outcome(error).commitSent, false); assert.equal(outcome(error).childReaped, true);
    assert.ok(error.message.length <= 1024);
  } finally { await rm(packed); }
  assert.equal(f.git("rev-parse", "target"), f.base); await noLocks(f);
});

test("hooks and inherited Git overrides cannot redirect the native transaction", async (t) => {
  const f = await fixture(t), other = await fixture(t);
  const marker = join(f.root, "hook-ran");
  await writeFile(join(f.gitDir, "hooks/reference-transaction"), `#!/bin/sh\nprintf hook > '${marker}'\nexit 1\n`, { mode: 0o755 });
  const changes = { GIT_DIR: other.gitDir, GIT_COMMON_DIR: other.gitDir, GIT_WORK_TREE: other.root,
    GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: join(f.gitDir, "hooks"),
    GIT_INDEX_FILE: join(other.root, "bad-index") };
  const previous = Object.fromEntries(Object.keys(changes).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, changes);
    const h = await prepare(f.request); assert.equal((await h.commit()).commitAcknowledged, true);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
  await assert.rejects(stat(marker), { code: "ENOENT" });
  assert.equal(f.git("rev-parse", "target"), f.next); assert.equal(other.git("rev-parse", "target"), other.base);
});

test("packed refs and full SHA-256 OIDs are supported", async (t) => {
  const f = await fixture(t, "sha256"); f.git("pack-refs", "--all");
  const h = await prepare(f.request); assert.equal((await h.commit()).commitAcknowledged, true);
  assert.equal(f.git("rev-parse", "target"), f.next); await noLocks(f);
});

// Transport mediation is confined to disposable subprocess PATHs. Production
// exposes no executable/protocol/env injection. Every ref operation still runs
// the installed real Git; the proxy drops ONLY its actual commit acknowledgement.
async function ackDroppingWorker(f, { holdPipes = false, waitForReaping = false } = {}) {
  const bin = join(f.root, "native-ref-test-proxy"); await mkdir(bin);
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" });
  assert.equal(realGit.status, 0); assert.ok(realGit.stdout.trim().startsWith("/"));
  const marker = join(bin, "dropped-ack"), holderMarker = join(bin, "pipe-holder");
  await writeFile(join(bin, "git"), `#!${process.execPath}
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const transaction = args.includes('update-ref') && args.includes('--stdin');
const child = spawn(${JSON.stringify(realGit.stdout.trim())}, args, { stdio: ['pipe', 'pipe', 'pipe'] });
process.stdin.pipe(child.stdin); child.stderr.pipe(process.stderr);
child.stdin.on('error', () => {});
let buffer = '', dropped = false;
child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  if (!transaction) { process.stdout.write(chunk); return; }
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
    if (line === 'commit: ok') { dropped = true; writeFileSync(${JSON.stringify(marker)}, line); }
    else process.stdout.write(line + '\\n');
  }
});
child.on('close', code => {
  if (buffer) process.stdout.write(buffer);
  if (dropped && ${holdPipes}) {
    // Actual Git has exited. An independently controlled holder keeps ONLY the
    // transport pipes open, reproducing delayed ChildProcess close without a
    // fabricated production event, kill implementation, or unkillable OS task.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 15000)'],
      { detached: true, stdio: ['ignore', 1, 2] });
    writeFileSync(${JSON.stringify(holderMarker)}, String(holder.pid)); holder.unref();
  }
  process.exitCode = code ?? 1;
});
`, { mode: 0o755 });
  const request = { ...f.request }; delete request.assertAuthoritySync;
  const modulePath = new URL("./git-native-ref-transaction.ts", import.meta.url).pathname;
  const script = `import { createJiti } from 'jiti';
    const { prepareNativeRefTransaction: prepare, getNativeRefTransactionOutcome: outcome,
      getNativeRefTransactionReaped: reaped } = await createJiti(process.cwd() + '/native-ref-worker.mjs').import(${JSON.stringify(modulePath)});
    let authorized = true;
    const h = await prepare({ ...JSON.parse(process.argv[1]), timeoutMs: 1000,
      assertAuthoritySync() { if (!authorized) throw Error('worker authority revoked'); } });
    try { await h.commit(); throw Error('proxy unexpectedly delivered commit acknowledgement'); }
    catch (error) {
      authorized = false;
      if (!outcome(error)) throw error;
      const notification = reaped(error);
      console.log(JSON.stringify({ phase: 'failed', result: outcome(error),
        authentic: notification === reaped(h), copied: reaped({ ...error }) === undefined }));
      if (${waitForReaping}) {
        const keepAlive = setInterval(() => {}, 100);
        await notification; clearInterval(keepAlive);
        console.log(JSON.stringify({ phase: 'reaped', result: outcome(error), handleResult: outcome(h) }));
      }
    }`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script, JSON.stringify(request)], {
    cwd: process.cwd(), env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  const messages = new Map(), subscribers = new Map();
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    let newline;
    while ((newline = stdout.indexOf("\n")) >= 0) {
      const message = JSON.parse(stdout.slice(0, newline)); stdout = stdout.slice(newline + 1);
      messages.set(message.phase, message); subscribers.get(message.phase)?.(message);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve, reject) => child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr))));
  void closed.catch(() => {});
  const message = (phase) => messages.has(phase) ? Promise.resolve(messages.get(phase)) :
    Promise.race([new Promise((resolve) => subscribers.set(phase, resolve)), closed.then(() => { throw new Error(`Worker exited before ${phase}: ${stderr}`); })]);
  const holderPid = async () => Number(await readFile(holderMarker, "utf8"));
  f.cleanup(async () => {
    if (holdPipes) { try { process.kill(await holderPid(), "SIGTERM"); } catch { /* Already closed. */ } }
    if (child.exitCode === null) child.kill("SIGKILL");
    await closed.catch(() => {});
  });
  return { message, closed, holderPid, marker };
}

test("real Git changes target then transport drops commit ack: sent never becomes fabricated success", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t), worker = await ackDroppingWorker(f);
  const failed = await worker.message("failed"); await worker.closed;
  assert.equal(await readFile(worker.marker, "utf8"), "commit: ok", "ack was generated by REAL Git, then dropped");
  assert.notEqual(f.base, f.next); assert.equal(f.git("rev-parse", "target"), f.next);
  assert.equal(failed.result.preparationAcknowledged, true); assert.equal(failed.result.commitSent, true);
  assert.equal(failed.result.commitAcknowledged, false); assert.equal(failed.result.childReaped, true);
  assert.equal(failed.authentic, true); assert.equal(failed.copied, true); await noLocks(f);
});

test("bounded fallback preserves authenticated eventual reaping and original pinned FDs", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t), worker = await ackDroppingWorker(f, { holdPipes: true, waitForReaping: true });
  const failed = await worker.message("failed");
  assert.equal(failed.result.childReaped, false); assert.equal(failed.result.commitSent, true);
  assert.equal(failed.result.commitAcknowledged, false); assert.equal(failed.authentic, true); assert.equal(failed.copied, true);
  assert.equal(f.git("rev-parse", "target"), f.next);
  // Keep ORIGINAL parent descriptors open until the actual close notification.
  assert.ok((await stat(f.request.gitDir)).isDirectory()); assert.ok((await stat(f.request.workTree)).isDirectory());
  f.git("update-ref", "refs/heads/third", f.next); // no global cleanup/admission gate
  process.kill(await worker.holderPid(), "SIGTERM");
  const late = await worker.message("reaped"); await worker.closed;
  assert.equal(late.result.childReaped, true); assert.equal(late.handleResult.childReaped, true);
  assert.equal(late.result.commitAcknowledged, false); await noLocks(f);
});

test("bounded fallback unrefs child AND stdio so residual transport cannot keep Node alive", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t), worker = await ackDroppingWorker(f, { holdPipes: true });
  const failed = await worker.message("failed");
  assert.equal(failed.result.childReaped, false);
  await worker.closed;
  process.kill(await worker.holderPid(), 0); // pipe holder still alive AFTER worker's natural exit
  assert.equal(failed.result.commitAcknowledged, false);
  assert.equal(f.git("rev-parse", "target"), f.next); await noLocks(f);
});

test("independent real cross-process same-target contenders: exactly one healthy winner", { timeout: 10_000 }, async (t) => {
  const f = await fixture(t);
  f.git("branch", "other-source", f.next);
  const modulePath = new URL("./git-native-ref-transaction.ts", import.meta.url).pathname;
  const script = `import { createJiti } from 'jiti';
    const { prepareNativeRefTransaction, getNativeRefTransactionOutcome } = await createJiti(process.cwd() + '/native-ref-worker.mjs').import(${JSON.stringify(modulePath)});
    process.send({ ready: true });
    process.once('message', async (request) => {
      let authorized = true;
      try {
        const h = await prepareNativeRefTransaction({ ...request, assertAuthoritySync() { if (!authorized) throw Error('worker authority revoked'); } });
        const result = await h.commit(); authorized = false;
        process.send({ ok: true, result });
      } catch (error) { process.send({ ok: false, result: getNativeRefTransactionOutcome(error) }); }
      process.disconnect();
    });`;
  const workers = [0, 1].map(() => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
    t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
    let stderr = ""; child.stderr.on("data", (chunk) => { stderr += chunk; });
    let readyResolve, resultResolve;
    const ready = new Promise((resolve) => { readyResolve = resolve; });
    const result = new Promise((resolve) => { resultResolve = resolve; });
    child.on("message", (message) => { if (message.ready) readyResolve(); else resultResolve(message); });
    const closed = new Promise((resolve, reject) => child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr))));
    return { child, ready, result, closed };
  });
  await Promise.all(workers.map((worker) => worker.ready));
  const request = { ...f.request }; delete request.assertAuthoritySync;
  for (const [index, worker] of workers.entries()) {
    worker.child.send({ ...request, sourceBranch: index ? "refs/heads/other-source" : request.sourceBranch });
  }
  const results = await Promise.all(workers.map((worker) => worker.result));
  await Promise.all(workers.map((worker) => worker.closed));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.find((result) => result.ok).result.commitAcknowledged, true);
  assert.equal(results.find((result) => !result.ok).result.commitSent, false);
  assert.ok(results.every((result) => result.result.childReaped));
  assert.equal(f.git("rev-parse", "target"), f.next); await noLocks(f);
});
