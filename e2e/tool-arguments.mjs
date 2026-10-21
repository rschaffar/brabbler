import assert from "node:assert/strict";
import { join } from "node:path";
import { createOwnedRoutes } from "./owned-routes.mjs";

/** Saved transcript fixtures only. These tools never execute or create the named files. */
export function seedToolArguments({ entries, message, project }) {
  const hostile = '<img data-e2e-tool-xss src=x onerror="window.__toolArgXss=1">[unsafe](javascript:alert(1))';
  const longLabel = `E2E_${"very_long_label_".repeat(16)}`;
  const multiline = Array.from({ length: 60 }, (_, i) => `E2E argument line ${i}: ${"long_unbroken_value".repeat(20)}`).join("\n");
  const calls = [
    { id: "readable-flat", name: "e2e_arguments", arguments: { query: hostile, enabled: false, count: 0, nullable: null, empty: "", [longLabel]: multiline, [hostile]: "Malicious label remains data" } },
    { id: "readable-nested", name: "e2e_nested", arguments: { query: "nested query", nested: { text: hostile, values: [false, 0, null] } } },
    { id: "readable-write", name: "write", arguments: { path: join(project, "readable-write.txt"), content: "E2E plain write\n**not bold**\n" + hostile } },
    { id: "readable-edit", name: "edit", arguments: { path: join(project, "readable-edit.txt"), edits: [{ oldText: "E2E old text\n" + hostile, newText: "E2E replacement text\n**not bold**" }] } },
  ];
  entries[1].message.content.push(...calls.map((call) => ({ type: "toolCall", ...call })));
  let parent = "call";
  const results = calls.map((call) => {
    const result = message(`${call.id}-result`, parent, "toolResult", [{ type: "text", text: `E2E seeded ${call.id} result` }]);
    Object.assign(result.message, { toolCallId: call.id, toolName: call.name, isError: call.name === "edit" });
    parent = result.id;
    return result;
  });
  entries[2].parentId = parent;
  entries.splice(2, 0, ...results);
  return { calls, longLabel, multiline, hostile };
}

