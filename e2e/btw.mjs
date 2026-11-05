import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { waitForForkResponse } from "./running-session-forks.mjs";

/** Real configured provider: BTW must not need a fixture extension to answer. */
export async function prepareBtwProvider(agentDir) {
  const requests = [], errors = [], pending = new Set(), releases = new Set();
  let nextHold;
  const holdNext = () => {
    assert.equal(nextHold, undefined);
    let release, arrive;
    const blocked = new Promise(resolve => { release = resolve; });
    const arrived = new Promise(resolve => { arrive = resolve; });
    nextHold = { blocked, arrive }; releases.add(release);
    return { arrived, release: () => { release(); releases.delete(release); } };
  };
  const server = createServer((request, response) => {
    const chunks = [];
    request.on("error", error => errors.push(error));
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      const work = (async () => { try {
        assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/chat/completions");
        requests.push(JSON.parse(Buffer.concat(chunks).toString()));
        const held = nextHold; nextHold = undefined;
        if (held) { held.arrive(); await held.blocked; }
        if (response.destroyed) return;
        response.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = { id: `btw-${requests.length}`, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "text" };
        response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: held ? "E2E BTW recall answer" : "E2E BTW answer" }, finish_reason: null }] })}\n\n`);
        response.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        response.end("data: [DONE]\n\n");
      } catch (error) { errors.push(error); if (!response.destroyed) { response.writeHead(500); response.end("Fixture request failed"); } } })();
      pending.add(work); void work.finally(() => pending.delete(work));
    });
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  server.on("error", error => errors.push(error));
  const close = async () => {
    for (const release of releases) release();
    await Promise.all(pending);
    await new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
    assert.deepEqual(errors, [], "BTW provider errors");
  };
  try {
    const path = join(agentDir, "models.json");
    const models = JSON.parse(readFileSync(path, "utf8"));
    models.providers["e2e-btw"] = { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, api: "openai-completions", apiKey: "synthetic-unused",
      models: [{ id: "text", name: "BTW fixture", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] };
    writeFileSync(path, JSON.stringify(models));
    const settingsPath = join(agentDir, "settings.json"), settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    settings.enabledModels = [...(settings.enabledModels ?? []), "e2e-btw/text"];
    writeFileSync(settingsPath, JSON.stringify(settings));
    return { requests, close, holdNext };
  } catch (error) { await close(); throw error; }
}

export async function checkBtwWhileWaiting(page, { base, api, post, artifacts, width, provider }) {
  const sourceId = `e2e-running-fork-${width}`, sourcePath = `/api/agent/${sourceId}`;
  await post(sourcePath, { type: "set_model", provider: "e2e-btw", modelId: "text" });
  await page.goto(`${base}/?session=${sourceId}`, { waitUntil: "domcontentloaded" });
  const activate = locator => width <= 640 ? locator.tap() : locator.click();
  const question = page.getByRole("group", { name: "E2E browser question", exact: true });
  const main = page.locator("#chat-content > div .chat-input-textarea");
  const waits = [];
  const responseFor = predicate => { const promise = waitForForkResponse(page, predicate); waits.push(promise); return promise; };
  responseFor(response => new URL(response.url()).pathname === sourcePath && response.request().method() === "POST" && response.request().postDataJSON()?.type === "prompt");
  let childId, observe, failure, releaseAnswer;
  try {
    await main.fill("/e2e-ask-user freeform");
    await activate(page.getByRole("button", { name: "Send", exact: true }));
    await question.waitFor();
    const questionNode = await question.elementHandle();
    const answer = question.locator("textarea").first();
    await answer.fill("Unsubmitted source answer");
    const answerNode = await answer.elementHandle(), mainNode = await main.elementHandle();
    const draft = "  Source draft\nKeep this unsent  ";
    await main.fill(draft);
    const draftKey = `brabbler:composer-draft:v1:${sourceId}`;
    await page.waitForFunction(({ key, value }) => JSON.parse(localStorage.getItem(key))?.value === value, { key: draftKey, value: draft });
    const original = await api(`/api/sessions/${sourceId}`), bytes = readFileSync(original.filePath, "utf8");
    const attention = (await api("/api/agent/running")).attention.find(item => item.sessionId === sourceId);
    assert.ok(attention);
    const commands = [];
    observe = request => { if (new URL(request.url()).pathname === sourcePath && request.method() === "POST" && ["prompt", "steer", "follow_up", "abort", "extension_ui_response", "pause", "resume"].includes(request.postDataJSON()?.type)) commands.push(request.postDataJSON()); };
    page.on("request", observe);
    const checkSource = async () => {
      assert.equal((await api(sourcePath)).state.isPromptRunning, true);
      assert.deepEqual((await api("/api/agent/running")).attention.find(item => item.sessionId === sourceId), attention);
      const current = await api(`/api/sessions/${sourceId}`);
      assert.equal(current.leafId, original.leafId); assert.deepEqual(current.context.entryIds, original.context.entryIds);
      assert.equal(readFileSync(original.filePath, "utf8"), bytes);
      assert.deepEqual(commands, [], "BTW must not command or answer its source");
    };
    const panel = page.getByRole("complementary", { name: "BTW", exact: true });
    const open = async () => {
      const pending = responseFor(response => new URL(response.url()).pathname === `/api/sessions/${sourceId}/btw` && response.request().method() === "POST");
      await activate(page.getByRole("button", { name: "Ask a side question", exact: true }));
      const response = await pending; assert.equal(response.status(), 200);
      const data = await response.json(); assert.equal(data.session.relation.kind, "btw");
      await panel.locator(".chat-input-textarea").waitFor();
      return data;
    };
    const count = provider.requests.length, created = await open(); childId = created.session.id;
    assert.equal(provider.requests.length, count, "Opening BTW never prompts a model");
    assert.match(created.snapshot.text, /E2E browser question/);
    const bounds = await panel.boundingBox(), area = await page.locator("#chat-content").boundingBox();
    assert.ok(bounds.x >= area.x - 1 && bounds.y >= area.y - 1 && bounds.x + bounds.width <= area.x + area.width + 1 && bounds.y + bounds.height <= area.y + area.height + 1);
    if (width > 640) {
      const sourceBounds = await mainNode.boundingBox(); assert.ok(sourceBounds.x + sourceBounds.width <= bounds.x + 1, "Desktop chats are adjacent");
      await panel.getByRole("separator", { name: "Resize BTW panel" }).press("ArrowLeft");
      assert.ok((await panel.boundingBox()).width > bounds.width, "Keyboard resize changes real geometry");
    } else {
      assert.equal(await mainNode.evaluate(element => Boolean(element.closest("[inert]"))), true);
      for (const control of [panel.getByRole("button", { name: "Minimize BTW" }), panel.getByRole("button", { name: "Open full-size", exact: true }), panel.locator(".chat-input-textarea"), panel.getByRole("button", { name: "Copy latest answer to main draft", exact: true })]) {
        assert.equal(await control.evaluate(element => { const b = element.getBoundingClientRect(), p = element.closest("aside").getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.x >= p.x && b.y >= p.y && b.right <= p.right + 1 && b.bottom <= p.bottom + 1 && element.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }), true, "Mobile control fits and receives hits");
      }
    }
    await panel.locator(".chat-input-textarea").fill(`BTW question ${width}`);
    const childPrompt = responseFor(response => new URL(response.url()).pathname === `/api/agent/${childId}` && response.request().method() === "POST" && response.request().postDataJSON()?.type === "prompt");
    await activate(panel.getByRole("button", { name: "Send", exact: true }));
    assert.equal((await childPrompt).status(), 200);
    await panel.getByText("E2E BTW answer", { exact: true }).waitFor();
    await waitForAsyncCondition(page, async id => !(await (await fetch(`/api/agent/${id}`)).json()).state.isPromptRunning, childId);
    assert.equal(provider.requests.length, count + 1);
    assert.deepEqual(provider.requests.at(-1).tools ?? [], [], "BTW advertises no tools to the real provider adapter");
    await checkSource();
    assert.equal(await questionNode.evaluate(element => element.isConnected), true);
    assert.equal(await answerNode.inputValue(), "Unsubmitted source answer"); assert.equal(await mainNode.inputValue(), draft);
    await page.screenshot({ path: join(artifacts, `btw-${width}.png`), fullPage: true });
    await activate(panel.getByRole("button", { name: "Minimize BTW" }));
    assert.equal(await question.elementHandle().then(handle => handle.evaluate((element, original) => element === original, questionNode)), true);
    assert.equal(await answer.inputValue(), "Unsubmitted source answer"); assert.equal(await main.inputValue(), draft);
    assert.equal(await mainNode.evaluate(element => element === document.activeElement), true, "Closing restores the source focus after inert is removed");
    assert.equal((await open()).session.id, childId);
    // The real hook clears the queue then restores through the panel-owned input ref.
    const held = provider.holdNext(); releaseAnswer = held.release;
    await panel.locator(".chat-input-textarea").fill("BTW recall check");
    const heldPrompt = responseFor(response => new URL(response.url()).pathname === `/api/agent/${childId}` && response.request().method() === "POST" && response.request().postDataJSON()?.type === "prompt");
    await activate(panel.getByRole("button", { name: "Send", exact: true }));
    let deadline;
    try { await Promise.race([held.arrived, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("BTW provider request did not arrive")), 30_000); })]); }
    finally { clearTimeout(deadline); }
    await panel.locator(".chat-input-textarea").fill("Recall this BTW message intact");
    await activate(panel.getByRole("button", { name: "Follow-up", exact: true }));
    await activate(panel.getByRole("button", { name: "Recall to input", exact: true }));
    await page.waitForFunction(() => document.querySelector('aside[aria-label="BTW"] .chat-input-textarea')?.value === "Recall this BTW message intact");
    assert.equal(await mainNode.inputValue(), draft);
    held.release(); assert.equal((await heldPrompt).status(), 200);
    await panel.getByText("E2E BTW recall answer", { exact: true }).waitFor();
    await panel.getByText("E2E BTW answer", { exact: true }).waitFor();
    await activate(panel.getByRole("button", { name: "Open full-size", exact: true }));
    await page.waitForFunction(id => new URL(location.href).searchParams.get("session") === id, childId);
    await page.getByText("E2E BTW answer", { exact: true }).waitFor();
    await activate(page.getByRole("button", { name: "Back to source chat", exact: true }));
    await page.waitForFunction(id => new URL(location.href).searchParams.get("session") === id, sourceId);
    await question.waitFor(); assert.equal(await main.inputValue(), draft);
    assert.equal((await open()).session.id, childId);
    await panel.getByText("E2E BTW answer", { exact: true }).waitFor();
    await activate(panel.getByRole("button", { name: "Copy latest answer to main draft", exact: true }));
    await page.waitForFunction(expected => document.querySelector("#chat-content > div .chat-input-textarea")?.value === expected, `${draft}\n\nE2E BTW recall answer\n`);
    await checkSource();
  } catch (error) { failure = error; } finally {
    releaseAnswer?.();
    if (observe) page.off("request", observe);
    const failures = failure ? [failure] : [];
    for (const id of [childId, sourceId].filter(Boolean)) try {
      if ((await api(`/api/agent/${id}`)).state.isPromptRunning) await post(`/api/agent/${id}`, { type: "abort" });
      await waitForAsyncCondition(page, async id => !(await (await fetch(`/api/agent/${id}`)).json()).state.isPromptRunning, id);
    } catch (error) { failures.push(error); }
    if (failures.length) await page.close().catch(error => failures.push(error));
    const settled = await Promise.allSettled(waits);
    failures.push(...settled.filter(result => result.status === "rejected").map(result => result.reason));
    if (failures.length) throw new AggregateError(failures, "BTW scenario/cleanup failed");
  }
}
