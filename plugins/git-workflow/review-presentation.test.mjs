import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { compactGitCard, buildGitReview, DEFAULT_GIT_CARD_PRESENTATION } = await jiti.import("./review.ts");

// Supplied presentation data, not a copy of compaction or native capture logic.
const cardWith = count => ({ title: "Git cleanup", fields: Array.from({ length: 5 }, (_, i) => ({ label: `Essential ${i}`, value: `Value ${i}` })),
  sections: [{ title: "Generated artifacts", text: "Frozen resource inventory.", fields: Array.from({ length: count }, (_, i) => ({ label: `generated-${i}`, value: `Metadata ${i}`, code: true })) },
    { title: "Boundaries", text: "Only the captured resources." }], actions: [{ id: "approve", label: "Remove listed resources" }] });

test("application defaults preserve the 24/25 display boundary without changing the full card", () => {
  assert.equal(DEFAULT_GIT_CARD_PRESENTATION.sectionFieldLimit, 24);
  assert.equal(Object.isFrozen(DEFAULT_GIT_CARD_PRESENTATION), true);
  for (const count of [24, 25]) {
    const card = cardWith(count), before = structuredClone(card), compact = compactGitCard(card);
    assert.deepEqual(compact.sections[0].fields, card.sections[0].fields.slice(0, 24));
    assert.equal(compact.sections[0].fields.length, 24);
    assert.equal(compact.sections[0].text, "Frozen resource inventory." + (count === 25 ? "\nShowing 24 of 25 items. The exact review contains every item." : ""));
    assert.deepEqual(compact.fields, card.fields);
    assert.deepEqual(compact.sections[1], card.sections[1]);
    assert.deepEqual(card, before, "compaction cannot mutate exact review inputs");
  }
});

test("explicit section budgets retain essential fields, exact totals and immutable inputs", () => {
  for (const sectionFieldLimit of [1, 2, 4]) {
    const presentation = Object.freeze({ sectionFieldLimit });
    const card = cardWith(sectionFieldLimit + 1), before = structuredClone(card);
    const compact = compactGitCard(card, presentation);
    assert.deepEqual(compact.sections[0].fields, card.sections[0].fields.slice(0, sectionFieldLimit));
    assert.equal(compact.sections[0].text, `Frozen resource inventory.\nShowing ${sectionFieldLimit} of ${sectionFieldLimit + 1} items. The exact review contains every item.`);
    assert.deepEqual(compact.fields, card.fields, "list budget cannot hide operation metadata");
    assert.deepEqual(card, before);
    assert.equal(presentation.sectionFieldLimit, sectionFieldLimit);
    assert.equal(DEFAULT_GIT_CARD_PRESENTATION.sectionFieldLimit, 24, "one call cannot reconfigure application defaults");
  }
});

test("invalid application budgets cannot enlarge or disable bounded presentation", () => {
  for (const sectionFieldLimit of [0, -1, 1.5, NaN, Infinity, 25, "2"]) {
    assert.throws(() => compactGitCard(cardWith(3), { sectionFieldLimit }), /Git section preview limit must be an integer from 1 to 24/);
  }
});

test("real metadata review serialization keeps all 25 operation and presentation entries", async () => {
  const roots = Array.from({ length: 25 }, (_, i) => `generated-${i}`);
  const operation = { action: "cleanupFeature", checkout: "/repo", featureBranch: "feature", featureTip: "a".repeat(40),
    integrationCommit: "b".repeat(40), worktreePath: "/feature", removeWorktree: true, deleteBranch: true, artifactRoots: roots };
  const snapshot = { card: cardWith(25), fingerprint: "captured-state", cwd: "/repo", args: [], checks: [] };
  const before = structuredClone(snapshot), chunks = [], entries = [];
  // External memory writer only. No comparison means no patch/native context demand;
  // durable default storage and executor ordering are exercised by cleanup.test.mjs.
  const writer = { begin: async (title, kind) => { entries.push([title, kind]); }, write: async chunk => { chunks.push(Buffer.from(chunk)); }, end: async () => {} };
  await buildGitReview(writer, operation, snapshot);
  const compact = compactGitCard(snapshot.card);
  const exact = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  assert.deepEqual(entries, [["Exact operation, checks and captured state", "text"]]);
  assert.deepEqual(exact.operation, operation);
  assert.deepEqual(exact.presentation, before.card);
  assert.deepEqual(exact.presentation.sections[0].fields.map(field => field.label), roots);
  assert.equal(compact.sections[0].fields.length, 24);
  assert.deepEqual(snapshot, before);
});
