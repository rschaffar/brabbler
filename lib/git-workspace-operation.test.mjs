import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
const originalHome = process.env.HOME, originalConfigHome = process.env.XDG_CONFIG_HOME;
const configHome = mkdtempSync(join(tmpdir(), "pi-web-workspace-config-"));
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => {
  if (originalHome === undefined) delete process.env.HOME; else process.env.HOME = originalHome;
  if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = originalConfigHome;
  rmSync(configHome, { recursive: true, force: true });
});
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { captureGitWorkspaceOperation: capture, applyGitWorkspaceOperation: apply,
  applyGitWorkspaceOperationWithAuthority: applyWithAuthority, readGitWorkspaceNativeProof } = await jiti.import("./git-workspace-operation.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { acquireGitCheckoutGate, isGitCheckoutGated } = await jiti.import("./git-checkout-gate.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t, { conventional = false, missingParent = false, isolatedNamespace = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-workspace-op-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repoParent = isolatedNamespace ? join(home, "repositories") : home;
  if (isolatedNamespace) mkdirSync(repoParent);
  const repo = join(repoParent, "repo"), parent = conventional ? `${repo}-worktrees` : join(home, "destinations");
  if (!missingParent) mkdirSync(parent);
  git(home, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com");
  // Make fixture hermetic with respect to ambient user configuration.
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "base"), "source content\n");
  writeFileSync(join(repo, ".gitignore"), "ignored\n");
  git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  writeFileSync(join(repo, "ignored"), "ignored source data\n");
  const oid = git(repo, "rev-parse", "HEAD");
  allowFileRoot(repo); if (!conventional) allowFileRoot(parent);
  const ledger = join(home, "intent.json"), proofFile = join(home, "completed.json"), failure = join(home, "failure.json");
  let begins = 0, completions = 0, failComplete = false, failBegin = false, revoked = false, boundaryEffect;
  // A disposable persisted parent contract, NOT a proof-free resolve stub.
  // These fixtures exercise process exit, not power-loss durability: file flushes
  // do not establish the parent-directory fsync barriers required in production.
  // Production must supply the shared supervised admission implementation.
  const admission = {
    async assertAdmission(source, destination, parentCreation) {
      assert.equal(source.projectRoot, repo); assert.equal(destination.startsWith(`${parent}/`), true);
      if (parentCreation) {
        assert.equal(parentCreation.path, parent); assert.equal(parentCreation.ancestorPath, repoParent);
        assert.equal(parentCreation.expectedAbsent, true); assert.equal(parentCreation.mode, 0o700);
      }
      if (existsSync(ledger)) throw Error("unresolved intent");
    },
    async beginIntent(evidence) {
      begins++;
      assert.equal(evidence.source.projectRoot, repo);
      assert.equal(isGitCheckoutGated(repo), true);
      assert.equal(isGitCheckoutGated(evidence.request.destinationPath), true);
      writeFileSync(ledger, JSON.stringify(evidence), { flag: "wx", mode: 0o600, flush: true });
      if (failBegin) throw Error("failure after fixture intent publication");
      const exact = readFileSync(ledger, "utf8");
      const assertOwned = () => {
        assert.equal(readFileSync(ledger, "utf8"), exact);
        const effect = boundaryEffect; boundaryEffect = undefined; effect?.();
      };
      return {
        assertOwned,
        async completed(proof) {
          assertOwned(); completions++;
          assert.equal(proof.outcome, "completed"); assert.equal(proof.actionId, evidence.actionId);
          assert.equal(proof.resultOid, git(proof.destination.cwd, "rev-parse", "HEAD"));
          assert.equal(proof.treeOid, git(proof.destination.cwd, "write-tree"));
          assert.equal(proof.status, "clean");
          assert.equal(proof.sourceIndexDigest, evidence.sourceSnapshot.indexDigest);
          assert.equal(proof.sourceTrackedFilesDigest, evidence.sourceSnapshot.trackedFilesDigest);
          if (evidence.parentCreation) {
            assert.equal(proof.knownParentCreation.path, evidence.parentCreation.path);
            assert.equal(proof.knownParentCreation.mode, 0o700);
            assert.equal(statSync(parent).mode & 0o7777, 0o700);
            assert.equal(proof.knownParentCreation.identity.inode, String(statSync(parent).ino));
          } else assert.equal(proof.knownParentCreation, undefined);
          if (failComplete) throw Error("durable completion failed");
          writeFileSync(proofFile, JSON.stringify(proof), { mode: 0o600, flush: true });
          // Only the trusted parent releases its fixture quarantine after proof.
          renameSync(ledger, join(home, `${evidence.actionId}.settled`));
        },
        async recordFailure(evidence) {
          assertOwned(); assert.equal(evidence.recoveryRequired, true);
          writeFileSync(failure, JSON.stringify(evidence), { mode: 0o600, flush: true });
        },
      };
    },
  };
  const request = (branch = "feature", mode = "create") => ({ repositoryPath: repo, sourceCheckoutPath: repo,
    destinationPath: join(parent, branch.replaceAll("/", "-")), branch, baseBranch: "main", expectedBaseOid: oid, mode,
    ...(mode === "attach" ? { expectedTipOid: git(repo, "rev-parse", `refs/heads/${branch}`) } : {}) });
  const current = () => ({ oid: git(repo, "rev-parse", "HEAD"), head: readFileSync(join(repo, ".git", "HEAD")),
    index: readFileSync(join(repo, ".git", "index")), base: readFileSync(join(repo, "base")), ignored: readFileSync(join(repo, "ignored")),
    status: git(repo, "status", "--porcelain=v1"), config: readFileSync(join(repo, ".git", "config")) });
  const authorize = async () => { if (revoked) throw Error("denied live workspace authorization"); };
  return { home, repoParent, repo, parent, oid, admission, request, current, ledger, failure, proofFile,
    prepare: (r = request()) => capture(r, admission),
    apply: (candidate, extra = {}) => apply({ candidate, authorize, ...extra }),
    applyWithAuthority: (candidate, extra = {}) => applyWithAuthority({ candidate, authorize, ...extra }),
    counts: () => ({ begins, completions }),
    revoke: () => { revoked = true; }, failComplete: () => { failComplete = true; }, failBegin: () => { failBegin = true; },
    atBoundary: (effect) => { boundaryEffect = effect; } };
}

test("authority API binds after authorize, fences both effects and preserves native proof identity", async (t) => {
  for (const mode of ["create", "attach"]) await t.test(mode, async (t) => {
    const f = fixture(t, { conventional: true, missingParent: true }), before = f.current();
    if (mode === "attach") git(f.repo, "branch", "feature");
    const candidate = await f.prepare(f.request("feature", mode));
    let bound = false, prepared = "", savedProof;
    const fences = [];
    const begin = f.admission.beginIntent;
    f.admission.beginIntent = async (evidence) => {
      const intent = await begin(evidence);
      return { ...intent, assertOwned(proof) {
        if (proof) { assert.equal(readGitWorkspaceNativeProof(proof).actionId, candidate.actionId); savedProof = proof; }
        intent.assertOwned(proof);
      } };
    };
    const result = await f.applyWithAuthority(candidate, {
      authorize: async () => { bound = true; },
      assertCurrentSync() { assert.equal(bound, true); fences.push(prepared); },
      duringParentLaunch: async () => { await Promise.resolve(); prepared = "mkdir"; },
      duringAddLaunch: async () => { await Promise.resolve(); prepared = "add"; },
    });
    assert.equal(result.status, mode === "create" ? "created" : "attached");
    assert.equal(result.path, candidate.request.destinationPath);
    assert.equal(result.knownParentCreation.mode, 0o700);
    assert.equal(fences.includes("mkdir"), true); assert.equal(fences.at(-1), "add");
    assert.equal(readGitWorkspaceNativeProof(savedProof).resultOid, result.oid);
    assert.equal(readGitWorkspaceNativeProof({ ...savedProof }), undefined);
    assert.equal(readGitWorkspaceNativeProof(JSON.parse(JSON.stringify(savedProof))), undefined);
    assert.deepEqual(f.current(), before); assert.deepEqual(f.counts(), { begins: 1, completions: 1 });
  });
});

