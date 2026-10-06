import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

/** Create an explicit disposable merge fixture, then inspect its history. */
export async function checkIntegratedGitGraph(page, targetWorktree) {
  execFileSync("git", ["-C", targetWorktree, "-c", "core.hooksPath=/dev/null", "merge", "--no-gpg-sign", "--no-ff", "feature", "-m", "E2E merge fixture"], { encoding: "utf8" });
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
  const file = detail.getByRole("region", { name: "File changes: second.txt", exact: true });
  await file.getByRole("button", { name: "Toggle diff: second.txt", exact: true }).click();
  await file.getByRole("region", { name: "Side-by-side diff" }).getByText("Second feature patch", { exact: true }).waitFor();
  console.log("PASS: Git Explorer inspects a merged commit's first-parent file patch");
}
