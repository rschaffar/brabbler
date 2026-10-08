import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { parseQuestionSet, normalizeSetAnswers, normalizeSetAnswer, questionSetSummary, draftAnswer, emptyQuestionDraft } = await jiti.import("./question-set.ts");
const { loadQuestionDrafts, saveQuestionDrafts, clearQuestionDraft, initialQuestionDrafts, reconcileQuestionDrafts } = await jiti.import("./question-set-drafts.ts");
const { normalizeInteractionResponse, readInteractionReceipt } = await jiti.import("./interaction-receipts.ts");
const { createAskUserExtension } = await jiti.import("./ask-user-extension.ts");
const input = { title: "Decisions", questions: [
  { id: "scope", shortLabel: "Scope", question: "Which scope?", type: "single", options: [{ id: "a", title: "First" }, { id: "b", title: "Second" }] },
  { id: "platform", shortLabel: "Platforms", question: "Which platforms?", type: "multiple", options: [{ id: "a", title: "First" }, { id: "b", title: "Second" }, { id: "none", title: "None", exclusive: true }] },
  { id: "notes", shortLabel: "Notes", question: "Constraints?", type: "text", required: false },
] };
const set = parseQuestionSet(input);
const answers = [
  { id: "scope", kind: "freeform", text: " Alternative ", comment: " Plus details " },
  { id: "platform", kind: "selection", selections: ["b", "a"], comment: "Only supported releases" },
  { id: "notes", kind: "skipped" },
];

test("sets are bounded, IDs unique per scope, and malformed mixed modes fail closed", () => {
  assert.ok(set);
  assert.equal(set.questions[0].required, true);
  for (const bad of [
    { ...input, title: " " }, { ...input, questions: [] }, { ...input, questions: Array(7).fill(input.questions[0]) },
    { ...input, questions: [input.questions[0], input.questions[0]] },
    { ...input, questions: [{ ...input.questions[0], options: [{ id: "a", title: "A" }, { id: "a", title: "B" }] }] },
    { ...input, questions: [{ ...input.questions[0], type: "text" }] },
    { ...input, questions: [{ ...input.questions[0], options: [] }] },
    { ...input, questions: [{ ...input.questions[0], required: "yes" }] },
  ]) assert.equal(parseQuestionSet(bad), null);
});

test("atomic answers use IDs, canonical order, alternatives AND additive details", () => {
  const normalized = normalizeSetAnswers([...answers].reverse(), set);
  assert.deepEqual(normalized[0], { id: "scope", kind: "freeform", text: "Alternative", comment: "Plus details" });
  assert.deepEqual(normalized[1].selections, ["a", "b"]);
  assert.match(questionSetSummary(set, normalized), /Alternative\nAdditional details: Plus details/);
  for (const bad of [answers.slice(1), [...answers, answers[0]], [answers[0], answers[0], answers[2]],
    [{ ...answers[0], id: "unknown" }, ...answers.slice(1)], [{ id: "scope", kind: "skipped" }, ...answers.slice(1)],
    [answers[0], { ...answers[1], selections: [] }, answers[2]],
    [answers[0], { ...answers[1], selections: ["a", "none"] }, answers[2]],
    [answers[0], { ...answers[1], selections: ["a", "a"] }, answers[2]],
    [answers[0], { ...answers[1], selections: ["First"] }, answers[2]],
    [answers[0], answers[1], { id: "notes", kind: "selection", selections: ["a"] }],
  ]) assert.equal(normalizeSetAnswers(bad, set), null);
  assert.equal(normalizeSetAnswer({ ...answers[0], comment: "x".repeat(20001) }, set.questions[0]), null);
  assert.equal(draftAnswer(set.questions[0], emptyQuestionDraft(set.questions[0])), null);
});