test("authority API refuses missing, async, thenable and non-void guards without effects", async (t) => {
  const guards = [undefined, null, true, async () => {}, (() => Promise.resolve()),
    (() => Promise.reject(Error("invalid async assertion"))), (() => ({ then() { throw Error("must not assimilate"); } })),
    (() => false), (() => "approved"), (() => ({}))];
  for (const [i, assertCurrentSync] of guards.entries()) await t.test(String(i), async (t) => {
    const f = fixture(t, { conventional: true, missingParent: true }), before = f.current();
    const candidate = await f.prepare();
    await assert.rejects(f.applyWithAuthority(candidate, { assertCurrentSync }), { code: "invalid-selection" });
    assert.deepEqual(f.current(), before); assert.equal(existsSync(f.parent), false);
    assert.equal(existsSync(candidate.request.destinationPath), false); assert.equal(existsSync(f.ledger), false);
    assert.deepEqual(f.counts(), { begins: 0, completions: 0 });
    assert.equal(git(f.repo, "branch", "--list", "feature"), "");
  });
});

test("authority revoked in the final authorization await refuses before either native effect", async (t) => {
  for (const missingParent of [false, true]) await t.test(String(missingParent), async (t) => {
    const f = fixture(t, { conventional: true, missingParent }), before = f.current();
    const candidate = await f.prepare(); let revoked = false;
    await assert.rejects(f.applyWithAuthority(candidate, {
      authorize: async (phase) => { if (phase === "before-add") { await Promise.resolve(); revoked = true; } },
      assertCurrentSync() { if (revoked) throw Error("authority revoked after final await"); },
    }), { code: "recovery-required" });
    const failure = JSON.parse(readFileSync(f.failure, "utf8"));
    assert.equal(failure.addAttempted, false); assert.notEqual(failure.parentCreationAttempted, true);
    assert.equal(existsSync(f.parent), !missingParent); assert.equal(existsSync(candidate.request.destinationPath), false);
    assert.equal(git(f.repo, "branch", "--list", "feature"), ""); assert.deepEqual(f.current(), before);
    assert.equal(existsSync(f.ledger), true); assert.equal(existsSync(f.proofFile), false);
    assert.equal(isGitCheckoutGated(f.repo), false);
    await assert.rejects(f.prepare(), /unresolved intent/);
  });
});

test("queued microtask revocation during awaited hooks also requires live runtime authority", async (t) => {
  for (const hook of ["afterIntent", "duringFinalPreflight"]) await t.test(hook, async (t) => {
    const f = fixture(t, { conventional: true, missingParent: true }), before = f.current();
    const candidate = await f.prepare(); let revoked = false;
    await assert.rejects(f.applyWithAuthority(candidate, {
      assertCurrentSync() { if (revoked) throw Error("hook microtask revoked authority"); },
      [hook]: async () => { await Promise.resolve(); queueMicrotask(() => { revoked = true; }); },
    }), { code: "recovery-required" });
    const failure = JSON.parse(readFileSync(f.failure, "utf8"));
    assert.equal(failure.addAttempted, false); assert.equal(failure.parentCreationAttempted, false);
    assert.equal(existsSync(f.parent), false); assert.equal(existsSync(candidate.request.destinationPath), false);
    assert.equal(existsSync(f.ledger), true); assert.deepEqual(f.current(), before);
    assert.equal(git(f.repo, "branch", "--list", "feature"), "");
  });
});

test("copied candidate payloads do not gain permission through the authority API", async (t) => {
  const f = fixture(t, { conventional: true, missingParent: true }), candidate = await f.prepare();
  let guardCalls = 0;
  for (const copy of [{ ...candidate }, JSON.parse(JSON.stringify(candidate))]) {
    await assert.rejects(f.applyWithAuthority(copy, { assertCurrentSync() { guardCalls++; } }), { code: "stale" });
  }
  assert.equal(guardCalls, 0); assert.deepEqual(f.counts(), { begins: 0, completions: 0 });
  assert.equal(existsSync(f.parent), false); assert.equal(existsSync(candidate.request.destinationPath), false);
  assert.equal(git(f.repo, "branch", "--list", "feature"), "");
});

test("native effect also requires the intent's synchronous ownership assertion", async (t) => {
  const f = fixture(t, { conventional: true, missingParent: true }), candidate = await f.prepare();
  const begin = f.admission.beginIntent;
  f.admission.beginIntent = async (evidence) => {
    const intent = await begin(evidence);
    return { ...intent, assertOwned: () => Promise.resolve() };
  };
  await assert.rejects(f.applyWithAuthority(candidate, { assertCurrentSync() {} }), { code: "recovery-required" });
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(failure.addAttempted, false); assert.equal(failure.parentCreationAttempted, false);
  assert.equal(existsSync(f.parent), false); assert.equal(existsSync(candidate.request.destinationPath), false);
  assert.equal(existsSync(f.ledger), true); assert.equal(git(f.repo, "branch", "--list", "feature"), "");
});

test("queued microtask revocation during parent launch preparation refuses exclusive mkdir", async (t) => {
  const f = fixture(t, { conventional: true, missingParent: true }), before = f.current();
  const candidate = await f.prepare(); let revoked = false, checkedAfterHook = false;
  await assert.rejects(f.applyWithAuthority(candidate, {
    assertCurrentSync() { if (revoked) { checkedAfterHook = true; throw Error("microtask revoked mkdir authority"); } },
    duringParentLaunch() { queueMicrotask(() => { revoked = true; }); },
  }), { code: "recovery-required" });
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(checkedAfterHook, true); assert.equal(failure.parentCreationAttempted, false);
  assert.equal(failure.parentCreated, false); assert.equal(failure.addAttempted, false);
  assert.equal(existsSync(f.parent), false); assert.equal(existsSync(candidate.request.destinationPath), false);
  assert.equal(git(f.repo, "branch", "--list", "feature"), ""); assert.deepEqual(f.current(), before);
  assert.equal(existsSync(f.ledger), true); assert.deepEqual(f.counts(), { begins: 1, completions: 0 });
});

test("queued microtask revocation after Git launch preparation refuses create AND attach", async (t) => {
  for (const mode of ["create", "attach"]) await t.test(mode, async (t) => {
    const f = fixture(t), before = f.current();
    if (mode === "attach") git(f.repo, "branch", "feature");
    const refs = git(f.repo, "show-ref"), registrations = git(f.repo, "worktree", "list", "--porcelain");
    const candidate = await f.prepare(f.request("feature", mode)); let revoked = false, checkedAfterHook = false;
    await assert.rejects(f.applyWithAuthority(candidate, {
      assertCurrentSync() { if (revoked) { checkedAfterHook = true; throw Error("microtask revoked add authority"); } },
      duringAddLaunch: async () => { await Promise.resolve(); queueMicrotask(() => { revoked = true; }); },
    }), { code: "recovery-required" });
    const failure = JSON.parse(readFileSync(f.failure, "utf8"));
    assert.equal(checkedAfterHook, true); assert.equal(failure.addAttempted, false);
    assert.equal(existsSync(candidate.request.destinationPath), false); assert.deepEqual(f.current(), before);
    assert.equal(git(f.repo, "show-ref"), refs); assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
    assert.equal(existsSync(f.ledger), true); assert.equal(existsSync(f.proofFile), false);
  });
});

