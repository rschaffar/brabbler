import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { sessionFixture, command, detail } from "./agent-session-mounted.fixture.mjs";
import { policyClockFixture } from "./agent-session-clock.fixture.mjs";
const options = { timeout: 10000 };
const stateRead = f => request => request.method === "GET" && request.path === `/api/agent/${f.savedId}`;
const active = f => f.sources.find(source => source.readyState !== 2);
const begin = f => f.event(active(f), { type: "compaction_start" });
const end = f => f.event(active(f), { type: "compaction_end", aborted: true });
const online = f => f.view.dispatch(f.view.window, new f.view.window.Event("online"));
const visible = f => f.view.dispatch(f.view.window.document, new f.view.window.Event("visibilitychange"));
async function ready(t, extra = {}) {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time, ...extra });
  await f.mountReady(f.existingOptions());
  return { f, time };
}

for (const mobile of [false, true]) test(`actual composer compaction live region is independent of streaming/More and busy ancestor (${mobile ? "mobile" : "desktop"})`, options, async t => {
  const { f } = await ready(t, { composer: true, mobile });
  const status = () => f.view.container.querySelector('[data-testid="compaction-status"]');
  assert.equal(status() === null, true);
  const compact = f.hold(command("compact"));
  await act(async () => { f.composerRef.current.insertText("/compact"); });
  await f.view.dispatch(f.view.container.querySelector("textarea"), new f.view.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: mobile, bubbles: true }));
  await compact.entered.promise;
  const node = status(), field = f.view.container.querySelector("fieldset");
  assert.equal(node !== null, true);
  assert.equal(node.getAttribute("role"), "status");
  assert.equal(node.getAttribute("aria-live"), "polite");
  assert.equal(node.getAttribute("aria-atomic"), "true");
  assert.equal(node.querySelector('[aria-hidden="true"]') !== null, true);
  assert.equal(node.querySelector('[role="progressbar"], [aria-valuenow]') === null, true);
  assert.equal(node.textContent.includes("Compacting conversation"), true);
  assert.equal(node.textContent.toLowerCase().includes("summar"), true);
  assert.equal(field.disabled, true, "actual ChatInput /compact handler is pending");
  assert.equal(field.getAttribute("aria-busy"), "false", "live status is not hidden by pending builtin ownership");
  assert.equal(node.closest('[aria-busy="true"]') === null, true);
  await f.event(active(f), { type: "agent_start" });
  assert.equal(f.current.agentRunning, true);
  assert.equal(status() === node, true, "streaming does not replace/hide the existing status");
  await f.finish(f.composerOperation, () => compact.resolve({ success: true, data: { tokensBefore: 1000, estimatedTokensAfter: 500 } }));
  assert.equal(status() === null, true);
  // Stop the externally injected run with its real event before another builtin.
  await f.event(active(f), { type: "agent_settled" }); await f.settleMaintenance();
  const name = f.hold(command("set_session_name"));
  await act(async () => { f.composerRef.current.insertText("/name pending"); });
  await f.view.dispatch(f.view.container.querySelector("textarea"), new f.view.window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: mobile, bubbles: true }));
  await name.entered.promise;
  assert.equal(field.disabled, true);
  assert.equal(field.getAttribute("aria-busy"), "true", "ordinary pending builtin retains existing busy policy");
  await f.finish(f.composerOperation, () => name.resolve({ success: true, data: {} }));
  assert.equal(field.disabled, false);
});

test("compaction-only recovery uses exact 15s policy, visibility and online without manufacturing prompt completion", options, async t => {
  const time = policyClockFixture(), ended = [], f = await sessionFixture(t, { policyTime: time });
  await f.mountReady({ ...f.existingOptions(), onAgentEnd: () => ended.push("end") });
  assert.equal(time.intervals.filter(item => item.policy === "agent-state" && item.active).length, 0);
  await begin(f);
  const interval = time.intervals.find(item => item.policy === "agent-state" && item.active);
  assert.equal(interval.ms, 15000);
  const first = f.hold(stateRead(f));
  await act(async () => { time.advance(14999); });
  assert.equal(first.used, false);
  await act(async () => { time.advance(1); await first.entered.promise; });
  await f.deliver(first, { running: true, state: { isCompacting: true } }); await f.settleMaintenance();
  assert.equal(f.current.isCompacting, true);
  const second = f.hold(stateRead(f)); await visible(f); await second.entered.promise;
  await f.deliver(second, { running: true, state: { isCompacting: true } }); await f.settleMaintenance();
  const third = f.hold(stateRead(f)); await online(f); await third.entered.promise;
  await f.deliver(third, { running: false }); await f.settleMaintenance();
  assert.equal(f.current.isCompacting, false);
  assert.equal(f.current.agentRunning, false);
  assert.deepEqual(ended, []);
  assert.equal(interval.active, false);
  const count = f.requests.filter(stateRead(f)).length;
  await online(f); await visible(f); await act(async () => { time.advance(15000); });
  assert.equal(f.requests.filter(stateRead(f)).length, count, "idle recovery stops");
});

