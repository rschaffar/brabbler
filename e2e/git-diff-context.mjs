import assert from "node:assert/strict";

/** Explorer-only cold/default rendering ceremony. Other groups keep their
 * existing checkDiffContext contract below; no cross-agent helper cut is hidden.
 */
export async function checkExplorerContextBridge(page, file, toolbar, toggleFile) {
  const jump = async (number, text) => {
    await file.getByRole("textbox", { name: "Line number", exact: true }).fill(String(number));
    await file.getByRole("button", { name: "Go to line", exact: true }).click();
    await file.getByText(text, { exact: true }).first().waitFor();
  };
  const gap = file.getByRole("button", { name: "Expand following context", exact: true }).first();
  await gap.waitFor(); await gap.focus(); await page.keyboard.press("Enter");
  await file.getByText("Context line 30", { exact: true }).first().waitFor();
  const wholeGap = file.getByRole("button", { name: "Expand entire gap", exact: true }).first();
  if (await wholeGap.count()) { await wholeGap.click(); await file.locator('[data-expand-index="0"]').first().waitFor({ state: "detached" }); }
  await file.getByRole("button", { name: "Show full file", exact: true }).click();
  await jump(5000, "Context line 5000");
  const rows = await file.locator("[data-line-type]").count();
  assert.ok(rows > 0 && rows < 800, `A 5000-line file stays virtualized (${rows})`);
  for (const [direction, text] of [["Next", "Explorer changed 50"], ["Next", "Explorer changed 4500"], ["Previous", "Explorer changed 50"]]) {
    await file.getByRole("button", { name: `${direction} change`, exact: true }).click();
    await file.getByText(text, { exact: true }).waitFor();
  }
  await toolbar.getByRole("button", { name: "Unified", exact: true }).click();
  await file.getByRole("region", { name: "Unified diff", exact: true }).waitFor();
  // One real shared-toolbar broadcast, not a second two-file mode traversal.
  for (const path of ["base.txt", "second.txt"]) {
    await toolbar.getByRole("region", { name: `File changes: ${path}`, exact: true })
      .getByRole("region", { name: "Unified diff", exact: true }).waitFor();
  }
  await file.getByRole("searchbox", { name: "Search full file", exact: true }).fill("Context line 3021");
  await file.getByRole("button", { name: "Next match", exact: true }).click();
  await file.getByText("Context line 3021", { exact: true }).waitFor();
  // The mounted Before control's root-addition fixture has an absent old side;
  // it is not this modified-file clean-version highlight witness. Retain only
  // the exact old-side ceremony rather than claiming that gap closes all modes.
  await file.getByRole("button", { name: "Before", exact: true }).click();
  const before = file.getByRole("region", { name: "Before file", exact: true });
  await before.waitFor(); await jump(50, "Context line 50");
  assert.equal(await before.locator('[data-line-type="change-addition"]').count(), 0);
  await file.getByRole("button", { name: "After", exact: true }).click();
  await jump(50, "Explorer changed 50");
  // Default GitPatchStack collapse/cache forwarding is not certified by its
  // renderer-double SSR file; retain this small real-parent ceremony.
  await toggleFile.click(); await toggleFile.click();
  await file.getByRole("region", { name: "After file", exact: true }).waitFor();
  await file.getByRole("button", { name: "Wide view", exact: true }).click();
  const wide = page.getByRole("dialog", { name: /^Review file:/ }); await wide.waitFor();
  await wide.getByRole("region", { name: "After file", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await wide.waitFor({ state: "hidden" });
  assert.equal(await file.getByRole("button", { name: "Wide view", exact: true }).evaluate(button => button === document.activeElement), true);
  await file.getByRole("button", { name: "Changes", exact: true }).click();
  await toolbar.getByRole("button", { name: "Side by side", exact: true }).click();
  await file.getByRole("region", { name: "Side-by-side diff", exact: true }).waitFor();
}

export const contextContents = Array.from({ length: 5000 }, (_, index) => `Context line ${index + 1}\n`).join("");
export const changedContextContents = contextContents.replace("Context line 50\n", "Explorer changed 50\n").replace("Context line 4500\n", "Explorer changed 4500\n");
export function contextPatch(path) {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n` + [50, 4500].map((number) =>
    `@@ -${number - 3},7 +${number - 3},7 @@\n` + [number - 3, number - 2, number - 1].map((line) => ` Context line ${line}\n`).join("") +
    `-Context line ${number}\n+Explorer changed ${number}\n` + [number + 1, number + 2, number + 3].map((line) => ` Context line ${line}\n`).join("")).join("");
}

/** Real Pierre rendering, including omitted lines well outside the patch hunks. */
export async function checkDiffContext(page, file, toolbar, { prefix = "Context line", firstChange = "Explorer changed 50", secondChange = "Explorer changed 4500", toggleFile } = {}) {
  const jump = async (number, text, region = file) => {
    await file.getByRole("textbox", { name: "Line number", exact: true }).fill(String(number));
    await file.getByRole("button", { name: "Go to line", exact: true }).click();
    await region.getByText(text, { exact: true }).first().waitFor();
  };
  const gap = file.getByRole("button", { name: "Expand following context", exact: true }).first();
  await gap.waitFor();
  await gap.focus(); await page.keyboard.press("Enter");
  await file.getByText(`${prefix} 30`, { exact: true }).first().waitFor();
  const wholeGap = file.getByRole("button", { name: "Expand entire gap", exact: true }).first();
  if (await wholeGap.count()) { await wholeGap.click(); await file.locator('[data-expand-index="0"]').first().waitFor({ state: "detached" }); }

  await file.getByRole("button", { name: "Show full file", exact: true }).click();
  const context = file.getByRole("button", { name: "Diff context", exact: true });
  assert.equal(await context.getAttribute("aria-pressed"), "true");
  await jump(5000, `${prefix} 5000`);
  const rows = await file.locator("[data-line-type]").count();
  assert.ok(rows > 0 && rows < 800, `A 5000-line file stays virtualized, not 10,000 DOM lines (${rows})`);
  await file.getByRole("button", { name: "Next change", exact: true }).click();
  await file.getByText(firstChange, { exact: true }).waitFor();
  await file.getByRole("button", { name: "Next change", exact: true }).click();
  await file.getByText(secondChange, { exact: true }).waitFor();
  await file.getByRole("button", { name: "Previous change", exact: true }).click();
  await file.getByText(firstChange, { exact: true }).waitFor();

  await toolbar.getByRole("button", { name: "Unified", exact: true }).click();
  await file.getByRole("region", { name: "Unified diff", exact: true }).waitFor();
  assert.equal(await context.getAttribute("aria-pressed"), "true", "Layout changes retain per-file full context");
  await file.getByRole("searchbox", { name: "Search full file", exact: true }).fill(`${prefix} 3021`);
  await file.getByRole("button", { name: "Next match", exact: true }).click();
  await file.getByText(`${prefix} 3021`, { exact: true }).waitFor();
  await file.getByRole("combobox", { name: "Search file version", exact: true }).selectOption("deletions");
  await jump(50, `${prefix} 50`);

  await file.getByRole("group", { name: "File version", exact: true }).getByRole("button", { name: "Before", exact: true }).click();
  const before = file.getByRole("region", { name: "Before file", exact: true });
  await before.waitFor(); await jump(50, `${prefix} 50`, before);
  assert.equal(await before.locator('[data-line-type="change-addition"]').count(), 0, "Clean versions do not fake diff highlights");
  await file.getByRole("group", { name: "File version", exact: true }).getByRole("button", { name: "After", exact: true }).click();
  const after = file.getByRole("region", { name: "After file", exact: true });
  await after.waitFor(); await jump(50, firstChange, after);
  if (toggleFile) {
    await toggleFile.click(); await toggleFile.click();
    await after.waitFor(); await after.getByText(firstChange, { exact: true }).waitFor();
    assert.equal(await file.getByRole("button", { name: "After", exact: true }).getAttribute("aria-pressed"), "true", "File collapse retains reading version and anchor");
  }
  await file.getByRole("button", { name: "Wide view", exact: true }).click();
  const wide = page.getByRole("dialog", { name: /^Review file:/ }); await wide.waitFor();
  await wide.getByRole("region", { name: "After file", exact: true }).waitFor();
  await page.keyboard.press("Escape"); await wide.waitFor({ state: "hidden" });
  assert.equal(await file.getByRole("button", { name: "Wide view", exact: true }).evaluate((button) => button === document.activeElement), true, "Escape restores reading focus");
  await file.getByRole("button", { name: "Changes", exact: true }).click();
  const wrapping = toolbar.getByRole("button", { name: "Wrap lines", exact: true });
  await wrapping.click();
  assert.equal(await wrapping.getAttribute("aria-pressed"), "false", "Wrap toggle selects horizontal scrolling");
  await wrapping.click();
  await toolbar.getByRole("button", { name: "Side by side", exact: true }).click();
  await file.getByRole("region", { name: "Side-by-side diff", exact: true }).waitFor();
  assert.equal(await context.getAttribute("aria-pressed"), "true");
}