test("authority refusal after a measured parent creation retains parent and quarantines intent", async (t) => {
  const f = fixture(t, { conventional: true, missingParent: true }), before = f.current();
  const candidate = await f.prepare(); let revoked = false, parentIdentity;
  await assert.rejects(f.applyWithAuthority(candidate, {
    assertCurrentSync() { if (revoked) throw Error("add authority revoked after mkdir"); },
    duringAddLaunch() {
      parentIdentity = statSync(f.parent).ino;
      queueMicrotask(() => { revoked = true; });
    },
  }), { code: "recovery-required" });
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(failure.parentCreationAttempted, true); assert.equal(failure.parentCreated, true);
  assert.equal(failure.addAttempted, false); assert.equal(failure.knownParentCreation.identity.inode, String(parentIdentity));
  assert.equal(failure.knownParentCreation.mode, 0o700);
  assert.equal(statSync(f.parent).ino, parentIdentity); assert.equal(statSync(f.parent).mode & 0o7777, 0o700);
  assert.equal(existsSync(candidate.request.destinationPath), false); assert.equal(git(f.repo, "branch", "--list", "feature"), "");
  assert.deepEqual(f.current(), before); assert.equal(existsSync(f.ledger), true); assert.equal(existsSync(f.proofFile), false);
  await assert.rejects(f.prepare(), /unresolved intent/);
});

test("captured runtime guard cannot be replaced by a copied/no-op options property", async (t) => {
  const f = fixture(t), candidate = await f.prepare(); let revoked = false;
  const options = { candidate, authorize: async () => {},
    assertCurrentSync() { if (revoked) throw Error("original runtime guard revoked"); },
    duringAddLaunch() { queueMicrotask(() => { revoked = true; options.assertCurrentSync = () => {}; }); },
  };
  await assert.rejects(applyWithAuthority(options), { code: "recovery-required" });
  assert.equal(JSON.parse(readFileSync(f.failure, "utf8")).addAttempted, false);
  assert.equal(existsSync(candidate.request.destinationPath), false); assert.equal(git(f.repo, "branch", "--list", "feature"), "");
});

test("non-void authority at the actual add boundary refuses without starting the child", async (t) => {
  const f = fixture(t), candidate = await f.prepare(); let prepared = false, assimilated = false;
  const thenable = { then() { assimilated = true; } };
  await assert.rejects(f.applyWithAuthority(candidate, {
    assertCurrentSync() { if (prepared) return thenable; },
    duringAddLaunch() { prepared = true; },
  }), { code: "recovery-required" });
  assert.equal(assimilated, false); assert.equal(JSON.parse(readFileSync(f.failure, "utf8")).addAttempted, false);
  assert.equal(existsSync(candidate.request.destinationPath), false); assert.equal(git(f.repo, "branch", "--list", "feature"), "");
});

test("runtime revocation after native launch does not falsify successful measured completion", async (t) => {
  const f = fixture(t), candidate = await f.prepare(); let revoked = false;
  const result = await f.applyWithAuthority(candidate, {
    assertCurrentSync() { if (revoked) throw Error("revoked after native effect"); },
    afterAdd() { revoked = true; },
  });
  assert.equal(result.oid, candidate.resultOid); assert.equal(existsSync(result.path), true);
  assert.equal(existsSync(f.proofFile), true); assert.equal(existsSync(f.ledger), false);
});

test("repeated create/attach preserves source tracked state and the fixture ignored sentinel", async (t) => {
  const f = fixture(t), before = f.current(), phases = [];
  for (const [branch, mode] of [["feature/one", "create"], ["feature-two", "create"], ["existing", "attach"]]) {
    if (mode === "attach") git(f.repo, "branch", branch);
    const r = f.request(branch, mode), p = await f.prepare(r);
    assert.deepEqual(f.current(), before);
    const result = await f.apply(p, { authorize: async (phase) => { phases.push(phase); } });
    assert.equal(result.status, mode === "create" ? "created" : "attached");
    assert.equal(result.path, r.destinationPath); assert.equal(result.oid, f.oid);
    assert.deepEqual(f.current(), before);
    assert.equal(git(result.path, "symbolic-ref", "HEAD"), `refs/heads/${branch}`);
    assert.equal(git(result.path, "status", "--porcelain=v1"), "");
    assert.equal(existsSync(f.ledger), false);
    const proof = JSON.parse(readFileSync(f.proofFile, "utf8"));
    assert.equal(proof.destination.cwd, result.path); assert.match(proof.backlinkDigest, /^[a-f0-9]{64}$/);
    await assert.rejects(f.apply(p));
  }
  assert.deepEqual(phases, ["before-apply", "before-add", "before-apply", "before-add", "before-apply", "before-add"]);
  assert.deepEqual(f.counts(), { begins: 3, completions: 3 });
});

test("ignored dependency/cache trees above tracked bounds do not block source or distinct base", async (t) => {
  const f = fixture(t), base = join(f.home, "base-checkout");
  writeFileSync(join(f.repo, ".gitignore"), "ignored\nnode_modules/\n.next/\n");
  mkdirSync(join(f.repo, "tracked-dir"));
  writeFileSync(join(f.repo, "tracked-dir", "file"), "tracked directory content\n");
  git(f.repo, "add", ".gitignore", "tracked-dir/file"); git(f.repo, "commit", "-qm", "cache ignores and tracked path");
  const oid = git(f.repo, "rev-parse", "HEAD");
  git(f.repo, "worktree", "add", "-qb", "base-branch", base); allowFileRoot(base);
  const sentinel = "ignored cache sentinel, not operation evidence\n";
  for (const checkout of [f.repo, base]) {
    const dependencies = join(checkout, "node_modules"), cache = join(checkout, ".next", "cache");
    mkdirSync(dependencies); mkdirSync(cache, { recursive: true });
    // More than MAX_FILES and MAX_BYTES, without allocating a 65-MiB buffer.
    for (let i = 0; i <= 10000; i++) writeFileSync(join(dependencies, `dependency-${i}`), "");
    writeFileSync(join(dependencies, ".gitattributes"), "* filter=unrelated-ignored-package\n");
    writeFileSync(join(cache, "payload"), ""); truncateSync(join(cache, "payload"), 65 * 1024 * 1024);
    writeFileSync(join(cache, "sentinel"), sentinel);
  }
  const request = { ...f.request(), baseBranch: "base-branch", expectedBaseOid: oid };
  const before = f.current(), baseIndex = readFileSync(git(base, "rev-parse", "--git-path", "index"));
  const candidate = await f.prepare(request);
  const result = await f.apply(candidate);
  assert.equal(result.status, "created"); assert.deepEqual(f.current(), before);
  assert.deepEqual(readFileSync(git(base, "rev-parse", "--git-path", "index")), baseIndex);
  assert.equal(git(base, "status", "--porcelain=v1"), "");
  for (const checkout of [f.repo, base]) {
    // Observe selected fixture sentinels only; do not inventory/hash ignored bytes.
    assert.equal(readFileSync(join(checkout, ".next", "cache", "sentinel"), "utf8"), sentinel);
    assert.equal(statSync(join(checkout, ".next", "cache", "payload")).size, 65 * 1024 * 1024);
    assert.equal(existsSync(join(checkout, "node_modules", ".gitattributes")), true);
  }
  assert.equal(existsSync(join(result.path, "node_modules")), false);
  assert.equal(existsSync(join(result.path, ".next")), false);
  assert.equal(readFileSync(join(result.path, "tracked-dir", "file"), "utf8"), "tracked directory content\n");
  const proof = JSON.parse(readFileSync(f.proofFile, "utf8"));
  assert.match(proof.sourceTrackedFilesDigest, /^[a-f0-9]{64}$/);
  assert.equal("sourceFilesDigest" in proof, false);
});

test("ignored source bytes are not captured or claimed unchanged by completed proof", async (t) => {
  const f = fixture(t), candidate = await f.prepare(), before = f.current();
  writeFileSync(join(f.repo, "ignored"), "external change before apply\n");
  const result = await f.apply(candidate, { afterAdd: () => {
    writeFileSync(join(f.repo, "ignored"), "external change after add\n");
  } });
  assert.equal(result.status, "created");
  assert.deepEqual(f.current(), { ...before, ignored: Buffer.from("external change after add\n") });
  assert.deepEqual(f.counts(), { begins: 1, completions: 1 });
  const proof = JSON.parse(readFileSync(f.proofFile, "utf8"));
  assert.equal("sourceFilesDigest" in proof, false);
  assert.equal("destinationFilesDigest" in proof, false);
});

