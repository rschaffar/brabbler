import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { validatePluginCard } = await jiti.import("./ui.ts");
const { readInteractionReceipt, snapshotInteractionRequest } = await jiti.import("../interaction-receipts.ts");
const handle = "12345678-1234-4234-8234-123456789abc";
const card = { title: "Exact candidate", patch: "exact supplied patch", actions: [{ id: "approve", label: "Approve exact candidate" }] };

test("card context is an optional bounded opaque handle, never inline contents or Git/path authority", () => {
  validatePluginCard(card); validatePluginCard({ ...card, patchContext: handle });
  for (const patchContext of [null, {}, [], "", "main:file", "../file", "https://example.invalid/context", "a".repeat(10000)]) {
    assert.throws(() => validatePluginCard({ ...card, patchContext }), /Invalid plugin card/);
  }
  assert.throws(() => validatePluginCard({ ...card, patch: undefined, patchContext: handle }), /Invalid plugin card/);
});
test("receipt snapshots retain only the opaque descriptor with the unchanged historical patch and decision", () => {
  const request = { type: "extension_ui_request", method: "plugin_card", id: "request", pluginId: "git-workflow", ...card, patchContext: handle };
  const snapshot = snapshotInteractionRequest(request);
  request.patch = "different live patch";
  const receipt = readInteractionReceipt({ version: 1, request: snapshot, outcome: "answered", response: { action: "approve" } });
  assert.equal(receipt.request.patchContext, handle); assert.equal(receipt.request.patch, card.patch);
  assert.deepEqual(receipt.response, { action: "approve" });
  assert.equal(readInteractionReceipt({ version: 1, request: { ...snapshot, patchContext: { oldFile: "inline content" } }, outcome: "aborted" }), null);
  const legacy = readInteractionReceipt({ version: 1, request: { ...snapshot, patchContext: undefined }, outcome: "answered", response: { action: "approve" } });
  assert.equal(legacy.request.patch, card.patch);
});
