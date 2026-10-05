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
