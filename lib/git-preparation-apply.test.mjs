import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync,
  renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { applyGitPreparation, applyGitPreparationWithAuthority, prepareGitPreparationApply, readGitPreparationCompletion } = await jiti.import("./git-preparation-apply.ts");
const { inspectGitOperationAdmission, beginGitOperationIntent, readGitOperationReservationOwner } = await jiti.import("./git-operation-admission.ts");
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { createGitAction, transitionGitAction, readGitAction, releaseGitAction } = await jiti.import("./git-action-journal.ts");
const { snapshotGitPreparationAction } = await jiti.import("./git-action-controller.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t, { upstream = true, conflict = false, equivalent = false, ignored = false, lateIgnored = false, empty = false, symlink = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-prepare-apply-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), agentDir = join(home, "agent");
  mkdirSync(join(agentDir, "pi-web"), { recursive: true, mode: 0o700 });
  git(home, "init", "-q", "-b", "main", main);
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  writeFileSync(join(main, "base"), "base\n");
  if (symlink) symlinkSync("base", join(main, "tracked-link"));
  git(main, "add", "."); git(main, "commit", "-qm", "base");
  git(main, "worktree", "add", "-qb", "feature", feature);
  if (!empty) writeFileSync(join(feature, conflict ? "base" : "feature"), "feature\n");
  if (ignored) writeFileSync(join(feature, ".gitignore"), "upstream\n");
  git(feature, "add", ".");
  git(feature, "commit", ...(empty ? ["--allow-empty"] : []), "-qm", "feature");
  if (upstream) {
    writeFileSync(join(main, conflict ? "base" : equivalent ? "feature" : "upstream"), equivalent ? "feature\n" : "upstream\n");
    git(main, "add", "."); git(main, "commit", "-qm", "upstream");
  }
  allowFileRoot(main); allowFileRoot(feature);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: { [main]: { mainBranch: "main" } } }, agentDir);
  const request = { source: { repositoryPath: main, checkoutPath: feature }, target: { repositoryPath: main, checkoutPath: main } };
  if (ignored && !lateIgnored) writeFileSync(join(feature, "upstream"), "ignored and unrelated\n");
  const prepare = () => prepareGitPreparationApply(request, agentDir);
  const apply = (prepared, extra = {}) => applyGitPreparation({ prepared,
    authorize: async () => {}, ...extra });
  const applyAuthority = (prepared, extra = {}) => applyGitPreparationWithAuthority({ prepared,
    authorize: async () => {}, assertCurrentSync() {}, ...extra });
  const current = () => ({ source: git(feature, "rev-parse", "HEAD"), target: git(main, "rev-parse", "HEAD"),
    sourceIndex: readFileSync(git(feature, "rev-parse", "--git-path", "index")),
    targetIndex: readFileSync(join(main, ".git", "index")),
    sourceStatus: git(feature, "status", "--porcelain=v1"), targetStatus: git(main, "status", "--porcelain=v1") });
  const admission = () => inspectGitOperationAdmission(agentDir, join(main, ".git"));
  return { main, feature, home, agentDir, request, prepare, apply, applyAuthority, current, admission };
}

function cachedBase(f, cwd = f.feature) {
  git(f.main, "config", "core.trustctime", "false"); git(f.main, "config", "core.checkstat", "minimal");
  const old = new Date("2001-01-01T00:00:00Z"), path = join(cwd, "base");
  utimesSync(path, old, old); git(cwd, "update-index", "--refresh");
  assert.equal(git(cwd, "status", "--porcelain=v1", "--", "base"), "");
  return () => {
    writeFileSync(path, "evil\n"); utimesSync(path, old, old);
    assert.equal(git(cwd, "status", "--porcelain=v1", "--", "base"), "", "unchanged path has a demonstrably lying stat cache");
    assert.equal(git(cwd, "diff-files", "--name-only", "--", "base"), "");
    assert.equal(readFileSync(path, "utf8"), "evil\n");
  };
}

test("physical tracked native capture and stale apply refuse cached-clean unchanged bytes without intent/completed proof", async (t) => {
  for (const where of ["feature", "main"]) {
    const f = fixture(t), mutate = cachedBase(f, f[where]), p = await f.prepare(), before = f.current();
    mutate();
    assert.equal(git(f[where], "status", "--porcelain=v1"), "");
    await assert.rejects(f.prepare(), (error) => error.code === "dirty");
    let callbacks = 0;
    await assert.rejects(f.applyAuthority(p, { onCompleted() { callbacks++; } }), (error) => error.code === "dirty");
    assert.equal(callbacks, 0);
    assert.equal(readGitPreparationCompletion(p), undefined);
    assert.equal(git(f.feature, "rev-parse", "HEAD"), before.source);
    assert.equal(git(f.main, "rev-parse", "HEAD"), before.target);
    assert.deepEqual(f.current().sourceIndex, before.sourceIndex);
    assert.deepEqual(f.current().targetIndex, before.targetIndex);
    assert.equal(readFileSync(join(f[where], "base"), "utf8"), "evil\n");
    assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
  }
});

for (const stage of ["afterIntent", "afterCheckout", "afterIndexInstall"]) {
  test(`physical tracked native ${stage} fence refuses hidden unchanged bytes and never seals completion`, async (t) => {
    const f = fixture(t), mutate = cachedBase(f), p = await f.prepare(), before = f.current();
    let callbacks = 0, result;
    const apply = f.applyAuthority(p, { [stage]: mutate, onCompleted() { callbacks++; } });
    if (stage === "afterIntent") await assert.rejects(apply, /manual recovery/);
    else result = await apply;
    assert.equal(callbacks, 0);
    assert.equal(readFileSync(join(f.feature, "base"), "utf8"), "evil\n");
    assert.equal(git(f.main, "rev-parse", "HEAD"), before.target);
    assert.equal(f.admission().reason, "unresolved");
    if (stage === "afterIntent") {
      assert.equal(git(f.feature, "rev-parse", "HEAD"), before.source);
      assert.equal(existsSync(join(f.feature, "upstream")), false);
    } else {
      assert.equal(result.status, "partial-state");
      assert.equal(result.recoveryRequired, true);
      assert.equal(result.observedSourceOid, stage === "afterCheckout" ? before.source : p.candidate.newSourceOid);
      assert.equal(readGitPreparationCompletion(result), undefined);
      assert.equal(existsSync(`${git(f.feature, "rev-parse", "--git-path", "index")}.lock`), true);
      assert.equal(readFileSync(join(f.feature, "upstream"), "utf8"), "upstream\n");
      if (stage === "afterCheckout") assert.deepEqual(f.current().sourceIndex, before.sourceIndex);
      else assert.equal(git(f.feature, "status", "--porcelain=v1"), "", "actual bytes dirty despite native installed index/Git status being clean");
    }
    await assert.rejects(f.applyAuthority(p));
    await assert.rejects(f.prepare());
  });
}

