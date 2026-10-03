import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: false });
const { createGitSelectedOperationRegistry } = await jiti.import("./git-selected-operation-registry.ts");
const owner = { sessionId: "registry-fixture", sessionFile: "/fixture/session.jsonl", sessionCwd: "/fixture/chat" };
// Negative registry tests only: these metadata fixtures never authorize Git.
const readers = { readCleanupProof: () => undefined, readRecoveryProof: () => undefined, readPreparationNoEffect: () => undefined };
const candidate = () => ({ operation: "workspace", revision: "capture", policyRevision: "policy", sourceOid: "a".repeat(40),
  source: { cwd: "/fixture/source", projectRoot: "/fixture/source", branch: "main" },
  history: { kind: "workspace", repositoryRoot: "/fixture/source" } });

test("candidate captures are immutable and exact-identity, not copied/history handles", () => {
  const registry = createGitSelectedOperationRegistry(owner, readers), c = candidate(), payload = {};
  const handle = registry.capture(c, payload); c.history.repositoryRoot = "/changed";
  assert.equal(registry.readCandidate(handle).history.repositoryRoot, "/fixture/source");
  assert.equal(registry.readCapture(handle), payload);
  assert.equal(registry.readCandidate({ ...handle }), undefined);
  assert.equal(registry.readNativeCompletion({ actionId: "capture" }), undefined);
  assert.equal(registry.readDurableCompletion({ actionId: "capture" }), undefined);
  assert.throws(() => { registry.readCandidate(handle).history.repositoryRoot = "/changed"; }, TypeError);
  registry.retire(handle); assert.equal(registry.readCandidate(handle), undefined);
});

test("workspace proof lookalikes cannot register completion or invoke a durable barrier", async () => {
  const registry = createGitSelectedOperationRegistry(owner, readers);
  const fakeProof = { actionId: "old-action", outcome: "completed" };
  assert.throws(() => registry.completed({ stage: "completed", actionId: "old-action", candidateRevision: "capture", completedAt: 1,
    completion: { operation: "workspace", proof: fakeProof } }, fakeProof), /Native workspace identity/);
  await assert.rejects(registry.seal({}, () => { assert.fail("unissued results must never reach the barrier"); }), /Actual native result/);
  assert.equal(registry.readNativeCompletion(fakeProof), undefined);
});

test("cleanup/recovery copies and receipt IDs cannot issue native completion", () => {
  const registry = createGitSelectedOperationRegistry(owner, readers);
  const proof = { actionId: "old-action" }, base = { stage: "completed", actionId: "old-action", candidateRevision: "capture", completedAt: 1 };
  assert.throws(() => registry.completed({ ...base, completion: { operation: "cleanup", proof } }, proof), /Actual completed native cleanup/);
  assert.throws(() => registry.completed({ ...base, completion: { operation: "verify", receiptIds: ["history-id"] } }, [{ id: "history-id" }]), /Actual completed native receipts/);
  assert.throws(() => registry.completed({ ...base, completion: { operation: "reconcile", recoveryHandle: proof } }, proof), /Independent native recovery/);
});

test("unissued already-prepared objects cannot mint a sealed no-effect result", () => {
  const registry = createGitSelectedOperationRegistry(owner, readers), result = { status: "already-prepared", oldSourceOid: "a".repeat(40), newSourceOid: "a".repeat(40) };
  assert.throws(() => registry.completed({ stage: "completed", actionId: "old", candidateRevision: "capture", completedAt: 1,
    completion: { operation: "prepare", result } }, result, true), /Actual native no-effect identity/);
});

test("public target-moved constructors, codes, copies and structural proofs never issue safe failure authority", async () => {
  const { GitIntegrationTargetMovedError } = await jiti.import("./git-integration.ts");
  const registry = createGitSelectedOperationRegistry(owner, readers), capture = registry.capture(candidate(), {});
  const failure = { kind: "target-moved", actionId: "history-action", candidateRevision: "capture", before: { targetOid: "a".repeat(40) },
    after: { targetOid: "b".repeat(40) }, otherStateBefore: "unchanged", otherStateAfter: "unchanged", noEffect: true };
  for (const cause of [new GitIntegrationTargetMovedError(), { code: "target_moved" }, { ...new GitIntegrationTargetMovedError() }, { ...failure }]) {
    assert.equal(registry.integrationTargetMoved(cause, capture, failure.actionId), false);
    assert.throws(() => registry.failure(cause, failure, capture), /Original native target movement failure identity/);
    assert.equal(registry.readNativeFailure(cause), undefined);
  }
});

test("known failures survive by original identity and cannot be edited or replayed", () => {
  const registry = createGitSelectedOperationRegistry(owner, readers), cause = new Error("native failure");
  const facts = { kind: "refused", code: "native-refused" };
  registry.failure(cause, facts); facts.code = "forged";
  assert.equal(registry.readNativeFailure(cause).code, "native-refused");
  assert.equal(registry.readNativeFailure({ ...cause }), undefined);
  assert.equal(registry.readNativeFailure(new Error("native failure")), undefined);
});
