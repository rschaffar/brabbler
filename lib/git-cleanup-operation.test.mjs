import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, constants, existsSync, fsyncSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test, { after } from "node:test";
const home = mkdtempSync(join(tmpdir(), "cleanup-config-"));
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = home; process.env.XDG_CONFIG_HOME = home;
after(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  rmSync(home, { recursive: true, force: true });
});
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { createGitCleanupEngine, createGitCleanupEngineWithAuthority, readGitCleanupNativeProof } = await jiti.import("./git-cleanup-operation.ts");
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { isGitCheckoutGated } = await jiti.import("./git-checkout-gate.ts");
const { gitExecEnv } = await jiti.import("./git-exec.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", env: gitExecEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture(t, method = "ff", { primaryTarget = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "cleanup-op-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo"), source = primaryTarget ? join(dir, "features", "feature") : join(dir, "feature"), target = primaryTarget ? repo : join(dir, "delivery");
  if (primaryTarget) mkdirSync(dirname(source));
  git(dir, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "base"), "base\n"); writeFileSync(join(repo, ".gitignore"), "ignored\ncache/\n");
  git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  git(repo, "worktree", "add", "-qb", "feature", source);
  if (!primaryTarget) git(repo, "worktree", "add", "-qb", "delivery", target);
  writeFileSync(join(source, "new"), "feature\n"); git(source, "add", "."); git(source, "commit", "-qm", "feature");
  const featureOid = git(source, "rev-parse", "HEAD");
  if (method === "merge-divergent") {
    writeFileSync(join(target, "delivery-file"), "delivery-only\n"); git(target, "add", "."); git(target, "commit", "-qm", "delivery-side");
  }
  const previousTargetOid = git(target, "rev-parse", "HEAD");
  git(target, "merge", method === "ff" ? "--ff-only" : "--no-ff", "--no-edit", "feature");
  allowFileRoot(dir);
  const select = (path) => selectCanonicalGitResources({ repositoryPath: repo, checkoutPath: path });
  const s = await select(source), dest = await select(target), main = await select(repo);
  const resultOid = git(target, "rev-parse", "HEAD");
  const integration = { completedAt: Date.now(), delivery: "selected-local", method: method === "ff" ? "ff" : "merge", actualFF: method === "ff", feature: s, target: dest,
    featureOid, previousTargetOid, resultOid, resultTree: git(target, "rev-parse", "HEAD^{tree}"), parents: git(target, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1) };
  const creator = { mode: "create", destination: s, originalSource: main, branchRef: "refs/heads/feature" };
  const ih = Object.freeze({}), ch = Object.freeze({});
  const ledger = join(dir, "intent.json"), removalFile = join(dir, "removal.json"), completedFile = join(dir, "completed.json"), failureFile = join(dir, "failure.json");
  const calls = [], hooks = {};
  let liveMain = main, idleState = { sessions: "known-idle", terminals: "known-idle", checks: "known-stopped" }, allowed, removalRecorded = false;
  // Primary-target acceptance uses file flush + parent-directory fsync before
  // issuing an identity-sealed acknowledgement. Other tests retain their existing
  // disposable flush-only contract; neither fixture is a production journal adapter.
  const syncReceiptDirectory = (file) => {
    if (!primaryTarget) return;
    const fd = openSync(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  };
  // Standalone fixture authority, not a public permission/admission fallback.
  const adapters = {
    assertCurrentSync() { calls.push("authority-at-spawn"); return hooks.authority?.(); },
    testPrepareNativeLaunch: (phase) => hooks.launch?.(phase),
    readCompletedIntegration: (handle) => handle === ih ? integration : undefined,
    readCreatedWorkspace: (handle) => handle === ch ? creator : undefined,
    getProjectMain: async () => liveMain,
    async authorize(phase) { calls.push(phase); await hooks.authorize?.(phase); },
    async acquireUsageLease(selected, evidence) {
      calls.push("lease");
      if (hooks.acquireLease) return hooks.acquireLease(selected, evidence);
      return {
        assertIdle: () => idleState,
        acknowledgeRemoval(proof) {
          calls.push("lease-removal"); assert.equal(removalRecorded, true); assert.equal(existsSync(removalFile), true);
          assert.equal(proof.sourcePath, source); assert.equal(existsSync(source), false);
          return hooks.usageRemoval?.(proof);
        },
        release() { calls.push("release"); return hooks.release?.(); },
      };
    },
    async assertAdmission(e) {
      assert.equal(isGitCheckoutGated(source), true); assert.equal(e.integration.featureOid, featureOid);
      if (hooks.admission) return hooks.admission.assertAdmission(e);
      if (existsSync(ledger)) throw Error("unresolved");
    },
    async beginIntent(e) {
      if (hooks.admission) return hooks.admission.beginIntent(e);
      writeFileSync(ledger, JSON.stringify(e), { flag: "wx", mode: 0o600, flush: true });
      syncReceiptDirectory(ledger);
      allowed = e.inventory;
      await hooks.intent?.(e);
      const guard = (expected, phase, proof) => {
        if (phase === "complete") {
          assert.equal(readGitCleanupNativeProof(proof)?.kind, "completed", "final owned guard needs an already-issued native proof");
          assert.equal(proof.actionId, e.actionId); assert.equal(proof.deletedOid, featureOid);
        }
        calls.push(`owned:${phase}`);
        assert.equal(isGitCheckoutGated(source), true);
        if (phase === "delete") assert.equal(removalRecorded, true);
        if (phase !== "complete") assert.deepEqual(expected, allowed);
        const registrations = execFileSync("git", ["--no-optional-locks", "-C", target, "worktree", "list", "--porcelain", "-z"], { encoding: "utf8", env: gitExecEnv() });
        assert.equal(registrations, expected.registrations);
        const refs = execFileSync("git", ["--no-optional-locks", "-C", target, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs"], { encoding: "utf8", env: gitExecEnv() });
        assert.equal(refs, expected.refs);
        hooks.guard?.(phase);
      };
      return {
        assertOwned: (expected, phase, proof) => hooks.owned ? hooks.owned(expected, phase, guard, proof) : guard(expected, phase, proof),
        async recordRemoval(proof) {
          calls.push("record-removal");
          assert.equal(proof.actionId, e.actionId); assert.equal(proof.kind, "removed"); assert.equal(proof.featureOid, featureOid);
          assert.equal(existsSync(source), false); assert.equal(existsSync(s.gitDir), false);
          assert.deepEqual(proof.before, e.inventory);
          await hooks.removal?.(proof);
          writeFileSync(removalFile, JSON.stringify(proof), { mode: 0o600, flush: true });
          syncReceiptDirectory(removalFile);
          removalRecorded = true; allowed = proof.after;
          return hooks.removalAck ? hooks.removalAck(proof) : { durable: true, proof };
        },
        async completed(proof) {
          calls.push("record-completed"); assert.equal(proof.removal.actionId, e.actionId);
          assert.equal(git(repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
          await hooks.completed?.(proof);
          writeFileSync(completedFile, JSON.stringify(proof), { mode: 0o600, flush: true });
          syncReceiptDirectory(completedFile);
          return hooks.completedAck ? hooks.completedAck(proof) : { durable: true, proof };
        },
        async recordFailure(facts) {
          calls.push("record-failure"); await hooks.failure?.(facts);
          writeFileSync(failureFile, JSON.stringify(facts), { mode: 0o600, flush: true });
          syncReceiptDirectory(failureFile);
        },
      };
    },
  };
  const engine = createGitCleanupEngineWithAuthority(adapters), request = { integrationHandle: ih, creatorHandle: ch };
  return { ...engine, request, hooks, calls, integration, creator, s, main, repo, source, target, dir, featureOid, ledger, removalFile, completedFile, failureFile, select,
    prepare: (extra = {}) => engine.capture({ ...request, ...extra }), setMain: (v) => { liveMain = v; }, setIdle: (v) => { idleState = v; } };
}
const recovery = (e) => e.code === "recovery-required" && !!e.facts;
for (const method of ["ff", "merge", "merge-divergent"]) test(`actual ${method} removes once then CAS-deletes exact feature; proof/replay`, async (t) => {
  const f = await fixture(t, method), before = readFileSync(join(f.repo, "base"));
  const c = await f.prepare(), result = await f.apply(c);
  assert.equal(result.status, "completed"); assert.equal(existsSync(f.source), false); assert.equal(existsSync(f.s.gitDir), false);
  assert.equal(git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
  assert.deepEqual(readFileSync(join(f.repo, "base")), before);
  assert.equal(f.calls.indexOf("record-removal") < f.calls.indexOf("lease-removal"), true);
  assert.equal(f.calls.indexOf("lease-removal") < f.calls.indexOf("owned:delete"), true);
  assert.equal(f.calls.filter((call) => call === "lease").length, 1);
  assert.equal(existsSync(f.completedFile), true);
  await assert.rejects(f.apply(c)); await assert.rejects(f.prepare());
});
test("forged candidate/handles, wrong result tree/parents and create-mode provenance refuse", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  await assert.rejects(f.apply({ ...c }));
  await assert.rejects(f.prepare({ integrationHandle: { ...f.integration } }));
  await assert.rejects(f.prepare({ creatorHandle: { ...f.creator } }));
  f.integration.parents = [f.featureOid]; await assert.rejects(f.prepare());
  f.integration.parents = git(f.target, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1);
  f.integration.resultTree = f.featureOid; await assert.rejects(f.prepare());
  f.integration.resultTree = git(f.target, "rev-parse", "HEAD^{tree}");
  f.creator.mode = "attach"; await assert.rejects(f.prepare());
  assert.equal(existsSync(f.ledger), false);
});
test("candidate five-minute expiry, integration fifteen-minute expiry and moved refs", async (t) => {
  const f = await fixture(t), c = await f.prepare(), now = Date.now;
  Date.now = () => now() + 300001;
  try { await assert.rejects(f.apply(c), (e) => e.code === "stale"); } finally { Date.now = now; }
  f.integration.completedAt -= 900001; await assert.rejects(f.prepare()); f.integration.completedAt = now();
  const c2 = await f.prepare(); git(f.repo, "update-ref", "refs/heads/feature", f.integration.previousTargetOid);
  await assert.rejects(f.apply(c2)); assert.equal(existsSync(f.ledger), false); assert.equal(existsSync(f.source), true);
});
test("physical resource replacement and changed designated main invalidate candidate", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  f.setMain(f.s); await assert.rejects(f.apply(c));
  const g = await fixture(t), c2 = await g.prepare(); renameSync(g.source, join(g.dir, "old-source")); mkdirSync(g.source);
  await assert.rejects(g.apply(c2)); assert.equal(existsSync(g.ledger), false);
});
test("source protection: creator source, Project main, target, primary and non-local delivery", async (t) => {
  const f = await fixture(t);
  f.creator.originalSource = f.s; await assert.rejects(f.prepare()); f.creator.originalSource = f.main;
  f.setMain(f.s); await assert.rejects(f.prepare()); f.setMain(f.main);
  const target = f.integration.target; f.integration.target = f.s; await assert.rejects(f.prepare()); f.integration.target = target;
  f.integration.delivery = "remote"; await assert.rejects(f.prepare()); f.integration.delivery = "selected-local";
  f.integration.feature = f.main; f.creator.destination = f.main; f.creator.branchRef = "refs/heads/main"; await assert.rejects(f.prepare());
});
test("ignored files AND empty directories default-block; exact named ALL metadata approved, no contents", async (t) => {
  const f = await fixture(t); mkdirSync(join(f.source, "cache")); writeFileSync(join(f.source, "ignored"), "SECRET MUST NOT BE CAPTURED");
  let entries;
  await assert.rejects(f.prepare(), (e) => { assert.equal(e.code, "ignored-blocked"); entries = e.ignored; return true; });
  assert.deepEqual(entries.map((e) => e.path), ["cache", "ignored"]);
  await assert.rejects(f.prepare({ ignoredNames: ["ignored"] }));
  await assert.rejects(f.prepare({ ignoredNames: ["cache/*", "ignored"] }));
  const c = await f.prepare({ ignoredNames: ["cache", "ignored"] });
  assert.equal(JSON.stringify(c).includes("SECRET"), false);
  const result = await f.apply(c); assert.equal(result.status, "completed");
  assert.equal(readFileSync(f.ledger, "utf8").includes("SECRET"), false);
});
test("ignored late entries/metadata changes invalidate; no force fallback", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  f.hooks.intent = () => writeFileSync(join(f.source, "ignored"), "late");
  await assert.rejects(f.apply(c), (e) => recovery(e) && !e.facts.removeAttempted);
  assert.equal(existsSync(f.source), true); assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
});
for (const kind of ["symlink", "hardlink", "special", "nested", "attrs", "dirty", "index-flag", "lock", "config"]) test(`unsupported ${kind} refused before destructive native effect`, async (t) => {
  const f = await fixture(t);
  if (kind === "symlink") symlinkSync(join(f.repo, "base"), join(f.source, "ignored"));
  if (kind === "hardlink") linkSync(join(f.repo, "base"), join(f.source, "ignored"));
  if (kind === "special") execFileSync("mkfifo", [join(f.source, "ignored")]);
  if (kind === "nested") { mkdirSync(join(f.source, "cache")); mkdirSync(join(f.source, "cache", ".git")); }
  if (kind === "attrs") writeFileSync(join(f.source, ".gitattributes"), "* text\n");
  if (kind === "dirty") writeFileSync(join(f.source, "base"), "dirty");
  if (kind === "index-flag") git(f.source, "update-index", "--assume-unchanged", "base");
  if (kind === "lock") writeFileSync(join(f.s.gitDir, "index.lock"), "");
  if (kind === "config") git(f.repo, "config", "filter.test.clean", "false");
  await assert.rejects(f.prepare({ ignoredNames: ["ignored", "cache", "cache/.git"] }));
  assert.equal(existsSync(f.source), true); assert.equal(existsSync(f.ledger), false);
});
test("positive usage inventory required; disablement before remove refuses", async (t) => {
  const f = await fixture(t), c = await f.prepare(); f.setIdle({ sessions: "unknown", terminals: "known-idle", checks: "known-stopped" });
  await assert.rejects(f.apply(c)); assert.equal(existsSync(f.ledger), false);
  const g = await fixture(t), c2 = await g.prepare(); g.hooks.authorize = () => { throw Error("disabled"); };
  await assert.rejects(g.apply(c2)); assert.equal(existsSync(g.source), true);
});
test("revocation between worktree removal and branch delete preserves branch with truthful facts", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  f.hooks.authorize = (phase) => { if (phase === "before-delete") throw Error("revoked"); };
  await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removalRecorded && !e.facts.branchDeleteAttempted && e.facts.sourceAbsent);
  assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid); assert.equal(existsSync(f.removalFile), true);
  await assert.rejects(f.apply(c));
});
test("failure after remove before delete, wrong removal ack or callback-mutated proof cannot delete", async (t) => {
  for (const kind of ["throw", "wrong-ack", "mutate"]) {
    const f = await fixture(t), c = await f.prepare();
    if (kind === "throw") f.hooks.removal = () => { throw Error("record failed"); };
    if (kind === "wrong-ack") f.hooks.removalAck = (proof) => ({ durable: true, proof: { ...proof } });
    if (kind === "mutate") f.hooks.removal = (proof) => { proof.featureOid = f.integration.previousTargetOid; };
    await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removalVerified && !e.facts.branchDeleteAttempted && !e.facts.removalRecorded);
    assert.equal(existsSync(f.source), false); assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
  }
});
test("another checkout of feature after removal denies deletion", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  f.hooks.removal = () => git(f.repo, "worktree", "add", join(f.dir, "other"), "feature");
  await assert.rejects(f.apply(c), (e) => recovery(e) && !e.facts.branchDeleteAttempted);
  assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
});
test("target/main/ref changes after removal deny deletion", async (t) => {
  for (const ref of ["main", "delivery", "feature"]) {
    const f = await fixture(t), c = await f.prepare();
    f.hooks.removal = () => git(f.repo, "update-ref", `refs/heads/${ref}`, ref === "main" ? f.featureOid : f.integration.previousTargetOid);
    await assert.rejects(f.apply(c), (e) => recovery(e) && !e.facts.branchDeleteAttempted);
  }
});
test("native remove failure never deletes even when a callback removes directory; no force/retry", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  // Destructive test seam in trusted synchronous guard: removes pathname only,
  // leaving registration so native remove fails. Engine must not infer success.
  f.hooks.guard = (phase) => { if (phase === "remove") {
    rmSync(f.source, { recursive: true }); writeFileSync(join(f.s.gitDir, "locked"), "fixture native refusal");
  } };
  await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removeAttempted && !e.facts.removalVerified && !e.facts.branchDeleteAttempted);
  assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
});
test("post-delete completion failure or wrong proof ack reports known effects, never success", async (t) => {
  for (const kind of ["throw", "wrong-ack", "failure-record-also-fails"]) {
    const f = await fixture(t), c = await f.prepare();
    if (kind === "wrong-ack") f.hooks.completedAck = (proof) => ({ durable: true, proof: { ...proof } });
    else f.hooks.completed = () => { throw Error("record failed"); };
    if (kind === "failure-record-also-fails") f.hooks.failure = () => { throw Error("failure record failed"); };
    await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.branchDeleteVerified && e.facts.removalRecorded && e.facts.sourceAbsent &&
      e.facts.failureRecorded === (kind !== "failure-record-also-fails"));
    assert.equal(git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
    await assert.rejects(f.apply(c));
  }
});

