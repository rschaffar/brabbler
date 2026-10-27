import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { ProjectTrustStore } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const rpc = await jiti.import("./rpc-manager.ts");
const { readNativeResourceSelection } = await jiti.import("./session-native-resources.ts");
const { resolveSessionPath } = await jiti.import("./session-reader.ts");
const text = result => result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
const on = { version: 1, codeMode: true, mcpServers: [] };
const off = { ...on, codeMode: false };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "native-resource-runtime-")), agent = join(root, "agent"), cwd = join(root, "project");
  await mkdir(agent, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
  const previous = { dir: process.env.PI_CODING_AGENT_DIR, offline: process.env.PI_OFFLINE, fetch: globalThis.fetch };
  process.env.PI_CODING_AGENT_DIR = agent; process.env.PI_OFFLINE = "1";
  globalThis.fetch = async () => { throw new Error("Native-resource fixtures must not contact a provider"); };
  await writeFile(join(agent, "settings.json"), JSON.stringify({ cacheWarming: "off", enableInstallTelemetry: false }), { mode: 0o600 });
  await writeFile(join(cwd, "note.txt"), "SYNTHETIC_NATIVE_READ\n");
  const wrappers = new Set(), operations = new Set(), releases = new Set();
  const releaseAll = () => { for (const release of releases) release(); };
  const operation = promise => { operations.add(promise); void promise.catch(() => {}); return promise; };
  t.signal.addEventListener("abort", releaseAll, { once: true });
  t.after(async () => {
    releaseAll();
    // A failed assertion can leave startup/replacement unpublished. Join it
    // before enumerating the wrappers it publishes, then await native shutdown.
    await Promise.allSettled(operations);
    const stopped = await Promise.allSettled([...wrappers].map(wrapper => wrapper.shutdown()));
    t.signal.removeEventListener("abort", releaseAll);
    const errors = stopped.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "Native fixture shutdown failed");
    if (previous.dir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.dir;
    if (previous.offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previous.offline;
    globalThis.fetch = previous.fetch;
    await rm(root, { recursive: true, force: true });
  });
  const start = async (tools, nativeResources) => {
    return operation(rpc.startRpcSession(`__new__${randomUUID()}`, "", cwd, { toolNames: tools, ...(nativeResources ? { nativeResources } : {}) }).then(started => {
      wrappers.add(started.session); return started.session;
    }));
  };
  const track = wrapper => { wrappers.add(wrapper); return wrapper; };
  return { root, agent, cwd, start, track, operation, release: callback => releases.add(callback) };
}

function nativeDefinition(wrapper, name) {
  const extensions = wrapper.inner.resourceLoader.getExtensions().extensions;
  const owner = name.startsWith("mcp__") ? "mcp" : name === "tool_search" ? "tool-search" : name;
  return extensions.find(extension => extension.path === `<inline:brabbler-native-${owner}>`)?.tools.get(name)?.definition;
}
async function nativeCall(wrapper, name, args, { signal = new AbortController().signal, onUpdate } = {}) {
  await wrapper.waitUntilReady();
  const definition = nativeDefinition(wrapper, name); assert.ok(definition, `real native ${name} definition`);
  const id = `native-call-${randomUUID()}`;
  // The native nested-call pipeline requires a genuine issuing assistant entry.
  // Seed only synthetic history through the public manager/agent APIs; no model call.
  const message = { role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }],
    provider: "fixture", api: "fixture", model: "fixture", stopReason: "toolUse", timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
  wrapper.inner.sessionManager.appendMessage(message);
  wrapper.inner.agent.state.messages = [...wrapper.inner.agent.state.messages, message];
  const admission = await wrapper.inner.extensionRunner.emitToolCall({ type: "tool_call", toolName: name, toolCallId: id, input: args });
  if (admission?.block) throw new Error(admission.reason);
  return definition.execute(id, args, signal, onUpdate, wrapper.inner.extensionRunner.createToolContext(id, signal));
}
const script = (wrapper, code, options) => nativeCall(wrapper, "codemode", { code }, options);

test("legacy and Chat-only sessions never register native engines, even with retained selection intent", async t => {
  const f = await fixture(t);
  const legacy = await f.start(["read"]), chat = await f.start([], on);
  for (const wrapper of [legacy, chat]) {
    await wrapper.waitUntilReady();
    assert.equal(wrapper.inner.getAllTools().some(tool => ["codemode", "tool_search"].includes(tool.name)), false);
  }
  const state = await chat.send({ type: "get_state" });
  assert.deepEqual(state.nativeResources, on); assert.deepEqual(state.effectiveNativeResources, off);
  assert.equal(existsSync(join(f.agent, "mcp-auth.json")), false);
});

