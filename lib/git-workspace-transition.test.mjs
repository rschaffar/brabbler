import assert from "node:assert/strict";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { recordGitWorkspaceTransition, claimGitWorkspaceTransition, recordGitWorkspaceForkId,
  finishGitWorkspaceTransition, failGitWorkspaceTransition, readGitWorkspaceTransitionStatusFromRoot } = await jiti.import("./git-workspace-transition.ts");
const id = "965b8e2b-6329-4de8-a4f4-e716427b2261";
const nonce = "fb14e16f-6690-4577-8160-e880498d91aa";
const transition = { version: 1, originCwd: "/source", destinationPath: "/target", branch: "feature", baseOid: "a".repeat(40),
  onCreate: "fork", featureTip: "a".repeat(40), createdAt: new Date().toISOString(), nonce };

test("private receipt is write-once, claimed before work, and never retries", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-transition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root), null);
  recordGitWorkspaceTransition(id, transition, root);
  assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).status, "pending");
  assert.throws(() => recordGitWorkspaceTransition(id, transition, root), /EEXIST/);
  assert.equal(claimGitWorkspaceTransition(id, "wrong", root), false);
  assert.equal(claimGitWorkspaceTransition(id, nonce, root), true);
  assert.equal(claimGitWorkspaceTransition(id, nonce, root), false);
  assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).status, "claimed");
  recordGitWorkspaceForkId(id, nonce, "4372e141-b889-4acf-a739-66fbc2ca2d62", root);
  failGitWorkspaceTransition(id, nonce, root);
  assert.deepEqual(readGitWorkspaceTransitionStatusFromRoot(id, root), {
    status: "manual-recovery", action: "fork", sourceCwd: "/source", destinationPath: "/target",
    nonce, newSessionId: "4372e141-b889-4acf-a739-66fbc2ca2d62", reason: "Transition needs manual recovery",
  });
  assert.equal(claimGitWorkspaceTransition(id, nonce, root), false);
});

test("an unclaimed receipt left by a process restart is manual-only, not pending forever", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-transition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const previous = globalThis[Symbol.for("pi-web:git-workspace-active-receipts")];
  recordGitWorkspaceTransition(id, transition, root);
  assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).status, "pending");
  globalThis[Symbol.for("pi-web:git-workspace-active-receipts")] = new Set();
  try {
    assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).status, "manual-recovery");
    assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).reason, "Transition needs manual recovery");
  } finally { globalThis[Symbol.for("pi-web:git-workspace-active-receipts")] = previous; }
});

test("a claimed receipt abandoned by a process restart needs manual recovery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-transition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  recordGitWorkspaceTransition(id, transition, root);
  assert.equal(claimGitWorkspaceTransition(id, nonce, root), true);
  assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).status, "claimed");
  const key = Symbol.for("pi-web:git-workspace-running-claims");
  const previous = globalThis[key];
  globalThis[key] = new Set();
  try {
    assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).status, "manual-recovery");
    assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root).reason, "Transition needs manual recovery");
  } finally { globalThis[key] = previous; }
});

test("private receipt directories are physical and owner-only", async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), "pi-web-transition-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "receipts");
  recordGitWorkspaceTransition(id, transition, root);
  assert.equal((await stat(root)).mode & 0o077, 0);
  assert.equal((await stat(path.join(root, id))).mode & 0o077, 0);
  const redirected = path.join(base, "redirected");
  await symlink(root, redirected, "dir");
  assert.throws(() => recordGitWorkspaceTransition("29ee29e6-93d6-48e2-aac5-b19449d681f0", transition, redirected), /Unsafe private receipt directory/);
});

test("success and stay never expose receipt paths or schedule stay", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-transition-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  recordGitWorkspaceTransition(id, { ...transition, onCreate: "stay" }, root);
  assert.equal(readGitWorkspaceTransitionStatusFromRoot(id, root), null);
  recordGitWorkspaceTransition(id, { ...transition, onCreate: "continue" }, root);
  assert.equal(claimGitWorkspaceTransition(id, nonce, root), true);
  finishGitWorkspaceTransition(id, nonce, "/target", root);
  assert.deepEqual(readGitWorkspaceTransitionStatusFromRoot(id, root), {
    status: "succeeded", action: "continue", sourceCwd: "/source", destinationPath: "/target", nonce,
  });
  assert.equal(readGitWorkspaceTransitionStatusFromRoot("../oops", root), null);
});
