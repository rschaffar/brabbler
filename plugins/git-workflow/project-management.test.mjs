import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { gitProjectActions } = await jiti.import("./project-management.ts");
const { gitWorkflowManifest } = await jiti.import("./manifest.ts");
const { updatePluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
const { preparePluginReview, reviewManifest } = await jiti.import("../../lib/plugins/review-store.ts");
const { prepareProjectAction, getProjectOperation, decideProjectOperation, listProjectOperations, projectOperationReview } = await jiti.import("../../lib/plugins/project-operations.ts");
const { allowFileRoot } = await jiti.import("../../lib/file-access.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t, mode = "allow", ignored = false) {
  const root = mkdtempSync(join(tmpdir(), "pi-browser-cleanup-test-"));
  const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  const previous = [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__piWebTerminals];
  globalThis.__piSessions = new Map(); globalThis.__piStartingSessionCwds = new Map(); globalThis.__piWebTerminals = new Map();
  t.after(() => { [globalThis.__piSessions, globalThis.__piStartingSessionCwds, globalThis.__piWebTerminals] = previous; if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const cwd = join(root, "repo"), path = join(root, "feature");
  git(root, "init", "-qb", "main", cwd); git(cwd, "config", "user.name", "Fixture"); git(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, ".gitignore"), "generated/\n"); writeFileSync(join(cwd, "source"), "base\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "Base");
  git(cwd, "worktree", "add", "-qb", "feature", path); writeFileSync(join(path, "source"), "feature\n"); git(path, "add", "."); git(path, "commit", "-qm", "Feature");
  const featureTip = git(path, "rev-parse", "HEAD"); git(cwd, "merge", "--no-ff", "-qm", "Merge feature", "feature");
  const integrationCommit = git(cwd, "rev-parse", "HEAD");
  updatePluginSettings(gitWorkflowManifest, "global", cwd, { enabled: true }, []);
  const set = (values) => updatePluginSettings(gitWorkflowManifest, "project", cwd, values, []);
  set({ cleanupFeature: mode, targetBranch: "main", targetSelection: "ask", approvedArtifactRoots: ignored ? "generated" : null });
  if (ignored) { mkdirSync(join(path, "generated")); writeFileSync(join(path, "generated/cache"), "generated\n"); }
  allowFileRoot(cwd);
  const payload = { featureBranch: "feature", featureTip, integrationCommit, targetBranch: "main", worktreePath: path, removeWorktree: true, deleteBranch: true };
  return { root, cwd, path, payload, set, input: () => ({ cwd, requestId: randomUUID(), action: "cleanup", payload }) };
}
async function wait(id, expected = (op) => ["review", "failed", "cancelled", "outcome-unknown"].includes(op.state)) {
  const deadline = Date.now() + 10_000;
  for (;;) { const status = await getProjectOperation("git-workflow", id); if (expected(status)) return status; if (Date.now() > deadline) assert.fail(`Operation did not settle: ${JSON.stringify(status)}`); await delay(10); }
}
const settled = (op) => ["succeeded", "failed", "cancelled", "outcome-unknown"].includes(op.state);
test("Stop/reject revoke live authority even when decision persistence fails; approve still requires persistence", async (t) => {
  for (const decision of ["stop", "reject", "approve"]) await t.test(decision, async (st) => {
    const f = fixture(st), input = f.input(); const rename = fs.renameSync;
    fs.renameSync = (source, destination) => {
      if (destination.endsWith(`${input.requestId}.json`) && JSON.parse(readFileSync(source, "utf8")).decision === decision) throw new Error("fixture decision persistence failure");
      return rename(source, destination);
    };
    syncBuiltinESMExports();
    try {
      const fresh = await createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import("../../lib/plugins/project-operations.ts");
      const op = await fresh.prepareProjectAction("git-workflow", input); await wait(op.id);
      if (decision === "approve") {
        await assert.rejects(fresh.decideProjectOperation("git-workflow", op.id, f.cwd, decision), /persistence failure/);
        assert.ok((await getProjectOperation("git-workflow", op.id)).card);
        await fresh.decideProjectOperation("git-workflow", op.id, f.cwd, "stop");
      } else {
        const response = await fresh.decideProjectOperation("git-workflow", op.id, f.cwd, decision);
        assert.equal(response.card, undefined); assert.match(response.persistenceError, /Authority revoked/);
        await assert.rejects(fresh.decideProjectOperation("git-workflow", op.id, f.cwd, "approve"), /claimed/);
      }
      await wait(op.id, settled); await delay(20);
      assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.payload.featureTip);
    } finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  });
});
test("browser revalidation refuses artifacts becoming unignored through info/exclude changes", async (t) => {
  const f = fixture(t); const exclude = git(f.path, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude");
  writeFileSync(exclude, "once-ignored/\n"); mkdirSync(join(f.path, "once-ignored")); writeFileSync(join(f.path, "once-ignored/cache"), "keep");
  f.set({ approvedArtifactRoots: "once-ignored" });
  const result = await gitProjectActions.execute(f.cwd, "cleanup", f.payload, {
    isDirectoryInUse: () => false, reserveDirectory: () => () => {}, prepareReview: preparePluginReview,
    operationReceipt: () => {}, pluginCard: async () => { writeFileSync(exclude, ""); return "approve"; },
  }, new AbortController().signal, () => {});
  assert.equal(result.isError, true); assert.equal(result.details.effectStarted, false);
  assert.ok(existsSync(join(f.path, "once-ignored/cache"))); assert.equal(git(f.cwd, "rev-parse", "feature"), f.payload.featureTip);
  // The trusted browser restriction must not remove tool explicit-root support.
  const { executeGitOperation } = await jiti.import("./server.ts");
  const tool = await executeGitOperation(f.cwd, { ...f.payload, action: "cleanupFeature", checkout: f.cwd, artifactRoots: ["once-ignored"] }, {
    isDirectoryInUse: () => false, reserveDirectory: () => () => {}, prepareReview: preparePluginReview,
    operationReceipt: () => {}, pluginCard: () => assert.fail("Permitted Allow tool cleanup remains policy-authorized"),
  });
  assert.notEqual(tool.isError, true, tool.content[0].text); assert.equal(existsSync(f.path), false);
});
test("transient terminal receipt failure retains exact review and cancelled/failed phase", async (t) => {
  for (const decision of ["reject", "abort", "stale"]) await t.test(decision, async (st) => {
    const f = fixture(st); const receipts = []; let failed = false, ref;
    const controller = new AbortController();
    const result = await gitProjectActions.execute(f.cwd, "cleanup", f.payload, {
      isDirectoryInUse: () => false, reserveDirectory: () => () => {}, prepareReview: preparePluginReview,
      operationReceipt: (_id, receipt) => {
        if (["cancelled", "failed"].includes(receipt.phase) && !failed) { failed = true; throw new Error("fixture transient terminal failure"); }
        receipts.push(structuredClone(receipt));
      },
      pluginCard: async (_id, card) => {
        ref = card.review;
        if (decision === "abort") controller.abort();
        if (decision === "stale") writeFileSync(join(f.path, "source"), "source changed after approval");
        return decision === "reject" ? "reject" : "approve";
      },
    }, controller.signal, () => {});
    assert.equal(result.isError, true); assert.equal(failed, true);
    assert.equal(receipts.at(-1).phase, decision === "stale" ? "failed" : "cancelled");
    assert.deepEqual(receipts.at(-1).card.review, ref); await reviewManifest(ref, "git-workflow"); assert.ok(existsSync(f.path));
  });
});
test("Ask/Allow adapter preparation always has zero effects, including artifact-free and allowlisted cleanup", async (t) => {
  for (const mode of ["ask", "allow"]) for (const ignored of [false, true]) await t.test(`${mode}/${ignored}`, async (st) => {
    const f = fixture(st, mode, ignored); let answer, card; const receipts = [];
    const execution = gitProjectActions.execute(f.cwd, "cleanup", f.payload, {
      isDirectoryInUse: () => false, reserveDirectory: () => () => {}, prepareReview: preparePluginReview,
      operationReceipt: (_id, receipt) => receipts.push(structuredClone(receipt)),
      pluginCard: async (_id, value) => { card = value; return new Promise((resolve) => { answer = resolve; }); },
    }, new AbortController().signal, () => {});
    while (!answer) await delay(10);
    assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.payload.featureTip); assert.equal(receipts.at(-1).phase, "prepared");
    assert.equal(receipts.at(-1).authorization.mode, "ask"); assert.match(receipts.at(-1).authorization.source, new RegExp(`manual browser confirmation.*${mode}`));
    assert.ok(card.review); answer("reject"); const result = await execution; assert.equal(result.isError, true); assert.ok(existsSync(f.path));
  });
});
test("idempotent prepare, single-use decisions, operation review and successful combined cleanup without a chat", async (t) => {
  const f = fixture(t); const input = f.input(); const first = await prepareProjectAction("git-workflow", input);
  assert.equal(first.id, input.requestId);
  const review = await wait(first.id); assert.equal(review.state, "review"); assert.ok(review.card); assert.equal(review.receipt.card.actions.length, 0);
  assert.ok(review.reviewBaseUrl.includes(`/project-actions/${first.id}/reviews/`));
  assert.equal((await prepareProjectAction("git-workflow", { payload: input.payload, action: input.action, requestId: input.requestId, cwd: input.cwd })).id, first.id);
  await assert.rejects(prepareProjectAction("git-workflow", { ...input, payload: { ...input.payload, deleteBranch: false } }), /different preparation/);
  await assert.rejects(projectOperationReview("git-workflow", first.id, randomUUID()), /not owned/);
  await assert.rejects(decideProjectOperation("git-workflow", first.id, f.path, "approve"), /checkout changed/);
  await Promise.all([decideProjectOperation("git-workflow", first.id, f.cwd, "approve"), decideProjectOperation("git-workflow", first.id, f.cwd, "approve")]);
  const result = await wait(first.id, settled); assert.equal(result.state, "succeeded", JSON.stringify(result));
  assert.equal(existsSync(f.path), false); assert.equal(git(f.cwd, "branch", "--list", "feature"), "");
  assert.equal(result.receipt.authorization.decision, "user-approved"); assert.equal(result.receipt.completedEffects.length, 2);
  await assert.rejects(decideProjectOperation("git-workflow", first.id, f.cwd, "reject"), /already claimed/);
  assert.equal((await prepareProjectAction("git-workflow", input)).state, "succeeded");
  updatePluginSettings(gitWorkflowManifest, "global", f.cwd, { enabled: false }, []);
  assert.equal((await getProjectOperation("git-workflow", first.id)).state, "succeeded");
  assert.equal((await listProjectOperations("git-workflow", f.cwd))[0].id, first.id);
  const ref = await projectOperationReview("git-workflow", first.id, review.receipt.card.review.id); await reviewManifest(ref, "git-workflow");
  assert.equal((await getProjectOperation("git-workflow", first.id)).card, undefined);
});
test("idle chats warn but do not block; managed starting/running sessions and terminals remain protected", async (t) => {
  for (const use of ["idle", "starting", "running", "terminal"]) await t.test(use, async (st) => {
    const f = fixture(st); const child = join(f.path, "child");
    // Observers resolve existing physical ancestors for starting descendant cwds.
    if (use === "idle" || use === "running") globalThis.__piSessions.set(use, { cwd: child, sessionId: use, isRunning: () => use === "running" });
    if (use === "starting") globalThis.__piStartingSessionCwds.set(child, 1);
    if (use === "terminal") globalThis.__piWebTerminals.set("terminal", { cwd: child, exited: false });
    const op = await prepareProjectAction("git-workflow", f.input()), status = await wait(op.id);
    if (use === "idle") {
      assert.equal(status.state, "review", JSON.stringify(status));
      assert.match(JSON.stringify(status.card), /Idle chat history stays/);
      await decideProjectOperation("git-workflow", op.id, f.cwd, "reject"); await wait(op.id, settled);
    } else { assert.equal(status.state, "failed"); assert.match(JSON.stringify(status), /active use/); }
    assert.ok(existsSync(f.path));
  });
});
test("unignored files, explicit roots, designated target mismatch, main/selected and new activity refuse effects", async (t) => {
  for (const reason of ["untracked", "roots", "target", "selected", "new-activity"]) await t.test(reason, async (st) => {
    const f = fixture(st); const input = f.input();
    if (reason === "untracked") writeFileSync(join(f.path, "private-file"), "keep");
    if (reason === "roots") input.payload = { ...input.payload, artifactRoots: ["private-file"] };
    if (reason === "target") { git(f.cwd, "branch", "other", f.payload.integrationCommit); input.payload.targetBranch = "other"; }
    if (reason === "selected") { input.cwd = f.path; allowFileRoot(f.path); }
    const op = await prepareProjectAction("git-workflow", input), review = await wait(op.id);
    if (reason === "new-activity") {
      assert.equal(review.state, "review"); globalThis.__piWebTerminals.set("new", { cwd: f.path, exited: false });
      await decideProjectOperation("git-workflow", op.id, f.cwd, "approve");
      assert.equal((await wait(op.id, settled)).state, "failed");
    } else assert.equal(review.state, "failed", JSON.stringify(review));
    assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.payload.featureTip);
  });
});
test("Stop and relevant settings changes cancel pending reviews without effects", async (t) => {
  for (const reason of ["stop", "deny", "disable", "target"]) await t.test(reason, async (st) => {
    const f = fixture(st); const op = await prepareProjectAction("git-workflow", f.input()); assert.equal((await wait(op.id)).state, "review");
    if (reason === "stop") await decideProjectOperation("git-workflow", op.id, f.cwd, "stop");
    if (reason === "deny") f.set({ cleanupFeature: "deny" });
    if (reason === "disable") updatePluginSettings(gitWorkflowManifest, "global", f.cwd, { enabled: false }, []);
    if (reason === "target") { git(f.cwd, "branch", "other", f.payload.integrationCommit); f.set({ targetBranch: "other" }); }
    const result = await wait(op.id, settled); assert.equal(result.state, "cancelled", JSON.stringify(result)); assert.ok(existsSync(f.path)); assert.equal(result.card, undefined);
  });
});
test("restart records are read-only/outcome-unknown and lost prepare responses cannot replay", async (t) => {
  const f = fixture(t); const input = f.input(), op = await prepareProjectAction("git-workflow", input); await wait(op.id);
  await decideProjectOperation("git-workflow", op.id, f.cwd, "reject"); await wait(op.id, settled);
  globalThis[Symbol.for("pi-web:project-operations/v1")].delete(op.id);
  const path = join(f.root, "agent/pi-web/project-operations", `${op.id}.json`), saved = JSON.parse(readFileSync(path, "utf8"));
  saved.state = "dispatched"; saved.receipt.phase = "executing"; delete saved.result; writeFileSync(path, JSON.stringify(saved));
  const historical = await getProjectOperation("git-workflow", op.id); assert.equal(historical.state, "outcome-unknown"); assert.equal(historical.card, undefined);
  assert.equal((await prepareProjectAction("git-workflow", input)).state, "outcome-unknown");
  await assert.rejects(decideProjectOperation("git-workflow", op.id, f.cwd, "approve"), /Historical/); assert.ok(existsSync(f.path));
});
test("post-effect record failure remains honest and does not retry or roll back removed worktree", async (t) => {
  const f = fixture(t); const input = f.input();
  const rename = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination.endsWith(`${input.requestId}.json`)) {
      const record = JSON.parse(readFileSync(source, "utf8"));
      if (record.receipt?.completedEffects?.length || record.receipt?.phase === "succeeded") throw Object.assign(new Error("fixture terminal persistence failure"), { code: "EIO" });
    }
    return rename(source, destination);
  };
  syncBuiltinESMExports(); t.after(() => { fs.renameSync = rename; syncBuiltinESMExports(); });
  // Jiti captures named builtins during evaluation; load the writer after the fault is installed.
  const fresh = await createJiti(import.meta.url, { moduleCache: false, fsCache: false }).import("../../lib/plugins/project-operations.ts");
  const op = await fresh.prepareProjectAction("git-workflow", input); await wait(op.id);
  await fresh.decideProjectOperation("git-workflow", op.id, f.cwd, "approve");
  const result = await wait(op.id, settled);
  assert.ok(["failed", "outcome-unknown"].includes(result.state), JSON.stringify(result)); assert.equal(existsSync(f.path), false);
  // Failure after the first observed completed step retains the local branch.
  assert.equal(git(f.cwd, "rev-parse", "feature"), f.payload.featureTip);
  assert.match(JSON.stringify(result), /persist|EIO|unknown|reporting/i);
});
test("worktree-only and branch-only choices preserve the explicitly kept resource", async (t) => {
  for (const mode of ["worktree-only", "branch-only"]) await t.test(mode, async (st) => {
    const f = fixture(st); const input = f.input();
    if (mode === "branch-only") {
      git(f.cwd, "worktree", "remove", f.path);
      input.payload = { ...f.payload, removeWorktree: false }; delete input.payload.worktreePath;
    } else input.payload = { ...f.payload, deleteBranch: false };
    const op = await prepareProjectAction("git-workflow", input); assert.equal((await wait(op.id)).state, "review");
    await decideProjectOperation("git-workflow", op.id, f.cwd, "approve");
    const result = await wait(op.id, settled); assert.equal(result.state, "succeeded", JSON.stringify(result));
    assert.equal(result.receipt.completedEffects.length, 1);
    assert.equal(existsSync(f.path), false);
    assert.equal(git(f.cwd, "branch", "--list", "feature") !== "", mode === "worktree-only");
  });
});
test("failed initial record persistence refuses preparation before any resource effect", async (t) => {
  const f = fixture(t); const privateRoot = join(f.root, "agent/pi-web"); mkdirSync(privateRoot, { recursive: true });
  writeFileSync(join(privateRoot, "project-operations"), "blocking file");
  await assert.rejects(prepareProjectAction("git-workflow", f.input()));
  assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.payload.featureTip);
});
test("failed per-step intent persistence does not claim a dispatched deletion", async (t) => {
  const f = fixture(t); let intents = 0;
  const result = await gitProjectActions.execute(f.cwd, "cleanup", f.payload, {
    isDirectoryInUse: () => false, reserveDirectory: () => () => {}, prepareReview: preparePluginReview,
    pluginCard: async () => "approve",
    operationReceipt: (_id, receipt) => { if (receipt.phase === "executing" && ++intents === 2) throw new Error("fixture pre-effect write failure"); },
  }, new AbortController().signal, () => {});
  assert.equal(result.isError, true); assert.equal(result.details.effectStarted, false);
  assert.doesNotMatch(result.content[0].text, /Last dispatched/);
  assert.ok(existsSync(f.path)); assert.equal(git(f.cwd, "rev-parse", "feature"), f.payload.featureTip);
});