test("physical tracked pending completion cannot become sealed when callback leaves stat-cache-hidden bytes", async (t) => {
  const f = fixture(t), mutate = cachedBase(f), p = await f.prepare();
  let completion, pending;
  const result = await f.applyAuthority(p, { onCompleted(handle) {
    completion = handle;
    const evidence = readGitPreparationCompletion(handle);
    pending = evidence.result;
    assert.equal(evidence.sourceTrackedContents.treeOid, p.candidate.comparison.commits.at(-1).newTreeOid);
    mutate();
  } });
  assert.equal(result.status, "partial-state");
  assert.equal(result.observedSourceOid, p.candidate.newSourceOid);
  assert.equal(result.recoveryRequired, true);
  assert.equal(git(f.feature, "status", "--porcelain=v1"), "");
  assert.equal(readGitPreparationCompletion(completion), undefined);
  assert.equal(readGitPreparationCompletion(pending), undefined);
  assert.equal(readGitPreparationCompletion(result), undefined);
  assert.equal(JSON.parse(readFileSync(`${result.recoveryPath}.partial`, "utf8")).phase, "verify-after-completion");
  assert.equal(existsSync(`${git(f.feature, "rev-parse", "--git-path", "index")}.lock`), true);
  assert.equal(f.admission().reason, "unresolved");
});

test("physical tracked native proof uses measured CANDIDATE tree/index, supports no-follow symlink bytes and minimal stat configuration", async (t) => {
  const f = fixture(t, { symlink: true }); cachedBase(f);
  const p = await f.prepare();
  let completed;
  const result = await f.applyAuthority(p, { onCompleted(handle) {
    completed = readGitPreparationCompletion(handle);
    assert.equal(completed.stage, "verified-pending-admission");
    assert.equal(completed.sourceTrackedContents.treeOid, p.candidate.comparison.commits.at(-1).newTreeOid);
    assert.notEqual(completed.sourceTrackedContents.treeOid, p.snapshot.source.trackedContents.treeOid);
    assert.equal(completed.targetTrackedContents.treeOid, p.snapshot.target.trackedContents.treeOid);
    assert.equal(completed.sourceTrackedContents.indexDigest,
      createHash("sha256").update(readFileSync(git(f.feature, "rev-parse", "--git-path", "index"))).digest("hex"));
    assert.equal(Object.isFrozen(completed.sourceTrackedContents), true);
  } });
  assert.equal(result.status, "prepared");
  assert.equal(readFileSync(join(f.feature, "base"), "utf8"), "base\n");
  assert.equal(readlinkSync(join(f.feature, "tracked-link")), "base");
  assert.equal(readGitPreparationCompletion(result).sourceTrackedContents.treeOid, result.treeOid);
  assert.equal(readGitPreparationCompletion(completed.sourceTrackedContents), undefined, "physical read observation alone never mints completion/ordering");
  assert.equal(f.admission().admitted, true);
});

