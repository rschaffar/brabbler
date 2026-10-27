import assert from "node:assert/strict";
import { waitForAsyncCondition } from "./async-condition.mjs";

function notesSurface(page) {
  const trigger = page.locator(".app-topbar").getByRole("button", { name: "Notes", exact: true });
  const dialog = page.getByRole("dialog", { name: "Notes", exact: true });
  const global = dialog.getByRole("textbox", { name: "Global", exact: true });
  const local = dialog.getByRole("textbox", { name: "Project", exact: true });
  const ready = async () => {
    await dialog.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".scratchpad-note textarea")].length === 2
      && [...document.querySelectorAll(".scratchpad-note textarea")].every(el => !el.disabled));
    assert.equal(await dialog.evaluate(el => el.tagName === "DIALOG" && el.matches(":modal")
      && el.contains(document.activeElement)), true);
  };
  return { trigger, dialog, global, local, ready };
}

async function projectScope(page, base, cwd) {
  const response = await page.request.get(`${base}/api/scratchpad?${new URLSearchParams({ projectCwd: cwd })}`);
  const data = await response.json();
  assert.equal(response.status(), 200);
  assert.match(data.projectId, /^[a-f0-9]{64}$/);
  return data;
}
async function saved(page, projectId, text) {
  await waitForAsyncCondition(page, async ({ projectId, text }) => {
    const response = await fetch(`/api/scratchpad${projectId === null ? "" : `?projectId=${encodeURIComponent(projectId)}`}`);
    if (!response.ok) throw new Error(`Scratchpad read: ${response.status}`);
    return (await response.json()).text === text;
  }, { projectId, text });
  await page.waitForFunction(() => [...document.querySelectorAll(".scratchpad-status [role=status]")]
    .every(el => el.textContent === "Saved to server"));
}

/** Native keyboard/modal, durable project roundtrip and thin selected-project bridges. */
export async function checkNotesNativeJourney(page, { base, sessionId, projectCwd, gitSessionId, linkedSessionId, gitCwd, linkedCwd }) {
  page.setDefaultTimeout(30_000);
  const prefix = "scratch-en-desktop";
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".markdown-code-block pre").waitFor();
  const { trigger, dialog, global, local, ready } = notesSurface(page);
  await trigger.click(); await ready();
  const project = await projectScope(page, base, projectCwd);
  assert.equal(await dialog.locator('section[aria-label="Project"] p[title]').getAttribute("title"), project.root);
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  const g = await global.boundingBox(), l = await local.boundingBox();
  assert.ok(g && l && l.x > g.x + g.width, "Desktop editors are side by side");
  await global.focus();
  await global.dispatchEvent("compositionstart", { data: "" });
  await global.press("Escape");
  assert.equal(await dialog.isVisible(), true, "IME cancellation does not close Notes");
  await global.dispatchEvent("compositionend", { data: "" });
  const originalUrl = page.url();
  await global.press("Control+Alt+n");
  assert.equal(page.url(), originalUrl, "Native modal keys cannot create a background chat");
  await global.fill(prefix); await saved(page, null, prefix);
  assert.equal(await global.evaluate(el => document.activeElement === el), true);
  await local.fill(`${prefix}-project`); await saved(page, project.projectId, `${prefix}-project`);
  await global.press("End"); await global.pressSequentially(" xyz"); await saved(page, null, `${prefix} xyz`);
  await global.press("Control+z"); assert.equal(await global.inputValue(), prefix); await saved(page, null, prefix);
  await global.press("Control+Shift+z"); assert.equal(await global.inputValue(), `${prefix} xyz`); await saved(page, null, `${prefix} xyz`);
  assert.equal(await local.inputValue(), `${prefix}-project`, "Native undo does not touch the other scope");
  await global.press("Escape"); await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await trigger.click(); await ready();
  assert.equal(await global.inputValue(), `${prefix} xyz`);
  assert.equal(await local.inputValue(), `${prefix}-project`);
  await dialog.getByRole("button", { name: "Close notes", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  // The actual shell supplies a selected folder with no saved chat. No prompt is sent.
  await page.goto(`${base}/?${new URLSearchParams({ cwd: projectCwd })}`, { waitUntil: "domcontentloaded" });
  await page.locator(".chat-input-textarea").waitFor();
  await trigger.click(); await ready();
  assert.equal(new URL(page.url()).searchParams.has("session"), false);
  assert.equal(await local.inputValue(), `${prefix}-project`, "Project notes are available before a chat's first message");
  await dialog.getByRole("button", { name: "Close notes", exact: true }).click();

  // Different chat IDs and real checkout roots still bind the same private project note.
  await page.goto(`${base}/?session=${gitSessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Ready to browse Git history", { exact: true }).waitFor();
  await trigger.click(); await ready();
  const gitProject = await projectScope(page, base, gitCwd);
  const linkedProject = await projectScope(page, base, linkedCwd);
  assert.equal(gitProject.projectId, linkedProject.projectId);
  assert.notEqual(gitProject.projectId, project.projectId);
  assert.equal(await local.inputValue(), "", "A separate project starts with separate notes");
  await local.fill("Shared across Git chats and worktrees"); await saved(page, gitProject.projectId, "Shared across Git chats and worktrees");
  await page.goto(`${base}/?session=${linkedSessionId}`, { waitUntil: "domcontentloaded" });
  await page.getByText("Active branch answer", { exact: true }).waitFor();
  await trigger.click(); await ready();
  assert.equal(await local.inputValue(), "Shared across Git chats and worktrees", "AppShell uses project identity, not chat or checkout identity");
  assert.equal(await global.inputValue(), `${prefix} xyz`);
  await dialog.getByRole("button", { name: "Close notes", exact: true }).click();
  console.log("PASS: desktop Notes native undo/modal, Global + Project persistence, no-chat folder and shared Git/worktree bridge");
}

/** Fresh 390x600 touch context reads the desktop predecessor; it never rewrites notes. */
export async function checkNotesTouchGeometry(page, { base, sessionId }) {
  page.setDefaultTimeout(30_000);
  assert.deepEqual(page.viewportSize(), { width: 390, height: 600 });
  await page.goto(`${base}/?session=${sessionId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".markdown-code-block pre").waitFor();
  const { trigger, dialog, global, local, ready } = notesSurface(page);
  await trigger.tap(); await ready();
  assert.equal(await global.inputValue(), "scratch-en-desktop xyz", "Actual shared server predecessor, not a fabricated layout body");
  assert.equal(await local.inputValue(), "scratch-en-desktop-project");
  const bounds = await dialog.boundingBox(), viewport = page.viewportSize();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0
    && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  const g = await global.boundingBox(), l = await local.boundingBox();
  assert.ok(g && l && l.y > g.y + g.height, "Short-touch editors stack");
  await local.scrollIntoViewIfNeeded();
  await local.tap();
  assert.equal(await local.evaluate(el => document.activeElement === el), true);
  const undo = dialog.getByRole("button", { name: "Undo Project notes", exact: true });
  await undo.scrollIntoViewIfNeeded();
  assert.equal(await undo.evaluate(el => {
    const rect = el.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight
      && el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), true, "Last scope action is reachable inside native modal");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const close = dialog.getByRole("button", { name: "Close notes", exact: true });
  await close.scrollIntoViewIfNeeded(); await close.tap();
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
  console.log("PASS: short-touch Project Notes bounds, stacked editors, focus and reachability without repeated writes");
}
