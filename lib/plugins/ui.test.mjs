import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { validatePluginCard, validPluginAction } = await createJiti(import.meta.url).import("./ui.ts");
test("generic cards support informational, Markdown, supplied patches and bounded exact actions", () => {
  const card = { title: "Preview", text: "Exact args", markdown: "**Info**", patch: "diff --git a/x b/x", actions: [{ id: "approve", label: "Approve" }] };
  validatePluginCard(card);
  validatePluginCard({ title: "Information", actions: [] });
  assert.equal(validPluginAction(card, "approve"), true);
  assert.equal(validPluginAction(card, "execute-other"), false);
  assert.throws(() => validatePluginCard({ ...card, actions: [card.actions[0], card.actions[0]] }));
  assert.throws(() => validatePluginCard({ ...card, patch: "x".repeat(1_000_001) }));
});
test("structured cards validate fields, sections, scope and primary action without broadening action identity", () => {
  const card = { title: "Approval", fields: [{ label: "Checkout", value: "/repo", code: true }],
    sections: [{ title: "Message", text: "Exact message", code: true }, { title: "Details", text: "Full IDs", collapsible: true }],
    scope: "Entire candidate", actions: [{ id: "approve", label: "Approve commit", primary: true }] };
  validatePluginCard(card);
  for (const invalid of [
    { fields: "not fields" }, { fields: [{ label: "x", value: 42 }] }, { fields: [{ label: "x", value: "x", code: "true" }] },
    { sections: [{ title: "x", text: "x", collapsible: "true" }] }, { sections: [{ title: "x", fields: [null] }] },
    { scope: 42 }, { actions: [{ id: "approve", label: "x", primary: "true" }] },
    { actions: [{ id: "approve", label: "x", primary: true }, { id: "reject", label: "x", primary: true }] },
    { sections: Array.from({ length: 17 }, () => ({ title: "x" })) },
    { sections: [{ title: "x", text: "x".repeat(600000) }, { title: "y", text: "x".repeat(600000) }] },
  ]) assert.throws(() => validatePluginCard({ ...card, ...invalid }), /Invalid plugin card/);
  assert.equal(validPluginAction(card, "approve"), true);
  assert.equal(validPluginAction(card, "Approve commit"), false);
});
