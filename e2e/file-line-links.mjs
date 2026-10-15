import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function seedFileLineLinks({ project, writeSession, message }) {
  const sessionId = "e2e-file-line-links";
  // The existing other-project session authorizes this sibling root; formatting alone grants no access.
  const sibling = join(project, "..", "other-project", "sibling-line-target.ts");
  writeFileSync(sibling, "// sibling source line 1\nexport const sibling = true;\n");
  mkdirSync(join(project, "nested-links"));
  writeFileSync(join(project, "nested-links", "links.md"), `[Parent within root](../line-target.ts#L180)\n\n[Outside preview root](../../other-project/sibling-line-target.ts#L2)\n\n[Absolute sibling](${sibling}#L2)\n`);
  const code = join(project, "line-target.ts");
  const codeContent = Array.from({ length: 260 }, (_, i) => i === 179 ? "export function linkedFunction() { return 42; }" : `// source line ${i + 1}`).join("\n");
  writeFileSync(code, codeContent);
  const large = join(project, "large-line-target.txt");
  writeFileSync(large, Array.from({ length: 1500 }, (_, i) => `${i + 1} ${"x".repeat(512)}`).join("\n"));
  const md = join(project, "line-target.md");
  const markdown = ["---", "title: Line targets", "---", "", "# Navigation", "", "\\[x=y\\]", "", ...Array.from({ length: 70 }, (_, i) => `Paragraph ${i + 1}.\n`), "## Target heading", "", "Target paragraph first line", "second line", "", "- Target list item", "", "```ts", "function markdownFunction() {}", "```", "", "[Jump to function](line-target.ts#L180)", "", "[Outside preview root](../other-project/sibling-line-target.ts#L2)", "", `[Absolute sibling](${sibling}#L2)`, "", "Final paragraph"] .join("\n");
  writeFileSync(md, markdown);
  const lines = markdown.split("\n");
  const headingLine = lines.indexOf("## Target heading") + 1;
  const paragraphLine = lines.indexOf("second line") + 1;
  const listLine = lines.indexOf("- Target list item") + 1;
  const codeLine = lines.indexOf("function markdownFunction() {}") + 1;
  writeSession(sessionId, [message("user", null, "user", "File line navigation"), message("answer", "user", "assistant", [
    { type: "text", text: `[linkedFunction](line-target.ts#L180)\n\n\`line-target.ts:180:3\`\n\n[Range](line-target.ts#L180-L182)\n\n[Large file](large-line-target.txt#L1200)\n\n[Heading](line-target.md#L${headingLine})\n\n[Paragraph](line-target.md:${paragraphLine})\n\n[List item](line-target.md#L${listLine})\n\n[Markdown code](line-target.md#L${codeLine})\n\n[Frontmatter](line-target.md#L2)\n\n[Math](line-target.md#L7)\n\n[Missing line](line-target.ts#L9999)\n\n[Outside chat root](../other-project/sibling-line-target.ts#L2)\n\n[Encoded outside root](%2e%2e/other-project/sibling-line-target.ts#L2)\n\n[Absolute sibling](${sibling}#L2)\n\n[Nested preview](nested-links/links.md)` },
  ])]);
  return { sessionId, headingLine, paragraphLine, listLine, codeLine, code, codeContent, nested: join(project, "nested-links", "links.md") };
}