test("authority-bound named API rejects missing, async and non-void/thenable guards without effects or no-op proof", async (t) => {
  assert.equal(typeof applyGitPreparationWithAuthority, "function");
  const f = fixture(t, { upstream: false }), before = f.current(), p = await f.prepare();
  let invoked = false;
  for (const assertCurrentSync of [undefined, null, async () => { invoked = true; }, (async () => {}).bind(null), function* () {}]) {
    await assert.rejects(f.applyAuthority(p, { assertCurrentSync }));
  }
  assert.equal(invoked, false, "async authority claims are not invoked/awaited");
  let thenRead = false;
  for (const value of [Promise.resolve(), { get then() { thenRead = true; return () => {}; } }, true, 1, null]) {
    const prepared = await f.prepare();
    await assert.rejects(f.applyAuthority(prepared, { assertCurrentSync: () => value }));
    assert.equal(readGitPreparationCompletion(prepared), undefined);
  }
  assert.equal(thenRead, false, "do not execute/await a caller thenable");
  assert.deepEqual(f.current(), before);
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

test("authority no-op performs fresh final synchronous validation, never invokes rewrite callbacks/creates intent/proof", async (t) => {
  const f = fixture(t, { upstream: false }), before = f.current();
  let guards = 0;
  for (let i = 0; i < 2; i++) {
    const calls = [];
    const result = await f.applyAuthority(await f.prepare(), {
      authorize: async (phase) => { calls.push(phase); await Promise.resolve(); },
      assertCurrentSync() { guards++; },
      onIntent() { throw Error("no-op must not reserve a rewrite"); },
      onCompleted() { throw Error("no-op must not publish rewrite ordering"); },
    });
    assert.equal(result.status, "already-prepared");
    assert.deepEqual(calls, ["before-apply"]);
    assert.equal(result.oldSourceOid, result.newSourceOid);
    assert.equal(readGitPreparationCompletion(result), undefined);
  }
  assert.equal(guards, 2);
  assert.deepEqual(f.current(), before);
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-preparation-recovery")), false);
  let revoked = false;
  await assert.rejects(f.applyAuthority(await f.prepare(), {
    authorize: async () => { await Promise.resolve(); queueMicrotask(() => { revoked = true; }); },
    assertCurrentSync() { assert.equal(revoked, false, "revoked after final authorization await"); },
  }));
  assert.deepEqual(f.current(), before);
});

for (const boundary of ["final-effect", "final-ref"]) for (const late of ["microtask", "launch-environment"]) {
  test(`authority guard follows ALL final awaits/hooks/setup at ${boundary}: ${late} revocation`, async (t) => {
    const f = fixture(t), p = await f.prepare(), before = f.current();
    const originalEnv = process.env;
    t.after(() => { process.env = originalEnv; });
    let revoked = false, guards = 0, callbacks = 0, envRead = false, result;
    const apply = f.applyAuthority(p, {
      authorize: async (phase) => {
        if (phase !== boundary) return;
        if (late === "microtask") {
          await Promise.resolve();
          queueMicrotask(() => { revoked = true; });
        } else {
          // Revocation occurs while constructing the ACTUAL child's launch
          // environment, after a guard placed outside the launcher would pass.
          process.env = new Proxy(originalEnv, { ownKeys(target) {
            envRead = true; revoked = true; process.env = originalEnv;
            return Reflect.ownKeys(target);
          } });
        }
      },
      assertCurrentSync() {
        guards++;
        process.env = originalEnv;
        if (revoked) throw Error("live authority revoked at launch");
      },
      onCompleted() { callbacks++; },
    });
    try {
      if (boundary === "final-effect") await assert.rejects(apply, /manual recovery/);
      else result = await apply;
    } finally { process.env = originalEnv; }
    assert.equal(revoked, true);
    if (late === "launch-environment") assert.equal(envRead, true);
    assert.equal(guards, boundary === "final-effect" ? 1 : 2);
    assert.equal(callbacks, 0);
    assert.equal(git(f.feature, "rev-parse", "HEAD"), before.source);
    assert.equal(git(f.main, "rev-parse", "HEAD"), before.target);
    assert.deepEqual(f.current().sourceIndex, before.sourceIndex);
    assert.deepEqual(f.current().targetIndex, before.targetIndex);
    assert.equal(f.admission().reason, "unresolved");
    if (boundary === "final-effect") {
      assert.deepEqual(f.current(), before, "no checkout child was launched");
      assert.equal(existsSync(join(f.feature, "upstream")), false);
    } else {
      assert.equal(result.status, "partial-state");
      assert.equal(result.observedSourceOid, before.source);
      assert.equal(result.recoveryRequired, true);
      assert.equal(readGitPreparationCompletion(result), undefined);
      assert.equal(readFileSync(join(f.feature, "upstream"), "utf8"), "upstream\n");
      assert.equal(existsSync(`${git(f.feature, "rev-parse", "--git-path", "index")}.lock`), true);
    }
    await assert.rejects(f.applyAuthority(p));
    await assert.rejects(f.prepare());
  });
}

test("authority refuses an already-executing journal by ID alone, without an authentic held owner", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current(), history = await anchored(t, f, p);
  let intents = 0;
  await assert.rejects(f.applyAuthority(p, { actionId: history.action.id, onIntent() { intents++; } }));
  assert.equal(intents, 0);
  assert.deepEqual(f.current(), before);
  assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
});

test("authority onIntent authenticates exact shared held owner before activating journal; completion is actual private identity", async (t) => {
  const f = fixture(t), p = await f.prepare(), history = await anchored(t, f, p, false);
  let action = history.action, heldReservation, measured, guards = 0;
  const result = await f.applyAuthority(p, {
    actionId: action.id,
    onIntent: async (reservation) => {
      heldReservation = reservation;
      const held = readGitOperationReservationOwner(reservation);
      assert.equal(held.kind, "prepare");
      assert.equal(held.actionId, action.id);
      assert.equal(held.agentDir, f.agentDir);
      assert.equal(held.selection.cwd, f.feature);
      assert.equal(readGitOperationReservationOwner({ ...reservation }), undefined);
      assert.equal(readGitOperationReservationOwner({ id: reservation.id, actionId: action.id }), undefined);
      assert.equal(intentRecords(f)[0].id, held.id);
      action = await transitionGitAction(action.id, action.revision, { state: "executing" }, f.agentDir);
    },
    authorize: async (phase) => {
      await Promise.resolve();
      if (phase !== "before-apply") assert.equal(readGitOperationReservationOwner(heldReservation).actionId, action.id);
    },
    assertCurrentSync() {
      guards++;
      const owner = readGitOperationReservationOwner(heldReservation);
      assert.equal(owner.actionId, action.id, "only the SAME live reservation authenticates the active journal");
      assert.equal(owner.selection.cwd, f.feature);
    },
    onCompleted: async (handle) => {
      const evidence = readGitPreparationCompletion(handle);
      assert.equal(evidence.stage, "verified-pending-admission");
      assert.equal(evidence.actionId, action.id);
      assert.equal(evidence.intentId, readGitOperationReservationOwner(heldReservation).id);
      measured = evidence.result;
      assert.equal(readGitPreparationCompletion(measured), undefined, "no completed claim before durable recording");
      action = await transitionGitAction(action.id, action.revision, { state: "succeeded", outcome: history.outcome(evidence) }, f.agentDir);
    },
  });
  assert.equal(result.status, "prepared");
  assert.equal(guards, 2);
  assert.equal(result, measured);
  assert.equal(readGitPreparationCompletion(result).stage, "completed");
  assert.equal(readGitPreparationCompletion(structuredClone(result)), undefined);
  assert.equal(readGitOperationReservationOwner(heldReservation), undefined, "resolved/restarted/copy cannot retain held ownership");
  assert.equal(f.admission().admitted, true);
  assert.equal((await readGitAction(action.id, {}, f.agentDir)).record.state, "succeeded");
});

test("authority durable completion failure retains native index.lock and measured OIDs but never issues completed proof", async (t) => {
  const f = fixture(t), p = await f.prepare(), history = await anchored(t, f, p, false), before = f.current();
  let action = history.action, completion, actual;
  const result = await f.applyAuthority(p, { actionId: action.id,
    onIntent: async (reservation) => {
      assert.equal(readGitOperationReservationOwner(reservation).actionId, action.id);
      action = await transitionGitAction(action.id, action.revision, { state: "executing" }, f.agentDir);
    },
    onCompleted(handle) {
      completion = handle; actual = readGitPreparationCompletion(handle).result;
      throw Error("durable completion failed after exact native Git effects");
    },
  });
  assert.equal(result.status, "partial-state");
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.oldSourceOid, before.source);
  assert.equal(result.newSourceOid, p.candidate.newSourceOid);
  assert.equal(result.observedSourceOid, result.newSourceOid);
  assert.equal(result.treeOid, git(f.feature, "rev-parse", `${result.newSourceOid}^{tree}`));
  assert.equal(git(f.main, "rev-parse", "HEAD"), before.target);
  assert.equal(readGitPreparationCompletion(completion), undefined);
  assert.equal(readGitPreparationCompletion(actual), undefined);
  assert.equal(readGitPreparationCompletion(result), undefined);
  const lock = `${git(f.feature, "rev-parse", "--git-path", "index")}.lock`;
  assert.equal(existsSync(lock), true);
  assert.equal(f.admission().reason, "unresolved");
  await assert.rejects(f.applyAuthority(p));
  await assert.rejects(f.prepare());
  assert.equal(existsSync(lock), true, "no finally/retry path releases native protection after effects");
});

