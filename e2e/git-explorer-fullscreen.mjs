import assert from "node:assert/strict";
import { waitForForkResponse } from "./running-session-forks.mjs";

/** Whole-Explorer geometry, mounted state and keyboard isolation with a real blocked SDK prompt. */
export async function checkGitExplorerFullscreen(page, { base, sessionId, explorer, graph, detail, file }) {
  const api = async (path, body) => {
    const response = await fetch(`${base}${path}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined);
    assert.equal(response.status, 200, path);
    return response.json();
  };
  const agentPath = `/api/agent/${sessionId}`;
  const commands = [], reads = [];
  const observe = (request) => {
    const url = new URL(request.url());
    if (url.pathname === agentPath && request.method() === "POST") commands.push(request.postDataJSON());
    if (url.pathname === "/api/git/explorer") reads.push(url.search);
  };
  page.on("request", observe);
  const prompting = waitForForkResponse(page, (response) => new URL(response.url()).pathname === agentPath
    && response.request().method() === "POST" && response.request().postDataJSON()?.type === "prompt", { timeout: 120_000 });
  const originalViewport = page.viewportSize();
  const question = page.getByRole("group", { name: "E2E confirm", exact: true });
  const expand = explorer.getByRole("button", { name: "Expand Git Explorer", exact: true });
  const restore = explorer.getByRole("button", { name: "Restore Git Explorer", exact: true });
  await page.locator(".chat-input-textarea").fill("/e2e-dialog confirm");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  try {
    await question.waitFor();
    const originalAttention = (await api("/api/agent/running")).attention.find((item) => item.sessionId === sessionId);
    assert.ok(originalAttention);
    const checkRunning = async () => {
      assert.equal((await api(agentPath)).state.isPromptRunning, true, "Fullscreen Escape must not stop the hidden prompt");
      const running = await api("/api/agent/running");
      assert.ok(running.runningSessionIds.includes(sessionId));
      assert.deepEqual(running.attention.find((item) => item.sessionId === sessionId), originalAttention);
      assert.equal(commands.some((command) => ["abort", "extension_ui_response"].includes(command.type)), false);
    };
    const graphNode = await graph.elementHandle(), detailNode = await detail.elementHandle();
    const branch = await explorer.getByRole("combobox", { name: "History branch" }).inputValue();
    const filePanel = page.locator("#file-panel");
    const savedWidths = () => page.evaluate(() => [localStorage.getItem("brabbler-sidebar-width"), localStorage.getItem("brabbler-right-panel-width")]);
    await page.getByRole("button", { name: "Show file panel", exact: true }).click();
    await filePanel.evaluate(async (node) => {
      await new Promise(requestAnimationFrame);
      await Promise.all(node.getAnimations().map((animation) => animation.finished.catch(() => {})));
    });
    const initialWidths = await savedWidths();
    const beforeBounds = await explorer.boundingBox();
    await page.getByText("Ready to browse Git history", { exact: true }).evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Ask in new chat", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "New chat about selected text", exact: true, includeHidden: true });
    await composer.locator(".chat-input-textarea").fill("Retain this quote draft");
    const composerNode = await composer.elementHandle();
    const beforeReads = reads.length;
    // An open quote composer can overlap the header; ordinary keyboard activation still expands.
    await expand.press("Enter");
    await page.waitForFunction(() => {
      const panel = document.getElementById("git-explorer-panel");
      const bounds = panel?.getBoundingClientRect();
      return bounds && bounds.x === 0 && bounds.y === 0 && Math.round(bounds.width) === innerWidth && Math.round(bounds.height) === innerHeight;
    });
    assert.equal(await restore.getAttribute("aria-pressed"), "true");
    assert.equal(await explorer.evaluate((node) => Boolean(node.closest("[inert]"))), false, "Explorer's center ancestor must not be inert");
    assert.equal(await page.locator("#session-sidebar").evaluate((node) => node.inert), true);
    assert.equal(await filePanel.evaluate((node) => node.inert), true);
    assert.equal(await page.getByRole("button", { name: "Git Explorer", exact: true, includeHidden: true }).evaluate((node) => Boolean(node.closest("[inert]"))), true);
    assert.equal(await page.locator(".chat-input-textarea").first().evaluate((node) => Boolean(node.closest("[inert]"))), true);
    assert.equal(await composer.isVisible(), false, "Covered body-portaled quote composer cannot obscure Explorer");
    assert.equal(await composer.evaluate((node) => node.inert), true);
    await restore.focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await explorer.evaluate((node) => node.contains(document.activeElement)), true, "Backward Tab stays in Explorer");
    await page.keyboard.press("Tab");
    assert.equal(await restore.evaluate((node) => node === document.activeElement), true, "Forward Tab wraps to the header control");
    await explorer.getByRole("button", { name: "Close Git Explorer", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expand.waitFor();
    assert.equal(await expand.evaluate((node) => node === document.activeElement), true, "Restore returns keyboard focus");
    assert.deepEqual(await savedWidths(), initialWidths);
    assert.deepEqual(await explorer.boundingBox(), beforeBounds);
    assert.equal(await filePanel.evaluate((node) => node.inert), false);
    assert.equal(await filePanel.evaluate((node) => node.classList.contains("right-panel-open")), true, "Restoring leaves the file panel open");
    assert.equal(await graphNode.evaluate((node) => node.isConnected), true);
    assert.equal(await detailNode.evaluate((node) => node.isConnected), true);
    assert.equal(await explorer.getByRole("combobox", { name: "History branch" }).inputValue(), branch);
    assert.equal(reads.length, beforeReads, "Geometry alone never recaptures history or rereads loaded patches/context");
    await checkRunning();
    await composer.waitFor();
    assert.equal(await composerNode.evaluate((node) => node.isConnected), true);
    assert.equal(await composer.locator(".chat-input-textarea").inputValue(), "Retain this quote draft");
    await composer.getByRole("button", { name: "Close", exact: true }).click();
    await filePanel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    await file.getByRole("button", { name: "Diff context", exact: true }).click();
    await file.getByRole("button", { name: "Expand following context", exact: true }).last().waitFor();
    await expand.click();
    await restore.focus();
    await page.keyboard.press("Shift+Tab");
    assert.equal(await file.evaluate((node) => {
      let active = document.activeElement;
      const shadowHost = active;
      while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
      return node.contains(shadowHost) && active !== shadowHost && active?.hasAttribute("data-expand-button");
    }), true, "Backward traversal includes the final file's shadow-DOM gap controls");
    await page.keyboard.press("Tab");
    assert.equal(await restore.evaluate((node) => node === document.activeElement), true, "Tab from the final gap wraps to Restore");
    await restore.click();
    await file.getByRole("button", { name: "Show full file", exact: true }).click();

    // Retain loaded immutable context, reading version and a far-off virtualized anchor.
    await file.getByRole("button", { name: "Before", exact: true }).click();
    await file.getByRole("textbox", { name: "Line number", exact: true }).fill("3021");
    await file.getByRole("button", { name: "Go to line", exact: true }).click();
    await file.getByText("Context line 3021", { exact: true }).waitFor();
    const beforeContextReads = reads.length;
    await expand.click();
    await file.getByText("Context line 3021", { exact: true }).waitFor();
    assert.equal(await file.getByRole("button", { name: "Before", exact: true }).getAttribute("aria-pressed"), "true");
    await file.getByRole("button", { name: "Wide view", exact: true }).click();
    const wide = page.getByRole("dialog", { name: /^Review file:/ });
    await wide.waitFor();
    await page.keyboard.press("Escape");
    await wide.waitFor({ state: "hidden" });
    assert.equal(await restore.getAttribute("aria-pressed"), "true", "First Escape closes only nested Wide view");
    await checkRunning();
    await restore.press("Enter");
    await file.getByText("Context line 3021", { exact: true }).waitFor();
    assert.equal(reads.length, beforeContextReads, "Reading and nested layouts reuse loaded context");
    await file.getByRole("button", { name: "Changes", exact: true }).click();

    // Compact desktop keeps list/detail navigation; mobile removes redundant expansion.
    await page.setViewportSize({ width: 900, height: 800 });
    await expand.click();
    assert.equal(Math.round((await explorer.boundingBox()).width), 900);
    await explorer.getByRole("button", { name: "← Back to commits", exact: true }).click();
    await graph.waitFor();
    await graph.getByRole("button", { name: /second feature/ }).click();
    await detail.waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await expand.count(), 0);
    assert.equal(await restore.count(), 0);
    assert.equal(await explorer.evaluate((node) => node.classList.contains("git-explorer-full-width")), false);
    await page.setViewportSize(originalViewport);
    assert.equal(await expand.getAttribute("aria-pressed"), "false", "Desktop return does not re-expand");
    await checkRunning();
    await question.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await prompting).status(), 200);
    await page.getByText("E2E confirm result: false", { exact: true }).waitFor();
    console.log("PASS: whole Git Explorer fullscreen preserves mounted review state and isolates Escape from a real blocked agent");
  } finally {
    page.off("request", observe);
    if ((await api(agentPath)).state.isPromptRunning) await api(agentPath, { type: "abort" });
    await prompting;
    await page.setViewportSize(originalViewport);
  }
}
