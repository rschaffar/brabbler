import '../lib/testing/client-native-boundary.fixture.mjs';
// UNEXECUTED additive candidate. Original useAgentSession.test.mjs stays intact.
import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture, command, detail } from "./agent-session-mounted.fixture.mjs";
const options = { timeout: 10000 };
const off = { version: 1, codeMode: false, mcpServers: [] };
const native = { version: 1, codeMode: true, mcpServers: [{ scope: "project", name: "project_native" }, { scope: "global", name: "global-native" }] };
const normalized = { ...native, mcpServers: [...native.mcpServers].reverse() };
const ok = data => ({ success: true, data });
const active = f => f.sources.filter(source => source.readyState !== 2);
const commands = f => f.requests.filter(request => request.method === "POST" && /^\/api\/agent\/[^/]+$/.test(request.path));
const tools = names => names.map(name => ({ name, active: true, description: name }));

for (const selection of [off, native]) test(`resources: fresh explicit ${selection.codeMode ? "native" : "off"} is in ensure, not a post-start mutation`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  let actual;
  await f.run("native override including ensure/state/tools/finally", async value => { actual = await value.handleNativeResourcesChange(selection); });
  await f.settleMaintenance();
  const creation = f.requests.find(request => request.path === "/api/agent/new");
  assert.deepEqual(creation.body.nativeResources, selection.codeMode ? normalized : off);
  assert.deepEqual(actual, selection.codeMode ? normalized : off);
  assert.equal(commands(f).some(command("set_native_resources")), false);
  assert.equal(commands(f).some(command("prompt")), false);
  assert.equal(f.promotions.length, 0);
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  assert.equal(f.current.systemPrompt, `system:${f.savedId}`);
});

test("resources: in-flight ensure is refused without borrowing its identity or native defaults", options, async t => {
  const f = await sessionFixture(t);
  const gate = f.hold(request => request.path === "/api/agent/new");
  await f.mountReady();
  const initializing = await f.start("ordinary lazy ensure", value => value.loadSlashCommands());
  await gate.entered.promise;
  await f.run("native busy refusal", value => value.handleNativeResourcesChange(off), { rejects: /./ });
  assert.equal(f.requests.filter(request => request.path === "/api/agent/new").length, 1);
  assert.equal(Object.hasOwn(gate.request.body, "nativeResources"), false);
  assert.equal(commands(f).some(command("set_native_resources")), false);
  await f.finish(initializing, () => gate.resolve({ sessionId: f.savedId }));
  await f.settleMaintenance();
});

test("resources: selected native replacement retains exact ID/transcript/draft and refreshes real state/tools before reconnect", options, async t => {
  const f = await sessionFixture(t), row = f.record(f.savedId), observedTools = [];
  row.messages = [{ role: "user", content: "original", timestamp: 1 }]; row.entryIds = ["first-user"];
  await f.mountReady({ ...f.existingOptions(), onSystemToolsChange: value => observedTools.push(value) });
  f.setDraft(f.savedId, { value: "literal unsent", images: [] });
  const original = active(f)[0], before = f.current.messages;
  const state = f.hold(command("get_state")), toolRead = f.hold(command("get_tools"));
  const replacing = await f.start("actual native replacement", value => value.handleNativeResourcesChange(native));
  await Promise.all([state.entered.promise, toolRead.entered.promise]);
  assert.equal(original.readyState, 2);
  await f.run("overlapping native admission refused", value => value.handleNativeResourcesChange(off), { rejects: /./ });
  await f.finish(replacing, () => {
    state.resolve(ok({ ...f.live(f.savedId), systemPrompt: "reloaded exact native prompt" }));
    toolRead.resolve(ok(tools(["read"])));
  });
  await f.connect(active(f)[0]); await f.settleMaintenance();
  assert.deepEqual(f.requests.find(command("set_native_resources")).body, { type: "set_native_resources", nativeResources: normalized });
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  assert.deepEqual(f.current.data.nativeResources, normalized);
  assert.equal(f.current.messages === before, true, "no transcript replacement on Apply");
  assert.deepEqual(f.current.entryIds, ["first-user"]);
  assert.equal(f.getDraft(f.savedId).value, "literal unsent");
  assert.equal(f.current.systemPrompt, "reloaded exact native prompt");
  assert.deepEqual(observedTools.at(-1), tools(["read"]));
  assert.equal(active(f).length, 1);
});

