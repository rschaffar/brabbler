import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function waitForMoveControl(page, selector) {
  // A newly opening picker can be absent on the first poll. Absence is not ready.
  await page.waitForFunction((target) => document.querySelector(target)?.disabled === false, selector);
}

/** Hold the actual move request so even fast local moves expose their pending UI. */
export async function clickMoveWithProgress(page, dialog, pathname, bulk = false) {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let received;
  const intercepted = new Promise(resolve => { received = resolve; });
  let routeWork;
  let interceptionTimer;
  const matcher = url => url.pathname === pathname;
  const handler = async route => {
    if (bulk && route.request().postDataJSON()?.mode !== "execute") return route.continue();
    routeWork = (async () => { await held; await route.continue(); })();
    received();
    await routeWork;
  };
  await page.route(matcher, handler);
  try {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await Promise.race([intercepted, new Promise((_, reject) => {
      interceptionTimer = setTimeout(() => reject(new Error("Move request was not intercepted within 30000ms")), 30_000);
    })]);
    clearTimeout(interceptionTimer);
    const status = dialog.getByRole("status").filter({ hasText: bulk ? "Moving sessions…" : "Moving session…" });
    await status.waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
    assert.equal(await dialog.getByLabel("Destination project", { exact: true }).isDisabled(), true);
    const spinner = status.locator('svg[aria-hidden="true"]');
    assert.equal(await spinner.evaluate(node => getComputedStyle(node).animationName), "spin");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await spinner.evaluate(node => getComputedStyle(node).animationName), "none");
    await status.waitFor({ state: "visible" });
  } finally {
    clearTimeout(interceptionTimer);
    release();
    // Let the held request continue before removing its route handler.
    try { await routeWork; }
    finally {
      try { await page.unroute(matcher, handler); }
      finally { await page.emulateMedia({ reducedMotion: "no-preference" }); }
    }
  }
}

export async function checkSessionMovePicker(page, { base, api, post, agentDir, sessionId, project, otherProject, gitProject, targetWorktree, mobile }) {
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
  let progressChecked = false;
  const confirm = async (dialog, cwd) => {
    // One held request per physical input owns the animation/reduced-motion
    // ceremony. Subsequent native bridges need no duplicate gate/media sweep.
    if (!progressChecked) await clickMoveWithProgress(page, dialog, `/api/sessions/${encodeURIComponent(sessionId)}/move`);
    else await dialog.getByRole("button", { name: "Move", exact: true }).click();
    progressChecked = true;
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
    await waitForMoveControl(page, "#move-session-directory");
  };
  // Opening retains the source project/directory without proposing a no-op move.
  assert.equal(await projectSelect.getAttribute("data-value"), project);
  assert.equal(await directorySelect.getAttribute("data-value"), project);
  assert.equal(await move.isDisabled(), true);
  await waitForMoveControl(page, "#move-session-directory");
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
  await waitForMoveControl(page, "#move-session-directory");
  assert.equal(await projectSelect.getAttribute("data-value"), otherProject);

  assert.equal((await session()).cwd, project, "Project selection is proposal-only");
  assert.equal(await page.locator('button[title^="Switch worktree:"]').count(), 0, "Picker selection must not switch the sidebar's plain checkout");

  // The actual picker keyboard and native move remain; ignored-abort listing,
  // Retry and pending-Browse state now execute in their mounted owners.
  await select(gitProject);
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

  // The registered linked -> primary native/default bridge runs once. Both
  // physical inputs retain their own picker, keyboard and Browse interactions.
  if (!mobile) {
  dialog = await open();
  assert.equal(await dialog.getByLabel("Destination project").getAttribute("data-value"), gitProject);
  assert.equal(await dialog.getByLabel("Worktree/directory").getAttribute("data-value"), targetWorktree);
  await waitForMoveControl(page, "#move-session-directory");
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
  }

  // Plain project remains directly selectable. Browse can override it with
  // another existing non-Git directory, without invoking Move itself.
  dialog = await open();
  await choose("Destination project", project);
  await waitForMoveControl(page, "#move-session-directory");
  assert.equal(await dialog.getByLabel("Worktree/directory").getAttribute("data-value"), project);
  const browse = async (path) => {
    // Synchronize with the actual production read and settled form, not
    // development Strict Mode's duplicate effect invocation count.
    const initialReady = page.waitForResponse(response => new URL(response.url()).pathname === "/api/cwd/browse");
    await dialog.getByRole("button", { name: "Browse another folder…" }).click();
    await initialReady;
    const picker = page.getByRole("dialog", { name: "Select directory", exact: true });
    const go = picker.getByRole("button", { name: "Go", exact: true });
    await waitForMoveControl(page, '.directory-picker-panel button[type="submit"]');
    await picker.getByLabel("Directory path").fill(path);
    const navigated = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/cwd/browse" && url.searchParams.get("path") === path;
    });
    await go.click();
    await navigated;
    await waitForMoveControl(page, '.directory-picker-panel button[type="submit"]');
    await picker.getByRole("button", { name: "Select this folder", exact: true }).click();
    await picker.waitFor({ state: "detached" });
  };
  const sourceCwd = mobile ? targetWorktree : gitProject;
  await browse(sourceCwd);
  assert.equal(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), true, "Browse also excludes the exact source");
  const browseDirectory = `${project}/browse-only`;
  await browse(browseDirectory);
  assert.equal((await session()).cwd, sourceCwd);
  assert.equal(await dialog.getByLabel("Destination project").getAttribute("data-value"), "");
  assert.equal(await dialog.getByLabel("Worktree/directory").getAttribute("data-value"), browseDirectory);
  await confirm(dialog, browseDirectory);
  await checkWorktreeMoveBridges(page, { base, api, post, agentDir, otherProject, mobile });
}