test("batch receipts validate all answers and preserve the exact presentation", () => {
  const request = { type: "extension_ui_request", id: "request", method: "ask_user_batch", ...set };
  const response = normalizeInteractionResponse(request, { answers });
  assert.ok(response);
  assert.equal(normalizeInteractionResponse(request, { answers: answers.slice(1) }), null);
  const receipt = readInteractionReceipt({ version: 1, request, outcome: "answered", response });
  assert.deepEqual(receipt.request, request);
  assert.match(questionSetSummary(set, receipt.response.answers), /Plus details/);
  assert.equal(readInteractionReceipt({ version: 1, request, outcome: "answered", response: { answers: [] } }), null);
  const minimal = { ...request, questions: [{ id: "text", shortLabel: "Text", question: "Write?", type: "text" }] };
  const recovered = readInteractionReceipt({ version: 1, request: minimal, outcome: "timed_out" });
  assert.deepEqual(recovered.request.questions[0].options, []);
  assert.equal(recovered.request.questions[0].required, true);
  assert.equal(readInteractionReceipt({ version: 1, request: minimal, outcome: "answered", response: { answers: [{ id: "text", kind: "skipped" }] } }), null);
});

function memoryStorage() {
  const values = new Map();
  return { get length() { return values.size; }, key: (i) => [...values.keys()][i] ?? null,
    getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: (k) => values.delete(k) };
}
test("drafts round-trip inactive alternatives/details, isolate identity, reject changed payload and bound retention", () => {
  const store = memoryStorage();
  const drafts = initialQuestionDrafts(set);
  drafts.scope = { selections: ["a"], writing: true, text: "Alternative", comment: "Details", skipped: false };
  assert.equal(saveQuestionDrafts("s", "r", set, drafts, store), true);
  assert.deepEqual(loadQuestionDrafts("s", "r", set, store).drafts, drafts);
  assert.deepEqual(loadQuestionDrafts("other", "r", set, store).drafts, initialQuestionDrafts(set));
  assert.deepEqual(loadQuestionDrafts("s", "r", { ...set, title: "Changed" }, store).drafts, initialQuestionDrafts(set));
  for (let i = 0; i < 20; i++) saveQuestionDrafts("s", `r${i}`, set, drafts, store);
  assert.equal(store.length, 12);
  clearQuestionDraft("s", "r19", store);
  assert.equal(store.length, 11);
  saveQuestionDrafts("other", "pending", set, drafts, store);
  saveQuestionDrafts("s", "pending", set, drafts, store);
  reconcileQuestionDrafts("s", ["pending"], store);
  assert.equal(store.length, 2, "reconnect removes settled drafts but keeps other sessions and active requests");
  assert.deepEqual(loadQuestionDrafts("s", "pending", set, store).drafts, drafts);
  const broken = { getItem() { throw new Error("disabled"); } };
  assert.equal(loadQuestionDrafts("s", "r", set, broken).available, false);
  assert.equal(saveQuestionDrafts("s", "r", set, drafts, broken), false);
});

test("tool exposes the batch schema, returns complete answers, redacts events and rejects ambiguous input", async () => {
  let tool;
  const events = [];
  createAskUserExtension().factory({ registerTool: (t) => { tool = t; }, events: { emit: (name, payload) => events.push({ name, payload }) } });
  assert.equal(tool.parameters.properties.questions.maxItems, 6);
  const result = await tool.execute("call", input, undefined, undefined, { hasUI: true, ui: { askUserBatch: async () => answers } });
  assert.equal(result.details.cancelled, false);
  assert.match(result.content[0].text, /Plus details/);
  assert.deepEqual(events.find((e) => e.name === "ask:answered").payload, { title: "Decisions", questionCount: 3, cancelled: false });
  await assert.rejects(tool.execute("call", { ...input, question: "Legacy" }, undefined, undefined, {}), /never both/);
  await assert.rejects(tool.execute("call", {}, undefined, undefined, {}), /Provide question/);
  const cancelled = await tool.execute("call", input, undefined, undefined, { hasUI: true, ui: { askUserBatch: async () => null } });
  assert.equal(cancelled.details.answers, null);
});
