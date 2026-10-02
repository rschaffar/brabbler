import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { selectGitProjectResources, parseBoundedGitWorktreePaths } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { gitActionAttribution } = await jiti.import("./git-action-controller.ts");
const { prepareGitCommit, confirmGitCommit } = await jiti.import("./git-commit.ts");
const { createGitAction, transitionGitAction, releaseGitAction, readGitAction } = await jiti.import("./git-action-journal.ts");
const { assertGitOperationAdmission, beginGitOperationIntent, inspectGitOperationAdmission,
  beginSupervisedGitOperationIntent } = await jiti.import("./git-operation-admission.ts");
const cwd = fileURLToPath(new URL("..", import.meta.url));
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
function init(repo) {
  execFileSync("git", ["init", "-qb", "main", repo]);
  execFileSync("git", ["-C", repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid",
    "commit", "--allow-empty", "-qm", "base"]);
  allowFileRoot(repo);
}
async function fixture(t, version = 2, linkedTarget = false) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "pi-web-action-resource-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agent = path.join(root, "agent"), a = path.join(root, "a"), b = path.join(root, "b"),
    source = path.join(root, "source"), other = path.join(root, "other");
  fs.mkdirSync(agent);
  init(a); init(b);
  git(a, "worktree", "add", "-qb", "feature", source);
  git(a, "worktree", "add", "-qb", "other", other);
  allowFileRoot(source); allowFileRoot(other);
  const selected = await selectGitProjectResources(source), target = await selectGitProjectResources(linkedTarget ? other : a);
  const attribution = gitActionAttribution(selected, target);
  const candidate = { kind: "integration", repositoryRoot: source,
    ...(version === 2 ? attribution : version === 1 ? { projectRoot: attribution.projectRoot,
      sourceCheckoutRoot: attribution.sourceCheckoutRoot, targetCheckoutRoot: attribution.targetCheckoutRoot } : {}) };
  const action = await createGitAction({ sessionId: "historic", source: "agent", candidate }, agent);
  const executing = await transitionGitAction(action.id, action.revision, { state: "executing", decision: "approved" }, agent);
  releaseGitAction(action.id, agent);
  git(a, "worktree", "remove", source);
  assert.equal(fs.existsSync(source), false);
  return { root, agent, a, b, source, other, selected, action: executing };
}
const admission = async (f, repo) => assertGitOperationAdmission(await selectGitProjectResources(repo), f.agent);
function restartAdmission(f, repo) {
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const j=createJiti(process.cwd()+'/lib/git-operation-attribution.test.mjs');
    const {allowFileRoot}=await j.import('./file-access.ts');
    const {selectGitProjectResources}=await j.import('./git-project-resources.ts');
    const {assertGitOperationAdmission}=await j.import('./git-operation-admission.ts');
    allowFileRoot(process.argv[1]);
    await assertGitOperationAdmission(await selectGitProjectResources(process.argv[1]),process.argv[2]);
  })().catch(e=>{console.error(e);process.exitCode=1})`;
  return () => execFileSync(process.execPath, ["-e", script, repo, f.agent], { cwd, stdio: "pipe" });
}

test("deleted linked source: canonical A and another checkout stay quarantined; distinct B admits, including after restart", async (t) => {
  const f = await fixture(t);
  assert.equal((await readGitAction(f.action.id, { includeArtifact: true }, f.agent)).record.state, "recovery-required");
  await assert.rejects(admission(f, f.a), /manual recovery/);
  await assert.rejects(admission(f, f.other), /manual recovery/);
  await admission(f, f.b);
  assert.throws(restartAdmission(f, f.a));
  assert.doesNotThrow(restartAdmission(f, f.b));
  // No history classification may override an unresolved physical ledger.
  const current = await selectGitProjectResources(f.b);
  const pending = beginGitOperationIntent(f.agent, current.commonDir, randomUUID(), "commit");
  assert.equal(inspectGitOperationAdmission(f.agent, current.commonDir).reason, "unresolved");
  await assert.rejects(admission(f, f.b), /manual recovery/);
  await assert.rejects(beginSupervisedGitOperationIntent(current, randomUUID(), "commit", f.agent), /manual recovery/);
  assert.throws(restartAdmission(f, f.b));
  pending.resolve();
  await admission(f, f.b);
  const admitted = await beginSupervisedGitOperationIntent(current, randomUUID(), "commit", f.agent);
  admitted.resolve();
  assert.doesNotThrow(restartAdmission(f, f.b));
});

test("replaced canonical A and B's secondary reused source path quarantine B's whole resource", async (t) => {
  const f = await fixture(t);
  const relocated = path.join(f.root, "parked");
  fs.renameSync(f.a, relocated);
  init(f.a); // A's captured canonical path, now a completely new repository.
  await assert.rejects(admission(f, f.a), /manual recovery/);
  git(f.b, "worktree", "add", "-qb", "reuse", f.source); // B reuses A's removed linked checkout path.
  allowFileRoot(f.source);
  await assert.rejects(admission(f, f.source), /manual recovery/);
  await assert.rejects(admission(f, f.b), /manual recovery/);
  await assert.rejects(admission(f, f.a), /manual recovery/);
  assert.throws(restartAdmission(f, f.source));
  assert.throws(restartAdmission(f, f.b));
  const selected = await selectGitProjectResources(f.b);
  await assert.rejects(beginSupervisedGitOperationIntent(selected, randomUUID(), "commit", f.agent), /manual recovery/);
  assert.equal(fs.existsSync(path.join(f.agent, "pi-web", "git-operation-admission")), false,
    "rejected before publishing a second intent");
});

test("reusing a captured target checkout path blocks B primary and secondary", async (t) => {
  const f = await fixture(t, 2, true);
  git(f.a, "worktree", "remove", f.other);
  git(f.b, "worktree", "add", "-qb", "target-reuse", f.other);
  await assert.rejects(admission(f, f.other), /manual recovery/);
  await assert.rejects(admission(f, f.b), /manual recovery/);
  await assert.rejects(admission(f, f.a), /manual recovery/);
  assert.throws(restartAdmission(f, f.b));
});

test("v1 cannot adopt a replacement source to admit the relocated original repository", async (t) => {
  const f = await fixture(t, 1), relocated = path.join(f.root, "relocated-a");
  fs.renameSync(f.a, relocated);
  allowFileRoot(relocated);
  init(f.a); // Different repository now occupies the captured canonical project path.
  git(f.a, "worktree", "add", "-qb", "replacement-source", f.source);
  allowFileRoot(f.source);
  assert.equal((await selectGitProjectResources(relocated)).projectRoot, relocated);
  assert.equal((await selectGitProjectResources(f.source)).projectRoot, f.a);
  for (const root of [relocated, f.a, f.source, f.b]) {
    await assert.rejects(admission(f, root), /manual recovery/, `v1 cannot establish a distinct instance for ${root}`);
    assert.throws(restartAdmission(f, root));
  }
  const selection = await selectGitProjectResources(relocated);
  await assert.rejects(beginSupervisedGitOperationIntent(selection, randomUUID(), "commit", f.agent), /manual recovery/);
  assert.equal(fs.existsSync(path.join(f.agent, "pi-web", "git-operation-admission")), false,
    "a false negative must not publish a new intent");
});

test("settled path-only history is not a quarantine, but damaged artifacts still block", async (t) => {
  const f = await fixture(t);
  const old = await createGitAction({ sessionId: "settled", source: "agent", candidate: {
    kind: "commit", repositoryRoot: f.source, projectRoot: f.a, sourceCheckoutRoot: f.source,
  } }, f.agent);
  const executing = await transitionGitAction(old.id, old.revision, { state: "executing" }, f.agent);
  await transitionGitAction(old.id, executing.revision, { state: "succeeded" }, f.agent);
  releaseGitAction(old.id, f.agent);
  await admission(f, f.b);
  fs.unlinkSync(path.join(f.agent, "pi-web", "git-actions", "v1", old.id, "candidate.json"));
  await assert.rejects(admission(f, f.b), /manual recovery/);
});

test("a new secondary registered AFTER reservation strands the owner at the native boundary", async (t) => {
  const f = await fixture(t), selection = await selectGitProjectResources(f.b);
  const head = git(f.b, "rev-parse", "HEAD");
  const operation = await beginSupervisedGitOperationIntent(selection, randomUUID(), "commit", f.agent);
  operation.assertOwned();
  git(f.b, "worktree", "add", "-qb", "late-reuse", f.source);
  assert.throws(() => operation.assertOwned(), /manual recovery/);
  assert.throws(() => operation.resolve(), /manual recovery/);
  assert.equal(git(f.b, "rev-parse", "HEAD"), head, "no native ref operation was allowed");
  assert.equal(inspectGitOperationAdmission(f.agent, selection.commonDir).reason, "unresolved");
  await assert.rejects(admission(f, f.b), /manual recovery/);
  assert.throws(restartAdmission(f, f.b));
});

test("the native commit's final callback rejects new overlap without a ref update or intent release", async (t) => {
  const f = await fixture(t);
  const file = path.join(f.b, "candidate.txt");
  fs.writeFileSync(file, "candidate\n");
  const preview = await prepareGitCommit(f.b, ["candidate.txt"], "whole-file");
  const selection = await selectGitProjectResources(f.b), before = git(f.b, "rev-parse", "HEAD");
  const operation = await beginSupervisedGitOperationIntent(selection, randomUUID(), "commit", f.agent);
  git(f.b, "worktree", "add", "-qb", "late-native-reuse", f.source);
  let callback = false;
  await assert.rejects(confirmGitCommit(preview, "candidate", async () => {
    callback = true;
    operation.assertOwned();
  }), /manual recovery/);
  assert.equal(callback, true);
  assert.equal(git(f.b, "rev-parse", "HEAD"), before);
  assert.equal(fs.readFileSync(file, "utf8"), "candidate\n");
  assert.equal(inspectGitOperationAdmission(f.agent, selection.commonDir).reason, "unresolved");
  assert.throws(() => operation.resolve(), /manual recovery/);
});

test("dangling journal symlinks and unreadable ancestors cannot look like absent history", async (t) => {
  for (const damaged of ["actions", "version", "inaccessible"]) {
    const f = await fixture(t), emptyAgent = path.join(f.root, `empty-${damaged}`);
    fs.mkdirSync(emptyAgent, { mode: 0o700 });
    const base = path.join(emptyAgent, "pi-web", "git-actions");
    const selected = await selectGitProjectResources(f.b);
    fs.mkdirSync(path.dirname(base), { mode: 0o700, recursive: true });
    if (damaged === "actions") fs.symlinkSync(path.join(f.root, "missing"), base);
    else {
      fs.mkdirSync(base, { mode: 0o700 });
      if (damaged === "version") fs.symlinkSync(path.join(f.root, "missing"), path.join(base, "v1"));
      else fs.chmodSync(base, 0o000);
    }
    try {
      if (damaged === "inaccessible" && process.getuid?.() === 0) continue;
      await assert.rejects(assertGitOperationAdmission(selected, emptyAgent), /manual recovery/, damaged);
      await assert.rejects(beginSupervisedGitOperationIntent(selected, randomUUID(), "commit", emptyAgent), /manual recovery/, damaged);
    } finally { if (damaged === "inaccessible") fs.chmodSync(base, 0o700); }
  }
});

test("admission listing parser refuses truncated, duplicate, ambiguous and oversized Git output", () => {
  const oid = "a".repeat(40), row = (cwd) => `worktree ${cwd}\0HEAD ${oid}\0branch refs/heads/main\0\0`;
  const a = path.resolve("/example/a"), b = path.resolve("/example/b");
  assert.deepEqual(parseBoundedGitWorktreePaths(Buffer.from(row(a) + row(b))), [a, b]);
  assert.deepEqual(parseBoundedGitWorktreePaths(Buffer.from(row(a) + row(b).replace("main", "topic-日本語"))), [a, b],
    "a distinct checkout's valid branch spelling is not path ambiguity");
  for (const bad of [
    Buffer.from(row(a) + row(a)),
    Buffer.from(row(a).slice(0, -1)),
    Buffer.from(row(a).replace("HEAD ", "unknown ")),
    Buffer.from(row(a).replace("branch refs/heads/main", "branch refs/heads/main\0branch refs/heads/other")),
    Buffer.from(`worktree ${a}\0HEAD ${oid}\0\0`), // bare two-field form is unsupported by the selector
    Buffer.from(Array.from({ length: 257 }, (_, i) => row(path.resolve(`/example/${i}`))).join("")),
    Buffer.alloc(128 * 1024 + 1, 0x78),
    Buffer.from([0xff, 0x00, 0x00]),
  ]) assert.throws(() => parseBoundedGitWorktreePaths(bad));
});

test("legacy path-only and incomplete/malformed v2 evidence cannot classify a deleted source as unrelated", async (t) => {
  const legacy = await fixture(t, 1);
  await assert.rejects(admission(legacy, legacy.a), /manual recovery/);
  await assert.rejects(admission(legacy, legacy.b), /manual recovery/);
  await assert.rejects(beginSupervisedGitOperationIntent(await selectGitProjectResources(legacy.b), legacy.action.id,
    "commit", legacy.agent), /manual recovery/, "the own-action ID is not a path-only quarantine exemption");
  git(legacy.b, "worktree", "add", "-qb", "reuse-v1", legacy.source);
  await assert.rejects(admission(legacy, legacy.a), /manual recovery/, "source reuse cannot admit original A");
  await assert.rejects(admission(legacy, legacy.b), /manual recovery/, "B primary contains reused secondary");
  assert.throws(restartAdmission(legacy, legacy.a));
  const unattributed = await fixture(t, 0);
  git(unattributed.b, "worktree", "add", "-qb", "reuse-legacy", unattributed.source);
  await assert.rejects(admission(unattributed, unattributed.a), /manual recovery/);
  await assert.rejects(admission(unattributed, unattributed.b), /manual recovery/);
  assert.throws(restartAdmission(unattributed, unattributed.a));
  for (const damage of ["missing-artifact", "incomplete-summary", "invalid-instance"]) {
    const f = await fixture(t);
    const dir = path.join(f.agent, "pi-web", "git-actions", "v1", f.action.id);
    if (damage === "missing-artifact") fs.unlinkSync(path.join(dir, "candidate.json"));
    else {
      const recordFile = path.join(dir, "record.json");
      const envelope = JSON.parse(fs.readFileSync(recordFile, "utf8"));
      if (damage === "incomplete-summary") delete envelope.record.summary.resourceAttribution.commonIdentity;
      else envelope.record.summary.resourceAttribution.commonIdentity.inode = "not-an-inode";
      // Even with a recomputed outer checksum, invalid summary/identity is not evidence.
      const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
        : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
          : JSON.stringify(v);
      const { createHash } = await import("node:crypto");
      envelope.sha256 = createHash("sha256").update(canonical(envelope.record)).digest("hex");
      fs.writeFileSync(recordFile, canonical(envelope));
    }
    await assert.rejects(admission(f, f.b), /manual recovery/, damage);
    assert.throws(restartAdmission(f, f.b), damage);
  }
});
