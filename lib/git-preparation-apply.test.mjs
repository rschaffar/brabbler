import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { applyGitPreparation, prepareGitPreparationApply } = await jiti.import("./git-preparation-apply.ts");
const { inspectGitOperationAdmission } = await jiti.import("./git-operation-admission.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
function fixture(t, { upstream = true, conflict = false, equivalent = false, ignored = false, lateIgnored = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-prepare-apply-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const main = join(home, "main"), feature = join(home, "feature"), agentDir = join(home, "agent");
  mkdirSync(join(agentDir, "pi-web"), { recursive: true, mode: 0o700 });
  git(home, "init", "-q", "-b", "main", main);
  git(main, "config", "user.name", "Test"); git(main, "config", "user.email", "test@example.com");
  writeFileSync(join(main, "base"), "base\n"); git(main, "add", "."); git(main, "commit", "-qm", "base");
  git(main, "worktree", "add", "-qb", "feature", feature);
  writeFileSync(join(feature, conflict ? "base" : "feature"), "feature\n");
  if (ignored) writeFileSync(join(feature, ".gitignore"), "upstream\n");
  git(feature, "add", "."); git(feature, "commit", "-qm", "feature");
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
  const current = () => ({ source: git(feature, "rev-parse", "HEAD"), target: git(main, "rev-parse", "HEAD"),
    sourceIndex: readFileSync(git(feature, "rev-parse", "--git-path", "index")),
    targetIndex: readFileSync(join(main, ".git", "index")),
    sourceStatus: git(feature, "status", "--porcelain=v1"), targetStatus: git(main, "status", "--porcelain=v1") });
  const admission = () => inspectGitOperationAdmission(agentDir, join(main, ".git"));
  return { main, feature, home, agentDir, prepare, apply, current, admission };
}

test("clean linear rewrite reports actual old/new OIDs, installs index and resolves intent", async (t) => {
  const f = fixture(t);
  const before = f.current(), prepared = await f.prepare(), calls = [];
  const result = await f.apply(prepared, { authorize: async (phase) => { calls.push(phase); } });
  assert.equal(result.status, "prepared", result.status === "partial-state" ? readFileSync(`${result.recoveryPath}.partial`, "utf8") : "");
  assert.deepEqual(calls, ["before-apply", "final-ref"]);
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
  const noop = await n.apply(await n.prepare(), { authorize: () => { throw Error("unexpected authorization"); } });
  assert.equal(noop.status, "already-prepared");
  assert.equal(noop.oldSourceOid, noop.newSourceOid);
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
  const result = await f.apply(p, { afterIndexInstall: () => { throw Error("injected after index rename"); } });
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
