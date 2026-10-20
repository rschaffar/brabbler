import assert from "node:assert/strict";

const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function setViewport(page, values, notify = true) {
  await page.evaluate(({ values, notify }) => {
    for (const [key, value] of Object.entries(values)) Object.defineProperty(window.visualViewport, key, { configurable: true, get: () => value });
    if (notify) window.visualViewport.dispatchEvent(new Event("resize"));
  }, { values, notify });
}

async function restoreViewport(page) {
  await page.evaluate(() => {
    for (const key of ["height", "offsetTop"]) delete window.visualViewport[key];
    window.visualViewport.dispatchEvent(new Event("resize"));
    delete window.__composerModelFilter;
  });
}

/** Same mounted filter and selection; never select the synthetic catalog model. */
export async function checkModelKeyboard(page, width) {
  if (width > 640) return;
  const filter = page.getByRole("textbox", { name: "Filter models" });
  const value = await filter.inputValue();
  await filter.evaluate((input) => { window.__composerModelFilter = input; });
  const assertVisible = async () => {
    await page.waitForFunction(() => {
      const input = window.__composerModelFilter;
      const panel = input?.closest('[role="listbox"]');
      const rect = panel?.getBoundingClientRect(), viewport = window.visualViewport;
      return input?.isConnected && document.activeElement === input && rect?.height > 0
        && rect.top >= viewport.offsetTop && rect.bottom <= viewport.offsetTop + viewport.height;
    });
    assert.equal(await filter.inputValue(), value);
    assert.equal(await page.getByRole("listbox").getByRole("option").count(), 1);
  };
  try {
    await setViewport(page, { height: 450, offsetTop: 0 });
    await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen === "true");
    await assertVisible();
    await setViewport(page, { height: 340, offsetTop: 70 });
    await assertVisible();
    await setViewport(page, { height: 280, offsetTop: 0 }, false);
    await filter.dispatchEvent("compositionupdate", { data: "x" });
    await page.waitForFunction(() => document.documentElement.style.getPropertyValue("--app-viewport-height") === "280px");
    await assertVisible();
  } finally { await restoreViewport(page); }
  console.log(`PASS: ${width}px model filtering survives keyboard shrink, pan and no-event IME settling`);
}

export async function checkFreshComposerFocus(page, alternateSessionId, width) {
  const input = page.locator(".chat-input-textarea");
  const showSidebar = async () => {
    const show = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await show.isVisible()) await show.click();
  };
  const assertFocus = async () => {
    await frames(page);
    assert.equal(await input.evaluate((node) => document.activeElement === node), width > 640);
  };
  await showSidebar();
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("session"));
  await assertFocus();
  const draft = "  parked fresh draft\n@\"my file\"  ";
  await input.fill(draft);
  await showSidebar();
  await page.locator(`.session-row[data-session-id="${alternateSessionId}"]`).click({ position: { x: 12, y: 12 } });
  await page.waitForFunction((id) => new URL(location.href).searchParams.get("session") === id, alternateSessionId);
  await page.keyboard.press("Control+Alt+n");
  await page.waitForFunction((draft) => document.querySelector(".chat-input-textarea")?.value === draft, draft);
  await assertFocus();
  if (width > 640) {
    await page.keyboard.insertText("continued");
    assert.equal(await input.inputValue(), `${draft}continued`);
  }
  await showSidebar();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const close = settings.getByRole("button", { name: "Close", exact: true });
  await close.focus();
  await page.keyboard.press("Control+Alt+n");
  await frames(page);
  assert.equal(await close.evaluate((node) => document.activeElement === node), true, "New must not steal modal control focus");
  await close.click();
  await page.evaluate(() => {
    const dialog = document.createElement("dialog");
    dialog.id = "composer-native-focus-fixture";
    const button = document.createElement("button"); button.textContent = "Native focus fixture";
    dialog.append(button); document.body.append(dialog); dialog.showModal(); button.focus();
  });
  try {
    await page.keyboard.press("Control+Alt+n");
    await frames(page);
    assert.equal(await page.getByRole("button", { name: "Native focus fixture", exact: true }).evaluate((node) => document.activeElement === node), true);
  } finally {
    await page.evaluate(() => { const dialog = document.getElementById("composer-native-focus-fixture"); dialog.close(); dialog.remove(); });
  }
  console.log(`PASS: ${width}px explicit New focus, parked literal draft and modal/native focus ownership`);
}

export async function checkRunningComposer(page, width, answer) {
  const input = page.locator(".chat-input-textarea");
  const steer = page.getByRole("button", { name: "Steer", exact: true });
  const followUp = page.getByRole("button", { name: "Follow-up", exact: true });
  await steer.waitFor();
  await input.fill("layout draft");
  const assertLayout = async () => {
    const draft = await input.boundingBox(), actions = await steer.boundingBox();
    assert.ok(draft && actions);
    if (width <= 640) {
      assert.ok(actions.y >= draft.y + draft.height, "mobile streaming actions sit below the draft");
      assert.ok(draft.width > width * 0.75, "mobile draft retains its full row");
    } else assert.ok(actions.x >= draft.x + draft.width, "desktop retains side-by-side actions");
    assert.equal(await followUp.isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "Stop", exact: true }).isVisible(), true);
  };
  await assertLayout();
  if (width <= 640) try {
    await setViewport(page, { height: 360, offsetTop: 0 });
    await page.waitForFunction(() => document.documentElement.dataset.keyboardOpen === "true");
    await assertLayout();
    const stop = page.getByRole("button", { name: "Stop", exact: true });
    await page.getByRole("button", { name: "More controls", exact: true }).click();
    const rect = await stop.boundingBox();
    assert.equal(await stop.evaluate((node, rect) => {
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return node === hit || node.contains(hit);
    }, rect), true, "More must not cover the separate Stop control");
    await page.getByRole("button", { name: "Collapse controls", exact: true }).click();
    assert.equal(await input.inputValue(), "layout draft");
  } finally { await restoreViewport(page); }

  for (const [before, start, end] of [["", 0, 0], ["prefix suffix", 6, 6], ["prefix replace suffix", 7, 14]]) {
    await input.fill(before);
    await input.evaluate((node, { start, end }) => {
      node.setSelectionRange(start, end);
      // A real transcript selection leaves the editor. Clearing document ranges
      // while it is still focused would reset the fixture's textarea caret.
      node.blur();
    }, { start, end });
    await answer.scrollIntoViewIfNeeded();
    const text = await answer.innerText();
    await answer.evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Ask here", exact: true }).click();
    const prefix = before.slice(0, start), suffix = before.slice(end);
    const sep = prefix && !prefix.endsWith(" ") ? " " : "";
    const insertion = `About this passage:\n\n> ${text}\n\nMy question:`;
    const expected = `${prefix}${sep}${insertion}${suffix}`;
    await page.waitForFunction((expected) => document.querySelector(".chat-input-textarea")?.value === expected, expected);
    await frames(page);
    const caret = prefix.length + sep.length + insertion.length;
    assert.deepEqual(await input.evaluate((node) => [node.selectionStart, node.selectionEnd, document.activeElement === node]), [caret, caret, true]);
    await page.keyboard.insertText("typed");
    assert.equal(await input.inputValue(), `${expected.slice(0, caret)}typed${expected.slice(caret)}`);
  }
  await input.fill("");
  console.log(`PASS: ${width}px running draft/action layout, visible Stop and Ask-here exact caret/text`);
}
