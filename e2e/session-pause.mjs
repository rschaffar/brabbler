import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { createJiti } from "jiti";
import { waitForAsyncCondition } from "./async-condition.mjs";
import { readBrowserResponse } from "./browser-http.mjs";

const PROVIDER = "e2e-session-pause";
const text = message => typeof message?.content === "string" ? message.content
  : (message?.content ?? []).map(block => block.text ?? "").join("\n");
const question = (who, key) => `Pause fixture ${who} question ${key}?`;
const description = key => `Pause child ${key}`;

/** Installed-package imports, genuine native Agent/ask_user, no external transport.
 * The gate is a TOOL, never a provider awaiting abort. Native ask_user is
 * sequential: after Pause cancels it, the rest of its existing tool batch drains
 * into this independently releasable gate. That gives Chromium a real Pausing…
 * state without sleeps or a fabricated /api/agent/running snapshot. */
export function sessionPauseFixtureSource(root, agentDir) {
  return `import { fauxProvider, fauxAssistantMessage, fauxToolCall, fauxText } from ${JSON.stringify(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"))};
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
export default function (pi) {
  const state = ${JSON.stringify(join(agentDir, "pause-fixture"))};
  mkdirSync(state, { recursive: true });
  const log = row => appendFileSync(join(state, "requests.jsonl"), JSON.stringify(row) + "\\n");
  const text = message => typeof message?.content === "string" ? message.content : (message?.content ?? []).map(block => block.text ?? "").join("\\n");
  const question = (who, key) => "Pause fixture " + who + " question " + key + "?";
  const ask = (who, key) => fauxToolCall("ask_user", {
    question: question(who, key), context: "Saved context " + who + " " + key,
    options: [{ title: "Inspect first", description: "No old approval" }, { title: "Ask again" }],
    allowFreeform: true, allowComment: true
  });
  pi.registerTool({ name: "e2e_pause_gate", label: "Pause fixture gate", description: "Synthetic releasable test gate",
    executionMode: "sequential",
    parameters: { type: "object", properties: { key: { type: "string", pattern: "^(row|global)-[0-9]+$" } }, required: ["key"] },
    execute: async (_id, { key }, signal) => {
      writeFileSync(join(state, key + ".entered"), "entered\\n");
      while (!existsSync(join(state, key + ".release"))) {
        if (signal?.aborted) throw new Error("Gate was aborted instead of cooperatively drained");
        await delay(25);
      }
      if (signal?.aborted) throw new Error("Gate was aborted instead of cooperatively drained");
      writeFileSync(join(state, key + ".finished"), "uncancelled\\n");
      return { content: [{ type: "text", text: "Gate completed uncancelled " + key }], details: { key, aborted: false } };
    }
  });
  const faux = fauxProvider({ provider: "e2e-session-pause", api: "e2e-session-pause", models: [{ id: "main" }, { id: "child" }] });
  const respond = async (context, _options, _state, model) => {
    faux.appendResponses([respond]);
    const last = context.messages.at(-1);
    const input = text(context.messages.findLast(message => message.role === "user"));
    log({ model: model.id, input, lastRole: last?.role, lastTool: last?.toolName });
    if (input.startsWith("[Brabbler resume ")) return fauxAssistantMessage("Pause fixture resumed main");
    const childKey = /PAUSE_CHILD ((?:row|global)-[0-9]+)/.exec(input)?.[1];
    if (model.id === "child" && childKey && last?.role === "user") return fauxAssistantMessage([
      fauxText("Partial child evidence " + childKey), ask("child", childKey)
    ], { stopReason: "toolUse" });
    const key = /^pause-family ((?:row|global)-[0-9]+)$/.exec(input)?.[1];
    if (model.id === "main" && key) {
      if (last?.role === "user") return fauxAssistantMessage([fauxToolCall("Agent", {
        subagent_type: "e2e-pause", prompt: "PAUSE_CHILD " + key, description: "Pause child " + key,
        model: "e2e-session-pause/child", run_in_background: true
      })], { stopReason: "toolUse" });
      if (last?.role === "toolResult" && last.toolName === "Agent") return fauxAssistantMessage([
        ask("main", key), fauxToolCall("e2e_pause_gate", { key })
      ], { stopReason: "toolUse" });
    }
    if (input === "pause-peer-global" && last?.role === "user") return fauxAssistantMessage([ask("peer", "global")], { stopReason: "toolUse" });
    if (input === "bootstrap pause") return fauxAssistantMessage("Pause fixture idle");
    return fauxAssistantMessage("UNEXPECTED automatic pause continuation");
  };
  faux.setResponses([respond]); pi.registerProvider(faux.provider);
}`;
}

