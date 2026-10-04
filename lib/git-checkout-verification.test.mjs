import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, fstatSync, linkSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createTestContainmentBackend } from "./git-check-containment-test-backend.mjs";
const jiti = createJiti(import.meta.url);
const { runGitCheckoutVerification: run, lookupGitCheckoutVerificationReceipt: lookup,
  validateGitCheckoutVerificationReceipt: validate, selectGitCheckoutVerificationChecks: select,
  captureGitCheckoutCheckRecoverySnapshot: capture, gitCommitWorkingWorkspaceReceiptReader: commitReader,
  readGitCheckoutVerificationNativeExecution: nativeExecution } = await jiti.import("./git-checkout-verification.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { openGitDiagnosticStore } = await jiti.import("./git-diagnostic-retention.ts");
function readOutput(agentDir, id) {
  const opened = openGitDiagnosticStore(agentDir, { application: true }); assert.equal(opened.status, "stored");
  try { const output = opened.store.readCompletedLog(id); assert.equal(output.status, "stored"); return output.value.toString(); }
  finally { opened.store.close(); }
}
const hash = (value) => createHash("sha256").update(value).digest("hex");
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
function fixture(t, delivery = "local", evidence) {
  const home = mkdtempSync(join(tmpdir(), "pi-web-selected-check-"));
  if (!fixtureEnvironmentOwners.has(t)) {
    fixtureEnvironmentOwners.add(t);
    const priorHome = process.env.HOME, priorXdg = process.env.XDG_CONFIG_HOME;
    t.after(() => {
      if (priorHome === undefined) delete process.env.HOME; else process.env.HOME = priorHome;
      if (priorXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = priorXdg;
    });
  }
  process.env.HOME = home; process.env.XDG_CONFIG_HOME = join(home, "xdg");
  t.after(() => { if (!evidence?.failed) rmSync(home, { recursive: true, force: true }); });
  const cwd = join(home, "repo"), agentDir = join(home, "agent");
  git(home, "init", "-q", "-b", "main", cwd);
  git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.com");
  mkdirSync(join(cwd, "checks")); writeFileSync(join(cwd, "checks", "note"), "base\n");
  writeFileSync(join(cwd, ".gitignore"), "ignored*\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "base"); allowFileRoot(cwd);
  const policy = { policyRevision: "revision-1", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS,
    mainBranch: "main", delivery, baseBranch: null, targetBranch: null,
    checks: [{ label: "test", argv: [process.execPath, "-e", "process.exit(0)"], cwd: "checks", env: { CI: "1" }, requiredStage: "commit" }] } };
  const options = { sessionId: "selected-check", selector: { repositoryPath: cwd, checkoutPath: cwd }, agentDir,
    checkIndex: 0, stage: "commit", getPolicy: () => policy, isTrusted: () => true,
    isSelectionAuthorized: () => true, isActorAuthorized: () => true, testContainmentBackend: createTestContainmentBackend() };
  return { home, cwd, agentDir, policy, options };
}
async function commitOptions(f, extra = {}) {
  return { sessionId: f.options.sessionId, agentDir: f.agentDir, source: await selectGitProjectResources(f.cwd), checkIndex: 0, stage: "commit",
    sourceGetPolicy: () => ({ ...f.policy, savedProjectSettings: { checks: f.policy.settings.checks } }),
    isTrusted: () => true, isSelectionAuthorized: () => true, isCheckAuthorized: () => true, ...extra };
}

for (const change of ["changed", "changed-restored"]) test(`fresh-use pins its own original authority, issuer unchanged (${change})`, async (t) => {
  const f = fixture(t), issuerRevision = 1; let useRevision = 1, actorCalls = 0, allowed = true;
  const receipt = await run({ ...f.options, readAuthorityRevisionSync: () => String(issuerRevision) });
  const use = { ...f.options, readAuthorityRevisionSync: () => String(useRevision), isActorAuthorized: async () => {
    if (++actorCalls === 2) { allowed = false; useRevision++; if (change === "changed-restored") { allowed = true; useRevision++; } }
    return true; // deliberately stale async authorization result
  } };
  await assert.rejects(validate(receipt.id, use), /stale/);
  assert.equal(actorCalls, 2); assert.equal(issuerRevision, 1); assert.equal(allowed, change === "changed-restored");
  assert.equal(lookup(receipt.id), receipt, "a different use context cannot retire the issuer's receipt");
  assert.equal(await validate(receipt.id, { ...f.options, readAuthorityRevisionSync: () => String(issuerRevision) }), receipt);
});

test("fresh-use revision is captured synchronously, before the first selection await", async (t) => {
  const f = fixture(t), receipt = await run(f.options); let revision = 1, reads = 0;
  const validation = validate(receipt.id, { ...f.options, isActorAuthorized: async () => true,
    readAuthorityRevisionSync: () => { reads++; return String(revision); } });
  assert.ok(reads > 0); revision++;
  await assert.rejects(validation, /stale/); assert.equal(lookup(receipt.id), receipt);
});

for (const boundary of ["entry", "final-actor"]) test(`fresh-use rejects unknown/nonstring/thenable authority at ${boundary}`, async (t) => {
  const f = fixture(t), receipt = await run(f.options);
  for (const invalid of [undefined, "", 7, Promise.resolve("revision"), { then() {} }]) {
    let value = boundary === "entry" ? invalid : "original", calls = 0;
    await assert.rejects(validate(receipt.id, { ...f.options, readAuthorityRevisionSync: () => value,
      isActorAuthorized: async () => { if (++calls === 2) value = invalid; return true; } }), /stale/);
    assert.equal(calls, boundary === "entry" ? 0 : 2); assert.equal(lookup(receipt.id), receipt);
  }
});

for (const change of ["chmod", "hidden-bytes"]) for (const boundary of ["registration", "fresh-use"])
  test(`clean v2 physical ${change} at ${boundary} is not hidden by Git's stat cache`, async (t) => {
    const f = fixture(t), file = join(f.cwd, "checks", "note");
    f.options.stage = "handoff"; f.policy.settings.checks[0].requiredStage = "handoff";
    git(f.cwd, "config", "core.fileMode", "false"); git(f.cwd, "config", "core.trustctime", "false"); git(f.cwd, "config", "core.checkStat", "minimal");
    const old = new Date(Date.now() - 120_000); utimesSync(file, old, old); git(f.cwd, "update-index", "--refresh");
    const initial = statSync(file), index = readFileSync(join(f.cwd, ".git", "index"));
    let mutated = false;
    const mutate = () => {
      mutated = true;
      if (change === "chmod") chmodSync(file, initial.mode ^ 0o100);
      else { writeFileSync(file, "evil\n"); utimesSync(file, initial.atime, initial.mtime); }
      assert.equal(git(f.cwd, "status", "--porcelain=v1"), "", "repro must remain Git-clean");
      assert.deepEqual(readFileSync(join(f.cwd, ".git", "index")), index);
    };
    if (boundary === "registration") await assert.rejects(run({ ...f.options, testBeforeReceiptRegistration: async () => mutate() }));
    else { const receipt = await run(f.options); mutate(); await assert.rejects(validate(receipt.id, f.options), /stale/); }
    assert.equal(mutated, true, "must reach the intended mutation boundary");
  });

// ADR0012 concurrency/cohort/history/optional-diagnostics and actual protected
// native FD tests live in git-verification-independent.test.mjs. This file keeps
// recipe, containment-release, physical input and original-authority regressions.
for (const delivery of ["local", "pr", "leave"]) test(`single direct-main ${delivery} check preserves physical cwd and sanitized recipe env`, async (t) => {
  const evidence = failureEvidence(t), f = fixture(t, delivery, evidence);
  evidence.begin(f.home, ["repo/.git/HEAD", "repo/.git/index", "repo/.git/refs/heads/main", "repo/checks/note"]);
  f.options.testContainmentBackend = evidence.backend(f.options.testContainmentBackend);
  f.options.onExecution = async row => { evidence.measured = { payload: row.payload, exitStatus: row.exitStatus,
    containmentComplete: row.containmentComplete, timedOut: row.timedOut, overflow: row.overflow,
    snapshotDigest: row.snapshotDigest, logDigest: row.logDigest, logBytes: row.logBytes }; };
  if (delivery !== "local") { f.options.stage = "handoff"; f.policy.settings.checks[0].requiredStage = "handoff"; }
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "process.stdout.write(JSON.stringify([process.cwd(),process.env.CI,process.env['PI_WEB_'+'P'+'ASSWORD'],process.env.NEXT_RUNTIME,process.env.PORT]))"];
  const prior = Object.fromEntries(["PI_WEB_PASSWORD", "NEXT_RUNTIME", "PORT"].map(key => [key, process.env[key]]));
  Object.assign(process.env, { PI_WEB_PASSWORD: "private-value", NEXT_RUNTIME: "server", PORT: "9999" });
  try {
    const receipt = await run(f.options);
    evidence.phase = "output";
    const output = JSON.parse(readOutput(f.agentDir, receipt.outputDiagnosticId));
    assert.deepEqual(output, [join(f.cwd, "checks"), "1", null, null, null]);
    evidence.phase = "validate";
    assert.equal(await validate(receipt.id, f.options), receipt); assert.equal(receipt.snapshot.dependencyVersion, 2);
    assert.deepEqual(receipt.snapshot.relevantRefs, ["refs/heads/main"]);
    assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
  } catch (error) { evidence.preserve(); throw error; }
  finally { for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("working snapshot binds dirty bytes/index/HEAD, physical manifest2 and truthful uncovered inputs", async (t) => {
  const f = fixture(t), file = join(f.cwd, "checks", "note"), secret = "PRIVATE_WORKSPACE_BYTES_12345";
  writeFileSync(file, "staged\noriginal\n"); git(f.cwd, "add", "checks/note"); writeFileSync(file, `staged\n${secret}\n`);
  const selection = await selectGitProjectResources(f.cwd), binding = { recipe: f.policy.settings.checks[0], checkIndex: 0, stage: "commit",
    policyDigest: hash(JSON.stringify(f.policy.settings)), policyRevision: f.policy.policyRevision, environmentDigest: hash("fixture-environment") };
  const bytes = readFileSync(join(f.cwd, ".git", "index")), status = git(f.cwd, "status", "--porcelain=v1", "-z");
  const snapshot = await capture(selection, binding, true);
  assert.equal(snapshot.version, 3); assert.equal(snapshot.workspaceIndexDigest, hash(bytes));
  assert.equal(snapshot.evidenceScope, "working-workspace"); assert.equal(snapshot.candidateTreeVerified, false); assert.equal(snapshot.repositoryChecksWaived, false);
  assert.equal(snapshot.workspaceManifestVersion, 2); assert.equal(snapshot.ignoredCachesCovered, false); assert.equal(snapshot.externalInputsCovered, false);
  assert.equal(JSON.stringify(snapshot).includes(secret), false); assert.equal(JSON.stringify(snapshot).includes("checks/note"), false);
  assert.deepEqual(readFileSync(join(f.cwd, ".git", "index")), bytes);
  writeFileSync(file, "staged\nSAME_PORCELAIN_DIFFERENT_BYTES\n"); assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status);
  const changed = await capture(selection, binding, true);
  assert.notEqual(changed.workspaceContentDigest, snapshot.workspaceContentDigest); assert.equal(changed.workspaceIndexDigest, snapshot.workspaceIndexDigest);
});

test("working receipt never stages/imports dirty hunks; fresh-use reader catches same-porcelain mutations", async (t) => {
  const f = fixture(t), file = join(f.cwd, "checks", "note");
  writeFileSync(file, "staged\nbase\n"); git(f.cwd, "add", "checks/note"); writeFileSync(file, "staged\nunstaged\n");
  writeFileSync(join(f.cwd, "untracked"), "unselected source bytes\n");
  const index = readFileSync(join(f.cwd, ".git", "index")), cached = git(f.cwd, "diff", "--cached"), unstaged = git(f.cwd, "diff"), status = git(f.cwd, "status", "--porcelain=v1", "-z");
  const receipt = await run(f.options), options = await commitOptions(f);
  assert.equal(receipt.candidateTreeVerified, false); assert.equal(await commitReader.validate(receipt.id, options), receipt);
  commitReader.assertCurrentSync(receipt.id, options);
  assert.deepEqual(readFileSync(join(f.cwd, ".git", "index")), index); assert.equal(git(f.cwd, "diff", "--cached"), cached); assert.equal(git(f.cwd, "diff"), unstaged);
  writeFileSync(file, "staged\nDIFFERENT\n"); assert.equal(git(f.cwd, "status", "--porcelain=v1", "-z"), status);
  await assert.rejects(commitReader.validate(receipt.id, options), /stale/); assert.throws(() => commitReader.assertCurrentSync(receipt.id, options), /stale/);
});

test("ordinary checks refuse native locks, unsafe index flags, conflicts and operation markers before payload", async (t) => {
  for (const unsafe of ["index.lock", "HEAD.lock", "MERGE_HEAD", "skip-worktree", "assume-unchanged", "intent-to-add", "conflict"]) {
    const f = fixture(t), marker = join(f.home, "no-command");
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    if (unsafe.endsWith("lock") || unsafe === "MERGE_HEAD") writeFileSync(join(f.cwd, ".git", unsafe), "blocked");
    else if (unsafe === "intent-to-add") { writeFileSync(join(f.cwd, "intent"), "pending\n"); git(f.cwd, "add", "-N", "intent"); }
    else if (unsafe === "conflict") {
      const oid = git(f.cwd, "rev-parse", "HEAD:checks/note");
      execFileSync("git", ["-C", f.cwd, "update-index", "--index-info"], { input: `0 ${"0".repeat(40)}\tchecks/note\n100644 ${oid} 1\tchecks/note\n100644 ${oid} 2\tchecks/note\n` });
    } else git(f.cwd, "update-index", `--${unsafe}`, "checks/note");
    await assert.rejects(run(f.options)); assert.equal(existsSync(marker), false); assert.equal(existsSync(f.agentDir), false);
    if (unsafe.endsWith("lock")) assert.equal(readFileSync(join(f.cwd, ".git", unsafe), "utf8"), "blocked", "unowned Git lock never deleted");
  }
});

test("Git-invisible specials and hardlinked administrative bytes cannot earn workspace evidence", async (t) => {
  for (const unsupported of ["fifo", "admin-hardlink"]) {
    const f = fixture(t), marker = join(f.home, "no-payload");
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    if (unsupported === "fifo") execFileSync("mkfifo", [join(f.cwd, "untracked-pipe")]);
    else linkSync(join(f.cwd, ".git", "config"), join(f.cwd, "admin-copy"));
    await assert.rejects(run(f.options)); assert.equal(existsSync(marker), false); assert.equal(existsSync(f.agentDir), false);
  }
});

test("noncanonical separate Git administrative selector fails before payload", async (t) => {
  const f = fixture(t), admin = join(f.cwd, "actual-admin");
  renameSync(join(f.cwd, ".git"), admin); writeFileSync(join(f.cwd, ".git"), "gitdir: actual-admin\n"); git(f.cwd, "config", "core.worktree", f.cwd);
  await assert.rejects(selectGitProjectResources(f.cwd), /registered checkout/); await assert.rejects(run(f.options));
});

test("final awaited actor revocation/change-restore/content mutation cannot release project payload", async (t) => {
  for (const change of ["policy", "policy-restored", "environment", "selection", "trust", "source"]) {
    const f = fixture(t), marker = join(f.home, `payload-${change}`), base = createTestContainmentBackend();
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    const cachedPolicy = structuredClone(f.policy); let placed = false, gateActors = 0, revision = 0, changed = false, measured;
    const previous = process.env.CI_FENCE_TEST;
    try {
      await assert.rejects(run({ ...f.options, getPolicy: () => cachedPolicy, readAuthorityRevisionSync: () => String(revision),
        onExecution: row => { measured = row; },
        testContainmentBackend: { ...base, async observe(...args) { const state = await base.observe(...args); if (state.launcherPlaced) placed = true; return state; } },
        isActorAuthorized: async () => {
          if (placed && ++gateActors === 2 && !changed) {
            await Promise.resolve(); changed = true;
            if (change === "policy") { f.policy.settings.enabled = false; revision++; }
            if (change === "policy-restored") { f.policy.settings.enabled = false; revision++; await Promise.resolve(); f.policy.settings.enabled = true; revision++; }
            if (change === "selection" || change === "trust") revision++;
            if (change === "environment") process.env.CI_FENCE_TEST = "revoked-inside-final-await";
            if (change === "source") writeFileSync(join(f.cwd, "checks", "note"), "changed inside final authority await\n");
          }
          return true;
        } }));
      assert.equal(changed, true); assert.equal(existsSync(marker), false);
      assert.equal(nativeExecution(measured).payload, "prevented-before-write"); assert.equal(measured.receipt, undefined);
    } finally { if (previous === undefined) delete process.env.CI_FENCE_TEST; else process.env.CI_FENCE_TEST = previous; }
  }
});

test("async authority needs an original synchronous revision adapter; thenables cannot authorize", async (t) => {
  for (const stamp of [undefined, async () => "not-synchronous"]) {
    const f = fixture(t), marker = join(f.home, "must-not-run");
    f.policy.settings.checks[0].argv = [process.execPath, "-e", `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`];
    await assert.rejects(run({ ...f.options, isActorAuthorized: async () => true, readAuthorityRevisionSync: stamp })); assert.equal(existsSync(marker), false);
  }
  const f = fixture(t); let revision = 1;
  const options = { ...f.options, getPolicy: async () => f.policy, isActorAuthorized: async () => true,
    isSelectionAuthorized: async () => true, isTrusted: async () => true, readAuthorityRevisionSync: () => String(revision) };
  const receipt = await run(options); assert.equal(await validate(receipt.id, options), receipt);
  revision += 2; await assert.rejects(validate(receipt.id, options), /stale/);
});

test("empty and exact-stage recipe discovery never waives checks or mints synthetic passes", async (t) => {
  assert.deepEqual(select([], "commit"), { status: "no-defined", checkIndexes: [], repositoryChecksWaived: false });
  assert.deepEqual(select([{ label: "manual", argv: ["node", "test.js"], requiredStage: "none" }], "handoff"), { status: "no-required", checkIndexes: [], repositoryChecksWaived: false });
  assert.deepEqual(select([{ label: "legacy", argv: ["node", "test.js"] }], "integration").checkIndexes, [0]); assert.throws(() => select([], "none"));
  for (const stage of ["none", "integration"]) {
    const f = fixture(t); f.policy.settings.checks[0] = { label: "plain", argv: [process.execPath, "-e", "process.exit(0)"], ...(stage === "none" ? { requiredStage: "none" } : {}) };
    await assert.rejects(run(f.options), /invalid-request/);
    const receipt = await run({ ...f.options, stage }); assert.equal(receipt.stage, stage); assert.equal(receipt.executionCwd, f.cwd);
    await assert.rejects(commitReader.validate(receipt.id, await commitOptions(f)), /stale/);
  }
  const f = fixture(t); f.policy.settings.checks = []; await assert.rejects(run(f.options), /invalid-request/);
});

test("selection, trust and actor checks remain separate from confirmation:none preferences", async (t) => {
  for (const field of ["isTrusted", "isSelectionAuthorized", "isActorAuthorized"]) {
    const f = fixture(t); f.policy.settings.checkConfirmation = "none";
    await assert.rejects(run({ ...f.options, [field]: () => false }));
    await assert.rejects(run({ ...f.options, [field]: undefined }), /invalid-request/); assert.equal(existsSync(f.agentDir), false);
  }
});

test("cwd traversal, symlink escape, noncanonical aliases and wrong saved index refuse", async (t) => {
  const f = fixture(t), outside = join(f.home, "outside"); mkdirSync(outside); symlinkSync(outside, join(f.cwd, "ignored-link"));
  for (const cwd of ["..", "checks/..", outside, "ignored-link"]) { f.policy.settings.checks[0].cwd = cwd; await assert.rejects(run(f.options)); }
  f.policy.settings.checks[0].cwd = "checks"; await assert.rejects(run({ ...f.options, checkIndex: 10 }));
  await assert.rejects(run({ ...f.options, selector: { repositoryPath: join(f.cwd, "checks"), checkoutPath: f.cwd } }));
  symlinkSync(f.cwd, join(f.home, "alias")); allowFileRoot(join(f.home, "alias"));
  await assert.rejects(run({ ...f.options, selector: { repositoryPath: join(f.home, "alias"), checkoutPath: join(f.home, "alias") } })); assert.equal(existsSync(f.agentDir), false);
});

test("recipe, policy, environment and physical cwd changes invalidate original receipt", async (t) => {
  for (const change of ["revision", "policy", "recipe", "stage", "env", "cwd-instance", "untracked-mode", "symlink"]) {
    const f = fixture(t);
    if (change === "untracked-mode") writeFileSync(join(f.cwd, "new"), "bytes");
    if (change === "symlink") { unlinkSync(join(f.cwd, "checks", "note")); symlinkSync("missing-one", join(f.cwd, "checks", "note")); }
    const receipt = await run(f.options);
    if (change === "revision") f.policy.policyRevision = "revision-2";
    if (change === "policy") f.policy.settings.delivery = "pr";
    if (change === "recipe") f.policy.settings.checks[0].label = "renamed";
    if (change === "stage") f.options.stage = "handoff";
    if (change === "cwd-instance") { renameSync(join(f.cwd, "checks"), join(f.cwd, "ignored-old")); mkdirSync(join(f.cwd, "checks")); writeFileSync(join(f.cwd, "checks", "note"), "base\n"); }
    if (change === "untracked-mode") chmodSync(join(f.cwd, "new"), 0o755);
    if (change === "symlink") { unlinkSync(join(f.cwd, "checks", "note")); symlinkSync("missing-two", join(f.cwd, "checks", "note")); }
    const previous = process.env.PI_SELECTED_CHECK_TEST;
    try { if (change === "env") process.env.PI_SELECTED_CHECK_TEST = "changed"; await assert.rejects(validate(receipt.id, f.options), /stale/); }
    finally { if (previous === undefined) delete process.env.PI_SELECTED_CHECK_TEST; else process.env.PI_SELECTED_CHECK_TEST = previous; }
  }
});

test("expiry is irreversible; private output and callback secrets never enter public errors", async (t) => {
  const f = fixture(t), receipt = await run(f.options), now = Date.now;
  try { Date.now = () => receipt.expiresAt; assert.equal(lookup(receipt.id), undefined); } finally { Date.now = now; }
  assert.equal(lookup(receipt.id), undefined);
  const secret = "PRIVATE987value"; f.policy.settings.checks[0].argv = [process.execPath, "-e", `process.stdout.write('${secret}');process.exit(1)`];
  let measured;
  await assert.rejects(run({ ...f.options, onExecution: row => { measured = row; } }), error => !String(error).includes(secret));
  assert.equal(readOutput(f.agentDir, measured.outputDiagnosticId), secret);
  await assert.rejects(run({ ...f.options, isActorAuthorized: () => { throw new Error(secret); } }), error => !String(error).includes(secret));
});

async function waitFor(check) {
  const deadline = Date.now() + 10_000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25)); assert.equal(check(), true);
}
test("abort and live trust/actor/selection/policy revocation stop own long check without historical veto", async (t) => {
  for (const revocation of ["abort", "trust", "actor", "selection", "policy"]) {
    const f = fixture(t), controller = new AbortController(); let permitted = true, measured;
    const field = { trust: "isTrusted", actor: "isActorAuthorized", selection: "isSelectionAuthorized" }[revocation];
    f.policy.settings.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('../ignored-running','1');setTimeout(()=>{},20000)"];
    const rejected = assert.rejects(run({ ...f.options, signal: controller.signal, onExecution: row => { measured = row; }, ...(field ? { [field]: () => permitted } : {}) }));
    await waitFor(() => existsSync(join(f.cwd, "ignored-running")));
    if (revocation === "abort") controller.abort(); else if (revocation === "policy") f.policy.policyRevision = "revoked"; else permitted = false;
    await rejected; assert.equal(measured.receipt, undefined); assert.equal(measured.timedOut, true);
    assert.equal(existsSync(join(f.agentDir, "pi-web", "git-operation-admission")), false);
  }
});

for (const swap of ["symlink", "replacement"]) test(`startup ${swap}/restore cannot release launcher in foreign cwd instance`, async (t) => {
  const f = fixture(t), cwd = join(f.cwd, "checks"), original = join(f.cwd, "ignored-original"), outside = join(f.home, "foreign"); mkdirSync(outside);
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('ignored-forbidden','ran')"];
  const base = createTestContainmentBackend(); let managerFd, releases = 0;
  t.after(() => { if (managerFd !== undefined) closeSync(managerFd); });
  const backend = { ...base, start(options) {
    renameSync(cwd, original); if (swap === "symlink") symlinkSync(outside, cwd); else mkdirSync(cwd);
    managerFd = openSync(cwd, constants.O_RDONLY | constants.O_DIRECTORY);
    const transport = base.start({ ...options, workingDirectory: `/proc/${process.pid}/fd/${managerFd}` });
    if (swap === "symlink") rmSync(cwd); else rmSync(cwd, { recursive: true }); renameSync(original, cwd);
    return { ...transport, release(payload) { releases++; transport.release(payload); } };
  } };
  await assert.rejects(run({ ...f.options, testContainmentBackend: backend }));
  assert.equal(releases, 0); assert.equal(existsSync(join(outside, "ignored-forbidden")), false); assert.equal(existsSync(join(cwd, "ignored-forbidden")), false);
});

test("manager honoring original proc-FD cwd stays bound through symlink swap and restore", async (t) => {
  const f = fixture(t), cwd = join(f.cwd, "checks"), original = join(f.cwd, "ignored-original"), outside = join(f.home, "outside"); mkdirSync(outside);
  f.policy.settings.checks[0].argv = [process.execPath, "-e", "require('fs').writeFileSync('ignored-marker','bound')"];
  const base = createTestContainmentBackend(), backend = { ...base, start(options) {
    renameSync(cwd, original); symlinkSync(outside, cwd); const transport = base.start(options); rmSync(cwd); renameSync(original, cwd); return transport;
  } };
  assert.equal((await run({ ...f.options, testContainmentBackend: backend })).exitStatus, 0);
  assert.equal(existsSync(join(outside, "ignored-marker")), false); assert.equal(readFileSync(join(cwd, "ignored-marker"), "utf8"), "bound");
});
