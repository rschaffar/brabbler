import assert from "node:assert/strict";

export async function checkProjectPrivacy(page, width, { base, api, post, harness, selectedSessionId, otherSessionId }) {
  const mobile = width <= 640;
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
    await control.click();
    assert.equal((await saved).status(), 200);
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
  await page.route("**/api/agent/running", mockRunning);
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

  // Keyboard reveal, visible privacy marker, and conceal resets a private project filter.
  const eye = region().getByRole("button", { name: "Show hidden projects", exact: true });
  await eye.focus();
  await eye.press("Space");
  await privateRow().waitFor();
  assert.equal(await privateRow().locator(".activity-private-marker").count(), 1);
  await region().getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });
  await region().getByRole("button", { name: "Conceal hidden projects", exact: true }).click();
  assert.equal(await region().getByRole("combobox", { name: "Project" }).inputValue(), "");
  await assertConcealed();

  await region().getByRole("button", { name: "Show hidden projects", exact: true }).click();
  await privateRow().waitFor();
  await region().getByRole("combobox", { name: "Project" }).selectOption({ label: "project" });

  // Focus/visibility reloads withhold private rows until settings are known,
  // but must not forget the browser's reveal preference or project filter.
  let releaseFocusRead;
  const focusRead = new Promise((resolve) => { releaseFocusRead = resolve; });
  const holdPrivacyRead = async (route) => {
    await focusRead;
    await route.fulfill({ status: 200, contentType: "application/json", json: { keys: [key] } });
  };
  await page.route("**/api/hidden-projects", holdPrivacyRead);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await region().getByText("Loading project privacy settings…", { exact: true }).waitFor();
  assert.equal(await region().locator(".activity-item").count(), 0);
  releaseFocusRead();
  await privateRow().waitFor();
  assert.equal(await region().getByRole("combobox", { name: "Project" }).inputValue(), key);
  await page.unroute("**/api/hidden-projects", holdPrivacyRead);
  await region().getByRole("combobox", { name: "Project" }).selectOption("");

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

  // Privacy loading and an invalid response must never render private Activity.
  let releaseRead;
  const heldRead = new Promise((resolve) => { releaseRead = resolve; });
  await page.route("**/api/hidden-projects", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await heldRead;
    await route.fulfill({ status: 200, contentType: "application/json", json: { keys: [17] } });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^Activity/ }).click();
  await region().getByText("Loading project privacy settings…", { exact: true }).waitFor();
  assert.equal(await region().locator(".activity-item").count(), 0);
  assert.equal(await region().getByRole("button", { name: "Show hidden projects", exact: true }).isDisabled(), true);
  releaseRead();
  await region().getByRole("alert").waitFor();
  assert.equal(await region().locator(".activity-item").count(), 0);
  await page.unroute("**/api/hidden-projects");
  await region().getByRole("button", { name: "Retry", exact: true }).click();
  await privateRow().waitFor();
  await region().getByRole("button", { name: "Conceal hidden projects", exact: true }).click();
  await assertConcealed();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  await openActivity();
  await assertConcealed();

  // A failed save cannot optimistically reveal, silently reset storage, or keep stale rows.
  control = await openSettings();
  await page.route("**/api/hidden-projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 200, contentType: "application/json", json: { keys: null } });
  });
  await control.click();
  await page.getByRole("dialog", { name: "Settings", exact: true }).getByRole("alert").waitFor();
  assert.ok((await api("/api/hidden-projects")).keys.includes(key), "failed unhide must preserve server settings");
  await closeSettings();
  assert.equal(await region().locator(".activity-item").count(), 0);
  await page.unroute("**/api/hidden-projects");
  await region().getByRole("button", { name: "Retry", exact: true }).click();
  await assertConcealed();

  // Hidden-project settings are shared, but reveal is independent per browser.
  if (width === 1280) {
    await region().getByRole("button", { name: "Show hidden projects", exact: true }).click();
    await privateRow().waitFor();
    const peerContext = await harness.newContext(page.context().browser(), { viewport: { width, height: 900 }, locale: "en-US" }, base);
    try {
      const peer = await peerContext.newPage();
      const peerErrors = [];
      peer.on("pageerror", (error) => peerErrors.push(error.message));
      peer.on("console", (event) => { if (event.type() === "error") peerErrors.push(event.text()); });
      peer.on("response", (response) => { if (response.url().startsWith(base) && response.status() >= 500) peerErrors.push(`${response.status()} ${response.url()}`); });
      await peer.route("**/api/agent/running", mockRunning);
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
      assert.deepEqual(peerErrors, [], "fresh-browser privacy errors");
    } finally { await harness.closeContext(peerContext); }
  } else {
    control = await openSettings();
    await saveSwitch(control, false);
    await closeSettings();
    await privateRow().waitFor();
  }
  assert.equal((await api("/api/hidden-projects")).keys.includes(key), false);
  if (width === 1280) {
    // Hold a background poll's old visible snapshot across a newer hide save.
    control = await openSettings();
    let resume, signal;
    const held = new Promise((resolve) => { resume = resolve; });
    let captureTimeout;
    const captured = new Promise((resolve, reject) => {
      signal = resolve;
      captureTimeout = setTimeout(() => reject(new Error("Privacy background poll did not arrive")), 30_000);
    });
    const handler = async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const snapshot = await response.json();
      signal();
      await held;
      await route.fulfill({ response, json: snapshot });
    };
    await page.route("**/api/hidden-projects", handler);
    try {
      await captured;
      clearTimeout(captureTimeout);
      await saveSwitch(control, true);
      await closeSettings();
      await assertConcealed();
      const lateRead = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/hidden-projects" && response.request().method() === "GET");
      resume();
      await lateRead;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertConcealed();
    } finally {
      clearTimeout(captureTimeout);
      resume();
      await page.unroute("**/api/hidden-projects", handler);
    }
    control = await openSettings();
    await saveSwitch(control, false);
    await closeSettings();
    await privateRow().waitFor();
  }
  await page.unroute("**/api/agent/running");
  await region().getByRole("button", { name: "Close Activity", exact: true }).click();
  console.log(`PASS: ${width}px persistent hidden projects, safe loading, browser-local reveal and restoration`);
}
