import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { InMemoryCredentialStore, createAssistantMessageEventStream, fauxAssistantMessage, fauxProvider,
  fauxToolCall, isContextOverflow, isRetryableAssistantError, normalizeContext } from "@earendil-works/pi-ai";
import { buildBaseOptions } from "@earendil-works/pi-ai/api/simple-options";
import { stream as responsesStream } from "@earendil-works/pi-ai/api/openai-responses";
import { compact, createAgentSession, DefaultResourceLoader, generateBranchSummary, generateSummaryWithUsage,
  ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const user = text => ({ role: "user", content: text, timestamp: Date.now() });
const fileOps = () => ({ read: new Set(), written: new Set(), edited: new Set() });
const model = { id: "sdk-summary", name: "Synthetic summary", api: "openai-responses", provider: "openai",
  baseUrl: "https://synthetic.invalid/v1", reasoning: true, input: ["text"], contextWindow: 128000, maxTokens: 20000,
  cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 } };
function completed(message = fauxAssistantMessage("Synthetic summary")) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "done", reason: message.stopReason, message });
  stream.end(message);
  return stream;
}

test("SDK summaries use model/context output limits and retain split-turn instructions", async () => {
  const calls = [], controller = new AbortController(), focus = "Keep the literal synthetic focus";
  const streamFn = (selected, context, options) => {
    calls.push({ model: selected, context, options });
    return completed();
  };
  const ordinary = await generateSummaryWithUsage([user("history")], model, 32, undefined, undefined,
    controller.signal, focus, undefined, "high", streamFn, {}, undefined, undefined, "summary-owner");
  assert.equal(ordinary.text, "Synthetic summary");
  const split = await compact({ firstKeptEntryId: "kept", messagesToSummarize: [user("earlier")],
    turnPrefixMessages: [user("split turn")], isSplitTurn: true, tokensBefore: 1000,
    fileOps: fileOps(), settings: { enabled: true, reserveTokens: 32, keepRecentTokens: 16 } },
  model, undefined, undefined, focus, controller.signal, "high", streamFn, {}, undefined, undefined, "summary-owner");
  assert.match(split.summary, /Turn Context \(split turn\)/);
  const manager = SessionManager.inMemory();
  manager.appendMessage(user("abandoned branch"));
  manager.appendMessage(fauxAssistantMessage("branch answer"));
  const branch = await generateBranchSummary(manager.getBranch(), { model, signal: controller.signal,
    reserveTokens: 32, customInstructions: focus, streamFn });
  assert.equal(branch.summary, "The user explored a different conversation branch before returning here.\nSummary of that exploration:\n\nSynthetic summary");
  assert.equal(calls.length, 4, "ordinary, history, split prefix and branch");
  for (const call of calls) {
    assert.equal(Object.hasOwn(call.options, "maxTokens"), false, "no obsolete summary output cap");
    assert.equal(Object.hasOwn(call.options, "serviceTier"), false, "auxiliary call is not Fast chat");
    assert.equal(call.options.cacheRetention, "none");
    assert.equal(call.options.signal, controller.signal);
    assert.match(JSON.stringify(call.context), new RegExp(focus));
    assert.equal(buildBaseOptions(call.model, normalizeContext(call.context), call.options).maxTokens, 20000);
  }
  const constrained = { ...model, contextWindow: 8192 };
  const clamped = buildBaseOptions(constrained, normalizeContext(calls[0].context), calls[0].options).maxTokens;
  assert.ok(clamped > 0 && clamped < 8192, "real simple adapter still fits the remaining context");
  await assert.rejects(generateSummaryWithUsage([user("history")], model, 32, undefined, undefined,
    undefined, undefined, undefined, undefined, () => completed(fauxAssistantMessage("partial", { stopReason: "length" }))),
  /summary is incomplete/);
});

