import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const api = await jiti.import("./git-native-checkout-transaction.ts");
const { captureNativeCheckoutTransaction: capture,
  getNativeCheckoutOutcome: outcome, readNativeCheckoutCompletion: proof } = api;
const apply = (candidate, options) => options
  ? api.applyNativeCheckoutTransactionForTest(candidate, options.testHooks)
  : api.applyNativeCheckoutTransaction(candidate);
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: {
  ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0",
} }).trim();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function bound(main, cwd) {
  allowFileRoot(main); allowFileRoot(cwd);
  const resources = await selectCanonicalGitResources({ repositoryPath: main, checkoutPath: cwd });
  return { resources, expectedOid: git(cwd, "rev-parse", "HEAD"), treeOid: git(cwd, "rev-parse", "HEAD^{tree}"),
    indexDigest: digest(readFileSync(join(resources.gitDir, "index"))) };
}
async function fixture(t, { linked = false, merge = false, second = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-native-checkout-test-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), target = linked ? join(home, "target") : main;
  git(home, "init", "-q", "-b", "main", main);
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  writeFileSync(join(main, "base"), "base\n"); writeFileSync(join(main, "removed"), "old\n");
  git(main, "add", "."); git(main, "commit", "-qm", "base");
  if (linked) git(main, "worktree", "add", "-qb", "target", target);
  git(main, "worktree", "add", "-qb", "feature", feature);
  writeFileSync(join(feature, "feature"), "feature\n"); chmodSync(join(feature, "feature"), 0o755);
  symlinkSync("base", join(feature, "link")); unlinkSync(join(feature, "removed"));
  git(feature, "add", "."); git(feature, "commit", "-qm", "feature");
  const source = await bound(main, feature), to = await bound(main, target);
  let resultOid = source.expectedOid;
  if (merge) resultOid = git(main, "commit-tree", source.treeOid, "-p", to.expectedOid, "-p", source.expectedOid, "-m", "approved merge");
  const request = { source, target: to, resultOid, resultTreeOid: source.treeOid, assertAuthoritySync() {} };
  let other;
  if (second) {
    const cwd = join(home, "other"); git(main, "worktree", "add", "-qb", "other", cwd, to.expectedOid);
    writeFileSync(join(cwd, "other"), "other\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "other");
    const s = await bound(main, cwd); other = { ...request, source: s, resultOid: s.expectedOid, resultTreeOid: s.treeOid };
  }
  return { home, main, target, feature, request, other, index: join(to.resources.gitDir, "index"),
    async candidate() { return capture(request); } };
}
async function failure(promise) {
  try { await promise; assert.fail("expected rejection"); } catch (error) {
    assert.ok(outcome(error), error.stack); assert.equal(proof(error), undefined); return outcome(error);
  }
}
function unchanged(f) {
  assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.target.expectedOid);
  assert.equal(digest(readFileSync(f.index)), f.request.target.indexDigest);
  assert.equal(existsSync(join(f.target, "feature")), false);
  assert.equal(existsSync(`${f.index}.lock`), false);
}