for (const outcome of ["lost ack", "changed ID"]) test(`resources: ${outcome} reconciles metadata only and never retries native mutation`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const before = f.current.messages;
  const mutation = f.hold(command("set_native_resources"));
  const repair = f.hold(request => detail(request) && request.query.get("tail") === "1");
  const live = f.hold(request => request.method === "GET" && request.query.get("tools") === "1");
  const operation = await f.start("uncertain native result including metadata repairs", value => value.handleNativeResourcesChange(native), { rejects: /./ });
  await mutation.entered.promise;
  await f.deliver(mutation, outcome === "lost ack" ? { error: "uncertain native acknowledgement" } : ok({ sessionId: `${f.savedId}-not-the-source`, nativeResources: native }));
  await repair.entered.promise;
  assert.equal(repair.request.path, `/api/sessions/${f.savedId}`);
  await f.deliver(repair, f.snapshot(f.savedId, { nativeResources: off }));
  await live.entered.promise;
  assert.equal(live.request.path, `/api/agent/${f.savedId}`);
  await f.finish(operation, () => live.resolve({ running: true, state: { ...f.live(f.savedId), systemPrompt: "confirmed repair only" }, tools: tools(["read"]) }));
  await f.connect(active(f)[0]); await f.settleMaintenance();
  assert.equal(f.requests.filter(command("set_native_resources")).length, 1);
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  assert.deepEqual(f.current.data.nativeResources, off);
  assert.equal(f.current.messages === before, true);
  assert.equal(f.current.systemPrompt, "confirmed repair only");
});

test("resources: keyed native completion after A/B/A cannot publish into new A or reopen old source", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const mutation = f.hold(command("set_native_resources"));
  const operation = await f.start("outgoing native command", value => value.handleNativeResourcesChange(native), { rejects: /./ });
  await mutation.entered.promise;
  await f.mountReady(f.existingOptions(`${f.savedId}-B`));
  await f.mountReady(f.existingOptions());
  const count = f.sources.length;
  await f.finish(operation, () => mutation.resolve(ok({ sessionId: f.savedId, nativeResources: normalized })));
  assert.equal(f.sources.length, count);
  assert.equal(f.current.data.nativeResources, undefined);
  assert.equal(f.requests.some(request => request.query.get("tools") === "1"), false);
});

test("resources: System loader is registered, lazy, non-promoting and unregistered on actual unmount", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  assert.equal(typeof f.loader, "function");
  assert.equal(f.requests.some(request => request.path === "/api/agent/new"), false);
  await f.run("registered actual System action", () => f.loader());
  await f.settleMaintenance();
  assert.equal(f.current.systemPrompt, `system:${f.savedId}`);
  assert.equal(commands(f).some(command("get_state")), true);
  assert.equal(commands(f).some(command("get_tools")), true);
  assert.equal(commands(f).some(command("prompt")), false);
  assert.equal(f.promotions.length, 0);
  await f.unmount();
  assert.equal(f.loader, null);
});

for (const [preset, names] of [["configured", undefined], ["none", []], ["read-only", ["read", "grep", "find", "ls"]], ["default", ["read", "bash", "edit", "write"]], ["full", ["bash", "read", "edit", "write", "grep", "find", "ls"]]]) {
  test(`tools: fresh ${preset} preference is captured before ensure, omitted only when configured`, options, async t => {
    const f = await sessionFixture(t, { preset });
    await f.mountReady();
    assert.equal(f.current.toolPreset, preset);
    await f.run("lazy startup reads hydrated tool preference", value => value.loadSlashCommands());
    await f.settleMaintenance();
    const request = f.requests.find(request => request.path === "/api/agent/new");
    assert.equal(Object.hasOwn(request.body, "toolNames"), names !== undefined);
    if (names !== undefined) assert.deepEqual(request.body.toolNames, names);
  });
}

