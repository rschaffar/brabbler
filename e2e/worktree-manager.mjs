import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedManagerDiscardFixtures, checkManagerDiscard, waitManagerButton } from "./worktree-manager-discard.mjs";

export const WORKTREE_MANAGER_IDS = ["e2e-worktree-manager-desktop", "e2e-worktree-manager-mobile"];
export function seedWorktreeManagerFixtures({ agentDir, env, writeSession, message }) {
  return WORKTREE_MANAGER_IDS.map((id, index) => {
    const repo = join(agentDir, `manager-${index}`), worktree = `${repo}-integrated`, dirty = `${repo}-dirty`;
    mkdirSync(repo);
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { env, encoding: "utf8" }).trim();
    const commitEnv = (date) => ({ ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
    const commit = (cwd, subject, date) => execFileSync("git", ["-C", cwd, "-c", "user.name=Manager fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "-m", subject], { env: commitEnv(date), encoding: "utf8" });
    git("init", "-b", "main");
    git("config", "user.name", "Manager fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "commit.gpgSign", "false");
    writeFileSync(join(repo, ".gitignore"), ".cache/\n"); writeFileSync(join(repo, "source.txt"), "base\n"); git("add", "."); commit(repo, "base", "2020-01-01T12:00:00Z");
    git("worktree", "add", "-b", "integrated", worktree);
    writeFileSync(join(worktree, "source.txt"), "integrated\n"); execFileSync("git", ["-C", worktree, "add", "."], { env }); commit(worktree, "feature", "2021-01-01T12:00:00Z");
    execFileSync("git", ["-C", repo, "merge", "--no-ff", "--no-edit", "integrated"], { env: commitEnv("2022-01-01T12:00:00Z") });
    mkdirSync(join(worktree, ".cache")); writeFileSync(join(worktree, ".cache", "result.txt"), "disposable fixture output\n");
    git("branch", "branch-only", "integrated");
    for (let n = 0; n < 55; n++) git("branch", `bulk-${String(n).padStart(2, "0")}`, "integrated");
    git("branch", "unfinished"); git("worktree", "add", "-b", "dirty-integrated", dirty, "integrated");
    writeFileSync(join(dirty, "manual.txt"), "unignored file, never delete\n");
    // unfinished has a commit outside main; it does not need its own worktree.
    git("checkout", "unfinished"); writeFileSync(join(repo, "unfinished.txt"), "unfinished\n"); git("add", "."); commit(repo, "unfinished", "2023-01-01T12:00:00Z"); git("checkout", "main");
    const discard = seedManagerDiscardFixtures({ repo, git, env, commit });
    writeSession(id, [message(`manager-${index}-user`, null, "user", `Manager fixture ${index}`), message(`manager-${index}-answer`, `manager-${index}-user`, "assistant", "Ready for project housekeeping")], repo);
    return { id, repo, worktree, dirty, git, discard };
  });
}

/** Physical/default manager entry; exhaustive reads/decisions run below Chromium. */
export async function checkWorktreeManager(page, { base, fixture, artifacts, width }) {
  const { repo, worktree, id } = fixture;
  const patchSettings = async (set, scope = "global") => {
    const response = await page.request.patch(`${base}/api/plugins/bundled`, { data: { pluginId: "git-workflow", cwd: repo, scope, set, reset: [] } });
    assert.equal(response.status(), 200, await response.text());
  };
  // Preserve the original native policy/input: lifecycle Deny/Keep must not
  // substitute for independently confirmed manual removal under Allow.
  await patchSettings({ enabled: false, cleanupFeature: "deny", discardResources: "allow", cleanupWorktree: "keep", cleanupBranch: "keep", cleanupArtifacts: "keep", approvedArtifactRoots: "", targetSelection: "configured" });
  await patchSettings({ targetBranch: "main" }, "project");
  await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Ready for project housekeeping", { exact: true }).waitFor();
  const showSidebar = async () => { const button = page.getByRole("button", { name: "Show sidebar", exact: true }); if (await button.isVisible()) await button.click(); };
  await showSidebar(); await page.getByRole("button", { name: "New", exact: true }).click();
  const open = async () => {
    await showSidebar(); await page.getByTitle(`Switch worktree: ${repo}`, { exact: true }).click();
    await page.getByRole("button", { name: "Manage branches & worktrees…", exact: true }).click();
    await page.getByRole("dialog", { name: "Manage branches & worktrees", exact: true }).waitFor();
  };
  await open();
  const manager = page.getByRole("dialog", { name: "Manage branches & worktrees", exact: true });
  const withinViewport = () => page.waitForFunction(() => {
    const d = document.querySelector('dialog[aria-labelledby="worktree-manager-title"]');
    const r = d?.getBoundingClientRect(); return r && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  await manager.getByText("Resource removal requires Git Workflow. Browsing remains available.", { exact: false }).waitFor();
  await waitManagerButton(page, manager, "Refresh");
  assert.equal(await manager.getByLabel("Comparison target", { exact: true }).inputValue(), "main");
  await withinViewport();
  // Keep the real fifty-row/page-two surfaces at BOTH original physical inputs.
  await manager.getByRole("button", { name: "Next page", exact: true }).click();
  await manager.locator('tr[data-branch="unfinished"]').waitFor();
  assert.match(await manager.locator('tr[data-branch="unfinished"]').innerText(), /Not integrated/);
  await manager.getByRole("button", { name: "Previous page", exact: true }).click();
  const close = manager.getByRole("button", { name: "Close", exact: true });
  const native = await manager.evaluate(node => ({ native: node instanceof HTMLDialogElement,
    open: node.open, modal: node.matches(":modal"), focusInside: node.contains(document.activeElement) }));
  console.log(`WORKTREE_MODAL_READY ${JSON.stringify(native)}`);
  assert.deepEqual({ native: native.native, open: native.open, modal: native.modal }, { native: true, open: true, modal: true });
  // Native modal navigation, not a new JS focus-wrap/Chrome-toolbar policy.
  // Close is the first control: forward Tab exercises an actual in-dialog target.
  await close.focus(); await page.keyboard.press("Tab");
  assert.equal(await manager.evaluate(node => node.contains(document.activeElement)), true, "Native modal Tab reaches a manager control");

  // One narrow genuine graph-date/detail connection, not all matching-set/date
  // policy permutations or another invisible-page widening transaction matrix.
  await manager.getByLabel("Search branches or paths", { exact: true }).fill("integrated");
  await manager.getByLabel("Sort", { exact: true }).selectOption("merge");
  await page.waitForFunction(() => document.querySelector('th[aria-sort]')?.textContent === "Merge commit date");
  const integrated = manager.locator('tr[data-branch="integrated"]');
  await integrated.waitFor(); await integrated.getByRole("button", { name: "integrated", exact: true }).click();
  await manager.getByText("First-parent graph introduction.", { exact: false }).waitFor();
  await manager.getByText("disposable fixture output", { exact: false }).waitFor({ state: "hidden" });
  assert.equal(existsSync(worktree), true, "browsing never removes resources");
  assert.equal(await manager.getByRole("button", { name: "Review removal…", exact: true }).isDisabled(), true);
  // Embedded Settings is a different top-layer/Back surface at narrow width.
  await manager.getByRole("button", { name: "Open Git Workflow settings", exact: true }).click();
  const enabledResponse = page.waitForResponse(response => response.request().method() === "PATCH" && response.url().endsWith("/api/plugins/bundled"));
  void enabledResponse.catch(() => {}); // Observe early failure, preserve original await.
  await manager.getByRole("checkbox", { name: "Enable plugin (all projects)", exact: true }).check();
  const enabled = await enabledResponse; assert.equal(enabled.status(), 200); await enabled.json();
  await manager.getByRole("button", { name: "Back to overview", exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('dialog p')].some(p => p.textContent.includes("Resource removal requires Git Workflow")));
  await waitManagerButton(page, manager, "Review removal…");
  await withinViewport();

  await checkManagerDiscard(page, { base, fixture, manager, open, width });
  await manager.screenshot({ path: join(artifacts, `worktree-manager-${width}.png`) });
  await withinViewport();
  await page.keyboard.press("Escape");
  await manager.waitFor({ state: "hidden" });
  await patchSettings({ enabled: false });
  console.log(`PASS: ${width}px native manager entry/paging/Settings/modal focus; ${width > 600 ? "native loss-approved removal and immutable history" : "live loss review, reject and focus restoration"}`);
}