for (const boundary of ["session recreation", "new prompt"]) test(`late compaction recovery cannot cross ${boundary}`, options, async t => {
  const { f } = await ready(t);
  await begin(f); const read = f.hold(stateRead(f)); await online(f); await read.entered.promise;
  if (boundary === "session recreation") {
    const sid = `${f.savedId}-B`; f.declareSession(sid);
    const tools = f.hold(command("set_tools"));
    const change = await f.start("same-hook recreation", value => value.handleToolPresetChange("none"));
    await f.finish(change, () => tools.resolve({ success: true, data: { sessionId: sid, recreated: true } }));
    assert.equal(f.current.sessionIdRef.current, sid);
    await f.deliver(read, { running: false, state: { isCompacting: false } });
    await f.settleMaintenance(); assert.equal(f.current.isCompacting, true);
  } else {
    await end(f);
    await f.run("new actual prompt admission", value => value.handleSend("new prompt"));
    await f.deliver(read, { running: true, state: { isCompacting: true } });
    await f.settleMaintenance();
    assert.equal(f.current.isCompacting, false);
    assert.equal(f.current.agentRunning, true);
    assert.equal(f.current.messages.some(message => message.role === "user" && message.content === "new prompt"), true);
  }
});

for (const restart of [false, true]) test(`same-prompt phase identity ignores opposite late snapshot (${restart ? "A/B/A active" : "ended"})`, options, async t => {
  const { f } = await ready(t); await begin(f);
  const read = f.hold(stateRead(f)); await online(f); await read.entered.promise;
  await end(f); if (restart) await begin(f);
  await f.deliver(read, { running: true, state: { isCompacting: !restart } });
  await f.settleMaintenance(); assert.equal(f.current.isCompacting, restart);
});

for (const order of [[0, 1], [1, 0]]) test(`only newest recovery read applies (${order.join(" then ")})`, options, async t => {
  const { f } = await ready(t); await begin(f);
  const reads = [f.hold(stateRead(f)), f.hold(stateRead(f))];
  await online(f); await reads[0].entered.promise;
  await visible(f); await reads[1].entered.promise;
  for (const index of order) await f.deliver(reads[index], { running: true, state: { isCompacting: index === 0 } });
  await f.settleMaintenance(); assert.equal(f.current.isCompacting, false);
});

test("recovery teardown invalidates pending read and removes real online/visibility listeners", options, async t => {
  const { f, time } = await ready(t); await begin(f);
  const read = f.hold(stateRead(f)); await online(f); await read.entered.promise;
  const old = f.maintenanceHandle, count = f.requests.filter(stateRead(f)).length;
  await f.unmount(); await f.deliver(read, { running: true, state: { isCompacting: false } }); await f.settleMaintenance(old);
  await act(async () => {
    f.view.window.dispatchEvent(new f.view.window.Event("online"));
    f.view.window.document.dispatchEvent(new f.view.window.Event("visibilitychange")); time.advance(15000);
  });
  assert.equal(f.requests.filter(stateRead(f)).length, count);
  assert.equal(time.intervals.some(item => item.policy === "agent-state" && item.active), false);
});

for (const mode of ["manual", "slash"]) for (const phase of ["rpc-only", "own-sse", "superseded"]) for (const fails of [false, true]) {
  test(`${mode} compact ${fails ? "failure" : "success"} preserves ${phase} generation and canonical reload identity`, options, async t => {
    const { f } = await ready(t);
    await begin(f); const read = f.hold(stateRead(f)); await online(f); await read.entered.promise;
    await end(f);
    const rpc = f.hold(command("compact"), { stage: "headers" });
    const operation = await f.start("complete compact including canonical reload/finally", value => mode === "manual" ? value.handleCompact() : value.handleBuiltinSlashCommand("/compact"));
    await rpc.entered.promise;
    assert.equal(f.current.isCompacting, true);
    await f.deliver(read, { running: false, state: { isCompacting: false } }); await f.settleMaintenance();
    assert.equal(f.current.isCompacting, true, "pre-command read cannot clear manual admission");
    if (phase !== "rpc-only") { await begin(f); await end(f); }
    if (phase === "superseded") await begin(f);
    const before = f.requests.filter(detail).length;
    await f.finish(operation, () => fails ? rpc.reject(new Error("A failed")) : rpc.resolve({ success: true, data: { tokensBefore: 1000, estimatedTokensAfter: 500 } }));
    if (phase === "superseded") {
      assert.equal(f.current.isCompacting, true); assert.equal(f.current.compactResult, null); assert.equal(f.current.compactError, null);
      assert.equal(f.requests.filter(detail).length, before);
    } else {
      assert.equal(f.current.isCompacting, false);
      assert.equal(f.requests.filter(detail).length, before + (fails ? 0 : 1));
      assert.equal(f.current.compactResult?.tokensBefore ?? null, fails ? null : 1000);
      assert.equal(f.current.compactError, fails && mode === "manual" ? "A failed" : null);
      if (fails && mode === "slash") assert.equal(f.current.notices.some(notice => notice.message === "A failed"), true);
    }
  });
}