/** Original native fixtures, narrowed to recovery/default and modal bridges.
 * Batching, lost-ACK policy and missing-source picker matrices execute below.
 * The selected-uncertain full-shell slice remains at both original inputs:
 * NavigationHarness is NOT AppShell/ChatWindow/FileWorkspace/native commit.
 */
async function checkWorktreeMoveBridges(page, { base, api, post, agentDir, otherProject, mobile }) {
  const suffix = mobile ? "mobile" : "desktop";
  const main = join(agentDir, `session-tools-${suffix}`), missing = `${main}-worktrees/missing`, live = `${main}-worktrees/live`;
  mkdirSync(main);
  const git = (...args) => execFileSync("git", ["-C", main, ...args], { timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-qb", "main"); git("-c", "user.name=Synthetic", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "fixture");
  git("worktree", "add", "-qb", "missing", missing); git("worktree", "add", "-qb", "live", live);
  const paths = new Map();
  const seed = (name, cwd, parent, archived = false, recent = false) => {
    const id = `e2e-tools-${suffix}-${name}`, stamp = recent ? new Date().toISOString() : "2026-01-01T00:00:00.000Z";
    const directory = join(agentDir, "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
    mkdirSync(directory, { recursive: true });
    const path = join(directory, `2026-01-01T00-00-00-000Z_${id}.jsonl`); paths.set(id, path);
    const records = [{ type: "session", version: 3, id, timestamp: stamp, cwd, ...(parent ? { parentSession: paths.get(parent) } : {}) },
      { type: "message", id: "user", parentId: null, timestamp: stamp, message: { role: "user", content: `Session tools ${name} HISTORY_CANARY`, timestamp: Date.parse(stamp) } },
      { type: "message", id: "reply", parentId: "user", timestamp: stamp, message: { role: "assistant", content: [{ type: "text", text: "Synthetic saved reply" }], timestamp: Date.parse(stamp) } }];
    if (parent) records.splice(1, 0, { type: "custom", customType: "brabbler:subagent", id: "relation", parentId: null, timestamp: stamp,
      data: { version: 1, parentSessionId: parent, parentSessionPath: paths.get(parent), profile: "explore", description: name } });
    if (archived) records.push({ type: "custom", customType: "brabbler:archive", id: "archive", parentId: "reply", timestamp: stamp, data: { version: 1, archived: true } });
    writeFileSync(path, records.map(record => JSON.stringify(record)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    return id;
  };
  const anchor = seed("anchor", main), stale = seed("stale", missing), liveChild = seed("live-child", live, stale),
    archived = seed("archived", missing, null, true), missingChild = seed("missing-child", missing, anchor),
    bulkA = seed("bulk-a", main), bulkB = seed("bulk-b", live);
  git("worktree", "remove", missing); git("worktree", "prune");
  await post("/api/cwd/validate", { cwd: main });
  await post("/api/cwd/validate", { cwd: live });
  await api("/api/sessions?force=1");
  await page.goto(`${base}/?session=${anchor}`, { waitUntil: "domcontentloaded" });
  if (mobile) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  const filter = page.getByLabel("Filter sessions by worktree", { exact: true });
  await filter.locator(`option[value="${missing}"]`).waitFor({ state: "attached" });
  assert.match(await filter.locator(`option[value="${missing}"]`).innerText(), /Directory missing/);
  const checkout = page.locator(`button[title="Switch worktree: ${main}"]`);
  await checkout.waitFor();
  await filter.selectOption(missing);
  await page.locator(`[data-session-id="${stale}"]`).waitFor();
  await page.locator(`[data-session-id="${missingChild}"]`).waitFor();
  assert.equal(await page.locator(`[data-session-id="${anchor}"]`).count(), 0);
  assert.equal(await page.locator(`[data-session-id="${archived}"]`).count(), 0);
  assert.equal(await checkout.count(), 1, "history filter must not change working checkout");
  assert.equal(await page.locator(`button[title="Switch worktree: ${missing}"]`).count(), 0);

  if (mobile) {
    // Keep the compact project-actions/top-layer path, without duplicating the
    // native recovery execution. Opening and cancelling must remain proposal-only.
    await page.getByLabel("Project session actions", { exact: true }).click();
    await page.getByRole("button", { name: "Move sessions from missing worktrees to main…", exact: true }).click();
    const recovery = page.getByRole("dialog", { name: "Recover missing-worktree sessions", exact: true });
    await recovery.getByText("Move 4 sessions in 3 selected roots/subtrees (1 archived).", { exact: true }).waitFor();
    await recovery.getByRole("button", { name: "Cancel", exact: true }).click();
    await recovery.waitFor({ state: "detached" });
  }

  if (!mobile) {
    const inventory = await api(`/api/sessions/worktrees?project=${encodeURIComponent(main)}`);
    assert.equal(inventory.mainCwd, main);
    assert.equal(inventory.worktrees.find(row => row.path === missing).state, "missing");
    assert.equal(inventory.worktrees.find(row => row.path === missing).sessionCount, 3);
    const search = await api(`/api/sessions/search?q=HISTORY_CANARY&status=active&projectKey=${encodeURIComponent(main)}&cwd=${encodeURIComponent(missing)}`);
    assert.deepEqual(new Set(search.results.map(hit => hit.session.id)), new Set([stale, missingChild]));
    assert.ok(search.results.every(hit => hit.session.cwd === missing && hit.familyArchived === false), "search shares exact worktree and archive scope");
    const original = new Map([stale, liveChild, archived, missingChild].map(id => [id, readFileSync(paths.get(id), "utf8")]));
    // One real project-wide missing-only shortcut, including archived and
    // missing-child subtrees, crosses the installed native/default boundary.
    await page.getByLabel("Project session actions", { exact: true }).click();
    await page.getByRole("button", { name: "Move sessions from missing worktrees to main…", exact: true }).click();
    const recovery = page.getByRole("dialog", { name: "Recover missing-worktree sessions", exact: true });
    await recovery.getByText("Move 4 sessions in 3 selected roots/subtrees (1 archived).", { exact: true }).waitFor();
    await recovery.getByText(`Destination: ${main}`, { exact: true }).waitFor();
    assert.equal((await api("/api/sessions?force=1")).sessions.find(row => row.id === stale).cwd, missing, "review must not move history");
    await recovery.getByRole("button", { name: "Move", exact: true }).click();
    await recovery.getByText("4 sessions moved; 0 roots already at destination; 0 roots failed.", { exact: true }).waitFor();
    await recovery.getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(existsSync(missing), false);
    const after = (await api("/api/sessions?force=1")).sessions;
    for (const id of original.keys()) {
      const moved = after.find(row => row.id === id); assert.equal(moved.cwd, main);
      const content = readFileSync(moved.path, "utf8");
      const expectedUser = original.get(id).split("\n").find(line => line.includes("HISTORY_CANARY"));
      assert.equal(content.split("\n").find(line => line.includes("HISTORY_CANARY")), expectedUser, "history remains byte-identical");
      if (id === archived) assert.equal(moved.archived, true);
    }
    assert.equal(after.find(row => row.id === anchor).cwd, main, "missing child recovery leaves its parent in place");
  }

  await filter.selectOption("");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  for (const id of [bulkA, bulkB]) {
    const row = page.locator(`[data-session-id="${id}"]`); await row.scrollIntoViewIfNeeded(); await row.getByRole("checkbox").check();
  }
  await page.getByRole("button", { name: "Move…", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Move selected sessions", exact: true });
  assert.equal(await dialog.getByLabel("Destination project").getAttribute("data-value"), main);
  assert.equal(await dialog.getByLabel("Worktree/directory").getAttribute("data-value"), main);
  assert.equal(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), true);
  await waitForMoveControl(page, "#move-session-directory");
  await dialog.getByLabel("Worktree/directory").click();
  await dialog.locator(`button[role="option"][data-value="${main}"]`).click();
  await dialog.getByText("Move 1 sessions in 1 selected roots/subtrees (0 archived).", { exact: true }).waitFor();
  assert.equal((await api("/api/sessions?force=1")).sessions.find(row => row.id === bulkB).cwd, live, "bulk consolidation preview is proposal-only");
  // Native modal top-layer interaction must work at both original inputs.
  await dialog.getByRole("button", { name: "Browse another folder…", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Select directory", exact: true });
  await waitForMoveControl(page, '.directory-picker-panel button[type="submit"]');
  await picker.getByLabel("Directory path").fill(otherProject);
  const navigated = page.waitForResponse(response => {
    const url = new URL(response.url()); return url.pathname === "/api/cwd/browse" && url.searchParams.get("path") === otherProject;
  });
  await picker.getByRole("button", { name: "Go", exact: true }).click(); await navigated;
  await waitForMoveControl(page, '.directory-picker-panel button[type="submit"]');
  await picker.getByRole("button", { name: "Select this folder", exact: true }).click();
  await picker.waitFor({ state: "detached" });
  await dialog.getByText("Move 2 sessions in 2 selected roots/subtrees (0 archived).", { exact: true }).waitFor();
  // Bulk has its own status/spinner markup: retain one genuine pending CSS
  // ceremony, not the later bounded/uncertain matrix's repeated gates.
  await clickMoveWithProgress(page, dialog, "/api/sessions/move", true);
  await dialog.getByText("2 sessions moved; 0 roots already at destination; 0 roots failed.", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const bulkAfter = (await api("/api/sessions?force=1")).sessions;
  for (const id of [bulkA, bulkB]) assert.equal(bulkAfter.find(row => row.id === id).cwd, otherProject);

  {
    // Retain only the original unbound full-shell/native receiving boundary,
    // at each input; no claim that a desktop NavigationHarness closes mobile.
    const uncertainSource = join(agentDir, `uncertain-source-${suffix}`); mkdirSync(uncertainSource);
    const selectedUncertain = seed("selected-uncertain", uncertainSource, null, false, true);
    await post("/api/cwd/validate", { cwd: uncertainSource });
    renameSync(uncertainSource, `${uncertainSource}-new`);
    await api("/api/sessions?force=1");
    await page.goto(`${base}/?session=${selectedUncertain}`, { waitUntil: "domcontentloaded" });
    if (mobile) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    await page.getByLabel("Filter sessions by worktree", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const row = page.locator(`[data-session-id="${selectedUncertain}"]`);
    await row.scrollIntoViewIfNeeded(); await row.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Move…", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Move selected sessions", exact: true });
    await dialog.getByLabel("Destination project", { exact: true }).click();
    await dialog.locator(`button[role="option"][data-value="${otherProject}"]`).click();
    await dialog.getByText("Move 1 sessions in 1 selected roots/subtrees (0 archived).", { exact: true }).waitFor();
    const sourceWorkingReads = [];
    const watchSourceReads = request => {
      const url = new URL(request.url());
      const working = ["/api/worktrees", "/api/models", "/api/project-trust"].includes(url.pathname) || url.pathname.startsWith("/api/files/") || url.pathname.startsWith("/api/git/");
      if (working && (url.searchParams.get("cwd") === uncertainSource || decodeURIComponent(url.pathname).includes(uncertainSource))) sourceWorkingReads.push(request.url());
    };
    const moveMatcher = url => url.pathname === "/api/sessions/move";
    const loseBothResponses = async route => {
      const body = route.request().postDataJSON();
      if (body.mode === "execute") assert.equal((await route.fetch()).status(), 200);
      else assert.equal(body.mode, "reconcile");
      await route.fulfill({ status: 200, contentType: "text/html", body: "<html>Uncertain response</html>" });
    };
    page.on("request", watchSourceReads); await page.route(moveMatcher, loseBothResponses);
    try {
      await dialog.getByRole("button", { name: "Move", exact: true }).click();
      await dialog.getByRole("alert").filter({ hasText: "unreadable response" }).waitFor();
      await page.waitForFunction(() => document.querySelector('dialog[aria-labelledby="bulk-move-title"] button')?.disabled === false);
      assert.equal((await api("/api/sessions?force=1")).sessions.find(row => row.id === selectedUncertain).cwd, otherProject);
      assert.equal(await dialog.getByRole("alert").filter({ hasText: "Could not refresh the session list" }).count(), 0);
      await dialog.getByRole("button", { name: "Close", exact: true }).click();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual(sourceWorkingReads, []);
      assert.notEqual(new URL(page.url()).searchParams.get("cwd"), uncertainSource);
    } finally { page.off("request", watchSourceReads); await page.unroute(moveMatcher, loseBothResponses); }
  }
}
