import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";

export function seedSourceHighlighting({ project, writeSession, message }) {
  const sessionId = "e2e-highlight-source", fencesId = "e2e-highlight-fences";
  const small = join(project, "highlight.tsx");
  writeFileSync(small, Array.from({ length: 260 }, (_, i) => i === 179
    ? 'export const HighlightTarget = <a href="source">Highlight sentinel</a>;'
    : `// source row ${i + 1}`).join("\n"));
  writeFileSync(join(project, "highlight-large.tsx"), "export const x = <b>large</b>;\n".repeat(1100));
  writeFileSync(join(project, "highlight-plain.txt"), "Plain highlighting sentinel\n");
  writeFileSync(join(project, "highlight.csv"), "name,value\nrow,1\n");
  const sourceEntries = [message("user", null, "user", "Highlight source fixture"), message("answer", "user", "assistant",
    "[Large source](highlight-large.tsx#L1050)\n\n[Plain source](highlight-plain.txt)\n\n[CSV preview](highlight.csv)\n\n[Typed source](highlight.tsx#L180-L182)")];
  writeSession(sessionId, sourceEntries);
  writeSession(fencesId, [message("user", null, "user", "Highlight fences fixture"), message("answer", "user", "assistant",
    Array.from({ length: 10 }, (_, i) => `\`\`\`tsx\nconst fence${i} = <a href="fence-${i}">Fence ${i}</a>;\n\`\`\``).join("\n\n"))]);
  return { sessionId, fencesId };
}

