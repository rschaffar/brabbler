import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";

function twoPagePdf() {
  const streams = [1, 2].map(page => `BT /F1 18 Tf 30 200 Td (Review page ${page}) Tj ET`);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    ...[5, 6].map(stream => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 7 0 R >> >> /Contents ${stream} 0 R >>`),
    ...streams.map(stream => `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => { const offset = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  return pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

export function seedFileLineLinks({ project, writeSession, message, workspacePeer = false }) {
  const sessionId = "e2e-file-line-links";
  // The existing other-project session authorizes this sibling root; formatting alone grants no access.
  const sibling = join(project, "..", "other-project", "sibling-line-target.ts");
  writeFileSync(sibling, "// sibling source line 1\nexport const sibling = true;\n");
  mkdirSync(join(project, "nested-links"));
  writeFileSync(join(project, "nested-links", "links.md"), `[Parent within root](../line-target.ts#L180)\n\n[Outside preview root](../../other-project/sibling-line-target.ts#L2)\n\n[Absolute sibling](${sibling}#L2)\n`);
  writeFileSync(join(project, "followups.csv"), "name,notes,value\nalpha,\"line one\nline two\",10\n" + Array.from({ length: 3000 }, (_, i) => `row-${i},plain,${i}\n`).join(""));
  writeFileSync(join(project, "followups.tsv"), "key\ttext\none\tx,y\n");
  writeFileSync(join(project, "followups-anchors.md"), '<a id="start"></a>\n\n[Jump to section](#target)\n\n[Jump to heading](#scoped-anchor-target)\n\n## Target\n\n' + "Anchor paragraph.\n\n".repeat(90) + '<a id="target"></a>\n\n## Scoped anchor target\n\n[Return to start](#start)\n');
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
  for (let i = 1; i <= 5; i++) writeFileSync(join(project, `split-source-${i}.ts`), Array.from({ length: 100 }, (_, n) => `// source ${i}, line ${n + 1}`).join("\n"));
  writeFileSync(join(project, "split-pages.pdf"), twoPagePdf());
  writeFileSync(join(project, "split-tests.ts"), "// retained tests\nexport const testEvidence = true;\n");
  writeFileSync(join(project, "split-chapter.md"), "# Independent chapter\n\n[Chapter source 1](split-source-1.ts#L40)\n\n[Chapter source 3](split-source-3.ts#L40)\n");
  writeFileSync(join(project, "split-guide.md"), "# Guided review\n\nKeep this explanation visible.\n\nDense review: [Dense one](split-source-1.ts#L40), [Dense next](split-source-1.ts#L70), [Dense two](split-source-2.ts#L40) and [Dense three](split-tests.ts#L2).\n\n" + Array.from({ length: 5 }, (_, i) => `[Source ${i + 1}](split-source-${i + 1}.ts#L40)`).join("\n\n") + "\n\n[PDF page](split-pages.pdf#page=2)\n\n[Test evidence](split-tests.ts#L2)\n\n[Local section](#local-section)\n\n[Chapter](split-chapter.md)\n\n" + "Explanation paragraph.\n\n".repeat(50) + "## Local section\n\nEnd of guide.\n");
  const peerSessionId = "e2e-file-workspace-peer";
  if (workspacePeer) writeSession(peerSessionId, [
    { type: "session_info", id: "peer-name", parentId: null, timestamp: message("clock", null, "user", "").timestamp, name: "Split owner peer" },
    message("peer-user", null, "user", "Peer review context"),
    message("peer-answer", "peer-user", "assistant", "[Shared edit source](split-source-1.ts#L40)"),
  ]);
  writeSession(sessionId, [
    ...(workspacePeer ? [{ type: "session_info", id: "source-name", parentId: null, timestamp: message("clock", null, "user", "").timestamp, name: "Split review source" }] : []),
    message("user", null, "user", "File line navigation"), message("answer", "user", "assistant", [
    { type: "text", text: `[linkedFunction](line-target.ts#L180)\n\n\`line-target.ts:180:3\`\n\n[Range](line-target.ts#L180-L182)\n\n[Large file](large-line-target.txt#L1200)\n\n[Heading](line-target.md#L${headingLine})\n\n[Paragraph](line-target.md:${paragraphLine})\n\n[List item](line-target.md#L${listLine})\n\n[Markdown code](line-target.md#L${codeLine})\n\n[Frontmatter](line-target.md#L2)\n\n[Math](line-target.md#L7)\n\n[Missing line](line-target.ts#L9999)\n\n[Outside chat root](../other-project/sibling-line-target.ts#L2)\n\n[Encoded outside root](%2e%2e/other-project/sibling-line-target.ts#L2)\n\n[Absolute sibling](${sibling}#L2)\n\n[Nested preview](nested-links/links.md)\n\n[CSV preview](followups.csv)\n\n[CSV source line](followups.csv#L3)\n\n[TSV preview](followups.tsv)\n\n[Fragment preview](followups-anchors.md)\n\n[Split guide](split-guide.md)` },
  ])]);
  return { sessionId, peerSessionId, headingLine, paragraphLine, listLine, codeLine, code, codeContent, nested: join(project, "nested-links", "links.md") };
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
  // The exact queued-link/native Save bridge runs once in the ordered desktop
  // input; actual FileViewer/Workspace mounts own held-write/draft policy. Both
  // physical inputs above retain all source/Markdown jump geometries.
  if (page.viewportSize().width > 640) {
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
      const request = route.request(), save = request.method() === "PUT";
      if (save) { saveStarted(); await gate; }
      await route.continue();
      if (save) {
        const response = await request.response();
        assert.notEqual(response, null, "the admitted original Save has a native response");
        await response.body(); // Join real PUT bytes even when status is non-200.
        assert.equal(response.status(), 200);
      }
    };
    // Track admitted callbacks; matching PUTs also join their native response
    // bodies (not GET/watch streams). Release the gate before route joins.
    const saves = createOwnedRoutes(holdSave, holdSave), routeFailures = [], errors = [];
    // Playwright's dispatch acknowledgement must not expose a rejecting callback
    // as an unowned promise. Keep the original rejected work in the route owner
    // AND this live reference collector; rethrow only after release/join/removal.
    const routeHandler = route => saves.handler(route).then(undefined, error => { routeFailures.push(error); });
    try {
      await page.route("**/api/files/**", routeHandler);
      await panel.getByRole("button", { name: "Save", exact: true }).click();
      await started;
      assert.equal(await editor.getAttribute("readonly"), null, "the original save owner keeps accepting draft keystrokes");
      await editor.fill(laterDraft);
      await click("Heading");
      await click("linkedFunction");
      await editor.waitFor();
      assert.equal(await editor.getAttribute("readonly"), null, "the retained original save owner remains the only writable editor");
      assert.equal(await editor.inputValue(), laterDraft, "tab activation does not construct a replacement draft");
      const saved = page.waitForResponse(response => response.request().method() === "PUT" && new URL(response.url()).searchParams.get("type") === "save");
      releaseSave();
      await saved;
      await assertJump('[data-line-number="180"]');
      await panel.getByText("Showing the saved file for this link; your unsaved draft is retained.", { exact: true }).waitFor();
      await panel.getByRole("button", { name: "Edit", exact: true }).click();
      assert.equal(await editor.inputValue(), laterDraft, "the queued jump preserves keystrokes typed during the save");
    } catch (error) {
      errors.push(error);
    } finally {
      try { releaseSave(); } catch (error) { errors.push(error); }
      try { await saves.dispose(() => page.unroute("**/api/files/**", routeHandler)); }
      catch (error) { errors.push(error); }
      errors.push(...routeFailures);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length) throw new AggregateError(errors, "Queued line-link Save and route settlement failed");
    await panel.getByRole("button", { name: "Save", exact: true }).click();
    await panel.getByText("Unsaved changes", { exact: true }).waitFor({ state: "hidden" });
    writeFileSync(fixture.code, fixture.codeContent);
    await page.waitForFunction(expected => document.querySelector('#file-panel textarea')?.value === expected, fixture.codeContent);
  }
  await click("CSV preview");
  const table = panel.getByRole("table");
  await table.getByRole("columnheader", { name: "name", exact: true }).waitFor();
  assert.ok(Number(await table.getAttribute("aria-rowcount")) > 1000);
  assert.ok(await table.getByRole("row").count() < 150, "large CSV renders only viewport rows");
  assert.equal(await table.getByRole("row").nth(1).getByRole("cell").nth(1).getAttribute("title"), "line one\nline two");
  await pane.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await page.waitForFunction(() => Number(document.querySelector('#file-panel [role="table"] [role="row"][aria-rowindex]:last-child')?.getAttribute("aria-rowindex")) > 1000);
  assert.ok(await table.getByRole("row").count() < 150);
  await click("CSV source line");
  await assertJump('[data-line-number="3"]');
  await click("TSV preview");
  await panel.getByRole("columnheader", { name: "text", exact: true }).waitFor();
  await panel.getByRole("cell", { name: "x,y", exact: true }).waitFor();
  await click("Fragment preview");
  const originalUrl = page.url(), pages = page.context().pages().length;
  await panel.getByRole("link", { name: "Jump to section", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#file-panel .file-viewer-content')?.scrollTop > 500);
  await panel.getByRole("link", { name: "Return to start", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#file-panel .file-viewer-content')?.scrollTop < 100);
  await panel.getByRole("link", { name: "Jump to heading", exact: true }).click();
  await page.waitForFunction(() => {
    const pane = document.querySelector('#file-panel .file-viewer-content');
    const heading = pane?.querySelector('[data-heading-anchor="scoped-anchor-target"]');
    if (!pane || !heading) return false;
    const p = pane.getBoundingClientRect(), h = heading.getBoundingClientRect();
    return h.top >= p.top - 1 && h.bottom <= p.bottom + 1;
  });
  assert.equal(page.url(), originalUrl);
  assert.equal(page.context().pages().length, pages);
  await returnToChat();
  console.log(`PASS: CSV/TSV virtualization, quoted records, CSV source-line override and scoped Markdown fragments at ${page.viewportSize().width}px`);
  console.log(`PASS: rejected relative links with accessible feedback, absolute siblings, nested previews, chat explicit/inline line links, ranges, repeated tabs, large chunks, rendered Markdown${page.viewportSize().width > 640 ? " and save-owner/draft retention" : ""} at ${page.viewportSize().width}px`);
}
