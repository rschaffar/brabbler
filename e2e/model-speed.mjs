import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

export const MODEL_SPEED_IDS = ["e2e-model-speed-standard", "e2e-model-speed-fast", "e2e-model-speed-legacy"];
const [A, B, LEGACY] = MODEL_SPEED_IDS;
const CODEX = { provider: "openai-codex", modelId: "e2e-codex-speed", name: "E2E ChatGPT subscription" };
const API_MODEL = { provider: "openai", modelId: "e2e-api-speed", name: "E2E OpenAI API (no speed)" };
const CUSTOM_TYPE = "pi-web:model-speed";
const warning = (page) => page.getByRole("note").filter({ hasText: /Fast uses more subscription quota/ });
const control = (page) => page.locator('select[aria-label="Model speed"]');

function assertPrivatePath(agentDir, path) {
  const child = relative(agentDir, path);
  assert.ok(isAbsolute(path) && child && !child.startsWith("..") && !isAbsolute(child), `Not an owned fixture path: ${path}`);
}

/** Shared synthetic settings/auth/catalog only; no transcripts. Run before transcript seeds. */
export function seedModelSpeedDefaults({ agentDir }) {
  assert.equal(process.env.PI_CODING_AGENT_DIR, agentDir);
  assert.equal(process.env.PI_OFFLINE, "1", "The runner must disable SDK catalog networking before startup");
  assertPrivatePath(agentDir, process.env.HOME);
  // Keep native SDK provider/auth implementations. Only their catalog models and
  // origins are synthetic: the loopback origin also makes the REAL usage route
  // refuse an official-provider query before resolving auth or fetching upstream.
  const origin = "http://127.0.0.1:9";
  const model = ({ modelId, name }, api) => ({ id: modelId, name, api, reasoning: true, input: ["text"],
    contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  const jwtPayload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "e2e-synthetic-account" } })).toString("base64url");
  const fixtures = {
    "settings.json": { defaultProvider: CODEX.provider, defaultModel: CODEX.modelId, defaultThinkingLevel: "low",
      enabledModels: [CODEX, API_MODEL].map(({ provider, modelId }) => `${provider}/${modelId}`),
      cacheWarming: "off", retry: { enabled: false }, enableInstallTelemetry: false },
    "models.json": { providers: {
      [CODEX.provider]: { baseUrl: origin, models: [model(CODEX, "openai-codex-responses")] },
      [API_MODEL.provider]: { baseUrl: origin, models: [model(API_MODEL, "openai-responses")] },
    } },
    "auth.json": { [CODEX.provider]: { type: "oauth", access: `e2e.${jwtPayload}.synthetic`,
      refresh: "e2e-not-refreshable", expires: Date.now() + 86_400_000, accountId: "e2e-synthetic-account" },
      [API_MODEL.provider]: { type: "api_key", key: "e2e-api-key-not-real" } },
  };
  for (const [name, value] of Object.entries(fixtures)) {
    const path = join(agentDir, name);
    assert.equal(existsSync(path), false, `Do not overwrite another fixture's ${name}`);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
}

