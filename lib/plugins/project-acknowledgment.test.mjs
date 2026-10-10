import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { projectCardDigest, parseProjectActionDecision, assertProjectAcknowledgment, validateSavedProjectAcknowledgment } = await jiti.import("./project-acknowledgment.ts");
const { validateOperationReceipt, snapshotOperationReceipt, readOperationReceipt } = await jiti.import("../operation-receipts.ts");
const { readInteractionReceipt } = await jiti.import("../interaction-receipts.ts");
const id = "a046677d-8293-4445-9a2b-558317345abc", nonce = "b046677d-8293-4445-9a2b-558317345abc", other = "c046677d-8293-4445-9a2b-558317345abc";
const card = { title: "Exact operation", fields: [{ label: "Resource", value: "resource-1" }], requiredAcknowledgment: "I accept the listed loss.",
  actions: [{ id: "approve", label: "Approve", primary: true }, { id: "reject", label: "Keep" }] };
const descriptor = () => ({ cardDigest: projectCardDigest(id, nonce, card), label: card.requiredAcknowledgment });
const answer = () => ({ cardDigest: descriptor().cardDigest, accepted: true });
const at = "2026-10-10T10:00:00.000Z";
const receipt = { version: 1, operationId: id, card: { ...card, operationId: id }, phase: "prepared",
  authorization: { mode: "ask", source: "manual confirmation", revision: "revision", decision: "pending" }, checks: [], effectStarted: false };

test("exact-card binding includes host operation, nonce and every presentation/action/review field", () => {
  const digest = projectCardDigest(id, nonce, card);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(projectCardDigest(id, nonce, { actions: card.actions, requiredAcknowledgment: card.requiredAcknowledgment, fields: card.fields, title: card.title }), digest);
  for (const changed of [
    { ...card, title: "Replacement" }, { ...card, requiredAcknowledgment: "Different loss." },
    { ...card, fields: [{ label: "Resource", value: "resource-2" }] },
    { ...card, actions: [{ id: "approve", label: "Different action" }] },
    { ...card, patch: "exact patch" },
    { ...card, operationId: id, review: { version: 1, id: other, operationId: id, sha256: "a".repeat(64), entries: 1, bytes: 1 } },
  ]) assert.notEqual(projectCardDigest(id, nonce, changed), digest);
  assert.notEqual(projectCardDigest(other, nonce, card), digest);
  assert.notEqual(projectCardDigest(id, other, card), digest, "identical replacement card needs a fresh checkbox identity");
  assert.throws(() => projectCardDigest("invalid", nonce, card));
  assert.throws(() => projectCardDigest(id, "invalid", card));
});

test("decision boundary requires boolean true and exactly the declared envelope; revocation never carries one", () => {
  const input = { cwd: "/physical/root", decision: "approve", acknowledgment: answer() };
  const parsed = parseProjectActionDecision(input);
  input.acknowledgment.cardDigest = "b".repeat(64);
  assert.deepEqual(parsed.acknowledgment, answer(), "detach answer before asynchronous admission");
  for (const decision of ["approve", "reject", "stop"]) assert.equal(parseProjectActionDecision({ cwd: "/root", decision }).decision, decision);
  for (const invalid of [null, [], "approve", {}, { cwd: "/root", decision: "execute" }, { cwd: 42, decision: "approve" },
    { cwd: "", decision: "approve" }, { cwd: "/root", decision: "approve", extra: true },
    ...[false, "true", 1, null, undefined].map((accepted) => ({ cwd: "/root", decision: "approve", acknowledgment: { cardDigest: answer().cardDigest, accepted } })),
    ...[null, [], "yes", {}, { accepted: true }, { cardDigest: "bad", accepted: true }, { ...answer(), extra: true }].map((acknowledgment) => ({ cwd: "/root", decision: "approve", acknowledgment })),
    ...["reject", "stop"].map((decision) => ({ cwd: "/root", decision, acknowledgment: answer() })),
    Object.create({ cwd: "/root", decision: "approve" }),
  ]) assert.throws(() => parseProjectActionDecision(invalid), /Invalid/);
});

