import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { beginGitOperationIntent: begin, inspectGitOperationAdmission: inspect,
  selectGitCommitAdmission, beginSupervisedGitCommitIntent, beginSupervisedGitOperationIntent,
  assertGitOperationAdmission, readUnresolvedGitCheckRecovery,
  resolveHumanReviewedGitCheck: recover } = await jiti.import("./git-operation-admission.ts");
const { createGitAction, transitionGitAction, releaseGitAction, readGitAction } = await jiti.import("./git-action-journal.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const cwd = fileURLToPath(new URL("..", import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "pi-web-admission-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const agent = path.join(root, "agent"), a = path.join(root, "repo-a.git"), b = path.join(root, "repo-b.git");
  for (const dir of [agent, a, b]) fs.mkdirSync(dir, { mode: 0o700 });
  return { root, agent, a, b, start: (resource = a, kind = "commit") => begin(agent, resource, randomUUID(), kind,
    kind === "checks" ? `pi-web-git-check-${randomUUID()}.service` : undefined) };
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const prepareProof = () => ({ version: 1, outcome: "completed", beforeOid: "a".repeat(40),
  afterOid: "b".repeat(40), resultTreeOid: "c".repeat(40) });
function snapshot(suffix = "original") {
  return { version: 1, ...Object.fromEntries(["featurePath", "targetPath", "featureIdentity", "targetIdentity",
    "resourceIdentity", "featureBranch", "targetBranch", "featureOid", "targetOid", "reviewDigest",
    "policyDigest", "checkDigest", "featureIndex", "targetIndex", "featureStatus", "targetStatus", "refs"]
    .map((key) => [key, digest(`${key}:${suffix}`)])) };
}
function checkFixture(t, options = {}) {
  const f = fixture(t), operation = f.start(f.a, "checks"), before = snapshot(), after = options.after ?? before;
  const invocation = "a".repeat(32);
  const proof = { unit: "", cgroupIdentity: `1:2:${invocation}:/check`,
    invocation, empty: true, emptyEvidence: "pinned-populated-zero", terminal: true, payload: "release-attempted" };
  // The exact unit is stored in the intent; proof for another unit must never settle it.
  const root = path.join(f.agent, "pi-web", "git-operation-admission", "v1");
  const dir = path.join(root, fs.readdirSync(root)[0]);
  const unit = JSON.parse(fs.readFileSync(path.join(dir, `${operation.id}.json`), "utf8")).record.checkUnit;
  proof.unit = unit;
  operation.recordCheckBefore(before);
  if (!options.noPost) operation.recordCheckAfter(after, proof, { status: 1, timedOut: false, overflow: false,
    containmentComplete: true, logDigest: digest("log"), finishedAt: Date.now(), ...options.outcome },
  options.source ?? "node-test-simulated");
  const receipt = { kind: "human-reviewed-git-check-recovery", id: operation.id, actionId: operation.actionId,
    resource: f.a, unit, proofIdentifier: invocation };
  const settle = () => recover(f.agent, f.a, operation.id, operation.actionId, after, invocation, receipt);
  return { ...f, dir, operation, unit, before, after, proof, invocation, receipt, settle };
}
function fresh(agent, resource) {
  const script = `const { createJiti } = require("jiti");
    (async () => {
      const { inspectGitOperationAdmission } = await createJiti(process.cwd() + "/lib/git-operation-admission.test.mjs").import("./git-operation-admission.ts");
      process.stdout.write(JSON.stringify(inspectGitOperationAdmission(process.argv[1], process.argv[2])));
    })().catch(e => { console.error(e); process.exitCode = 1; });`;
  return JSON.parse(execFileSync(process.execPath, ["-e", script, agent, resource], { cwd, encoding: "utf8" }));
}

test("human-reviewed failed check has a durable recovered disposition, not a passing receipt", (t) => {
  const f = checkFixture(t);
  assert.deepEqual(readUnresolvedGitCheckRecovery(f.agent, f.a).after, f.after);
  assert.equal(inspect(f.agent, f.a).reason, "unresolved");
  f.settle();
  const record = JSON.parse(fs.readFileSync(path.join(f.dir, `${f.operation.id}.json`), "utf8")).record;
  assert.equal(record.phase, "resolved");
  assert.equal(record.disposition, "recovered");
  assert.equal(record.kind, "checks");
  assert.equal(record.actionId, f.operation.actionId);
  assert.equal(record.checkUnit, f.unit);
  assert.equal(record.resolvedAt >= record.createdAt, true);
  assert.equal(fs.existsSync(path.join(f.dir, "reservation")), false);
  assert.deepEqual(fresh(f.agent, f.a), { admitted: true, reason: "clear", actionIds: [] });
  assert.throws(f.settle);
  assert.throws(() => f.operation.resolve());
  assert.throws(() => readUnresolvedGitCheckRecovery(f.agent, f.a));
  const second = f.start(); second.resolve();
  fs.unlinkSync(path.join(f.dir, `${f.operation.id}.post`));
  assert.equal(inspect(f.agent, f.a).reason, "unavailable", "recovered proof cannot disappear from settled history");
});

test("reviewed later Git state releases only the original failed check; mismatched identity, proof or review stays blocked", (t) => {
  const f = checkFixture(t);
  const original = Object.fromEntries(Object.entries(f.after).filter(([key]) => key !== "reviewDigest"));
  const current = { ...original, featureOid: digest("later feature"), refs: digest("later refs") };
  const receipt = { ...f.receipt, kind: "human-reviewed-git-check-recovery-moved",
    currentStateDigest: digest(JSON.stringify(current)), reviewedMovement: true };
  const attempt = (state, approval = receipt) => recover(f.agent, f.a, f.operation.id, f.operation.actionId,
    state, f.invocation, approval);
  for (const [state, approval] of [
    [current, { ...receipt, reviewedMovement: false }],
    [current, { ...receipt, currentStateDigest: digest("forged") }],
    [current, { ...receipt, unexpected: true }],
    [{ ...current, featureIdentity: digest("different worktree") }, receipt],
    [{ ...current, targetBranch: digest("different branch") }, receipt],
    [original, { ...receipt, currentStateDigest: digest(JSON.stringify(original)) }],
    [f.after, receipt],
  ]) {
    assert.throws(() => attempt(state, approval));
    assert.equal(inspect(f.agent, f.a).reason, "unresolved");
  }
  attempt(current);
  assert.equal(fresh(f.agent, f.a).reason, "clear");
  assert.throws(() => attempt(current), "review cannot be replayed");
  const resolved = JSON.parse(fs.readFileSync(path.join(f.dir, `${f.operation.id}.json`), "utf8")).record;
  assert.equal(resolved.disposition, "recovered");
  assert.equal(resolved.kind, "checks");
});

test("restart settles only the exact failed check with explicit test-only simulated proof", (t) => {
  const f = checkFixture(t);
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const m=await createJiti(process.cwd()+'/lib/git-operation-admission.test.mjs').import('./git-operation-admission.ts');
    m.resolveHumanReviewedGitCheck(...JSON.parse(process.argv[1]));
  })().catch(e=>{console.error(e);process.exitCode=1})`;
  const args = [f.agent, f.a, f.operation.id, f.operation.actionId, f.after, f.invocation, f.receipt];
  assert.throws(() => execFileSync(process.execPath, ["-e", script, JSON.stringify(args)],
    { cwd, env: { ...process.env, NODE_TEST_CONTEXT: "" }, stdio: "pipe" }));
  assert.equal(fresh(f.agent, f.a).reason, "unresolved");
  execFileSync(process.execPath, ["-e", script, JSON.stringify(args)],
    { cwd, env: { ...process.env, NODE_TEST_CONTEXT: "1" }, stdio: "pipe" });
  assert.equal(fresh(f.agent, f.a).admitted, true);
});

test("linux-systemd cleanup evidence can settle without test context", (t) => {
  const f = checkFixture(t, { source: "linux-systemd", outcome: { status: null, timedOut: true,
    containmentComplete: false } });
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const m=await createJiti(process.cwd()+'/lib/git-operation-admission.test.mjs').import('./git-operation-admission.ts');
    m.resolveHumanReviewedGitCheck(...JSON.parse(process.argv[1]));
  })().catch(e=>{console.error(e);process.exitCode=1})`;
  execFileSync(process.execPath, ["-e", script, JSON.stringify([f.agent, f.a, f.operation.id,
    f.operation.actionId, f.after, f.invocation, f.receipt])],
  { cwd, env: { ...process.env, NODE_TEST_CONTEXT: "" }, stdio: "pipe" });
  assert.equal(fresh(f.agent, f.a).admitted, true);
});