async function waitForFile(path) {
  const deadline = performance.now() + 30_000;
  while (!existsSync(path)) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${path}`);
    await delay(50);
  }
}

export async function checkSessionPause(page, { base, api, post, root, agentDir, artifacts, width, returnSessionId }) {
  assert.ok([1280, 700, 390].includes(width));
  const state = join(agentDir, "pause-fixture");
  mkdirSync(state, { recursive: true });
  const cwd = join(agentDir, `pause-project-${width}`), peerCwd = join(agentDir, `pause-hidden-${width}`);
  mkdirSync(cwd); mkdirSync(peerCwd);
  mkdirSync(join(agentDir, "agents"), { recursive: true });
  // Extensions must load: ask_user is host-native but is not a coding tool.
  writeFileSync(join(agentDir, "agents", "e2e-pause.md"), ["---", "description: Pause fixture", "tools: read", "load_skills: false", "load_extensions: true", "inherit_context: false", "max_turns: 0", "model: e2e-session-pause/child", "---", "Do the literal task."].join("\n"));
  const settingsPath = join(agentDir, "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  if (!settings.enabledModels.includes(`${PROVIDER}/**`)) settings.enabledModels.push(`${PROVIDER}/**`);
  writeFileSync(settingsPath, JSON.stringify(settings));
  const enabled = await page.request.put(`${base}/api/subagents/settings`, { data: { enabled: true, maxConcurrent: 1 } });
  assert.ok(enabled.ok(), await enabled.text());
  const { readSubagentRun } = await createJiti(import.meta.url).import(join(root, "lib/subagents.ts"));
  const failures = [], roots = [], ownedIds = new Set();
  let peerKey;
  const release = key => writeFileSync(join(state, `${key}.release`), "release\n");
  const requests = () => existsSync(join(state, "requests.jsonl"))
    ? readFileSync(join(state, "requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
  const saved = async id => {
    const detail = await api(`/api/sessions/${id}`);
    const path = relative(agentDir, detail.filePath);
    assert.ok(path && !isAbsolute(path) && !path.startsWith(".."));
    const [header, ...entries] = readFileSync(detail.filePath, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(header.id, id);
    return { entries, run: readSubagentRun(entries, id, detail.filePath) };
  };
  const pauseRows = () => JSON.parse(readFileSync(join(agentDir, "brabbler", "session-pauses.json"), "utf8")).sessions;
  const continuation = async (id, before) => {
    const entries = (await saved(id)).entries.filter(entry => entry.type === "message" && entry.message.role === "user" && text(entry.message).startsWith("[Brabbler resume "));
    assert.equal(entries.length, before + 1, "one new literal main continuation");
    const literal = text(entries.at(-1).message);
    assert.match(literal, /^\[Brabbler resume [0-9a-f-]{36}\]\n/);
    const seen = requests().filter(row => row.input === literal);
    assert.equal(seen.length, 1, "the provider receives exactly the persisted literal, once");
    assert.equal(seen[0].model, "main");
    assert.ok(literal.includes("not restoration of an old execution"));
    assert.ok(literal.includes("never reuse an old approval"));
    return literal;
  };
  const waitIdle = id => waitForAsyncCondition(page, async sessionId => {
    const response = await fetch(`/api/agent/${sessionId}`); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    return snapshot.running === true && snapshot.state?.isPromptRunning === false && snapshot.state?.isStreaming === false;
  }, id);
  const waitAttention = ids => waitForAsyncCondition(page, async sessionIds => {
    const response = await fetch("/api/agent/running", { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    return sessionIds.every(id => snapshot.attention.some(item => item.sessionId === id && item.method === "ask_user"));
  }, ids);
  const waitPaused = ids => waitForAsyncCondition(page, async sessionIds => {
    const response = await fetch("/api/agent/running", { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    return sessionIds.every(id => snapshot.pauses.some(item => item.sessionId === id && item.state === "paused" && !item.interrupted)
      && !snapshot.runningSessionIds.includes(id) && !snapshot.attention.some(item => item.sessionId === id));
  }, ids);
  const overview = page.getByRole("region", { name: "Activity", exact: true });
  const openOverview = async () => {
    if (!(await overview.isVisible())) await page.getByRole("button", { name: /^Activity/ }).click();
    await overview.waitFor();
  };
  // Activity row action buttons are siblings of .activity-item, not descendants.
  const row = label => overview.getByRole("listitem").filter({ has: page.getByText(label, { exact: true }).and(page.locator(".activity-item-title")) });
  const fits = async button => {
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    assert.ok(box && box.width > 0 && box.x >= 0 && box.x + box.width <= width + 1, "control fits viewport");
  };
  const clickControl = async (button, action, sessionId) => {
    await fits(button);
    const responsePromise = page.waitForResponse(response => {
      if (new URL(response.url()).pathname !== "/api/activity/pause" || response.request().method() !== "POST") return false;
      const body = response.request().postDataJSON();
      return body.action === action && (sessionId === undefined || body.sessionId === sessionId);
    });
    void responsePromise.catch(() => {});
    await button.click();
    const response = await responsePromise;
    assert.equal(response.status(), 200, await response.text());
    assert.deepEqual((await response.json()).errors ?? [], []);
  };
  const create = async (directory, name) => {
    const created = await post("/api/agent/new", { cwd: directory, type: "prompt", message: "bootstrap pause", provider: PROVIDER, modelId: "main", toolNames: ["read"] });
    roots.push(created.sessionId); ownedIds.add(created.sessionId); await waitIdle(created.sessionId);
    const renamed = await page.request.patch(`${base}/api/sessions/${created.sessionId}`, { data: { name } });
    assert.ok(renamed.ok(), await renamed.text());
    return created.sessionId;
  };
  let success = false;
  try {
    const mainLabel = `Pause main ${width}`, peerLabel = `Pause peer ${width}`;
    const mainId = await create(cwd, mainLabel);
    await page.goto(`${base}/?session=${mainId}`, { waitUntil: "domcontentloaded" });
    await page.getByText("Pause fixture idle", { exact: true }).waitFor();
    const tools = (await post(`/api/agent/${mainId}`, { type: "get_tools" })).data;
    for (const name of ["Agent", "ask_user", "e2e_pause_gate"]) assert.ok(tools.some(tool => tool.name === name && tool.active), `${name} active`);
    for (const cycle of ["row", "global"]) {
      const key = `${cycle}-${width}`;
      if (await overview.isVisible()) await overview.getByRole("button", { name: "Close Activity", exact: true }).click();
      await page.locator("textarea").last().fill(`pause-family ${key}`);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await page.getByRole("group", { name: question("main", key), exact: true }).waitFor();
      const children = await waitForAsyncCondition(page, async ({ id, key }) => {
        const response = await fetch("/api/sessions?force=1"); if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const sessions = (await response.json()).sessions;
        const found = sessions.filter(item => item.relation?.parentSessionId === id && item.relation.description === `Pause child ${key}`);
        return found.length === 1 && found;
      }, { id: mainId, key });
      assert.equal(children.length, 1);
      const childId = children[0].id, childLabel = description(key);
      ownedIds.add(childId);
      await waitAttention([mainId, childId]);
      const childBefore = (await saved(childId)).run;
      assert.ok(childBefore?.runId);
      let peerId;
      if (cycle === "global") {
        peerId = await create(peerCwd, peerLabel);
        await post(`/api/agent/${peerId}`, { type: "prompt", message: "pause-peer-global" });
        await waitAttention([peerId]);
        const peer = (await api("/api/sessions?force=1")).sessions.find(item => item.id === peerId);
        peerKey = peer.projectKey ?? peer.projectRoot ?? peer.cwd;
        await post("/api/hidden-projects", { key: peerKey, hidden: true });
        // Reload re-reads genuine privacy state and replays the still-pending card.
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.getByRole("group", { name: question("main", key), exact: true }).waitFor();
      }
      await openOverview();
      const mainProject = (await api("/api/sessions?force=1")).sessions.find(item => item.id === mainId);
      await overview.getByRole("combobox", { name: "Project", exact: true }).selectOption(mainProject.projectKey ?? mainProject.projectRoot ?? mainProject.cwd);
      await row(mainLabel).locator(".activity-item-needs-you").waitFor();
      await row(childLabel).locator(".activity-item-needs-you").waitFor();
      const beforeCompleted = (await api("/api/agent/running")).completedRuns;
      const beforeCalls = requests().length;
      if (cycle === "row") {
        await clickControl(row(childLabel).getByRole("button", { name: `Pause ${childLabel} and its subsessions`, exact: true }), "pause", childId);
        await waitPaused([childId]);
        await row(childLabel).locator(".activity-item-paused").waitFor({ timeout: 15000 });
        assert.equal(await row(childLabel).getByRole("button", { name: /^Resume/ }).count(), 0, "no direct child Resume");
        await waitAttention([mainId]); // pausing a child does not answer/cancel the main question
        await clickControl(row(mainLabel).getByRole("button", { name: `Pause ${mainLabel} and its subsessions`, exact: true }), "pause", mainId);
      } else {
        assert.equal(await row(peerLabel).count(), 0, "concealed peer not listed");
        await clickControl(overview.getByRole("button", { name: "Pause all", exact: true }), "pause-all");
      }
      await waitForFile(join(state, `${key}.entered`));
      await row(mainLabel).locator(".activity-item-pausing").waitFor({ timeout: 15000 });
      assert.equal(await row(mainLabel).getByRole("button", { name: "Pausing…", exact: true }).isDisabled(), true);
      assert.equal(await row(mainLabel).getByRole("button", { name: /^Resume/ }).count(), 0);
      const ids = [mainId, childId, ...(peerId ? [peerId] : [])];
      const during = pauseRows();
      for (const [id, who, qkey] of [[mainId, "main", key], [childId, "child", key], ...(peerId ? [[peerId, "peer", "global"]] : [])]) {
        const record = during.find(item => item.sessionId === id);
        assert.ok(record, `durable pause for ${who}`);
        const payload = record.waiting.join("\n");
        for (const part of [question(who, qkey), `Saved context ${who} ${qkey}`, "Inspect first", "Ask again"]) assert.ok(payload.includes(part), `saved exact ${who} card context: ${part}`);
      }
      const noAttention = await api("/api/agent/running");
      assert.ok(ids.every(id => !noAttention.attention.some(item => item.sessionId === id)), "Pause cancels real cards while the tool gate remains running");
      await page.screenshot({ path: join(artifacts, `pause-${cycle}-pausing-${width}.png`) });
      const callsAtPause = requests().length;
      assert.equal(callsAtPause, beforeCalls, "Pause/cancelled child notifications do not start another request");
      release(key);
      await waitPaused(ids);
      await row(mainLabel).locator(".activity-item-paused").waitFor({ timeout: 15000 });
      await row(childLabel).locator(".activity-item-paused").waitFor();
      assert.equal(readFileSync(join(state, `${key}.finished`), "utf8"), "uncancelled\n");
      assert.equal(await row(childLabel).getByRole("button", { name: /^Resume/ }).count(), 0);
      const childPaused = (await saved(childId)).run;
      assert.equal(childPaused.status, "paused");
      assert.equal(childPaused.runId, childBefore.runId);
      assert.equal(childPaused.result, `Partial child evidence ${key}`);
      const rootSaved = await saved(mainId);
      assert.ok(rootSaved.entries.some(entry => entry.type === "message" && entry.message.role === "toolResult" && entry.message.toolName === "e2e_pause_gate" && entry.message.details?.aborted === false), "full tool batch durably finished");
      const afterPause = await api("/api/agent/running");
      for (const id of ids) {
        assert.deepEqual(afterPause.completedRuns.find(item => item.sessionId === id), beforeCompleted.find(item => item.sessionId === id), "pause creates no completion");
        const receipts = (await saved(id)).entries.filter(entry => entry.customType === "brabbler:interaction-receipt" && entry.data?.request?.method === "ask_user");
        const expectedQuestion = id === mainId ? question("main", key) : id === childId ? question("child", key) : question("peer", "global");
        const receipt = receipts.find(entry => entry.data.request.question === expectedQuestion);
        assert.ok(receipt && ["cancelled", "aborted"].includes(receipt.data.outcome), "saved receipt is cancellation, not an answer or timeout");
      }
      // Browser reload only, NOT a process restart proof. No route mocks.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Pause fixture idle", { exact: true }).waitFor();
      await openOverview();
      await row(mainLabel).locator(".activity-item-paused").waitFor({ timeout: 15000 });
      assert.equal(await page.getByRole("group", { name: question("main", key), exact: true }).count(), 0, "old live card is not revived");
      assert.equal(requests().length, callsAtPause, "no model request after settled Pause or reload");
      const resume = cycle === "row" ? row(mainLabel).getByRole("button", { name: `Resume ${mainLabel}`, exact: true })
        : overview.getByRole("button", { name: "Resume all", exact: true });
      await clickControl(resume, cycle === "row" ? "resume" : "resume-all", cycle === "row" ? mainId : undefined);
      await waitIdle(mainId); if (peerId) await waitIdle(peerId);
      const literal = await continuation(mainId, cycle === "row" ? 0 : 1);
      for (const part of [question("main", key), question("child", key), childId, childLabel, `PAUSE_CHILD ${key}`, `Partial child evidence ${key}`, "not automatically resumed"]) assert.ok(literal.includes(part), `continuation contains ${part}`);
      if (peerId) {
        const peerLiteral = await continuation(peerId, 0);
        assert.ok(peerLiteral.includes(question("peer", "global")), "global Resume reaches concealed, filtered-out main");
      }
      assert.equal(requests().length, callsAtPause + (peerId ? 2 : 1), "only mains receive a new request");
      assert.equal((await saved(childId)).run.runId, childBefore.runId, "child execution never restarted");
      assert.ok(pauseRows().every(item => !ids.includes(item.sessionId)), "consumed family context removed after accepted main continuation");
      await page.screenshot({ path: join(artifacts, `pause-${cycle}-resumed-${width}.png`) });
    }
    success = true;
  } catch (error) { failures.push(error); }
  finally {
    // Release gates BEFORE abort: a cooperative pause must never rely on abort
    // to release a provider/tool. Preserve transcripts on failure for the harness.
    for (const cycle of ["row", "global"]) release(`${cycle}-${width}`);
    const results = await Promise.allSettled(roots.map(id => post(`/api/agent/${id}`, { type: "abort" })));
    for (const result of results) if (result.status === "rejected") failures.push(result.reason);
    try {
      if (roots.length) await waitForAsyncCondition(page, async ids => {
        const response = await fetch("/api/agent/running", { cache: "no-store" }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const snapshot = await response.json();
        return ids.every(id => !snapshot.runningSessionIds.includes(id) && !snapshot.queuedSessionIds?.includes(id));
      }, [...ownedIds]);
      if (peerKey) await post("/api/hidden-projects", { key: peerKey, hidden: false });
      if (success && !failures.length) {
        await page.goto(`${base}/?session=${returnSessionId}`, { waitUntil: "domcontentloaded" });
        await page.getByText("Active branch answer", { exact: true }).waitFor();
        for (const id of roots) {
          await readBrowserResponse(page, `${base}/api/sessions/${id}`, { method: "DELETE", expectedStatus: "2xx" });
        }
      }
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "Native session Pause browser fixture failed");
  console.log(`PASS: ${width}px native waiting-card Pause, cooperative tool drain, child controls, literal main-only Resume and hidden-project global controls`);
}