/** Disposable executable wrapper, gated solely by node:test. It races inside
 * the actual update-ref --stdin delegation AFTER the helper's last identity
 * fence, not at an apply test seam and never via forwarded model/options data. */
function transactionWrapper(f, prepared, race = "direct") {
  assert.ok(process.env.NODE_TEST_CONTEXT);
  const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const bin = join(f.home, "native-transaction-wrapper"), evidence = join(bin, "transaction.json");
  mkdirSync(bin, { mode: 0o700 });
  const executable = join(bin, "git");
  writeFileSync(executable, `#!${process.execPath}
const {readFileSync, writeFileSync}=require('node:fs');
const {spawnSync}=require('node:child_process');
const realGit=${JSON.stringify(realGit)}, args=process.argv.slice(2);
if (!process.env.NODE_TEST_CONTEXT || args.at(-2)!=='update-ref' || args.at(-1)!=='--stdin') {
  const child=spawnSync(realGit,args,{stdio:'inherit'}); process.exit(child.status??1);
}
const input=readFileSync(0), prefix=args.slice(0,-2), race=${JSON.stringify(race)};
const source=${JSON.stringify(prepared.snapshot.source.ref)}, target=${JSON.stringify(prepared.snapshot.target.ref)};
const otherSource='refs/heads/OtherSource', otherMain='refs/heads/OtherMain';
const run=(...tail)=>{
  const child=spawnSync(realGit,[...prefix,...tail],{encoding:'utf8'});
  if(child.status!==0) throw Error(child.stderr); return child.stdout.trim();
};
if(race==='sourceSym') {
  // The unrelated branch starts at the base, so preflight has no own-private
  // sharing. This external racer parks it at the approved OLD source OID at
  // delegation, making the malicious alias pass a dereferencing old-OID CAS.
  run('update-ref',otherSource,${JSON.stringify(prepared.snapshot.source.oid)});
  run('symbolic-ref',source,otherSource);
} else if(race==='targetSym') run('symbolic-ref',target,otherMain);
const state=()=>({otherSource:run('show-ref','--verify','--hash',otherSource),
  otherMain:run('show-ref','--verify','--hash',otherMain)});
const before=state();
const child=spawnSync(realGit,args,{input,encoding:'utf8'});
writeFileSync(${JSON.stringify(evidence)},JSON.stringify({commands:input.toString(),race,before,after:state(),
  status:child.status,stderr:child.stderr}),{flag:'wx',mode:0o600});
process.exit(child.status??1);
`, { mode: 0o700 });
  chmodSync(executable, 0o700);
  const previousPath = process.env.PATH;
  return { activate: () => { process.env.PATH = `${bin}:${previousPath}`; },
    restore: () => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; },
    read: () => JSON.parse(readFileSync(evidence, "utf8")) };
}
function assertTransactionInput(record, prepared) {
  assert.equal(record.commands, `start\noption no-deref\nverify ${prepared.snapshot.target.ref} ${prepared.snapshot.target.oid}\n` +
    `option no-deref\nupdate ${prepared.snapshot.source.ref} ${prepared.candidate.newSourceOid} ${prepared.snapshot.source.oid}\nprepare\ncommit\n`);
  assert.deepEqual(record.after, record.before, "native transaction never advances either unapproved third ref");
}

for (const race of ["direct", "sourceSym", "targetSym"]) test(`native ref transaction scopes no-deref per operation: ${race}`, async (t) => {
  const f = fixture(t, { empty: true });
  const base = git(f.main, "rev-parse", "main~1");
  git(f.main, "branch", "OtherSource", base);
  git(f.main, "branch", "OtherMain", "main");
  const p = await f.prepare(), old = f.current();
  assert.equal(git(f.feature, "rev-parse", "HEAD^{tree}"), git(f.feature, "rev-parse", "HEAD^^{tree}"), "own private commit is empty");
  assert.equal(p.candidate.comparison.commits[0].emptyAfterReplay, true);
  const wrapper = transactionWrapper(f, p, race);
  t.after(wrapper.restore);
  let completionCalls = 0, completed;
  let result;
  try {
    result = await f.apply(p, { authorize: async (phase) => {
      if (phase === "final-ref") wrapper.activate();
    }, onCompleted: (handle) => { completionCalls++; completed = readGitPreparationCompletion(handle).result; } });
  } finally { wrapper.restore(); }
  const record = wrapper.read();
  t.diagnostic(`delegated Git status=${record.status}; native apply=${result.status}`);
  assertTransactionInput(record, p);
  assert.equal(git(f.main, "show-ref", "--verify", "--hash", "refs/heads/OtherSource"), record.before.otherSource);
  assert.equal(git(f.main, "show-ref", "--verify", "--hash", "refs/heads/OtherMain"), old.target);
  assert.equal(readFileSync(join(f.feature, "upstream"), "utf8"), "upstream\n", "race occurs after real checkout effects");
  if (race === "direct" || result.status === "prepared") {
    // Some Git versions may safely replace the source symbol with the exact
    // named direct ref under no-deref. That does not authorize a third ref.
    assert.notEqual(race, "targetSym", "unexpected target representation cannot become verified completion");
    assert.equal(record.status, 0);
    assert.equal(result.status, "prepared");
    assert.equal(git(f.feature, "rev-parse", "HEAD"), p.candidate.newSourceOid);
    assert.throws(() => git(f.feature, "symbolic-ref", "--quiet", p.snapshot.source.ref), "source is now a direct ref");
    assert.equal(completionCalls, 1);
    assert.equal(completed, result);
    assert.equal(readGitPreparationCompletion(result).stage, "completed");
    assert.equal(f.admission().admitted, true);
  } else {
    assert.equal(result.status, "partial-state");
    assert.equal(result.recoveryRequired, true);
    assert.equal(completionCalls, 0, "refusal/uncertainty never reaches verified completion callback");
    assert.equal(readGitPreparationCompletion(result), undefined);
    assert.equal(f.admission().reason, "unresolved");
    assert.equal(existsSync(`${git(f.feature, "rev-parse", "--git-path", "index")}.lock`), true);
    if (record.status !== 0) {
      assert.equal(result.observedSourceOid, old.source);
      assert.equal(JSON.parse(readFileSync(`${result.recoveryPath}.partial`, "utf8")).phase, "ref-transaction");
    }
    await assert.rejects(f.apply(p));
    await assert.rejects(f.prepare());
  }
});

