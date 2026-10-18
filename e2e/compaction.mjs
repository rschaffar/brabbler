import assert from "node:assert/strict";
import { join } from "node:path";

/** Synthetic activity only: existing history, scoped state reads/SSE and one held compact command. */
export async function checkCompactionVisibility(page, { base, id, artifacts, width }) {
  const activity = { compacting: false };
  const url = `${base}/api/agent/${id}`;
  const stateUrl = `${base}/api/sessions/${id}/state`;
  let releaseManual, manualStarted;
  const stateRoute = async (route) => {
    const request = route.request();
    if (request.method() === "POST" && request.postDataJSON()?.type === "compact") {
      activity.compacting = true;
      await new Promise((resolve) => { releaseManual = resolve; manualStarted?.(); });
      activity.compacting = false;
      return route.fulfill({ json: { success: true, data: { tokensBefore: 10000, estimatedTokensAfter: 2000 } } });
    }
    if (request.method() !== "GET") return route.continue();
    const response = await route.fetch(), data = await response.json();
    await route.fulfill({ response, json: { ...data, running: true, state: { ...data.state,
      isStreaming: false, isPromptRunning: false, isBashRunning: false, isCompacting: activity.compacting } } });
  };
  await page.route(url, stateRoute);
  await page.route(stateUrl, stateRoute);
  await page.addInitScript((sessionId) => {
    const Original = window.EventSource, sources = [];
    window.EventSource = function (url, ...args) {
      if (new URL(String(url), location.href).pathname !== `/api/agent/${sessionId}/events`) return new Original(url, ...args);
      const source = { readyState: 1, onmessage: null, onerror: null, close() { this.readyState = 2; } };
      sources.push(source);
      // Match the real connected protocol: compaction is restored by GET state,
      // not by inventing an isCompacting field on the SSE handshake.
      queueMicrotask(() => source.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: false }) }));
      return source;
    };
    const current = () => sources.findLast((source) => source.readyState === 1);
    window.__compactionEvents = {
      ready: () => Boolean(current()?.onmessage), count: () => sources.length,
      emit(data) {
        const source = current();
        if (!source?.onmessage) throw new Error("No live compaction fixture SSE connection");
        source.onmessage({ data: JSON.stringify(data) });
      },
      disconnect() { const source = current(); source.readyState = 2; source.onerror?.(new Event("error")); },
      restore() { for (const source of sources) source.close(); window.EventSource = Original; },
    };
  }, id);
  const status = page.getByTestId("compaction-status");
  const emit = (event) => page.evaluate((event) => window.__compactionEvents.emit(event), event);
  try {
    await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__compactionEvents?.ready());
    await status.waitFor({ state: "hidden" });
    if (width < 768) assert.equal(await page.getByRole("button", { name: "More controls", exact: true }).getAttribute("aria-expanded"), "false");

    activity.compacting = true;
    await emit({ type: "compaction_start", reason: "threshold" });
    await status.waitFor();
    assert.match(await status.textContent(), /Compacting conversation….*Summarizing earlier messages/s);
    assert.equal(await status.getAttribute("role"), "status");
    const box = await status.boundingBox(), viewport = page.viewportSize();
    assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height, "Compaction progress stays in the viewport, outside More controls");
    await page.screenshot({ path: join(artifacts, `compaction-progress-${width}.png`) });

    await page.reload({ waitUntil: "domcontentloaded" });
    await status.waitFor();
    await page.waitForFunction(() => window.__compactionEvents?.ready());
    const connections = await page.evaluate(() => window.__compactionEvents.count());
    await page.evaluate(() => window.__compactionEvents.disconnect());
    await page.waitForFunction((before) => window.__compactionEvents.count() > before && window.__compactionEvents.ready(), connections);
    await status.waitFor();
    // Miss the end event entirely: compaction-only reconciliation must clear the
    // status on network return even though no prompt has ever been streaming.
    activity.compacting = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await status.waitFor({ state: "hidden" });

    activity.compacting = true;
    await emit({ type: "auto_compaction_start" }); await status.waitFor();
    activity.compacting = false;
    await emit({ type: "auto_compaction_end", aborted: true }); await status.waitFor({ state: "hidden" });
    activity.compacting = true;
    await emit({ type: "compaction_start" }); await status.waitFor();
    activity.compacting = false;
    await emit({ type: "compaction_end", errorMessage: "E2E expected compaction failure" });
    await status.waitFor({ state: "hidden" });
    await page.getByRole("alert").filter({ hasText: "E2E expected compaction failure" }).waitFor();

    for (const trigger of ["toolbar", "slash"]) {
      const started = new Promise((resolve) => { manualStarted = resolve; });
      const response = page.waitForResponse((response) => response.url() === url && response.request().method() === "POST"
        && response.request().postDataJSON()?.type === "compact");
      void response.catch(() => {});
      if (trigger === "toolbar") {
        const compact = page.getByRole("button", { name: "Compact context", exact: true });
        if (!await compact.isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
        await compact.click();
      } else {
        await page.locator(".chat-input-textarea").fill("/compact");
        await page.getByRole("button", { name: "Send", exact: true }).click();
      }
      // The existing response waiter bounds a missing POST too; never strand
      // the fixture at an unbounded synthetic start barrier.
      await Promise.race([started, response]);
      await status.waitFor();
      assert.equal(await page.locator("fieldset", { has: status }).getAttribute("aria-busy"), "false", "Compaction announcements are not deferred by a busy ancestor");
      assert.equal(await page.getByRole("alert").filter({ hasText: "E2E expected compaction failure" }).count(), 0, "New compaction clears the old failure");
      releaseManual();
      assert.equal((await response).status(), 200);
      await status.waitFor({ state: "hidden" });
      await page.waitForFunction(() => { const input = document.querySelector(".chat-input-textarea"); return input && !input.matches(":disabled"); });
    }
    await page.getByRole("heading", { name: "E2E compacted heading", exact: true }).waitFor();
    console.log(`PASS: ${width}px compaction progress, refresh/reconnect, missed completion, cancellation, failure and manual completion`);
  } finally {
    releaseManual?.();
    await page.unroute(url, stateRoute);
    await page.unroute(stateUrl, stateRoute);
    await page.evaluate(() => window.__compactionEvents?.restore()).catch(() => {});
  }
}
