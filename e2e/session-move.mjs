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
  const choose = async (field, value) => {
    await dialog.getByLabel(field, { exact: true }).click();
    await dialog.locator(`button[role="option"][data-value="${value}"]`).click();
  };
  const select = async (root) => {
    await choose("Destination project", root);
    await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  };
  // Default to the session's own project, without proposing a destination yet.
  assert.equal(await projectSelect.getAttribute("data-value"), project);
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  await directorySelect.click();
  assert.equal(await dialog.locator(`button[role="option"][data-value="${project}"]`).isDisabled(), true);
  assert.equal(await move.isDisabled(), true);
  await directorySelect.press("Escape");
  await choose("Destination project", project);
  assert.equal(await directorySelect.isDisabled(), false, "Reselecting the current project retains its loaded listing");

  // Both lists filter while typing, including names/paths and empty results.
  await projectSelect.click();
  await projectSelect.fill("no-such-project");
  await dialog.getByText("No matching projects", { exact: true }).waitFor();
  assert.equal(await dialog.getByRole("option").count(), 0);
  assert.equal(await projectSelect.getAttribute("data-value"), project);
  await projectSelect.fill(otherProject.toUpperCase());
  assert.equal(await dialog.getByRole("option").count(), 1);
  await projectSelect.press("ArrowDown");
  await projectSelect.press("Enter");
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  assert.equal(await projectSelect.getAttribute("data-value"), otherProject);

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
  await choose("Destination project", gitProject);
  await received;
  assert.equal(await directorySelect.isDisabled(), true);
  assert.equal(await move.isDisabled(), true);
  await select(otherProject);
  release();
  await page.unroute(matcher);
  await page.waitForTimeout(150);
  assert.equal(await projectSelect.getAttribute("data-value"), otherProject);
  assert.equal(await directorySelect.getAttribute("data-value"), otherProject);
  await directorySelect.click();
  assert.equal(await dialog.getByRole("option", { name: /stale-main/ }).count(), 0);
  await directorySelect.press("Escape");
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
  await choose("Destination project", gitProject);
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
  await choose("Destination project", gitProject);
  await dialog.getByRole("alert").filter({ hasText: "Fixture listing unavailable" }).waitFor();
  assert.equal(await move.isDisabled(), true);
  await page.unroute(matcher);
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  await directorySelect.click();
  assert.equal(await dialog.locator(`button[role="option"][data-value="${targetWorktree}"]`).innerText(), `target · ${targetWorktree}`);
  assert.equal(await dialog.locator(`button[role="option"][data-value="${gitProject}"]`).innerText(), `feature · ${gitProject}`);
  await directorySelect.fill("no-such-worktree");
  await dialog.getByText("No matching worktrees", { exact: true }).waitFor();
  await directorySelect.fill("TARGET");
  assert.equal(await dialog.getByRole("option").count(), 1);
  await directorySelect.press("Enter");
  assert.equal(await directorySelect.getAttribute("data-value"), targetWorktree);
  await directorySelect.click();
  assert.equal(await dialog.getByRole("option").count(), 2, "Reopening resets the filter");
  await directorySelect.press("Escape");
  assert.equal((await session()).cwd, project, "Worktree selection is proposal-only");
  await confirm(dialog, targetWorktree);

  // Same-project linked -> primary move, with only the exact source disabled.
  dialog = await open();
  assert.equal(await dialog.getByLabel("Destination project").getAttribute("data-value"), gitProject);
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  assert.equal(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), true);
  const linkedDirectory = dialog.getByLabel("Worktree/directory");
  await linkedDirectory.click();
  assert.equal(await dialog.locator(`button[role="option"][data-value="${targetWorktree}"]`).isDisabled(), true);
  assert.equal(await dialog.locator(`button[role="option"][data-value="${gitProject}"]`).isDisabled(), false);
  await linkedDirectory.fill("feature");
  await linkedDirectory.press("Enter");
  // Reopening by keyboard resets the filter and skips the disabled source.
  await linkedDirectory.press("ArrowUp");
  await linkedDirectory.press("Enter");
  assert.equal(await linkedDirectory.getAttribute("data-value"), gitProject);
  await linkedDirectory.press("ArrowDown");
  await linkedDirectory.press("Enter");
  assert.equal(await linkedDirectory.getAttribute("data-value"), gitProject);
  assert.equal((await session()).cwd, targetWorktree);
  assert.equal(await page.locator(`button[title="Switch worktree: ${targetWorktree}"]`).count(), 1, "Proposing the primary directory must not switch the sidebar");
  await confirm(dialog, gitProject);

  // Plain project remains directly selectable. Browse can override it with
  // another existing non-Git directory, without invoking Move itself.
  dialog = await open();
  await choose("Destination project", project);
  await page.waitForFunction(() => !document.querySelector("#move-session-directory").disabled);
  assert.equal(await dialog.getByLabel("Worktree/directory").getAttribute("data-value"), project);
  const browse = async (path) => {
    // The runner is next dev/Strict Mode: DirectoryPicker starts two initial
    // reads. Waiting only for its first loading=false can race the second read
    // resetting the input. Settle both before editing the shared Browse form.
    let initialReads = 0;
    const initialReady = page.waitForEvent("requestfinished", {
      predicate: (request) => new URL(request.url()).pathname === "/api/cwd/browse" && ++initialReads === 2,
    });
    await dialog.getByRole("button", { name: "Browse another folder…" }).click();
    await initialReady;
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
  assert.equal(await dialog.getByLabel("Destination project").getAttribute("data-value"), "");
  assert.equal(await dialog.getByLabel("Worktree/directory").getAttribute("data-value"), browseDirectory);
  await confirm(dialog, browseDirectory);
}
