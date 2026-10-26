import assert from "node:assert/strict";
import { join } from "node:path";

/** Saved transcript fixtures only. These tools never execute or create the named files. */
export function seedToolArguments({ entries, message, project }) {
  const hostile = '<img data-e2e-tool-xss src=x onerror="window.__toolArgXss=1">[unsafe](javascript:alert(1))';
  const longLabel = `E2E_${"very_long_label_".repeat(16)}`;
  const multiline = Array.from({ length: 60 }, (_, i) => `E2E argument line ${i}: ${"long_unbroken_value".repeat(20)}`).join("\n");
  // The nested/value corpus is owned by the actual default-hook test. Keep only
  // physical/native flat input and the installed dynamic write/edit caller.
  const calls = [
    { id: "readable-flat", name: "e2e_arguments", arguments: { query: hostile, enabled: false, count: 0, nullable: null, empty: "", [longLabel]: multiline, [hostile]: "Malicious label remains data" } },
    { id: "readable-write", name: "write", arguments: { path: join(project, "readable-write.txt"), content: "E2E plain write\n**not bold**\n" + hostile } },
    { id: "readable-edit", name: "edit", arguments: { path: join(project, "readable-edit.txt"), edits: [{ oldText: "E2E old text\n" + hostile, newText: "E2E replacement text\n**not bold**" }] } },
  ];
  entries[1].message.content.push(...calls.map((call) => ({ type: "toolCall", ...call })));
  let parent = "call";
  const results = calls.map((call) => {
    const result = message(`${call.id}-result`, parent, "toolResult", [{ type: "text", text: `E2E seeded ${call.id} result` }]);
    Object.assign(result.message, { toolCallId: call.id, toolName: call.name, isError: call.name === "edit" });
    parent = result.id;
    return result;
  });
  entries[2].parentId = parent;
  entries.splice(2, 0, ...results);
  return { calls, longLabel, multiline, hostile };
}

async function copyAndCheck(page, card, expected) {
  await card.getByRole("button", { name: "Copy arguments", exact: true }).click();
  await card.getByRole("status").filter({ hasText: "Copied" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
}

// The two retained native font overrides must not replace a primary UI error
// with a later restoration failure. A present undefined is still a failure.
export async function withToolStyleRestoration(action, restore) {
  let primary, cleanup, primaryCaught = false, cleanupCaught = false;
  try { await action(); } catch (error) { primaryCaught = true; primary = error; }
  try { await restore(); } catch (error) { cleanupCaught = true; cleanup = error; }
  if (primaryCaught && cleanupCaught) throw new AggregateError([primary, cleanup], "Tool style action and restoration failed");
  if (primaryCaught) throw primary;
  if (cleanupCaught) throw cleanup;
}

export async function checkToolArguments(page, fixtures, { artifacts, width, project, sessionId }) {
  assert.equal(new URL(page.url()).searchParams.get("session"), sessionId, "installed caller remains on the original RICH session");
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const flat = fixtures.calls.find(call => call.id === "readable-flat");
  const card = page.locator('[data-tool-call-id="readable-flat"]');
  await card.locator(":scope > div > button").first().click();
  const args = card.locator("[data-tool-arguments]");
  await args.waitFor();
  const expected = JSON.stringify(flat.arguments, null, 2);
  const pre = args.locator("td pre");
  const dimensions = await pre.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
  assert.ok(dimensions.scroll > dimensions.client && dimensions.client <= 260);
  await pre.focus();
  await pre.press("PageDown");
  await page.waitForFunction(() => document.querySelector('[data-tool-call-id="readable-flat"] td pre').scrollTop > 0);
  assert.ok(await args.getByRole("rowheader", { name: fixtures.longLabel, exact: true }).evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
  const geometry = await card.boundingBox();
  assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= width + 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const before = await args.locator("td").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  const old = await args.evaluate((el) => {
    const old = el.style.getPropertyValue("--chat-font-size-offset");
    const offset = parseFloat(getComputedStyle(el).getPropertyValue("--chat-font-size-offset")) || 0;
    el.style.setProperty("--chat-font-size-offset", `${offset + 4}px`); return old;
  });
  await withToolStyleRestoration(async () => {
    assert.equal(await args.locator("td").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), before + 4);
  }, () => args.evaluate((el, old) => old ? el.style.setProperty("--chat-font-size-offset", old) : el.style.removeProperty("--chat-font-size-offset"), old));
  const oldWeight = await args.evaluate((el) => {
    const old = el.style.getPropertyValue("--font-mono-weight");
    el.style.setProperty("--font-mono-weight", "600"); return old;
  });
  await withToolStyleRestoration(async () => {
    assert.equal(await args.locator("td").first().evaluate((el) => getComputedStyle(el).fontWeight), "600");
    assert.equal(await pre.evaluate((el) => getComputedStyle(el).fontWeight), "600");
  }, () => args.evaluate((el, old) => old ? el.style.setProperty("--font-mono-weight", old) : el.style.removeProperty("--font-mono-weight"), oldWeight));
  // Native Clipboard, raw-disclosure keyboard activation and actual rendered
  // containment stay at BOTH original physical/locale/touch inputs.
  assert.equal(await args.locator("img, script, iframe, a, strong").count(), 0);
  assert.equal(await page.evaluate(() => window.__toolArgXss), undefined);
  await copyAndCheck(page, card, expected);
  const raw = args.getByRole("button", { name: "Show raw arguments", exact: true });
  assert.equal(await raw.getAttribute("aria-expanded"), "false");
  await raw.focus(); await raw.press("Enter");
  assert.equal(await args.locator("[data-tool-input]").textContent(), expected);
  await args.getByRole("button", { name: "Hide raw arguments", exact: true }).click();
  assert.equal(await args.locator("[data-tool-input]").count(), 0);

  if (width > 600) {
    // ONE real installed agentDir/project -> selected RICH -> native path/Copy
    // connection. The lower owner uses a controlled caller root, not this one.
    const write = fixtures.calls.find(call => call.id === "readable-write");
    const edit = fixtures.calls.find(call => call.id === "readable-edit");
    assert.equal(write.arguments.path, join(project, "readable-write.txt"));
    assert.equal(edit.arguments.path, join(project, "readable-edit.txt"));
    const written = page.locator('[data-tool-call-id="readable-write"]');
    await written.locator(":scope > div > button").first().click();
    await written.locator("[data-tool-file-text]").waitFor();
    await copyAndCheck(page, written, JSON.stringify(write.arguments, null, 2));
    const edited = page.locator('[data-tool-call-id="readable-edit"]');
    await edited.locator(":scope > div > button").first().click();
    assert.ok((await edited.locator("[data-tool-input]").textContent()).includes(edit.arguments.path));
    await edited.getByText("E2E seeded readable-edit result", { exact: true }).waitFor();
  }
  await page.screenshot({ path: join(artifacts, `tool-arguments-${width}.png`) });
}
