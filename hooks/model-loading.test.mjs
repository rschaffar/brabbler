import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { sessionFixture, models, command, provider, selected } from "./agent-session-mounted.fixture.mjs";
import { policyClockFixture } from "./agent-session-clock.fixture.mjs";
const options = { timeout: 10000 };
const reads = f => f.requests.filter(models);
const failureKinds = [
  ["transport", 200, "Failed to fetch"], ["HTTP JSON", 403, "Access denied"],
  ["HTTP non-JSON", 503, "Failed to load models (HTTP 503)"], ["invalid JSON", 200, "Invalid JSON"],
];
function fail(rule, kind) {
  if (kind === "HTTP JSON") rule.resolve({ error: "Access denied" });
  else rule.reject(kind === "transport" ? new TypeError("Failed to fetch") : new SyntaxError(kind === "invalid JSON" ? "Invalid JSON" : "not JSON"));
}

for (const [kind, status, message] of failureKinds) test(`mounted metadata: ${kind} stays visible through exactly four bounded effect attempts`, options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  await f.mountReady();
  const before = reads(f).length;
  const attempts = Array.from({ length: 4 }, () => f.hold(models, { stage: kind === "transport" ? "headers" : "body", status }));
  await f.rerender({ ...f.mountedOptions, modelsRefreshKey: 1 });
  for (let index = 0; index < 4; index++) {
    await attempts[index].entered.promise;
    const waiting = index < 3 ? time.nextDelay() : null;
    await act(async () => { fail(attempts[index], kind); if (waiting) await waiting; else await f.maintenanceHandle(); });
    assert.equal(f.current.modelError, message);
    assert.equal(reads(f).length, before + index + 1);
    if (index < 3) {
      const ms = [2000, 5000, 10000][index];
      assert.equal(time.delays[index].ms, ms);
      await act(async () => { time.advance(ms - 1); });
      assert.equal(reads(f).length, before + index + 1, "no early retry");
      await act(async () => { time.advance(1); await attempts[index + 1].entered.promise; });
    }
  }
  assert.deepEqual(time.delays.map(item => item.ms), [2000, 5000, 10000]);
});

test("mounted metadata: successful bounded retry clears error and installs actual model/default/pin projection", options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  await f.mountReady();
  const first = f.hold(models, { stage: "headers" }), second = f.hold(models);
  await f.rerender({ ...f.mountedOptions, modelsRefreshKey: 1 });
  const waiting = time.nextDelay();
  await act(async () => { first.reject(new TypeError("Failed to fetch")); await waiting; });
  assert.equal(f.current.modelError, "Failed to fetch");
  await act(async () => { time.advance(2000); await second.entered.promise; });
  const payload = { ...f.metadata(), defaultModel: selected("A"), thinkingLevelPins: { [`${provider}/A`]: "high" } };
  await f.deliver(second, payload);
  await f.settleMaintenance();
  assert.equal(f.current.modelError, null);
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "high");
  assert.equal(time.delays.length, 1);
});

for (const outcome of ["success", "error"]) test(`mounted metadata: old ${outcome} cannot overwrite newer capability/maps/error`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  const old = f.hold(models, { status: outcome === "error" ? 403 : 200 });
  const stale = await f.start("old metadata full handler", value => value.loadModels());
  await old.entered.promise;
  const fresh = f.hold(models), newer = await f.start("new metadata full handler", value => value.loadModels());
  const payload = { ...f.metadata(), models: { fresh: "Fresh" }, thinkingLevels: { fresh: ["off"] }, thinkingLevelMaps: { fresh: { high: "low" } } };
  await f.finish(newer, () => fresh.resolve(payload));
  await f.finish(stale, () => old.resolve(outcome === "error" ? { error: "stale failure" } : { models: { old: "Old" } }));
  assert.deepEqual(f.current.modelNames, { fresh: "Fresh" });
  assert.deepEqual(f.current.modelThinkingLevels, { fresh: ["off"] });
  assert.deepEqual(f.current.modelThinkingLevelMaps, { fresh: { high: "low" } });
  assert.equal(f.current.modelError, null);
});

