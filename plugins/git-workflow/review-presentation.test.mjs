import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { cleanupReviewSnapshot } from "./review-resources.fixture.mjs";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { DEFAULT_GIT_CARD_PRESENTATION, requiredChecksSection } = await jiti.import("./card-presentation.ts");
const { cleanupCard, browserDiscardCard } = await jiti.import("./resource-cards.ts");
const { gitReviewProposal } = await jiti.import("./review.ts");


const roots = count => Array.from({ length: count }, (_, i) => `generated-${i}`);
const cleanup = artifactRoots => ({ action: "cleanupFeature", checkout: "/repo", featureBranch: "feature", featureTip: "a".repeat(40),
  integrationCommit: "b".repeat(40), worktreePath: "/feature", removeWorktree: true, deleteBranch: true, artifactRoots });

test("application defaults preserve the 24/25 display boundary", () => {
  assert.equal(DEFAULT_GIT_CARD_PRESENTATION.sectionFieldLimit, 24);
  assert.equal(Object.isFrozen(DEFAULT_GIT_CARD_PRESENTATION), true);
  for (const count of [24, 25]) {
    const paths = roots(count), snapshot = cleanupReviewSnapshot(paths), before = structuredClone(snapshot);
    const section = cleanupCard(cleanup(paths), snapshot).sections[0];
    assert.deepEqual(section.fields.map(field => field.label), paths.slice(0, 24));
    assert.equal(section.text, count === 25 ? "Showing 24 of 25 items. The exact review contains every item." : undefined);
    assert.deepEqual(snapshot, before, "presentation cannot mutate the resource capture");
  }
});

test("explicit section budgets retain essential fields, exact totals and immutable inputs", () => {
  for (const sectionFieldLimit of [1, 2, 4]) {
    const presentation = Object.freeze({ sectionFieldLimit });
    const paths = roots(sectionFieldLimit + 1), op = cleanup(paths), snapshot = cleanupReviewSnapshot(paths), before = structuredClone(snapshot);
    const card = cleanupCard(op, snapshot, undefined, presentation), section = card.sections[0];
    assert.deepEqual(section.fields.map(row => row.label), paths.slice(0, sectionFieldLimit));
    assert.equal(section.text, `Showing ${sectionFieldLimit} of ${paths.length} items. The exact review contains every item.`);
    assert.deepEqual(card.fields, cleanupCard(op, snapshot).fields, "list budget cannot hide operation metadata");
    assert.deepEqual(snapshot, before);
    assert.equal(presentation.sectionFieldLimit, sectionFieldLimit);
    assert.equal(DEFAULT_GIT_CARD_PRESENTATION.sectionFieldLimit, 24, "one call cannot reconfigure application defaults");
  }
});

test("invalid application budgets cannot enlarge or disable bounded presentation", () => {
  for (const sectionFieldLimit of [0, -1, 1.5, NaN, Infinity, 25, "2"]) {
    const paths = roots(3);
    assert.throws(() => cleanupCard(cleanup(paths), cleanupReviewSnapshot(paths), undefined, { sectionFieldLimit }), /Git section preview limit must be an integer from 1 to 24/);
  }
});

test("cleanup and browser discard do not format omitted artifact rows", () => {
  const paths = roots(25), snapshot = cleanupReviewSnapshot(paths);
  Object.defineProperty(snapshot.artifacts[24], "entries", { get() { assert.fail("omitted artifact was formatted"); } });
  const op = cleanup(paths);
  const discard = { ...op, action: "discardResources", subject: { kind: "branch", branch: op.featureBranch, tip: op.featureTip } };
  for (const card of [cleanupCard(op, snapshot), browserDiscardCard(discard, { targetBranch: null }, snapshot)]) {
    assert.equal(card.sections[0].fields.length, 24);
    assert.match(card.sections[0].text, /Showing 24 of 25 items/);
  }
});

test("required-check presentation formats only displayed commands", () => {
  const checks = [{ name: "first", command: "x".repeat(100000) }, { name: "second", get command() { assert.fail("omitted check was formatted"); } }];
  const section = requiredChecksSection(checks, { sectionFieldLimit: 1 });
  assert.deepEqual(section.fields, [{ label: "first", value: "x".repeat(2048) + "… [full value in exact review]", code: true }]);
  assert.match(section.text, /Showing 1 of 2 items/);
});

test("structured metadata preserves all 25 resource entries without repeating the full presentation", async () => {
  const paths = roots(25), operation = cleanup(paths);
  const resources = cleanupReviewSnapshot(paths);
  const snapshot = { fingerprint: "a".repeat(64), cwd: "/repo", args: [], checks: [], resources: { kind: "cleanup", snapshot: resources } };
  const before = structuredClone(snapshot);
  // Pure metadata composition; real host durability and native capture are separate owners.
  const exact = await gitReviewProposal(operation, snapshot);
  const card = cleanupCard(operation, resources);
  assert.deepEqual(exact.operation, operation);
  assert.equal(Object.hasOwn(exact, "presentation"), false);
  assert.deepEqual(exact.source.resources.snapshot.artifacts.map(item => item.path), paths);
  assert.equal(card.sections[0].fields.length, 24);
  assert.deepEqual(snapshot, before);
});