test("clean linear rewrite reports actual old/new OIDs, installs index and resolves intent", async (t) => {
  const f = fixture(t);
  const before = f.current(), prepared = await f.prepare(), calls = [];
  const result = await f.apply(prepared, { authorize: async (phase) => { calls.push(phase); } });
  assert.equal(result.status, "prepared", result.status === "partial-state" ? readFileSync(`${result.recoveryPath}.partial`, "utf8") : "");
  assert.deepEqual(calls, ["before-apply", "final-effect", "final-ref"]);
  assert.equal(result.oldSourceOid, before.source);
  assert.equal(result.newSourceOid, git(f.feature, "rev-parse", "HEAD"));
  assert.notEqual(result.newSourceOid, before.source);
  assert.equal(result.targetOid, before.target);
  assert.equal(git(f.feature, "rev-parse", "HEAD^"), before.target);
  assert.equal(git(f.feature, "status", "--porcelain=v1"), "");
  assert.equal(git(f.main, "status", "--porcelain=v1"), "");
  assert.deepEqual(f.current().targetIndex, before.targetIndex);
  assert.equal(f.admission().admitted, true);
  assert.equal(JSON.parse(readFileSync(`${result.recoveryPath}.outcome`, "utf8")).afterOid, result.newSourceOid);
});

test("content-equivalent tree still rewrites commit ID; already-prepared never creates intent", async (t) => {
  const f = fixture(t, { equivalent: true });
  const p = await f.prepare(), old = f.current();
  assert.equal(p.candidate.comparison.commits[0].emptyAfterReplay, true);
  const result = await f.apply(p);
  assert.equal(result.status, "prepared", result.status === "partial-state" ? readFileSync(`${result.recoveryPath}.partial`, "utf8") : "");
  assert.notEqual(result.newSourceOid, old.source);
  assert.deepEqual(f.current().targetIndex, old.targetIndex);
  const n = fixture(t, { upstream: false });
  const noop = await n.apply(await n.prepare(), { authorize: () => { throw Error("unexpected authorization"); },
    onCompleted: () => { throw Error("no-op is not a rewrite completion"); } });
  assert.equal(noop.status, "already-prepared");
  assert.equal(noop.oldSourceOid, noop.newSourceOid);
  assert.equal(readGitPreparationCompletion(noop), undefined);
  assert.equal(existsSync(join(n.agentDir, "pi-web", "git-operation-admission")), false);
});

test("stale source or target, conflict and ignored collision refuse without an intent", async (t) => {
  for (const which of ["source", "target", "conflict", "ignored"]) {
    const f = fixture(t, { conflict: which === "conflict", ignored: which === "ignored" });
    if (which === "conflict") {
      await assert.rejects(f.prepare(), (error) => error.code === "conflict");
      assert.equal(f.admission().reason, "unavailable");
      continue;
    }
    const p = await f.prepare();
    if (which === "source" || which === "target") git(f[which === "source" ? "feature" : "main"], "commit", "--allow-empty", "-qm", "moved");
    const before = f.current();
    await assert.rejects(f.apply(p));
    assert.deepEqual(f.current(), before);
    assert.notEqual(f.admission().reason, "unresolved");
  }
});

test("forged designation and copied candidate cannot become executable", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  await assert.rejects(f.apply(structuredClone(p)));
  p.snapshot.designatedMain.ref = "refs/heads/feature";
  await assert.rejects(f.apply(p));
  assert.deepEqual(f.current(), before);
  assert.notEqual(f.admission().reason, "unresolved");
});

test("final authorization failure quarantines", async (t) => {
  const f = fixture(t), p = await f.prepare();
  await assert.rejects(f.apply(structuredClone(p)));
  const before = f.current();
  const result = await f.apply(p, { authorize: async (phase) => {
    if (phase === "final-ref") throw Error("revoked");
  } });
  assert.equal(result.status, "partial-state");
  assert.equal(result.observedSourceOid, before.source);
  assert.equal(f.admission().reason, "unresolved");
  assert.equal(existsSync(`${result.recoveryPath}.partial`), true);
  assert.equal(existsSync(`${git(f.feature, "rev-parse", "--git-path", "index")}.lock`), true);
});

test("target ref move during checkout never permits feature CAS", async (t) => {
  const f = fixture(t), prepared = await f.prepare(), oldFeature = git(f.feature, "rev-parse", "HEAD");
  const result = await f.apply(prepared, { afterCheckout: () => {
    git(f.main, "commit", "--allow-empty", "-qm", "target moved");
  } });
  assert.equal(result.status, "partial-state");
  assert.equal(result.observedSourceOid, oldFeature);
  assert.equal(git(f.feature, "rev-parse", "HEAD"), oldFeature);
  assert.equal(f.admission().reason, "unresolved");
});

test("mid-apply main designation/settings write cannot reach ref CAS", async (t) => {
  const f = fixture(t), prepared = await f.prepare(), before = f.current();
  const result = await f.apply(prepared, { afterCheckout: () => {
    writeGitWorkflowSettingsDocument({ version: 1, paused: true, global: {},
      projects: { [f.main]: { mainBranch: "feature" } } }, f.agentDir);
  } });
  assert.equal(result.status, "partial-state");
  assert.equal(result.observedSourceOid, before.source);
  assert.equal(git(f.feature, "rev-parse", "HEAD"), before.source);
  assert.equal(f.admission().reason, "unresolved");
  assert.equal(JSON.parse(readFileSync(`${result.recoveryPath}.partial`, "utf8")).status, "partial-state");
});

test("retargeted physical Git dir cannot redirect pinned index effects", async (t) => {
  const f = fixture(t), p = await f.prepare();
  const gitDir = git(f.feature, "rev-parse", "--absolute-git-dir");
  const decoy = "other repository index: do not overwrite\n";
  await assert.rejects(f.apply(p, { afterIntent: () => {
    renameSync(gitDir, `${gitDir}-original`);
    mkdirSync(gitDir);
    writeFileSync(join(gitDir, "index"), decoy);
  } }), /manual recovery/);
  assert.equal(readFileSync(join(gitDir, "index"), "utf8"), decoy);
  assert.equal(f.admission().reason, "unresolved");
  const recovery = readdirSync(join(f.agentDir, "pi-web", "git-preparation-recovery", "v1")).find((name) => name.endsWith(".json"));
  assert.equal(JSON.parse(readFileSync(join(f.agentDir, "pi-web", "git-preparation-recovery", "v1", recovery), "utf8"))
    .physicalIndexPath, join(gitDir, "index"));
});