async function copyAndCheck(page, card, expected) {
  await card.getByRole("button", { name: "Copy arguments", exact: true }).click();
  await card.getByRole("status").filter({ hasText: "Copied" }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
}

export async function checkToolArguments(page, fixtures, { artifacts, width }) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const call of fixtures.calls) {
    const card = page.locator(`[data-tool-call-id="${call.id}"]`);
    await card.locator(":scope > div > button").first().click();
    const args = card.locator("[data-tool-arguments]");
    await args.waitFor();
    const expected = JSON.stringify(call.arguments, null, 2);
    if (call.id === "readable-flat") {
      const rows = args.getByRole("row");
      assert.equal(await rows.count(), Object.keys(call.arguments).length);
      for (const [key, value] of Object.entries(call.arguments)) {
        const row = rows.filter({ has: page.getByRole("rowheader", { name: key, exact: true }) });
        assert.equal(await row.getByRole("cell").textContent(), value === "" ? "(empty)" : String(value));
      }
      const pre = args.locator("td pre");
      const dimensions = await pre.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }));
      assert.ok(dimensions.scroll > dimensions.client && dimensions.client <= 260);
      await pre.focus();
      await pre.press("PageDown");
      await page.waitForFunction(() => document.querySelector('[data-tool-call-id="readable-flat"] td pre').scrollTop > 0);
      assert.ok(await args.getByRole("rowheader", { name: fixtures.longLabel, exact: true }).evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
      const geometry = await card.boundingBox();
      assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= width + 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      // The actual row font must follow the existing chat-size variable.
      const before = await args.locator("td").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      const old = await args.evaluate((el) => {
        const old = el.style.getPropertyValue("--chat-font-size-offset");
        const offset = parseFloat(getComputedStyle(el).getPropertyValue("--chat-font-size-offset")) || 0;
        el.style.setProperty("--chat-font-size-offset", `${offset + 4}px`); return old;
      });
      try {
        assert.equal(await args.locator("td").first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), before + 4);
      } finally {
        await args.evaluate((el, old) => old ? el.style.setProperty("--chat-font-size-offset", old) : el.style.removeProperty("--chat-font-size-offset"), old);
      }
      const oldWeight = await args.evaluate((el) => {
        const old = el.style.getPropertyValue("--font-mono-weight");
        el.style.setProperty("--font-mono-weight", "600"); return old;
      });
      try {
        assert.equal(await args.locator("td").first().evaluate((el) => getComputedStyle(el).fontWeight), "600");
        assert.equal(await pre.evaluate((el) => getComputedStyle(el).fontWeight), "600");
      } finally {
        await args.evaluate((el, old) => old ? el.style.setProperty("--font-mono-weight", old) : el.style.removeProperty("--font-mono-weight"), oldWeight);
      }
    } else if (call.name === "write") {
      assert.equal(await args.locator("[data-tool-file-text]").textContent(), call.arguments.content);
    } else {
      assert.equal(await args.locator("[data-tool-input]").textContent(), expected);
      assert.equal(await args.locator("table").count(), 0);
      if (call.name === "edit") await card.getByText(`E2E seeded ${call.id} result`, { exact: true }).waitFor();
    }
    assert.equal(await args.locator("img, script, iframe, a, strong").count(), 0);
    assert.equal(await page.evaluate(() => window.__toolArgXss), undefined);
    await copyAndCheck(page, card, expected);
    const raw = args.getByRole("button", { name: "Show raw arguments", exact: true });
    if (await raw.count()) {
      assert.equal(await raw.getAttribute("aria-expanded"), "false");
      await raw.focus(); await raw.press("Enter");
      assert.equal(await args.locator("[data-tool-input]").textContent(), expected);
      await args.getByRole("button", { name: "Hide raw arguments", exact: true }).click();
      assert.equal(await args.locator("[data-tool-input]").count(), 0);
    }
  }
  await page.screenshot({ path: join(artifacts, `tool-arguments-${width}.png`) });
  // Report clipboard rejection honestly without leaking an unhandled promise.
  const flat = page.locator('[data-tool-call-id="readable-flat"]');
  await page.evaluate(() => {
    window.__originalWriteText = navigator.clipboard.writeText;
    navigator.clipboard.writeText = () => Promise.reject(new Error("Expected clipboard refusal"));
  });
  try {
    await flat.getByRole("button", { name: "Copy arguments", exact: true }).click();
    await flat.getByRole("status").filter({ hasText: "Could not copy arguments" }).waitFor();
  } finally {
    await page.evaluate(() => { navigator.clipboard.writeText = window.__originalWriteText; delete window.__originalWriteText; });
  }
}

