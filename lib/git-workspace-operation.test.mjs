import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
const oldHome = process.env.HOME, oldConfig = process.env.XDG_CONFIG_HOME;
const configHome = mkdtempSync(join(tmpdir(), "pi-workspace-config-"));
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
  rmSync(configHome, { recursive: true, force: true });
});
const { createJiti } = await import("jiti");
const jiti = createJiti(import.meta.url);
const { captureGitWorkspaceOperation: capture, applyGitWorkspaceOperation: apply,
  applyGitWorkspaceOperationWithAuthority: applyWithAuthority, readGitWorkspaceNativeProof: proofOf, retireGitWorkspaceCandidate: retire } = await jiti.import("./git-workspace-operation.ts");
const { createGitWorkspaceAdmission } = await jiti.import("./git-workspace-admission.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t, { missingParent = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "pi-workspace-native-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const repo = join(home, "repo"), parent = `${repo}-worktrees`, agentDir = join(home, "agent");
  mkdirSync(agentDir); if (!missingParent) mkdirSync(parent);
  git(home, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  writeFileSync(join(repo, "base"), "base\n"); writeFileSync(join(repo, ".gitignore"), "ignored\n");
  git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  writeFileSync(join(repo, "ignored"), "original ignored bytes\n");
  allowFileRoot(home);
  const oid = git(repo, "rev-parse", "HEAD"), owner = { sessionId: randomUUID(), sessionFile: join(agentDir, "session.jsonl"), generation: randomUUID() };
  writeFileSync(owner.sessionFile, JSON.stringify({ type: "session", id: owner.sessionId, cwd: repo }) + "\n");
  let revision = 0, allowed = true, currentGeneration = owner.generation, boundary;
  let evidence, completion, failures = [], begins = 0;
  const diagnostics = createGitWorkspaceAdmission({ agentDir,
    async onIntent(e) { begins++; evidence = e; },
    async onCompleted(p) { assert.equal(proofOf(p).actionId, p.actionId); completion = p; },
    async onFailure(f) { failures.push(f); },
  });
  const nativeAuthority = {
    owner,
    readAuthorityRevisionSync: () => `workspace-policy:${revision}`,
    assertCurrentSync(binding) {
      assert.deepEqual(binding.owner, owner);
      assert.equal(currentGeneration, owner.generation, "owner generation revoked");
      assert.equal(binding.kind, "workspace"); assert.equal(binding.source.projectRoot, repo);
      assert.match(binding.candidateSha256, /^[a-f0-9]{64}$/);
      assert.equal(JSON.parse(readFileSync(owner.sessionFile, "utf8")).id, owner.sessionId);
      if (!allowed) throw Error("own permission denied");
      const effect = boundary; boundary = undefined; effect?.();
    },
  };
  const request = (branch = "feature", mode = "create") => ({ repositoryPath: repo, sourceCheckoutPath: repo,
    destinationPath: join(parent, branch.replaceAll("/", "-")), branch, baseBranch: "main", expectedBaseOid: oid, mode,
    ...(mode === "attach" ? { expectedTipOid: git(repo, "rev-parse", `refs/heads/${branch}`) } : {}) });
  const prepare = (r = request()) => capture(r, diagnostics, nativeAuthority);
  const applyCandidate = (candidate, extra = {}) => apply({ candidate, authorize: async () => { if (!allowed) throw Error("own permission denied"); }, ...extra });
  const state = () => ({ index: readFileSync(join(repo, ".git/index")), head: readFileSync(join(repo, ".git/HEAD")),
    base: readFileSync(join(repo, "base")), ignored: readFileSync(join(repo, "ignored")), oid: git(repo, "rev-parse", "HEAD") });
  return { home, repo, parent, agentDir, oid, owner, diagnostics, nativeAuthority, request, prepare, apply: applyCandidate, state,
    evidence: () => evidence, completion: () => completion, failures: () => failures, begins: () => begins,
    revoke() { allowed = false; revision++; }, restore() { allowed = true; revision++; },
    replaceOwner() { currentGeneration = randomUUID(); }, boundary(effect) { boundary = effect; } };
}

test("native create and attach keep exact commits, private facts and parent effects", async (t) => {
  for (const mode of ["create", "attach"]) for (const missingParent of [false, true]) await t.test(`${mode}/${missingParent}`, async (t) => {
    const f = fixture(t, { missingParent }), before = f.state();
    if (mode === "attach") git(f.repo, "branch", "feature");
    const candidate = await f.prepare(f.request("feature", mode)), result = await f.apply(candidate);
    assert.equal(result.status, mode === "create" ? "created" : "attached"); assert.equal(result.oid, f.oid);
    assert.equal(result.diagnostics, "recorded");
    assert.equal(git(result.path, "rev-parse", "HEAD"), f.oid);
    assert.equal(git(result.path, "symbolic-ref", "HEAD"), "refs/heads/feature");
    assert.deepEqual(f.state(), before); assert.deepEqual(proofOf(result).invocationOwner, f.owner);
    assert.equal(proofOf(f.completion()).destination.cwd, result.path);
    if (missingParent) { assert.equal(result.knownParentCreation.path, f.parent); assert.equal(result.knownParentCreation.mode, 0o700); }
    for (const copy of [{ ...result }, JSON.parse(JSON.stringify(result)), { ...f.completion() }, proofOf(result)]) assert.equal(proofOf(copy), undefined);
    retire(candidate); retire(candidate);
    await assert.rejects(f.apply(candidate), { code: "stale" });
    assert.equal(proofOf(result).resultOid, f.oid, "facts survive retirement");
  });
});

test("missing authority fails before effects; copied candidates cannot execute", async (t) => {
  const f = fixture(t, { missingParent: true });
  await assert.rejects(capture(f.request(), f.diagnostics), /authority required/);
  assert.equal(existsSync(f.parent), false); assert.equal(f.begins(), 0);
  const candidate = await f.prepare();
  for (const copy of [{ ...candidate }, JSON.parse(JSON.stringify(candidate)), candidate.actionId, null, undefined]) {
    assert.throws(() => retire(copy), { code: "stale" });
    await assert.rejects(f.apply(copy), { code: "stale" });
  }
  const result = await f.apply(candidate); assert.equal(result.status, "created");
  assert.throws(() => retire(result), { code: "stale" });
});

test("declined workspace original retires idempotently without permission reads or native effects", async (t) => {
  const f = fixture(t, { missingParent: true }), before = f.state(), candidate = await f.prepare();
  f.revoke(); // Retirement must work without asserting or reconstructing permission.
  retire(candidate); retire(candidate);
  assert.equal(f.begins(), 0); assert.equal(existsSync(f.parent), false); assert.deepEqual(f.state(), before);
  f.restore();
  await assert.rejects(f.apply(candidate), { code: "stale" });
  assert.equal((await f.apply(await f.prepare())).status, "created", "only a new original candidate may execute");
});

test("retirement during a workspace partial never masks known parent creation", async (t) => {
  const f = fixture(t, { missingParent: true }), candidate = await f.prepare();
  let partial;
  await assert.rejects(f.apply(candidate, { afterParentCreate: () => { retire(candidate); retire(candidate); } }), (error) => {
    partial = error; assert.equal(error.code, "recovery-required");
    assert.equal(error.facts.parentCreated, true); assert.equal(error.facts.addAttempted, false); return true;
  });
  const facts = structuredClone(partial.facts);
  retire(candidate); retire(candidate);
  assert.deepEqual(partial.facts, facts); assert.equal(existsSync(f.parent), true);
  assert.equal(existsSync(candidate.request.destinationPath), false);
  await assert.rejects(f.apply(candidate), { code: "stale" });
});

test("original authority captured before selection await and cannot be rebaselined", async (t) => {
  const f = fixture(t), pending = f.prepare();
  f.revoke(); f.restore();
  await assert.rejects(pending, /Original invocation authority changed/);
  assert.equal(existsSync(f.request().destinationPath), false);
  const fresh = await f.prepare(); assert.equal((await f.apply(fresh)).status, "created");
});

test("own policy change-and-restore and replaced owner retire only their candidate", async (t) => {
  for (const replacement of [false, true]) await t.test(String(replacement), async (t) => {
    const f = fixture(t), candidate = await f.prepare();
    if (replacement) f.replaceOwner(); else { f.revoke(); f.restore(); }
    await assert.rejects(f.apply(candidate)); await assert.rejects(f.apply(candidate), { code: "stale" });
    assert.equal(existsSync(candidate.request.destinationPath), false);
    if (!replacement) assert.equal((await f.apply(await f.prepare())).status, "created");
  });
});

test("record failures cannot turn acknowledged native success into uncertainty", async (t) => {
  for (const phase of ["onIntent", "onCompleted", "both"]) await t.test(phase, async (t) => {
    const f = fixture(t);
    const fail = async () => { throw Error("diagnostic unavailable"); };
    if (phase !== "onCompleted") f.diagnostics.onIntent = fail;
    if (phase !== "onIntent") f.diagnostics.onCompleted = fail;
    const result = await f.apply(await f.prepare());
    assert.equal(result.status, "created"); assert.equal(result.diagnostics, "unavailable");
    assert.equal(proofOf(result).resultOid, f.oid);
    assert.equal((await f.apply(await f.prepare(f.request("second")))).status, "created");
  });
});

test("unrelated refs, worktree registrations and corrupt history do not veto", async (t) => {
  const f = fixture(t), candidate = await f.prepare();
  writeFileSync(join(f.agentDir, "intent.json"), "{broken");
  git(f.repo, "branch", "unrelated");
  git(f.repo, "worktree", "add", "-q", join(f.home, "unrelated"), "unrelated");
  assert.equal((await f.apply(candidate)).status, "created");
});

test("actual native ref/index locks and unsafe config still refuse without deleting locks", async (t) => {
  for (const file of ["index.lock", "refs/heads/feature.lock", "hooks/post-checkout", "MERGE_HEAD"]) await t.test(file, async (t) => {
    const f = fixture(t), candidate = await f.prepare(), lock = join(f.repo, ".git", file);
    writeFileSync(lock, "unowned\n");
    await assert.rejects(f.apply(candidate)); assert.equal(readFileSync(lock, "utf8"), "unowned\n");
    assert.equal(existsSync(candidate.request.destinationPath), false);
  });
  for (const key of ["filter.bad.smudge", "core.hooksPath", "includeIf.gitdir:*.path"]) await t.test(key, async (t) => {
    const f = fixture(t); git(f.repo, "config", key, "unsupported"); await assert.rejects(f.prepare());
  });
});

test("final awaited launch hooks cannot substitute changed refs, data, identity or authority", async (t) => {
  for (const change of ["ref", "tracked", "parent", "authority", "hook", "marker"]) await t.test(change, async (t) => {
    const f = fixture(t), candidate = await f.prepare();
    await assert.rejects(f.apply(candidate, { duringAddLaunch: async () => {
      await Promise.resolve();
      if (change === "ref") { writeFileSync(join(f.repo, "base"), "new\n"); git(f.repo, "add", "base"); git(f.repo, "commit", "-qm", "new"); }
      if (change === "tracked") writeFileSync(join(f.repo, "base"), "changed\n");
      if (change === "parent") { renameSync(f.parent, `${f.parent}.old`); mkdirSync(f.parent); }
      if (change === "authority") { f.revoke(); f.restore(); }
      if (change === "hook") writeFileSync(join(f.repo, ".git/hooks/post-checkout"), "unsafe");
      if (change === "marker") writeFileSync(join(f.repo, ".git/index.lock"), "unowned");
    } }));
    assert.equal(existsSync(candidate.request.destinationPath), false);
    assert.equal(git(f.repo, "branch", "--list", "feature"), "");
    await assert.rejects(f.apply(candidate), { code: "stale" });
  });
});

test("parent creation is an explicit measured partial; no automatic removal on failure", async (t) => {
  const f = fixture(t, { missingParent: true }), candidate = await f.prepare();
  assert.equal(candidate.parentCreation.expectedAbsent, true);
  await assert.rejects(f.apply(candidate, { afterParentCreate: () => { f.revoke(); } }), (error) => {
    assert.equal(error.code, "recovery-required"); assert.equal(error.facts.parentCreated, true);
    assert.equal(error.facts.addAttempted, false); assert.equal(error.facts.knownParentCreation.path, f.parent); return true;
  });
  assert.equal(existsSync(f.parent), true); assert.equal(existsSync(candidate.request.destinationPath), false);
  f.restore(); assert.equal((await f.apply(await f.prepare())).status, "created");
});

test("post-add mismatch reports measured partial, never success or rollback", async (t) => {
  const f = fixture(t), candidate = await f.prepare();
  await assert.rejects(f.apply(candidate, { afterAdd: () => writeFileSync(join(candidate.request.destinationPath, "unexpected"), "keep") }), (error) => {
    assert.equal(error.code, "recovery-required"); assert.equal(error.facts.addAttempted, true);
    assert.equal(error.facts.destinationPresent, true); assert.equal(error.facts.observedBranchOid, f.oid); return true;
  });
  assert.equal(readFileSync(join(candidate.request.destinationPath, "unexpected"), "utf8"), "keep");
  assert.equal(f.completion(), undefined);
  assert.equal((await f.apply(await f.prepare(f.request("independent")))).status, "created");
});

test("attach existing branch is explicit; stale tip, symlink destination and create collision refuse", async (t) => {
  const f = fixture(t); git(f.repo, "branch", "existing");
  await assert.rejects(f.prepare(f.request("existing")));
  const attach = f.request("existing", "attach"); attach.expectedTipOid = "1".repeat(40);
  await assert.rejects(f.prepare(attach));
  symlinkSync(f.repo, f.request().destinationPath); await assert.rejects(f.prepare());
});

test("linked source does not inherit primary checkout operation markers", async (t) => {
  const f = fixture(t), source = join(f.home, "source");
  git(f.repo, "worktree", "add", "-q", "-b", "source", source);
  writeFileSync(join(f.repo, ".git/index.lock"), "primary unrelated native work");
  const request = { ...f.request(), sourceCheckoutPath: source, baseBranch: "source" };
  assert.equal((await f.apply(await f.prepare(request))).status, "created");
  assert.equal(readFileSync(join(f.repo, ".git/index.lock"), "utf8"), "primary unrelated native work");
});

test("additional public live guard cannot bypass original authority and invalid attempt retires", async (t) => {
  const f = fixture(t), candidate = await f.prepare();
  await assert.rejects(applyWithAuthority({ candidate, authorize: async () => {}, assertCurrentSync: async () => {} }));
  await assert.rejects(f.apply(candidate), { code: "stale" });
  assert.equal(existsSync(candidate.request.destinationPath), false);
});