test("ignored collision arriving after intent cannot overwrite user data or be retried", async (t) => {
  const f = fixture(t, { ignored: true, lateIgnored: true }), p = await f.prepare(), before = f.current();
  const userFile = join(f.feature, "upstream"), userData = "do not overwrite me\n";
  await assert.rejects(f.apply(p, { afterIntent: () => { writeFileSync(userFile, userData); } }), /manual recovery/);
  assert.equal(readFileSync(userFile, "utf8"), userData);
  assert.equal(git(f.feature, "rev-parse", "HEAD"), before.source);
  assert.deepEqual(f.current().sourceIndex, before.sourceIndex);
  assert.equal(readFileSync(join(f.feature, "feature"), "utf8"), "feature\n");
  assert.equal(f.admission().reason, "unresolved");
  await assert.rejects(f.apply(p));
  await assert.rejects(f.prepare());
  assert.equal(readFileSync(userFile, "utf8"), userData);
});

test("post-install failure recreates owned lock and preserves truthful partial evidence", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  let completionCalls = 0;
  const result = await f.apply(p, { afterIndexInstall: () => { throw Error("injected after index rename"); },
    onCompleted: () => { completionCalls++; } });
  assert.equal(completionCalls, 0, "no registry/callback on unverified effects");
  assert.equal(readGitPreparationCompletion(result), undefined);
  assert.equal(result.status, "partial-state");
  assert.equal(result.oldSourceOid, before.source);
  assert.equal(result.observedSourceOid, p.candidate.newSourceOid);
  assert.equal(git(f.feature, "rev-parse", "HEAD"), p.candidate.newSourceOid);
  assert.equal(git(f.main, "rev-parse", "HEAD"), before.target);
  assert.equal(git(f.feature, "rev-parse", "HEAD^{tree}"), p.candidate.comparison.commits.at(-1).newTreeOid);
  assert.deepEqual(f.current().sourceIndex, readFileSync(result.recoveryPath.replace(/\.json$/, ".index")));
  assert.notDeepEqual(f.current().sourceIndex, before.sourceIndex);
  const recovery = JSON.parse(readFileSync(`${result.recoveryPath}.partial`, "utf8"));
  assert.equal(recovery.indexInstalled, true);
  assert.equal(recovery.indexLock, "owned-retained");
  assert.equal(recovery.observedSourceOid, p.candidate.newSourceOid);
  const indexLock = `${git(f.feature, "rev-parse", "--git-path", "index")}.lock`;
  assert.equal(existsSync(indexLock), true);
  writeFileSync(join(f.feature, "unrelated"), "keep user data\n");
  assert.throws(() => execFileSync("git", ["-C", f.feature, "add", "unrelated"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  (error) => error.status !== 0 && /index\.lock/.test(error.stderr));
  assert.equal(readFileSync(join(f.feature, "unrelated"), "utf8"), "keep user data\n");
  assert.equal(f.admission().reason, "unresolved");
  await assert.rejects(f.apply(p));
});

test("post-install replacement lock collision stays unconfirmed and demands manual recovery", async (t) => {
  const f = fixture(t), p = await f.prepare();
  const lock = `${git(f.feature, "rev-parse", "--git-path", "index")}.lock`;
  await assert.rejects(f.apply(p, { afterIndexInstall: () => {
    writeFileSync(lock, "external lock must not be overwritten\n", { flag: "wx" });
    throw Error("injected failure");
  } }), /manual recovery; index lock not retained/);
  assert.equal(readFileSync(lock, "utf8"), "external lock must not be overwritten\n");
  const dir = join(f.agentDir, "pi-web", "git-preparation-recovery", "v1");
  const record = readdirSync(dir).find((name) => name.endsWith(".partial"));
  assert.ok(record);
  const evidence = JSON.parse(readFileSync(join(dir, record), "utf8"));
  assert.equal(evidence.status, "partial-state");
  assert.equal(evidence.indexInstalled, true);
  assert.equal(evidence.indexLock, "unconfirmed");
  assert.equal(f.admission().reason, "unresolved");
});

test("abrupt process exit after intent leaves durable recovery and unresolved admission", async (t) => {
  const f = fixture(t), before = f.current();
  const code = `import { createJiti } from "jiti";
    const j = createJiti(import.meta.url);
    const { allowFileRoot } = await j.import("./lib/file-access.ts");
    const { prepareGitPreparationApply, applyGitPreparation } = await j.import("./lib/git-preparation-apply.ts");
    allowFileRoot(${JSON.stringify(f.main)}); allowFileRoot(${JSON.stringify(f.feature)});
    const prepared = await prepareGitPreparationApply({source:{repositoryPath:${JSON.stringify(f.main)},checkoutPath:${JSON.stringify(f.feature)}},
      target:{repositoryPath:${JSON.stringify(f.main)},checkoutPath:${JSON.stringify(f.main)}}}, ${JSON.stringify(f.agentDir)});
    await applyGitPreparation({prepared, authorize:async()=>{}, afterIntent:()=>process.exit(77)});`;
  assert.throws(() => execFileSync(process.execPath, ["--input-type=module", "-e", code],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf8", timeout: 60_000 }), (error) => error.status === 77);
  assert.equal(f.admission().reason, "unresolved");
  assert.deepEqual(f.current(), before);
  assert.equal(readdirSync(join(f.agentDir, "pi-web", "git-preparation-recovery", "v1")).some((s) => s.endsWith(".json")), true);
});

test("intent failure quarantines without checkout; after-checkout and after-ref failures remain partial", async (t) => {
  for (const stage of ["afterIntent", "afterCheckout", "afterRef"]) {
    const f = fixture(t), p = await f.prepare(), before = f.current();
    const change = { [stage]: () => { throw Error("simulated crash"); } };
    if (stage === "afterIntent") {
      await assert.rejects(f.apply(p, change), /manual recovery/);
      assert.deepEqual(f.current(), before);
    } else {
      const result = await f.apply(p, change);
      assert.equal(result.status, "partial-state");
      assert.equal(result.observedSourceOid, git(f.feature, "rev-parse", "HEAD"));
      assert.equal(existsSync(result.recoveryPath), true);
      assert.equal(JSON.parse(readFileSync(`${result.recoveryPath}.partial`, "utf8")).status, "partial-state");
      assert.equal(existsSync(`${git(f.feature, "rev-parse", "--git-path", "index")}.lock`), true);
      assert.equal(stage === "afterRef" ? result.observedSourceOid !== before.source : result.observedSourceOid === before.source, true);
    }
    assert.equal(f.admission().reason, "unresolved");
    await assert.rejects(f.apply(p)); // no automatic retry even for a pre-checkout crash
  }
});

async function anchored(t, f, prepared, executing = true) {
  const source = await selectCanonicalGitResources(f.request.source), target = await selectCanonicalGitResources(f.request.target);
  const tree = prepared.candidate.comparison.commits.at(-1).newTreeOid;
  const candidate = snapshotGitPreparationAction(source, target, prepared.candidate, tree);
  let action = await createGitAction({ sessionId: "native-preparation-test", source: "agent", candidate }, f.agentDir);
  t.after(() => releaseGitAction(action.id, f.agentDir));
  if (executing) action = await transitionGitAction(action.id, action.revision, { state: "executing" }, f.agentDir);
  return { action, outcome: (evidence) => ({ kind: "preparation", status: "prepared", preparation: {
    oldSourceOid: evidence.result.oldSourceOid, newSourceOid: evidence.result.newSourceOid,
    targetMainOid: evidence.result.targetOid, resultTreeOid: evidence.result.treeOid } }) };
}

const intentRecords = (f) => {
  const dir = join(f.agentDir, "pi-web", "git-operation-admission", "v1",
    createHash("sha256").update(join(f.main, ".git")).digest("hex"));
  return readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")).record);
};

test("trusted anchored journal ID correlates native intent; completion records authentic outcome before admission resolves", async (t) => {
  const f = fixture(t), p = await f.prepare(), history = await anchored(t, f, p);
  let completion, pendingResult;
  const result = await f.apply(p, { actionId: history.action.id, onCompleted: async (handle) => {
    completion = handle;
    const evidence = readGitPreparationCompletion(handle);
    assert.equal(evidence.stage, "verified-pending-admission");
    assert.equal(evidence.actionId, history.action.id);
    assert.equal(Object.isFrozen(evidence.proof), true);
    assert.equal(Object.isFrozen(evidence.source.identities), true);
    assert.equal(readGitPreparationCompletion(structuredClone(handle)), undefined);
    assert.equal(readGitPreparationCompletion(p.snapshot), undefined);
    assert.equal(readGitPreparationCompletion(evidence.result), undefined, "no successor during callback");
    assert.equal(evidence.result.newSourceOid, git(f.feature, "rev-parse", "HEAD"));
    assert.equal(evidence.proof.resultTreeOid, git(f.feature, "write-tree"));
    assert.deepEqual(f.admission().actionIds, [history.action.id]);
    assert.equal(intentRecords(f)[0].phase, "intent");
    assert.equal(intentRecords(f)[0].id, evidence.intentId);
    pendingResult = evidence.result;
    await transitionGitAction(history.action.id, history.action.revision,
      { state: "succeeded", outcome: history.outcome(evidence) }, f.agentDir);
  } });
  assert.equal(result.status, "prepared");
  assert.equal(result, pendingResult);
  assert.equal(readGitPreparationCompletion(result).stage, "completed");
  assert.equal(readGitPreparationCompletion(completion).result, result);
  assert.equal(readGitPreparationCompletion(structuredClone(result)), undefined);
  assert.equal(intentRecords(f)[0].actionId, history.action.id);
  assert.equal(intentRecords(f)[0].phase, "resolved");
  assert.deepEqual(intentRecords(f)[0].prepareOutcome, readGitPreparationCompletion(result).proof);
  assert.equal((await readGitAction(history.action.id, {}, f.agentDir)).record.state, "succeeded");
  assert.equal(f.admission().admitted, true);
});

test("failed completion quarantines exact native Git with known old/new/tree, no completed identity and restart/blind retry blocked", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current(), history = await anchored(t, f, p);
  let completion, measuredResult;
  const result = await f.apply(p, { actionId: history.action.id, onCompleted: (handle) => {
    completion = handle;
    const evidence = readGitPreparationCompletion(handle);
    measuredResult = evidence.result;
    assert.equal(evidence.stage, "verified-pending-admission");
    assert.equal(git(f.feature, "status", "--porcelain=v1"), "");
    assert.equal(f.admission().reason, "unresolved");
    throw Error("outer history persistence failed");
  } });
  assert.equal(result.status, "partial-state");
  assert.equal(result.recoveryRequired, true);
  assert.equal(result.oldSourceOid, before.source);
  assert.equal(result.newSourceOid, p.candidate.newSourceOid);
  assert.equal(result.observedSourceOid, result.newSourceOid);
  assert.equal(result.treeOid, git(f.feature, "rev-parse", `${result.newSourceOid}^{tree}`));
  assert.deepEqual(f.current().sourceIndex, readFileSync(result.recoveryPath.replace(/\.json$/, ".index")),
    "raw installed index equals the verified candidate index without acquiring or clearing index.lock");
  assert.equal(readGitPreparationCompletion(completion), undefined);
  assert.equal(readGitPreparationCompletion(measuredResult), undefined);
  assert.equal(readGitPreparationCompletion(result), undefined);
  assert.equal(git(f.feature, "status", "--porcelain=v1"), "");
  assert.equal(git(f.main, "rev-parse", "HEAD"), before.target);
  assert.equal(f.admission().reason, "unresolved");
  assert.deepEqual(f.admission().actionIds, [history.action.id]);
  assert.equal(intentRecords(f)[0].phase, "intent");
  assert.equal(JSON.parse(readFileSync(`${result.recoveryPath}.partial`, "utf8")).phase, "completion-callback");
  await assert.rejects(f.apply(p));
  await assert.rejects(f.prepare());
  const script = `import {createJiti} from 'jiti'; const j=createJiti(import.meta.url);
    const {allowFileRoot}=await j.import('./lib/file-access.ts');
    const {prepareGitPreparationApply,readGitPreparationCompletion}=await j.import('./lib/git-preparation-apply.ts');
    const {inspectGitOperationAdmission}=await j.import('./lib/git-operation-admission.ts');
    allowFileRoot(${JSON.stringify(f.main)}); allowFileRoot(${JSON.stringify(f.feature)});
    let blocked=false; try{await prepareGitPreparationApply(${JSON.stringify(f.request)},${JSON.stringify(f.agentDir)})}catch{blocked=true}
    process.stdout.write(JSON.stringify({blocked,authentic:!!readGitPreparationCompletion(${JSON.stringify(measuredResult)}),
      admission:inspectGitOperationAdmission(${JSON.stringify(f.agentDir)},${JSON.stringify(join(f.main, ".git"))})}));`;
  const restarted = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script],
    { cwd: join(import.meta.dirname, ".."), encoding: "utf8", timeout: 90_000 }));
  assert.equal(restarted.blocked, true);
  assert.equal(restarted.authentic, false);
  assert.equal(restarted.admission.reason, "unresolved");
});