test("mismatched snapshot, action, resource, unit, proof or review receipt never releases the check", (t) => {
  const f = checkFixture(t), call = (id, action, snap, proof, receipt, resource = f.a) =>
    recover(f.agent, resource, id, action, snap, proof, receipt);
  const original = f.receipt;
  for (const attempt of [
    () => call(f.operation.id, f.operation.actionId, snapshot("changed"), f.invocation, original),
    () => call(f.operation.id, randomUUID(), f.after, f.invocation, original),
    () => call(randomUUID(), f.operation.actionId, f.after, f.invocation, original),
    () => call(f.operation.id, f.operation.actionId, f.after, f.invocation, { ...original, actionId: randomUUID() }),
    () => call(f.operation.id, f.operation.actionId, f.after, f.invocation, { ...original, unit: `pi-web-git-check-${randomUUID()}.service` }),
    () => call(f.operation.id, f.operation.actionId, f.after, f.invocation, { ...original, resource: f.b }),
    () => call(f.operation.id, f.operation.actionId, f.after, "b".repeat(32), original),
    () => call(f.operation.id, f.operation.actionId, f.after, f.invocation, { ...original, proofIdentifier: "b".repeat(32) }),
    () => call(f.operation.id, f.operation.actionId, f.after, f.invocation, { ...original, approved: true }),
    () => call(f.operation.id, f.operation.actionId, f.after, f.invocation, original, f.b),
  ]) {
    assert.throws(attempt);
    assert.equal(inspect(f.agent, f.a).reason, "unresolved");
  }
  f.settle();
});