for (const pinned of [false, true]) test(`tools: existing disk/live ${pinned ? "pinned" : "configured"} never borrows or rewrites fresh preference`, options, async t => {
  const f = await sessionFixture(t, { preset: "none" }), row = f.record(f.savedId);
  row.running = true; row.tools = tools(["read", "grep", "find", "ls"]);
  if (pinned) row.toolNames = ["read", "grep", "find", "ls"];
  await f.mountReady(f.existingOptions());
  assert.equal(f.current.toolPreset, pinned ? "read-only" : "configured");
  assert.equal(f.view.window.localStorage.getItem("brabbler-tool-preset"), "none");
  await f.run("existing prompt does not reapply tools", value => value.handleSend("literal persisted selection"));
  assert.deepEqual(f.requests.find(command("prompt")).body, { type: "prompt", message: "literal persisted selection" });
  assert.equal(f.requests.some(command("set_tools")), false);
});

test("tools: concrete change pins exact read-only list and publishes current live tools without changing selected ID", options, async t => {
  const f = await sessionFixture(t), row = f.record(f.savedId);
  row.tools = tools(["read", "grep", "find", "ls"]);
  await f.mountReady(f.existingOptions());
  await f.run("concrete tool change", value => value.handleToolPresetChange("read-only"));
  assert.deepEqual(f.requests.find(command("set_tools")).body, { type: "set_tools", toolNames: ["read", "grep", "find", "ls"] });
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  assert.equal(f.current.toolPreset, "read-only");
  assert.equal(f.view.window.localStorage.getItem("brabbler-tool-preset"), "read-only");
});

for (const sameId of [true, false]) test(`tools: recreated ${sameId ? "same" : "different"} ID drives actual subsequent commands and selected reconnect`, options, async t => {
  const f = await sessionFixture(t, { preset: "none" });
  await f.mountReady(f.existingOptions());
  const nextId = sameId ? f.savedId : `${f.savedId}-replacement`, original = active(f)[0];
  f.declareSession(nextId).tools = tools(["read", "grep", "find", "ls"]);
  const gate = f.hold(command("set_tools"));
  const operation = await f.start("configured retracts pin and rebuilds", value => value.handleToolPresetChange("configured"));
  await gate.entered.promise;
  assert.deepEqual(gate.request.body, { type: "set_tools" });
  assert.equal(f.view.window.localStorage.getItem("brabbler-tool-preset"), "configured");
  const after = f.requests.length;
  await f.finish(operation, () => gate.resolve(ok({ sessionId: nextId, recreated: true })));
  assert.equal(original.readyState, 2);
  assert.equal(f.current.sessionIdRef.current, nextId);
  assert.equal(f.requests.slice(after).filter(request => command("get_state")(request) || command("get_tools")(request)).every(request => request.path === `/api/agent/${nextId}`), true);
  if (sameId) { assert.equal(active(f).length, 1); await f.connect(active(f)[0]); }
  else assert.equal(active(f).length, 0, "not the selected prop ID: don't invent a warm lease");
  await f.settleMaintenance();
  assert.equal(f.current.toolPreset, "configured");
});

test("navigation: mount alone forces disk probing; wrapperRebuilt replaces the actual stream", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const original = active(f)[0];
  const reload = f.hold(detail);
  const operation = await f.start("ordinary canonical reload", value => value.handleBuiltinSlashCommand("/name literal"));
  await reload.entered.promise;
  assert.equal(reload.request.query.has("force"), false);
  await f.finish(operation, () => reload.resolve(f.snapshot(f.savedId, { wrapperRebuilt: true })));
  assert.equal(original.readyState, 2);
  await f.connect(active(f)[0]); await f.settleMaintenance();
  assert.equal(f.requests.filter(detail).filter(request => request.query.get("force") === "1").every(request => request.query.get("tree") === "summary"), true);
});