test("first and duplicate approvals enforce the current envelope, while legacy approvals remain four-argument compatible", () => {
  assertProjectAcknowledgment(undefined, undefined);
  assert.throws(() => assertProjectAcknowledgment(undefined, answer()), /does not accept/);
  assertProjectAcknowledgment(descriptor(), answer());
  for (const invalid of [undefined, { ...answer(), accepted: false }, { ...answer(), cardDigest: "b".repeat(64) }])
    assert.throws(() => assertProjectAcknowledgment(descriptor(), invalid), /current exact card/);
  assert.throws(() => assertProjectAcknowledgment(descriptor(), answer(), true));
  const accepted = { ...descriptor(), accepted: true, acceptedAt: at };
  assertProjectAcknowledgment(accepted, answer(), true);
  assert.throws(() => assertProjectAcknowledgment(accepted, undefined, true));
});

test("saved descriptors are strict evidence; a pending prepared receipt does not require a descriptor yet", () => {
  validateSavedProjectAcknowledgment({ receipt });
  validateSavedProjectAcknowledgment({ acknowledgment: descriptor() });
  validateSavedProjectAcknowledgment({ decision: "approve", decisionAt: at }); // legacy card
  const saved = { acknowledgment: { ...descriptor(), accepted: true, acceptedAt: at }, decision: "approve", decisionAt: at, receipt };
  validateSavedProjectAcknowledgment(saved);
  validateSavedProjectAcknowledgment({ ...saved, decision: "stop", decisionAt: "2026-10-10T11:00:00.000Z" });
  assert.throws(() => validateSavedProjectAcknowledgment({ receipt, decision: "approve", decisionAt: at }), /missing/);
  for (const acknowledgment of [null, [], {}, { ...descriptor(), extra: true }, { ...descriptor(), label: " " },
    { ...descriptor(), label: 42 }, { ...descriptor(), label: "x".repeat(4097) }, { ...descriptor(), cardDigest: "bad" },
    { ...descriptor(), accepted: false }, { ...descriptor(), accepted: "true" }, { ...descriptor(), acceptedAt: at },
    { ...descriptor(), accepted: true }, { ...descriptor(), accepted: true, acceptedAt: "not-a-date" },
    { ...descriptor(), accepted: true, acceptedAt: "2026-10-10" }, { ...descriptor(), accepted: true, acceptedAt: "2026-10-10T11:00:00.000Z" },
  ]) assert.throws(() => validateSavedProjectAcknowledgment({ ...saved, acknowledgment }), /Invalid operation record/);
  assert.throws(() => validateSavedProjectAcknowledgment({ ...saved, decision: "reject" }));
  assert.throws(() => validateSavedProjectAcknowledgment({ ...saved, decision: undefined }));
  assert.throws(() => validateSavedProjectAcknowledgment({ ...saved, decisionAt: "invalid" }));
});

test("operation receipt metadata opts in read-only, but requirement-bearing session interactions remain unsupported", () => {
  validateOperationReceipt(receipt);
  const snapshot = snapshotOperationReceipt("example", receipt, 1);
  assert.deepEqual(snapshot.card.actions, []);
  assert.equal(readOperationReceipt(snapshot).card.requiredAcknowledgment, card.requiredAcknowledgment);
  const request = { ...receipt.card, type: "extension_ui_request", method: "plugin_card", pluginId: "example", id: "request" };
  assert.equal(readInteractionReceipt({ version: 1, request, outcome: "answered", response: { action: "approve" } }), null);
  const { requiredAcknowledgment: _required, ...legacy } = request;
  void _required;
  assert.ok(readInteractionReceipt({ version: 1, request: legacy, outcome: "answered", response: { action: "approve" } }));
});