test("bounded launch-owned refusal cannot acquire native processes or workers before acceptance", async t => {
  const f = await fixture(t);
  await assert.rejects(rpc.startRpcSession(`__new__${randomUUID()}`, "", f.cwd, {
    toolNames: ["read"], nativeResources: on, initialPromptOwner: Symbol("synthetic-launch"),
  }), /cannot enable native tools before initial prompt acceptance/);
});

test("actual native QuickJS executes allowed tools, exposes no model/Node bridge and cannot widen a built-in preset", async t => {
  const f = await fixture(t), wrapper = await f.start(["read"], on);
  await wrapper.waitUntilReady();
  assert.ok(wrapper.inner.getActiveToolNames().includes("codemode"));
  assert.equal(wrapper.inner.getAllTools().find(tool => tool.name === "codemode").exposure, "model-only");
  const globals = await script(wrapper, 'return {models:typeof models,process:typeof process,require:typeof require}');
  assert.notEqual(globals.isError, true, text(globals)); assert.match(text(globals), /"models":"undefined"/);
  assert.match(text(globals), /"process":"undefined"/); assert.match(text(globals), /"require":"undefined"/);
  const read = await script(wrapper, 'return await tools.read({path:"note.txt"})');
  assert.notEqual(read.isError, true, text(read)); assert.match(text(read), /SYNTHETIC_NATIVE_READ/);
  const write = await script(wrapper, 'return await tools.write({path:"not-admitted.txt",content:"must not exist"})');
  assert.equal(write.isError, true, text(write)); assert.equal(existsSync(join(f.cwd, "not-admitted.txt")), false);
  const control = await script(wrapper, 'return ALL_TOOLS.filter(tool=>["Agent","get_subagent_result","steer_subagent","start_session"].includes(tool.name))');
  assert.notEqual(control.isError, true, text(control)); assert.match(text(control), /\[\]/);
});

test("explicit transient selection changes and Chat-only recreation preserve intent without credentials or model calls", async t => {
  const f = await fixture(t), original = await f.start(["read"]);
  const changed = await rpc.setRpcSessionNativeResources(original.sessionId, undefined, on);
  const coding = f.track(changed.session); assert.equal(original.isAlive(), false); assert.equal(changed.recreated, true);
  assert.equal(coding.sessionId, original.sessionId, "setup-only replacement retains identity for acknowledgement recovery");
  assert.equal(existsSync(coding.sessionFile), true);
  assert.deepEqual(readNativeResourceSelection(coding.inner.sessionManager.getEntries()), on);
  const chat = f.track((await rpc.setRpcSessionTools(coding.sessionId, undefined, [])).session);
  assert.deepEqual((await chat.send({ type: "get_state" })).nativeResources, on);
  assert.deepEqual((await chat.send({ type: "get_state" })).effectiveNativeResources, off);
  const restored = f.track((await rpc.setRpcSessionTools(chat.sessionId, undefined, ["read"])).session);
  assert.match(text(await script(restored, "return 42")), /42/);
});

test("fork, clone, account recreation and reopen preserve explicit native intent", async t => {
  const f = await fixture(t), original = await f.start(["read"], on);
  await script(original, "return 42");
  const forked = await original.send({ type: "fork_branch", entryId: original.inner.sessionManager.getLeafId() });
  const fork = f.track((await rpc.startRpcSession(forked.newSessionId, await resolveSessionPath(forked.newSessionId), undefined)).session);
  assert.equal(original.isAlive(), true); assert.deepEqual((await fork.send({ type: "get_state" })).nativeResources, on);
  const cloned = await original.send({ type: "clone" });
  const clone = f.track((await rpc.startRpcSession(cloned.newSessionId, await resolveSessionPath(cloned.newSessionId), undefined)).session);
  assert.equal(original.isAlive(), false); assert.deepEqual((await clone.send({ type: "get_state" })).nativeResources, on);
  const id = await rpc.setRpcSessionAccount(clone.sessionId, clone.sessionFile, "openai", null);
  const changed = f.track(rpc.getRpcSession(id)); assert.deepEqual((await changed.send({ type: "get_state" })).nativeResources, on);
  const file = changed.sessionFile; await changed.shutdown();
  const reopened = f.track((await rpc.startRpcSession(id, file, undefined)).session);
  assert.deepEqual((await reopened.send({ type: "get_state" })).nativeResources, on);
  assert.match(text(await script(reopened, "return 42")), /42/);
});