test("missing, extra, corrupt proof and an orphan or replaced reservation fail closed", (t) => {
  for (const damage of [
    (f) => fs.unlinkSync(path.join(f.dir, `${f.operation.id}.pre`)),
    (f) => fs.unlinkSync(path.join(f.dir, `${f.operation.id}.post`)),
    (f) => fs.writeFileSync(path.join(f.dir, `${f.operation.id}.post`), "{}"),
    (f) => {
      const postFile = path.join(f.dir, `${f.operation.id}.post`);
      const envelope = JSON.parse(fs.readFileSync(postFile, "utf8"));
      envelope.record.preSha256 = "f".repeat(64);
      envelope.sha256 = digest(JSON.stringify(envelope.record));
      fs.writeFileSync(postFile, JSON.stringify(envelope));
    },
    (f) => fs.unlinkSync(path.join(f.dir, `${f.operation.id}.json`)),
    (f) => fs.writeFileSync(path.join(f.dir, "extra"), ""),
    (f) => {
      const otherId = randomUUID(), record = { version: 1, id: otherId, actionId: randomUUID(), kind: "commit",
        resource: f.a, phase: "intent", createdAt: Date.now() };
      fs.writeFileSync(path.join(f.dir, `${otherId}.json`), JSON.stringify({ version: 1, record,
        sha256: digest(JSON.stringify(record)) }), { mode: 0o600 });
    },
    (f) => fs.writeFileSync(path.join(f.dir, "reservation", "owner"), `${f.operation.id}:malformed`),
    (f) => fs.unlinkSync(path.join(f.dir, "reservation", "owner")),
    (f) => fs.writeFileSync(path.join(f.dir, "reservation", "owner"), `${randomUUID()}:${randomUUID()}`),
  ]) {
    const f = checkFixture(t); damage(f);
    assert.throws(f.settle);
    assert.notEqual(inspect(f.agent, f.a).reason, "clear");
  }
});