test("tracked parent directory replacement invalidates an otherwise identical snapshot", async (t) => {
  const f = fixture(t), dir = join(f.repo, "tracked-dir");
  mkdirSync(dir); writeFileSync(join(dir, "file"), "unchanged tracked bytes\n");
  git(f.repo, "add", "tracked-dir/file"); git(f.repo, "commit", "-qm", "tracked directory");
  const request = { ...f.request(), expectedBaseOid: git(f.repo, "rev-parse", "HEAD") };
  const candidate = await f.prepare(request);
  renameSync(dir, join(f.home, "old-tracked-dir"));
  mkdirSync(dir); writeFileSync(join(dir, "file"), "unchanged tracked bytes\n");
  assert.equal(git(f.repo, "status", "--porcelain=v1"), "");
  await assert.rejects(f.apply(candidate), (error) => error.code === "stale");
  assert.deepEqual(f.counts(), { begins: 0, completions: 0 });
  assert.equal(existsSync(request.destinationPath), false);
});

test("oversized tracked tree still refuses explicitly before intent", async (t) => {
  const f = fixture(t), path = join(f.repo, "oversized-tracked");
  writeFileSync(path, ""); truncateSync(path, 64 * 1024 * 1024 + 1);
  git(f.repo, "add", "oversized-tracked"); git(f.repo, "commit", "-qm", "oversized tracked tree");
  const request = { ...f.request(), expectedBaseOid: git(f.repo, "rev-parse", "HEAD") };
  await assert.rejects(f.prepare(request), (error) => error.code === "unsafe");
  assert.deepEqual(f.counts(), { begins: 0, completions: 0 });
  assert.equal(existsSync(request.destinationPath), false); assert.equal(existsSync(f.ledger), false);
});

test("first absent conventional parent is disclosed and exclusively created for create/attach, then reused", async (t) => {
  for (const mode of ["create", "attach"]) {
    const f = fixture(t, { conventional: true, missingParent: true }), base = join(f.home, "checked-base");
    git(f.repo, "worktree", "add", "-qb", "base-branch", base); allowFileRoot(base);
    if (mode === "attach") git(f.repo, "branch", "existing", f.oid);
    const request = { ...f.request(mode === "attach" ? "existing" : "first", mode), baseBranch: "base-branch" };
    const before = f.current(), mainRef = readFileSync(join(f.repo, ".git", "refs", "heads", "main"));
    const baseIndex = readFileSync(git(base, "rev-parse", "--git-path", "index"));
    const candidate = await f.prepare(request);
    assert.equal(existsSync(f.parent), false); assert.equal(existsSync(f.ledger), false);
    assert.equal(candidate.parentCreation.path, f.parent);
    assert.equal(candidate.parentCreation.expectedAbsent, true);
    assert.equal(candidate.parentCreation.ancestorPath, f.repoParent);
    assert.equal(candidate.parentCreation.ancestorIdentity.inode, String(statSync(f.repoParent).ino));
    assert.equal(candidate.parentCreation.mode, 0o700);
    const phases = [];
    const result = await f.apply(candidate, { authorize: async (phase, exact) => {
      assert.equal(exact, candidate); phases.push(phase);
      if (phases.length === 2) { assert.equal(existsSync(f.ledger), true); assert.equal(existsSync(f.parent), false); }
    } });
    assert.equal(result.status, mode === "create" ? "created" : "attached");
    assert.deepEqual(phases, ["before-apply", "before-add", "before-add"]);
    assert.equal(result.knownParentCreation.path, f.parent);
    assert.equal(result.knownParentCreation.mode, 0o700);
    assert.equal(result.knownParentCreation.ownerUid, process.geteuid());
    assert.equal(result.knownParentCreation.identity.inode, String(statSync(f.parent).ino));
    const proof = JSON.parse(readFileSync(f.proofFile, "utf8"));
    assert.deepEqual(proof.knownParentCreation, result.knownParentCreation);
    assert.deepEqual(f.current(), before);
    assert.deepEqual(readFileSync(join(f.repo, ".git", "refs", "heads", "main")), mainRef);
    assert.deepEqual(readFileSync(git(base, "rev-parse", "--git-path", "index")), baseIndex);
    assert.equal(git(base, "status", "--porcelain=v1"), "");
    assert.equal(git(f.repo, "worktree", "list", "--porcelain").split("worktree ").length - 1, 3);
    const { getAllowedFileRoots } = await jiti.import("./file-access.ts");
    assert.equal((await getAllowedFileRoots()).has(f.parent), false);
    for (const [branch, repeatMode] of [["repeat-create", "create"], ["repeat-attach", "attach"]]) {
      if (repeatMode === "attach") git(f.repo, "branch", branch, f.oid);
      const next = await f.prepare({ ...f.request(branch, repeatMode), baseBranch: "base-branch" });
      assert.equal(next.parentCreation, undefined);
      const repeated = await f.apply(next);
      assert.equal(repeated.knownParentCreation, undefined);
      assert.equal(statSync(f.parent).ino, Number(result.knownParentCreation.identity.inode));
      assert.deepEqual(f.current(), before);
      assert.deepEqual(readFileSync(git(base, "rev-parse", "--git-path", "index")), baseIndex);
    }
    assert.deepEqual(f.counts(), { begins: 3, completions: 3 });
  }
});

test("only the exact independently verified proof authenticates inventory addition, even on publisher failure", async (t) => {
  for (const publisherFails of [false, true]) {
    const f = fixture(t, { conventional: true, missingParent: true });
    const initialInventory = git(f.repo, "worktree", "list", "--porcelain");
    const begin = f.admission.beginIntent;
    let originalAssertions = 0, verifiedAssertions = 0, proofHandle;
    f.admission.beginIntent = async (evidence) => {
      const intent = await begin(evidence);
      return { ...intent,
        assertOwned(proof) {
          if (proof === undefined) {
            originalAssertions++;
            assert.equal(git(f.repo, "worktree", "list", "--porcelain"), initialInventory);
          } else {
            verifiedAssertions++;
            const measured = readGitWorkspaceNativeProof(proof);
            assert.deepEqual(measured, proof); assert.notEqual(measured, proof);
            assert.equal(measured.actionId, evidence.actionId);
            assert.equal(measured.destination.cwd, evidence.request.destinationPath);
            assert.equal(measured.knownParentCreation.path, f.parent);
            assert.equal(git(measured.destination.cwd, "rev-parse", "HEAD"), measured.resultOid);
            assert.equal(git(measured.destination.cwd, "status", "--porcelain=v1"), "");
            assert.equal(readGitWorkspaceNativeProof(structuredClone(proof)), undefined);
            assert.equal(readGitWorkspaceNativeProof(JSON.parse(JSON.stringify(proof))), undefined);
            assert.throws(() => { measured.destination.cwd = "/forged"; }, TypeError);
            proofHandle = proof;
          }
          intent.assertOwned();
        },
        async completed(proof) {
          assert.equal(proof, proofHandle);
          assert.equal(readGitWorkspaceNativeProof(proof).resultOid, evidence.resultOid);
          return intent.completed(proof);
        },
      };
    };
    assert.equal(readGitWorkspaceNativeProof(null), undefined);
    assert.equal(readGitWorkspaceNativeProof("history-action-id"), undefined);
    assert.equal(readGitWorkspaceNativeProof({ outcome: "completed" }), undefined);
    const candidate = await f.prepare();
    assert.equal(readGitWorkspaceNativeProof(candidate), undefined);
    if (publisherFails) {
      f.failComplete();
      await assert.rejects(f.apply(candidate), (error) => error.code === "recovery-required");
      assert.equal(existsSync(f.ledger), true); assert.equal(existsSync(f.proofFile), false);
      assert.equal(JSON.parse(readFileSync(f.failure, "utf8")).phase, "completed-record");
    } else assert.equal((await f.apply(candidate)).status, "created");
    assert.equal(originalAssertions, 2); assert.equal(verifiedAssertions, 1);
    // Native known facts survive a failed publisher; they do NOT attest release,
    // durable completion, or cleanup eligibility/authority.
    assert.equal(readGitWorkspaceNativeProof(proofHandle).resultOid, f.oid);
    assert.equal(existsSync(f.request().destinationPath), true);
  }
});

