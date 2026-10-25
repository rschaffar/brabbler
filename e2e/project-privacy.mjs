import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { sidebarReady } from "./sidebar-readiness.mjs";
import { createOwnedRoutes } from "./owned-routes.mjs";

export async function checkProjectPrivacy(page, width, { base, api, post, harness, selectedSessionId, otherSessionId }) {
  const mobile = width <= 640;
  const failures = [], runningRoutes = [];
  const runningPattern = "**/api/agent/running";
  let primary, primaryFailed = false, peerContext;
  const registerRunning = async (routePage, handle) => {
    const owner = createOwnedRoutes(handle, handle);
    const acknowledgements = [];
    // Record BEFORE registration awaits: route() can reject after admission.
    const record = { routePage, owner, acknowledgements, adapter: null, settlement: null };
    const adapter = route => {
      // Transport ACK only. The SAME original rejection remains owned and live.
      const acknowledged = owner.handler(route).then(undefined, error => { failures.push(error); });
      acknowledgements.push(acknowledged);
      return acknowledged;
    };
    record.adapter = adapter;
    runningRoutes.push(record);
    await routePage.route(runningPattern, adapter);
    return record;
  };
  const settleRunning = record => record.settlement ??= (async () => {
    // No held routes/release gates here. dispose joins original callback work,
    // unregisters this EXACT adapter, then joins callbacks admitted during removal.
    try { await record.owner.dispose(() => record.routePage.unroute(runningPattern, record.adapter)); }
    catch (error) { failures.push(error); }
    // The Playwright ACK is a separate promise; join it even if disposal failed.
    let joined = 0;
    while (joined < record.acknowledgements.length) {
      const admitted = record.acknowledgements.slice(joined);
      joined += admitted.length;
      const results = await Promise.allSettled(admitted);
      for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    }
  })();
  try {
  const { sessions } = await api("/api/sessions?force=1");
  const project = sessions.find((session) => session.id === selectedSessionId);
  const key = project.projectKey ?? project.projectRoot ?? project.cwd;
  const path = project.projectRoot ?? project.cwd;
  const region = () => page.getByRole("region", { name: "Activity" });
  const privateRow = () => region().locator(".activity-item-working").filter({ hasText: "Branch root" });
  const publicRow = () => region().locator(".activity-item-working").filter({ hasText: "Other workspace task" });
  const openActivity = async () => {
    await page.getByRole("button", { name: /^Activity/ }).click();
    await publicRow().waitFor();
  };
  const openSettings = async () => {
    const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await waitForAsyncCondition(page, sidebarReady);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    if (mobile) await dialog.getByRole("combobox", { name: "Settings", exact: true }).selectOption("general");
    else await dialog.getByRole("button", { name: "General", exact: true }).click();
    await dialog.getByRole("searchbox", { name: "Search projects by name or path" }).fill(path);
    return dialog.getByRole("switch", { name: `Hide project · ${path} from Activity`, exact: true });
  };
  const closeSettings = async () => {
    await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
    const backdrop = page.locator(".sidebar-overlay-backdrop");
    if (await backdrop.isVisible()) await backdrop.click({ position: { x: width - 10, y: 200 } });
  };
  const saveSwitch = async (control, hidden) => {
    const saved = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/hidden-projects" && response.request().method() === "POST");
    // Observe the ORIGINAL wait and its complete body immediately, before click.
    // Neither a response event nor a failed body is native write-completion proof.
    const readFailures = [], clickFailures = [];
    const read = saved.then(async response => { await response.json(); return response; });
    const readAcknowledged = read.then(undefined, error => { readFailures.push(error); });
    try { await control.click(); }
    catch (error) { clickFailures.push(error); }
    // Click failure cannot bypass the accepted response/body join. A missing
    // response uses the EXISTING observation timeout, never cancellation/replay.
    const [body, acknowledgement] = await Promise.allSettled([read, readAcknowledged]);
    const saveFailures = [...clickFailures, ...readFailures];
    if (body.status === "rejected" && !readFailures.includes(body.reason)) saveFailures.push(body.reason);
    if (acknowledgement.status === "rejected") saveFailures.push(acknowledgement.reason);
    if (body.status === "fulfilled") {
      try { assert.equal(body.value.status(), 200); }
      catch (error) { saveFailures.push(error); }
    }
    // Deterministic original-reference order: click, body/wait, ACK, status.
    if (saveFailures.length === 1) throw saveFailures[0];
    if (saveFailures.length) throw new AggregateError(saveFailures, "Privacy save click and complete response observation failed");
    await page.waitForFunction(({ path, checked }) => [...document.querySelectorAll('[role="switch"]')]
      .some((element) => element.getAttribute("aria-label") === `Hide project · ${path} from Activity` && element.getAttribute("aria-checked") === String(checked) && !element.disabled), { path, checked: hidden });
  };
  const assertConcealed = async () => {
    await publicRow().waitFor();
    assert.equal(await privateRow().count(), 0);
    const html = await region().innerHTML();
    assert.ok(!html.includes(path) && !html.includes("Branch root"), "private paths/titles must not remain in Activity DOM or options");
    assert.equal(await region().getByRole("combobox", { name: "Project" }).locator("option").filter({ hasText: /^project$/ }).count(), 0);
    assert.equal(await region().getByRole("heading", { name: "Working 1", exact: true }).count(), 1);
    assert.equal(await region().getByRole("button", { name: "Show hidden projects", exact: true }).getAttribute("aria-pressed"), "false");
  };

  // Only registry snapshots are mocked. Privacy saves/readback use the real server file.
  // Capture once: awaiting route.fetch() inside each poll races this fixture's page reloads.
  const runningSnapshot = { ...await api("/api/agent/running"), runningSessionIds: [selectedSessionId, otherSessionId] };
  const mockRunning = (route) => route.fulfill({ status: 200, contentType: "application/json", json: runningSnapshot });
  await registerRunning(page, mockRunning);
  await page.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  await openActivity();
  await privateRow().waitFor();
  let control = await openSettings();
  assert.equal(await control.getAttribute("aria-checked"), "false");
  await saveSwitch(control, true);
  assert.ok((await api("/api/hidden-projects")).keys.includes(key));
  await closeSettings();
  await assertConcealed();

  // Native keyboard reveal and real visible privacy marker stay in Chromium.
  const eye = region().getByRole("button", { name: "Show hidden projects", exact: true });
  await eye.focus();
  await eye.press("Space");
  await privateRow().waitFor();
  assert.equal(await privateRow().locator(".activity-private-marker").count(), 1);
  if (mobile) {
    await privateRow().click();
    await page.getByRole("button", { name: "Back to Activity" }).click();
  } else {
    await region().getByRole("button", { name: "Close Activity", exact: true }).click();
    await openActivity();
  }
  await privateRow().waitFor();
  assert.equal(await region().getByRole("button", { name: "Conceal hidden projects", exact: true }).getAttribute("aria-pressed"), "true");

  // Reload restores only this browser's reveal preference.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  await openActivity();
  await privateRow().waitFor();
  assert.equal(await region().getByRole("button", { name: "Conceal hidden projects", exact: true }).getAttribute("aria-pressed"), "true");
  control = await openSettings();
  assert.equal(await control.getAttribute("aria-checked"), "true");
  await closeSettings();

  // Keep true/false restoration in this exact browser input, not synthetic
  // loading/error/retry permutations. Actual hook/Activity owners cover those.
  await region().getByRole("button", { name: "Conceal hidden projects", exact: true }).click();
  await assertConcealed();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  await openActivity();
  await assertConcealed();

  // Hidden-project settings are shared, but reveal is independent per browser.
  if (width === 1280) {
    await region().getByRole("button", { name: "Show hidden projects", exact: true }).click();
    await privateRow().waitFor();
    peerContext = await harness.newContext(page.context().browser(), { viewport: { width, height: 900 }, locale: "en-US" }, base);
      const peer = await peerContext.newPage();
      // Keep the original page Error, not a copied message/snapshot. These live
      // collectors remain attached through route/body/ACK joins and peer close.
      peer.on("pageerror", (error) => { failures.push(error); });
      peer.on("console", (event) => { if (event.type() === "error") failures.push(new Error(event.text())); });
      peer.on("response", (response) => { if (response.url().startsWith(base) && response.status() >= 500) failures.push(new Error(`${response.status()} ${response.url()}`)); });
      await registerRunning(peer, mockRunning);
      await peer.goto(`${base}/?session=${selectedSessionId}`, { waitUntil: "domcontentloaded" });
      await peer.getByText("Active branch answer", { exact: true }).waitFor();
      await peer.getByRole("button", { name: /^Activity/ }).click();
      const peerRegion = peer.getByRole("region", { name: "Activity" });
      await peerRegion.getByRole("button", { name: "Show hidden projects", exact: true }).waitFor();
      await peerRegion.locator(".activity-item-working").filter({ hasText: "Other workspace task" }).waitFor();
      assert.equal(await peerRegion.locator(".activity-item-working").filter({ hasText: "Branch root" }).count(), 0);
      assert.equal(await peerRegion.getByRole("combobox", { name: "Project" }).locator("option").filter({ hasText: /^project$/ }).count(), 0);
      await peerRegion.getByRole("button", { name: "Show hidden projects", exact: true }).click();
      await peerRegion.locator(".activity-item-working").filter({ hasText: "Branch root" }).waitFor();
      await region().getByRole("button", { name: "Conceal hidden projects", exact: true }).click();
      await assertConcealed();
      await peer.reload({ waitUntil: "domcontentloaded" });
      await peer.getByText("Active branch answer", { exact: true }).waitFor();
      await peer.getByRole("button", { name: /^Activity/ }).click();
      await peerRegion.getByRole("button", { name: "Conceal hidden projects", exact: true }).waitFor();
      await peerRegion.locator(".activity-item-working").filter({ hasText: "Branch root" }).waitFor();
      await post("/api/hidden-projects", { key, hidden: false });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await privateRow().waitFor();
  } else {
    control = await openSettings();
    await saveSwitch(control, false);
    await closeSettings();
    await privateRow().waitFor();
  }
  assert.equal((await api("/api/hidden-projects")).keys.includes(key), false);
  await region().getByRole("button", { name: "Close Activity", exact: true }).click();
  } catch (error) {
    primary = error; primaryFailed = true;
  } finally {
    // Every page gets an independent exact unregister/full original-work/ACK
    // join, including partially rejected registration and a failed main action.
    for (const record of runningRoutes) {
      try { await settleRunning(record); }
      catch (error) { failures.push(error); }
    }
    // All main AND peer owned route work precedes this owned peer close. A
    // close failure cannot skip main cleanup or replace an original primary.
    if (peerContext) {
      try { await harness.closeContext(peerContext); }
      catch (error) { failures.push(error); }
    }
  }
  const errors = primaryFailed ? [primary, ...failures] : failures;
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Privacy browser journey and independent route/context settlement failed");
  console.log(`PASS: ${width}px persistent hidden projects, safe loading, browser-local reveal and restoration`);
}