test("ignored directory names are not shorthand; late metadata changes deny", async (t) => {
  const f = await fixture(t); mkdirSync(join(f.source, "cache")); writeFileSync(join(f.source, "cache", "entry"), "opaque ignored data");
  await assert.rejects(f.prepare({ ignoredNames: ["cache"] }));
  const c = await f.prepare({ ignoredNames: ["cache", "cache/entry"] });
  writeFileSync(join(f.source, "cache", "entry"), "changed data and metadata");
  await assert.rejects(f.apply(c)); assert.equal(existsSync(f.ledger), false);
});
test("entry bound refuses oversized ignored inventory without force or contents", async (t) => {
  const f = await fixture(t); mkdirSync(join(f.source, "cache"));
  for (let i = 0; i < 2001; i++) writeFileSync(join(f.source, "cache", String(i)), "");
  await assert.rejects(f.prepare()); assert.equal(existsSync(f.ledger), false);
});
test("ignored metadata is bounded to one MiB even below the entry limit", async (t) => {
  const f = await fixture(t);
  let path = join(f.source, "cache"); mkdirSync(path);
  for (let i = 0; i < 15; i++) { path = join(path, `${i}-` + "d".repeat(98)); mkdirSync(path); }
  for (let i = 0; i < 600; i++) writeFileSync(join(path, `${i}-` + "f".repeat(196)), "");
  await assert.rejects(f.prepare(), (e) => e.code === "unsafe"); assert.equal(existsSync(f.ledger), false);
});
test("fresh lease state and integration age are required again after removal", async (t) => {
  for (const change of ["sessions", "terminals", "checks", "receipt-age"]) {
    const f = await fixture(t), c = await f.prepare();
    f.hooks.removal = () => {
      if (change === "receipt-age") f.integration.completedAt -= 900001;
      else f.setIdle({ sessions: "known-idle", terminals: "known-idle", checks: "known-stopped", [change]: "unknown" });
    };
    await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removalRecorded && !e.facts.branchDeleteAttempted);
    assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
  }
});
test("tracked 64-MiB bound, symlinked ref namespace and altered configuration identity refuse", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  const config = join(f.repo, ".git", "config"), data = readFileSync(config);
  renameSync(config, join(f.dir, "old-config")); writeFileSync(config, data);
  await assert.rejects(f.apply(c));
  const g = await fixture(t), c2 = await g.prepare();
  const refs = join(g.repo, ".git", "refs", "heads"), moved = join(g.dir, "heads"); renameSync(refs, moved); symlinkSync(moved, refs);
  await assert.rejects(g.apply(c2)); assert.equal(existsSync(g.source), true);
  const h = await fixture(t); writeFileSync(join(h.source, "new"), Buffer.alloc(64 * 1024 * 1024 + 1));
  git(h.source, "add", "new"); git(h.source, "commit", "-qm", "oversized");
  await assert.rejects(h.prepare()); assert.equal(existsSync(h.ledger), false);
});
test("source target/main tracked byte/mode/index and markers are freshly fenced", async (t) => {
  for (const change of ["source-mode", "target-bytes", "main-index", "target-marker"]) {
    const f = await fixture(t), c = await f.prepare();
    f.hooks.intent = () => {
      if (change === "source-mode") execFileSync("chmod", ["+x", join(f.source, "base")]);
      if (change === "target-bytes") writeFileSync(join(f.target, "base"), "late target change");
      if (change === "main-index") git(f.repo, "update-index", "--assume-unchanged", "base");
      if (change === "target-marker") writeFileSync(join(f.integration.target.gitDir, "MERGE_HEAD"), f.featureOid);
    };
    await assert.rejects(f.apply(c), (e) => recovery(e) && !e.facts.removeAttempted);
  }
});
test("another registration changed at remove boundary fails measured removal and never deletes", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  f.hooks.guard = (phase) => { if (phase === "remove") git(f.repo, "worktree", "add", "-qb", "other", join(f.dir, "other")); };
  await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removeExit === 0 && !e.facts.removalVerified && !e.facts.branchDeleteAttempted);
  assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
});
test("native no-force remove failure is exactly one invocation and never followed by update-ref", async (t) => {
  const f = await fixture(t), c = await f.prepare(), path = process.env.PATH;
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim(), shim = join(f.dir, "bin"), log = join(f.dir, "native.jsonl");
  mkdirSync(shim);
  writeFileSync(join(shim, "git"), `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'); const a=process.argv.slice(2);\nif(a.includes('remove')&&a.includes('worktree')){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');fs.rmSync(${JSON.stringify(f.source)},{recursive:true});process.exit(1);} if(a.includes('update-ref'))fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n'); cp.execFileSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});\n`, { mode: 0o700 });
  process.env.PATH = `${shim}:${path}`;
  try { await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removeAttempted && !e.facts.removalVerified && !e.facts.branchDeleteAttempted && e.facts.sourceAbsent); }
  finally { process.env.PATH = path; }
  const attempts = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.equal(attempts.length, 1); assert.equal(attempts[0].includes("--force"), false); assert.equal(attempts[0].includes("-f"), false);
  assert.deepEqual(attempts[0].slice(-4), ["worktree", "remove", "--", f.source]);
});
test("timeout after actual successful removal positively terminates child, quarantines intent, never deletes", async (t) => {
  const f = await fixture(t), c = await f.prepare(), path = process.env.PATH;
  const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim(), shim = join(f.dir, "bin"), log = join(f.dir, "native.jsonl");
  mkdirSync(shim);
  writeFileSync(join(shim, "git"), `#!${process.execPath}\nconst fs=require('node:fs'),cp=require('node:child_process'); const a=process.argv.slice(2);\nif(a.includes('remove')&&a.includes('worktree')){fs.appendFileSync(${JSON.stringify(log)},'remove\\n');cp.execFileSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});process.on('SIGTERM',()=>process.exit(143));setInterval(()=>{},1000);}else{if(a.includes('update-ref'))fs.appendFileSync(${JSON.stringify(log)},'update-ref\\n');cp.execFileSync(${JSON.stringify(realGit)},a,{stdio:'inherit'});}\n`, { mode: 0o700 });
  process.env.PATH = `${shim}:${path}`;
  try { await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removeAttempted && !e.facts.removalVerified && !e.facts.branchDeleteAttempted &&
    e.facts.sourceAbsent && e.facts.adminAbsent && e.facts.childTerminationConfirmed && e.facts.removeExit === null); }
  finally { process.env.PATH = path; }
  assert.equal(readFileSync(log, "utf8"), "remove\n"); assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
  assert.equal(existsSync(f.ledger), true); assert.equal(existsSync(f.removalFile), false);
});

