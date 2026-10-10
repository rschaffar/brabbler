import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { normalizeInteractionResponse, interactionAnswer, snapshotInteractionRequest, readInteractionReceipt } = await jiti.import("./interaction-receipts.ts");
const { validatePluginCard } = await jiti.import("./plugins/ui.ts");
const card = { type: "extension_ui_request", id: "request", method: "plugin_card", pluginId: "example", title: "Start",
  allowDetails: true, actions: [{ id: "approve", label: "Approve" }, { id: "request-changes", label: "Request changes" }] };
test("plugin feedback is opt-in, bounded, action-validated, durable and read-only", () => {
  const response = { action: "request-changes", details: "Use another model", extra: "not persisted" };
  assert.deepEqual(normalizeInteractionResponse(card, response), { action: "request-changes", details: "Use another model" });
  assert.equal(normalizeInteractionResponse({ ...card, allowDetails: false }, response), null);
  assert.equal(normalizeInteractionResponse(card, { ...response, action: "other" }), null);
  assert.equal(normalizeInteractionResponse(card, { ...response, details: 5 }), null);
  assert.equal(normalizeInteractionResponse(card, { ...response, details: "x".repeat(20001) }), null);
  const receipt = readInteractionReceipt({ version: 1, request: snapshotInteractionRequest(card), outcome: "answered", response });
  assert.equal(receipt.response.details, "Use another model");
  assert.equal(interactionAnswer(receipt), "Request changes\nUse another model");
  assert.deepEqual(normalizeInteractionResponse(card, { action: "approve" }), { action: "approve" });
});
test("session links are bounded display metadata, never arbitrary URLs or paths", () => {
  validatePluginCard({ ...card, sessionLinks: [{ sessionId: "11111111-1111-4111-8111-111111111111", label: "Open session" }] });
  for (const sessionId of ["javascript:alert(1)", "../secrets", "x?cwd=escape", "x&session=y"]) {
    assert.throws(() => validatePluginCard({ ...card, sessionLinks: [{ sessionId, label: "Link" }] }), /Invalid plugin card/);
  }
  assert.throws(() => validatePluginCard({ ...card, allowDetails: "yes" }), /Invalid plugin card/);
});
