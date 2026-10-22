import assert from "node:assert/strict";
import { seedModelSpeedDefaults, seedModelSpeedTranscripts } from "./model-speed.mjs";
import { seedRunningForkFixtures } from "./running-session-forks.mjs";
import { seedWorktreeManagerFixtures } from "./worktree-manager.mjs";

// Reviewed prelude only. Other setup stays in browser-suite in its original order.
// Expected IDs are deliberately declared here, NOT collected from writeSession or
// seed return values: missing/extra/wrong IDs must fail startup catalogue equality.
const recipes = [
  { name: "model-speed-defaults", expectedIds: [], seed: seedModelSpeedDefaults },
  { name: "model-speed-transcripts", expectedIds: [
    "e2e-model-speed-standard", "e2e-model-speed-fast", "e2e-model-speed-legacy",
  ], seed: seedModelSpeedTranscripts },
  { name: "running-fork-transcripts", expectedIds: [
    "e2e-running-fork-1280", "e2e-running-fork-390",
  ], seed: seedRunningForkFixtures },
  { name: "worktree-manager-repositories", expectedIds: [
    "e2e-worktree-manager-desktop", "e2e-worktree-manager-mobile",
  ], seed: seedWorktreeManagerFixtures },
];

// Compare sorted arrays, not sets: duplicate or unexpected session IDs must fail.
export function assertStartupSessionCatalogue(sessions, expectedIds) {
  assert.deepEqual(sessions.map((session) => session.id).sort(), [...expectedIds].sort());
}

export function browserFixtureRecipe(group) {
  // These four groups passed source ownership review and complete native chains.
  // Shared defaults AND model-speed IDs stay everywhere; no other group is
  // opted into omission based on its name or nominal owner.
  return recipes.filter(recipe => (group !== "timestamps" && group !== "appearance"
    && group !== "activity" && group !== "markdown")
    || recipe.name === "model-speed-defaults" || recipe.name === "model-speed-transcripts")
    .map(({ name, expectedIds }) => ({ name, expectedIds: [...expectedIds] }));
}

export async function prepareBrowserPrelude(group, options, stage, seeds = recipes.map(recipe => recipe.seed)) {
  const values = {};
  for (const { name } of browserFixtureRecipe(group)) {
    const index = recipes.findIndex(recipe => recipe.name === name);
    values[name] = await stage(`prepare/${name}`, () => seeds[index](options));
  }
  return {
    managerFixtures: values["worktree-manager-repositories"],
    expectedIds: browserFixtureRecipe(group).flatMap(recipe => recipe.expectedIds),
  };
}