test("rejected /compact does not hide an already-active phase or dispatch another RPC", options, async t => {
  const { f } = await ready(t); await begin(f); const before = f.requests.filter(command("compact")).length;
  await f.run("refused slash compact", async value => { const result = await value.handleBuiltinSlashCommand("/compact"); assert.equal(typeof result.error, "string"); });
  assert.equal(f.current.isCompacting, true); assert.equal(f.requests.filter(command("compact")).length, before);
});

for (const ending of [false, true]) test(`initial mount state cannot overwrite newer compaction event (${ending ? "end" : "start"})`, options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  const state = f.hold(request => request.path === `/api/sessions/${f.savedId}/state`);
  await f.mount(f.existingOptions()); await f.connect(active(f)); await state.entered.promise;
  await begin(f); if (ending) await end(f);
  await f.deliver(state, { running: true, state: { isCompacting: ending } }); await f.settleMaintenance();
  assert.equal(f.current.isCompacting, !ending);
});

for (const legacy of [false, true]) for (const outcome of ["success", "cancelled", "error"]) test(`${legacy ? "legacy auto_" : "current "}compaction end ${outcome} owns canonical history completion`, options, async t => {
  const { f } = await ready(t), before = f.requests.filter(detail).length;
  const prefix = legacy ? "auto_compaction" : "compaction";
  await f.event(active(f), { type: `${prefix}_start` });
  assert.equal(f.current.isCompacting, true);
  const history = outcome === "success" ? f.hold(detail) : null;
  await f.event(active(f), { type: `${prefix}_end`, aborted: outcome === "cancelled",
    ...(outcome === "error" ? { errorMessage: "Compaction failed" } : {}),
    ...(outcome === "success" ? { result: { tokensBefore: 1000, estimatedTokensAfter: 500 } } : {}) });
  assert.equal(f.current.isCompacting, false);
  if (history) { await history.entered.promise; await f.deliver(history, f.snapshot(f.savedId)); }
  await f.settleMaintenance();
  assert.equal(f.requests.filter(detail).length, before + (history ? 1 : 0));
  assert.equal(f.current.compactResult?.tokensBefore ?? null, outcome === "success" ? 1000 : null);
  assert.equal(f.current.compactError, outcome === "error" ? "Compaction failed" : null);
});

for (const authoritative of [false, true, undefined]) test(`/auto-compact toggles authoritative ${String(authoritative)} state, not stale UI`, options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  // The real initial canonical/live load mirrors this field; System's lazy
  // prompt/tools loader does not. Start with UI opposite the later RPC authority.
  f.record(f.savedId).state = { autoCompactionEnabled: authoritative === false };
  await f.mountReady(f.existingOptions());
  assert.equal(f.current.autoCompactionEnabled, authoritative === false);
  const state = f.hold(command("get_state"));
  const toggle = await f.start("actual auto-compact builtin including both RPCs", value => value.handleBuiltinSlashCommand("/auto-compact"));
  const before = f.requests.filter(command("set_auto_compaction")).length;
  await f.finish(toggle, () => state.resolve({ success: true, data: authoritative === undefined ? {} : { autoCompactionEnabled: authoritative } }));
  const writes = f.requests.filter(command("set_auto_compaction")).slice(before);
  assert.deepEqual(writes.map(request => request.body), [{ type: "set_auto_compaction", enabled: !(authoritative ?? true) }]);
  assert.equal(f.current.autoCompactionEnabled, !(authoritative ?? true));
});

test("initial load and real recovery both mirror auto-compaction state", options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  f.record(f.savedId).state = { autoCompactionEnabled: false };
  await f.mountReady(f.existingOptions());
  assert.equal(f.current.autoCompactionEnabled, false);
  await begin(f);
  const state = f.hold(stateRead(f)); await online(f); await state.entered.promise;
  await f.deliver(state, { running: true, state: { isCompacting: true, autoCompactionEnabled: true } }); await f.settleMaintenance();
  assert.equal(f.current.autoCompactionEnabled, true);
});