/** Synthetic sessions/files and browser-owned idle/SSE gates; never a provider prompt. */
export async function checkSourceHighlighting(page, base, fixture) {
  await page.addInitScript(({ id }) => {
    if (new URL(location.href).searchParams.get("session") !== id) return;
    const idle = window.requestIdleCallback, cancelIdle = window.cancelIdleCallback;
    const waiting = new Map(); let nextId = 0;
    window.requestIdleCallback = cb => { const key = ++nextId; waiting.set(key, cb); return key; };
    window.cancelIdleCallback = key => waiting.delete(key);
    const Original = window.EventSource, sources = [];
    window.EventSource = function(url, ...args) {
      if (new URL(String(url), location.href).pathname !== `/api/agent/${id}/events`) return new Original(url, ...args);
      const source = { readyState: 1, onmessage: null, onerror: null, close() { this.readyState = 2; } };
      sources.push(source);
      queueMicrotask(() => source.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: false }) }));
      return source;
    };
    window.__highlightFixture = {
      pending: () => waiting.size,
      release() {
        const first = waiting.entries().next().value;
        if (!first) throw new Error("No owned idle callback");
        waiting.delete(first[0]); first[1]({ didTimeout: false, timeRemaining: () => 10 });
      },
      ready: () => sources.some(source => source.readyState === 1 && source.onmessage),
      emit(event) {
        const source = sources.findLast(source => source.readyState === 1 && source.onmessage);
        if (!source) throw new Error("No synthetic highlight SSE connection");
        source.onmessage({ data: JSON.stringify(event) });
      },
      restore() {
        window.EventSource = Original;
        for (const source of sources) source.close();
        window.requestIdleCallback = idle; window.cancelIdleCallback = cancelIdle;
        for (const cb of waiting.values()) setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 10 }), 0);
        waiting.clear();
      },
    };
  }, { id: fixture.sessionId });
  const panel = page.locator("#file-panel"), pane = panel.locator(".file-viewer-content");
  const hidePanel = async () => {
    const hide = panel.getByRole("button", { name: "Hide file panel", exact: true });
    if (await hide.count() && await hide.getAttribute("aria-expanded") === "true") await hide.click();
  };
  const open = async name => { await hidePanel(); await page.getByRole("link", { name, exact: true }).click(); };
  const select = async id => {
    await hidePanel();
    const show = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await show.isVisible()) await show.click();
    // Match existing history fixtures: the row's center contains hover actions.
    await page.locator(`#session-sidebar [data-session-id="${id}"]`).click({ position: { x: 12, y: 12 } });
    await page.waitForFunction(id => new URL(location.href).searchParams.get("session") === id, id);
  };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const chunks = [];
  const owned = createOwnedRoutes(async route => {
    chunks.push(route.request().url());
    await page.evaluate(() => { window.__highlightChunkRequested = true; });
    await gate; await route.continue();
  }, route => route.continue());
  const pattern = "**/_next/static/chunks/*.js";
  const failures = [];
  try {
    await page.goto(`${base}/?session=${fixture.sessionId}`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Typed source", exact: true }).waitFor();
    await page.waitForFunction(() => window.__highlightFixture.ready());
    await page.route(pattern, owned.handler);
    // Excluded grammar-demand policies have actual FileViewer owners. Keep the
    // exact installed large/plain/CSV inputs once, not another compact traversal.
    if (page.viewportSize().width > 640) {
      await open("Large source");
      await pane.locator('.is-lightweight [data-line-number="1050"]').waitFor();
      assert.equal(chunks.length, 0, "large fallback does not demand all grammars");
      await open("Plain source");
      await pane.getByText("Plain highlighting sentinel", { exact: true }).waitFor();
      assert.equal(chunks.length, 0, "plain source does not demand all grammars");
      await open("CSV preview");
      await pane.getByRole("table").waitFor();
      assert.equal(chunks.length, 0, "table preview does not demand source grammars");
    }
    // Wait for actual deferred JavaScript demand without depending on a hashed chunk name.
    await open("Typed source");
    await page.waitForFunction(() => window.__highlightChunkRequested === true);
    const target = pane.locator('[data-line-number="180"]');
    await target.waitFor();
    await page.waitForFunction(() => document.querySelector('[data-line-number="180"][data-file-line-target]'));
    assert.ok(chunks.length > 0, "bounded typed Source requests a separate grammar chunk");
    assert.equal(await pane.locator(".token.attr-equals").count(), 0, "held chunk leaves plain source");
    const before = await pane.evaluate(root => {
      const content = root.querySelector('[data-line-number="180"] .file-source-line-content');
      const range = document.createRange(); range.selectNodeContents(content);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      return { selection: selection.toString(), scroll: root.scrollTop, height: content.getBoundingClientRect().height };
    });
    // Response completion alone is not script execution. Observe the actual
    // deferred script load events, then let import microtasks/React paint settle.
    // This also works on mobile, where the chat CodeBlock surface is unmounted
    // while Files is active, so an off-pane code fence cannot be a readiness probe.
    await page.evaluate(urls => {
      const remaining = new Set(urls);
      const scripts = [...document.scripts].filter(script => remaining.has(script.src));
      if (scripts.length !== remaining.size) throw new Error("Deferred script element missing");
      for (const script of scripts) script.addEventListener("load", () => {
        remaining.delete(script.src);
        if (!remaining.size) window.__highlightChunkExecuted = true;
      }, { once: true });
    }, chunks);
    release();
    await owned.dispose(handler => page.unroute(pattern, handler));
    await page.waitForFunction(() => window.__highlightChunkExecuted === true);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => getSelection().toString()), before.selection);
    assert.equal(await pane.locator(".token.attr-equals").count(), 0, "active selection delays text-node replacement");
    await page.evaluate(() => getSelection().removeAllRanges());
    await pane.locator(".token.attr-equals").first().waitFor();
    assert.equal(await target.getAttribute("data-file-line-target"), "true");
    const after = await pane.evaluate(root => ({ scroll: root.scrollTop, height: root.querySelector('[data-line-number="180"] .file-source-line-content').getBoundingClientRect().height }));
    assert.ok(Math.abs(after.scroll - before.scroll) <= 1, "color arrival preserves source reading position");
    assert.equal(after.height, before.height);
    await panel.getByRole("button", { name: "Enable word wrap", exact: true }).click();
    await pane.locator(".file-source-view.is-wrapped").waitFor();

    await select(fixture.fencesId);
    const blocks = page.locator(".markdown-code-block");
    await blocks.nth(9).waitFor();
    await page.waitForFunction(() => window.__highlightFixture.pending() === 1);
    assert.equal(await blocks.locator(".token.attr-equals").count(), 0);
    const heights = await blocks.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height));
    // Keep exact ten-fence cancellation/default composition once. Both inputs
    // still color all ten actual fences and compare their physical heights.
    if (page.viewportSize().width > 640) {
      await page.evaluate(() => window.__highlightFixture.release());
      await blocks.nth(9).locator(".token.attr-equals").first().waitFor();
      assert.equal(await blocks.filter({ has: page.locator(".token.attr-equals") }).count(), 1, "one completed fence per slice");
      await select(fixture.sessionId);
      await page.getByRole("link", { name: "Typed source", exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__highlightFixture.pending()), 0, "unmount cancels the owned idle handle");
      await select(fixture.fencesId);
      await blocks.nth(9).waitFor();
    }
    for (let i = 0; i < 10; i++) {
      await page.waitForFunction(() => window.__highlightFixture.pending() === 1);
      await page.evaluate(() => window.__highlightFixture.release());
      await page.waitForFunction(expected => [...document.querySelectorAll(".markdown-code-block")].filter(node => node.querySelector(".token.attr-equals")).length === expected, i + 1);
    }
    assert.deepEqual(await blocks.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().height)), heights);
    assert.equal(await page.evaluate(() => window.__highlightFixture.pending()), 0);

    // Synthetic streaming tokenization is a functional handoff, not another
    // geometry input. Preserve its exact installed sequence once at desktop.
    if (page.viewportSize().width > 640) {
      await select(fixture.sessionId);
      await page.waitForFunction(() => window.__highlightFixture.ready());
      const emit = event => page.evaluate(event => window.__highlightFixture.emit(event), event);
      await emit({ type: "agent_start" });
      await emit({ type: "message_start", message: { role: "assistant", content: [] } });
      await emit({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
      const streamed = '```tsx\nconst streamed = <b>Stream highlight sentinel</b>;\n```';
      await emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: streamed } });
      const live = blocks.filter({ hasText: "Stream highlight sentinel" });
      await live.waitFor(); assert.equal(await live.locator(".token").count(), 0);
      assert.equal(await page.evaluate(() => window.__highlightFixture.pending()), 0, "live streaming never queues tokenization");
      // Exercise message_end's actual rendering owner before agent settlement
      // reconciles canonical history. This is synthetic UI streaming, not a saved
      // provider turn: never invent a durable entry ID or rewrite an SDK-owned file.
      await emit({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: streamed }] } });
      await page.waitForFunction(() => window.__highlightFixture.pending() === 1);
      assert.equal(await live.locator(".token").count(), 0);
      await page.evaluate(() => window.__highlightFixture.release());
      await live.locator(".token").first().waitFor();
      await emit({ type: "agent_settled" });
    }
    console.log(`PASS: ${page.viewportSize().width}px lazy source grammars, selection/coordinates/layout and ten deferred fences${page.viewportSize().width > 640 ? ", cancellation/streaming handoff" : ""}`);
  } catch (error) { failures.push(error); }
  finally {
    owned.beginDisposal(); release();
    try { await owned.dispose(handler => page.unroute(pattern, handler)); } catch (error) { failures.push(error); }
    try { await page.evaluate(() => window.__highlightFixture?.restore()); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Highlighting fixture failed");
  }
}