test("strict action IDs and existing resolved intent collisions refuse before effects", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  for (const actionId of ["not-a-uuid", `../${randomUUID()}`, randomUUID().toUpperCase(), 42]) {
    await assert.rejects(f.apply(p, { actionId }));
    assert.deepEqual(f.current(), before);
  }
  const id = randomUUID(), existing = beginGitOperationIntent(f.agentDir, join(f.main, ".git"), id, "commit");
  existing.resolve();
  await assert.rejects(f.apply(p, { actionId: id }));
  assert.deepEqual(f.current(), before);
  assert.equal(f.admission().admitted, true);
  assert.equal(intentRecords(f).length, 1);
});

test("final-effect live denial happens before any checkout effect; no callback or automatic release/retry", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  let callbacks = 0;
  await assert.rejects(f.apply(p, { authorize: async (phase) => {
    if (phase === "final-effect") throw Error("revoked before first effect");
  }, onCompleted: () => { callbacks++; } }), /manual recovery/);
  assert.deepEqual(f.current(), before);
  assert.equal(callbacks, 0);
  assert.equal(f.admission().reason, "unresolved");
  await assert.rejects(f.apply(p));
});

test("new detached holders of own-private replay commits fence first effects and ref CAS", async (t) => {
  for (const phase of ["afterIntent", "afterCheckout"]) {
    const f = fixture(t), p = await f.prepare(), before = f.current();
    const holder = join(f.home, "detached-holder");
    const change = { [phase]: () => git(f.main, "worktree", "add", "-q", "--detach", holder, before.source) };
    if (phase === "afterIntent") {
      await assert.rejects(f.apply(p, change), /manual recovery/);
      assert.deepEqual(f.current(), before);
    } else {
      const result = await f.apply(p, change);
      assert.equal(result.status, "partial-state");
      assert.equal(result.observedSourceOid, before.source);
      assert.equal(readGitPreparationCompletion(result), undefined);
    }
    assert.equal(git(f.feature, "rev-parse", "HEAD"), before.source);
    assert.equal(git(holder, "rev-parse", "HEAD"), before.source);
    assert.equal(f.admission().reason, "unresolved");
    await assert.rejects(f.apply(p));
  }
});

