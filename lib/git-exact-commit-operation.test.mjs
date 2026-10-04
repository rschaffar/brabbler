import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { captureExactCommitCandidate, applyExactCommitOperation, gitExactCommitInvocationBinding, GitExactCommitCompletionError } = await jiti.import("./git-exact-commit-operation.ts");
const { readGitCommitNativeCompletion, readGitCommitProtectedBoundary, GitCommitOperationError } = await jiti.import("./git-commit.ts");
const { captureGitInvocation, assertGitInvocationCurrentSync } = await jiti.import("./git-invocation.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const exec = promisify(execFile);
async function git(cwd, ...args) { return (await exec("git", ["-C", cwd, ...args])).stdout.trim(); }
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-exact-invocation-")), dir = path.join(root, "repo"), agentDir = path.join(root, "agent");
  const env = { HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), GIT_CONFIG_GLOBAL: path.join(root, "no-global"),
    GIT_CONFIG_NOSYSTEM: "1", PI_CODING_AGENT_DIR: agentDir };
  const prior = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]])); Object.assign(process.env, env);
  t.after(async () => { for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  } await rm(root, { recursive: true, force: true }); });
  await mkdir(agentDir, { mode: 0o700 }); await mkdir(path.join(root, "template"));
  await exec("git", ["init", "-qb", "main", `--template=${path.join(root, "template")}`, dir]);
  await git(dir, "config", "user.name", "Fixture"); await git(dir, "config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(dir, "file"), "before\n"); await git(dir, "add", "."); await git(dir, "commit", "-qm", "base");
  allowFileRoot(dir);
  return { root, dir, agentDir };
}
async function candidate(f, message = "candidate") {
  await writeFile(path.join(f.dir, "file"), `${message}\n`);
  const captured = await captureExactCommitCandidate(f.dir, ["file"], message, "whole-file");
  assert.equal(captured.verification.summary.status, "no-defined"); // Real discovery; no fake receipt reader.
  const selection = await selectGitProjectResources(f.dir);
  const owner = { sessionId: "fixture-session", sessionFile: path.join(f.root, "session.jsonl"), generation: randomUUID() };
  const authority = { revision: 0, active: true };
  const binding = gitExactCommitInvocationBinding(selection, captured.preview, message, owner);
  const invocation = { owner, handle: captureGitInvocation(binding, {
    readAuthorityRevisionSync: () => String(authority.revision),
    assertCurrentSync(actual) { assert.equal(authority.active, true); assert.deepEqual(actual.owner, owner); },
  }) };
  const updates = [], record = { id: randomUUID(), sessionId: owner.sessionId, state: "executing" };
  const handle = { record, async update(state) { updates.push(state); record.state = state; }, release() {} };
  const options = { handle, preview: captured.preview, message, selection, invocation, agentDir: f.agentDir,
    verificationHandle: captured.verification.handle,
    async beforeApply(boundary) {
      if (boundary) assert.ok(readGitCommitProtectedBoundary(boundary, selection, f.agentDir));
      return () => { assert.equal(authority.active, true); };
    },
    async finish(result) { return result; },
  };
  return { options, binding, authority, updates };
}

test("exact adapter ignores corrupt old history and optional recording failure, retaining authentic success", async (t) => {
  const f = await fixture(t), c = await candidate(f);
  const resourceKey = createHash("sha256").update(c.options.selection.commonDir).digest("hex");
  const ledger = path.join(f.agentDir, "pi-web", "git-operation-admission", "v1", resourceKey);
  await mkdir(path.join(ledger, "reservation"), { recursive: true });
  await writeFile(path.join(ledger, "reservation", "owner"), "unfinished old owner");
  await writeFile(path.join(ledger, "corrupt.json"), "old failed state");
  const history = path.join(f.agentDir, "pi-web", "git-actions", "v1", randomUUID());
  await mkdir(history, { recursive: true }); await writeFile(path.join(history, "record.json"), "unreadable");
  let warnings = 0, finished = 0;
  c.options.handle.update = async () => { throw new Error("optional storage unavailable"); };
  c.options.record = async () => { throw new Error("optional completion storage unavailable"); };
  c.options.onRecordingUnavailable = () => { warnings++; };
  c.options.finish = async (result) => { finished++; return result; };
  const result = await applyExactCommitOperation(c.options);
  assert.equal(result.status, "committed"); assert.equal(finished, 1); assert.equal(warnings, 2);
  assert.equal(readGitCommitNativeCompletion(result, c.options.invocation.handle), result);
  assert.equal(await git(f.dir, "rev-parse", "HEAD"), result.commit);
  assert.throws(() => assertGitInvocationCurrentSync(c.options.invocation.handle, c.binding), /retired/);
  await assert.rejects(readFile(path.join(f.dir, ".git", "index.lock")), { code: "ENOENT" });
  const next = await candidate(f, "independent new approval");
  assert.equal((await applyExactCommitOperation(next.options)).status, "committed");
  assert.equal(await readFile(path.join(ledger, "reservation", "owner"), "utf8"), "unfinished old owner");
  assert.equal(await readFile(path.join(ledger, "corrupt.json"), "utf8"), "old failed state");
  assert.equal(await readFile(path.join(history, "record.json"), "utf8"), "unreadable");
});