function ignoredNames(f) {
  const result = [];
  const scan = (path, relative) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      result.push(name); if (entry.isDirectory()) scan(join(path, entry.name), name);
    }
  };
  if (existsSync(join(f.source, "cache"))) { result.push("cache"); scan(join(f.source, "cache"), "cache"); }
  return result;
}
function storageIndirection(f, kind) {
  const objects = join(f.repo, ".git", "objects"), cache = join(f.source, "cache"); mkdirSync(cache);
  if (kind === "pack") git(f.repo, "repack", "-ad");
  if (kind.startsWith("shared-")) {
    const name = kind.slice(7), root = join(f.repo, ".git", name), store = join(cache, name);
    renameSync(root, store); symlinkSync(store, root); return;
  }
  if (kind === "objects" || kind === "alternates" || kind === "relative-alternates") {
    const store = join(cache, "store"); renameSync(objects, store);
    if (kind === "objects") symlinkSync(store, objects);
    else {
      mkdirSync(join(objects, "info"), { recursive: true }); mkdirSync(join(objects, "pack"));
      const value = kind === "alternates" ? store : "../../../feature/cache/store";
      writeFileSync(join(objects, "info", "alternates"), `${value}\n`);
    }
  } else {
    const name = kind === "fanout" ? readdirSync(objects).find((name) => /^[a-f0-9]{2}$/.test(name)) : kind;
    const store = join(cache, name); renameSync(join(objects, name), store); symlinkSync(store, join(objects, name));
  }
}
for (const kind of ["objects", "info", "pack", "fanout", "alternates", "relative-alternates", "shared-info", "shared-refs", "shared-logs"]) test(`static shared storage ${kind} inside ALL-named ignored source refuses without history damage`, async (t) => {
  const f = await fixture(t);
  storageIndirection(f, kind);
  const mainHistory = git(f.repo, "log", "--format=%H", "main"), targetHistory = git(f.target, "log", "--format=%H", "delivery");
  await assert.rejects(f.prepare({ ignoredNames: ignoredNames(f) }), (e) => e.code === "unsafe");
  assert.equal(existsSync(f.ledger), false); assert.equal(existsSync(f.source), true); assert.equal(existsSync(f.s.gitDir), true);
  assert.equal(git(f.repo, "log", "--format=%H", "main"), mainHistory);
  assert.equal(git(f.target, "log", "--format=%H", "delivery"), targetHistory);
  git(f.target, "cat-file", "-e", `${f.featureOid}^{tree}`);
});
test("shared object metadata is complete, bounded and freshly revalidated before intent", async (t) => {
  for (const kind of ["late-indirection", "metadata-change", "over-budget", "object-config"]) {
    const f = await fixture(t), c = await f.prepare();
    if (kind === "late-indirection") storageIndirection(f, "objects");
    if (kind === "metadata-change") writeFileSync(join(f.repo, ".git", "objects", "info", "opaque-metadata"), "");
    if (kind === "over-budget") for (let i = 0; i < 2001; i++) writeFileSync(join(f.repo, ".git", "objects", "info", String(i)), "");
    if (kind === "object-config") git(f.repo, "config", "core.alternateRefsCommand", "DO NOT EXECUTE");
    await assert.rejects(f.apply(c)); assert.equal(existsSync(f.ledger), false); assert.equal(existsSync(f.source), true);
    git(f.target, "cat-file", "-e", f.integration.resultOid);
  }
});
test("Git object-path environment is sanitized, never inherited as shared-storage authority", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  const keys = ["GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"], before = keys.map((key) => process.env[key]);
  for (const key of keys) process.env[key] = join(f.source, "missing-cache");
  try { assert.equal((await f.apply(c)).status, "completed"); }
  finally { keys.forEach((key, i) => { if (before[i] === undefined) delete process.env[key]; else process.env[key] = before[i]; }); }
  git(f.target, "cat-file", "-e", f.integration.resultOid);
});
test("owned guards must return synchronous undefined: async/rejected/nonvoid adapters do not mutate worktree or ref", async (t) => {
  for (const callback of [async () => {}, async () => { throw Error("PRIVATE ASYNC CAUSE"); }, () => true, () => ({})]) {
    const f = await fixture(t), c = await f.prepare(); f.hooks.owned = callback;
    await assert.rejects(f.apply(c), (e) => recovery(e) && !e.facts.removeAttempted && !e.facts.branchDeleteAttempted && !e.message.includes("PRIVATE"));
    assert.equal(existsSync(f.source), true); assert.equal(existsSync(f.s.gitDir), true);
    assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
  }
});
test("a later async owned guard cannot authorize CAS or completion", async (t) => {
  for (const phase of ["delete", "complete"]) {
    const f = await fixture(t), c = await f.prepare();
    f.hooks.owned = (e, current, guard, proof) => current === phase ? Promise.resolve() : guard(e, current, proof);
    await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removalRecorded && e.facts.branchDeleteAttempted === (phase === "complete"));
    assert.equal(git(f.repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature"), phase === "delete" ? f.featureOid : "");
    assert.equal(existsSync(f.completedFile), false);
  }
});
test("lease owned-removal transition is mandatory, synchronous and only after durable measured proof", async (t) => {
  for (const kind of ["throw", "async", "mutate", "bad-admission-ack"]) {
    const f = await fixture(t), c = await f.prepare();
    if (kind === "throw") f.hooks.usageRemoval = () => { throw Error("wrong proof"); };
    if (kind === "async") f.hooks.usageRemoval = async () => {};
    if (kind === "mutate") f.hooks.usageRemoval = (proof) => { proof.featureOid = f.integration.previousTargetOid; };
    if (kind === "bad-admission-ack") f.hooks.removalAck = (proof) => ({ durable: true, proof: { ...proof } });
    await assert.rejects(f.apply(c), (e) => recovery(e) && e.facts.removalVerified && !e.facts.branchDeleteAttempted);
    assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
    assert.equal(f.calls.includes("lease-removal"), kind !== "bad-admission-ack");
  }
  const f = await fixture(t), c = await f.prepare();
  f.hooks.acquireLease = () => ({ assertIdle: () => ({ sessions: "known-idle", terminals: "known-idle", checks: "known-stopped" }), release() {} });
  await assert.rejects(f.apply(c)); assert.equal(existsSync(f.ledger), false); assert.equal(existsSync(f.source), true);
});
test("REAL usage lease accepts only issued durable owned-removal transition and stays continuously fenced through native CAS", async (t) => {
  const { createTrustedWorkspaceUsage, beginGitWorkspacePlacement } = await jiti.import("./git-workspace-usage.ts");
  for (const method of ["ff", "merge"]) {
    const f = await fixture(t, method), issued = new WeakMap(), byProof = new WeakMap();
    const known = () => ({ known: true, entries: [] });
    const snapshot = { sessions: known(), terminals: known(), checks: known(), inflight: known() };
    let reads = 0, lease, acquired = 0, released = 0, transitioned = 0;
    const usage = createTrustedWorkspaceUsage(() => {
      reads++; assert.throws(() => beginGitWorkspacePlacement(join(f.source, "planned-child")), (e) => e.code === "leased");
      return snapshot;
    }, (ack) => issued.get(ack));
    const c = await f.prepare();
    f.hooks.acquireLease = (source, evidence) => {
      acquired++;
      lease = usage.acquireLease(source.cwd, source.identities.checkout, {
        actionId: evidence.actionId, featureOid: evidence.integration.featureOid,
        adminPath: source.gitDir, adminIdentity: source.identities.git, markerIdentity: source.identities.marker,
        adminInventoryHash: evidence.inventory.admins[basename(source.gitDir)],
      });
      return {
        assertIdle: () => lease.assertUnused(),
        acknowledgeRemoval(proof) {
          assert.equal(existsSync(f.removalFile), true);
          assert.equal(existsSync(f.source), false);
          const ack = byProof.get(proof); assert.equal(ack.proof, proof);
          // Lookalikes cannot activate the usage owner's missing-root transition.
          assert.throws(() => lease.acknowledgeRemoval({ ...ack }), (e) => e.code === "stale");
          lease.acknowledgeRemoval(ack); transitioned++;
        },
        release() { released++; lease.release(); },
      };
    };
    f.hooks.removal = () => {
      assert.throws(() => lease.assertUnused(), (e) => e.code === "stale", "directory absence alone is NOT authority");
      assert.throws(() => beginGitWorkspacePlacement(f.source), (e) => e.code === "leased");
    };
    f.hooks.removalAck = (proof) => {
      const ack = Object.freeze({ durable: true, proof });
      issued.set(ack, structuredClone(proof)); byProof.set(proof, ack); return ack;
    };
    f.hooks.authorize = (phase) => {
      if (phase === "before-delete") {
        assert.equal(transitioned, 1); assert.equal(acquired, 1); assert.equal(released, 0);
        assert.throws(() => beginGitWorkspacePlacement(f.source), (e) => e.code === "leased");
      }
    };
    assert.equal((await f.apply(c)).status, "completed");
    assert.equal(acquired, 1); assert.equal(released, 1); assert.equal(transitioned, 1); assert.equal(reads >= 4, true);
    assert.equal(git(f.repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature"), "");
    const finish = beginGitWorkspacePlacement(f.source); finish();
  }
});
async function bindPrimaryRealLease(f, candidate) {
  const { createTrustedWorkspaceUsage, beginGitWorkspacePlacement } = await jiti.import("./git-workspace-usage.ts");
  const issued = new WeakMap(), byProof = new WeakMap(), events = [];
  const known = () => ({ known: true, entries: [] });
  const snapshot = { sessions: known(), terminals: known(), checks: known(), inflight: known() };
  const state = { acquired: 0, released: 0, transitioned: 0, reads: 0, casGuards: 0, events, snapshot, beginGitWorkspacePlacement };
  let lease;
  const blockedPlacement = () => assert.throws(() => beginGitWorkspacePlacement(join(f.source, "not-created")), (e) => e.code === "leased");
  const usage = createTrustedWorkspaceUsage(() => {
    state.reads++; blockedPlacement();
    assert.equal(state.acquired, 1); assert.equal(state.released, 0);
    return snapshot;
  }, (ack) => issued.get(ack));
  f.hooks.acquireLease = (source, evidence) => {
    state.acquired++; events.push("acquired");
    assert.equal(evidence.actionId, candidate.actionId);
    lease = usage.acquireLease(source.cwd, source.identities.checkout, {
      actionId: evidence.actionId, featureOid: evidence.integration.featureOid,
      adminPath: source.gitDir, adminIdentity: source.identities.git, markerIdentity: source.identities.marker,
      adminInventoryHash: evidence.inventory.admins[basename(source.gitDir)],
    });
    return {
      assertIdle: () => lease.assertUnused(),
      acknowledgeRemoval(proof) {
        events.push("transition-start");
        assert.equal(proof, state.removal);
        assert.equal(existsSync(f.removalFile), true);
        assert.equal(existsSync(dirname(f.s.gitDir)), false, "native Git removed the now-empty common/worktrees parent");
        assert.equal(git(f.repo, "rev-parse", "refs/heads/feature"), f.featureOid, "CAS must follow the durable acknowledgement");
        const ack = byProof.get(proof);
        assert.equal(issued.get(ack), proof, "only the post-fsync identity-issued acknowledgement is an issuer");
        assert.throws(() => lease.acknowledgeRemoval(proof), (e) => e.code === "stale", "raw native proof is not an issued acknowledgement");
        assert.throws(() => lease.acknowledgeRemoval({ ...ack }), (e) => e.code === "stale", "receipt lookalike is not authority");
        lease.acknowledgeRemoval(ack);
        state.transitioned++; events.push("transition-accepted"); blockedPlacement();
      },
      release() { state.released++; events.push("released"); lease.release(); },
    };
  };
  f.hooks.intent = (evidence) => {
    state.evidence = evidence;
    assert.equal(evidence.target.tree, f.integration.resultTree);
    assert.equal(evidence.mainSnapshot.tree, f.integration.resultTree);
    assert.equal(readFileSync(f.ledger, "utf8"), JSON.stringify(evidence));
  };
  f.hooks.removal = (proof) => {
    state.removal = proof; events.push("native-removal-measured");
    assert.equal(proof.exit, 0); assert.equal(proof.sourceAbsent, true); assert.equal(proof.adminAbsent, true);
    assert.equal(existsSync(f.source), false); assert.equal(existsSync(f.s.gitDir), false);
    assert.equal(existsSync(dirname(f.s.gitDir)), false);
    assert.equal(existsSync(f.removalFile), false, "no acknowledgement before the durable recording boundary");
    assert.equal(byProof.has(proof), false);
    assert.throws(() => lease.assertUnused(), (e) => e.code === "stale", "unlinked instances alone never authorize absence");
    blockedPlacement();
  };
  f.hooks.removalAck = (proof) => {
    // The fixture writer already flushed the exact record AND fsynced its parent.
    // Reading it only checks that boundary; authority comes from the identity map,
    // never from parsing/replaying JSON or reconstructing a proof/receipt.
    assert.equal(readFileSync(f.removalFile, "utf8"), JSON.stringify(proof));
    events.push("durable-removal-issued");
    const ack = Object.freeze({ durable: true, proof });
    issued.set(ack, proof); byProof.set(proof, ack); return ack;
  };
  f.hooks.owned = (expected, phase, guard, proof) => {
    if (phase === "delete") {
      state.casGuards++; events.push("cas-guard");
      assert.equal(state.acquired, 1); assert.equal(state.released, 0); assert.equal(state.transitioned, 1);
      assert.equal(existsSync(dirname(f.s.gitDir)), false); blockedPlacement();
      assert.equal(git(f.repo, "rev-parse", "refs/heads/feature"), f.featureOid);
    }
    return guard(expected, phase, proof);
  };
  f.hooks.completedAck = (proof) => {
    assert.equal(readFileSync(f.completedFile, "utf8"), JSON.stringify(proof));
    events.push("durable-completed-issued"); state.completed = proof;
    assert.equal(proof.actionId, candidate.actionId); assert.equal(proof.deletedOid, f.featureOid);
    assert.equal(proof.finalInventory.refs, `refs/heads/main\0${f.integration.resultOid}\0\n`);
    assert.equal(state.acquired, 1); assert.equal(state.released, 0); blockedPlacement();
    return Object.freeze({ durable: true, proof });
  };
  return state;
}
for (const method of ["ff", "merge"]) test(`primary target + ONLY linked feature: REAL lease ${method} removal/empty admin-parent/CAS after durable acknowledgement`, async (t) => {
  const f = await fixture(t, method, { primaryTarget: true });
  assert.equal(f.target, f.repo); assert.equal(f.integration.target.gitDir, f.integration.target.commonDir);
  const beforePaths = git(f.repo, "worktree", "list", "--porcelain", "-z").split("\0").filter((entry) => entry.startsWith("worktree "));
  assert.deepEqual(beforePaths, [`worktree ${f.repo}`, `worktree ${f.source}`]);
  const before = { head: readFileSync(join(f.repo, ".git", "HEAD")), index: readFileSync(join(f.repo, ".git", "index")), base: readFileSync(join(f.repo, "base")) };
  const candidate = await f.prepare(), state = await bindPrimaryRealLease(f, candidate);
  const result = await f.apply(candidate);
  assert.equal(result.status, "completed"); assert.equal(result.proof, state.completed);
  assert.equal(result.proof.removal, state.removal); assert.equal(result.proof.actionId, candidate.actionId);
  assert.equal(result.proof.transactionExit, 0); assert.equal(result.proof.deletedRef, "refs/heads/feature"); assert.equal(result.proof.deletedOid, f.featureOid);
  assert.equal(state.evidence.integration.resultOid, f.integration.resultOid); assert.equal(state.evidence.integration.resultTree, f.integration.resultTree);
  assert.equal(state.evidence.target.oid, f.integration.resultOid); assert.equal(state.evidence.target.tree, f.integration.resultTree);
  assert.equal(git(f.repo, "rev-parse", "HEAD"), f.integration.resultOid); assert.equal(git(f.repo, "rev-parse", "HEAD^{tree}"), f.integration.resultTree);
  assert.deepEqual(git(f.repo, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1), f.integration.parents);
  assert.deepEqual(readFileSync(join(f.repo, ".git", "HEAD")), before.head); assert.deepEqual(readFileSync(join(f.repo, ".git", "index")), before.index);
  assert.deepEqual(readFileSync(join(f.repo, "base")), before.base); assert.equal(git(f.repo, "status", "--porcelain=v1"), "");
  assert.equal(existsSync(f.source), false); assert.equal(existsSync(f.s.gitDir), false); assert.equal(existsSync(dirname(f.s.gitDir)), false);
  assert.equal(git(f.repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature"), "");
  assert.equal(state.acquired, 1); assert.equal(state.transitioned, 1); assert.equal(state.casGuards, 1); assert.equal(state.released, 1); assert.equal(state.reads >= 4, true);
  assert.equal(state.events.indexOf("native-removal-measured") < state.events.indexOf("durable-removal-issued"), true);
  assert.equal(state.events.indexOf("durable-removal-issued") < state.events.indexOf("transition-accepted"), true);
  assert.equal(state.events.indexOf("transition-accepted") < state.events.indexOf("cas-guard"), true);
  assert.equal(state.events.indexOf("durable-completed-issued") < state.events.indexOf("released"), true);
  const finish = state.beginGitWorkspacePlacement(f.source); finish();
  await assert.rejects(f.apply(candidate));
});
for (const change of ["admin-parent", "source-root", "source-parent", "new-placement"]) test(`primary target + ONLY linked feature: ${change} while absent stops before CAS and retains known removed proof`, async (t) => {
  const f = await fixture(t, "merge", { primaryTarget: true }), candidate = await f.prepare(), state = await bindPrimaryRealLease(f, candidate);
  f.hooks.authorize = (phase) => {
    if (phase !== "before-delete") return;
    assert.equal(state.transitioned, 1); assert.equal(state.acquired, 1); assert.equal(state.released, 0);
    assert.equal(existsSync(dirname(f.s.gitDir)), false); assert.equal(existsSync(f.source), false);
    assert.throws(() => state.beginGitWorkspacePlacement(join(f.source, "not-created")), (e) => e.code === "leased");
    if (change === "admin-parent") mkdirSync(dirname(f.s.gitDir));
    if (change === "source-root") mkdirSync(f.source);
    if (change === "source-parent") { renameSync(dirname(f.source), join(f.dir, "original-source-parent")); mkdirSync(dirname(f.source)); }
    if (change === "new-placement") state.snapshot.inflight.entries.push({ cwd: join(f.source, "new-placement") });
    assert.throws(() => state.beginGitWorkspacePlacement(f.source), (e) => e.code === "leased", "absence/replacement never releases the continuous placement fence");
  };
  await assert.rejects(f.apply(candidate), (error) => {
    assert.equal(recovery(error), true); assert.equal(error.facts.actionId, candidate.actionId);
    assert.equal(error.facts.phase, "before-delete"); assert.equal(error.facts.removeExit, 0);
    assert.equal(error.facts.removalVerified, true); assert.equal(error.facts.removalRecorded, true); assert.equal(error.facts.usageRemovalAcknowledged, true);
    assert.equal(error.facts.branchDeleteAttempted, false); assert.equal(error.facts.branchDeleteVerified, false);
    assert.equal(error.facts.expectedFeatureOid, f.featureOid); assert.equal(error.facts.expectedTargetOid, f.integration.resultOid);
    assert.equal(error.facts.failureRecorded, true); assert.equal(error.facts.sourceAbsent, change !== "source-root");
    assert.equal(error.facts.adminAbsent, true); return true;
  });
  assert.equal(state.acquired, 1); assert.equal(state.transitioned, 1); assert.equal(state.released, 1); assert.equal(state.casGuards, 0);
  assert.equal(state.removal.exit, 0); assert.equal(state.removal.sourceAbsent, true); assert.equal(state.removal.adminAbsent, true);
  assert.deepEqual(state.removal.before.checkouts[f.source], f.s.identities.checkout);
  assert.equal(readFileSync(f.removalFile, "utf8"), JSON.stringify(state.removal), "measured original removal remains durably recorded even if a pathname is replaced");
  assert.equal(existsSync(f.completedFile), false); assert.equal(existsSync(f.failureFile), true);
  assert.equal(git(f.repo, "rev-parse", "refs/heads/feature"), f.featureOid);
  assert.equal(git(f.repo, "rev-parse", "HEAD"), f.integration.resultOid); assert.equal(git(f.repo, "rev-parse", "HEAD^{tree}"), f.integration.resultTree);
  assert.equal(git(f.repo, "status", "--porcelain=v1"), "");
  await assert.rejects(f.apply(candidate));
});
test("public cleanup factory requires a genuine synchronous authority callback; legacy is node:test-only", () => {
  for (const guard of [undefined, null, true, {}, Promise.resolve(), async () => {}, function* () {}]) {
    assert.throws(() => createGitCleanupEngineWithAuthority({ assertCurrentSync: guard }), (e) => e.code === "unsafe");
  }
  const thenableGuard = () => {}; thenableGuard.then = () => {};
  assert.throws(() => createGitCleanupEngineWithAuthority({ assertCurrentSync: thenableGuard }));
  assert.equal(typeof createGitCleanupEngine({}).capture, "function", "legacy access is confined to this fixture process");
  const script = `const {createJiti}=require('jiti');(async()=>{const m=await createJiti(process.cwd()+'/lib/git-cleanup-operation.test.mjs').import('./git-cleanup-operation.ts');try{m.createGitCleanupEngine({});process.exit(1);}catch(e){process.stdout.write(e.code);}})()`;
  assert.equal(execFileSync(process.execPath, ["-e", script], { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: "" } }), "unsafe");
});
test("runtime authority async/thenable/nonvoid returns refuse before child spawn without unhandled rejection", async (t) => {
  for (const guard of [async () => {}, async () => { throw Error("PRIVATE AUTHORITY CAUSE"); }, () => true,
    () => ({ then(_resolve, reject) { reject(Error("PRIVATE THENABLE CAUSE")); } })]) {
    const f = await fixture(t), candidate = await f.prepare(); f.hooks.authority = guard;
    await assert.rejects(f.apply(candidate), (e) => recovery(e) && !e.facts.removeAttempted && !e.facts.branchDeleteAttempted && !e.message.includes("PRIVATE"));
    assert.equal(existsSync(f.source), true); assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
    assert.equal(f.calls.includes("record-removal"), false);
  }
});
for (const phase of ["remove", "delete"]) test(`live authority revoked during awaited ${phase} launch preparation stops the actual spawn`, async (t) => {
  const f = await fixture(t), candidate = await f.prepare(); let allowed = true;
  f.hooks.authority = () => { if (!allowed) throw Error("PRIVATE REVOCATION"); };
  f.hooks.launch = async (current) => { await Promise.resolve(); if (current === phase) allowed = false; };
  await assert.rejects(f.apply(candidate), (e) => {
    assert.equal(recovery(e), true); assert.equal(e.facts.removeAttempted, phase === "delete");
    assert.equal(e.facts.removalRecorded, phase === "delete"); assert.equal(e.facts.branchDeleteAttempted, false);
    if (phase === "delete") { assert.equal(e.facts.verifiedTargetOid, f.integration.resultOid); assert.equal(e.facts.verifiedTargetTree, f.integration.resultTree); }
    return true;
  });
  assert.equal(existsSync(f.source), phase !== "delete"); assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
});
for (const phase of ["remove", "delete"]) test(`authority is the LAST synchronous guard after ${phase} owned inventory/usage checks`, async (t) => {
  const f = await fixture(t), candidate = await f.prepare(); let allowed = true;
  f.hooks.authority = () => { if (!allowed) throw Error("revoked by final inventory callback"); };
  f.hooks.owned = (e, current, guard, proof) => { guard(e, current, proof); if (current === phase) allowed = false; };
  await assert.rejects(f.apply(candidate), (e) => recovery(e) && !e.facts.branchDeleteAttempted && e.facts.removeAttempted === (phase === "delete"));
  const order = f.calls.slice(f.calls.indexOf(`owned:${phase}`));
  assert.equal(order[1], "authority-at-spawn");
  assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
});
test("native proof reader authenticates only independently verified original identities before completion guard, never clone/history/data", async (t) => {
  const f = await fixture(t), candidate = await f.prepare(); let removal, completed;
  for (const forged of [null, undefined, candidate, candidate.actionId, f.integration, { kind: "removed", actionId: candidate.actionId }]) {
    assert.equal(readGitCleanupNativeProof(forged), undefined);
  }
  f.hooks.removal = (proof) => {
    removal = proof;
    const native = readGitCleanupNativeProof(proof); assert.equal(native.kind, "removed"); assert.equal(native.featureOid, f.featureOid);
    assert.equal(existsSync(f.source), false); assert.equal(existsSync(f.s.gitDir), false);
    assert.equal(Object.isFrozen(native), true); assert.equal(Object.isFrozen(native.before.checkouts[f.source]), true);
    assert.equal(Object.isFrozen(proof), true); assert.throws(() => { native.featureOid = "a".repeat(40); });
    for (const clone of [{ ...proof }, structuredClone(proof), JSON.parse(JSON.stringify(proof)), native]) assert.equal(readGitCleanupNativeProof(clone), undefined);
  };
  f.hooks.owned = (e, phase, guard, proof) => {
    if (phase === "complete") {
      completed = proof;
      assert.equal(proof.removal, removal);
      assert.equal(readGitCleanupNativeProof(proof).kind, "completed", "issuer exists BEFORE proof-bearing final ownership assertion");
      assert.equal(readGitCleanupNativeProof(proof).deletedOid, f.featureOid);
      assert.equal(f.calls.includes("record-completed"), false);
    }
    guard(e, phase, proof);
  };
  const result = await f.apply(candidate);
  assert.equal(result.proof, completed); assert.equal(readGitCleanupNativeProof(completed).transactionExit, 0);
  for (const clone of [structuredClone(completed), JSON.parse(JSON.stringify(completed)), { ...completed }, readGitCleanupNativeProof(completed)]) assert.equal(readGitCleanupNativeProof(clone), undefined);
  assert.equal(readGitCleanupNativeProof(candidate.actionId), undefined);
});
test("failed native remove never issues an authentic proof even when source is already absent", async (t) => {
  const f = await fixture(t), candidate = await f.prepare();
  f.hooks.guard = (phase) => { if (phase === "remove") { rmSync(f.source, { recursive: true }); writeFileSync(join(f.s.gitDir, "locked"), "native refusal"); } };
  await assert.rejects(f.apply(candidate), (e) => {
    assert.equal(recovery(e), true); assert.equal(e.facts.sourceAbsent, true); assert.equal(e.facts.removalVerified, false);
    assert.equal(e.facts.branchDeleteAttempted, false); assert.equal(e.completedProof, undefined); assert.equal(readGitCleanupNativeProof(e.facts), undefined);
    return true;
  });
  assert.equal(f.calls.includes("record-removal"), false); assert.equal(git(f.repo, "rev-parse", "feature"), f.featureOid);
});
for (const failure of ["complete-guard", "journal", "release"]) test(`verified native OIDs/tree/proof survive ${failure} failure without invented completion`, async (t) => {
  const f = await fixture(t), candidate = await f.prepare();
  if (failure === "complete-guard") f.hooks.owned = (e, phase, guard, proof) => { guard(e, phase, proof); if (phase === "complete") throw Error("ownership changed"); };
  if (failure === "journal") f.hooks.completed = () => { throw Error("durable completion failed"); };
  if (failure === "release") f.hooks.release = () => { throw Error("lease release failed"); };
  await assert.rejects(f.apply(candidate), (e) => {
    assert.equal(recovery(e), true); assert.equal(e.facts.removalRecorded, true); assert.equal(e.facts.branchDeleteVerified, true);
    assert.equal(e.facts.verifiedTargetOid, f.integration.resultOid); assert.equal(e.facts.verifiedTargetTree, f.integration.resultTree);
    assert.equal(e.facts.verifiedMainOid, f.integration.previousTargetOid); assert.equal(e.completedProof.deletedOid, f.featureOid);
    assert.equal(readGitCleanupNativeProof(e.completedProof).kind, "completed");
    assert.equal(!!e.facts.completedRecorded, failure === "release");
    return true;
  });
  assert.equal(existsSync(f.completedFile), failure === "release"); assert.equal(git(f.repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature"), "");
  await assert.rejects(f.apply(candidate));
});
for (const failure of [null, "removal-journal", "completed-journal", "late-registration"]) test(`public cleanup + REAL admission + REAL usage with identity bridge, journal failure=${failure}`, async (t) => {
  const { createGitCleanupAdmission } = await jiti.import("./git-cleanup-admission.ts");
  const { inspectGitOperationAdmission } = await jiti.import("./git-operation-admission.ts");
  const { createTrustedWorkspaceUsage, beginGitWorkspacePlacement } = await jiti.import("./git-workspace-usage.ts");
  const f = await fixture(t, "merge", { primaryTarget: true }), agentDir = join(f.dir, "agent"); mkdirSync(agentDir, { mode: 0o700 });
  const removalAcks = new WeakMap(), calls = []; let removal, completed, lease, acquisitions = 0, releases = 0;
  const persist = (file, value) => {
    writeFileSync(file, JSON.stringify(value), { mode: 0o600, flush: true });
    const fd = openSync(dirname(file), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  };
  const admission = createGitCleanupAdmission({ agentDir, readNativeProof: readGitCleanupNativeProof,
    async onIntent(e) { calls.push("intent"); persist(f.ledger, e); },
    async onRemoval(metadata) {
      calls.push("removal-journal"); assert.equal(readGitCleanupNativeProof(removal).kind, "removed");
      assert.deepEqual(metadata, readGitCleanupNativeProof(removal));
      assert.equal(readGitCleanupNativeProof(metadata), undefined, "journal metadata is never a native handle");
      if (failure === "removal-journal") throw Error("journal failed");
      persist(f.removalFile, metadata);
    },
    async onCompleted(metadata) {
      calls.push("completed-journal"); assert.equal(readGitCleanupNativeProof(completed).kind, "completed");
      assert.deepEqual(metadata, readGitCleanupNativeProof(completed));
      assert.equal(inspectGitOperationAdmission(agentDir, f.s.commonDir).admitted, false, "final callback precedes admission release");
      assert.throws(() => beginGitWorkspacePlacement(f.source), (e) => e.code === "leased");
      if (failure === "completed-journal") throw Error("final journal failed");
      if (failure === "late-registration") {
        const late = join(f.dir, "late-linked");
        git(f.repo, "worktree", "add", "--detach", late, "HEAD");
        assert.equal(existsSync(join(late, ".git")), true, "callback must actually introduce the unsupported registration");
        calls.push("late-registration-created");
      } else persist(f.completedFile, metadata);
    },
    async onFailure(facts) { persist(f.failureFile, facts); },
  });
  const known = () => ({ known: true, entries: [] });
  const usage = createTrustedWorkspaceUsage(() => ({ sessions: known(), terminals: known(), checks: known(), inflight: known() }), admission.readRecordedRemoval);
  f.hooks.admission = {
    assertAdmission: admission.assertAdmission,
    async beginIntent(e) {
      const intent = await admission.beginIntent(e);
      return { ...intent,
        assertOwned(inventory, phase, proof) {
          if (phase === "complete") {
            completed = proof; assert.equal(readGitCleanupNativeProof(proof).kind, "completed");
            calls.push("proof-bearing-complete-guard");
          }
          return intent.assertOwned(inventory, phase, proof);
        },
        async recordRemoval(proof) {
          removal = proof;
          const ack = await intent.recordRemoval(proof);
          assert.ok(admission.readRecordedRemoval(ack)); assert.equal(admission.readRecordedRemoval(proof), undefined);
          assert.equal(admission.readRecordedRemoval(structuredClone(ack)), undefined);
          removalAcks.set(proof, ack); calls.push("issued-removal-ack"); return ack;
        },
      };
    },
  };
  f.hooks.acquireLease = (r, e) => {
    acquisitions++;
    lease = usage.acquireLease(r.cwd, r.identities.checkout, { actionId: e.actionId, featureOid: e.integration.featureOid,
      adminPath: r.gitDir, adminIdentity: r.identities.git, markerIdentity: r.identities.marker, adminInventoryHash: e.inventory.admins[basename(r.gitDir)] });
    return {
      assertIdle: () => lease.assertUnused(),
      acknowledgeRemoval(proof) {
        const ack = removalAcks.get(proof); assert.ok(ack, "only the awaited durable record supplies a sealed acknowledgement");
        assert.ok(admission.readRecordedRemoval(ack)); assert.equal(existsSync(f.removalFile), true);
        lease.acknowledgeRemoval(ack); calls.push("usage-transition");
      },
      release() { releases++; lease.release(); },
    };
  };
  const candidate = await f.prepare();
  if (failure) {
    await assert.rejects(f.apply(candidate), (e) => {
      assert.equal(recovery(e), true); assert.equal(e.facts.removalVerified, true);
      assert.equal(e.facts.branchDeleteVerified, failure !== "removal-journal");
      assert.equal(e.facts.verifiedFeatureOid, f.featureOid);
      if (failure === "late-registration") {
        // Real release() synchronously closes descriptors; it does NOT attest
        // inventory again. Namespace refusal quarantines durable admission,
        // not the successfully closed usage lease. Do not invent uncertainty.
        assert.equal(e.facts.leaseReleaseUncertain, undefined); assert.equal(e.facts.phase, "completed-record");
        assert.equal(e.completedProof, completed); assert.equal(readGitCleanupNativeProof(completed).kind, "completed");
      }
      assert.equal(!!e.facts.completedRecorded, false); return true;
    });
    assert.equal(inspectGitOperationAdmission(agentDir, f.s.commonDir).admitted, false);
    assert.equal(git(f.repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature"), failure === "removal-journal" ? f.featureOid : "");
    assert.equal(existsSync(f.completedFile), false);
    assert.equal(calls.includes("usage-transition"), failure !== "removal-journal");
    assert.equal(calls.includes("late-registration-created"), failure === "late-registration");
  } else {
    const result = await f.apply(candidate);
    assert.equal(result.status, "completed"); assert.equal(result.proof, completed);
    assert.equal(readGitCleanupNativeProof(result.proof).kind, "completed");
    assert.equal(inspectGitOperationAdmission(agentDir, f.s.commonDir).admitted, true);
    assert.equal(git(f.repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature"), "");
    assert.deepEqual(calls, ["intent", "removal-journal", "issued-removal-ack", "usage-transition", "proof-bearing-complete-guard", "completed-journal"]);
  }
  assert.equal(existsSync(f.source), false); assert.equal(existsSync(dirname(f.s.gitDir)), failure === "late-registration");
  assert.equal(acquisitions, 1); assert.equal(releases, 1);
  assert.equal(git(f.repo, "rev-parse", "HEAD"), f.integration.resultOid); assert.equal(git(f.repo, "rev-parse", "HEAD^{tree}"), f.integration.resultTree);
  await assert.rejects(f.apply(candidate));
});
test("async idle lease assertions are refused synchronously without unhandled rejection or native effects", async (t) => {
  const f = await fixture(t), c = await f.prepare();
  f.hooks.acquireLease = () => ({
    assertIdle: async () => { throw Error("PRIVATE ASYNC IDLE CAUSE"); }, acknowledgeRemoval() {}, release() {},
  });
  await assert.rejects(f.apply(c)); assert.equal(existsSync(f.ledger), false); assert.equal(existsSync(f.source), true);
});
test("throwing lease release preserves pre-intent/partial/completed known facts and retains checkout fence", async (t) => {
  for (const phase of ["pre-intent", "partial", "completed", "completed-async-release", "completed-record-failed"]) {
    const f = await fixture(t), c = await f.prepare();
    f.hooks.release = phase === "completed-async-release" ? async () => { throw Error("PRIVATE ASYNC RELEASE CAUSE"); }
      : () => { throw Error("PRIVATE RELEASE CAUSE"); };
    if (phase === "pre-intent") writeFileSync(join(f.source, "base"), "dirty before intent");
    if (phase === "partial") f.hooks.authorize = (current) => { if (current === "before-delete") throw Error("PRIVATE REVOCATION CAUSE"); };
    if (phase === "completed-record-failed") f.hooks.completed = () => { throw Error("PRIVATE RECORD CAUSE"); };
    await assert.rejects(f.apply(c), (e) => {
      assert.equal(recovery(e), true); assert.equal(e.facts.actionId, c.actionId); assert.equal(e.facts.expectedFeatureOid, f.featureOid);
      assert.equal(e.facts.expectedTargetOid, f.integration.resultOid); assert.equal(e.facts.leaseReleaseUncertain, true);
      assert.equal(e.facts.verifiedFeatureOid, f.featureOid); assert.equal(e.facts.verifiedTargetOid, f.integration.resultOid);
      assert.equal(e.facts.verifiedTargetTree, f.integration.resultTree);
      assert.equal(e.facts.checkoutGateRetained, true); assert.equal(isGitCheckoutGated(f.source), true);
      assert.equal(e.message.includes("PRIVATE"), false); assert.equal(JSON.stringify(e).includes("PRIVATE"), false);
      if (phase === "pre-intent") { assert.equal(e.facts.removeAttempted, false); assert.equal(existsSync(f.ledger), false); }
      if (phase === "partial") { assert.equal(e.facts.phase, "before-delete"); assert.equal(e.facts.removalRecorded, true); assert.equal(e.facts.branchDeleteAttempted, false); }
      if (phase === "completed" || phase === "completed-async-release") { assert.equal(e.facts.completedRecorded, true); assert.equal(e.completedProof.actionId, c.actionId); assert.equal(e.completedProof.deletedOid, f.featureOid); }
      if (phase === "completed-record-failed") { assert.equal(e.facts.phase, "completed-record"); assert.equal(e.facts.branchDeleteVerified, true); assert.equal(e.facts.completedRecorded, undefined); }
      return true;
    });
    assert.equal(git(f.repo, "for-each-ref", "--format=%(objectname)", "refs/heads/feature"), ["completed", "completed-async-release", "completed-record-failed"].includes(phase) ? "" : f.featureOid);
  }
});
