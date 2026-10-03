import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
const configHome = fs.mkdtempSync(path.join(tmpdir(), "workspace-admission-config-"));
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  fs.rmSync(configHome, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url);
const { createGitWorkspaceAdmission } = await jiti.import("./git-workspace-admission.ts");
const { captureGitWorkspaceOperation, applyGitWorkspaceOperation, readGitWorkspaceNativeProof } = await jiti.import("./git-workspace-operation.ts");
const { inspectGitOperationAdmission } = await jiti.import("./git-operation-admission.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
}).trim();
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "workspace-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"), parent = options.parentCreation ? `${repo}-worktrees` : path.join(root, "destinations"), agent = path.join(root, "agent");
  if (!options.parentCreation) fs.mkdirSync(parent);
  fs.mkdirSync(agent, { mode: 0o700 }); git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com"); git(repo, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "base"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "base"); allowFileRoot(root);
  if (options.mode === "attach") git(repo, "branch", "feature");
  if (options.checkedBase) git(repo, "worktree", "add", "-qb", "checked-base", path.join(root, "checked-base"));
  const calls = []; let intent, evidence;
  const admission = createGitWorkspaceAdmission({ agentDir: agent,
    async onIntent(e) { calls.push(["intent", e.actionId]); evidence = e; await options.onIntent?.(e); },
    async onCompleted(p) { calls.push(["completed", p.actionId]); await options.onCompleted?.(p); },
  });
  const wrapped = { ...admission, async beginIntent(e) {
    intent = await admission.beginIntent(e);
    return options.transform ? { ...intent, ...options.transform(intent, e) } : intent;
  } };
  const request = { mode: options.mode ?? "create", repositoryPath: repo, sourceCheckoutPath: repo, destinationPath: path.join(parent, "feature"),
    branch: "feature", baseBranch: options.checkedBase ? "checked-base" : "main", expectedBaseOid: git(repo, "rev-parse", "HEAD"),
    ...(options.mode === "attach" ? { expectedTipOid: git(repo, "rev-parse", "refs/heads/feature") } : {}) };
  return { root, repo, parent, agent, admission, request, calls, get intent() { return intent; }, get evidence() { return evidence; },
    prepare: () => captureGitWorkspaceOperation(request, wrapped),
    apply: (candidate, extra = {}) => applyGitWorkspaceOperation({ candidate, authorize: options.authorize ?? (async () => {}), ...extra }),
    inspect: () => inspectGitOperationAdmission(agent, path.join(repo, ".git")) };
}
for (const mode of ["create", "attach"]) for (const parentCreation of [false, true]) test(`actual ${mode} proof-bound addition, parent creation=${parentCreation}`, async (t) => {
  const f = fixture(t, { parentCreation, mode, checkedBase: true }), c = await f.prepare();
  const result = await f.apply(c);
  assert.equal(result.status, mode === "create" ? "created" : "attached"); assert.equal(fs.existsSync(f.request.destinationPath), true);
  assert.equal(f.inspect().admitted, true); assert.deepEqual(f.calls, [["intent", c.actionId], ["completed", c.actionId]]);
  if (parentCreation) {
    assert.equal(c.parentCreation.path, f.parent); assert.equal(result.knownParentCreation.path, f.parent);
    assert.equal(fs.statSync(f.parent).mode & 0o777, 0o700);
  }
  assert.throws(() => f.intent.assertOwned());
});
test("journal completion failure retains native facts and quarantine across restart", async (t) => {
  const f = fixture(t, { onCompleted: () => { throw Error("journal failed"); } }), c = await f.prepare();
  await assert.rejects(f.apply(c), (e) => e.code === "recovery-required");
  assert.equal(f.inspect().admitted, false); assert.equal(fs.existsSync(f.request.destinationPath), true);
  const script = `const {createJiti}=require('jiti'); (async()=>{const m=await createJiti(process.cwd()+'/lib/git-workspace-admission.test.mjs').import('./git-operation-admission.ts');process.stdout.write(JSON.stringify(m.inspectGitOperationAdmission(process.argv[1],process.argv[2])));})()`;
  const restarted = JSON.parse(execFileSync(process.execPath, ["-e", script, f.agent, path.join(f.repo, ".git")], { cwd: process.cwd(), encoding: "utf8" }));
  assert.equal(restarted.admitted, false);
});
test("copied genuine native proof cannot authorize publication or release", async (t) => {
  let observed;
  const f = fixture(t, { transform: (intent) => ({
    assertOwned(proof) {
      if (proof) {
        observed = proof; assert.deepEqual(readGitWorkspaceNativeProof(proof), proof);
        assert.equal(readGitWorkspaceNativeProof(structuredClone(proof)), undefined);
        assert.throws(() => intent.assertOwned(structuredClone(proof)));
      }
      intent.assertOwned(proof);
    },
    completed: (proof) => intent.completed(structuredClone(proof)),
  }) });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required");
  assert.ok(observed); assert.equal(f.inspect().admitted, false);
});
test("failed completed evidence publication does not advance owned inventory", async (t) => {
  const originalLink = fs.linkSync; let f;
  f = fixture(t, { transform: (intent) => ({
    assertOwned(proof) {
      if (!proof) return intent.assertOwned();
      fs.linkSync = (from, to) => { if (to.endsWith(".completed")) throw Error("publication failed"); return originalLink(from, to); };
      try { assert.throws(() => intent.assertOwned(proof)); } finally { fs.linkSync = originalLink; }
      assert.throws(() => intent.assertOwned(), "old inventory is still mandatory");
      throw Error("stop after failed measured publication");
    },
  }) });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required");
  assert.equal(f.inspect().admitted, false); assert.equal(fs.existsSync(f.request.destinationPath), true);
});
test("disposition publication failure preserves completed artifact and quarantine", async (t) => {
  const originalRename = fs.renameSync; let failed = false;
  const f = fixture(t, { onCompleted: () => {
    fs.renameSync = (from, to) => {
      if (to.includes("git-operation-admission") && to.endsWith(".json")) { failed = true; throw Error("disposition failed"); }
      return originalRename(from, to);
    };
  } });
  try { await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required"); }
  finally { fs.renameSync = originalRename; }
  assert.equal(failed, true); assert.equal(f.inspect().admitted, false);
});
test("known conventional parent survives failure; no rollback or adopted namespace", async (t) => {
  const f = fixture(t, { parentCreation: true });
  await assert.rejects(f.apply(await f.prepare(), { afterParentCreate: () => { throw Error("after-parent failure"); } }),
    (e) => e.code === "recovery-required");
  assert.equal(fs.statSync(f.parent).mode & 0o777, 0o700); assert.equal(fs.existsSync(f.request.destinationPath), false);
  assert.equal(f.inspect().admitted, false);
});
test("extra worktree at final completed callback blocks release", async (t) => {
  const f = fixture(t, { onCompleted: () => git(f.repo, "worktree", "add", "-qb", "extra-final", path.join(f.parent, "extra-final")) });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required"); assert.equal(f.inspect().admitted, false);
});
for (const parentCreation of [false, true]) test(`parent replacement after durable journal cannot release own addition, created=${parentCreation}`, async (t) => {
  const f = fixture(t, { parentCreation, onCompleted: () => {
    const backup = `${f.parent}-original`; fs.renameSync(f.parent, backup); fs.mkdirSync(f.parent, { mode: 0o700 });
    fs.renameSync(path.join(backup, "feature"), f.request.destinationPath); fs.rmdirSync(backup);
  } });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required");
  assert.equal(f.calls.some(([phase]) => phase === "completed"), true); assert.equal(f.inspect().admitted, false);
  assert.equal(fs.existsSync(f.request.destinationPath), true);
});
test("conventional creation ancestor replacement after journal is not an inventory allowance", async (t) => {
  const f = fixture(t, { parentCreation: true, onCompleted: () => {
    const backup = `${f.root}-original`; fs.renameSync(f.root, backup); fs.mkdirSync(f.root);
    for (const name of fs.readdirSync(backup)) fs.renameSync(path.join(backup, name), path.join(f.root, name));
    fs.rmdirSync(backup);
  } });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required");
  assert.equal(f.calls.some(([phase]) => phase === "completed"), true); assert.equal(f.inspect().admitted, false);
});
test("ignored destination addition after journal is not the measured own tree", async (t) => {
  const f = fixture(t, { onCompleted: () => {
    fs.appendFileSync(path.join(f.repo, ".git", "info", "exclude"), "\nlate-cache\n");
    fs.writeFileSync(path.join(f.request.destinationPath, "late-cache"), "unmeasured bytes\n");
  } });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required");
  assert.equal(f.calls.some(([phase]) => phase === "completed"), true); assert.equal(f.inspect().admitted, false);
});
test("corrupt or orphan native artifact is unavailable after settled restart", async (t) => {
  const f = fixture(t); await f.apply(await f.prepare()); assert.equal(f.inspect().admitted, true);
  const base = path.join(f.agent, "pi-web", "git-operation-admission", "v1"), dir = path.join(base, fs.readdirSync(base)[0]);
  const completed = fs.readdirSync(dir).find((name) => name.endsWith(".completed"));
  fs.writeFileSync(path.join(dir, completed), "corrupt", { mode: 0o600 });
  assert.equal(f.inspect().reason, "unavailable");
});
test("unexpected registration inside final preflight remains quarantined, no native add", async (t) => {
  const f = fixture(t), c = await f.prepare();
  await assert.rejects(f.apply(c, { duringFinalPreflight: () => git(f.repo, "worktree", "add", "-qb", "extra", path.join(f.parent, "extra")) }),
    (e) => e.code === "recovery-required");
  assert.equal(fs.existsSync(f.request.destinationPath), false); assert.equal(f.inspect().admitted, false);
});
for (const mutation of ["ref", "source-bytes", "unsafe-config"]) test(`late awaited workspace authority cannot waive ${mutation}`, async (t) => {
  const f = fixture(t, { authorize: async (phase) => {
    if (phase !== "before-add") return;
    if (mutation === "ref") git(f.repo, "branch", "external-ref");
    if (mutation === "source-bytes") fs.writeFileSync(path.join(f.repo, "base"), "externally changed\n");
    if (mutation === "unsafe-config") git(f.repo, "config", "filter.unsafe.clean", "false");
  } });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required");
  assert.equal(fs.existsSync(f.request.destinationPath), false); assert.equal(f.inspect().admitted, false);
});
test("replaced source after intent is not an inventory exception", async (t) => {
  const f = fixture(t), c = await f.prepare();
  await assert.rejects(f.apply(c, { afterIntent: () => {
    fs.renameSync(f.repo, `${f.repo}-old`); fs.mkdirSync(f.repo);
  } }), (e) => e.code === "recovery-required");
  assert.equal(fs.existsSync(f.request.destinationPath), false);
  assert.throws(() => f.intent.assertOwned());
});
for (const proof of [undefined, {}, { version: 1, outcome: "completed" },
  { version: 1, outcome: "completed", actionId: "00000000-0000-0000-0000-000000000000", destination: {} }]) {
  test(`partial/wrong workspace completion cannot resolve (${JSON.stringify(proof)})`, async (t) => {
    const f = fixture(t), c = await f.prepare();
    await assert.rejects(f.apply(c, { afterIntent: async () => {
      await assert.rejects(f.intent.completed(proof)); throw Error("stop after rejection");
    } }), (e) => e.code === "recovery-required");
    assert.equal(f.inspect().admitted, false); assert.equal(fs.existsSync(f.request.destinationPath), false);
  });
}