test("cancelled check with incomplete outcome but proven empty terminal unit can be recovered, never passed", (t) => {
  const f = checkFixture(t, { outcome: { status: null, timedOut: true, containmentComplete: false } });
  f.settle();
  assert.equal(inspect(f.agent, f.a).admitted, true);
  const outcome = JSON.parse(fs.readFileSync(path.join(f.dir, `${f.operation.id}.post`), "utf8")).record.outcome;
  assert.equal(outcome.status, null);
  assert.equal(outcome.containmentComplete, false);
  const missing = checkFixture(t, { outcome: { status: null, timedOut: true, containmentComplete: false } });
  const postFile = path.join(missing.dir, `${missing.operation.id}.post`);
  const envelope = JSON.parse(fs.readFileSync(postFile, "utf8"));
  delete envelope.record.cleanupProof;
  envelope.sha256 = digest(JSON.stringify(envelope.record));
  fs.writeFileSync(postFile, JSON.stringify(envelope));
  assert.throws(missing.settle, "missing cleanup proof must block even on cancellation");
  assert.equal(inspect(missing.agent, missing.a).reason, "unavailable");
});

test("not a generic clear: changed pre/post, nonfailed outcome, or missing post is denied", (t) => {
  for (const options of [
    { after: snapshot("changed") },
    { outcome: { status: 0 } },
    { noPost: true },
  ]) {
    const f = checkFixture(t, options);
    assert.throws(f.settle);
    assert.equal(inspect(f.agent, f.a).reason, "unresolved");
  }
});

test("publication and release failures never clear the gate prematurely or permit retry", (t) => {
  for (const [method, failAt] of [["renameSync", 1], ["fsyncSync", 2], ["fsyncSync", 3],
    ["rmdirSync", 1]]) {
    const f = checkFixture(t), original = fs[method];
    let calls = 0;
    try {
      fs[method] = (...args) => { if (++calls === failAt) throw new Error("injected recovery failure");
        return original(...args); };
      assert.throws(f.settle, /injected recovery failure/, `${method}:${failAt} calls=${calls}`);
    } finally { fs[method] = original; }
    assert.notEqual(inspect(f.agent, f.a).reason, "clear");
    if (method !== "renameSync") assert.throws(f.settle, "published recovery cannot be retried");
    else {
      assert.equal(fs.existsSync(path.join(f.dir, "reservation", "owner")), true);
      assert.equal(readUnresolvedGitCheckRecovery(f.agent, f.a).id, f.operation.id);
    }
  }
});

test("durable intent blocks only the selected physical resource, even after a process exit", (t) => {
  const f = fixture(t), operation = f.start();
  assert.deepEqual(inspect(f.agent, f.a), { admitted: false, reason: "unresolved", actionIds: [operation.actionId] });
  assert.deepEqual(fresh(f.agent, f.a), inspect(f.agent, f.a));
  assert.deepEqual(inspect(f.agent, f.b), { admitted: true, reason: "clear", actionIds: [] });
  assert.throws(() => f.start(), /unavailable|EEXIST/);
  operation.resolve();
  assert.deepEqual(fresh(f.agent, f.a), { admitted: true, reason: "clear", actionIds: [] });
  assert.throws(() => operation.resolve(), /unavailable/);
  const second = f.start();
  assert.notEqual(second.id, operation.id);
  assert.equal(inspect(f.agent, f.a).admitted, false);
  second.resolve();
  const dir = path.join(f.agent, "pi-web", "git-operation-admission", "v1");
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(fs.readdirSync(path.join(dir, fs.readdirSync(dir)[0])).length, 2);
});

test("an intent created by an exited process remains unresolved without adopting its action", (t) => {
  const f = fixture(t);
  const script = `const { createJiti } = require("jiti");
    (async () => { const { beginGitOperationIntent } = await createJiti(process.cwd() + "/lib/git-operation-admission.test.mjs").import("./git-operation-admission.ts");
      beginGitOperationIntent(process.argv[1], process.argv[2], process.argv[3], "checks", process.argv[4]);
    })().catch(e => { console.error(e); process.exitCode = 1; });`;
  const actionId = randomUUID();
  execFileSync(process.execPath, ["-e", script, f.agent, f.a, actionId, `pi-web-git-check-${randomUUID()}.service`], { cwd });
  assert.deepEqual(fresh(f.agent, f.a), { admitted: false, reason: "unresolved", actionIds: [actionId] });
  assert.throws(() => f.start(), /unavailable|EEXIST/);
});