test("missing parent is conventional-only: aliases, occupancy, permissions and overlaps refuse before intent", async (t) => {
  for (const kind of ["arbitrary", "ancestor-chain", "symlink", "dangling", "file", "readonly-ancestor", "git-namespace", "root", "main"]) {
    const f = fixture(t, { conventional: true, missingParent: true }), request = f.request();
    if (kind === "arbitrary") request.destinationPath = join(f.home, "arbitrary-missing", "feature");
    if (kind === "ancestor-chain") request.destinationPath = join(f.home, "missing", "chain", "feature");
    if (kind === "symlink") { mkdirSync(join(f.home, "outside")); symlinkSync(join(f.home, "outside"), f.parent); }
    if (kind === "dangling") symlinkSync(join(f.home, "missing"), f.parent);
    if (kind === "file") writeFileSync(f.parent, "do not overwrite\n");
    if (kind === "readonly-ancestor") chmodSync(f.repoParent, 0o555);
    if (kind === "git-namespace") request.destinationPath = join(f.repo, ".git", "refs", "heads", "feature");
    if (kind === "root") request.destinationPath = "/";
    if (kind === "main") request.destinationPath = f.repo;
    // Even a broadly allowed parent is not permission for arbitrary mkdir chains.
    allowFileRoot(f.home);
    const before = f.current();
    try { await assert.rejects(f.prepare(request)); }
    finally { if (kind === "readonly-ancestor") chmodSync(f.repoParent, 0o700); }
    assert.deepEqual(f.current(), before); assert.deepEqual(f.counts(), { begins: 0, completions: 0 });
    if (!["symlink", "dangling", "file"].includes(kind)) assert.equal(existsSync(f.parent), false);
  }
});

test("stale nearest ancestor or newly occupied parent cannot be adopted", async (t) => {
  for (const kind of ["replaced-ancestor", "symlink-ancestor", "dangling-ancestor", "occupied-parent", "parent-link"]) {
    const f = fixture(t, { conventional: true, missingParent: true, isolatedNamespace: true });
    const candidate = await f.prepare(), before = f.current();
    let originalRepo = f.repo;
    if (kind.endsWith("ancestor")) {
      const original = `${f.repoParent}-original`;
      renameSync(f.repoParent, original); originalRepo = join(original, "repo");
      if (kind === "replaced-ancestor") mkdirSync(f.repoParent);
      if (kind === "symlink-ancestor") symlinkSync(original, f.repoParent);
      if (kind === "dangling-ancestor") symlinkSync(join(f.home, "missing"), f.repoParent);
    } else if (kind === "occupied-parent") { mkdirSync(f.parent); writeFileSync(join(f.parent, "keep"), "external parent\n"); }
    else symlinkSync(join(f.home, "missing"), f.parent);
    await assert.rejects(f.apply(candidate)); assert.deepEqual(f.counts(), { begins: 0, completions: 0 });
    assert.deepEqual(readFileSync(join(originalRepo, ".git", "HEAD")), before.head);
    assert.deepEqual(readFileSync(join(originalRepo, ".git", "index")), before.index);
    assert.equal(git(originalRepo, "rev-parse", "HEAD"), before.oid);
    assert.equal(existsSync(f.ledger), false);
    if (kind === "occupied-parent") assert.equal(readFileSync(join(f.parent, "keep"), "utf8"), "external parent\n");
  }
});

test("revocation before parent mkdir has no filesystem effects; revocation after it retains parent", async (t) => {
  for (const when of ["before-parent", "after-parent"]) {
    const f = fixture(t, { conventional: true, missingParent: true }), candidate = await f.prepare(), before = f.current();
    await assert.rejects(f.apply(candidate, when === "before-parent" ?
      { duringFinalPreflight: () => { f.revoke(); } } : { afterParentCreate: () => { f.revoke(); } }),
    (error) => error.code === "recovery-required");
    assert.deepEqual(f.current(), before); assert.equal(existsSync(f.ledger), true);
    assert.equal(existsSync(f.parent), when === "after-parent");
    assert.equal(existsSync(f.request().destinationPath), false);
    const failure = JSON.parse(readFileSync(f.failure, "utf8"));
    assert.equal(failure.parentCreated, when === "after-parent");
    assert.equal(failure.addAttempted, false); assert.equal(f.counts().completions, 0);
    if (when === "after-parent") assert.equal(failure.knownParentCreation.path, f.parent);
  }
});

test("post-mkdir failure/replaced directory/mode changes preserve parent and quarantine without Git add", async (t) => {
  for (const kind of ["throw", "replace", "symlink", "mode", "source-marker"]) {
    const f = fixture(t, { conventional: true, missingParent: true }), candidate = await f.prepare(), before = f.current();
    await assert.rejects(f.apply(candidate, { afterParentCreate: () => {
      if (kind === "throw") throw Error("injected after mkdir");
      if (kind === "replace" || kind === "symlink") {
        renameSync(f.parent, `${f.parent}-owned`);
        if (kind === "replace") mkdirSync(f.parent, { mode: 0o700 });
        else { mkdirSync(join(f.home, "decoy")); symlinkSync(join(f.home, "decoy"), f.parent); }
      }
      if (kind === "mode") chmodSync(f.parent, 0o755);
      if (kind === "source-marker") symlinkSync(join(f.home, "missing"), join(f.repo, ".git", "MERGE_HEAD"));
    } }), (error) => error.code === "recovery-required");
    assert.deepEqual(f.current(), before);
    assert.equal(existsSync(f.ledger), true); assert.equal(existsSync(f.parent), true);
    assert.equal(existsSync(f.request().destinationPath), false);
    const failure = JSON.parse(readFileSync(f.failure, "utf8"));
    assert.equal(failure.parentCreated, true); assert.equal(failure.addAttempted, false);
    assert.equal(failure.knownParentCreation.path, f.parent);
    assert.equal(failure.phase, "after-parent"); assert.equal(f.counts().completions, 0);
    await assert.rejects(f.prepare(f.request("again")));
  }
});

test("exclusive mkdir never overwrites late parent occupancy", async (t) => {
  const f = fixture(t, { conventional: true, missingParent: true }), candidate = await f.prepare(), before = f.current();
  f.atBoundary(() => { mkdirSync(f.parent); writeFileSync(join(f.parent, "keep"), "late external parent\n"); });
  await assert.rejects(f.apply(candidate), (error) => error.code === "recovery-required");
  assert.deepEqual(f.current(), before); assert.equal(readFileSync(join(f.parent, "keep"), "utf8"), "late external parent\n");
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(failure.phase, "create-parent"); assert.equal(failure.parentCreationAttempted, true);
  assert.equal(failure.parentCreated, false); assert.equal(failure.knownParentCreation, undefined);
  assert.equal(failure.addAttempted, false); assert.equal(existsSync(f.ledger), true);
});

test("pinned nearest ancestor cannot redirect mkdir into a replacement namespace", async (t) => {
  const f = fixture(t, { conventional: true, missingParent: true, isolatedNamespace: true }), candidate = await f.prepare();
  const before = f.current(), original = `${f.repoParent}-original`;
  f.atBoundary(() => { renameSync(f.repoParent, original); mkdirSync(f.repoParent); });
  await assert.rejects(f.apply(candidate), (error) => error.code === "recovery-required");
  const originalRepo = join(original, "repo");
  assert.deepEqual(readFileSync(join(originalRepo, ".git", "HEAD")), before.head);
  assert.deepEqual(readFileSync(join(originalRepo, ".git", "index")), before.index);
  assert.deepEqual(readFileSync(join(originalRepo, "base")), before.base);
  assert.equal(git(originalRepo, "rev-parse", "HEAD"), before.oid);
  assert.equal(existsSync(f.parent), false); // no write through replacement pathname
  assert.equal(existsSync(join(original, "repo-worktrees")), true); // original created directory retained
  assert.equal(existsSync(f.ledger), true);
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(failure.parentCreated, true); assert.equal(failure.addAttempted, false);
  assert.equal(failure.phase, "create-parent"); assert.equal(f.counts().completions, 0);
});