async function sessionFixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-sdk-compatibility-")), sessions = new Set(), extensionErrors = [];
  t.after(async () => {
    const results = await Promise.allSettled([...sessions].map(async session => {
      try { await session.abort(); await session.agent.waitForIdle(); }
      finally { session.dispose(); }
    }));
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "Synthetic SDK sessions did not settle");
    await rm(root, { recursive: true, force: true });
    assert.deepEqual(extensionErrors, [], "no swallowed extension failures");
  });
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    modelsStorePath: join(root, "models-store.json"), refreshOnCreate: false, allowModelNetwork: false });
  const faux = fauxProvider({ models: [{ id: "recovery", contextWindow: 128000, maxTokens: 4096 }] });
  runtime.registerNativeProvider(faux.provider);
  await runtime.refresh({ allowNetwork: false });
  let cancellations = 0;
  const open = async (manager, { factories = [], restoreDefaults = false } = {}) => {
    const settingsManager = SettingsManager.inMemory({ defaultTools: ["read"], cacheWarming: "off", enableInstallTelemetry: false,
      retry: { enabled: false }, compaction: { enabled: true, reserveTokens: 4096, keepRecentTokens: 64 } });
    const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [{ name: "synthetic-cancel-summary", factory(pi) {
        // Cancellation deliberately leaves the kept history exposed: a new summary
        // must not accidentally hide orphaned results and make the pairing test green.
        pi.on("session_before_compact", () => { cancellations++; return { cancel: true }; });
      } }, ...factories] });
    await resourceLoader.reload();
    const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime,
      model: faux.getModel("recovery"), settingsManager, resourceLoader, ...(!restoreDefaults ? { tools: ["read"] } : {}), sessionManager: manager });
    sessions.add(session);
    await session.bindExtensions({ onError: error => extensionErrors.push(error.message) });
    return session;
  };
  return { root, faux, open, cancellations: () => cancellations };
}

for (const reopened of [false, true]) test(`SDK recovery omits paired truncated tool results ${reopened ? "after reopen/context replacement" : "in a live run"} while keeping raw history`, async t => {
  const f = await sessionFixture(t), manager = SessionManager.create(f.root, join(f.root, "sessions"));
  let session = await f.open(manager);
  f.faux.setResponses([fauxAssistantMessage("seed answer"), fauxAssistantMessage("initial answer")]);
  await session.prompt("older seed turn");
  await session.prompt("initial context ".repeat(256));
  const toolId = "synthetic-truncated-call";
  if (reopened) {
    const selected = f.faux.getModel("recovery");
    manager.appendMessage(user("saved interrupted turn"));
    const failed = { ...fauxAssistantMessage([fauxToolCall("read", { path: "never-read.txt" }, { id: toolId })],
      { stopReason: "length" }), api: selected.api, provider: selected.provider, model: selected.id };
    const failedId = manager.appendMessage(failed);
    manager.appendMessage({ role: "toolResult", toolCallId: toolId, toolName: "read", content: [{ type: "text", text: "saved truncated result" }],
      isError: true, timestamp: Date.now() });
    manager.appendContextEdit(failedId, { ...failed, content: [...failed.content, { type: "text", text: "projected copy" }] });
    session.dispose();
    session = await f.open(SessionManager.open(manager.getSessionFile()));
  } else {
    // End this low-level batch so the real SDK post-run recovery sees the
    // truncated attempt, rather than requesting an unconfigured faux follow-up.
    const finishTurn = session.agent.finishTurn;
    session.agent.finishTurn = async (...args) => {
      const decision = await finishTurn?.(...args);
      return args[0].message.stopReason === "length" ? { action: "end" } : decision;
    };
    f.faux.setResponses([fauxAssistantMessage([fauxToolCall("read", { path: "never-read.txt" }, { id: toolId })],
      { stopReason: "length" })]);
    await session.prompt("produce an interrupted tool call");
  }
  let observed;
  f.faux.setResponses([context => { observed = structuredClone(context); return fauxAssistantMessage("recovered answer"); }]);
  await session.prompt("continue normally");
  assert.ok(observed, "next actual SDK provider request was made");
  assert.equal(observed.messages.some(message => message.role === "toolResult" && message.toolCallId === toolId), false,
    "next provider context must not contain an orphaned result");
  assert.equal(observed.messages.some(message => message.role === "assistant" && message.content.some(block => block.type === "toolCall" && block.id === toolId)), false);
  const entries = session.sessionManager.getEntries(), raw = entries.filter(entry => entry.type === "message");
  const failed = raw.find(entry => entry.message.role === "assistant" && entry.message.content.some(block => block.type === "toolCall" && block.id === toolId));
  const result = raw.find(entry => entry.message.role === "toolResult" && entry.message.toolCallId === toolId);
  assert.ok(failed && result, "raw assistant/result remain inspectable");
  const omitted = new Set(entries.filter(entry => entry.type === "context_edit" && entry.replacement === null).map(entry => entry.targetId));
  assert.ok(omitted.has(failed.id) && omitted.has(result.id), "both source entries are persistently omitted");
  assert.ok(f.cancellations() > 0, "real recovery path reached compaction admission");
  assert.match(await readFile(session.sessionManager.getSessionFile(), "utf8"), /recovered answer/);
  assert.ok(session.sessionManager.getEntries().some(entry => entry.type === "message" && entry.message.role === "assistant" && entry.message.stopReason === "stop"));
});