export async function checkFileLineLinks(page, base, fixture) {
  await page.goto(`${base}/?session=${fixture.sessionId}`, { waitUntil: "domcontentloaded" });
  const panel = page.locator("#file-panel");
  const pane = panel.locator(".file-viewer-content");
  const returnToChat = async () => {
    const hide = panel.getByRole("button", { name: "Hide file panel", exact: true });
    if (await hide.count() && await hide.getAttribute("aria-expanded") === "true") await hide.click();
  };
  const click = async (name) => {
    await returnToChat();
    await page.getByRole("link", { name, exact: true }).click();
  };
  const assertJump = async (selector) => {
    const target = pane.locator(selector);
    await target.waitFor({ state: "visible" });
    await page.waitForFunction(({ selector }) => {
      const root = document.querySelector("#file-panel .file-viewer-content");
      const target = root?.querySelector(selector);
      if (!root || !target || !target.hasAttribute("data-file-line-target")) return false;
      const r = root.getBoundingClientRect(), t = target.getBoundingClientRect();
      return t.top >= r.top - 1 && t.top < r.bottom;
    }, { selector });
    assert.equal(await target.getAttribute("data-file-line-target"), "true");
  };

  const explanation = "This relative file link points outside the allowed base directory. Use an absolute filesystem path instead. File access permissions still apply.";
  const assertBlocked = async (scope, name) => {
    const trigger = scope.getByRole("button", { name, exact: true });
    await trigger.waitFor({ state: "visible" });
    assert.equal(await trigger.getAttribute("title"), explanation);
    assert.equal(await trigger.evaluate(el => el.closest("a")), null, "rejected links must have no browser destination");
    const url = page.url(), pageCount = page.context().pages().length;
    await trigger.click({ modifiers: ["ControlOrMeta"] });
    await scope.getByRole("status").getByText(explanation, { exact: true }).waitFor();
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");
    await trigger.focus();
    if (scope === panel) {
      // A real unchanged watcher read must not remount the link or lose expansion/focus.
      const refreshed = page.waitForResponse(response => response.url().includes("/nested-links/links.md?") && new URL(response.url()).searchParams.get("type") === "read");
      writeFileSync(fixture.nested, readFileSync(fixture.nested, "utf8"));
      await (await refreshed).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.waitForFunction(() => document.querySelector('.blocked-file-link-trigger[aria-expanded="true"]') === document.activeElement);
      assert.equal(await trigger.getAttribute("aria-expanded"), "true", "unchanged reads preserve feedback");
    }
    await page.keyboard.press("Enter");
    assert.equal(await trigger.getAttribute("aria-expanded"), "false");
    assert.equal(page.url(), url);
    assert.equal(page.context().pages().length, pageCount, "rejected links must not open a website tab");
  };
  await assertBlocked(page, "Outside chat root");
  await assertBlocked(page, "Encoded outside root");
  await click("Absolute sibling");
  await assertJump('[data-line-number="2"]');
  await click("Nested preview");
  await assertBlocked(panel, "Outside preview root");
  await panel.getByRole("link", { name: "Absolute sibling", exact: true }).click();
  await assertJump('[data-line-number="2"]');
  await click("Nested preview");
  await panel.getByRole("link", { name: "Parent within root", exact: true }).click();
  await assertJump('[data-line-number="180"]');

  await click("linkedFunction");
  await assertJump('[data-line-number="180"]');
  // A same-file/same-line click is a new navigation, not an unchanged tab selection.
  await pane.evaluate(el => { el.scrollTop = 0; });
  await click("linkedFunction");
  await assertJump('[data-line-number="180"]');
  await click("line-target.ts:180:3");
  await assertJump('[data-line-number="180"]');
  await click("Range");
  await assertJump('[data-line-number="180"]');
  assert.equal(await pane.locator("[data-file-line-target]").count(), 3);
  await click("Large file");
  await assertJump('[data-line-number="1200"]');

  await click("Heading");
  await assertJump(`h2[data-source-line-start="${fixture.headingLine}"]`);
  await panel.getByRole("button", { name: "Source", exact: true }).click();
  await assertJump(`[data-line-number="${fixture.headingLine}"]`);
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await click("Paragraph");
  await assertJump(`p[data-source-line-start="${fixture.paragraphLine - 1}"]`);
  await click("List item");
  await assertJump(`li[data-source-line-start="${fixture.listLine}"]`);
  await click("Markdown code");
  await assertJump(`div[data-source-line-start="${fixture.codeLine - 1}"]`);
  await click("Math");
  await assertJump('div[data-source-line-start="7"]');
  await click("Frontmatter");
  await assertJump('div[data-source-line-start="1"]');
  await panel.getByRole("button", { name: "Outside preview root", exact: true }).click();
  await panel.getByRole("status").getByText(explanation, { exact: true }).waitFor();
  await panel.getByRole("link", { name: "Jump to function", exact: true }).click();
  await assertJump('[data-line-number="180"]');
  await click("Missing line");
  await panel.getByRole("status").getByText("Line 9999 is beyond the end of this file (260 lines).", { exact: true }).waitFor();
  assert.equal(await pane.locator("[data-file-line-target]").count(), 0);
  // A linked-file round trip must not create a second writer for an unfinished save.
  await click("linkedFunction");
  await assertJump('[data-line-number="180"]');
  await panel.getByRole("button", { name: "Edit", exact: true }).click();
  const editor = panel.getByRole("textbox", { name: "Edit", exact: true });
  const savedContent = `// save baseline\n${fixture.codeContent}`;
  const laterDraft = `// typed during save\n${savedContent}`;
  await editor.fill(savedContent);
  let releaseSave, saveStarted;
  const gate = new Promise(resolve => { releaseSave = resolve; });
  const started = new Promise(resolve => { saveStarted = resolve; });
  const holdSave = async (route) => {
    if (route.request().method() === "PUT") { saveStarted(); await gate; }
    await route.continue();
  };
  await page.route("**/api/files/**", holdSave);
  try {
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await started;
    assert.equal(await editor.getAttribute("readonly"), null, "the original save owner keeps accepting draft keystrokes");
    await editor.fill(laterDraft);
    await click("Heading");
    await click("linkedFunction");
    await editor.waitFor();
    assert.equal(await editor.getAttribute("readonly"), "", "a replacement viewer waits for the original save owner");
    assert.equal(await panel.getByRole("button", { name: "Edit", exact: true }).isDisabled(), true);
    const saved = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).searchParams.get("type") === "save");
    releaseSave();
    await saved;
    await assertJump('[data-line-number="180"]');
    await panel.getByText("Showing the saved file for this link; your unsaved draft is retained.", { exact: true }).waitFor();
    await panel.getByRole("button", { name: "Edit", exact: true }).click();
    assert.equal(await editor.inputValue(), laterDraft, "the queued jump preserves keystrokes typed during the save");
  } finally {
    releaseSave();
    await page.unroute("**/api/files/**", holdSave);
  }
  await panel.getByRole("button", { name: "Save", exact: true }).click();
  await panel.getByText("Unsaved changes", { exact: true }).waitFor({ state: "hidden" });
  writeFileSync(fixture.code, fixture.codeContent);
  await page.waitForFunction(expected => document.querySelector('#file-panel textarea')?.value === expected, fixture.codeContent);
  await returnToChat();
  console.log(`PASS: rejected relative links with accessible feedback, absolute siblings, nested previews, chat explicit/inline line links, ranges, repeated tabs, large chunks, rendered Markdown and save-owner/draft retention at ${page.viewportSize().width}px`);
}
