import assert from "node:assert/strict";

export async function checkSessionMovePicker(page, { base, api, sessionId, project, otherProject, gitProject, targetWorktree, mobile }) {
  const session = async () => (await api("/api/sessions?force=1")).sessions.find((item) => item.id === sessionId);
  const open = async () => {
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
    if (mobile) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    const row = page.locator(`[data-session-id="${sessionId}"]`);
    await row.scrollIntoViewIfNeeded();
    if (mobile) await row.getByRole("button", { name: "Session actions", exact: true }).click();
    else await row.hover();
    await row.getByRole("button", { name: "Move to project…", exact: true }).click();
    return page.getByRole("dialog", { name: "Move to project…" });
  };
  const confirm = async (dialog, cwd) => {
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await dialog.waitFor({ state: "detached" });
    assert.equal((await session()).cwd, cwd);
  };
  let dialog = await open();
  const projectSelect = dialog.getByLabel("Destination project");
  const directorySelect = dialog.getByLabel("Worktree/directory");
  const move = dialog.getByRole("button", { name: "Move", exact: true });
  const select = async (root) => {
    await projectSelect.selectOption(root);
    await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  };
  await select(project);
  assert.equal(await directorySelect.locator(`option[value="${project}"]`).isDisabled(), true);
  assert.equal(await move.isDisabled(), true);

  // A superseded request must not replace a newer project's destinations.
  let pending;
  let release;
  const received = new Promise((resolve) => { pending = resolve; });
  const held = new Promise((resolve) => { release = resolve; });
  const matcher = (url) => url.pathname === "/api/worktrees" && url.searchParams.get("cwd") === gitProject;
  await page.route(matcher, async (route) => {
    pending();
    await held;
    await route.fulfill({ json: { worktrees: [{ path: gitProject, branch: "stale-main", isMain: true }] } }).catch(() => {});
  });
  await projectSelect.selectOption(gitProject);
  await received;
  assert.equal(await directorySelect.isDisabled(), true);
  assert.equal(await move.isDisabled(), true);
  await select(otherProject);
  release();
  await page.unroute(matcher);
  await page.waitForTimeout(150);
  assert.equal(await projectSelect.inputValue(), otherProject);
  assert.equal(await directorySelect.inputValue(), otherProject);
  assert.equal(await directorySelect.locator("option", { hasText: "stale-main" }).count(), 0);
  assert.equal((await session()).cwd, project, "Project selection is proposal-only");
  assert.equal(await page.locator('button[title^="Switch worktree:"]').count(), 0, "Picker selection must not switch the sidebar's plain checkout");

  // A listing completing while Browse is open must not navigate its form.
  const browseReceived = new Promise((resolve) => { pending = resolve; });
  const browseHeld = new Promise((resolve) => { release = resolve; });
  await page.route(matcher, async (route) => {
    pending();
    await browseHeld;
    await route.fulfill({ json: { worktrees: [{ path: gitProject, branch: "main", isMain: true }] } });
  });
  await projectSelect.selectOption(gitProject);
  await browseReceived;
  await dialog.getByRole("button", { name: "Browse another folder…" }).click();
  const pendingBrowser = page.getByRole("dialog", { name: "Select directory", exact: true });
  await page.waitForFunction(() => !document.querySelector('.directory-picker-panel button[type="submit"]').disabled);
  release();
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  await page.waitForTimeout(150);
  assert.equal(await pendingBrowser.getByLabel("Directory path").inputValue(), project);
  await pendingBrowser.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.unroute(matcher);
  await select(otherProject);

  // Listing failure leaves Move disabled, with an explicit retry and Browse.
  await page.route(matcher, (route) => route.fulfill({ json: { error: "Fixture listing unavailable" } }));
  await projectSelect.selectOption(gitProject);
  await dialog.getByRole("alert").filter({ hasText: "Fixture listing unavailable" }).waitFor();
  assert.equal(await move.isDisabled(), true);
  await page.unroute(matcher);
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  assert.equal(await directorySelect.locator(`option[value="${targetWorktree}"]`).innerText(), `target · ${targetWorktree}`);
  assert.equal(await directorySelect.locator(`option[value="${gitProject}"]`).innerText(), `feature · ${gitProject}`);
  await directorySelect.selectOption(targetWorktree);
  assert.equal((await session()).cwd, project, "Worktree selection is proposal-only");
  await confirm(dialog, targetWorktree);

  // Same-project linked -> primary move, with only the exact source disabled.
  dialog = await open();
  await dialog.getByLabel("Destination project").selectOption(gitProject);
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  assert.equal(await dialog.getByLabel("Worktree/directory").locator(`option[value="${targetWorktree}"]`).isDisabled(), true);
  assert.equal(await dialog.getByLabel("Worktree/directory").locator(`option[value="${gitProject}"]`).isDisabled(), false);
  await dialog.getByLabel("Worktree/directory").selectOption(gitProject);
  assert.equal((await session()).cwd, targetWorktree);
  assert.equal(await page.locator(`button[title="Switch worktree: ${targetWorktree}"]`).count(), 1, "Proposing the primary directory must not switch the sidebar");
  await confirm(dialog, gitProject);

  // Plain project remains directly selectable. Browse can override it with
  // another existing non-Git directory, without invoking Move itself.
  dialog = await open();
  await dialog.getByLabel("Destination project").selectOption(project);
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  assert.equal(await dialog.getByLabel("Worktree/directory").inputValue(), project);
  const browse = async (path) => {
    await dialog.getByRole("button", { name: "Browse another folder…" }).click();
    const picker = page.getByRole("dialog", { name: "Select directory", exact: true });
    const go = picker.getByRole("button", { name: "Go", exact: true });
    await page.waitForFunction(() => !document.querySelector('.directory-picker-panel button[type="submit"]').disabled);
    await picker.getByLabel("Directory path").fill(path);
    const navigated = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/cwd/browse" && url.searchParams.get("path") === path;
    });
    await go.click();
    await navigated;
    await page.waitForFunction(() => !document.querySelector('.directory-picker-panel button[type="submit"]').disabled);
    await picker.getByRole("button", { name: "Select this folder", exact: true }).click();
    await picker.waitFor({ state: "detached" });
  };
  await browse(gitProject);
  assert.equal(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), true, "Browse also excludes the exact source");
  const browseDirectory = `${project}/browse-only`;
  await browse(browseDirectory);
  assert.equal((await session()).cwd, gitProject);
  assert.equal(await dialog.getByLabel("Destination project").inputValue(), "");
  assert.equal(await dialog.getByLabel("Worktree/directory").inputValue(), browseDirectory);
  await confirm(dialog, browseDirectory);
}