test("completion callback cannot mask a subsequently changed checkout as completed", async (t) => {
  const f = fixture(t), p = await f.prepare();
  let completion, measured;
  const result = await f.apply(p, { onCompleted: (handle) => {
    completion = handle; measured = readGitPreparationCompletion(handle).result;
    writeFileSync(join(f.feature, "late-user-file"), "preserve this\n");
  } });
  assert.equal(result.status, "partial-state");
  assert.equal(result.recoveryRequired, true);
  assert.equal(JSON.parse(readFileSync(`${result.recoveryPath}.partial`, "utf8")).phase, "verify-after-completion");
  assert.equal(readFileSync(join(f.feature, "late-user-file"), "utf8"), "preserve this\n");
  assert.equal(readGitPreparationCompletion(completion), undefined);
  assert.equal(readGitPreparationCompletion(measured), undefined);
  assert.equal(f.admission().reason, "unresolved");
});

test("main plus two/three features serially prepare through advancing-main loop: stale old plans, own content/refs retained, no catchup merges", async (t) => {
  for (const count of [2, 3]) {
    const f = fixture(t), features = [f.feature];
    for (let i = 2; i <= count; i++) {
      const cwd = join(f.home, `feature${i}`);
      git(f.main, "worktree", "add", "-qb", `feature${i}`, cwd, "main~1");
      writeFileSync(join(cwd, `feature${i}`), `own ${i}\n`);
      git(cwd, "add", "."); git(cwd, "commit", "-qm", `own ${i}`);
      allowFileRoot(cwd); features.push(cwd);
    }
    for (let round = 1; round <= 2; round++) {
      f.request.source.checkoutPath = features[0];
      const stale = await f.prepare();
      writeFileSync(join(f.main, `upstream${round}`), `main ${round}\n`);
      git(f.main, "add", "."); git(f.main, "commit", "-qm", `main ${round}`);
      const unchanged = f.current();
      await assert.rejects(f.apply(stale));
      assert.deepEqual(f.current(), unchanged);
      const target = git(f.main, "rev-parse", "HEAD"), targetIndex = readFileSync(join(f.main, ".git", "index"));
      for (const cwd of features) {
        f.request.source.checkoutPath = cwd;
        const others = features.filter((other) => other !== cwd).map((other) => ({ cwd: other,
          oid: git(other, "rev-parse", "HEAD"), index: readFileSync(git(other, "rev-parse", "--git-path", "index")),
          content: readFileSync(join(other, other === f.feature ? "feature" : other.split("/").at(-1)), "utf8") }));
        // Unrelated dirt/active operation is not an apply blocker either.
        const dirty = others[0].cwd, dir = git(dirty, "rev-parse", "--absolute-git-dir");
        writeFileSync(join(dirty, "unrelated-untracked"), "keep me\n");
        mkdirSync(join(dir, "rebase-merge"));
        const p = await f.prepare(), result = await f.apply(p);
        assert.equal(result.status, "prepared");
        assert.equal(p.snapshot.registeredWorktrees.length, count + 1);
        assert.equal(git(cwd, "rev-parse", "HEAD^"), target);
        assert.equal(git(cwd, "rev-list", "--count", "--merges", `${target}..HEAD`), "0");
        assert.equal(git(cwd, "rev-list", "--count", `${target}..HEAD`), "1");
        assert.equal(git(cwd, "status", "--porcelain=v1"), "");
        assert.equal(git(f.main, "rev-parse", "HEAD"), target);
        assert.deepEqual(readFileSync(join(f.main, ".git", "index")), targetIndex);
        for (const other of others) {
          assert.equal(git(other.cwd, "rev-parse", "HEAD"), other.oid);
          assert.deepEqual(readFileSync(git(other.cwd, "rev-parse", "--git-path", "index")), other.index);
          assert.equal(readFileSync(join(other.cwd, other.cwd === f.feature ? "feature" : other.cwd.split("/").at(-1)), "utf8"), other.content);
        }
        assert.equal(readFileSync(join(dirty, "unrelated-untracked"), "utf8"), "keep me\n");
        rmSync(join(dirty, "unrelated-untracked")); rmSync(join(dir, "rebase-merge"), { recursive: true });
      }
    }
  }
});