/** Scoped, synthetic SSE only: no prompt, tool execution or live provider requests. */
export async function checkStreamedToolArguments(page, { base, id, timestamp }) {
  const probe = await page.context().newPage();
  probe.setDefaultTimeout(30_000);
  let streaming = false;
  const urls = [`${base}/api/agent/${id}`, `${base}/api/sessions/${id}/state`];
  const handle = async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 409, json: { error: "Synthetic argument probe forbids commands" } });
      throw new Error("Unexpected argument-probe command");
    }
    try {
      const response = await route.fetch(), data = await response.json();
      await route.fulfill({ response, json: { ...data, running: streaming, state: { ...data.state,
        isStreaming: streaming, isPromptRunning: streaming, isBashRunning: false, isCompacting: false } } });
    } catch (error) {
      try { await route.abort("failed"); } catch (abortError) { throw new AggregateError([error, abortError], "Argument state route failed to settle"); }
      throw error;
    }
  };
  const owned = createOwnedRoutes(handle, handle);
  const failures = [];
  try {
    for (const url of urls) await probe.route(url, owned.handler);
    await probe.addInitScript((id) => {
      const Original = window.EventSource, sources = [];
      window.EventSource = function (url, ...args) {
        if (new URL(String(url), location.href).pathname !== `/api/agent/${id}/events`) return new Original(url, ...args);
        const source = { readyState: 1, onmessage: null, onerror: null, close() { this.readyState = 2; } };
        sources.push(source);
        queueMicrotask(() => source.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: false }) }));
        return source;
      };
      const current = () => sources.findLast((source) => source.readyState === 1);
      window.__toolEvents = {
        ready: () => Boolean(current()?.onmessage),
        emit: (event) => { if (!current()?.onmessage) throw new Error("Missing tool-input SSE probe"); current().onmessage({ data: JSON.stringify(event) }); },
        restore: () => { for (const source of sources) source.close(); window.EventSource = Original; },
      };
    }, id);
    const initialState = probe.waitForResponse(urls[1]);
    void initialState.catch(() => {});
    await probe.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded" });
    const initial = await initialState;
    await initial.finished();
    assert.equal((await initial.json()).running, false, "Initial mount must settle as idle before synthetic streaming");
    await probe.getByText("E2E final answer", { exact: true }).waitFor();
    await probe.waitForFunction(() => window.__toolEvents?.ready());
    const emit = (event) => probe.evaluate((event) => window.__toolEvents.emit(event), event);
    streaming = true;
    await emit({ type: "agent_start" });
    const message = { role: "assistant", content: [], timestamp: Date.parse(timestamp) };
    await emit({ type: "message_start", message });
    const update = (event) => emit({ type: "message_update", assistantMessageEvent: event });
    await update({ type: "toolcall_start", contentIndex: 0, id: "readable-stream", toolName: "e2e_stream_arguments" });
    const card = probe.locator('[data-tool-call-id="readable-stream"]');
    await card.waitFor();
    await update({ type: "toolcall_delta", contentIndex: 0, delta: '{"query":"E2E partial' });
    assert.equal(await card.locator("[data-tool-arguments]").count(), 0);
    await card.locator(":scope > div > button").first().click();
    const input = card.locator("[data-tool-input]");
    await input.waitFor();
    assert.equal(await input.textContent(), '{"query":"E2E partial');
    await copyAndCheck(probe, card, '{"query":"E2E partial');
    await update({ type: "toolcall_delta", contentIndex: 0, delta: ' and more' });
    await probe.waitForFunction(() => document.querySelector('[data-tool-call-id="readable-stream"] [data-tool-input]')?.textContent === '{"query":"E2E partial and more');
    await copyAndCheck(probe, card, '{"query":"E2E partial and more');
    const toolCall = { type: "toolCall", id: "readable-stream", name: "e2e_stream_arguments", arguments: { query: "E2E completed", enabled: false } };
    await update({ type: "toolcall_end", contentIndex: 0, toolCall });
    await card.locator("[data-tool-fields]").waitFor();
    assert.equal(await card.locator("[data-tool-input]").count(), 0);
    await copyAndCheck(probe, card, JSON.stringify(toolCall.arguments, null, 2));
    await emit({ type: "message_end", entryId: "readable-stream-entry", message: { ...message, content: [toolCall] } });
    await probe.locator('[data-entry-id="readable-stream-entry"] [data-tool-fields]').waitFor();
    assert.equal(await card.count(), 1);
    assert.equal(await card.locator(":scope > div > button").first().getAttribute("aria-expanded"), "true");
    // Deliberately no agent_end: this message was not persisted in fixture history.
  } catch (error) { failures.push(error); }
  finally {
    owned.beginDisposal();
    try {
      await owned.dispose(async (handler) => {
        const errors = [];
        for (const url of urls) try { await probe.unroute(url, handler); } catch (error) { errors.push(error); }
        if (errors.length) throw new AggregateError(errors, "Argument route removal failed");
      });
    } catch (error) { failures.push(error); }
    try { await probe.evaluate(() => window.__toolEvents?.restore()); } catch (error) { failures.push(error); }
    try { await probe.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, "Streamed argument fixture failed");
  }
}
