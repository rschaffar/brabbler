import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const rpc = await jiti.import("./rpc-manager.ts");

function response() {
  const item = { id: "msg_fixture", type: "message", role: "assistant",
    content: [{ type: "output_text", text: "Offline answer", annotations: [] }] };
  const events = [
    { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
    { type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
    { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Offline answer" },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response: { id: "resp_fixture", status: "completed", output: [item],
      usage: { input_tokens: 1000, output_tokens: 10, input_tokens_details: { cached_tokens: 100 }, total_tokens: 1010 } } },
  ];
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    { headers: { "content-type": "text/event-stream" } });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test("real SDK chat alone receives speed; active-signal bug summaries and copied cache-warming requests remain unchanged", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-web-speed-sdk-"));
  const agentDir = join(root, "agent"); const cwd = join(root, "project");
  await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
  const previousDir = process.env.PI_CODING_AGENT_DIR;
  const previousOffline = process.env.PI_OFFLINE;
  const previousFetch = globalThis.fetch;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  const calls = [];
  let blocked, observed, gate;
  let wrapper;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /^http:\/\/127\.0\.0\.1:9\//, "Never call a real provider or catalog");
    const headers = new Headers(init.headers);
    let body = Buffer.from(init.body);
    if (headers.get("content-encoding") === "zstd") body = process.getBuiltinModule("node:zlib").zstdDecompressSync(body);
    calls.push(JSON.parse(body.toString()));
    if (blocked) { blocked = false; observed.resolve(); await gate.promise; }
    return response();
  };
  try {
    const jwt = `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "offline-sdk" } })).toString("base64url")}.not-real`;
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "openai-codex": { type: "oauth", access: jwt,
      refresh: "fixture-not-real", expires: Date.now() + 86_400_000, accountId: "offline-sdk" } }), { mode: 0o600 });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "e2e-speed-sdk",
      defaultThinkingLevel: "high", enabledModels: ["openai-codex/e2e-speed-sdk"], cacheWarming: "streaming",
      retry: { enabled: false }, enableInstallTelemetry: false }), { mode: 0o600 });
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "openai-codex": { baseUrl: "http://127.0.0.1:9",
      models: [{ id: "e2e-speed-sdk", name: "Offline SDK", api: "openai-codex-responses", reasoning: true, input: ["text"], promptCache: { short: 300 },
        contextWindow: 128000, maxTokens: 4096, cost: { input: 2, output: 8, cacheRead: 0.5, cacheWrite: 2 } }] } } }), { mode: 0o600 });
    ({ session: wrapper } = await rpc.startRpcSession(`__new__${randomUUID()}`, "", cwd, { toolNames: [], thinkingLevel: "high" }));
    await wrapper.waitUntilReady();
    const inner = wrapper.inner;
    inner.agent.transport = "sse";
    for (const speed of ["standard", "fast"]) {
      await wrapper.send({ type: "set_model_speed", modelSpeed: speed });
      const start = calls.length;
      observed = deferred(); gate = deferred(); blocked = true;
      // RPC prompt acknowledges preflight, not completion. Await the real SDK
      // run so its stream and settlement are finished before fixture cleanup.
      const prompt = inner.prompt("Offline main chat", { source: "rpc" });
      void prompt.catch(() => {});
      try {
        await Promise.race([observed.promise, prompt.then(() => { throw new Error("Main prompt completed without a provider request"); })]);
        assert.equal(calls[start].service_tier, speed === "fast" ? "priority" : "default");
        assert.equal(calls[start].reasoning.effort, "high");
        const activeSignal = inner.agent.signal;
        assert.ok(activeSignal);
        const warmer = inner._cacheWarmer;
        const run = warmer.run;
        assert.ok(run, "Exercise the SDK's actual cached main request");
        assert.equal(run.options.signal, activeSignal);
        assert.equal(run.options.onPayload, inner.agent.onPayload);
        assert.notEqual(run.controller.signal, activeSignal);
        clearTimeout(run.timer);
        warmer.decide = async () => "warm"; // Force the documented extension override, not a timed or economic assumption.
        await warmer.refresh(run);
        assert.equal(calls.length, start + 2);
        assert.equal(Object.hasOwn(calls[start + 1], "service_tier"), false, "Copied chat callback/session id must not upgrade warming");
        assert.ok(inner.sessionManager.getEntries().some((entry) => entry.type === "usage" && entry.kind === "cache_warm"));
        assert.equal(await inner.summarizeForBugReport({ signal: activeSignal, hint: "Offline fixture" }), "Offline answer");
        assert.equal(Object.hasOwn(calls[start + 2], "service_tier"), false, "Same session id AND active signal are not sufficient");
        assert.equal(calls.length, start + 3);
      } finally {
        gate.resolve();
        await prompt;
      }
      assert.equal((await wrapper.send({ type: "get_state" })).thinkingLevel, "high");
    }
  } finally {
    gate?.resolve();
    wrapper?.destroy();
    if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousDir;
    if (previousOffline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previousOffline;
    globalThis.fetch = previousFetch;
    await rm(root, { recursive: true, force: true });
  }
});