test("prepare is a supervised, repository-scoped intent; read-only preflight cannot release it", async (t) => {
  const f = fixture(t), repo = path.join(f.root, "repo");
  execFileSync("git", ["init", "-qb", "main", repo]);
  const git = (...args) => execFileSync("git", ["-C", repo, "-c", "user.name=Tester",
    "-c", "user.email=test@example.invalid", "-c", "core.hooksPath=/dev/null", ...args], { encoding: "utf8" }).trim();
  git("commit", "--allow-empty", "-qm", "base");
  git("switch", "-qc", "feature");
  fs.writeFileSync(path.join(repo, "feature.txt"), "feature\n");
  git("add", "feature.txt");
  git("commit", "-qm", "feature");
  git("switch", "-q", "main");
  fs.writeFileSync(path.join(repo, "upstream.txt"), "upstream\n");
  git("add", "upstream.txt");
  git("commit", "-qm", "upstream");
  git("switch", "-q", "feature");
  allowFileRoot(repo);
  const selection = await selectGitProjectResources(repo);
  const beforeOid = git("rev-parse", "HEAD");
  await assertGitOperationAdmission(selection, f.agent);
  const operation = await beginSupervisedGitOperationIntent(selection, randomUUID(), "prepare", f.agent);
  assert.equal(inspect(f.agent, selection.commonDir).reason, "unresolved");
  assert.deepEqual(fresh(f.agent, selection.commonDir).actionIds, [operation.actionId]);
  operation.assertOwned();
  await assert.rejects(assertGitOperationAdmission(selection, f.agent), /manual recovery/);
  for (const kind of ["commit", "checks", "integration", "prepare"]) {
    await assert.rejects(beginSupervisedGitOperationIntent(selection, randomUUID(), kind, f.agent,
      kind === "checks" ? `pi-web-git-check-${randomUUID()}.service` : undefined), /manual recovery/);
  }
  assert.throws(() => f.start(selection.commonDir, "commit"));
  const other = f.start(f.b, "commit"); other.resolve();
  const dir = path.join(f.agent, "pi-web", "git-operation-admission", "v1", digest(selection.commonDir));
  const record = JSON.parse(fs.readFileSync(path.join(dir, `${operation.id}.json`), "utf8")).record;
  assert.equal(record.kind, "prepare");
  assert.equal(record.phase, "intent");
  assert.equal(Object.hasOwn(record, "prepareOutcome"), false);
  // Preflight/plan values (and a positive read-only inspection elsewhere) are
  // not outcome proof. No native prepare operation has been performed here.
  assert.throws(() => operation.resolve());
  for (const invalid of [{ ...prepareProof(), outcome: "planned" },
    { ...prepareProof(), afterOid: "bad" }, { ...prepareProof(), extra: true },
    { ...prepareProof(), resultTreeOid: "c".repeat(64) }]) assert.throws(() => operation.resolve(invalid));
  assert.equal(fresh(f.agent, selection.commonDir).reason, "unresolved");
  // Disposable native execution is test-only: the ledger exposes no rebase.
  git("rebase", "main");
  const afterOid = git("rev-parse", "HEAD"), resultTreeOid = git("rev-parse", "HEAD^{tree}");
  assert.notEqual(afterOid, beforeOid);
  assert.equal(git("status", "--porcelain"), "");
  for (const marker of ["rebase-merge", "rebase-apply"]) {
    assert.equal(fs.existsSync(git("rev-parse", "--path-format=absolute", "--git-path", marker)), false);
  }
  const proof = { version: 1, outcome: "completed", beforeOid, afterOid, resultTreeOid };
  operation.resolve(proof);
  assert.equal(fs.existsSync(path.join(dir, "reservation")), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, `${operation.id}.json`), "utf8")).record.prepareOutcome, proof);
  assert.deepEqual(fresh(f.agent, selection.commonDir), { admitted: true, reason: "clear", actionIds: [] });
  await assertGitOperationAdmission(selection, f.agent);
  assert.throws(() => operation.resolve(proof));
  const check = f.start(selection.commonDir, "checks");
  assert.throws(() => check.resolve(proof), "a prepare outcome cannot settle a check");
});

