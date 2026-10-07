import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { calculateCost, InMemoryCredentialStore, normalizeContext } from "@earendil-works/pi-ai";
import { ModelRuntime, SessionManager } from "@earendil-works/pi-coding-agent";
import { buildBaseOptions } from "@earendil-works/pi-ai/api/simple-options";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { withSessionModelSpeed } = await jiti.import("./session-model-speed-runtime.ts");
const { appendSessionModelSpeed } = await jiti.import("./session-model-speed.ts");
const context = { messages: [{ role: "user", content: "Offline fixture", timestamp: 1 }] };
const agents = new WeakMap();
function chatAgent(manager) {
  const agent = { signal: new AbortController().signal, onPayload: (payload) => payload };
  agents.set(manager, agent);
  return () => agent;
}
const model = (id = "gpt-5.5") => ({ id, name: id, provider: "openai-codex", api: "openai-codex-responses",
  baseUrl: "http://127.0.0.1:9", reasoning: true, input: ["text"], thinkingLevels: ["off", "low", "high", "xhigh"],
  thinkingLevelMap: { off: "none", low: "low", high: "high", xhigh: "xhigh" },
  contextWindow: 128000, maxTokens: 16000, cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 } });
const jwt = (account) => `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: account } })).toString("base64url")}.not-real`;