/** Three transcripts only; creation/fork/clone tests use the real application APIs. */
export function seedModelSpeedTranscripts({ writeSession, message, timestamp }) {
  for (const [index, id] of MODEL_SPEED_IDS.entries()) {
    const prefix = String(index + 1);
    const ids = [1, 2, 3, 4, 5].map((n) => `${prefix}000000${n}`);
    const answer = message(ids[3], ids[2], "assistant", [{ type: "text", text: `E2E speed answer ${index + 1}` }]);
    Object.assign(answer.message, { timestamp: Date.parse(timestamp), provider: CODEX.provider,
      api: "openai-codex-responses", model: CODEX.modelId, stopReason: "stop",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
    const entries = [
      { type: "model_change", id: ids[0], parentId: null, timestamp, provider: CODEX.provider, modelId: CODEX.modelId },
      { type: "thinking_level_change", id: ids[1], parentId: ids[0], timestamp, thinkingLevel: "low" },
      message(ids[2], ids[1], "user", `E2E speed conversation ${index + 1}`), answer,
    ];
    if (id !== LEGACY) entries.push({ type: "custom", id: ids[4], parentId: ids[3], timestamp,
      customType: CUSTOM_TYPE, data: { version: 1, modelSpeed: id === A ? "standard" : "fast" } });
    writeSession(id, entries);
  }
}

// Load only after the runner establishes its private HOME/agent directory. This
// reads through the application's canonical disk/cache reader, not a test-side
// reimplementation of the latest-entry algorithm, and never appends/repairs files.
let readers;
async function diskEntries(agentDir, path) {
  assertPrivatePath(agentDir, path);
  assert.ok(existsSync(path), "A saved speed must exist on disk, not only in a live wrapper");
  readers ??= (async () => {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
    const [session, speed] = await Promise.all([
      jiti.import(join(process.env.E2E_PACKAGE_ROOT, "lib/session-reader.ts")),
      jiti.import(join(process.env.E2E_PACKAGE_ROOT, "lib/session-model-speed.ts")),
    ]);
    return { ...session, ...speed };
  })();
  const canonical = await readers;
  const entries = canonical.openSessionManager(path).getEntries();
  return { entries, modelSpeed: canonical.readSessionModelSpeed(entries) };
}

async function checkSaved({ api, post, agentDir }, id, expected, { provider, thinkingLevel } = {}) {
  const detail = await api(`/api/sessions/${id}`);
  assert.equal(detail.modelSpeed, expected, "SessionData.modelSpeed is top-level canonical state");
  assert.equal(Object.hasOwn(detail.context, "modelSpeed"), false, "Speed is not a context/thinking field");
  const { data: state } = await post(`/api/agent/${id}`, { type: "get_state" });
  assert.equal(state.modelSpeed, expected, "Real RPC get_state agrees with session browsing");
  if (provider) assert.equal(state.model?.provider, provider);
  if (thinkingLevel) {
    assert.equal(state.thinkingLevel, thinkingLevel, "Speed must not change Thinking");
    assert.equal(detail.context.thinkingLevel, thinkingLevel);
  }
  const disk = await diskEntries(agentDir, detail.filePath);
  assert.equal(disk.modelSpeed, expected, "Canonical disk reader agrees with API and live state");
  const speeds = disk.entries.filter((entry) => entry.type === "custom" && entry.customType === CUSTOM_TYPE);
  for (const entry of speeds) {
    assert.match(entry.id, /^[a-f0-9]{8}$/i, "Use normal SDK entry IDs");
    assert.ok(Number.isFinite(Date.parse(entry.timestamp)), "Use normal SDK entry timestamps");
    assert.equal(entry.data.version, 1);
    assert.ok(["standard", "fast"].includes(entry.data.modelSpeed));
  }
  if (speeds.length) assert.deepEqual(speeds.at(-1).data, { version: 1, modelSpeed: expected });
  else assert.equal(expected, "standard", "Legacy absence means Standard");
  return { detail, state, entries: disk.entries, speeds };
}

async function waitSpeed(page, value, disabled = false) {
  await page.waitForFunction(({ value, disabled }) => {
    const select = document.querySelector('select[aria-label="Model speed"]');
    return select?.value === value && select.disabled === disabled;
  }, { value, disabled });
}

async function revealSpeed(page) {
  await control(page).waitFor({ state: "attached" });
  if (!await control(page).isVisible()) await page.getByRole("button", { name: "More controls", exact: true }).click();
  await control(page).waitFor();
  return control(page);
}

async function checkSelector(page, expected) {
  const select = await revealSpeed(page);
  await waitSpeed(page, expected);
  assert.equal(await select.count(), 1);
  assert.deepEqual(await select.locator("option").evaluateAll((options) => options.map((option) => ({ value: option.value, label: option.textContent }))),
    [{ value: "standard", label: "Standard" }, { value: "fast", label: "Fast" }], "Exactly two options; no third tier");
  const speedBox = await select.boundingBox();
  const thinkingBox = await page.getByRole("button", { name: "Change reasoning level", exact: true }).boundingBox();
  assert.ok(speedBox && thinkingBox && Math.abs(speedBox.y - thinkingBox.y) < 6
    && Math.abs(thinkingBox.x - speedBox.x - speedBox.width) < 16, "Speed sits beside Thinking");
  assert.ok(speedBox.x >= 0 && speedBox.x + speedBox.width <= page.viewportSize().width + 1, "Speed is reachable without overflow");
  if (expected === "fast") {
    await warning(page).waitFor();
    assert.equal(await select.getAttribute("aria-describedby"), await warning(page).getAttribute("id"));
  } else assert.equal(await warning(page).count(), 0, "Standard must not show the Fast quota warning");
}

function commandResponse(page, id, type) {
  const pending = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/agent/${id}`
    && response.request().method() === "POST" && response.request().postDataJSON()?.type === type);
  // Let the enclosing assertion/runner report a failed action before this timeout.
  void pending.catch(() => {});
  return pending;
}

async function changeSavedSpeed(page, options, id, next) {
  const select = await revealSpeed(page);
  const pending = commandResponse(page, id, "set_model_speed");
  await select.selectOption(next);
  const response = await pending;
  assert.equal(response.status(), 200);
  assert.deepEqual(response.request().postDataJSON(), { type: "set_model_speed", modelSpeed: next });
  assert.equal((await response.json()).data.modelSpeed, next);
  await checkSelector(page, next);
  return checkSaved(options, id, next, { provider: CODEX.provider, thinkingLevel: "low" });
}

async function showSidebar(page) {
  const show = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await show.isVisible()) await show.click();
}

async function pickSession(page, id, expected) {
  const origin = await page.evaluate(() => performance.timeOrigin);
  await showSidebar(page);
  // Hover actions cover the row's center; click its selection padding, not Star.
  await page.locator(`.session-row[data-session-id="${id}"]`).click({ position: { x: 12, y: 12 } });
  await page.waitForFunction((id) => new URL(location.href).searchParams.get("session") === id, id);
  await checkSelector(page, expected);
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Sidebar changes must not reload/navigate the document");
}

async function chooseModel(page, model) {
  // Mobile More controls can cover the model button; dismiss them outside first.
  await page.locator(".chat-input-textarea").click();
  await page.locator(".model-selector.is-toolbar").getByRole("button").click();
  await page.getByRole("option", { name: model.name, exact: true }).click();
}

/** Hold a real POST in transit, then continue it unchanged; never fake writes or their responses. */
async function withPendingCommand(page, base, id, type, action, pendingCheck) {
  let release, arrived;
  const gate = new Promise((resolve) => { release = resolve; });
  const seen = new Promise((resolve) => { arrived = resolve; });
  const url = `${base}/api/agent/${id}`;
  const handler = async (route) => {
    if (route.request().method() === "POST" && route.request().postDataJSON()?.type === type) {
      arrived();
      await gate;
    }
    await route.continue();
  };
  await page.route(url, handler);
  const result = commandResponse(page, id, type);
  void result.catch(() => {}); // The enclosing assertion may fail before release.
  let timer;
  try {
    await action();
    // Bound observation even if the control never emits its POST.
    await Promise.race([seen, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`No ${type} POST arrived`)), 30_000);
    })]);
    clearTimeout(timer);
    await pendingCheck();
    release();
    const response = await result;
    assert.equal(response.status(), 200);
    return await response.json();
  } finally {
    clearTimeout(timer);
    release();
    await page.unroute(url, handler);
  }
}

async function checkNoSpeedDefaults(page, agentDir) {
  const storage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
  const checkFields = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, /^(model[-_]?speed|service[-_]?tier)$/i, "No speed defaults in stored settings");
      checkFields(child);
    }
  };
  for (const [key, raw] of Object.entries(storage)) {
    // Inspect preference keys/JSON fields, not arbitrary values: workspace and
    // draft records legitimately contain our e2e-model-speed-* session IDs.
    assert.doesNotMatch(key, /^(?:pi[-_])?(?:chat[-_])?(?:default[-_])?(model[-_]?speed|service[-_]?tier)(?:[-_](default|preference))?$/i,
      "Speed must not become a browser default");
    let value;
    try { value = JSON.parse(raw); } catch { continue; }
    checkFields(value);
  }
  checkFields(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")));
}

async function newComposer(page, project) {
  // A setup/welcome composer still permits pre-startup choices. Explicit New
  // now saves immediately and has separate empty-session browser coverage.
  const url = new URL(page.url());
  url.search = new URLSearchParams({ cwd: project }).toString();
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.locator(".chat-input-textarea").waitFor();
  await chooseModel(page, CODEX);
  await checkSelector(page, "standard");
}

/** Lose only this browser's acknowledgement AFTER a real successful write. */
async function checkAmbiguousSpeedSave(page, options, id) {
  const url = `${options.base}/api/agent/${id}`;
  const eventRequests = [];
  const observe = (request) => {
    if (new URL(request.url()).pathname === `/api/agent/${id}/events`) eventRequests.push(request);
  };
  page.on("request", observe);
  try {
    for (const scenario of ["read-ok", "read-fails-once", "read-stalls"]) {
      const loseFirstRead = scenario !== "read-ok";
      const forceOnline = scenario === "read-stalls";
      const expectedReads = forceOnline ? 3 : loseFirstRead ? 2 : 1;
      const reset = commandResponse(page, id, "set_model_speed");
      await control(page).selectOption("standard");
      assert.equal((await reset).status(), 200);
      await checkSelector(page, "standard");
      let release, arrived;
      const gate = new Promise((resolve) => { release = resolve; });
      const seen = new Promise((resolve) => { arrived = resolve; });
      let reads = 0;
      const handler = async (route) => {
        if (route.request().method() === "POST" && route.request().postDataJSON()?.type === "get_state") {
          reads += 1;
          if (reads >= expectedReads) { arrived(); await gate; }
        }
        await route.continue();
      };
      await page.route(url, handler);
      await page.evaluate(({ id, loseFirstRead, forceOnline }) => {
        const original = window.fetch;
        let lost = false, loseRead = loseFirstRead, stallRead = forceOnline;
        window.__restoreModelSpeedFetch = () => {
          window.fetch = original;
          delete window.__restoreModelSpeedFetch;
          delete window.__modelSpeedReadStalled;
          delete window.__modelSpeedStalledSignal;
        };
        window.fetch = async (...args) => {
          const kind = typeof args[1]?.body === "string" ? JSON.parse(args[1].body).type : undefined;
          const owned = new URL(String(args[0]), location.href).pathname === `/api/agent/${id}`;
          const response = await original(...args);
          if (owned && kind === "set_model_speed" && !lost) {
            const body = await response.clone().json();
            if (response.status !== 200 || body.data?.modelSpeed !== "fast") throw new Error("Expected a REAL successful Fast save");
            lost = true;
            throw new TypeError("E2E model-speed acknowledgement lost");
          }
          if (owned && kind === "get_state" && lost && loseRead) {
            loseRead = false;
            throw new TypeError("E2E reconciliation temporarily unavailable");
          }
          if (owned && kind === "get_state" && lost && stallRead) {
            stallRead = false;
            window.__modelSpeedReadStalled = true;
            // Native HTTP succeeded, but this browser-side read never settles
            // until recovery cancels it. No synthetic console/network failures.
            await new Promise((_, reject) => {
              const signal = args[1].signal;
              window.__modelSpeedStalledSignal = signal;
              if (signal.aborted) reject(signal.reason);
              else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
            });
          }
          return response;
        };
      }, { id, loseFirstRead, forceOnline });
      let timer;
      try {
        await control(page).selectOption("fast");
        if (forceOnline) {
          await page.waitForFunction(() => window.__modelSpeedReadStalled === true);
          await waitSpeed(page, "fast", true);
          const abortedImmediately = await page.evaluate(() => {
            const stalledSignal = window.__modelSpeedStalledSignal;
            window.dispatchEvent(new Event("online"));
            return stalledSignal.aborted;
          });
          assert.equal(abortedImmediately, true, "Online must abort the stalled read immediately, not await its deadline/poll");
        }
        await Promise.race([seen, new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Lost speed save did not trigger reconciliation")), 30_000);
        })]);
        clearTimeout(timer);
        await waitSpeed(page, "fast", true);
        await page.getByRole("status").filter({ hasText: "Confirming saved model speed" }).waitFor();
        await page.locator(".chat-input-textarea").fill("Do not send while speed is unknown");
        assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
        assert.equal((await options.post(`/api/agent/${id}`, { type: "get_state" })).data.modelSpeed, "fast");
        release();
        await checkSelector(page, "fast");
        assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isEnabled(), true);
        assert.equal(reads, expectedReads);
        assert.equal(eventRequests.length, 0, "A dormant fresh composer cannot rely on SSE to undo an incorrect rollback");
      } finally {
        clearTimeout(timer);
        release();
        await page.unroute(url, handler);
        await page.evaluate(() => window.__restoreModelSpeedFetch?.());
        await page.locator(".chat-input-textarea").fill("");
      }
    }
  } finally {
    page.off("request", observe);
  }
}

async function checkNewSession(page, options) {
  const { base, project, api, post } = options;
  await newComposer(page, project);
  await control(page).selectOption("fast");
  await checkSelector(page, "fast");
  const creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agent/new"
    && response.request().method() === "POST");
  const system = page.getByRole("button", { name: "System prompt", exact: true });
  await system.scrollIntoViewIfNeeded();
  await system.click(); // Real no-model ensure_session, not a sent message.
  const response = await creation;
  assert.equal(response.status(), 200);
  const payload = response.request().postDataJSON();
  assert.equal(payload.type, "ensure_session");
  assert.equal(payload.cwd, project);
  assert.equal(payload.modelSpeed, "fast");
  assert.equal(payload.provider, CODEX.provider);
  assert.equal(payload.modelId, CODEX.modelId);
  assert.equal(Object.hasOwn(payload, "thinkingLevel"), false, "Selecting Fast must not select Thinking");
  assert.equal(Object.hasOwn(payload, "message"), false, "Opening System must not send a model prompt");
  const created = await response.json();
  assert.equal(created.modelSpeed, "fast");
  const { data: idle } = await post(`/api/agent/${created.sessionId}`, { type: "get_state" });
  assert.equal(idle.isStreaming, false);
  assert.equal(idle.isPromptRunning, false);
  const dormant = await api(`/api/sessions/${created.sessionId}`);
  assert.equal(dormant.modelSpeed, "fast");
  assert.deepEqual(dormant.context.messages, [], "ensure_session creates no model turn");
  if (await system.getAttribute("aria-pressed") === "true") await system.click();
  await revealSpeed(page);
  await checkAmbiguousSpeedSave(page, options, created.sessionId);
  // Pi can defer its first flush until a conversation exists. Complete an
  // ordinary existing fixture slash command to save its real interaction receipt
  // (and startup entries) without a model, rather than forcing a test-side flush.
  if (await system.getAttribute("aria-pressed") === "true") await system.click();
  await page.locator(".chat-input-textarea").fill("/e2e-dialog confirm");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const dialog = page.getByRole("group", { name: "E2E confirm", exact: true });
  await dialog.waitFor();
  await revealSpeed(page);
  await waitSpeed(page, "fast", true);
  // A real active command must reject speed changes. Deliberate negative API
  // request is outside the browser; no blanket console/5xx exception is needed.
  const refused = await fetch(`${base}/api/agent/${created.sessionId}`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "set_model_speed", modelSpeed: "standard" }), signal: AbortSignal.timeout(30_000) });
  assert.equal(refused.status, 500);
  assert.match((await refused.json()).error, /Cannot change model speed.*session is running/);
  assert.equal((await post(`/api/agent/${created.sessionId}`, { type: "get_state" })).data.modelSpeed, "fast");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByText("E2E confirm result: false", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Stop agent", exact: true }).waitFor({ state: "hidden" });
  await checkSelector(page, "fast");
  const saved = await checkSaved(options, created.sessionId, "fast", { provider: CODEX.provider, thinkingLevel: "low" });
  assert.equal(saved.entries.some((entry) => entry.type === "message" && entry.message.role === "assistant"), false,
    "The startup/dialog path must not generate an assistant/model turn");
  await checkNoSpeedDefaults(page, options.agentDir);
  await newComposer(page, project); // Same browser, after Fast: still Standard.
  return created.sessionId;
}

/** ONLY synthetic activity: GET state + this one session's EventSource endpoint. */
async function checkBusyControls(page, options) {
  const { base, post } = options;
  const before = await checkSaved(options, A, "fast");
  const busy = { streaming: true, compacting: false };
  const url = `${base}/api/agent/${A}`;
  const stateRoute = async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const data = await response.json();
    assert.equal(data.running, true);
    // modelSpeed/model/thinking still come from the actual canonical API.
    await route.fulfill({ response, json: { ...data, state: { ...data.state,
      isStreaming: busy.streaming, isPromptRunning: false, isCompacting: busy.compacting } } });
  };
  await page.route(url, stateRoute);
  await page.addInitScript((id) => {
    const Original = window.EventSource;
    const sources = [];
    window.EventSource = function (url, ...args) {
      if (new URL(String(url), location.href).pathname !== `/api/agent/${id}/events`) return new Original(url, ...args);
      const source = { readyState: 1, onmessage: null, onerror: null, close() { this.readyState = 2; } };
      sources.push(source);
      queueMicrotask(() => source.onmessage?.({ data: JSON.stringify({ type: "connected", isStreaming: true }) }));
      return source;
    };
    window.__modelSpeedEvents = {
      emit(data) {
        const source = sources.findLast((source) => source.readyState === 1);
        if (!source?.onmessage) throw new Error("No live model-speed fixture SSE connection");
        source.onmessage({ data: JSON.stringify(data) });
      },
      restore() { for (const source of sources) source.close(); window.EventSource = Original; },
    };
  }, A);
  try {
    await page.goto(`${base}/?session=${A}`, { waitUntil: "domcontentloaded" });
    await revealSpeed(page);
    await waitSpeed(page, "fast", true);
    assert.equal((await post(`/api/agent/${A}`, { type: "get_state" })).data.isStreaming, false, "No model was started for the streaming fixture");
    busy.streaming = false;
    await page.evaluate(() => window.__modelSpeedEvents.emit({ type: "agent_settled" }));
    await waitSpeed(page, "fast");
    busy.compacting = true;
    await page.evaluate(() => window.__modelSpeedEvents.emit({ type: "compaction_start" }));
    await waitSpeed(page, "fast", true);
    busy.compacting = false;
    await page.evaluate(() => window.__modelSpeedEvents.emit({ type: "compaction_end" }));
    await waitSpeed(page, "fast");
    const after = await checkSaved(options, A, "fast");
    assert.deepEqual(after.speeds, before.speeds, "Busy UI simulations must not write speed entries");
  } finally {
    await page.unroute(url, stateRoute);
    await page.evaluate(() => window.__modelSpeedEvents?.restore()).catch(() => {});
  }
}

export async function checkModelSpeed(page, options) {
  const { base, api, post, artifacts, width } = options;
  // Reset through real RPC, not disk rewrites; desktop and mobile reuse the same
  // three fixtures while still beginning with opposite Standard/Fast selections.
  for (const [id, speed] of [[A, "standard"], [B, "fast"]]) {
    await post(`/api/agent/${id}`, { type: "set_model", provider: CODEX.provider, modelId: CODEX.modelId });
    await post(`/api/agent/${id}`, { type: "set_model_speed", modelSpeed: speed });
    await checkSaved(options, id, speed, { provider: CODEX.provider, thinkingLevel: "low" });
  }
  const legacy = await checkSaved(options, LEGACY, "standard", { provider: CODEX.provider, thinkingLevel: "low" });
  assert.equal(legacy.speeds.length, 0);
  const catalog = await api(`/api/models?cwd=${encodeURIComponent(options.project)}`);
  for (const model of [CODEX, API_MODEL]) assert.ok(catalog.modelList.some((item) => item.provider === model.provider && item.id === model.modelId));
  const usage = await post("/api/provider-usage/query", { providerId: CODEX.provider, accountId: null });
  assert.equal(usage.status, "query-failed", "Loopback catalog origins refuse upstream usage before network/auth");

  await page.goto(`${base}/?session=${A}`, { waitUntil: "domcontentloaded" });
  if (width <= 600) {
    await page.getByRole("button", { name: "More controls", exact: true }).waitFor();
    assert.equal(await control(page).isVisible(), false, "Mobile speed is reached through More controls");
  }
  await checkSelector(page, "standard");
  await pickSession(page, B, "fast");
  await pickSession(page, A, "standard"); // Actual A → B → A, no goto/reload.
  const original = await checkSaved(options, A, "standard");
  const changed = await changeSavedSpeed(page, options, A, "fast");
  assert.equal(changed.speeds.length, original.speeds.length + 1, "Browser changes append a real SDK entry");
  await page.screenshot({ path: join(artifacts, `model-speed-fast-${width}.png`) });
  await page.reload({ waitUntil: "domcontentloaded" });
  await checkSelector(page, "fast");

  if (width > 600) {
    // The latest speed custom entry follows this assistant leaf. Neither copied
    // branch includes it, so inheritance cannot rely on copying branch metadata.
    const copiedIds = [];
    for (const command of [{ type: "clone", leafId: "20000004" }, { type: "fork", entryId: "20000003" }]) {
      const { data } = await post(`/api/agent/${B}`, command);
      assert.equal(data.cancelled, false);
      assert.ok(data.newSessionId && data.newSessionId !== B);
      await checkSaved(options, data.newSessionId, "fast");
      copiedIds.push(data.newSessionId);
    }
    // Real API completion precedes the sidebar's asynchronous catalogue refresh.
    // Wait for both mutations to reach its DOM before computing click geometry;
    // the normal locator click still owns visibility/stability and the URL check.
    await showSidebar(page);
    await page.waitForFunction(ids => ids.every(id => document.querySelector(`.session-row[data-session-id="${id}"]`)), copiedIds);
  }
  await pickSession(page, B, "fast");
  await changeSavedSpeed(page, options, B, "standard");
  await pickSession(page, A, "fast");
  await pickSession(page, LEGACY, "standard");
  await pickSession(page, A, "fast");

  await withPendingCommand(page, base, A, "set_model_speed", () => control(page).selectOption("standard"), async () => {
    await waitSpeed(page, "standard", true);
    await checkSaved(options, A, "fast"); // Unchanged on the server until the real POST is released.
  });
  await checkSelector(page, "standard");
  await checkSaved(options, A, "standard");
  await changeSavedSpeed(page, options, A, "fast");

  const unsupported = commandResponse(page, A, "set_model");
  await chooseModel(page, API_MODEL);
  assert.equal((await unsupported).status(), 200);
  await page.waitForFunction(() => !document.querySelector('select[aria-label="Model speed"]')
    && !document.querySelector('.model-selector.is-toolbar button[aria-busy="true"]'));
  assert.equal(await control(page).count(), 0, "API-key providers have no usable speed control");
  assert.equal(await warning(page).count(), 0);
  await checkSaved(options, A, "fast", { provider: API_MODEL.provider, thinkingLevel: "low" });
  await withPendingCommand(page, base, A, "set_model", () => chooseModel(page, CODEX), async () => {
    await revealSpeed(page);
    await waitSpeed(page, "fast", true);
    assert.equal((await post(`/api/agent/${A}`, { type: "get_state" })).data.model.provider, API_MODEL.provider);
  });
  await checkSelector(page, "fast");
  await checkSaved(options, A, "fast", { provider: CODEX.provider, thinkingLevel: "low" });
  const createdId = await checkNewSession(page, options);
  await checkBusyControls(page, options);
  await checkNoSpeedDefaults(page, options.agentDir);
  console.log(`PASS: ${width}px real model-speed persistence, sidebar isolation, creation, provider restore and busy controls`);
  return createdId;
}

/** Invoked by the runner in a NEW browser context with no inherited storage. */
export async function checkModelSpeedPersistence(page, options, createdId) {
  await page.goto(`${options.base}/?session=${A}`, { waitUntil: "domcontentloaded" });
  await checkSelector(page, "fast");
  await pickSession(page, B, "standard");
  await pickSession(page, A, "fast");
  for (const [id, speed] of [[A, "fast"], [B, "standard"], [LEGACY, "standard"], [createdId, "fast"]]) await checkSaved(options, id, speed);
  await page.goto(`${options.base}/?session=${createdId}`, { waitUntil: "domcontentloaded" });
  await checkSelector(page, "fast");
  await newComposer(page, options.project);
  await checkNoSpeedDefaults(page, options.agentDir);
  console.log(`PASS: ${options.width}px model speed survives a fresh browser context; new composer remains Standard`);
}
