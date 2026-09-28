import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** The workflow fixture has just merged into target; inspect that merge as history, not as an action. */
export async function checkIntegratedGitGraph(page, targetWorktree) {
  const oid = execFileSync("git", ["-C", targetWorktree, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  const gitButton = page.getByRole("button", { name: "Git Explorer", exact: true });
  if (await gitButton.getAttribute("aria-pressed") !== "true") await gitButton.click();
  const explorer = page.locator("#git-explorer-panel");
  await explorer.getByRole("button", { name: "Refresh" }).click();
  await explorer.getByText(new RegExp(`^${oid.slice(0, 10)} ·`)).waitFor();
  const graph = explorer.getByLabel("Commit graph");
  assert.ok(await graph.locator("svg path").count() >= 2, "Merge commit should have both parent edges");
  await graph.locator(`button[title^="${oid}"]`).click();
  const detail = explorer.getByRole("region", { name: "Git commit details" });
  await detail.getByText("Merge commit · changes vs first parent").waitFor();
  await detail.getByRole("button", { name: /second\.txt/ }).click();
  await detail.getByRole("region", { name: "Side-by-side diff" }).getByText("Second feature patch", { exact: true }).waitFor();
  console.log("PASS: Git Explorer inspects a merged commit's first-parent file patch");
}
