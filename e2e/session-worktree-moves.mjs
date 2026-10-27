import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { clickMoveWithProgress, waitForMoveControl } from "./session-move.mjs";

/** Extend the existing move scenario; all writes are synthetic sandbox fixtures. */
export async function checkSessionWorktreeMoves(page, { base, api, post, agentDir, otherProject, mobile }) {
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
  // Independent explicit directory admission, never inferred from report/store keys.
  await post("/api/cwd/validate", { cwd: main });
  await post("/api/cwd/validate", { cwd: live });
  await api("/api/sessions?force=1");
  const inventory = await api(`/api/sessions/worktrees?project=${encodeURIComponent(main)}`);
  assert.equal(inventory.mainCwd, main);
  assert.equal(inventory.worktrees.find(row => row.path === missing).state, "missing");
  assert.equal(inventory.worktrees.find(row => row.path === missing).sessionCount, 3);
  const search = await api(`/api/sessions/search?q=HISTORY_CANARY&status=active&projectKey=${encodeURIComponent(main)}&cwd=${encodeURIComponent(missing)}`);
  assert.deepEqual(new Set(search.results.map(hit => hit.session.id)), new Set([stale, missingChild]));
  assert.ok(search.results.every(hit => hit.session.cwd === missing && hit.familyArchived === false), "search shares exact worktree and archive scope");
  const original = new Map([stale, liveChild, archived, missingChild].map(id => [id, readFileSync(paths.get(id), "utf8")]));
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
  // Filter scope participates in selection lifetime.
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.locator(`[data-session-id="${stale}"]`).getByRole("checkbox").check();
  await filter.selectOption(live);
  assert.equal(await page.getByRole("button", { name: "Done", exact: true }).count(), 0);
  assert.equal(await page.locator(`[data-session-id="${stale}"]`).count(), 0);
  await filter.selectOption(missing);
  // The project-wide shortcut must ignore this Active-only, missing-only view.
  await page.getByLabel("Project session actions", { exact: true }).click();
  await page.getByRole("button", { name: "Move sessions from missing worktrees to main…", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Recover missing-worktree sessions", exact: true });
  await dialog.getByText("Move 4 sessions in 3 selected roots/subtrees (1 archived).", { exact: true }).waitFor();
  await dialog.getByText(`Destination: ${main}`, { exact: true }).waitFor();
  assert.equal((await api("/api/sessions?force=1")).sessions.find(row => row.id === stale).cwd, missing, "review must not move history");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await dialog.getByText("4 sessions moved; 0 roots already at destination; 0 roots failed.", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
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
  await filter.selectOption("");
  await page.getByRole("button", { name: "Select", exact: true }).click();
  for (const id of [bulkA, bulkB]) {
    const row = page.locator(`[data-session-id="${id}"]`); await row.scrollIntoViewIfNeeded(); await row.getByRole("checkbox").check();
  }
  await page.getByRole("button", { name: "Move…", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Move selected sessions", exact: true });
  assert.equal(await dialog.getByLabel("Destination project").getAttribute("data-value"), main);
  assert.equal(await dialog.getByLabel("Worktree/directory").getAttribute("data-value"), main);
  assert.equal(await dialog.getByRole("button", { name: "Move", exact: true }).isDisabled(), true, "preselection is not a move proposal");
  await waitForMoveControl(page, "#move-session-directory");
  await dialog.getByLabel("Worktree/directory").click();
  await dialog.locator(`button[role="option"][data-value="${main}"]`).click();
  await dialog.getByText("Move 1 sessions in 1 selected roots/subtrees (0 archived).", { exact: true }).waitFor();
  assert.equal((await api("/api/sessions?force=1")).sessions.find(row => row.id === bulkB).cwd, live, "bulk consolidation preview is proposal-only");
  // Browse must remain interactive inside the native modal's top-layer boundary.
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
  await clickMoveWithProgress(page, dialog, "/api/sessions/move", true);
  await dialog.getByText("2 sessions moved; 0 roots already at destination; 0 roots failed.", { exact: true }).waitFor();
  await dialog.getByRole("status").filter({ hasText: "Moving sessions…" }).waitFor({ state: "detached" });
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const bulkAfter = (await api("/api/sessions?force=1")).sessions;
  for (const id of [bulkA, bulkB]) assert.equal(bulkAfter.find(row => row.id === id).cwd, otherProject);
  // More than one execution request, with real packaged-service mutations.
  const openBulk = async (ids, activeId = anchor) => {
    await api("/api/sessions?force=1");
    await page.goto(`${base}/?session=${activeId}`, { waitUntil: "domcontentloaded" });
    if (mobile) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
    await page.getByLabel("Filter sessions by worktree", { exact: true }).selectOption("");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    for (const id of ids) {
      const row = page.locator(`[data-session-id="${id}"]`);
      await row.scrollIntoViewIfNeeded(); await row.getByRole("checkbox").check();
    }
    await page.getByRole("button", { name: "Move…", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Move selected sessions", exact: true });
    await modal.getByLabel("Destination project", { exact: true }).click();
    await modal.locator(`button[role="option"][data-value="${otherProject}"]`).click();
    await modal.getByText(`Move ${ids.length} sessions in ${ids.length} selected roots/subtrees (0 archived).`, { exact: true }).waitFor();
    return modal;
  };
  const bounded = Array.from({ length: 7 }, (_, i) => seed(`bounded-${i}`, main, null, false, true));
  const requests = [];
  const track = request => {
    if (new URL(request.url()).pathname === "/api/sessions/move" && request.method() === "POST") requests.push(request.postDataJSON());
  };
  page.on("request", track);
  dialog = await openBulk(bounded);
  await clickMoveWithProgress(page, dialog, "/api/sessions/move", true);
  await dialog.getByText("7 sessions moved; 0 roots already at destination; 0 roots failed.", { exact: true }).waitFor();
  page.off("request", track);
  assert.deepEqual(requests.filter(request => request.mode === "execute").map(request => request.rootIds.length), [5, 2]);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();

  // Lose the acknowledgement AFTER five actual moves. A read-only reconciliation
  // must follow, with no execution of the two remaining roots and no replay.
  const uncertain = Array.from({ length: 7 }, (_, i) => seed(`uncertain-${i}`, main, null, false, true));
  dialog = await openBulk(uncertain);
  const modes = [], executed = [];
  const moveMatcher = url => url.pathname === "/api/sessions/move";
  const loseAcknowledgement = async route => {
    const body = route.request().postDataJSON(); modes.push(body.mode);
    if (body.mode !== "execute") return route.continue();
    executed.push(...body.rootIds);
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    // Deliberately malformed successful response, not an ignored console/5xx.
    await route.fulfill({ status: 200, contentType: "text/html", body: "<html>Lost upstream acknowledgement</html>" });
  };
  await page.route(moveMatcher, loseAcknowledgement);
  try {
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "unreadable response" }).waitFor();
    await dialog.getByText("Current saved locations (observations, not execution receipts):", { exact: true }).waitFor();
    await dialog.getByRole("button", { name: "Close", exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector('dialog[aria-labelledby="bulk-move-title"] button')?.disabled === false);
    assert.deepEqual(modes, ["execute", "reconcile"]);
    assert.equal(executed.length, 5);
    const actual = (await api("/api/sessions?force=1")).sessions;
    for (const id of uncertain) assert.equal(actual.find(row => row.id === id).cwd, executed.includes(id) ? otherProject : main);
    assert.equal(await dialog.getByText(/All family members are at the destination\./).count(), 5);
    assert.equal(await dialog.getByRole("button", { name: "Move", exact: true }).count(), 0, "unknown work requires a new user review");
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  } finally { await page.unroute(moveMatcher, loseAcknowledgement); }
  // A whole project rename leaves history at a missing source path. Opening
  // its move dialog must not make an implicit worktree request to that path.
  const vanished = join(agentDir, `renamed-source-${suffix}`); mkdirSync(vanished);
  const renamedSession = seed("renamed-source", vanished, null, false, true);
  // Admit the synthetic project while it exists, as the original selected
  // project was before renaming. Newly seeded disk rows alone cannot refresh
  // an already-held allowed-root cache or grant physical directory access.
  await post("/api/cwd/validate", { cwd: vanished });
  renameSync(vanished, `${vanished}-new`);
  await api("/api/sessions?force=1");
  await page.goto(`${base}/?session=${renamedSession}`, { waitUntil: "domcontentloaded" });
  if (mobile) await page.getByRole("button", { name: "Show sidebar", exact: true }).click();
  const renamedRow = page.locator(`[data-session-id="${renamedSession}"]`); await renamedRow.scrollIntoViewIfNeeded();
  if (mobile) await renamedRow.getByRole("button", { name: "Session actions", exact: true }).click();
  else await renamedRow.hover();
  const sourceReads = [];
  const recordSourceRead = request => {
    const url = new URL(request.url());
    if (url.pathname === "/api/worktrees" && url.searchParams.get("cwd") === vanished) sourceReads.push(request.url());
  };
  page.on("request", recordSourceRead);
  try {
    await renamedRow.getByRole("button", { name: "Move to project…", exact: true }).click();
    const single = page.getByRole("dialog", { name: "Move to project…", exact: true });
    assert.equal(await single.getByLabel("Destination project").getAttribute("data-value"), vanished);
    assert.equal(await single.getByLabel("Worktree/directory").getAttribute("data-value"), vanished);
    assert.equal(await single.getByRole("button", { name: "Move", exact: true }).isDisabled(), true);
    assert.equal(await single.getByRole("alert").count(), 0);
    await single.getByLabel("Destination project").click();
    await single.locator(`button[role="option"][data-value="${main}"]`).click();
    await waitForMoveControl(page, "#move-session-directory");
    await clickMoveWithProgress(page, single, `/api/sessions/${renamedSession}/move`);
    await single.waitFor({ state: "detached" });
    assert.deepEqual(sourceReads, []);
    assert.equal((await api("/api/sessions?force=1")).sessions.find(row => row.id === renamedSession).cwd, main);
  } finally { page.off("request", recordSourceRead); }
  // Combined edge case: vanished source, committed execution, lost response,
  // and failed observation while that session is the selected chat. Do not
  // replace it with a source-bound working composer or assume the proposal won.
  const uncertainSource = join(agentDir, `uncertain-source-${suffix}`); mkdirSync(uncertainSource);
  const selectedUncertain = seed("selected-uncertain", uncertainSource, null, false, true);
  await post("/api/cwd/validate", { cwd: uncertainSource });
  renameSync(uncertainSource, `${uncertainSource}-new`);
  dialog = await openBulk([selectedUncertain], selectedUncertain);
  const sourceWorkingReads = [];
  const watchSourceReads = request => {
    const url = new URL(request.url());
    const working = ["/api/worktrees", "/api/models", "/api/project-trust"].includes(url.pathname) || url.pathname.startsWith("/api/files/") || url.pathname.startsWith("/api/git/");
    if (working && (url.searchParams.get("cwd") === uncertainSource || decodeURIComponent(url.pathname).includes(uncertainSource))) sourceWorkingReads.push(request.url());
  };
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
  console.log(`PASS: ${suffix} stale-worktree recovery, bounded moves, lost-ack observation and missing-source picker`);
}