test("prepare corrupt history, extra entries and orphaned reservations remain quarantined", (t) => {
  for (const damage of [
    (f, operation, dir) => fs.writeFileSync(path.join(dir, `${operation.id}.json`), "{}"),
    (f, operation, dir) => {
      const file = path.join(dir, `${operation.id}.json`), envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      envelope.record.prepareOutcome = prepareProof(); // intent cannot have outcome, even with a valid checksum
      envelope.sha256 = digest(JSON.stringify(envelope.record));
      fs.writeFileSync(file, JSON.stringify(envelope));
    },
    (f, operation, dir) => {
      const file = path.join(dir, `${operation.id}.json`), envelope = JSON.parse(fs.readFileSync(file, "utf8"));
      envelope.record.kind = "future";
      envelope.sha256 = digest(JSON.stringify(envelope.record));
      fs.writeFileSync(file, JSON.stringify(envelope));
    },
    (f, operation, dir) => fs.writeFileSync(path.join(dir, "unknown"), ""),
    (f, operation, dir) => fs.unlinkSync(path.join(dir, `${operation.id}.json`)),
    (f, operation, dir) => fs.writeFileSync(path.join(dir, "reservation", "owner"), `${randomUUID()}:${randomUUID()}`),
    (f, operation, dir) => fs.rmSync(path.join(dir, "reservation"), { recursive: true }),
  ]) {
    const f = fixture(t), operation = f.start(f.a, "prepare");
    const dir = path.join(f.agent, "pi-web", "git-operation-admission", "v1", digest(f.a));
    damage(f, operation, dir);
    assert.notEqual(fresh(f.agent, f.a).reason, "clear");
    assert.throws(() => operation.resolve(prepareProof()));
    assert.throws(() => f.start(f.a, "commit"));
  }
  const f = fixture(t), operation = f.start(f.a, "prepare"), dir = path.join(f.agent,
    "pi-web", "git-operation-admission", "v1", digest(f.a));
  operation.resolve(prepareProof());
  const file = path.join(dir, `${operation.id}.json`), envelope = JSON.parse(fs.readFileSync(file, "utf8"));
  delete envelope.record.prepareOutcome; // resolved preparation without outcome is not valid legacy history
  envelope.sha256 = digest(JSON.stringify(envelope.record));
  fs.writeFileSync(file, JSON.stringify(envelope));
  assert.equal(fresh(f.agent, f.a).reason, "unavailable");
  assert.throws(() => f.start(f.a, "integration"));
});