test("post-parent native failure retains measured parent and exact original source/base state", async (t) => {
  const f = fixture(t, { conventional: true, missingParent: true }), base = join(f.home, "checked-base");
  git(f.repo, "worktree", "add", "-qb", "base-branch", base); allowFileRoot(base);
  const candidate = await f.prepare({ ...f.request(), baseBranch: "base-branch" }), before = f.current();
  const ref = readFileSync(join(f.repo, ".git", "refs", "heads", "main")), tree = git(f.repo, "rev-parse", "HEAD^{tree}");
  const baseIndex = readFileSync(git(base, "rev-parse", "--git-path", "index"));
  await assert.rejects(f.apply(candidate, { afterParentCreate: () => {
    f.atBoundary(() => { mkdirSync(f.request().destinationPath); writeFileSync(join(f.request().destinationPath, "keep"), "late occupancy\n"); });
  } }), (error) => error.code === "recovery-required");
  assert.deepEqual(f.current(), before); assert.deepEqual(readFileSync(join(f.repo, ".git", "refs", "heads", "main")), ref);
  assert.equal(git(f.repo, "rev-parse", "HEAD^{tree}"), tree);
  assert.deepEqual(readFileSync(git(base, "rev-parse", "--git-path", "index")), baseIndex);
  assert.equal(git(base, "status", "--porcelain=v1"), "");
  assert.equal(existsSync(f.parent), true); assert.equal(statSync(f.parent).mode & 0o7777, 0o700);
  assert.equal(readFileSync(join(f.request().destinationPath, "keep"), "utf8"), "late occupancy\n");
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(failure.phase, "add"); assert.equal(failure.parentCreated, true); assert.equal(failure.addAttempted, true);
  assert.equal(failure.knownParentCreation.identity.inode, String(statSync(f.parent).ino));
  assert.equal(existsSync(f.ledger), true); assert.equal(f.counts().completions, 0);
  await assert.rejects(f.prepare(f.request("another")), /unresolved/);
});

test("existing physical conventional sibling is permitted, no implicit parent mkdir or root widening", async (t) => {
  const f = fixture(t, { conventional: true });
  const result = await f.apply(await f.prepare());
  assert.equal(result.status, "created");
  const { getAllowedFileRoots } = await jiti.import("./file-access.ts");
  assert.equal((await getAllowedFileRoots()).has(f.parent), false);
  const g = fixture(t, { missingParent: true });
  await assert.rejects(g.prepare()); assert.equal(existsSync(g.parent), false);
});

test("copied/forged and denied candidates never publish intent; single-use on denial or busy gate", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  await assert.rejects(f.apply(structuredClone(p))); await assert.rejects(f.apply(JSON.parse(JSON.stringify(p))));
  assert.deepEqual(f.current(), before); assert.equal(f.counts().begins, 0);
  f.revoke(); await assert.rejects(f.apply(p), /denied/); await assert.rejects(f.apply(p));
  assert.equal(f.counts().begins, 0);
  const g = fixture(t), q = await g.prepare();
  const release = acquireGitCheckoutGate([g.repo]);
  try { await assert.rejects(g.apply(q), /busy/); } finally { release(); }
  await assert.rejects(g.apply(q)); assert.equal(g.counts().begins, 0);
  await assert.rejects(apply({ candidate: await g.prepare() }));
});

test("explicit mode/local full tips/physical roots required; allowFileRoot is not create authority", async (t) => {
  const f = fixture(t), r = f.request();
  for (const change of [{ mode: undefined }, { expectedBaseOid: "HEAD" }, { baseBranch: "origin/main" },
    { branch: "main" }, { mode: "attach", expectedTipOid: f.oid }, { repositoryPath: join(f.repo, "subdir") },
    { destinationPath: join(f.home, "unauthorized", "x") }]) {
    if (change.destinationPath) mkdirSync(join(f.home, "unauthorized"));
    await assert.rejects(f.prepare({ ...r, ...change }));
  }
  git(f.repo, "branch", "existing");
  await assert.rejects(f.prepare({ ...r, branch: "existing" }));
  await assert.rejects(f.prepare({ ...f.request("existing", "attach"), expectedTipOid: "0".repeat(40) }));
  assert.equal(f.counts().begins, 0);
});

test("stale source/base/index/config/registration candidates refuse before intent", async (t) => {
  for (const race of ["source", "index", "config", "registration", "parent"]) {
    const f = fixture(t), p = await f.prepare();
    if (race === "source") git(f.repo, "commit", "--allow-empty", "-qm", "moved");
    if (race === "index") git(f.repo, "update-index", "--assume-unchanged", "base");
    if (race === "config") git(f.repo, "config", "user.name", "Changed");
    if (race === "registration") git(f.repo, "worktree", "add", "-qb", "other", join(f.home, "other"));
    if (race === "parent") { renameSync(f.parent, `${f.parent}-old`); mkdirSync(f.parent); }
    const before = f.current();
    await assert.rejects(f.apply(p)); assert.deepEqual(f.current(), before);
    assert.equal(f.counts().begins, 0); assert.equal(existsSync(f.request().destinationPath), false);
  }
});

test("occupied, ignored occupancy and dangling symlinks are not absent destinations", async (t) => {
  for (const kind of ["directory", "file", "dangling", "symlink-parent"]) {
    const f = fixture(t), path = f.request().destinationPath;
    if (kind === "directory") mkdirSync(path);
    if (kind === "file") writeFileSync(path, "keep\n");
    if (kind === "dangling") symlinkSync(join(f.home, "missing"), path);
    if (kind === "symlink-parent") { renameSync(f.parent, `${f.parent}-old`); symlinkSync(`${f.parent}-old`, f.parent); }
    await assert.rejects(f.prepare()); assert.equal(f.counts().begins, 0);
  }
  const f = fixture(t), p = await f.prepare();
  mkdirSync(f.request().destinationPath); writeFileSync(join(f.request().destinationPath, "ignored"), "do not overwrite\n");
  await assert.rejects(f.apply(p));
  assert.equal(readFileSync(join(f.request().destinationPath, "ignored"), "utf8"), "do not overwrite\n");
});

test("markers, hooks, filters, signing, attributes, sparse flags fail closed without executing programs", async (t) => {
  for (const kind of ["marker", "marker-link", "hook", "filter", "signing", "attributes", "info-attributes", "sparse"]) {
    const f = fixture(t), sentinel = join(f.home, "executed");
    if (kind === "marker") writeFileSync(join(f.repo, ".git", "MERGE_HEAD"), f.oid);
    if (kind === "marker-link") symlinkSync(join(f.home, "missing"), join(f.repo, ".git", "rebase-merge"));
    if (kind === "hook") writeFileSync(join(f.repo, ".git", "hooks", "post-checkout"), `#!/bin/sh\ntouch '${sentinel}'\n`, { mode: 0o755 });
    if (kind === "filter") git(f.repo, "config", "filter.test.clean", `touch '${sentinel}'`);
    if (kind === "signing") git(f.repo, "config", "commit.gpgsign", "true");
    if (kind === "attributes") writeFileSync(join(f.repo, ".gitattributes"), "* filter=test\n");
    if (kind === "info-attributes") writeFileSync(join(f.repo, ".git", "info", "attributes"), "* filter=test\n");
    if (kind === "sparse") git(f.repo, "config", "core.sparseCheckout", "true");
    await assert.rejects(f.prepare()); assert.equal(existsSync(sentinel), false); assert.equal(f.counts().begins, 0);
  }
});

