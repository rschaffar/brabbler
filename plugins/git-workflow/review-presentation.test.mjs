import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { cleanupReviewSnapshot } from "./review-resources.fixture.mjs";
const jiti = createJiti(import.meta.url);
const { compactGitCard, gitReviewProposal, DEFAULT_GIT_CARD_PRESENTATION } = await jiti.import("./review.ts");

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

test("structured metadata preserves all 25 resource entries without repeating the full presentation", async () => {
  const roots = Array.from({ length: 25 }, (_, i) => `generated-${i}`);
  const operation = { action: "cleanupFeature", checkout: "/repo", featureBranch: "feature", featureTip: "a".repeat(40),
    integrationCommit: "b".repeat(40), worktreePath: "/feature", removeWorktree: true, deleteBranch: true, artifactRoots: roots };
  const snapshot = { card: cardWith(25), fingerprint: "a".repeat(64), cwd: "/repo", args: [], checks: [],
    resources: { kind: "cleanup", snapshot: cleanupReviewSnapshot(roots) } };
  const before = structuredClone(snapshot);
  // Pure metadata composition; real host durability and native capture are separate owners.
  const exact = await gitReviewProposal(operation, snapshot);
  const compact = compactGitCard(snapshot.card);
  assert.deepEqual(exact.operation, operation);
  assert.equal(Object.hasOwn(exact, "presentation"), false);
  assert.deepEqual(exact.source.resources.snapshot.artifacts.map(item => item.path), roots);
  assert.equal(compact.sections[0].fields.length, 24);
  assert.deepEqual(snapshot, before);
});