for (const identity of ["selection", "account A/B/A", "session recreation", "keyed unmount A/B/A"]) test(`mounted metadata: ${identity} invalidates a pending read without substituting private refs`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  if (identity === "session recreation") {
    await f.run("initialize lazy composer", value => value.loadSlashCommands());
    await f.settleMaintenance();
  }
  if (identity === "account A/B/A") await f.run("initial account", value => value.handleSessionAccountChange(provider, "A", { [provider]: "A" }));
  const priorNames = { ...f.current.modelNames }, priorMaps = { ...f.current.modelThinkingLevelMaps };
  const old = f.hold(models), pending = await f.start("metadata bound to old identity", value => value.loadModels());
  await old.entered.promise;
  const outgoing = f.maintenanceHandle;
  if (identity === "selection") await f.run("select while anonymous read pending", value => value.handleModelChange(provider, "A"));
  if (identity === "account A/B/A") {
    assert.deepEqual(JSON.parse(old.request.query.get("accounts")), { [provider]: "A" });
    await f.run("account B", value => value.handleSessionAccountChange(provider, "B", { [provider]: "B" }));
    await f.run("account A again", value => value.handleSessionAccountChange(provider, "A", { [provider]: "A" }));
  }
  if (identity === "session recreation") {
    const sid = `${f.savedId}-replacement`; f.declareSession(sid);
    const tools = f.hold(command("set_tools"));
    const changing = await f.start("actual same-hook Tools recreation", value => value.handleToolPresetChange("none"));
    await f.finish(changing, () => tools.resolve({ success: true, data: { sessionId: sid, recreated: true } }));
    assert.equal(f.current.sessionIdRef.current, sid);
    assert.equal(f.maintenanceHandle, outgoing);
  }
  if (identity === "keyed unmount A/B/A") {
    await f.mountReady(f.newOptions({ newSessionDraftKey: `${f.draftKey}:B` }));
    await f.mountReady(f.newOptions());
  }
  await f.finish(pending, () => old.resolve({ models: { stale: "Stale" }, thinkingLevelMaps: { stale: { high: "off" } } }));
  await f.settleMaintenance(outgoing);
  assert.deepEqual(f.current.modelNames, priorNames);
  assert.deepEqual(f.current.modelThinkingLevelMaps, priorMaps);
});

for (const status of [200, 403]) test(`mounted metadata: effect abort at ${status} JSON stops publication and retries even when body ignores abort`, options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  await f.mountReady();
  const old = f.hold(models, { status });
  await f.rerender({ ...f.mountedOptions, modelsRefreshKey: 1 });
  await old.entered.promise;
  const outgoing = f.maintenanceHandle, prior = { ...f.current.modelNames }, count = reads(f).length;
  await f.unmount();
  assert.equal(old.request.signal.aborted, true);
  await f.deliver(old, status === 200 ? { models: { stale: "Stale" } } : { error: "Access denied" });
  await f.settleMaintenance(outgoing);
  assert.deepEqual(f.current.modelNames, prior);
  assert.equal(time.delays.length, 0);
  assert.equal(reads(f).length, count);
});

for (const status of [200, 403]) test(`mounted metadata: caller abort at ${status} body preserves mounted state/error`, options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time }); await f.mountReady();
  const controller = new AbortController(), prior = { ...f.current.modelNames };
  const body = f.hold(models, { status, abort: "reject" });
  const reading = await f.start("real caller-aborted metadata body", value => value.loadModels(controller.signal), { rejects: error => error.name === "AbortError" });
  await body.entered.promise;
  await f.finish(reading, () => controller.abort());
  assert.equal(f.current.modelError, null); assert.deepEqual(f.current.modelNames, prior);
  assert.equal(time.delays.length, 0);
});

test("mounted metadata: abort delivered during successful JSON is checked before installation", options, async t => {
  const f = await sessionFixture(t); await f.mountReady();
  const controller = new AbortController(), prior = { ...f.current.modelNames };
  const body = f.hold(models, { beforeJson: () => controller.abort() });
  const read = await f.start("caller-owned abort including loader catch", value => value.loadModels(controller.signal), { rejects: error => error.name === "AbortError" });
  await f.finish(read, () => body.resolve({ models: { stale: "Stale" } }));
  assert.equal(controller.signal.aborted, true);
  assert.deepEqual(f.current.modelNames, prior);
});

test("mounted metadata: abort while actual retry delay is held prevents the next admission", options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  await f.mountReady(); const body = f.hold(models, { stage: "headers" });
  await f.rerender({ ...f.mountedOptions, modelsRefreshKey: 1 });
  const waiting = time.nextDelay();
  await act(async () => { body.reject(new TypeError("Failed to fetch")); await waiting; });
  const count = reads(f).length, outgoing = f.maintenanceHandle;
  await f.unmount();
  await act(async () => { time.advance(2000); await outgoing(); });
  assert.equal(reads(f).length, count);
});

test("mounted metadata: history-only session performs no model request, state writes or retry", options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  const existing = f.existingOptions(); existing.session = { ...existing.session, cwdState: "missing" };
  await f.mount(existing); await f.settleMaintenance();
  const names = { ...f.current.modelNames };
  await f.run("history-only public metadata", value => value.loadModels());
  assert.equal(reads(f).length, 0); assert.equal(time.delays.length, 0);
  assert.deepEqual(f.current.modelNames, names);
});