test("attach binds a distinct tip/tree, detects tip race and refuses already checked-out branch", async (t) => {
  const f = fixture(t);
  const content = join(f.home, "attached-content"), index = join(f.home, "attached-index");
  writeFileSync(content, "different attached tree\n");
  const blob = git(f.repo, "hash-object", "-w", content);
  const indexGit = (...args) => execFileSync("git", ["--no-optional-locks", "-C", f.repo, ...args],
    { encoding: "utf8", env: { ...process.env, GIT_INDEX_FILE: index }, stdio: ["ignore", "pipe", "pipe"] }).trim();
  indexGit("read-tree", f.oid);
  indexGit("update-index", "--cacheinfo", "100644", blob, "base");
  const differentTree = indexGit("write-tree");
  assert.notEqual(differentTree, git(f.repo, "rev-parse", `${f.oid}^{tree}`));
  const different = git(f.repo, "commit-tree", differentTree, "-p", f.oid, "-m", "existing branch commit");
  git(f.repo, "branch", "existing", different);
  const r = f.request("existing", "attach"), p = await f.prepare(r), before = f.current();
  assert.equal(p.treeOid, differentTree);
  const result = await f.apply(p); assert.equal(result.oid, different); assert.equal(result.treeOid, differentTree);
  assert.equal(readFileSync(join(result.path, "base"), "utf8"), "different attached tree\n");
  assert.deepEqual(f.current(), before);
  await assert.rejects(f.prepare({ ...r, destinationPath: join(f.parent, "another") }));
  const g = fixture(t); git(g.repo, "branch", "existing");
  const q = await g.prepare(g.request("existing", "attach"));
  const changed = git(g.repo, "commit-tree", `${g.oid}^{tree}`, "-p", g.oid, "-m", "moved");
  git(g.repo, "update-ref", "refs/heads/existing", changed);
  await assert.rejects(g.apply(q)); assert.equal(g.counts().begins, 0);
});

test("checked-out distinct base must be safe and preserved", async (t) => {
  const f = fixture(t), base = join(f.home, "base-checkout");
  git(f.repo, "worktree", "add", "-qb", "base-branch", base); allowFileRoot(base);
  const r = { ...f.request(), baseBranch: "base-branch" };
  const p = await f.prepare(r), oldIndex = readFileSync(git(base, "rev-parse", "--git-path", "index"));
  const result = await f.apply(p); assert.equal(result.status, "created");
  assert.deepEqual(readFileSync(git(base, "rev-parse", "--git-path", "index")), oldIndex);
  const r2 = { ...f.request("second"), baseBranch: "base-branch" };
  writeFileSync(join(base, "dirty"), "keep\n"); await assert.rejects(f.prepare(r2));
});

test("after intent/add/completion failures retain evidence and resources without rollback or retry", async (t) => {
  for (const stage of ["afterIntent", "afterAdd", "complete", "begin"]) {
    const f = fixture(t), p = await f.prepare(), before = f.current();
    if (stage === "complete") f.failComplete();
    if (stage === "begin") f.failBegin();
    await assert.rejects(f.apply(p, { ...(stage === "afterIntent" || stage === "afterAdd" ?
      { [stage]: () => { throw Error("injected failure"); } } : {}) }), (error) => error.code === "recovery-required");
    assert.equal(existsSync(f.ledger), true); assert.deepEqual(f.current(), before);
    assert.equal(existsSync(f.request().destinationPath), stage === "afterAdd" || stage === "complete");
    if (stage !== "begin") {
      const evidence = JSON.parse(readFileSync(f.failure, "utf8"));
      assert.equal(evidence.addAttempted, stage !== "afterIntent"); assert.equal(evidence.recoveryRequired, true);
    }
    await assert.rejects(f.apply(p)); await assert.rejects(f.prepare(f.request("again")), /unresolved/);
    assert.equal(isGitCheckoutGated(f.repo), false);
  }
});