test("native SDK restores branch-wide tool deltas across compaction and admits only eligible new or saved late tools", async t => {
  const f = await sessionFixture(t), manager = SessionManager.inMemory(f.root);
  let removedCalls = 0, registerLate;
  const definition = (name, extra = {}) => ({ name, label: name, description: `Synthetic ${name}`,
    parameters: { type: "object", properties: {} }, execute: async () => {
      if (name === "removed") removedCalls++;
      return { content: [{ type: "text", text: name }], details: {} };
    }, ...extra });
  const declaration = name => ({ name, description: `Synthetic ${name}`, parameters: { type: "object", properties: {} } });
  manager.appendMessage({ role: "system", content: "Synthetic old declarations", timestamp: 1,
    toolsAdded: [declaration("read"), declaration("removed"), declaration("saved_late")] });
  manager.appendMessage(user("old turn"));
  manager.appendMessage(fauxAssistantMessage("old answer"));
  manager.appendMessage({ role: "system", content: "", toolsRemoved: [{ name: "removed" }], timestamp: 2 });
  const target = manager.appendMessage(fauxAssistantMessage("before compaction"));
  const kept = manager.appendMessage(user("kept user turn"));
  manager.appendCompaction("Synthetic compacted history", kept, 1000);
  const session = await f.open(manager, { restoreDefaults: true, factories: [{ name: "synthetic-restoration", factory(pi) {
    pi.registerTool(definition("removed"));
    pi.registerTool(definition("new_direct"));
    pi.registerTool(definition("dormant", { defaultActive: false }));
    pi.registerTool(definition("hidden", { exposure: "hidden" }));
    registerLate = () => pi.registerTool(definition("saved_late", { exposure: "deferred" }));
  } }] });
  const verify = () => {
    const active = new Set(session.getActiveToolNames());
    assert.ok(active.has("read") && active.has("new_direct"));
    for (const name of ["removed", "dormant", "hidden"]) assert.equal(active.has(name), false, name);
  };
  verify();
  assert.equal(session.getActiveToolNames().includes("saved_late"), false);
  registerLate();
  assert.equal(session.getActiveToolNames().includes("saved_late"), true, "recorded intent admits late registration");
  assert.equal((await session.navigateTree(target, { summarize: false })).cancelled, false);
  verify();
  let result;
  f.faux.setResponses([fauxAssistantMessage([fauxToolCall("removed", {})], { stopReason: "toolUse" }), context => {
    result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "removed");
    return fauxAssistantMessage("inactive tool refused");
  }]);
  await session.prompt("Probe a stale advertised tool");
  assert.equal(result?.isError, true);
  assert.equal(removedCalls, 0, "a retained declaration does not grant execution");
});

