import assert from "node:assert/strict";
import { createOwnedRoutes } from "./owned-routes.mjs";

// Isolated browser-only transcripts/SSE: never dispatch a real provider prompt.
export async function checkChatBottomFollow(page, { base, id, timestamp }) {
  for (const short of [true, false]) {
    const probe = await page.context().newPage();
    probe.setDefaultTimeout(30_000);
    let streaming = false;
    const sessionPattern = `${base}/api/sessions/${id}?*`;
    const agentUrl = `${base}/api/agent/${id}`;
    const stateUrl = `${base}/api/sessions/${id}/state`;
    const patterns = [sessionPattern, agentUrl, stateUrl];
    const time = Date.parse(timestamp);
    const handle = async (route) => {
      const request = route.request();
      if (request.method() !== "GET") {
        assert.equal(request.url(), agentUrl);
        assert.equal(request.postDataJSON().type, "prompt");
        streaming = true;
        return route.fulfill({ json: { success: true } });
      }
      const response = await route.fetch(), data = await response.json();
      if (new URL(request.url()).pathname === `/api/sessions/${id}`) {
        const messages = [
          { role: "user", content: "Scroll fixture prompt", timestamp: time },
          { role: "assistant", content: [{ type: "text", text: "Scroll fixture history.\n\n".repeat(short ? 1 : 60) }], timestamp: time + 1 },
        ];
        return route.fulfill({ response, json: { ...data, context: { ...data.context,
          messages, entryIds: ["scroll-user", "scroll-answer"], hasMore: false, oldestEntryId: "scroll-user" } } });
      }
      await route.fulfill({ response, json: { ...data, running: streaming, state: { ...data.state,
        isStreaming: streaming, isPromptRunning: streaming, isBashRunning: false, isCompacting: false } } });
    };
    // Keep command interception fail-closed while owned requests drain.
    const owned = createOwnedRoutes(handle, handle);
    const failures = [];
    try {
      for (const pattern of patterns) await probe.route(pattern, owned.handler);
      await probe.addInitScript((id) => {
        const Original = window.EventSource, sources = [];
        window.EventSource = function (url, ...args) {
          if (new URL(String(url), location.href).pathname !== `/api/agent/${id}/events`) return new Original(url, ...args);
          const source = { readyState: 1, onmessage: null, onerror: null, close() { this.readyState = 2; } };
          sources.push(source);
          queueMicrotask(() => source.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: false }) }));
          return source;
        };
        const current = () => sources.findLast(source => source.readyState === 1);
        window.__scrollEvents = {
          ready: () => Boolean(current()?.onmessage),
          emit: event => {
            if (!current()?.onmessage) throw new Error("Missing scroll probe SSE");
            current().onmessage({ data: JSON.stringify(event) });
          },
          restore: () => { for (const source of sources) source.close(); window.EventSource = Original; },
        };
      }, id);
      const initialState = probe.waitForResponse(stateUrl);
      void initialState.catch(() => {});
      await probe.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
      await (await initialState).finished();
      await probe.locator('[data-entry-id="scroll-answer"]:not([data-message-role])').waitFor();
      await probe.waitForFunction(() => window.__scrollEvents?.ready());
      const scroller = probe.locator("[data-chat-message-column]").locator("../..");
      if (!short) {
        await scroller.evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight - 250; });
        await probe.getByRole("button", { name: "Scroll to latest", exact: true }).waitFor();
      }
      const prompt = `Bottom-follow prompt ${short ? "short" : "overflow"}`;
      await probe.locator(".chat-input-textarea").fill(prompt);
      const sent = probe.waitForResponse(response => response.url() === agentUrl && response.request().method() === "POST");
      void sent.catch(() => {});
      await probe.getByRole("button", { name: "Send", exact: true }).click();
      await sent;
      const atTail = () => probe.waitForFunction(() => {
        const el = document.querySelector("[data-chat-message-column]")?.parentElement?.parentElement;
        return el && el.scrollHeight - el.clientHeight - el.scrollTop <= 8;
      });
      await atTail();
      // Tail distance alone would also pass with the old artificial spacer.
      const geometry = await scroller.evaluate(el => {
        const column = el.querySelector("[data-chat-message-column]");
        return { height: el.clientHeight, columnHeight: column.getBoundingClientRect().height,
          gap: el.getBoundingClientRect().bottom - column.getBoundingClientRect().bottom };
      });
      if (short) assert.ok(geometry.columnHeight < geometry.height, "Short chat must not be padded to a full viewport");
      else {
        assert.ok(Math.abs(geometry.gap) <= 8, `No blank tail beneath the prompt: ${JSON.stringify(geometry)}`);
        const promptGap = await probe.getByText(prompt, { exact: true }).evaluate(el => {
          const scroll = el.closest(".overflow-y-auto");
          return scroll.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
        });
        assert.ok(promptGap >= 0 && promptGap < 150, `Prompt must remain near the bottom, not above an internal spacer: ${promptGap}`);
      }

      const emit = event => probe.evaluate(event => window.__scrollEvents.emit(event), event);
      const update = event => emit({ type: "message_update", assistantMessageEvent: event });
      await emit({ type: "agent_start" });
      await emit({ type: "message_start", message: { role: "assistant", content: [], timestamp: time + 2 } });
      await update({ type: "text_start", contentIndex: 0 });
      let chunk = 0;
      const grow = async () => {
        const sentinel = `Stream scroll chunk ${++chunk}`;
        await update({ type: "text_delta", contentIndex: 0, delta: `\n\n${sentinel}\n\n` + "Rendered response line.\n\n".repeat(16) });
        await probe.getByText(sentinel, { exact: true }).waitFor();
      };
      for (let i = 0; i < 3; i++) { await grow(); await atTail(); }
      await scroller.evaluate(el => { el.scrollTop -= 250; });
      await probe.getByRole("button", { name: "Scroll to latest", exact: true }).waitFor();
      const readingTop = await scroller.evaluate(el => el.scrollTop);
      await grow();
      // Observe after layout and the queued SSE frame, not just text insertion.
      await probe.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.ok(Math.abs(await scroller.evaluate(el => el.scrollTop) - readingTop) <= 2, "Streaming must not displace a detached reader");
      await scroller.evaluate(el => { el.scrollTop = el.scrollHeight - el.clientHeight - 40; });
      await atTail();
      await grow();
      await atTail();
      await scroller.evaluate(el => { el.scrollTop -= 250; });
      await probe.getByRole("button", { name: "Scroll to latest", exact: true }).click();
      await atTail();
      await grow();
      await atTail();
      // Do not reconcile synthetic output with the genuine on-disk transcript.
    } catch (error) { failures.push(error); }
    finally {
      owned.beginDisposal();
      try {
        await owned.dispose(async handler => {
          const errors = [];
          for (const pattern of patterns) try { await probe.unroute(pattern, handler); } catch (error) { errors.push(error); }
          if (errors.length) throw new AggregateError(errors, "Scroll route removal failed");
        });
      } catch (error) { failures.push(error); }
      try { await probe.evaluate(() => window.__scrollEvents?.restore()); } catch (error) { failures.push(error); }
      try { await probe.close(); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, "Bottom-follow fixture failed");
    }
  }
}