test("late denied/ref/hook/marker/occupied races after intent never reach add", async (t) => {
  for (const kind of ["denied", "ref", "hook", "filter", "marker", "occupied"]) {
    const f = fixture(t), p = await f.prepare();
    await assert.rejects(f.apply(p, { afterIntent: () => {
      if (kind === "denied") f.revoke();
      if (kind === "ref") git(f.repo, "commit", "--allow-empty", "-qm", "moved");
      if (kind === "hook") writeFileSync(join(f.repo, ".git", "hooks", "post-checkout"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
      if (kind === "filter") git(f.repo, "config", "filter.test.clean", "exit 1");
      if (kind === "marker") symlinkSync(join(f.home, "missing"), join(f.repo, ".git", "MERGE_HEAD"));
      if (kind === "occupied") { mkdirSync(f.request().destinationPath); writeFileSync(join(f.request().destinationPath, "keep"), "keep\n"); }
    } }), (error) => error.code === "recovery-required");
    assert.equal(JSON.parse(readFileSync(f.failure, "utf8")).addAttempted, false);
    assert.equal(git(f.repo, "show-ref", "--heads").includes("refs/heads/feature"), false);
    assert.equal(f.counts().completions, 0);
  }
});

test("revocation while final exact preflight is delayed cannot reach native add", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  const refs = git(f.repo, "show-ref"), registrations = git(f.repo, "worktree", "list", "--porcelain");
  let entered, resume;
  const paused = new Promise((resolve) => { entered = resolve; });
  const resumed = new Promise((resolve) => { resume = resolve; });
  let revoked = false;
  const phases = [];
  const applying = f.apply(p, {
    duringFinalPreflight: async () => { entered(); await resumed; },
    authorize: async (phase) => {
      phases.push(phase);
      if (revoked) throw Error("revoked during final preflight");
    },
  });
  await paused;
  try {
    assert.deepEqual(phases, ["before-apply"]);
    assert.equal(existsSync(f.ledger), true);
    assert.equal(existsSync(f.request().destinationPath), false);
    revoked = true;
  } finally { resume(); }
  await assert.rejects(applying, (error) => error.code === "recovery-required");
  assert.deepEqual(phases, ["before-apply", "before-add"]);
  assert.deepEqual(f.current(), before);
  assert.equal(git(f.repo, "show-ref"), refs);
  assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
  assert.equal(existsSync(f.request().destinationPath), false);
  assert.deepEqual(f.counts(), { begins: 1, completions: 0 });
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(failure.phase, "before-add"); assert.equal(failure.addAttempted, false);
  assert.equal(existsSync(f.ledger), true);
});

test("tree execute modes are verified independently when core.fileMode is false", async (t) => {
  for (const executable of [false, true]) {
    const f = fixture(t);
    if (executable) {
      chmodSync(join(f.repo, "base"), 0o755);
      git(f.repo, "update-index", "--chmod=+x", "base");
      git(f.repo, "commit", "-qm", "executable base");
    }
    git(f.repo, "config", "core.fileMode", "false");
    const r = { ...f.request(), expectedBaseOid: git(f.repo, "rev-parse", "HEAD") };
    const p = await f.prepare(r), before = f.current();
    await assert.rejects(f.apply(p, { afterAdd: () => {
      chmodSync(join(r.destinationPath, "base"), executable ? 0o644 : 0o755);
      // Demonstrate why Git status alone would falsely attest a clean result.
      assert.equal(git(r.destinationPath, "status", "--porcelain=v1"), "");
    } }), (error) => error.code === "recovery-required");
    assert.deepEqual(f.current(), before);
    assert.equal(f.counts().completions, 0); assert.equal(existsSync(f.proofFile), false);
    assert.equal(existsSync(r.destinationPath), true); assert.equal(existsSync(f.ledger), true);
    assert.equal(JSON.parse(readFileSync(f.failure, "utf8")).phase, "verify");
  }
  const f = fixture(t);
  git(f.repo, "config", "core.fileMode", "false");
  assert.equal((await f.apply(await f.prepare())).status, "created");
});

test("relative worktree path policy refuses before intent without changing config", async (t) => {
  for (const stage of ["capture", "apply"]) {
    const f = fixture(t), p = stage === "apply" ? await f.prepare() : null;
    git(f.repo, "config", "worktree.useRelativePaths", "true");
    git(f.repo, "config", "user.name", "Config sentinel must remain");
    const before = f.current(), refs = git(f.repo, "show-ref"), registrations = git(f.repo, "worktree", "list", "--porcelain");
    if (p) await assert.rejects(f.apply(p)); else await assert.rejects(f.prepare());
    assert.deepEqual(f.current(), before);
    assert.equal(git(f.repo, "config", "worktree.useRelativePaths"), "true");
    assert.equal(git(f.repo, "show-ref"), refs);
    assert.equal(git(f.repo, "worktree", "list", "--porcelain"), registrations);
    assert.equal(existsSync(f.request().destinationPath), false);
    assert.equal(existsSync(f.ledger), false); assert.equal(existsSync(f.proofFile), false);
    assert.deepEqual(f.counts(), { begins: 0, completions: 0 });
  }
});

test("actual-result validation catches post-add ref/index/backlink/source interference without deleting effects", async (t) => {
  for (const kind of ["ref", "index", "backlink", "source", "ignored-destination", "ignored-empty-directory", "content"]) {
    const f = fixture(t), p = await f.prepare(), dest = f.request().destinationPath;
    await assert.rejects(f.apply(p, { afterAdd: () => {
      if (kind === "ref") git(dest, "commit", "--allow-empty", "-qm", "external changed tip");
      if (kind === "index") git(dest, "update-index", "--assume-unchanged", "base");
      if (kind === "backlink") writeFileSync(join(git(dest, "rev-parse", "--absolute-git-dir"), "gitdir"), `${join(f.repo, ".git")}\n`);
      if (kind === "source") writeFileSync(join(f.repo, "base"), "external source writer\n");
      if (kind === "ignored-destination") writeFileSync(join(dest, "ignored"), "external ignored data\n");
      if (kind === "ignored-empty-directory") {
        mkdirSync(join(dest, "ignored"));
        assert.equal(git(dest, "status", "--porcelain=v1"), "");
      }
      if (kind === "content") writeFileSync(join(dest, "base"), "wrong content!\n");
    } }), (error) => error.code === "recovery-required");
    assert.equal(existsSync(dest), true); assert.equal(existsSync(f.ledger), true); assert.equal(f.counts().completions, 0);
    assert.equal(JSON.parse(readFileSync(f.failure, "utf8")).addAttempted, true);
  }
});

test("expired handles and physically replaced identical index are stale, not reusable", async (t) => {
  const f = fixture(t), p = await f.prepare(), now = Date.now;
  Date.now = () => now() + 300001;
  try { await assert.rejects(f.apply(p), (error) => error.code === "stale"); }
  finally { Date.now = now; }
  await assert.rejects(f.apply(p)); assert.equal(f.counts().begins, 0);
  const g = fixture(t), q = await g.prepare(), index = join(g.repo, ".git", "index");
  const contents = readFileSync(index); renameSync(index, `${index}-old`); writeFileSync(index, contents);
  await assert.rejects(g.apply(q)); assert.equal(g.counts().begins, 0);
});

test("namespace symlinks, dangling/valid symbolic branch refs and conditional config refuse", async (t) => {
  for (const kind of ["logs", "worktrees", "packed-refs", "dangling-ref", "attach-symref", "includeif", "destination-inside-source"]) {
    const f = fixture(t), r = f.request();
    if (kind === "logs") { renameSync(join(f.repo, ".git", "logs"), join(f.home, "logs")); symlinkSync(join(f.home, "logs"), join(f.repo, ".git", "logs")); }
    if (kind === "worktrees") symlinkSync(join(f.home, "missing"), join(f.repo, ".git", "worktrees"));
    if (kind === "packed-refs") symlinkSync(join(f.home, "missing"), join(f.repo, ".git", "packed-refs"));
    if (kind === "dangling-ref") git(f.repo, "symbolic-ref", "refs/heads/feature", "refs/heads/missing");
    if (kind === "attach-symref") { git(f.repo, "symbolic-ref", "refs/heads/feature", "refs/heads/main"); r.mode = "attach"; r.expectedTipOid = f.oid; }
    if (kind === "includeif") git(f.repo, "config", "includeIf.gitdir:/not-active/.path", join(f.home, "not-active"));
    if (kind === "destination-inside-source") r.destinationPath = join(f.repo, "new-tree");
    await assert.rejects(f.prepare(r)); assert.equal(f.counts().begins, 0);
  }
});

test("canonical repository plus linked physical source never falls back to main", async (t) => {
  const f = fixture(t), source = join(f.home, "source");
  git(f.repo, "worktree", "add", "-qb", "source-branch", source); allowFileRoot(source);
  writeFileSync(join(source, "feature-file"), "linked source\n"); git(source, "add", "feature-file"); git(source, "commit", "-qm", "source");
  const indexPath = git(source, "rev-parse", "--git-path", "index"), originalIndex = readFileSync(indexPath);
  const r = { ...f.request(), sourceCheckoutPath: source };
  const p = await f.prepare(r); assert.notEqual(p.sourceOid, f.oid);
  const result = await f.apply(p); assert.equal(result.oid, f.oid);
  assert.equal(existsSync(join(result.path, "feature-file")), false);
  assert.deepEqual(readFileSync(indexPath), originalIndex); assert.equal(readFileSync(join(source, "feature-file"), "utf8"), "linked source\n");
  await assert.rejects(f.prepare({ ...f.request("another"), repositoryPath: source, sourceCheckoutPath: source }));
});

test("native add failure retains late occupied destination and unresolved intent", async (t) => {
  const f = fixture(t), p = await f.prepare(), dest = f.request().destinationPath, before = f.current();
  f.atBoundary(() => { mkdirSync(dest); writeFileSync(join(dest, "keep"), "late external data\n"); });
  await assert.rejects(f.apply(p), (error) => error.code === "recovery-required");
  assert.equal(readFileSync(join(dest, "keep"), "utf8"), "late external data\n");
  assert.deepEqual(f.current(), before); assert.equal(existsSync(f.ledger), true);
  const failure = JSON.parse(readFileSync(f.failure, "utf8"));
  assert.equal(failure.phase, "add"); assert.equal(failure.addAttempted, true);
  await assert.rejects(f.prepare(f.request("another")), /unresolved/);
});

test("process exit after persisted fixture intent preserves source and cannot replay on restart", async (t) => {
  // Deliberate process.exit only; not a power-loss or namespace-durability test.
  const f = fixture(t), before = f.current(), request = f.request();
  const code = `import { createJiti } from 'jiti'; import { writeFileSync, readFileSync, existsSync } from 'node:fs';
    const j = createJiti(import.meta.url);
    const { allowFileRoot } = await j.import('./lib/file-access.ts');
    const { captureGitWorkspaceOperation, applyGitWorkspaceOperation } = await j.import('./lib/git-workspace-operation.ts');
    allowFileRoot(${JSON.stringify(f.repo)}); allowFileRoot(${JSON.stringify(f.parent)});
    const ledger = ${JSON.stringify(f.ledger)};
    const admission = {
      assertAdmission: async () => { if (existsSync(ledger)) throw Error('unresolved'); },
      beginIntent: async (evidence) => {
        writeFileSync(ledger, JSON.stringify(evidence), {flag:'wx', mode:0o600, flush:true});
        const exact = readFileSync(ledger, 'utf8');
        return { assertOwned() { if (readFileSync(ledger, 'utf8') !== exact) throw Error('not owned'); },
          async completed(proof) { writeFileSync(ledger+'.proof', JSON.stringify(proof), {flush:true}); },
          async recordFailure(evidence) { writeFileSync(ledger+'.failure', JSON.stringify(evidence), {flush:true}); } };
      }
    };
    const candidate = await captureGitWorkspaceOperation(${JSON.stringify(request)}, admission);
    await applyGitWorkspaceOperation({candidate, authorize:async()=>{}, afterIntent:()=>process.exit(77)});`;
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", code],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "pipe"] }),
  (error) => error.status === 77);
  assert.equal(existsSync(f.ledger), true); assert.deepEqual(f.current(), before);
  assert.equal(existsSync(request.destinationPath), false);
  await assert.rejects(f.apply(JSON.parse(readFileSync(f.ledger, "utf8"))), (error) => error.code === "stale");
  await assert.rejects(f.prepare(), /unresolved/);
});
