import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const RUNNING_FORK_IDS = [1280, 390].map((width) => `e2e-running-fork-${width}`);

export function seedRunningForkFixtures({ agentDir, writeSession, message }) {
  // Keep copied sessions out of unrelated sidebar fixtures' virtualized lists.
  const project = join(agentDir, "running-fork-project");
  mkdirSync(project);
  for (const width of [1280, 390]) {
    writeSession(`e2e-running-fork-${width}`, [
      message("root", null, "user", `Running fork root ${width}`),
      message("reply", "root", "assistant", `Running fork answer ${width}`),
      message("retry", "reply", "user", `Retry this message ${width}`),
      message("later", "retry", "assistant", `Later answer ${width}`),
    ], project);
  }
}

export async function checkRunningSessionForks(page, { base, api, post, artifacts, width }) {
  const sourceId = `e2e-running-fork-${width}`;
  const sourcePath = `/api/agent/${sourceId}`;
  await page.context().addInitScript(() => localStorage.setItem("pi-quote-selection-enabled", "true"));
  await page.goto(`${base}/?session=${sourceId}`, { waitUntil: "domcontentloaded" });
  await page.getByText(`Later answer ${width}`, { exact: true }).waitFor();
  const origin = await page.evaluate(() => performance.timeOrigin);
  const question = () => page.getByRole("group", { name: "E2E confirm", exact: true });
  const responseFor = (type) => page.waitForResponse((response) =>
    new URL(response.url()).pathname === sourcePath && response.request().method() === "POST"
    && response.request().postDataJSON()?.type === type, { timeout: 120_000 });
  // A genuine SDK extension command stays active without a provider request.
  const prompting = responseFor("prompt");
  await page.locator(".chat-input-textarea").fill("/e2e-dialog confirm");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await question().waitFor();
  const original = await api(`/api/sessions/${sourceId}`);
  const originalBytes = readFileSync(original.filePath, "utf8");
  const originalAttention = (await api("/api/agent/running")).attention.find((item) => item.sessionId === sourceId);
  assert.ok(originalAttention);

  const checkSource = async () => {
    const state = (await api(sourcePath)).state;
    assert.equal(state.sessionId, sourceId);
    assert.equal(state.isPromptRunning, true, "The original prompt must remain pending");
    const running = await api("/api/agent/running");
    assert.ok(running.runningSessionIds.includes(sourceId));
    assert.deepEqual(running.attention.find((item) => item.sessionId === sourceId), originalAttention);
    const current = await api(`/api/sessions/${sourceId}`);
    assert.equal(current.leafId, original.leafId);
    assert.deepEqual(current.context.entryIds, original.context.entryIds);
    assert.equal(readFileSync(original.filePath, "utf8"), originalBytes, "Copying must not write the source");
  };
  const checkChild = async (response, expectedIds) => {
    assert.equal(response.status(), 200);
    const { data } = await response.json();
    assert.equal(data.cancelled, false);
    assert.notEqual(data.newSessionId, sourceId);
    await page.waitForFunction((id) => new URL(location.href).searchParams.get("session") === id, data.newSessionId);
    const child = await api(`/api/sessions/${data.newSessionId}`);
    assert.deepEqual(child.context.entryIds, expectedIds);
    assert.equal(JSON.parse(readFileSync(child.filePath, "utf8").split("\n")[0]).parentSession, original.filePath);
    await question().waitFor({ state: "hidden" });
    assert.equal(await question().count(), 0, "The child's chat must not inherit the live question");
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Forking must not reload the browser");
    await checkSource();
  };
  const returnToSource = async () => {
    const sidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await sidebar.isVisible()) await sidebar.click();
    await page.locator(`.session-row[data-session-id="${sourceId}"]`).click({ position: { x: 12, y: 12 } });
    await question().waitFor();
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  };

  try {
    for (const [entryId, expectedIds] of [["retry", ["root", "reply"]], ["root", []]]) {
      const entry = page.locator(`[data-entry-id="${entryId}"]:not([data-message-role])`);
      await entry.hover();
      assert.equal(await entry.getByRole("button", { name: "Edit from here", exact: true }).count(), 0);
      const response = responseFor("fork");
      await entry.getByRole("button", { name: "New session", exact: true }).click();
      const saved = await response;
      assert.deepEqual(saved.request().postDataJSON(), { type: "fork", entryId });
      await checkChild(saved, expectedIds);
      await returnToSource();
    }

    // Select persisted response text, then exercise the actual quote composer.
    const answer = page.getByText(`Running fork answer ${width}`, { exact: true });
    await answer.scrollIntoViewIfNeeded();
    await answer.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Ask in new chat", exact: true }).click();
    const composer = page.getByRole("dialog").filter({ has: page.locator(".chat-input-textarea") });
    // Ask in new chat sends immediately. Use another fixture command so the
    // child can run independently without touching a provider.
    await composer.locator(".chat-input-textarea").fill("/e2e-dialog input");
    const childPrompt = page.waitForResponse((response) => response.request().method() === "POST"
      && /^\/api\/agent\/[^/]+$/.test(new URL(response.url()).pathname)
      && response.request().postDataJSON()?.message === "/e2e-dialog input");
    const quotedFork = responseFor("fork_branch");
    await composer.getByRole("button", { name: "Send", exact: true }).click();
    const saved = await quotedFork;
    assert.deepEqual(saved.request().postDataJSON(), { type: "fork_branch", entryId: "reply" });
    await checkChild(saved, ["root", "reply"]);
    const childQuestion = page.getByRole("group", { name: "E2E input", exact: true });
    await childQuestion.waitFor();
    await checkSource();
    await childQuestion.getByRole("textbox").fill("Independent child answer");
    await childQuestion.getByRole("button", { name: "Submit", exact: true }).click();
    assert.equal((await childPrompt).status(), 200);
    await page.getByText("E2E input result: Independent child answer", { exact: true }).waitFor();
    await returnToSource();
    await page.screenshot({ path: join(artifacts, `running-fork-${width}.png`) });
    await question().getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal((await prompting).status(), 200);
    await page.getByText("E2E confirm result: false", { exact: true }).waitFor();
    assert.equal((await api(sourcePath)).state.isPromptRunning, false);
    console.log(`PASS: ${width}px running-message/root/quoted forks preserve the original prompt and question`);
  } finally {
    if ((await api(sourcePath)).state.isPromptRunning) await post(sourcePath, { type: "abort" });
    await prompting;
  }
}