function response() {
  const message = { id: "msg_fixture", type: "message", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] };
  return new Response(`data: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: message })}\n\n`
    + `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_fixture", status: "completed", output: [message],
      usage: { input_tokens: 20, output_tokens: 1, total_tokens: 21 } } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
}

test("actual Responses transport anchors tool changes, keeps removal notices, normalizes blank results and honors identity overrides", async () => {
  const tool = (name, description) => ({ name, description, parameters: { type: "object", properties: {} } });
  const first = tool("first", "first definition"), second = tool("second", "second definition"), revised = tool("second", "new definition");
  const messages = [{ role: "system", content: "Synthetic owner", toolsAdded: [first], timestamp: 1 }, user("begin")];
  const selected = { ...model, provider: "openrouter", baseUrl: "https://openrouter.ai/api/v1",
    compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true } };
  const payloads = [];
  const send = async () => {
    const result = await responsesStream(selected, { messages }, { apiKey: "synthetic-not-a-credential", maxRetries: 0,
      identity: { userAgent: { custom: "synthetic-owner" }, attribution: { name: "Synthetic", url: "https://fixture.invalid" } },
      headers: { "HTTP-Referer": null, "X-Title": "host-override" },
      fetch: async (url, init) => {
        assert.equal(String(url), "https://openrouter.ai/api/v1/responses");
        const headers = new Headers(init.headers);
        assert.equal(headers.get("user-agent"), "synthetic-owner");
        assert.equal(headers.has("http-referer"), false);
        assert.equal(headers.get("x-title"), "host-override");
        payloads.push(JSON.parse(init.body));
        return response();
      } }).result();
    assert.equal(result.stopReason, "stop", result.errorMessage);
  };
  await send();
  messages.push({ role: "system", content: "", toolsAdded: [second], timestamp: 2 });
  await send();
  messages.push({ role: "system", content: "", toolsRemoved: [{ name: "first" }], timestamp: 3 });
  await send();
  messages.push({ role: "system", content: "", toolsRemoved: [{ name: "second" }], toolsAdded: [revised], timestamp: 4 });
  await send();
  assert.deepEqual(payloads.map(payload => payload.input.filter(item => item.type === "additional_tools").map(item => item.tools.map(tool => tool.name))),
    [[["first"]], [["first"], ["second"]], [["first"], ["second"]], [["first"], ["second"], ["second"]]]);
  assert.deepEqual(payloads[3].input.slice(0, payloads[0].input.length), payloads[0].input, "unchanged anchored prefix");
  assert.match(JSON.stringify(payloads[3].input), /no longer available/);
  assert.equal(payloads[3].input.filter(item => item.type === "additional_tools").at(-1).tools[0].description, "new definition");
  const call = { ...fauxAssistantMessage([fauxToolCall("second", {}, { id: "blank-result" })], { stopReason: "toolUse" }),
    api: selected.api, provider: selected.provider, model: selected.id };
  messages.push(call, { role: "toolResult", toolName: "second", toolCallId: "blank-result", content: [{ type: "text", text: "\r\n" }], timestamp: 5 });
  await send();
  assert.equal(payloads[4].input.find(item => item.type === "function_call_output").output.trim().length > 0, true, "blank results are made API-safe");
});

test("SDK retry classification distinguishes transient upstream failures, real 413 overflow and permanent quota/request IDs", () => {
  const error = text => fauxAssistantMessage([], { stopReason: "error", errorMessage: text });
  for (const text of ["unable to forward upstream", "upstream_stream_read_error", "stream disconnected before completion", "request to https://synthetic.invalid failed, reason:", "HTTP 503"]) {
    assert.equal(isRetryableAssistantError(error(text)), true, text);
  }
  for (const text of ["request id abc503def", "payload size 150020", "subscription_sharing_workplace_individual_usage_limit_exceeded (429)"]) {
    assert.equal(isRetryableAssistantError(error(text)), false, text);
  }
  assert.equal(isContextOverflow(error('github-copilot API error (413): {"message":"failed to parse request"}')), true);
  assert.equal(isContextOverflow(error('request id 413abc failed to parse request')), false);
});