for (const [name, exposure, codeMode, scope = "global"] of [
  ["selected", "deferred", true], ["long".repeat(16), "deferred", true],
  ["coded", "codemode", true], ["direct", "direct", true], ["hidden", "hidden", true],
  ["search_only", undefined, false], ["project_selected", "deferred", true, "project"],
]) test(`native MCP ${name} preserves exposure, stays scoped and settles`, async t => {
  const previousUmask = process.umask(0o022); t.after(() => process.umask(previousUmask));
  const f = await fixture(t), server = join(f.root, "stdio-fixture.mjs"), marker = join(f.cwd, "selected.json"), called = join(f.cwd, "called.txt"), forbidden = join(f.cwd, "unselected.txt");
  await writeFile(server, `
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
writeFileSync(process.argv[2], JSON.stringify({pid:process.pid, explicit:process.env.EXPLICIT, ambient:Object.hasOwn(process.env,"UNDECLARED_MCP_FIXTURE_SECRET"), password:Object.hasOwn(process.env,"BRABBLER_PASSWORD")}), {mode:0o600});
createInterface({input:process.stdin}).on("line", line => {
  const request=JSON.parse(line); if(request.id===undefined) return;
  if(request.method==="tools/call") writeFileSync(process.argv[3], "called");
  const result=request.method==="initialize" ? {protocolVersion:"2025-11-25",capabilities:{tools:{},logging:{}},serverInfo:{name:"synthetic",version:"1"}}
    : request.method==="tools/list" ? {tools:[{name:"echo",description:"Synthetic echo",inputSchema:{type:"object",properties:{value:{type:"string"}},required:["value"]}}]}
    : request.method==="tools/call" ? {content:[{type:"text",text:request.params.arguments.value}]}
    : {};
  if(request.method==="tools/list") process.stdout.write(JSON.stringify({jsonrpc:"2.0",method:"notifications/message",params:{level:"info",data:"SYNTHETIC_NATIVE_LOG"}})+"\\n");
  process.stdout.write(JSON.stringify({jsonrpc:"2.0",id:request.id,result})+"\\n");
});
`);
  const previous = { undeclared: process.env.UNDECLARED_MCP_FIXTURE_SECRET, declared: process.env.DECLARED_MCP_FIXTURE_SECRET };
  process.env.UNDECLARED_MCP_FIXTURE_SECRET = "synthetic-not-inherited"; process.env.DECLARED_MCP_FIXTURE_SECRET = "synthetic-explicit";
  t.after(() => {
    for (const [name, value] of [["UNDECLARED_MCP_FIXTURE_SECRET", previous.undeclared], ["DECLARED_MCP_FIXTURE_SECRET", previous.declared]]) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  const configurationFile = scope === "project" ? join(f.cwd, ".pi/mcp.json") : join(f.agent, "mcp.json");
  if (scope === "project") { await mkdir(join(f.cwd, ".pi")); new ProjectTrustStore(f.agent).set(f.cwd, true); }
  await writeFile(configurationFile, JSON.stringify({ mcpServers: {
    [name]: { command: process.execPath, args: [server, marker, called], env: { EXPLICIT: "${DECLARED_MCP_FIXTURE_SECRET}" }, ...(exposure ? { exposure } : {}), timeout: 2 },
    unselected: { command: process.execPath, args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(forbidden)},'not allowed')`] },
  } }), { mode: 0o600 });
  const wrapper = await f.start(["read"], { ...on, codeMode, mcpServers: [{ scope, name }] });
  await wrapper.waitUntilReady();
  const deadline = Date.now() + 5000;
  let state;
  do {
    state = await wrapper.send({ type: "get_state" });
    if (state.mcpServers[0]?.state === "connected" || state.mcpServers[0]?.state === "failed") break;
    await delay(10);
  } while (Date.now() < deadline);
  assert.deepEqual(state.mcpServers, [{ scope, name, state: "connected", tools: 1 }]);
  const toolName = wrapper.inner.getAllTools().find(tool => tool.namespace?.aliases?.includes(name))?.name;
  assert.ok(toolName); assert.ok(toolName.length <= 64);
  assert.equal(wrapper.inner.getActiveToolNames().includes(toolName), exposure === "direct", "only direct tools activate at registration");
  if (exposure === "hidden") {
    const output = await script(wrapper, `return await tools[${JSON.stringify(toolName)}]({value:"SYNTHETIC_MCP_ECHO"})`);
    assert.equal(output.isError, true);
    await assert.rejects(nativeCall(wrapper, toolName, { value: "not admitted" }), /not admitted/);
    assert.equal(existsSync(called), false);
  } else if (codeMode) {
    const output = await script(wrapper, `return await tools[${JSON.stringify(toolName)}]({value:"SYNTHETIC_MCP_ECHO"})`);
    assert.notEqual(output.isError, true, text(output)); assert.match(text(output), /SYNTHETIC_MCP_ECHO/);
    assert.equal(existsSync(called), true);
  } else {
    assert.equal(wrapper.inner.getAllTools().some(tool => tool.name === "codemode"), false);
    const loaded = await nativeCall(wrapper, "tool_search", { query: toolName });
    assert.ok(loaded.details.loaded.includes(toolName), text(loaded));
    assert.ok(wrapper.inner.getActiveToolNames().includes(toolName));
    assert.match(text(await nativeCall(wrapper, toolName, { value: "SYNTHETIC_MCP_ECHO" })), /SYNTHETIC_MCP_ECHO/);
    assert.equal(existsSync(called), true);
  }
  const observed = JSON.parse(await readFile(marker, "utf8"));
  let livePid = observed.pid;
  if (name === "selected") {
    process.env.DECLARED_MCP_FIXTURE_SECRET = "changed-after-owner-construction";
    process.kill(observed.pid, "SIGTERM");
    const deadline = Date.now() + 5000;
    while ((await wrapper.send({ type: "get_state" })).mcpServers[0].state !== "disconnected" && Date.now() < deadline) await delay(10);
    assert.match(text(await script(wrapper, `return await tools[${JSON.stringify(toolName)}]({value:"RECONNECTED"})`)), /RECONNECTED/);
    const reconnected = JSON.parse(await readFile(marker, "utf8"));
    assert.equal(reconnected.explicit, "synthetic-explicit", "automatic reconnect keeps the original runtime environment");
    livePid = reconnected.pid; assert.notEqual(livePid, observed.pid);
  }
  if (scope === "project") {
    await rm(configurationFile); new ProjectTrustStore(f.agent).set(f.cwd, false);
    await rm(called);
    await assert.rejects(script(wrapper, "return 42"), /not admitted|trust was revoked/);
    assert.equal((await wrapper.send({ type: "get_state" })).mcpServers[0].state, "blocked");
    assert.equal(existsSync(called), false);
  }
  assert.equal(observed.explicit, "synthetic-explicit"); assert.equal(observed.ambient, false); assert.equal(observed.password, false);
  assert.equal(existsSync(forbidden), false); assert.equal(existsSync(join(f.agent, "mcp-auth.json")), false);
  await wrapper.shutdown();
  assert.throws(() => process.kill(observed.pid, 0), { code: "ESRCH" });
  assert.throws(() => process.kill(livePid, 0), { code: "ESRCH" });
});

for (const authentication of ["public", "header", "unauthorized"]) test(`native HTTP ${authentication} never adopts stored OAuth or contacts an issuer`, async t => {
  const f = await fixture(t), url = "https://synthetic.invalid/mcp", requests = [];
  const sentinel = "SYNTHETIC_UNUSED_OAUTH_FILE";
  await writeFile(join(f.agent, "mcp-auth.json"), sentinel, { mode: 0o600 });
  await writeFile(join(f.agent, "mcp.json"), JSON.stringify({ mcpServers: {
    selected: { url, exposure: "deferred", ...(authentication === "header" ? { headers: { Authorization: "Bearer synthetic-static" } } : {}) },
  } }), { mode: 0o600 });
  globalThis.fetch = async (input, init = {}) => {
    assert.equal(String(input), url, "no provider, OAuth issuer or discovery destination");
    const headers = new Headers(init.headers);
    requests.push({ method: init.method, authorization: headers.get("authorization") });
    if (init.method === "DELETE") return new Response(null, { status: 200 });
    if (init.method === "GET") return new Response(null, { status: 405 });
    if (authentication === "unauthorized") return new Response("SYNTHETIC_PRIVATE_ERROR", { status: 401,
      headers: { "www-authenticate": 'Bearer resource_metadata="https://issuer.invalid/private"' } });
    const request = JSON.parse(init.body);
    if (request.id === undefined) return new Response(null, { status: 202 });
    const result = request.method === "initialize" ? { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "synthetic", version: "1" } }
      : request.method === "tools/list" ? { tools: [{ name: "echo", inputSchema: { type: "object", properties: { value: { type: "string" } } } }] }
      : request.method === "tools/call" ? { content: [{ type: "text", text: request.params.arguments.value }] } : {};
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }), {
      headers: { "content-type": "application/json", "mcp-session-id": "synthetic-http-session" },
    });
  };
  const wrapper = await f.start(["read"], { ...off, mcpServers: [{ scope: "global", name: "selected" }] });
  await wrapper.waitUntilReady();
  const deadline = Date.now() + 5000;
  let state;
  do { state = await wrapper.send({ type: "get_state" }); if (["connected", "failed", "needs-auth"].includes(state.mcpServers[0]?.state)) break; await delay(10); } while (Date.now() < deadline);
  if (authentication === "unauthorized") {
    assert.ok(["failed", "needs-auth"].includes(state.mcpServers[0].state));
    assert.equal(JSON.stringify(state.mcpServers).includes("SYNTHETIC_PRIVATE_ERROR"), false);
  } else {
    assert.equal(state.mcpServers[0].state, "connected");
    assert.match(text(await nativeCall(wrapper, "mcp__selected__echo", { value: "SYNTHETIC_HTTP_ECHO" })), /SYNTHETIC_HTTP_ECHO/);
  }
  await wrapper.shutdown();
  assert.ok(requests.length > 0);
  assert.ok(requests.every(request => request.authorization === (authentication === "header" ? "Bearer synthetic-static" : null)));
  if (authentication !== "unauthorized") assert.equal(requests.filter(request => request.method === "DELETE").length, 1, "native close terminates its admitted HTTP session after retirement");
  assert.equal(await readFile(join(f.agent, "mcp-auth.json"), "utf8"), sentinel);
  assert.equal(existsSync(join(f.agent, "brabbler", "mcp")), false);
  assert.equal(existsSync(join(f.agent, "mcp.log")), false);
});

test("applying native tools to an idle session does not wait for an unrelated busy wrapper", { timeout: 5000 }, async t => {
  const f = await fixture(t), idle = await f.start(["read"]), other = await f.start(["read"]);
  await idle.waitUntilReady(); await other.waitUntilReady();
  Object.defineProperty(other.inner, "isStreaming", { configurable: true, value: true });
  try {
    assert.equal(other.isRunning(), true);
    const replacement = f.track((await rpc.setRpcSessionNativeResources(idle.sessionId, undefined, on)).session);
    assert.equal(other.isAlive(), true); assert.equal(other.isRunning(), true);
    assert.match(text(await script(replacement, "return 42")), /42/);
  } finally { delete other.inner.isStreaming; }
});

test("native replacement waits for this session's unpublished startup and replaces its old authority", { timeout: 10000 }, async t => {
  const f = await fixture(t), original = await f.start(["read"], on);
  await original.waitUntilReady(); await script(original, "return 42");
  const id = original.sessionId, file = original.sessionFile;
  assert.equal(existsSync(file), true); await original.shutdown();
  let entered, release;
  const reached = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  f.release(release);
  globalThis.__nativeFixtureEntered = entered; globalThis.__nativeFixtureWait = () => gate;
  await mkdir(join(f.agent, "extensions"), { mode: 0o700 });
  await writeFile(join(f.agent, "extensions/slow.js"), 'export default async function(){globalThis.__nativeFixtureEntered();await globalThis.__nativeFixtureWait();}');
  const starting = f.operation(rpc.startRpcSession(id, file, undefined).then(result => { f.track(result.session); return result; }));
  let changing;
  try {
    await Promise.race([reached, delay(3000).then(() => { throw new Error("synthetic startup gate did not run"); })]);
    assert.equal(rpc.getRpcSession(id)?.isAlive() ?? false, false);
    let applied = false;
    changing = f.operation(rpc.setRpcSessionNativeResources(id, file, off).then(result => { applied = true; f.track(result.session); return result; }));
    await delay(25); assert.equal(applied, false);
    release();
    const previous = (await starting).session, next = (await changing).session;
    assert.notEqual(next, previous); assert.equal(previous.isAlive(), false);
    await next.waitUntilReady(); assert.equal(next.hasNativeSessionTools(), false);
    assert.deepEqual((await next.send({ type: "get_state" })).nativeResources, off);
  } finally {
    release();
    await Promise.allSettled([starting, changing]);
    delete globalThis.__nativeFixtureEntered; delete globalThis.__nativeFixtureWait;
  }
});

test("an installed native factory cannot gain admission through a colliding tool name", async t => {
  const f = await fixture(t);
  await mkdir(join(f.agent, "extensions"), { mode: 0o700 });
  await writeFile(join(f.agent, "extensions/impostor.js"), `import {createCodemodeExtension} from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-coding-agent"))}; export default createCodemodeExtension();`);
  const wrapper = await f.start(["read"], on); await wrapper.waitUntilReady();
  assert.ok(wrapper.inner.resourceLoader.getExtensions().extensions.some(extension => extension.path.endsWith("impostor.js")), "the installed collision fixture must actually load");
  const result = await wrapper.inner.extensionRunner.emitToolCall({ type: "tool_call", toolName: "codemode", toolCallId: "synthetic-collision", input: { code: "return 42" } });
  assert.equal(result?.block, true); assert.match(result.reason, /not admitted/);
  await assert.rejects(script(wrapper, "return 42"), /not admitted/);
});

for (const duringShutdown of [false, true]) test(`native destruction ${duringShutdown ? "during shutdown" : "directly"} blocks same-ID reopening until settlement`, { timeout: 10000 }, async t => {
  const f = await fixture(t), original = await f.start(["read"], on);
  await original.waitUntilReady(); await script(original, "return 42");
  const id = original.sessionId, file = original.sessionFile, runner = original.inner.extensionRunner, emit = runner.emit.bind(runner);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), reached = new Promise(resolve => { entered = resolve; });
  runner.emit = async event => { if (event.type === "session_shutdown") { entered(); await gate; } return emit(event); };
  f.release(release);
  let shutting, opening;
  try {
    shutting = duringShutdown ? f.operation(original.shutdown()) : undefined;
    if (!duringShutdown) original.destroy();
    await reached;
    if (duringShutdown) original.destroy();
    let reopened = false;
    opening = f.operation(rpc.startRpcSession(id, file, undefined).then(result => { reopened = true; f.track(result.session); return result; }));
    await delay(25); assert.equal(reopened, false);
    release();
    const replacement = (await opening).session;
    await shutting;
    assert.notEqual(replacement, original); assert.equal(original.isAlive(), false);
    assert.match(text(await script(replacement, "return 42")), /42/);
  } finally {
    release();
    await Promise.allSettled([shutting, opening]);
    await original.shutdown();
  }
});

test("native reload is explicit wrapper replacement, never an SDK in-place generation", async t => {
  const f = await fixture(t), wrapper = await f.start(["read"], on); await wrapper.waitUntilReady();
  const definition = nativeDefinition(wrapper, "codemode"), context = wrapper.inner.extensionRunner.createToolContext();
  await assert.rejects(wrapper.send({ type: "reload" }), /idle session replacement/);
  const replacement = f.track((await rpc.setRpcSessionNativeResources(wrapper.sessionId, undefined, on)).session);
  assert.equal(wrapper.isAlive(), false);
  await assert.rejects(async () => definition.execute("stale", { code: "return 42" }, undefined, undefined, context), /retired/);
  assert.match(text(await script(replacement, "return 42")), /42/);
});

test("preset recreation never auto-activates hidden or deferred/codemode-alias definitions", () => {
  const fake = { settingsManager: { getDefaultTools: () => ["read"] }, getAllTools: () =>
    ["hidden", "deferred", "codemode", "direct", "model-only"].map(exposure => ({ name: exposure, exposure })) };
  assert.deepEqual(rpc.withExtensionTools(fake, ["read"]), ["read", "direct", "model-only"]);
});

test("retired native tool definitions reject late execution before starting another worker", async t => {
  const f = await fixture(t), wrapper = await f.start(["read"], on);
  await wrapper.waitUntilReady(); const definition = nativeDefinition(wrapper, "codemode"), context = wrapper.inner.extensionRunner.createToolContext();
  await wrapper.shutdown();
  await assert.rejects(async () => definition.execute("late", { code: "return 42" }, undefined, undefined, context), /retired/);
});

function boundaryDeferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function boundaryAwait(t, promise) {
  if (t.signal.aborted) return Promise.reject(t.signal.reason);
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(t.signal.reason ?? new Error("Native boundary test aborted"));
    t.signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => t.signal.removeEventListener("abort", onAbort));
}
// Observe real Worker constructors/exits without changing queue or termination.
// The SDK imports Worker by name; sync also covers its already-loaded ESM binding.
// Cases remain serial because this observer changes a process-local builtin.
function observeBoundaryWorkers(tag) {
  const threads = createRequire(import.meta.url)("node:worker_threads"), Original = threads.Worker, records = [];
  threads.Worker = class extends Original {
    constructor(filename, options) {
      super(filename, options);
      const code = options?.workerData?.code;
      if (typeof code !== "string" || !code.includes(tag)) return;
      const exit = boundaryDeferred(), record = { code, exited: false, exit: exit.promise };
      records.push(record);
      this.once("exit", () => { record.exited = true; exit.resolve(); });
    }
  };
  syncBuiltinESMExports();
  return { records, async joinExits() { for (const record of records) await record.exit; },
    restore() { threads.Worker = Original; syncBuiltinESMExports(); } };
}
function boundaryAssistant(value) {
  return { role: "assistant", content: [{ type: "text", text: value }], provider: "fixture", api: "fixture", model: "fixture",
    stopReason: "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
}

for (const mode of ["release", "caller-abort", "retire"]) test(`real codemode queue: ${mode} retains owner admission`, { timeout: 15000 }, async t => {
  const f = await fixture(t), tag = `pi14-queue-${randomUUID()}`, key = `__${tag.replaceAll("-", "_")}`;
  const previousCapacity = process.env.PI_CODEMODE_MAX_WORKERS;
  process.env.PI_CODEMODE_MAX_WORKERS = "2"; // The default, not increased test capacity.
  const workers = observeBoundaryWorkers(tag), wrappers = [], work = [];
  const own = promise => { const tracked = f.operation(promise); work.push(tracked); return tracked; };
  const slots = new Map(["first", "second"].map(slot => [slot, { entered: boundaryDeferred(), release: boundaryDeferred(), calls: 0 }]));
  const controllers = [new AbortController(), new AbortController(), new AbortController()];
  const shutdownEntered = boundaryDeferred(), shutdownRelease = boundaryDeferred();
  let runner, originalEmit;
  const releaseAll = () => {
    for (const controller of controllers) controller.abort(new Error("Synthetic boundary fixture cleanup"));
    for (const slot of slots.values()) slot.release.resolve();
    shutdownRelease.resolve();
  };
  f.release(releaseAll);
  globalThis[key] = { hold(slot) {
    const state = slots.get(slot); assert.ok(state);
    return own((async () => {
      state.calls++; assert.equal(state.calls, 1); state.entered.resolve(); await state.release.promise;
      return { content: [{ type: "text", text: `SYNTHETIC_HELD_${slot}` }], details: {} };
    })());
  } };
  try {
    await mkdir(join(f.agent, "extensions"), { mode: 0o700 });
    await writeFile(join(f.agent, "extensions/native-boundary-hold.js"), `export default function(pi) {
      pi.registerTool({name:"pi14_boundary_hold",label:"Synthetic worker hold",description:"Synthetic fixture gate",
        parameters:{type:"object",properties:{slot:{type:"string",enum:["first","second"]}},required:["slot"],additionalProperties:false},
        execute(_id,input){return globalThis[${JSON.stringify(key)}].hold(input.slot);}});
    }`);
    for (let index = 0; index < 3; index++) {
      const wrapper = await f.start(["read"], on); wrappers.push(wrapper); await wrapper.waitUntilReady();
      assert.deepEqual(wrapper.inner.resourceLoader.getExtensions().errors, []);
      assert.ok(wrapper.inner.getActiveToolNames().includes("pi14_boundary_hold"));
    }
    const [first, second, queuedWrapper] = wrappers;
    const firstCode = `/* ${tag}:first */\nreturn await tools.pi14_boundary_hold({slot:"first"})`;
    const secondCode = `/* ${tag}:second */\nreturn await tools.pi14_boundary_hold({slot:"second"})`;
    // Existing context guards already deny new nested tools during shutdown.
    // Isolate late real-worker/pure-script admission, not an external-effect bypass.
    const queuedCode = `/* ${tag}:queued */\nreturn "SYNTHETIC_QUEUED_SCRIPT_RAN"`;
    const firstCall = own(script(first, firstCode, { signal: controllers[0].signal }));
    own(script(second, secondCode, { signal: controllers[1].signal }));
    await boundaryAwait(t, Promise.all([...slots.values()].map(slot => slot.entered.promise)));
    assert.equal(workers.records.length, 2, "two genuine workers reached nested gates");
    assert.ok(workers.records.every(record => !record.exited));
    const published = boundaryDeferred(); let queuedSettled = false;
    const queued = own(script(queuedWrapper, queuedCode, { signal: controllers[2].signal,
      // Reviewed SDK publication is synchronous immediately before reserving a slot.
      onUpdate() { published.resolve(); },
    }).then(value => ({ value }), error => ({ error })).then(outcome => { queuedSettled = true; return outcome; }));
    await boundaryAwait(t, published.promise);
    assert.equal(queuedSettled, false); assert.equal(workers.records.length, 2);
    if (mode === "retire") {
      runner = queuedWrapper.inner.extensionRunner; originalEmit = runner.emit;
      runner.emit = async function(event) {
        if (event.type === "session_shutdown") { shutdownEntered.resolve(); await shutdownRelease.promise; }
        return Reflect.apply(originalEmit, this, [event]);
      };
      own(queuedWrapper.shutdown());
      await boundaryAwait(t, shutdownEntered.promise);
      await assert.rejects(script(queuedWrapper, "return 0"), /retired|not admitted/);
    } else if (mode === "caller-abort") controllers[2].abort(new Error("Synthetic queued caller cancelled"));
    // Free a different wrapper's slot while retirement's SDK shutdown remains held.
    slots.get("first").release.resolve();
    const outcome = await boundaryAwait(t, queued);
    if (mode === "release") {
      assert.equal(outcome.error, undefined); assert.notEqual(outcome.value.isError, true, text(outcome.value));
      assert.match(text(outcome.value), /SYNTHETIC_QUEUED_SCRIPT_RAN/);
      assert.equal(workers.records.filter(record => record.code === queuedCode).length, 1);
    } else {
      if (outcome.error) assert.match(String(outcome.error), /abort|cancel|retir/i);
      else {
        assert.equal(outcome.value.isError, true, text(outcome.value));
        assert.match(text(outcome.value), /abort|cancel|retir/i);
        assert.deepEqual(outcome.value.details.calls, []);
        assert.doesNotMatch(text(outcome.value), /SYNTHETIC_QUEUED_SCRIPT_RAN/);
      }
      assert.equal(workers.records.some(record => record.code === queuedCode), false, "cancelled/retired queue never launches");
    }
    const firstResult = await boundaryAwait(t, firstCall);
    assert.notEqual(firstResult.isError, true, text(firstResult));
    await boundaryAwait(t, workers.records.find(record => record.code === firstCode).exit);
    assert.equal(workers.records.find(record => record.code === secondCode).exited, false, "unrelated worker stays alive");
  } finally {
    releaseAll();
    try {
      await Promise.allSettled(work);
      await Promise.allSettled(wrappers.map(wrapper => wrapper.shutdown()));
      await workers.joinExits(); // Results/shutdown alone are not worker-exit proof.
      assert.ok(workers.records.every(record => record.exited));
    } finally {
      if (runner && originalEmit) runner.emit = originalEmit;
      workers.restore(); delete globalThis[key];
      if (previousCapacity === undefined) delete process.env.PI_CODEMODE_MAX_WORKERS; else process.env.PI_CODEMODE_MAX_WORKERS = previousCapacity;
    }
  }
});

for (const ingress of ["rpc", "extension-command"]) test(`explicit builtin pin survives ${ingress} tree restoration`, { timeout: 15000 }, async t => {
  const f = await fixture(t), tag = `pi14-nav-${randomUUID()}`, key = `__${tag.replaceAll("-", "_")}`;
  const workers = observeBoundaryWorkers(tag), work = [], controller = new AbortController();
  const own = promise => { const tracked = f.operation(promise); work.push(tracked); return tracked; };
  f.release(() => controller.abort(new Error("Synthetic navigation fixture cleanup")));
  const builtinNames = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);
  const builtins = wrapper => wrapper.inner.getActiveToolNames().filter(name => builtinNames.has(name)).sort();
  const commands = []; globalThis[key] = commands; let wrapper;
  try {
    await mkdir(join(f.agent, "extensions"), { mode: 0o700 });
    await writeFile(join(f.agent, "extensions/native-boundary-navigation.js"), `export default function(pi) {
      pi.registerCommand("pi14_boundary_nav", {description:"Synthetic tree navigation fixture",async handler(args,ctx) {
        try { const result=await ctx.navigateTree(args.trim(),{summarize:false});globalThis[${JSON.stringify(key)}].push({result}); }
        catch(error) { globalThis[${JSON.stringify(key)}].push({error:String(error)});throw error; }
      }});
    }`);
    wrapper = await f.start(["read", "write"], on); await wrapper.waitUntilReady();
    assert.deepEqual(wrapper.inner.resourceLoader.getExtensions().errors, []);
    assert.ok(wrapper.inner.extensionRunner.getCommand("pi14_boundary_nav"));
    assert.deepEqual(builtins(wrapper), ["read", "write"]);
    const manager = wrapper.inner.sessionManager;
    manager.appendMessage({ role: "system", content: "Synthetic broad-loadout checkpoint", timestamp: Date.now(),
      toolsAdded: wrapper.inner.agent.state.tools.map(tool => ({ name: tool.name, description: tool.description,
        parameters: JSON.parse(JSON.stringify(tool.parameters)) })),
    });
    const targetId = manager.appendMessage(boundaryAssistant("Synthetic earlier broad branch"));
    const changed = await own(rpc.setRpcSessionTools(wrapper.sessionId, wrapper.sessionFile, ["read"]));
    assert.equal(changed.session, wrapper); assert.equal(changed.recreated, false); assert.deepEqual(builtins(wrapper), ["read"]);
    manager.appendMessage({ role: "system", content: "", timestamp: Date.now(), toolsRemoved: [{ name: "write" }] });
    manager.appendMessage(boundaryAssistant("Synthetic current read-only branch"));
    wrapper.inner.refreshContext(); assert.notEqual(manager.getLeafId(), targetId);
    if (ingress === "rpc") {
      assert.equal((await own(wrapper.send({ type: "navigate_tree", targetId }))).cancelled, false);
      assert.deepEqual(commands, []);
    } else {
      await own(wrapper.inner.prompt(`/pi14_boundary_nav ${targetId}`));
      assert.equal(commands.length, 1, "real extension command completed");
      assert.equal(commands[0].error, undefined); assert.equal(commands[0].result.cancelled, false);
    }
    assert.equal(manager.getLeafId(), targetId);
    const restored = builtins(wrapper), forbidden = join(f.cwd, "pi14-navigation-forbidden.txt");
    const denied = await own(script(wrapper, `/* ${tag}:denied */\nreturn await tools.write({path:"pi14-navigation-forbidden.txt",content:"SYNTHETIC_UNWANTED_NAVIGATION_WRITE"})`, { signal: controller.signal }));
    // Test actual execution before the loadout assertion: the red proves an effect.
    assert.deepEqual({ builtins: restored, isError: denied.isError === true, wrote: existsSync(forbidden) },
      { builtins: ["read"], isError: true, wrote: false }, text(denied));
    const allowed = await own(script(wrapper, `/* ${tag}:allowed */\nreturn await tools.read({path:"note.txt"})`, { signal: controller.signal }));
    assert.notEqual(allowed.isError, true, text(allowed)); assert.match(text(allowed), /SYNTHETIC_NATIVE_READ/);
    assert.equal(workers.records.length, 2, "both native probes used genuine observed workers");
  } finally {
    controller.abort(new Error("Synthetic navigation fixture cleanup"));
    try {
      await Promise.allSettled(work);
      if (wrapper) await wrapper.shutdown();
      await workers.joinExits();
      assert.ok(workers.records.every(record => record.exited));
    } finally { workers.restore(); delete globalThis[key]; }
  }
});
