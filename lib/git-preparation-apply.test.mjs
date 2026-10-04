import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
const configHome = mkdtempSync(join(tmpdir(), "native-preparation-config-"));
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => { if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  rmSync(configHome, { recursive: true, force: true }); });
const { createJiti } = await import("jiti"), jiti = createJiti(import.meta.url);
const { prepareGitPreparationApply, applyGitPreparation, readGitPreparationCompletion, readGitPreparationNativeOutcome, readGitPreparationDiagnosticStatus, retireGitPreparedApply } = await jiti.import("./git-preparation-apply.ts");
const { preflightGitPreparation, sameGitPreparationDependencies } = await jiti.import("./git-preparation.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t, { upstream = true, conflict = false, empty = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "native-preparation-leaf-")); t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), agentDir = join(home, "agent"); mkdirSync(agentDir);
  git(home, "init", "-qb", "main", main); git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  writeFileSync(join(main, "base"), "base\n"); git(main, "add", "."); git(main, "commit", "-qm", "base");
  git(main, "worktree", "add", "-qb", "feature", feature);
  if (!empty) writeFileSync(join(feature, conflict ? "base" : "feature"), "feature\n");
  git(feature, "add", "."); git(feature, "commit", "--allow-empty", "-qm", "feature");
  if (upstream) { writeFileSync(join(main, conflict ? "base" : "upstream"), "upstream\n"); git(main, "add", "."); git(main, "commit", "-qm", "upstream"); }
  allowFileRoot(main); allowFileRoot(feature);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: { [main]: { mainBranch: "main" } } }, agentDir);
  const request = { source: { repositoryPath: main, checkoutPath: feature }, target: { repositoryPath: main, checkoutPath: main } };
  const owner = { sessionId: "prepare-fixture", sessionFile: join(home, "session.json"), generation: "generation-1" }; writeFileSync(owner.sessionFile, JSON.stringify(owner));
  const live = { revision: 1, allowed: true, applying: false, candidate: undefined, approved: undefined };
  const authority = { owner, readAuthorityRevisionSync: () => String(live.revision), assertCurrentSync(binding) {
    assert.ok(live.allowed); assert.deepEqual(binding.owner, owner); assert.deepEqual(JSON.parse(readFileSync(owner.sessionFile)), owner);
    if (live.applying) assert.equal(binding.candidateSha256, live.approved); else live.candidate = binding.candidateSha256;
  } };
  const prepare = () => prepareGitPreparationApply(request, agentDir, authority);
  const apply = (prepared, extra = {}) => { live.applying = true; live.approved = live.candidate;
    return applyGitPreparation({ prepared, authorize: async () => { assert.ok(live.allowed); }, ...extra }); };
  const index = () => git(feature, "rev-parse", "--path-format=absolute", "--git-path", "index");
  const current = () => ({ source: git(feature, "rev-parse", "HEAD"), target: git(main, "rev-parse", "HEAD"),
    sourceIndex: readFileSync(index()), targetIndex: readFileSync(join(main, ".git", "index")) });
  return { home, main, feature, agentDir, request, owner, authority, live, prepare, apply, current, index };
}
test("reversed native roles rewrite source and verify protected main; authentic completion survives retirement", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current(); let hook;
  const result = await f.apply(p, { onCompleted(value) { hook = value; } });
  assert.equal(result.status, "prepared"); assert.equal(result.newSourceOid, p.candidate.newSourceOid);
  assert.equal(git(f.feature, "rev-parse", "HEAD^"), before.target); assert.equal(f.current().target, before.target);
  assert.deepEqual(f.current().targetIndex, before.targetIndex); assert.equal(git(f.feature, "status", "--porcelain"), "");
  const proof = readGitPreparationCompletion(result); assert.equal(proof.stage, "completed"); assert.deepEqual(proof.invocationOwner, f.owner);
  assert.equal(proof.sourceTrackedContents.treeOid, result.treeOid); assert.equal(proof.nativeOutcome.status, "complete");
  assert.deepEqual(readGitPreparationCompletion(hook), proof); assert.equal(readGitPreparationCompletion({ ...result }), undefined);
  assert.equal(readGitPreparationDiagnosticStatus(result), "recorded"); assert.equal(existsSync(`${f.index()}.lock`), false);
  await assert.rejects(f.apply(p));
});
test("missing trusted original owner refuses before reads, including no-op", async (t) => {
  const f = fixture(t, { upstream: false }), before = f.current();
  await assert.rejects(prepareGitPreparationApply(f.request, f.agentDir), /original native invocation/); assert.deepEqual(f.current(), before);
  const p = await f.prepare(), result = await f.apply(p);
  assert.equal(result.status, "already-prepared"); assert.equal(readGitPreparationCompletion(result), undefined);
  assert.equal(readGitPreparationNativeOutcome(result), undefined); assert.deepEqual(f.current(), before);
});
test("original change-and-restore during prepare awaits rejects; fresh generation/guard cannot revive apply", async (t) => {
  const f = fixture(t), before = f.current(), started = f.prepare(); f.live.allowed = false; f.live.revision++; f.live.allowed = true; f.live.revision++;
  await assert.rejects(started, /authority changed/); assert.deepEqual(f.current(), before);
  const p = await f.prepare(); f.live.revision++; await assert.rejects(f.apply(p)); assert.deepEqual(f.current(), before);
});
test("optional diagnostic callback failure does not falsify known native success or invent locks", async (t) => {
  const f = fixture(t), p = await f.prepare(); let completion;
  const result = await f.apply(p, { onCompleted(value) { completion = value; throw Error("disk full"); } });
  assert.equal(result.status, "prepared"); assert.equal(readGitPreparationCompletion(result).stage, "completed");
  assert.equal(readGitPreparationDiagnosticStatus(result), "unavailable"); assert.equal(readGitPreparationDiagnosticStatus(completion), "unavailable");
  assert.equal(readGitPreparationNativeOutcome(result).refAcknowledged, true); assert.equal(readGitPreparationNativeOutcome(result).indexInstalled, true);
  assert.equal(existsSync(`${f.index()}.lock`), false);
});
test("newer post-release source advance cannot revoke historical success", async (t) => {
  const f = fixture(t), p = await f.prepare();
  const result = await f.apply(p, { onCompleted() { writeFileSync(join(f.feature, "later"), "later\n"); git(f.feature, "add", "."); git(f.feature, "commit", "-qm", "later"); } });
  assert.equal(result.newSourceOid, p.candidate.newSourceOid); assert.notEqual(f.current().source, result.newSourceOid);
  assert.equal(readGitPreparationCompletion(result).proof.afterOid, result.newSourceOid); assert.equal(existsSync(`${f.index()}.lock`), false);
});
test("unrelated refs/reflogs and foreign failure diagnostics do not stale version2 dependencies", async (t) => {
  const f = fixture(t), p = await f.prepare(); git(f.main, "branch", "unrelated", "main");
  const before = await preflightGitPreparation(f.request, f.agentDir); git(f.main, "update-ref", "refs/heads/unrelated", git(f.main, "rev-parse", "HEAD^"));
  const after = await preflightGitPreparation(f.request, f.agentDir);
  assert.equal(sameGitPreparationDependencies(before, after), true);
  assert.equal(sameGitPreparationDependencies({ ...before, dependencyVersion: 1 }, after), false);
  const history = join(f.agentDir, "pi-web", "git-operation-admission", "v1"); mkdirSync(history, { recursive: true }); writeFileSync(join(history, "foreign"), "invalid history");
  assert.equal((await f.apply(p)).status, "prepared");
});
for (const phase of ["afterIntent", "afterCheckout", "afterRef"]) test(`${phase} failure exposes actual checkpoints, never retained/recreated index quarantine`, async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  await assert.rejects(f.apply(p, { [phase]() { throw Error("fixture phase failure"); } }), (e) => {
    const outcome = readGitPreparationNativeOutcome(e); assert.ok(outcome);
    assert.equal(outcome.refPrepared, true); assert.equal(outcome.checkoutAttempted, phase !== "afterIntent");
    assert.equal(outcome.refAcknowledged, phase === "afterRef"); assert.equal(outcome.indexInstalled, false);
    assert.equal(readGitPreparationNativeOutcome({ ...e }), undefined); return true;
  });
  assert.equal(existsSync(`${f.index()}.lock`), false); assert.deepEqual(f.current().sourceIndex, before.sourceIndex);
  assert.equal(f.current().target, before.target);
});
test("final original guard revocation rejects after checkout before ref", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  await assert.rejects(f.apply(p, { afterCheckout() { f.live.allowed = false; f.live.revision++; f.live.allowed = true; f.live.revision++; } }), (e) => {
    const x = readGitPreparationNativeOutcome(e); assert.equal(x.checkoutAttempted, true); assert.equal(x.refCommitSent, false); return true;
  });
  assert.equal(f.current().source, before.source); assert.equal(existsSync(`${f.index()}.lock`), false);
});
for (const mode of ["ref", "deleted-ref-log", "late-ref"]) test(`positive sharing ${mode} still blocks exact rewrite`, async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  const share = () => { git(f.main, "update-ref", "--create-reflog", "refs/heads/shared", before.source); };
  if (mode !== "late-ref") share();
  if (mode === "deleted-ref-log") git(f.main, "update-ref", "refs/heads/shared", before.target);
  const extra = mode === "late-ref" ? { afterIntent: share } : {};
  await assert.rejects(f.apply(p, extra)); assert.deepEqual(f.current(), before); assert.equal(existsSync(`${f.index()}.lock`), false);
});
for (const mode of ["main", "source", "hook", "symref", "foreign-lock", "path-swap", "bytes"]) test(`changed ${mode} refuses without source effects`, async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  if (mode === "main") git(f.main, "update-ref", "refs/heads/main", git(f.main, "rev-parse", "HEAD^"));
  if (mode === "source") git(f.main, "update-ref", "refs/heads/feature", before.target);
  if (mode === "hook") writeFileSync(join(f.main, ".git", "hooks", "reference-transaction"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  if (mode === "symref") { git(f.main, "branch", "alias", "feature"); git(f.main, "symbolic-ref", "refs/heads/feature", "refs/heads/alias"); }
  if (mode === "foreign-lock") writeFileSync(`${f.index()}.lock`, "foreign");
  if (mode === "path-swap") { renameSync(f.feature, `${f.feature}.old`); symlinkSync(`${f.feature}.old`, f.feature); }
  if (mode === "bytes") writeFileSync(join(f.feature, "base"), "evil\n");
  await assert.rejects(f.apply(p)); assert.deepEqual(f.current().sourceIndex, before.sourceIndex);
  assert.equal(existsSync(join(f.feature, "upstream")), false);
  if (mode === "foreign-lock") assert.equal(readFileSync(`${f.index()}.lock`, "utf8"), "foreign");
});
test("preparation preflight errors carry original-only no-native-checkout-effect facts", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current(), originalError = new Error("own approval declined");
  await assert.rejects(f.apply(p, { authorize: async () => { throw originalError; } }), (e) => {
    assert.equal(e, originalError);
    assert.deepEqual(readGitPreparationNativeOutcome(e), { status: "no-checkout-effect", checkoutAttempted: false, refPrepared: false,
      refCommitSent: false, refAcknowledged: false, indexInstalled: false, indexSynced: false, directorySyncFailed: false, childReaped: true });
    assert.equal(readGitPreparationNativeOutcome({ ...e }), undefined); assert.equal(readGitPreparationNativeOutcome(new Error(e.message)), undefined); return true;
  });
  assert.deepEqual(f.current(), before); assert.equal(retireGitPreparedApply(p), true);
});
test("unused preparation retirement is original-identity/idempotent and preserves consumed completion facts", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current();
  assert.equal(retireGitPreparedApply(structuredClone(p)), false); assert.equal(retireGitPreparedApply(p.candidate.newSourceOid), false);
  assert.equal(retireGitPreparedApply(p), true); assert.equal(retireGitPreparedApply(p), true);
  await assert.rejects(f.apply(p), (e) => readGitPreparationNativeOutcome(e)?.status === "no-checkout-effect");
  assert.deepEqual(f.current(), before);
  f.live.applying = false; const fresh = await f.prepare(), result = await f.apply(fresh), proof = readGitPreparationCompletion(result);
  assert.equal(retireGitPreparedApply(fresh), true); assert.equal(retireGitPreparedApply(fresh), true);
  assert.deepEqual(readGitPreparationCompletion(result), proof); assert.equal(readGitPreparationNativeOutcome(result).status, "complete");
});
for (const change of ["unrelated", "own-restore"]) test(`preparation scoped policy revision: ${change} project publication`, async (t) => {
  const f = fixture(t), p = await f.prepare(), other = join(f.home, "other-project"); mkdirSync(other);
  const document = { version: 1, paused: false, global: {}, projects: { [f.main]: { mainBranch: "main" }, [other]: { mainBranch: "other" } } };
  if (change === "unrelated") {
    writeGitWorkflowSettingsDocument(document, f.agentDir, [{ kind: "project", projectRoot: other }]);
    assert.equal((await f.apply(p)).status, "prepared");
  } else {
    writeGitWorkflowSettingsDocument({ ...document, projects: { ...document.projects, [f.main]: { mainBranch: "temporarily-different" } } }, f.agentDir, [{ kind: "project", projectRoot: f.main }]);
    writeGitWorkflowSettingsDocument(document, f.agentDir, [{ kind: "project", projectRoot: f.main }]);
    const before = f.current(); await assert.rejects(f.apply(p), (e) => readGitPreparationNativeOutcome(e)?.status === "no-checkout-effect");
    assert.deepEqual(f.current(), before);
  }
});
test("reversed prepared locks reject actual source and protected-main ref writers before file effects", async (t) => {
  const f = fixture(t), p = await f.prepare(), before = f.current(); let locked = false;
  const result = await f.apply(p, { afterIntent() {
    locked = true; assert.equal(existsSync(join(f.feature, "upstream")), false);
    assert.throws(() => git(f.main, "update-ref", "refs/heads/feature", before.target));
    assert.throws(() => git(f.main, "update-ref", "refs/heads/main", before.source));
  } });
  assert.equal(result.status, "prepared"); assert.equal(locked, true); assert.equal(f.current().target, before.target);
});
test("late hooks after checkout refuse with measured partial effect, not quarantine", async (t) => {
  const f = fixture(t), p = await f.prepare();
  await assert.rejects(f.apply(p, { afterCheckout() { writeFileSync(join(f.main, ".git", "hooks", "pre-commit"), "#!/bin/sh\nexit 0\n"); } }), (e) => {
    const x = readGitPreparationNativeOutcome(e); assert.equal(x.checkoutAttempted, true); assert.equal(x.refCommitSent, false); return true;
  });
  assert.equal(existsSync(`${f.index()}.lock`), false);
});
test("conflicting replay refuses; empty replay retains an explicit parented commit", async (t) => {
  const f = fixture(t, { conflict: true }), before = f.current(); await assert.rejects(f.prepare(), (e) => e.code === "conflict"); assert.deepEqual(f.current(), before);
  const g = fixture(t, { empty: true }), p = await g.prepare(), result = await g.apply(p);
  assert.equal(result.status, "prepared"); assert.equal(git(g.feature, "rev-parse", "HEAD^"), g.current().target);
  assert.equal(git(g.feature, "rev-parse", "HEAD^{tree}"), git(g.main, "rev-parse", "HEAD^{tree}"));
});
