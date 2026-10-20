import assert from "node:assert/strict";

/** Isolated tab: never disturb the existing reading/history assertion chain. */
export async function checkUpstreamComposer(context, base, sessionId, alternateSessionId, width) {
  const page = await context.newPage();
  try {
    const modelList = Array.from({ length: 12 }, (_, i) => ({ provider: i === 11 ? "relay-fixture" : "fixture", id: `model-${i}`, name: `Fixture model ${i}` }));
    await page.route(/\/api\/models(?:\?|$)/, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      await route.fulfill({ response, json: { ...data, modelList, models: Object.fromEntries(modelList.map((m) => [`${m.provider}/${m.id}`, m.name])) } });
    });
    await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
    const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
    assert.equal(manifest.name, "E2E Pi Desk", "installed package reads the launch environment, not the build environment");
    assert.equal(manifest.short_name, "E2E Pi Desk");
    assert.equal(manifest.id, "/");
    const input = page.locator(".chat-input-textarea");
    await input.waitFor();
    await page.locator(".model-selector.is-toolbar").getByRole("button").click();
    const filter = page.getByRole("textbox", { name: "Filter models" });
    await filter.waitFor();
    assert.equal(await filter.evaluate((node) => document.activeElement === node), width > 640, "desktop autofocus only");
    await filter.fill(" RELAY-FIXTURE/model-11 ");
    const listbox = page.getByRole("listbox");
    await listbox.getByRole("option", { name: "Fixture model 11", exact: true }).waitFor();
    assert.equal(await listbox.getByRole("option").count(), 1);
    // Toggle the picker closed: its portal can cover the textarea's click point.
    // Never select a synthetic model or invoke a provider.
    await page.locator(".model-selector.is-toolbar").getByRole("button").click();
    await filter.waitFor({ state: "hidden" });
    const newline = width <= 640 ? "Enter" : "Shift+Enter";
    for (const [before, after] of [
      ["9. ninth", "9. ninth\n10. "], ["- [x] finished", "- [x] finished\n- [ ] "],
      ["1. first\n2. ", "1. first\n"], ["```\n- code", "```\n- code\n"],
      ["    - indented code", "    - indented code\n"],
    ]) {
      await input.fill(before);
      await input.press("End");
      await input.press(newline);
      assert.equal(await input.inputValue(), after, before);
    }
    await input.fill("1. undo fixture");
    await input.press("End");
    await input.press(newline);
    assert.equal(await input.inputValue(), "1. undo fixture\n2. ");
    await input.press("Control+z");
    assert.equal(await input.inputValue(), "1. undo fixture", "list insertion remains a native undo unit");
    await input.press("Control+Shift+z");
    assert.equal(await input.inputValue(), "1. undo fixture\n2. ");

    await input.fill("1. select this");
    await input.evaluate((node) => node.setSelectionRange(3, 14));
    await input.press(newline);
    assert.equal(await input.inputValue(), "1. \n", "selections retain native replacement behavior");

    await input.fill("1. unsupported command");
    await input.press("End");
    await page.evaluate(() => { window.__nativeExecCommand = document.execCommand; document.execCommand = () => false; });
    try {
      await input.press(newline);
      assert.equal(await input.inputValue(), "1. unsupported command\n", "unsupported editing must not swallow a newline");
    } finally {
      await page.evaluate(() => { document.execCommand = window.__nativeExecCommand; delete window.__nativeExecCommand; });
    }

    await input.fill("1. composition");
    await input.evaluate((node) => {
      node.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertLineBreak", isComposing: false });
      node.dispatchEvent(event);
      if (event.defaultPrevented) throw new Error("list continuation intercepted an IME confirmation");
      node.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    assert.equal(await input.inputValue(), "1. composition");
    await input.fill("upstream-list-draft\n2. retained");
    // Drafts are deliberately memory-only: use SPA session changes, not reload.
    const selectSession = async (id) => {
      const show = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await show.isVisible()) await show.click();
      await page.locator(`.session-row[data-session-id="${id}"]`).click({ position: { x: 12, y: 12 } });
      await page.waitForFunction((id) => new URL(location.href).searchParams.get("session") === id, id);
    };
    await selectSession(alternateSessionId);
    await selectSession(sessionId);
    await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "upstream-list-draft\n2. retained");
    await input.fill("");
    console.log(`PASS: ${width}px provider search, picker focus, list newline/undo/IME/fallback and SPA draft retention`);
  } finally { await page.close(); }
}

export async function checkOverflowTabs(page) {
  const panel = page.locator("#file-panel");
  for (let i = 0; i < 12; i++) {
    const hide = panel.getByRole("button", { name: "Hide file panel", exact: true, includeHidden: true });
    if (await hide.getAttribute("aria-expanded") === "true") await hide.click();
    await page.getByRole("link", { name: `Overflow tab ${i}`, exact: true }).click();
    await panel.getByRole("tab", { name: `upstream-overflow-tab-${i}.txt`, exact: true }).waitFor();
  }
  const list = panel.getByRole("tablist");
  assert.ok(await list.evaluate((node) => node.scrollWidth > node.clientWidth), "fixture must genuinely overflow");
  const last = list.getByRole("tab", { name: "upstream-overflow-tab-11.txt", exact: true });
  await last.scrollIntoViewIfNeeded();
  const geometry = await last.evaluate((node) => {
    const tab = node.getBoundingClientRect(), list = node.parentElement.getBoundingClientRect();
    const close = node.querySelector("button").getBoundingClientRect();
    return { top: tab.top, bottom: tab.bottom, height: tab.height, listTop: list.top, listBottom: list.bottom, closeTop: close.top, closeBottom: close.bottom };
  });
  assert.ok(geometry.height > 20 && geometry.top >= geometry.listTop && geometry.bottom <= geometry.listBottom, JSON.stringify(geometry));
  assert.ok(geometry.closeTop >= geometry.listTop && geometry.closeBottom <= geometry.listBottom, "close control must not be clipped");
  await last.press("Home");
  assert.equal(await list.getByRole("tab").first().getAttribute("aria-selected"), "true");
  await list.getByRole("tab").first().press("End");
  assert.equal(await last.getAttribute("aria-selected"), "true");
  await last.getByRole("button").click();
  await last.waitFor({ state: "detached" });
  console.log(`PASS: ${page.viewportSize().width}px overflowing tab geometry, keyboard selection and close`);
}