// Same file doubles as the disposable worker; no production worker or loader needed.
if (process.env.PI_NATIVE_CHECKOUT_CHILD) {
  process.on("message", async (message) => {
    if (message.kind !== "prepare") return;
    const request = message.request; request.assertAuthoritySync = () => {};
    for (const b of [request.source, request.target]) { allowFileRoot(b.resources.projectRoot); allowFileRoot(b.resources.cwd); }
    const candidate = await capture(request);
    process.send({ kind: "ready" });
    process.once("message", async () => {
      try { const completed = await apply(candidate); process.send({ kind: "done", outcome: outcome(completed), proof: proof(completed) }); }
      catch (error) { process.send({ kind: "done", outcome: outcome(error), error: String(error) }); }
      process.disconnect();
    });
  });
} else {
  for (const linked of [false, true]) for (const merge of [false, true]) {
    test(`exact ${merge ? "nonFF object" : "FF"}, ${linked ? "linked" : "direct"} target`, async (t) => {
      const f = await fixture(t, { linked, merge }), c = await f.candidate();
      const completed = await apply(c), evidence = proof(completed);
      assert.equal(outcome(completed).status, "complete"); assert.equal(outcome(completed).indexSynced, true);
      assert.equal(evidence.resultOid, f.request.resultOid); assert.ok(Object.isFrozen(evidence.source.resources.identities));
      assert.equal(proof({ ...completed }), undefined); assert.equal(outcome({ ...completed }), undefined);
      await assert.rejects(apply(c)); await assert.rejects(apply({ ...c }));
      assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.resultOid);
      assert.equal(git(f.target, "write-tree"), f.request.resultTreeOid); assert.equal(git(f.target, "status", "--porcelain"), "");
      assert.equal(git(f.feature, "rev-parse", "HEAD"), f.request.source.expectedOid);
      assert.equal(digest(readFileSync(join(f.request.source.resources.gitDir, "index"))), f.request.source.indexDigest);
      assert.equal(existsSync(join(f.target, "removed")), false); assert.ok(lstatSync(join(f.target, "link")).isSymbolicLink());
      assert.ok(lstatSync(join(f.target, "feature")).mode & 0o100); assert.equal(existsSync(`${f.index}.lock`), false);
      if (merge) assert.equal(git(f.target, "show", "-s", "--format=%P", "HEAD"), `${f.request.target.expectedOid} ${f.request.source.expectedOid}`);
    });
  }
  test("two processes, two sources, same captured target: native loser never touches checkout/index", async (t) => {
    const f = await fixture(t, { second: true });
    const launch = (request) => {
      const child = fork(fileURLToPath(import.meta.url), [], { env: { ...process.env, PI_NATIVE_CHECKOUT_CHILD: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      t.after(() => child.kill());
      let stderr = ""; child.stderr.on("data", (data) => { stderr += data; });
      const ready = new Promise((resolve, reject) => {
        child.on("message", (m) => { if (m.kind === "ready") resolve(); });
        child.on("exit", (code) => { if (code) reject(new Error(stderr)); });
      });
      const done = new Promise((resolve, reject) => {
        child.on("message", (m) => { if (m.kind === "done") resolve(m); });
        child.on("exit", (code) => { if (code) reject(new Error(stderr)); });
      });
      const serializable = { ...request }; delete serializable.assertAuthoritySync;
      child.send({ kind: "prepare", request: serializable }); return { child, ready, done, request };
    };
    const attempts = [launch(f.request), launch(f.other)];
    await Promise.all(attempts.map((x) => x.ready)); attempts.forEach((x) => x.child.send({ kind: "go" }));
    const results = await Promise.all(attempts.map((x) => x.done));
    const winner = results.findIndex((x) => x.outcome.status === "complete"), loser = results[1 - winner];
    assert.notEqual(winner, -1, JSON.stringify(results)); assert.equal(loser.outcome.checkoutAttempted, false);
    assert.equal(loser.outcome.refCommitSent, false); assert.equal(loser.outcome.indexInstalled, false);
    const won = attempts[winner].request;
    assert.equal(git(f.target, "rev-parse", "HEAD"), won.resultOid); assert.equal(git(f.target, "write-tree"), won.resultTreeOid);
    assert.equal(git(f.target, "status", "--porcelain"), ""); assert.equal(existsSync(`${f.index}.lock`), false);
    for (const request of [f.request, f.other]) assert.equal(git(request.source.resources.cwd, "rev-parse", "HEAD"), request.source.expectedOid);
  });
  test("original copied bounds + unrelated ref movement do not refresh or invalidate candidate", async (t) => {
    const f = await fixture(t), c = await f.candidate();
    f.request.resultOid = f.request.target.expectedOid; f.request.target.expectedOid = "a".repeat(40);
    f.request.assertAuthoritySync = () => { throw new Error("replacement must not be used"); };
    git(f.main, "update-ref", "refs/heads/unrelated", f.request.source.expectedOid);
    assert.equal(outcome(await apply(c)).status, "complete");
  });
  for (const where of ["source", "target"]) test(`physical ${where} hidden stat-cache bytes reject before checkout`, async (t) => {
    const f = await fixture(t), cwd = f.request[where].resources.cwd;
    git(f.main, "config", "core.trustctime", "false"); git(f.main, "config", "core.checkstat", "minimal");
    const path = join(cwd, "base"), old = new Date("2001-01-01T00:00:00Z"); utimesSync(path, old, old);
    git(cwd, "update-index", "--refresh"); f.request[where] = await bound(f.main, cwd);
    const c = await f.candidate(); writeFileSync(path, "evil\n"); utimesSync(path, old, old);
    assert.equal(git(cwd, "status", "--porcelain", "--", "base"), "");
    const o = await failure(apply(c)); assert.equal(o.checkoutAttempted, false); unchanged(f);
  });
  for (const where of ["source", "target"]) for (const change of ["ref", "head", "symref", "config"]) {
    test(`late ${where} ${change} change rejects without checkout`, async (t) => {
      const f = await fixture(t), c = await f.candidate(), b = f.request[where], cwd = b.resources.cwd;
      if (change === "ref") git(cwd, "update-ref", `refs/heads/${b.resources.branch}`, where === "target" ? f.request.source.expectedOid : f.request.target.expectedOid);
      if (change === "head") { git(cwd, "branch", "alias", b.expectedOid); git(cwd, "symbolic-ref", "HEAD", "refs/heads/alias"); }
      if (change === "symref") { git(cwd, "branch", "alias", b.expectedOid); git(cwd, "symbolic-ref", `refs/heads/${b.resources.branch}`, "refs/heads/alias"); }
      if (change === "config") git(cwd, "config", "filter.evil.clean", "false");
      const before = readFileSync(f.index), o = await failure(apply(c));
      assert.equal(o.checkoutAttempted, false); assert.equal(o.refCommitSent, false); assert.deepEqual(readFileSync(f.index), before);
      assert.equal(existsSync(join(f.target, "feature")), false); assert.equal(existsSync(`${f.index}.lock`), false);
    });
  }
  test("abort and partial failure release only owned index inode; no quarantine", async (t) => {
    for (const phase of ["afterLocks", "afterCheckout", "afterRef"]) {
      const f = await fixture(t), c = await f.candidate();
      const o = await failure(apply(c, { testHooks: { [phase]() { throw new Error("injected"); } } }));
      assert.equal(o.checkoutAttempted, phase !== "afterLocks"); assert.equal(o.refAcknowledged, phase === "afterRef");
      assert.equal(o.childReaped, true); assert.equal(o.indexInstalled, false); assert.equal(existsSync(`${f.index}.lock`), false);
      assert.equal(digest(readFileSync(f.index)), f.request.target.indexDigest);
      assert.equal(git(f.target, "rev-parse", "HEAD"), phase === "afterRef" ? f.request.resultOid : f.request.target.expectedOid);
    }
  });
  test("foreign lock replacement is neither installed nor removed, original FD not replaced by child", async (t) => {
    const f = await fixture(t), c = await f.candidate(), lockPath = `${f.index}.lock`;
    const o = await failure(apply(c, { testHooks: { afterCheckout() {
      renameSync(lockPath, join(f.home, "owned-away")); writeFileSync(lockPath, "foreign", { flag: "wx" });
    } } }));
    assert.equal(o.checkoutAttempted, true); assert.equal(o.refCommitSent, false);
    assert.equal(readFileSync(lockPath, "utf8"), "foreign"); assert.equal(readFileSync(join(f.home, "owned-away")).length, 0);
    assert.equal(digest(readFileSync(f.index)), f.request.target.indexDigest);
  });
  test("same-inode lock corruption after ref ack never yields completion or an installed index", async (t) => {
    const f = await fixture(t), c = await f.candidate();
    const o = await failure(apply(c, { testHooks: { afterRef() { writeFileSync(`${f.index}.lock`, "corrupt"); } } }));
    assert.equal(o.refAcknowledged, true); assert.equal(o.indexInstalled, false); assert.equal(o.status, "partial");
    assert.equal(digest(readFileSync(f.index)), f.request.target.indexDigest); assert.equal(existsSync(`${f.index}.lock`), false);
  });
  for (const mutation of ["replacement-different-bytes", "replacement-same-bytes", "in-place-bytes"]) {
    test(`after-ref original index ${mutation} is preserved as acknowledged partial`, async (t) => {
      const f = await fixture(t), c = await f.candidate(), before = readFileSync(f.index), originalInode = lstatSync(f.index).ino;
      let foreignBytes, foreignInode;
      const o = await failure(apply(c, { testHooks: { afterRef() {
        foreignBytes = mutation === "replacement-same-bytes" ? before : Buffer.from(before);
        if (mutation !== "replacement-same-bytes") foreignBytes[0] ^= 1;
        if (mutation === "in-place-bytes") writeFileSync(f.index, foreignBytes);
        else {
          const replacement = join(f.home, "foreign-index");
          writeFileSync(replacement, foreignBytes, { flag: "wx" }); renameSync(replacement, f.index);
        }
        foreignInode = lstatSync(f.index).ino;
        assert.equal(foreignInode === originalInode, mutation === "in-place-bytes");
      } } }));
      assert.equal(o.status, "partial"); assert.equal(o.refCommitSent, true); assert.equal(o.refAcknowledged, true);
      assert.equal(o.indexInstalled, false); assert.equal(o.indexSynced, false); assert.equal(o.childReaped, true);
      assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.resultOid);
      assert.deepEqual(readFileSync(f.index), foreignBytes); assert.equal(lstatSync(f.index).ino, foreignInode);
      assert.equal(existsSync(`${f.index}.lock`), false, "owned lock is released, never retained/recreated as quarantine");
    });
  }
  for (const mutation of ["same-inode-content", "replacement-inode"]) {
    test(`final original authority guard ${mutation} lock mutation is proved AFTER callback`, async (t) => {
      const f = await fixture(t), before = readFileSync(f.index), originalInode = lstatSync(f.index).ino;
      const lockPath = `${f.index}.lock`; let armed = false, calls = 0, foreignBytes, foreignInode;
      f.request.assertAuthoritySync = () => {
        if (!armed) return;
        armed = false; calls++;
        foreignBytes = readFileSync(lockPath); const ownedInode = lstatSync(lockPath).ino;
        if (mutation === "same-inode-content") { foreignBytes[0] ^= 1; writeFileSync(lockPath, foreignBytes); }
        else {
          const replacement = join(f.home, "foreign-lock");
          writeFileSync(replacement, foreignBytes, { flag: "wx" }); renameSync(replacement, lockPath);
        }
        foreignInode = lstatSync(lockPath).ino;
        assert.equal(foreignInode === ownedInode, mutation === "same-inode-content");
      };
      const c = await f.candidate(); f.request.assertAuthoritySync = () => { assert.fail("replacement guard must never run"); };
      const o = await failure(apply(c, { testHooks: { afterRef() { armed = true; } } }));
      assert.equal(calls, 1); assert.equal(o.status, "partial"); assert.equal(o.refAcknowledged, true);
      assert.equal(o.refCommitSent, true); assert.equal(o.indexInstalled, false); assert.equal(o.indexSynced, false);
      assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.resultOid);
      assert.deepEqual(readFileSync(f.index), before); assert.equal(lstatSync(f.index).ino, originalInode);
      if (mutation === "replacement-inode") {
        assert.deepEqual(readFileSync(lockPath), foreignBytes); assert.equal(lstatSync(lockPath).ino, foreignInode);
      } else assert.equal(existsSync(lockPath), false, "only the owned, now-corrupted lock is removed");
    });
  }
  test("source physical mutation after checkout aborts refs without rollback/quarantine", async (t) => {
    const f = await fixture(t), c = await f.candidate();
    const o = await failure(apply(c, { testHooks: { afterCheckout() { writeFileSync(join(f.feature, "base"), "evil\n"); } } }));
    assert.equal(o.checkoutAttempted, true); assert.equal(o.refCommitSent, false); assert.equal(o.childReaped, true);
    assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.target.expectedOid);
    assert.equal(readFileSync(join(f.target, "feature"), "utf8"), "feature\n"); assert.equal(existsSync(`${f.index}.lock`), false);
  });
  test("native index contention preserves foreign bytes", async (t) => {
    const f = await fixture(t), c = await f.candidate(); writeFileSync(`${f.index}.lock`, "foreign");
    assert.equal((await failure(apply(c))).checkoutAttempted, false); assert.equal(readFileSync(`${f.index}.lock`, "utf8"), "foreign");
  });
  test("guard is original synchronous void at checkout and commit boundaries", async (t) => {
    for (const phase of ["afterLocks", "afterCheckout"]) {
      const f = await fixture(t); let allowed = true;
      f.request.assertAuthoritySync = () => { if (!allowed) throw new Error("revoked"); };
      const c = await f.candidate(); f.request.assertAuthoritySync = () => {};
      const o = await failure(apply(c, { testHooks: { [phase]() { allowed = false; } } }));
      assert.equal(o.checkoutAttempted, phase === "afterCheckout"); assert.equal(o.refCommitSent, false);
    }
    const f = await fixture(t);
    for (const guard of [async () => {}, () => Promise.reject(new Error("not void")), () => ({ then(resolve) { resolve(); } }), () => true]) {
      await assert.rejects(capture({ ...f.request, assertAuthoritySync: guard })); unchanged(f);
    }
  });
  test("post-install independently authorized successor cannot revoke first completion", async (t) => {
    const f = await fixture(t), first = await f.candidate();
    let second;
    const completed = await apply(first, { testHooks: { async afterIndexInstall() {
      // Exact approved nonFF object adds a new parent binding but preserves tree.
      const nextOid = git(f.main, "commit-tree", f.request.resultTreeOid, "-p", f.request.resultOid, "-m", "next approved object");
      const request = { ...f.request, target: await bound(f.main, f.target), resultOid: nextOid };
      second = await apply(await capture(request));
    } } });
    assert.equal(outcome(completed).status, "complete"); assert.equal(outcome(second).status, "complete");
    assert.equal(proof(completed).resultOid, f.request.resultOid);
    assert.equal(git(f.target, "rev-parse", "HEAD"), proof(second).resultOid);
  });
  test("test callback adapter refuses outside NODE_TEST_CONTEXT; production ignores payload hooks", async (t) => {
    const f = await fixture(t), c = await f.candidate(), context = process.env.NODE_TEST_CONTEXT;
    try {
      delete process.env.NODE_TEST_CONTEXT;
      await assert.rejects(api.applyNativeCheckoutTransactionForTest(c, { afterLocks() { assert.fail("must not run"); } }));
      const result = await api.applyNativeCheckoutTransaction(c, { testHooks: { afterLocks() { assert.fail("production must not run payload hooks"); } } });
      assert.equal(outcome(result).status, "complete");
    } finally { process.env.NODE_TEST_CONTEXT = context; }
  });
  test("directory sync failure is a durability limitation, not uncertain native execution", async (t) => {
    const f = await fixture(t), c = await f.candidate();
    const result = await apply(c, { testHooks: { beforeDirectorySync() { throw new Error("simulated fsync failure"); } } });
    assert.equal(outcome(result).status, "complete"); assert.equal(outcome(result).refAcknowledged, true);
    assert.equal(outcome(result).indexInstalled, true); assert.equal(outcome(result).indexSynced, false);
    assert.equal(outcome(result).directorySyncFailed, true); assert.ok(proof(result));
    assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.resultOid); assert.equal(git(f.target, "status", "--porcelain"), "");
    assert.equal(existsSync(`${f.index}.lock`), false);
  });
  test("result index written before ref ack, original index.lock inode installed", async (t) => {
    const f = await fixture(t), c = await f.candidate(); let inode, written;
    const result = await apply(c, { testHooks: {
      afterLocks() { inode = lstatSync(`${f.index}.lock`).ino; },
      afterRef() {
        assert.equal(lstatSync(`${f.index}.lock`).ino, inode); written = readFileSync(`${f.index}.lock`);
        assert.notEqual(digest(written), f.request.target.indexDigest);
        assert.equal(digest(readFileSync(f.index)), f.request.target.indexDigest);
        assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.resultOid);
      },
      afterIndexInstall() { assert.equal(lstatSync(f.index).ino, inode); assert.deepEqual(readFileSync(f.index), written); },
    } });
    assert.equal(outcome(result).status, "complete"); assert.equal(proof(result).targetContents.indexDigest, digest(written));
    assert.equal(lstatSync(f.index).ino, inode);
  });
  test("preparation direction updates original feature, verifies original main; no implicit rebase", async (t) => {
    const f = await fixture(t);
    const newOid = git(f.main, "commit-tree", f.request.source.treeOid, "-p", f.request.target.expectedOid, "-m", "approved rewritten commit");
    // Guarantee distinct object even if Git identity/timestamp happen to match.
    assert.notEqual(newOid, f.request.source.expectedOid);
    const result = await apply(await capture({ ...f.request, source: f.request.target, target: f.request.source,
      resultOid: newOid, resultTreeOid: f.request.source.treeOid }));
    assert.equal(outcome(result).status, "complete"); assert.equal(git(f.feature, "rev-parse", "HEAD"), newOid);
    unchanged(f); assert.equal(git(f.feature, "status", "--porcelain"), "");
  });
  test("stale explicit OIDs/tree/index expectations and dirty candidate capture have no effects", async (t) => {
    const f = await fixture(t);
    for (const where of ["source", "target"]) for (const field of ["expectedOid", "treeOid", "indexDigest"]) {
      const changed = { ...f.request, [where]: { ...f.request[where], [field]: "a".repeat(field === "indexDigest" ? 64 : 40) } };
      await assert.rejects(capture(changed)); unchanged(f);
    }
    writeFileSync(join(f.feature, "base"), "dirty"); await assert.rejects(f.candidate()); unchanged(f);
  });
  for (const config of [["core.hooksPath", "/unsafe/hooks"], ["commit.gpgsign", "true"], ["filter.custom.smudge", "false"], ["core.fsmonitor", "unsafe"]]) {
    test(`hazardous ${config[0]} rejected before checkout-capable command`, async (t) => {
      const f = await fixture(t), c = await f.candidate(); git(f.main, "config", ...config);
      assert.equal((await failure(apply(c))).checkoutAttempted, false); unchanged(f);
    });
  }
  for (const kind of ["untracked", "ignored-collision", "marker", "index-flags", "new-attributes"]) {
    test(`late ${kind} rejected before checkout`, async (t) => {
      const f = await fixture(t), c = await f.candidate();
      if (kind === "untracked") writeFileSync(join(f.target, "untracked"), "keep");
      if (kind === "ignored-collision") { writeFileSync(join(f.main, ".git", "info", "exclude"), "feature\n"); writeFileSync(join(f.target, "feature"), "keep"); }
      if (kind === "marker") writeFileSync(join(f.request.target.resources.gitDir, "MERGE_HEAD"), f.request.source.expectedOid);
      if (kind === "index-flags") git(f.target, "update-index", "--assume-unchanged", "base");
      if (kind === "new-attributes") writeFileSync(join(f.target, ".gitattributes"), "* text\n");
      const before = readFileSync(f.index), o = await failure(apply(c));
      assert.equal(o.checkoutAttempted, false); assert.deepEqual(readFileSync(f.index), before);
      assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.target.expectedOid); assert.equal(existsSync(`${f.index}.lock`), false);
      if (kind === "ignored-collision") assert.equal(readFileSync(join(f.target, "feature"), "utf8"), "keep");
    });
  }
  test("real ref commit with deliberately lost acknowledgement is UNKNOWN, not no-change", async (t) => {
    const f = await fixture(t), c = await f.candidate();
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    const bin = join(f.home, "bin"); mkdirSync(bin);
    // A disposable transport proxy runs real Git and suppresses only its commit ACK.
    // It exits when that real child exits, never leaving a detached native writer.
    writeFileSync(join(bin, "git"), `#!${process.execPath}\n` + `
const { spawn } = require('node:child_process');
const args = process.argv.slice(2), protocol = args.includes('update-ref') && args.includes('--stdin');
const child = spawn(${JSON.stringify(realGit)}, args, { stdio: protocol ? ['pipe','pipe','inherit'] : 'inherit' });
if (protocol) {
  process.stdin.pipe(child.stdin); child.stdin.on('error', () => {});
  let pending = '';
  child.stdout.on('data', (data) => {
    pending += data; let n;
    while ((n = pending.indexOf('\\n')) !== -1) {
      const row = pending.slice(0, n + 1); pending = pending.slice(n + 1);
      if (row !== 'commit: ok\\n') process.stdout.write(row);
    }
  });
}
child.on('close', (code) => process.exit(code ?? 1));
`, { mode: 0o700 });
    const path = process.env.PATH; let o;
    try { process.env.PATH = `${bin}:${path}`; o = await failure(apply(c)); }
    finally { process.env.PATH = path; }
    assert.equal(o.status, "unknown"); assert.equal(o.checkoutAttempted, true); assert.equal(o.refCommitSent, true);
    assert.equal(o.refAcknowledged, false); assert.equal(o.childReaped, true); assert.equal(o.indexInstalled, false);
    assert.equal(git(f.target, "rev-parse", "HEAD"), f.request.resultOid);
    assert.equal(digest(readFileSync(f.index)), f.request.target.indexDigest); assert.equal(existsSync(`${f.index}.lock`), false);
  });
  test("bounded unreaped native failure retains original directory FDs until actual pipe close", async (t) => {
    const f = await fixture(t); f.request.timeoutMs = 5000; const c = await f.candidate();
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim(), bin = join(f.home, "delayed-bin"), pidFile = join(f.home, "sleeper-pid");
    mkdirSync(bin);
    // Real Git aborts, but a disposable inherited stdout holder delays the owned
    // transport's close event beyond bounded cleanup. No unkillable kernel task needed.
    writeFileSync(join(bin, "git"), `#!${process.execPath}\n` + `
const { spawn } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2), protocol = args.includes('update-ref') && args.includes('--stdin');
const child = spawn(${JSON.stringify(realGit)}, args, { stdio: protocol ? ['pipe','pipe','inherit'] : 'inherit' });
if (!protocol) child.on('close', (code) => process.exit(code ?? 1));
else {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
  process.stdin.pipe(child.stdin); child.stdin.on('error', () => {});
  let pending = '';
  child.stdout.on('data', (data) => {
    pending += data; let n;
    while ((n = pending.indexOf('\\n')) !== -1) {
      const row = pending.slice(0, n + 1); pending = pending.slice(n + 1);
      if (row !== 'abort: ok\\n') process.stdout.write(row);
    }
  });
  child.on('close', () => {
    const sleeper = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
    writeFileSync(${JSON.stringify(pidFile)}, String(sleeper.pid));
  });
}
`, { mode: 0o700 });
    let pins, sleeper;
    t.after(() => { if (sleeper) try { process.kill(sleeper, "SIGKILL"); } catch { /* already exited */ } });
    const paths = new Set([f.request.source.resources.cwd, f.request.source.resources.gitDir,
      f.request.source.resources.commonDir, f.request.target.resources.cwd, f.request.target.resources.gitDir]);
    const path = process.env.PATH; let o;
    try {
      process.env.PATH = `${bin}:${path}`;
      o = await failure(apply(c, { testHooks: { afterLocks() {
        pins = readdirSync(`/proc/${process.pid}/fd`).flatMap((name) => {
          const fd = `/proc/${process.pid}/fd/${name}`;
          try { const to = readlinkSync(fd); return paths.has(to) ? [[fd, to]] : []; } catch { return []; }
        });
        throw new Error("abort with delayed transport close");
      } } }));
    } finally { process.env.PATH = path; }
    sleeper = Number(readFileSync(pidFile, "utf8"));
    assert.equal(o.status, "unknown"); assert.equal(o.childReaped, false); assert.equal(o.checkoutAttempted, false);
    assert.ok(pins.length >= 4);
    for (const [fd, to] of pins) assert.equal(readlinkSync(fd), to, "original descriptor must not be recycled at bounded return");
    unchanged(f);
    const retained = () => pins.some(([fd, to]) => { try { return readlinkSync(fd) === to; } catch { return false; } });
    const until = Date.now() + 10_000;
    while (retained() && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(retained(), false, "genuine eventual reaping closes the original pin descriptors");
  });
  test("slow synchronous original guard cannot launch checkout after deadline", async (t) => {
    const f = await fixture(t); let slow = false;
    f.request.timeoutMs = 4000;
    f.request.assertAuthoritySync = () => {
      if (slow) { const until = performance.now() + 4100; while (performance.now() < until) { /* simulate synchronous authority work */ } }
    };
    const c = await f.candidate();
    const o = await failure(apply(c, { testHooks: { afterLocks() { slow = true; } } }));
    assert.equal(o.checkoutAttempted, false); assert.equal(o.refCommitSent, false); assert.equal(o.childReaped, true); unchanged(f);
  });
  test("timeout aborts held refs and removes owned index lock without effects", async (t) => {
    const f = await fixture(t); f.request.timeoutMs = 1500; const c = await f.candidate();
    const o = await failure(apply(c, { testHooks: { async afterLocks() { await new Promise((r) => setTimeout(r, 1600)); } } }));
    assert.equal(o.checkoutAttempted, false); assert.equal(o.refCommitSent, false); assert.equal(o.childReaped, true); unchanged(f);
  });
}