test("essential finish failure propagates with original native completion, not fabricated uncertainty", async (t) => {
  const f = await fixture(t), c = await candidate(f), cause = new Error("essential orchestration refused");
  let original;
  c.options.finish = async (result) => { original = result; throw cause; };
  await assert.rejects(applyExactCommitOperation(c.options), (error) => {
    assert.ok(error instanceof GitExactCommitCompletionError);
    assert.equal(error.cause, cause); assert.equal(error.completion, original);
    assert.equal(readGitCommitNativeCompletion(error.completion, c.options.invocation.handle), original);
    assert.equal(readGitCommitNativeCompletion({ ...error.completion }, c.options.invocation.handle), undefined);
    return true;
  });
  assert.equal(original.status, "committed");
  assert.equal(await git(f.dir, "rev-parse", "HEAD"), original.commit);
  assert.equal(c.updates.includes("recovery-required"), false);
  const next = await candidate(f, "after finish failure");
  assert.equal((await applyExactCommitOperation(next.options)).status, "committed");
});

for (const wrong of ["copied-handle", "owner", "candidate", "missing"]) test(`exact adapter refuses ${wrong} authority before native effects`, async (t) => {
  const f = await fixture(t), c = await candidate(f), before = await readFile(path.join(f.dir, ".git", "index"));
  const head = c.options.preview.head;
  if (wrong === "copied-handle") c.options.invocation.handle = { ...c.options.invocation.handle };
  if (wrong === "owner") c.options.invocation.owner = { ...c.options.invocation.owner, generation: "new-instance" };
  if (wrong === "candidate") c.options.message = "not approved";
  if (wrong === "missing") delete c.options.invocation;
  await assert.rejects(applyExactCommitOperation(c.options), /invocation|binding|handle/i);
  assert.equal(await git(f.dir, "rev-parse", "HEAD"), head);
  assert.deepEqual(await readFile(path.join(f.dir, ".git", "index")), before);
  await assert.rejects(readFile(path.join(f.dir, ".git", "index.lock")), { code: "ENOENT" });
});

test("both exact boundary hooks accept synchronous undefined and retain authentic native success", async (t) => {
  const f = await fixture(t), c = await candidate(f), seen = [];
  c.options.beforeRefUpdate = (operation) => { operation.assertOwned(); seen.push("beforeRefUpdate"); };
  c.options.atRefBoundary = () => { seen.push("atRefBoundary"); };
  const result = await applyExactCommitOperation(c.options);
  assert.deepEqual(seen, ["beforeRefUpdate", "atRefBoundary"]);
  assert.equal(result.status, "committed");
  assert.equal(readGitCommitNativeCompletion(result, c.options.invocation.handle), result);
});

for (const hook of ["beforeRefUpdate", "atRefBoundary"]) for (const kind of ["Promise", "thenable"])
  for (const disposition of ["return", "throw"])
    test(`${hook} refuses and drains ${disposition}ed pending ${kind} without CAS`, { timeout: 15000 }, async (t) => {
      const f = await fixture(t), c = await candidate(f), indexPath = path.join(f.dir, ".git", "index");
      const before = await readFile(indexPath), head = c.options.preview.head;
      let rejectPending, payload, called = false, finished = false, assimilations = 0;
      c.options.finish = async (result) => { finished = true; return result; };
      c.options[hook] = () => {
        called = true;
        payload = kind === "Promise" ? new Promise((_resolve, reject) => { rejectPending = reject; }) : {
          then(_resolve, reject) { assimilations++; rejectPending = reject; },
        };
        if (disposition === "throw") throw payload;
        return payload;
      };
      try {
        // The callback stays pending until AFTER the operation refuses. Awaiting
        // it, ignoring it, or proceeding with CAS must all fail this fixture.
        await assert.rejects(applyExactCommitOperation(c.options), (error) => {
          assert.ok(error instanceof GitCommitOperationError);
          if (disposition === "throw") assert.equal(error.cause, payload);
          else assert.match(error.message, /guard must be synchronous/);
          return true;
        });
        assert.equal(called, true); assert.equal(finished, false);
        assert.equal(typeof rejectPending, "function", "thenables must be assimilated for rejection drainage");
        if (kind === "thenable") assert.equal(assimilations, 1);
        assert.equal(await git(f.dir, "rev-parse", "HEAD"), head);
        assert.deepEqual(await readFile(indexPath), before);
        await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
        assert.equal(c.updates.includes("recovery-required"), false);
        assert.throws(() => assertGitInvocationCurrentSync(c.options.invocation.handle, c.binding), /retired/);
      } finally {
        // node:test fails on unhandled rejections: both returned and thrown
        // pending values must already have a drain handler installed.
        rejectPending?.(new Error("delayed callback rejection"));
        await new Promise((resolve) => setImmediate(resolve));
      }
    });

for (const hook of ["beforeRefUpdate", "atRefBoundary"]) test(`${hook} refuses non-undefined synchronous results`, async (t) => {
  const f = await fixture(t), c = await candidate(f), indexPath = path.join(f.dir, ".git", "index");
  const before = await readFile(indexPath);
  c.options[hook] = () => true;
  await assert.rejects(applyExactCommitOperation(c.options), /guard must be synchronous/);
  assert.equal(await git(f.dir, "rev-parse", "HEAD"), c.options.preview.head);
  assert.deepEqual(await readFile(indexPath), before);
  await assert.rejects(readFile(`${indexPath}.lock`), { code: "ENOENT" });
});

test("late own authority refusal is never swallowed as optional diagnostics", async (t) => {
  const f = await fixture(t), c = await candidate(f), head = c.options.preview.head;
  c.options.beforeApply = async (boundary) => {
    if (boundary) { c.authority.active = false; c.authority.revision++; throw new Error("own authorization revoked"); }
  };
  await assert.rejects(applyExactCommitOperation(c.options), /own authorization revoked/);
  assert.equal(await git(f.dir, "rev-parse", "HEAD"), head);
  await assert.rejects(readFile(path.join(f.dir, ".git", "index.lock")), { code: "ENOENT" });
  const next = await candidate(f, "fresh invocation after refusal");
  assert.equal((await applyExactCommitOperation(next.options)).status, "committed");
});