for (const busy of ["prompt", "bash", "compaction"]) test(`fork: first-user exact entry remains independently available during ${busy}`, options, async t => {
  const f = await sessionFixture(t), row = f.record(f.savedId), forks = [];
  row.messages = [{ role: "user", content: "first user", timestamp: 1 }]; row.entryIds = ["first-user"];
  await f.mountReady({ ...f.existingOptions(), onSessionForked: sid => forks.push(sid) });
  const source = active(f)[0]; let bash, bashGate;
  if (busy === "prompt") await f.run("start source prompt", value => value.handleSend("source still running"));
  if (busy === "bash") { bashGate = f.hold(command("bash")); bash = await f.start("source shell", value => value.handleSend("!!printf source")); await bashGate.entered.promise; }
  if (busy === "compaction") await f.event(source, { type: "compaction_start" });
  const gate = f.hold(command("fork"));
  const operation = await f.start("fork before exact first user", value => value.handleFork("first-user"));
  await gate.entered.promise;
  assert.deepEqual(gate.request.body, { type: "fork", entryId: "first-user" });
  assert.equal(f.current.forkingEntryId, "first-user");
  await f.finish(operation, () => gate.resolve(ok({ newSessionId: `${f.savedId}-independent-child` })));
  assert.deepEqual(forks, [`${f.savedId}-independent-child`]);
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  assert.equal(source.readyState, 1);
  assert.equal(f.requests.some(request => ["abort", "abort_bash", "navigate_tree"].includes(request.body?.type)), false);
  assert.equal(f.current.forkingEntryId, null);
  if (bash) await f.finish(bash, () => bashGate.resolve(ok({})));
});

for (const cancelled of [false, true]) test(`navigation: exact first-user target, fresh canonical reload and cancellation ${cancelled}`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const gate = f.hold(command("navigate_tree")); let result;
  const before = f.requests.filter(detail).length;
  const operation = await f.start("navigate before first user", async value => { result = await value.handleNavigate("first-user"); });
  await gate.entered.promise;
  assert.deepEqual(gate.request.body, { type: "navigate_tree", targetId: "first-user" });
  await f.finish(operation, () => gate.resolve(ok({ cancelled })));
  assert.equal(result, !cancelled);
  assert.equal(f.requests.filter(detail).length, before + (cancelled ? 0 : 1));
  assert.equal(f.requests.filter(detail).slice(before).every(request => !request.query.has("force")), true);
});

for (const busy of ["idle", "prompt", "bash"]) test(`clone: current branch leaf and independent callback; ${busy} guard`, options, async t => {
  const f = await sessionFixture(t), forks = [], row = f.record(f.savedId);
  row.leaf = "saved-response-leaf";
  await f.mountReady({ ...f.existingOptions(), onSessionForked: sid => forks.push(sid) });
  let bash, bashGate;
  if (busy === "prompt") await f.run("running prompt", value => value.handleSend("running"));
  if (busy === "bash") { bashGate = f.hold(command("bash")); bash = await f.start("running shell", value => value.handleSend("!printf source")); await bashGate.entered.promise; }
  let result;
  if (busy === "idle") {
    const gate = f.hold(command("clone"));
    const operation = await f.start("actual builtin clone", async value => { result = await value.handleBuiltinSlashCommand("/clone"); });
    await gate.entered.promise;
    assert.deepEqual(gate.request.body, { type: "clone", leafId: "saved-response-leaf" });
    await f.finish(operation, () => gate.resolve(ok({ newSessionId: `${f.savedId}-clone` })));
    assert.deepEqual(forks, [`${f.savedId}-clone`]);
    assert.equal(result.message, "Cloned current session branch");
  } else {
    await f.run("busy clone refusal", async value => { result = await value.handleBuiltinSlashCommand("/clone"); });
    assert.equal(result.error, "Cannot clone while the session is running");
    assert.equal(f.requests.some(command("clone")), false);
    assert.deepEqual(forks, []);
  }
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  if (bash) await f.finish(bash, () => bashGate.resolve(ok({})));
});