async function fixture(account = "account-a") {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-speed-runtime-"));
  const credentials = new InMemoryCredentialStore();
  await credentials.modify("openai-codex", async () => ({ type: "oauth", access: jwt(account), refresh: "not-real", expires: Date.now() + 86_400_000, accountId: account }));
  await credentials.modify("openai", async () => ({ type: "api_key", key: "not-a-real-key" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: join(dir, "models.json"), modelsStorePath: join(dir, "models-store.json") });
  const manager = SessionManager.inMemory(dir);
  return { runtime, manager, view: withSessionModelSpeed(runtime, manager, chatAgent(manager)), close: () => rm(dir, { recursive: true, force: true }) };
}

function mockedResponse(tier = "default", { status = "completed", createdTier } = {}) {
  const calls = [];
  const fetch = async (_url, init) => {
    const headers = new Headers(init.headers);
    let body = typeof init.body === "string" ? init.body : Buffer.from(init.body);
    if (headers.get("content-encoding") === "zstd") body = process.getBuiltinModule("node:zlib").zstdDecompressSync(body);
    calls.push({ body: JSON.parse(body.toString()), headers });
    const response = { id: "resp_offline", status, output: [], usage: { input_tokens: 1000, output_tokens: 100,
      input_tokens_details: { cached_tokens: 200, cache_write_tokens: 50 }, total_tokens: 1100 } };
    if (tier !== undefined) response.service_tier = tier;
    const events = [];
    if (createdTier) events.push({ type: "response.created", response: { id: "resp_offline", status: "in_progress", service_tier: createdTier } });
    events.push({ type: "response.completed", response });
    return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
  };
  return { fetch, calls };
}

const options = (manager, mock, extra = {}) => {
  const agent = agents.get(manager);
  if (extra.onPayload) agent.onPayload = extra.onPayload;
  return { sessionId: manager.getSessionId(), transport: "sse", fetch: mock.fetch, maxRetries: 0,
    signal: agent?.signal, onPayload: agent?.onPayload, ...extra };
};
const finish = async (stream) => {
  const events = [];
  for await (const event of stream) events.push(event);
  const result = await stream.result();
  const terminal = events.findLast((event) => event.type === "done" || event.type === "error");
  assert.ok(terminal);
  assert.equal(terminal.message ?? terminal.error, result);
  return result;
};

test("native requests forward session speed separately from the unchanged reasoning control", async () => {
  const f = await fixture();
  try {
    for (const speed of ["standard", "fast"]) {
      appendSessionModelSpeed(f.manager, speed);
      for (const reasoning of [undefined, "low", "high", "xhigh"]) {
        const mock = mockedResponse();
        const result = await finish(f.view.streamSimple(model(), context, options(f.manager, mock, { reasoning })));
        assert.equal(result.stopReason, "stop", result.errorMessage);
        assert.equal(mock.calls.length, 1);
        assert.equal(mock.calls[0].body.service_tier, speed === "fast" ? "priority" : "default");
        assert.equal(mock.calls[0].body.reasoning.effort, reasoning ?? "none");
      }
    }
  } finally { await f.close(); }
});

test("runtime account/header resolution, token clamping and existing request/response/raw-event hooks are preserved", async () => {
  const f = await fixture("chosen-account");
  try {
    appendSessionModelSpeed(f.manager, "fast");
    const mock = mockedResponse("priority");
    const seen = [];
    const selected = { ...model(), contextWindow: 8192 };
    const opts = options(f.manager, mock, {
      reasoning: "high", maxTokens: 999999, toolChoice: "none", headers: { "x-speed-fixture": "original" },
      transformHeaders: async (headers) => { seen.push("headers"); return { ...headers, "x-speed-fixture": "transformed" }; },
      onPayload: async (payload) => { seen.push("payload"); return { ...payload, fixture: "replacement" }; },
      onResponse: async () => { seen.push("response"); },
      onProviderStreamEvent: async (event) => { seen.push(event.type); },
    });
    let forwarded;
    const observing = new Proxy(f.runtime, { get(target, key) {
      if (key === "stream") return (m, c, o) => { forwarded = o; return target.stream(m, c, o); };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    } });
    const result = await finish(withSessionModelSpeed(observing, f.manager, () => agents.get(f.manager)).streamSimple(selected, context, opts));
    assert.equal(result.stopReason, "stop", result.errorMessage);
    assert.equal(forwarded.maxTokens, buildBaseOptions(selected, normalizeContext(context), opts).maxTokens);
    assert.equal(forwarded.reasoningEffort, "high");
    assert.equal(mock.calls[0].body.fixture, "replacement");
    assert.equal(mock.calls[0].body.tool_choice, "none");
    assert.equal(mock.calls[0].headers.get("x-speed-fixture"), "transformed");
    assert.equal(mock.calls[0].headers.get("chatgpt-account-id"), "chosen-account");
    assert.equal(mock.calls[0].headers.get("authorization"), `Bearer ${jwt("chosen-account")}`);
    assert.deepEqual(seen, ["headers", "payload", "response", "response.completed"]);
  } finally { await f.close(); }
});

test("parent/child session-local views do not mutate the shared runtime or another account", async () => {
  const a = await fixture("account-a"); const b = await fixture("account-b");
  try {
    const child = SessionManager.inMemory("/child");
    appendSessionModelSpeed(child, "fast");
    const childView = withSessionModelSpeed(a.view, child, chatAgent(child));
    for (const [view, manager, expectedTier, account] of [
      [a.view, a.manager, "default", "account-a"], [childView, child, "priority", "account-a"],
      [a.view, a.manager, "default", "account-a"], [b.view, b.manager, "default", "account-b"],
    ]) {
      const mock = mockedResponse();
      assert.equal((await finish(view.streamSimple(model(), context, options(manager, mock)))).stopReason, "stop");
      assert.equal(mock.calls[0].body.service_tier, expectedTier);
      assert.equal(mock.calls[0].headers.get("chatgpt-account-id"), account);
    }
    appendSessionModelSpeed(a.manager, "fast");
    appendSessionModelSpeed(child, "standard");
    const mock = mockedResponse();
    await finish(childView.streamSimple(model(), context, options(child, mock)));
    assert.equal(mock.calls[0].body.service_tier, "default");
    const original = mockedResponse();
    await finish(a.runtime.streamSimple(model(), context, options(a.manager, original)));
    assert.equal(Object.hasOwn(original.calls[0].body, "service_tier"), false, "No shared runtime mutation");
  } finally { await a.close(); await b.close(); }
});

test("other providers, other session IDs and auxiliary calls retain the original simple behavior", async () => {
  const f = await fixture();
  try {
    appendSessionModelSpeed(f.manager, "fast");
    for (const sessionId of [undefined, "another-session"]) {
      const mock = mockedResponse();
      await finish(f.view.streamSimple(model(), context, options(f.manager, mock, { sessionId })));
      assert.equal(Object.hasOwn(mock.calls[0].body, "service_tier"), false);
    }
    for (const extra of [{ signal: undefined }, { signal: new AbortController().signal }, { onPayload: undefined }]) {
      const mock = mockedResponse();
      const result = await finish(f.view.streamSimple(model(), context, options(f.manager, mock, extra)));
      assert.equal(result.stopReason, "stop", result.errorMessage);
      assert.equal(Object.hasOwn(mock.calls[0].body, "service_tier"), false, "Matching session id alone is not a chat turn");
    }
    const aux = mockedResponse();
    assert.equal((await f.view.completeSimple(model(), context, options(f.manager, aux))).stopReason, "stop");
    assert.equal(Object.hasOwn(aux.calls[0].body, "service_tier"), false);
    const other = mockedResponse();
    const apiModel = { ...model(), provider: "openai", api: "openai-responses" };
    assert.equal((await finish(f.view.streamSimple(apiModel, context, options(f.manager, other)))).stopReason, "stop");
    assert.equal(Object.hasOwn(other.calls[0].body, "service_tier"), false);
  } finally { await f.close(); }
});

test("payload hooks can inspect, replace or mutate the body, but cannot silently change/delete the chosen tier", async () => {
  const f = await fixture();
  try {
    appendSessionModelSpeed(f.manager, "fast");
    for (const onPayload of [async (body) => { body.fixture = "mutation"; }, async (body) => ({ ...body, fixture: "replacement" })]) {
      const mock = mockedResponse();
      const result = await finish(f.view.streamSimple(model(), context, options(f.manager, mock, { onPayload })));
      assert.equal(result.stopReason, "stop", result.errorMessage);
      assert.ok(mock.calls[0].body.fixture);
    }
    for (const onPayload of [async (body) => ({ ...body, service_tier: "default" }), async (body) => { delete body.service_tier; }, async () => null]) {
      const mock = mockedResponse();
      const result = await finish(f.view.streamSimple(model(), context, options(f.manager, mock, { onPayload })));
      assert.equal(result.stopReason, "error");
      assert.match(result.errorMessage, /payload hook conflicts/);
      assert.equal(mock.calls.length, 0);
    }
  } finally { await f.close(); }
});

test("native tier accounting covers default/priority/fast/absent, cached tokens and both known price multipliers exactly once", async () => {
  const f = await fixture();
  try {
    for (const id of ["gpt-5.5", "gpt-5.4"]) for (const speed of ["standard", "fast"]) for (const tier of ["default", "priority", "fast", undefined]) {
      appendSessionModelSpeed(f.manager, speed);
      const mock = mockedResponse(tier);
      // Explicitly omit the field for the absent-tier contract (a default argument would otherwise insert it).
      if (tier === undefined) {
        const originalFetch = mock.fetch;
        mock.fetch = async (...args) => {
          const response = await originalFetch(...args);
          const event = JSON.parse((await response.text()).slice(6).trim());
          delete event.response.service_tier;
          return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });
        };
      }
      const m = model(id);
      const stream = f.view.streamSimple(m, context, options(f.manager, mock));
      const firstResult = await stream.result();
      assert.equal(firstResult.stopReason, "stop", firstResult.errorMessage);
      const result = await finish(stream);
      assert.equal(result, firstResult);
      assert.equal(result.usage.input, 750);
      assert.equal(result.usage.cacheRead, 200);
      assert.equal(result.usage.cacheWrite, 50);
      const base = calculateCost(m, { ...result.usage, cost: { ...result.usage.cost } });
      const premium = tier === "priority" || tier === "fast" || speed === "fast";
      const multiplier = premium ? (id === "gpt-5.5" ? 2.5 : 2) : 1;
      for (const field of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
        assert.ok(Math.abs(result.usage.cost[field] - base[field] * multiplier) < 1e-12, `${id}/${speed}/${tier}/${field}`);
      }
      assert.deepEqual((await stream.result()).usage.cost, result.usage.cost, "Repeated result observation cannot double price");
    }
  } finally { await f.close(); }
});