test("preparation started by an exited process is not adopted on restart", (t) => {
  const f = fixture(t), actionId = randomUUID();
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const m=await createJiti(process.cwd()+'/lib/git-operation-admission.test.mjs').import('./git-operation-admission.ts');
    m.beginGitOperationIntent(process.argv[1], process.argv[2], process.argv[3], 'prepare');
  })().catch(e=>{console.error(e);process.exitCode=1})`;
  execFileSync(process.execPath, ["-e", script, f.agent, f.a, actionId], { cwd });
  assert.deepEqual(fresh(f.agent, f.a), { admitted: false, reason: "unresolved", actionIds: [actionId] });
  for (const kind of ["commit", "checks", "integration", "prepare"]) {
    assert.throws(() => begin(f.agent, f.a, randomUUID(), kind,
      kind === "checks" ? `pi-web-git-check-${randomUUID()}.service` : undefined));
  }
  assert.equal(inspect(f.agent, f.b).admitted, true);
});

test("historical declined previews without artifacts do not quarantine an unrelated safe commit", async (t) => {
  const f = fixture(t), oldAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.agent;
  t.after(() => { if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgent; });
  const repo = path.join(f.root, "git-repo"); fs.mkdirSync(repo);
  execFileSync("git", ["init", "-qb", "main", repo]);
  execFileSync("git", ["-C", repo, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid",
    "commit", "--allow-empty", "-qm", "base"]);
  allowFileRoot(repo);
  const selected = await selectGitCommitAdmission(repo);
  const candidate = { kind: "commit", repositoryRoot: repo, message: "never committed", paths: ["file.txt"],
    parentOid: "a".repeat(40), candidateTreeOid: "b".repeat(40) };
  const old = await createGitAction({ sessionId: "historic", source: "human", candidate }, f.agent);
  const awaiting = await transitionGitAction(old.id, old.revision, { state: "awaiting-decision" }, f.agent);
  await transitionGitAction(old.id, awaiting.revision, { state: "declined", decision: "declined" }, f.agent);
  releaseGitAction(old.id, f.agent);
  fs.unlinkSync(path.join(f.agent, "pi-web", "git-actions", "v1", old.id, "candidate.json"));
  await assertGitOperationAdmission(selected, f.agent);
  const operation = await beginSupervisedGitCommitIntent(selected, randomUUID());
  assert.equal(inspect(f.agent, selected.commonDir).reason, "unresolved");
  await assert.rejects(assertGitOperationAdmission(selected, f.agent), /manual recovery/);
  operation.resolve();
  assert.equal(inspect(f.agent, selected.commonDir).admitted, true);
  await assertGitOperationAdmission(selected, f.agent);
  const check = await beginSupervisedGitOperationIntent(selected, randomUUID(), "checks", f.agent,
    `pi-web-git-check-${randomUUID()}.service`);
  await assert.rejects(beginSupervisedGitCommitIntent(selected, randomUUID()), /manual recovery/);
  assert.equal(fresh(f.agent, selected.commonDir).reason, "unresolved");
  assert.throws(() => check.resolve(), /unavailable|ENOENT/);
  await assert.rejects(assertGitOperationAdmission(selected, f.agent), /manual recovery/);
});

test("many settled historical actions across projects cannot impose a global 1024-card admission cap", { timeout: 90_000 }, async (t) => {
  const f = fixture(t), other = path.join(f.root, "git-repo");
  const oldAgent = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = f.agent;
  t.after(() => { if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgent; });
  fs.mkdirSync(other);
  execFileSync("git", ["init", "-qb", "main", other]);
  execFileSync("git", ["-C", other, "-c", "user.name=Tester", "-c", "user.email=test@example.invalid",
    "commit", "--allow-empty", "-qm", "base"]);
  allowFileRoot(other);
  const selected = await selectGitCommitAdmission(other);
  const candidate = { kind: "commit", repositoryRoot: f.a, message: "declined", paths: ["file"],
    parentOid: "a".repeat(40), candidateTreeOid: "b".repeat(40) };
  for (let i = 0; i < 1025; i++) {
    const action = await createGitAction({ sessionId: "historic", source: "human", candidate }, f.agent);
    const awaiting = await transitionGitAction(action.id, action.revision, { state: "awaiting-decision" }, f.agent);
    await transitionGitAction(action.id, awaiting.revision, { state: "declined", decision: "declined" }, f.agent);
    releaseGitAction(action.id, f.agent);
  }
  const actions = fs.readdirSync(path.join(f.agent, "pi-web", "git-actions", "v1"));
  assert.equal(actions.length, 1025);
  for (const id of actions) assert.equal((await readGitAction(id, { includeArtifact: true }, f.agent)).record?.state, "declined");
  await assertGitOperationAdmission(selected, f.agent);
});

test("stale reservation with resolved document, absent document, and incomplete operation are NOT reaped", (t) => {
  const f = fixture(t), operation = f.start();
  const dir = path.join(f.agent, "pi-web", "git-operation-admission", "v1", fs.readdirSync(path.join(f.agent, "pi-web", "git-operation-admission", "v1"))[0]);
  assert.equal(fresh(f.agent, f.a).reason, "unresolved");
  assert.throws(() => f.start(), /unavailable|EEXIST/);
  operation.resolve();
  fs.mkdirSync(path.join(dir, "reservation"), { mode: 0o700 });
  assert.deepEqual(fresh(f.agent, f.a), { admitted: false, reason: "unresolved", actionIds: [] });
  assert.throws(() => f.start(), /unavailable|EEXIST/);
  fs.rmdirSync(path.join(dir, "reservation")); // maintenance simulation, not exposed by the service
  const next = f.start();
  const file = path.join(dir, `${next.id}.json`);
  fs.unlinkSync(file);
  assert.equal(fresh(f.agent, f.a).reason, "unresolved");
  assert.throws(() => next.resolve(), /ENOENT/);
});

test("unrecognized, corrupt, symlinked, oversized or excess entries deny without rewriting evidence", (t) => {
  const oldLimit = process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT;
  process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT = "32";
  t.after(() => { if (oldLimit === undefined) delete process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT;
    else process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT = oldLimit; });
  const f = fixture(t), first = f.start(); first.resolve();
  const dir = path.join(f.agent, "pi-web", "git-operation-admission", "v1", fs.readdirSync(path.join(f.agent, "pi-web", "git-operation-admission", "v1"))[0]);
  const file = path.join(dir, `${first.id}.json`), original = fs.readFileSync(file);
  const check = () => { assert.equal(inspect(f.agent, f.a).reason, "unavailable"); assert.throws(() => f.start()); };
  for (const value of ["{}", original.toString().replace("resolved", "intent  "), "x".repeat(4097)]) {
    fs.writeFileSync(file, value); check(); assert.equal(fs.readFileSync(file, "utf8"), value);
  }
  fs.unlinkSync(file); fs.symlinkSync(path.join(f.root, "external"), file); check();
  fs.unlinkSync(file); fs.writeFileSync(file, original);
  fs.writeFileSync(path.join(dir, "alien"), "{}"); check(); fs.unlinkSync(path.join(dir, "alien"));
  for (let i = 0; i < 32; i++) fs.writeFileSync(path.join(dir, `${randomUUID()}.json`), "{}");
  check();
});

test("the ledger is bounded; exhaustion denies before creating an orphan reservation", (t) => {
  const oldLimit = process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT;
  process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT = "32";
  t.after(() => { if (oldLimit === undefined) delete process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT;
    else process.env.PI_WEB_GIT_ADMISSION_TEST_LIMIT = oldLimit; });
  const f = fixture(t);
  fs.chmodSync(f.a, 0o755); // ordinary Git common dirs need not be private
  for (let i = 0; i < 31; i++) f.start().resolve();
  assert.deepEqual(inspect(f.agent, f.a), { admitted: true, reason: "clear", actionIds: [] });
  assert.throws(() => f.start(), /unavailable/);
  assert.deepEqual(inspect(f.agent, f.a), { admitted: true, reason: "clear", actionIds: [] }); // no orphan on pre-launch exhaustion
});

test("a stale handle cannot resolve a different reservation at the same path", (t) => {
  const f = fixture(t), first = f.start();
  const dir = path.join(f.agent, "pi-web", "git-operation-admission", "v1", fs.readdirSync(path.join(f.agent, "pi-web", "git-operation-admission", "v1"))[0]);
  const gate = path.join(dir, "reservation");
  fs.rmSync(gate, { recursive: true }); // simulate outside replacement (not service behavior)
  fs.mkdirSync(gate, { mode: 0o700 });
  fs.writeFileSync(path.join(gate, "owner"), `${randomUUID()}:${randomUUID()}`, { mode: 0o600 });
  assert.throws(() => first.resolve(), /unavailable/);
  assert.equal(fs.existsSync(gate), true);
  assert.deepEqual(inspect(f.agent, f.a).actionIds, [first.actionId]);
});

test("physical resource aliases, unsafe path components and invalid IDs do not create admission evidence", (t) => {
  const f = fixture(t), alias = path.join(f.root, "alias"); fs.symlinkSync(f.a, alias);
  assert.equal(inspect(f.agent, alias).reason, "unavailable");
  assert.throws(() => begin(f.agent, alias, randomUUID(), "commit"));
  assert.throws(() => begin(f.agent, f.a, "../escape", "commit"));
  assert.throws(() => begin(f.agent, f.a, randomUUID(), "future"));
  assert.throws(() => begin(f.agent, f.a, randomUUID(), "checks"), /unavailable/);
  assert.equal(fs.existsSync(path.join(f.agent, "pi-web")), false);
  const danger = path.join(f.agent, "pi-web"); fs.symlinkSync(f.a, danger);
  assert.equal(inspect(f.agent, f.a).reason, "unavailable");
  assert.throws(() => f.start());
});

test("publication errors never return an executable reservation; an orphaned exclusive gate denies", (t) => {
  const f = fixture(t);
  const link = fs.linkSync;
  try { fs.linkSync = () => { throw new Error("injected link failure"); };
    assert.throws(() => f.start(), /injected link failure/);
  } finally { fs.linkSync = link; }
  assert.deepEqual(inspect(f.agent, f.a), { admitted: false, reason: "unresolved", actionIds: [] });
  assert.throws(() => f.start(), /unavailable|EEXIST/);
});
