import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
const configHome = fs.mkdtempSync(path.join(tmpdir(), "cleanup-admission-config-"));
process.env.HOME = configHome; process.env.XDG_CONFIG_HOME = configHome;
after(() => {
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  fs.rmSync(configHome, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url);
const nativeCleanup = await jiti.import("./git-cleanup-operation.ts");
const { createGitCleanupEngine } = nativeCleanup;
const { createGitCleanupAdmission } = await jiti.import("./git-cleanup-admission.ts");
const { createTrustedWorkspaceUsage, beginGitWorkspacePlacement } = await jiti.import("./git-workspace-usage.ts");
const { inspectGitOperationAdmission } = await jiti.import("./git-operation-admission.ts");
const { selectCanonicalGitResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
}).trim();
async function fixture(t, hooks = {}) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "cleanup-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo"), source = path.join(root, "feature"), target = hooks.primaryTarget ? repo : path.join(root, "delivery"), agent = path.join(root, "agent");
  fs.mkdirSync(agent, { mode: 0o700 }); git(root, "init", "-q", "-b", "main", repo);
  git(repo, "config", "user.name", "Test"); git(repo, "config", "user.email", "test@example.com"); git(repo, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(repo, "base"), "base\n"); git(repo, "add", "."); git(repo, "commit", "-qm", "base");
  git(repo, "worktree", "add", "-qb", "feature", source);
  if (!hooks.primaryTarget) git(repo, "worktree", "add", "-qb", "delivery", target);
  const previousTargetOid = git(target, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(source, "new"), "new\n"); git(source, "add", "."); git(source, "commit", "-qm", "feature");
  git(target, "merge", "--ff-only", "feature"); allowFileRoot(root);
  const select = (cwd) => selectCanonicalGitResources({ repositoryPath: repo, checkoutPath: cwd });
  const s = await select(source), dest = await select(target), main = await select(repo), featureOid = git(source, "rev-parse", "HEAD");
  const integration = { completedAt: Date.now(), delivery: "selected-local", method: "ff", actualFF: true, feature: s, target: dest,
    featureOid, previousTargetOid, resultOid: featureOid, resultTree: git(target, "rev-parse", "HEAD^{tree}"),
    parents: git(target, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").slice(1) };
  const creator = { mode: "create", destination: s, originalSource: main, branchRef: "refs/heads/feature" }, ih = {}, ch = {};
  const calls = [], removalAcks = new WeakMap(); let capturedIntent, removal;
  const admission = createGitCleanupAdmission({ agentDir: agent,
    // Required real module issuer; deliberately no payload-derived test shim.
    readNativeProof: hooks.disableIssuer ? undefined : (proof) => {
      const native = nativeCleanup.readGitCleanupNativeProof(proof);
      return hooks.readNativeProof ? hooks.readNativeProof(proof, native) : native;
    },
    async onIntent(e) { calls.push(["intent", e.actionId]); capturedIntent = e; await hooks.intent?.(e); },
    async onRemoval(p) { calls.push(["removal", p.actionId]); removal = p; await hooks.removal?.(p); },
    async onCompleted(p) { calls.push(["completed", p.actionId]); assert.equal(inspectGitOperationAdmission(agent, s.commonDir).admitted, false); await hooks.completed?.(p); },
  });
  const known = () => ({ known: true, entries: [] });
  const usage = createTrustedWorkspaceUsage(() => ({ sessions: known(), terminals: known(), checks: known(), inflight: known() }), admission.readRecordedRemoval);
  const engine = createGitCleanupEngine({ ...admission,
    readCompletedIntegration: (h) => h === ih ? integration : undefined,
    readCreatedWorkspace: (h) => h === ch ? creator : undefined, getProjectMain: async () => main,
    authorize: async (phase) => hooks.authorize?.(phase),
    async acquireUsageLease(resources, e) {
      const lease = usage.acquireLease(resources.cwd, resources.identities.checkout, { actionId: e.actionId,
        featureOid: e.integration.featureOid, adminPath: resources.gitDir, adminIdentity: resources.identities.git,
        markerIdentity: resources.identities.marker, adminInventoryHash: e.inventory.admins[path.basename(resources.gitDir)] });
      return {
        assertIdle: () => lease.assertUnused(),
        acknowledgeRemoval(proof) {
          const ack = removalAcks.get(proof); assert.ok(ack, "only awaited durable recording issues an acknowledgement");
          const p = admission.readRecordedRemoval(ack); assert.ok(p);
          assert.equal(p.sourcePath, removal.sourcePath); assert.equal(fs.existsSync(source), false);
          assert.equal(admission.readRecordedRemoval(proof), undefined);
          assert.equal(admission.readRecordedRemoval(structuredClone(ack)), undefined);
          assert.throws(() => lease.acknowledgeRemoval(proof), (e) => e.code === "stale");
          assert.throws(() => lease.acknowledgeRemoval({ ...ack }), (e) => e.code === "stale");
          lease.acknowledgeRemoval(ack); calls.push(["usage-transition", p.actionId]);
          assert.throws(() => beginGitWorkspacePlacement(source), (e) => e.code === "leased");
        }, release() { lease.release(); },
      };
    },
    async beginIntent(e) {
      const intent = await admission.beginIntent(e); capturedIntent = e;
      const bridged = { ...intent,
        async recordRemoval(proof) {
          const ack = await intent.recordRemoval(proof);
          removalAcks.set(proof, ack); return ack;
        },
      };
      return hooks.transform ? { ...bridged, ...hooks.transform(bridged, e) } : bridged;
    },
  });
  return { dir: root, repo, source, target, agent, s, calls, select, admission, get evidence() { return capturedIntent; },
    prepare: () => engine.capture({ integrationHandle: ih, creatorHandle: ch }), apply: (c) => engine.apply(c),
    inspect: () => inspectGitOperationAdmission(agent, s.commonDir) };
}
test("missing native issuer refuses capture before any effect or intent", async (t) => {
  const f = await fixture(t, { disableIssuer: true });
  await assert.rejects(f.prepare(), /native proof issuer unavailable/);
  assert.equal(fs.existsSync(f.source), true); assert.equal(f.calls.length, 0);
  assert.notEqual(git(f.repo, "rev-parse", "refs/heads/feature"), "");
});
for (const primaryTarget of [false, true]) test(`actual cleanup callbacks persist removal before exact CAS and journal before release, primary target=${primaryTarget}`, async (t) => {
  const f = await fixture(t, { primaryTarget }), c = await f.prepare(), result = await f.apply(c);
  assert.equal(result.status, "completed"); assert.equal(fs.existsSync(f.source), false);
  assert.equal(git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
  assert.deepEqual(f.calls.map(([phase]) => phase), ["intent", "removal", "usage-transition", "completed"]);
  assert.equal(f.calls.every(([, id]) => id === c.actionId), true); assert.equal(f.inspect().admitted, true);
  await assert.rejects(f.apply(c));
});
for (const stage of ["removal", "completed"]) test(`throwing ${stage} record retains quarantine across restart`, async (t) => {
  const f = await fixture(t, { [stage]: () => { throw Error("durable callback failed"); } }), c = await f.prepare();
  await assert.rejects(f.apply(c), (e) => e.code === "recovery-required");
  assert.equal(f.inspect().admitted, false);
  assert.equal(f.calls.some(([phase]) => phase === stage), true, "the intended durable callback must actually run");
  const script = `const {createJiti}=require('jiti'); (async()=>{const m=await createJiti(process.cwd()+'/lib/git-cleanup-admission.test.mjs').import('./git-operation-admission.ts');process.stdout.write(JSON.stringify(m.inspectGitOperationAdmission(process.argv[1],process.argv[2])));})()`;
  const restarted = JSON.parse(execFileSync(process.execPath, ["-e", script, f.agent, f.s.commonDir], { cwd: process.cwd(), encoding: "utf8" }));
  assert.equal(restarted.admitted, false);
  assert.equal(git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature") === "", stage === "completed");
});
for (const mutation of ["oid", "action", "partial", "extra"]) test(`tampered cleanup ${mutation} proof cannot release`, async (t) => {
  let called = false;
  const f = await fixture(t, { transform: (intent) => ({ completed: (proof) => {
    called = true;
    const wrong = structuredClone(proof);
    if (mutation === "oid") wrong.deletedOid = "a".repeat(40);
    if (mutation === "action") wrong.actionId = "00000000-0000-0000-0000-000000000000";
    if (mutation === "partial") delete wrong.transactionExit;
    if (mutation === "extra") wrong.unverified = true;
    return intent.completed(wrong);
  } }) }), c = await f.prepare();
  await assert.rejects(f.apply(c), (e) => e.code === "recovery-required"); assert.equal(f.inspect().admitted, false);
  assert.equal(called, true, "tamper test must reach the completion proof callback");
});
for (const kind of ["removed", "completed"]) for (const behavior of ["throw", "unknown"]) test(`native ${kind} proof reader ${behavior} retains quarantine without a journal waiver`, async (t) => {
  let reached = false;
  const f = await fixture(t, { readNativeProof(proof, native) {
    assert.ok(native, "delegate to the genuine native issuer before injecting failure");
    if (native.kind !== kind) return native;
    reached = true;
    if (behavior === "throw") throw Error("native issuer unavailable");
    return undefined;
  } });
  const c = await f.prepare();
  await assert.rejects(f.apply(c), (e) => e.code === "recovery-required" && e.facts.removalVerified);
  assert.equal(reached, true); assert.equal(f.inspect().admitted, false);
  assert.equal(f.calls.some(([phase]) => phase === "completed"), false);
  assert.equal(f.calls.some(([phase]) => phase === "usage-transition"), kind === "completed");
  assert.equal(git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature") === "", kind === "completed");
  await assert.rejects(f.apply(c));
});
for (const stage of ["removal", "completed"]) test(`failed immutable ${stage} publication does not issue acknowledgement or release`, async (t) => {
  const f = await fixture(t), c = await f.prepare(), originalLink = fs.linkSync;
  let reached = false;
  fs.linkSync = (from, to) => {
    if (to.startsWith(f.agent + path.sep) && to.endsWith(`.${stage}`)) { reached = true; throw Error("immutable publication failed"); }
    return originalLink(from, to);
  };
  try { await assert.rejects(f.apply(c), (e) => e.code === "recovery-required"); }
  finally { fs.linkSync = originalLink; }
  assert.equal(reached, true); assert.equal(f.inspect().admitted, false);
  assert.equal(f.calls.some(([phase]) => phase === "completed"), false);
  assert.equal(f.calls.some(([phase]) => phase === "usage-transition"), stage === "completed");
  assert.equal(git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature") === "", stage === "completed");
});
test("late ignored source changes are not covered by the old metadata approval", async (t) => {
  let beforeRemove = 0;
  const f = await fixture(t, { authorize: (phase) => {
    if (phase !== "before-remove" || ++beforeRemove !== 2) return;
    fs.appendFileSync(path.join(f.s.commonDir, "info", "exclude"), "\nlate-ignored\n");
    fs.writeFileSync(path.join(f.source, "late-ignored"), "must not be deleted\n");
  } });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required" && !e.facts.removeAttempted);
  assert.equal(fs.readFileSync(path.join(f.source, "late-ignored"), "utf8"), "must not be deleted\n");
  assert.equal(f.inspect().admitted, false);
});
test("current source admin replacement at the final ownership boundary refuses removal", async (t) => {
  let beforeRemove = 0;
  const f = await fixture(t, { authorize: (phase) => {
    if (phase !== "before-remove" || ++beforeRemove !== 2) return;
    const backup = path.join(f.dir, "original-source-admin"); fs.renameSync(f.s.gitDir, backup);
    fs.cpSync(backup, f.s.gitDir, { recursive: true });
  } });
  const c = await f.prepare(); await assert.rejects(f.apply(c), (e) => e.code === "recovery-required" && !e.facts.removeAttempted);
  assert.equal(fs.existsSync(f.source), true); assert.equal(git(f.repo, "rev-parse", "refs/heads/feature"), c.featureOid);
  assert.equal(f.inspect().admitted, false);
});
test("worktree admin parent reuse after own removal is not an allowed namespace change", async (t) => {
  const f = await fixture(t, { removal: () => {
    const root = path.join(f.s.commonDir, "worktrees"), backup = path.join(f.dir, "original-admin-parent");
    fs.renameSync(root, backup); fs.mkdirSync(root);
    for (const name of fs.readdirSync(backup)) fs.renameSync(path.join(backup, name), path.join(root, name));
    fs.rmdirSync(backup);
  } });
  const c = await f.prepare(); await assert.rejects(f.apply(c), (e) => e.code === "recovery-required" && e.facts.phase === "record-removal");
  assert.equal(git(f.repo, "rev-parse", "refs/heads/feature"), c.featureOid); assert.equal(f.inspect().admitted, false);
});
test("extra worktree after durable removal is not admitted to branch deletion", async (t) => {
  const f = await fixture(t, { removal: () => git(f.repo, "worktree", "add", "-qb", "extra", path.join(path.dirname(f.repo), "extra")) });
  const c = await f.prepare(); await assert.rejects(f.apply(c), (e) => e.code === "recovery-required");
  assert.equal(git(f.repo, "rev-parse", "refs/heads/feature"), c.featureOid); assert.equal(f.inspect().admitted, false);
});
test("extra worktree during completed journal callback blocks final release", async (t) => {
  const f = await fixture(t, { completed: () => git(f.repo, "worktree", "add", "-qb", "extra-final", path.join(path.dirname(f.repo), "extra-final")) });
  const c = await f.prepare(); await assert.rejects(f.apply(c), (e) => e.code === "recovery-required");
  assert.equal(git(f.repo, "for-each-ref", "--format=%(refname)", "refs/heads/feature"), "");
  assert.equal(f.inspect().admitted, false);
});
test("reusing removed source path blocks the proof-bound transition", async (t) => {
  const f = await fixture(t, { removal: () => fs.mkdirSync(f.source) });
  await assert.rejects(f.apply(await f.prepare()), (e) => e.code === "recovery-required");
  assert.equal(f.inspect().admitted, false); assert.notEqual(git(f.repo, "rev-parse", "refs/heads/feature"), "");
});
