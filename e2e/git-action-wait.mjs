import assert from "node:assert/strict";

/** Read a replay on an independent SSE connection, then disconnect without answering. */
async function pendingGitRequest(base, sessionId) {
  const response = await fetch(`${base}/api/agent/${sessionId}/events`, { signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      assert.equal(done, false, "Expected the pending Git question to replay");
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === "extension_ui_request" && event.method === "git_action") return event;
      }
    }
  } finally { await reader.cancel(); }
}

export async function checkGitDecisionWaiting(page, { base, width }) {
  const sessionId = new URL(page.url()).searchParams.get("session");
  assert.ok(sessionId);
  const card = page.getByRole("group", { name: "Authorize ordered checks", exact: true });
  const start = async () => {
    await page.locator("textarea").last().fill("/e2e-git-wait");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await card.waitFor();
    await card.getByText("Waits for your response or Stop; no automatic response timeout.", { exact: true }).waitFor();
    const request = await pendingGitRequest(base, sessionId);
    assert.equal("timeout" in request, false);
    assert.equal("expiresAt" in request, false);
    return request;
  };
  const finish = async (result) => {
    await card.waitFor({ state: "hidden" });
    await page.getByText(`E2E Git decision: ${result}`, { exact: true }).waitFor();
    await page.getByTitle("Stop agent", { exact: true }).waitFor({ state: "hidden" });
  };

  const original = await start();
  await page.reload({ waitUntil: "domcontentloaded" });
  await card.waitFor();
  const replay = await pendingGitRequest(base, sessionId);
  assert.equal(replay.id, original.id, "Reload retains the original live decision, not a new approval");
  assert.equal("expiresAt" in replay, false);
  assert.equal(await card.getByRole("checkbox").count(), 0, "The approval button is the decision; no review checkbox");
  assert.equal(await card.getByRole("button", { name: "Run these checks", exact: true }).isEnabled(), true);
  await card.getByRole("button", { name: "Run these checks", exact: true }).click();
  await finish("true");

  await start();
  await card.getByRole("button", { name: "Decline checks", exact: true }).click();
  await finish("false");

  const stopped = await start();
  if (!await page.getByTitle("Stop agent", { exact: true }).isVisible()) {
    await page.locator('button[aria-label="More controls"]:not([data-mobile-toolbar-more])').click();
  }
  await page.getByTitle("Stop agent", { exact: true }).click();
  await finish("interrupted");
  const collapse = page.getByRole("button", { name: "Collapse controls", exact: true });
  if (await collapse.isVisible()) await collapse.click();
  const late = await fetch(`${base}/api/agent/${sessionId}`, { method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "extension_ui_response", id: stopped.id, confirmed: true }),
    signal: AbortSignal.timeout(10_000) });
  assert.equal(late.status, 200, "Late responses are ignored, never replayed");
  assert.equal(await card.count(), 0);
  console.log(`PASS: ${width}px Git approval has no response deadline, survives reload/disconnect, and supports approve/decline/Stop`);
}
