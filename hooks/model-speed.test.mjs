import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { sessionFixture, command } from "./agent-session-mounted.fixture.mjs";
import { policyClockFixture } from "./agent-session-clock.fixture.mjs";
const options = { timeout: 10000 };
const states = f => f.requests.filter(command("get_state"));
const source = f => f.sources.find(item => item.readyState !== 2);
async function ready(t) {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  await f.mountReady(f.existingOptions()); return { f, time };
}
// Full public promise plus separately observed recovery, no extracted callbacks.
async function enterRecovery(f, { abort = "ignore" } = {}) {
  const write = f.hold(command("set_model_speed"), { stage: "headers" });
  const initial = f.hold(command("get_state"), { stage: "headers" });
  const changing = await f.start("lost speed save and failed initial confirmation", value => value.handleModelSpeedChange("fast"));
  const read = f.hold(command("get_state"), { abort });
  await act(async () => { write.reject(new TypeError("Acknowledgement lost after committing Fast")); await initial.entered.promise; });
  await f.finish(changing, () => initial.reject(new TypeError("State read unavailable")));
  await read.entered.promise;
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, true);
  assert.equal(f.current.notices.some(notice => notice.message.includes("Acknowledgement lost after committing Fast")), true);
  return read;
}
const confirm = (f, speed) => ({ success: true, data: { ...f.live(f.current.sessionIdRef.current), modelSpeed: speed } });
const online = f => f.view.dispatch(f.view.window, new f.view.window.Event("online"));
const visible = f => f.view.dispatch(f.view.window.document, new f.view.window.Event("visibilitychange"));

test("lost speed acknowledgement confirms canonical Fast before admitting Send, without SSE", options, async t => {
  const { f } = await ready(t);
  const write = f.hold(command("set_model_speed"), { stage: "headers" }), read = f.hold(command("get_state"));
  const changing = await f.start("real save including initial reconciliation/finally", value => value.handleModelSpeedChange("fast"));
  await act(async () => { write.reject(new TypeError("lost acknowledgement")); await read.entered.promise; });
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, true);
  await f.run("Send while confirmation pending", value => value.handleSend("must remain blocked"));
  assert.equal(f.requests.filter(command("prompt")).length, 0);
  await f.finish(changing, () => read.resolve(confirm(f, "fast")));
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.data.modelSpeed, "fast");
  assert.equal(f.current.modelSpeedChanging, false); assert.equal(f.current.notices.length, 0);
  await f.run("Send after authoritative confirmation", value => value.handleSend("admitted now"));
  assert.equal(f.requests.filter(command("prompt")).length, 1);
});

test("speed write deadline at exactly 10k reconciles Fast committed before a lost response", options, async t => {
  const { f, time } = await ready(t);
  const write = f.hold(command("set_model_speed"), { stage: "headers", abort: "reject" });
  const read = f.hold(command("get_state"));
  const changing = await f.start("bounded held speed write and authoritative catch/finally", value => value.handleModelSpeedChange("fast"));
  await write.entered.promise;
  await act(async () => { time.advance(9999); }); assert.equal(write.request.signal.aborted, false);
  await act(async () => { time.advance(1); await read.entered.promise; });
  assert.equal(write.request.signal.aborted, true); assert.equal(f.current.modelSpeedChanging, true);
  await f.finish(changing, () => read.resolve(confirm(f, "fast")));
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, false);
  assert.deepEqual(time.deadlines.map(item => item.ms), [10000, 10000]);
});

test("real state read begun during save cannot roll confirmed speed back but still publishes definition error", options, async t => {
  const { f } = await ready(t);
  const write = f.hold(command("set_model_speed"));
  const changing = await f.start("held speed save", value => value.handleModelSpeedChange("fast"));
  const old = f.hold(command("get_state"));
  const loader = await f.start("actual System read during saving", () => f.loader());
  await old.entered.promise;
  await f.finish(changing, () => write.resolve({ success: true, data: { modelSpeed: "fast" } }));
  await f.finish(loader, () => old.resolve({ success: true, data: { ...f.live(f.savedId), modelSpeed: "standard", modelDefinitionRefresh: { error: "Synthetic definition error" } } }));
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, false);
  assert.equal(f.current.modelError, "Synthetic definition error");
  f.record(f.savedId).speed = "standard";
  await f.run("genuinely later System read", () => f.loader());
  assert.equal(f.current.modelSpeed, "standard"); assert.equal(f.current.modelError, null);
});

for (const acknowledgement of ["lost", "success"]) test(`same-hook actual Tools recreation after ${acknowledgement} save needs replacement confirmation`, options, async t => {
  const { f } = await ready(t), originalHandle = f.maintenanceHandle;
  const write = f.hold(command("set_model_speed"), { stage: acknowledgement === "lost" ? "headers" : "body" });
  const initial = acknowledgement === "lost" ? f.hold(command("get_state")) : null;
  const changing = await f.start("save across actual public recreation", value => value.handleModelSpeedChange("fast"));
  if (initial) await act(async () => { write.reject(new TypeError("lost acknowledgement")); await initial.entered.promise; });
  const sid = `${f.savedId}-replacement`; f.declareSession(sid).speed = acknowledgement === "lost" ? "standard" : "fast";
  const tools = f.hold(command("set_tools"));
  const replacing = await f.start("same-hook set_tools result changes identity", value => value.handleToolPresetChange("none"));
  await f.finish(replacing, () => tools.resolve({ success: true, data: { sessionId: sid, recreated: true } }));
  assert.equal(f.current.sessionIdRef.current, sid); assert.equal(f.maintenanceHandle, originalHandle);
  const replacement = f.hold(request => command("get_state")(request) && request.path === `/api/agent/${sid}`);
  await f.finish(changing, () => initial ? initial.resolve({ success: true, data: { modelSpeed: "standard" } }) : write.resolve({ success: true, data: { modelSpeed: "fast" } }));
  await replacement.entered.promise;
  assert.equal(f.current.modelSpeedChanging, true);
  assert.equal(replacement.request.path, `/api/agent/${sid}`);
  await f.deliver(replacement, confirm(f, acknowledgement === "lost" ? "standard" : "fast")); await f.settleMaintenance();
  assert.equal(f.current.modelSpeedChanging, false);
  assert.equal(f.current.modelSpeed, acknowledgement === "lost" ? "standard" : "fast");
});

for (const event of ["online", "visibilitychange"]) for (const late of ["success", "error"]) test(`${event} supersedes ignored-abort speed recovery; old ${late} is inert`, options, async t => {
  const { f } = await ready(t), old = await enterRecovery(f);
  const fresh = f.hold(command("get_state"));
  await (event === "online" ? online(f) : visible(f)); await fresh.entered.promise;
  assert.equal(old.request.signal.aborted, true);
  await f.deliver(fresh, confirm(f, "fast"));
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, false);
  await act(async () => { if (late === "success") old.resolve(confirm(f, "standard")); else old.reject(new TypeError("old read failed")); await f.maintenanceHandle(); });
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, false);
});

test("exact 10k initial/read deadlines and 15k recovery cadence bound policy without speeding React timers", options, async t => {
  const { f, time } = await ready(t);
  const write = f.hold(command("set_model_speed"), { stage: "headers" });
  const initial = f.hold(command("get_state"), { abort: "reject" });
  const changing = await f.start("lost save with bounded initial read", value => value.handleModelSpeedChange("fast"));
  await act(async () => { write.reject(new TypeError("lost save")); await initial.entered.promise; });
  const recoveryRead = f.hold(command("get_state"), { abort: "reject" });
  assert.deepEqual(time.deadlines.slice(0, 2).map(item => item.ms), [10000, 10000]);
  await act(async () => { time.advance(9999); }); assert.equal(initial.request.signal.aborted, false);
  await act(async () => { time.advance(1); await changing.promise; });
  // The completed command schedules recovery via React state. Let this real act
  // commit before awaiting its effect's admission; otherwise each waits on the other.
  await recoveryRead.entered.promise;
  assert.equal(initial.request.signal.aborted, true); assert.equal(f.current.modelSpeedChanging, true);
  const interval = time.intervals.find(item => item.policy === "speed-recovery" && item.active);
  assert.equal(interval.ms, 15000); assert.equal(time.deadlines[2].ms, 10000);
  await act(async () => { time.advance(9999); }); assert.equal(recoveryRead.request.signal.aborted, false);
  await act(async () => { time.advance(1); await f.maintenanceHandle(); });
  assert.equal(recoveryRead.request.signal.aborted, true); assert.equal(f.current.modelSpeedChanging, true);
  const retry = f.hold(command("get_state")), count = states(f).length;
  await act(async () => { time.advance(4999); }); assert.equal(states(f).length, count);
  await act(async () => { time.advance(1); await retry.entered.promise; });
  await f.deliver(retry, confirm(f, "fast")); await f.settleMaintenance();
  assert.equal(f.current.modelSpeedChanging, false); assert.equal(interval.active, false);
});

test("obsolete recovery finally cannot release a newer ignored-abort flight", options, async t => {
  const { f, time } = await ready(t), old = await enterRecovery(f);
  const next = f.hold(command("get_state")); await online(f); await next.entered.promise;
  await f.deliver(old, confirm(f, "standard"));
  const count = states(f).length;
  await act(async () => { time.advance(15000); });
  assert.equal(states(f).length, count, "poll cannot overlap the newer still-pending request");
  assert.equal(f.current.modelSpeedChanging, true);
  const repair = f.hold(command("get_state")); await online(f); await repair.entered.promise;
  await f.deliver(next, confirm(f, "standard"));
  await f.deliver(repair, confirm(f, "fast")); await f.settleMaintenance();
  assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, false);
});

test("unmount aborts actual recovery and joins ignored-abort late delivery before disposal", options, async t => {
  const { f, time } = await ready(t), read = await enterRecovery(f), outgoing = f.maintenanceHandle;
  const count = f.requests.length, speed = f.current.modelSpeed;
  await f.unmount(); assert.equal(read.request.signal.aborted, true);
  await f.deliver(read, confirm(f, "standard")); await f.settleMaintenance(outgoing);
  assert.equal(f.current.modelSpeed, speed);
  assert.equal(time.intervals.some(item => item.policy === "speed-recovery" && item.active), false);
  await act(async () => { f.view.window.dispatchEvent(new f.view.window.Event("online")); time.advance(15000); });
  assert.equal(f.requests.length, count);
  assert.equal(source(f) === undefined, true);
});

// SOURCE-ONLY APPEND: actual public hook + actual ChatInput, not navigation/SDK.
// Keep all original families above and the separate native/default partners.
const MS_A = "e2e-model-speed-standard", MS_B = "e2e-model-speed-fast", MS_LEGACY = "e2e-model-speed-legacy";
const MS_CODEX = { provider: "openai-codex", id: "e2e-codex-speed", name: "E2E ChatGPT subscription" };
const MS_API = { provider: "openai", id: "e2e-api-speed", name: "E2E OpenAI API (no speed)" };
const msSelect = f => f.view.container.querySelector('select[aria-label="Model speed"]');
const msNotes = f => [...f.view.container.querySelectorAll('[role="note"]')]
  .filter(node => node.textContent.includes("Fast uses more subscription quota"));
const msReply = (f, sid, speed) => ({ success: true, data: { ...f.live(sid), modelSpeed: speed } });
async function msFixture(t, overrides = {}) {
  const f = await sessionFixture(t, { modelControls: true, fixtureProvider: MS_CODEX.provider,
    modelIds: [MS_CODEX.id, MS_API.id], modelRefs: [MS_CODEX, MS_API], savedSessionId: MS_A, ...overrides });
  f.setCatalog({ model: MS_CODEX.id, thinking: "low", thinkingPins: {} });
  for (const [sid, speed] of [[MS_A, "fast"], [MS_B, "fast"], [MS_LEGACY, "standard"], [f.savedId, "standard"]]) {
    const row = f.declareSession(sid);
    row.model = MS_CODEX.id; row.provider = MS_CODEX.provider; row.thinking = "low"; row.speed = speed;
  }
  return f;
}
async function msChange(f, speed) {
  const select = msSelect(f), before = f.controlWorks.length;
  assert.equal(select !== null, true, "real speed select is present");
  select.value = speed;
  await f.view.dispatch(select, new f.view.window.Event("change", { bubbles: true }));
  assert.equal(f.controlWorks.length, before + 1, "actual control admitted one complete public operation");
  return f.controlWorks.at(-1);
}
function msCurrent(f, sid, speed) {
  assert.equal(f.currentContext.sessionId, sid);
  assert.equal(f.currentContext.key, f.keyedProps.key);
  assert.equal(f.keyedProps.options.session?.id ?? null, sid);
  assert.equal(f.currentContext.owner === f.maintenanceHandle, true);
  assert.equal(f.current.modelSpeed, speed);
  assert.equal(msSelect(f)?.value, speed);
  assert.equal(f.current.thinkingLevel, "low");
}
function msNoBrowserDefault(f) {
  const fields = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.doesNotMatch(key, /^(model[-_]?speed|service[-_]?tier)$/i);
      fields(child);
    }
  };
  for (const [key, raw] of Object.entries(f.view.window.localStorage)) {
    assert.doesNotMatch(key, /^(?:pi[-_])?(?:chat[-_])?(?:default[-_])?(model[-_]?speed|service[-_]?tier)(?:[-_](default|preference))?$/i);
    let value;
    try { value = JSON.parse(raw); } catch { continue; }
    fields(value);
  }
}

test("MS1 actual control has only Standard/Fast, no Standard warning; exact Codex/API hide and restore retains Fast/Thinking", options, async t => {
  const f = await msFixture(t);
  f.record(MS_A).speed = "standard";
  await f.mountReady(f.existingOptions(MS_A));
  assert.deepEqual([...msSelect(f).options].map(option => [option.value, option.textContent]), [
    ["standard", "Standard"], ["fast", "Fast"],
  ], "exactly two rendered options, no third tier");
  assert.equal(msNotes(f).length, 0, "Standard has no Fast quota warning");
  assert.equal(msSelect(f).getAttribute("aria-describedby"), null);
  const speed = f.hold(command("set_model_speed"), { stage: "body" });
  let api, codex;
  try {
    const changing = await msChange(f, "fast");
    await speed.entered.promise;
    assert.equal(speed.request.path, `/api/agent/${MS_A}`);
    assert.deepEqual(speed.request.body, { type: "set_model_speed", modelSpeed: "fast" });
    assert.equal(f.record(MS_A).speed, "standard", "supplied server has not acknowledged the pending write");
    assert.equal(msSelect(f).value, "fast"); assert.equal(msSelect(f).disabled, true);
    f.record(MS_A).speed = "fast";
    await f.finish(changing, () => speed.resolve({ success: true, data: { modelSpeed: "fast" } }));
    assert.equal(msNotes(f).length, 1);
    assert.equal(msSelect(f).getAttribute("aria-describedby"), msNotes(f)[0].id);
    assert.equal(msSelect(f).disabled, false);

    api = f.hold(command("set_model"), { stage: "headers" });
    const away = await f.start("actual public Codex to API model selection", value => value.handleModelChange(MS_API.provider, MS_API.id));
    await api.entered.promise;
    assert.deepEqual(api.request.body, { type: "set_model", provider: MS_API.provider, modelId: MS_API.id });
    assert.equal(f.record(MS_A).provider, MS_CODEX.provider);
    assert.equal(msSelect(f) === null, true); assert.equal(msNotes(f).length, 0);
    assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.thinkingLevel, "low");
    f.record(MS_A).provider = MS_API.provider; f.record(MS_A).model = MS_API.id;
    await f.finish(away, () => api.resolve({ success: true, data: { provider: MS_API.provider, id: MS_API.id } }));
    await f.settleMaintenance();
    assert.deepEqual(f.current.displayModel, { provider: MS_API.provider, modelId: MS_API.id });
    assert.equal(msSelect(f) === null, true); assert.equal(msNotes(f).length, 0);
    assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.thinkingLevel, "low");

    codex = f.hold(command("set_model"), { stage: "headers" });
    const back = await f.start("actual public API to Codex restore", value => value.handleModelChange(MS_CODEX.provider, MS_CODEX.id));
    await codex.entered.promise;
    assert.deepEqual(codex.request.body, { type: "set_model", provider: MS_CODEX.provider, modelId: MS_CODEX.id });
    assert.equal(f.record(MS_A).provider, MS_API.provider);
    assert.equal(msSelect(f)?.value, "fast"); assert.equal(msSelect(f)?.disabled, true);
    f.record(MS_A).provider = MS_CODEX.provider; f.record(MS_A).model = MS_CODEX.id;
    await f.finish(back, () => codex.resolve({ success: true, data: { provider: MS_CODEX.provider, id: MS_CODEX.id } }));
    await f.settleMaintenance(); await f.settleControl();
    msCurrent(f, MS_A, "fast"); assert.equal(msSelect(f).disabled, false);
    assert.equal(msNotes(f).length, 1);
    assert.equal(msSelect(f).getAttribute("aria-describedby"), msNotes(f)[0].id);
    assert.equal(f.requests.filter(command("set_model_speed")).length, 1, "provider transitions never rewrite speed");
    f.assertNoFailures();
  } finally {
    // Release peers synchronously before fixture/public/maintenance awaits.
    speed.resolve({ success: true, data: { modelSpeed: "fast" } });
    api?.resolve({ success: true, data: { provider: MS_API.provider, id: MS_API.id } });
    codex?.resolve({ success: true, data: { provider: MS_CODEX.provider, id: MS_CODEX.id } });
  }
});

test("MS2 real keyed A/B/A receiving preserves independent A Fast/B Standard against delivered old read and body", options, async t => {
  const f = await msFixture(t);
  f.record(MS_A).speed = "fast";
  await f.mountReady(f.existingOptions(MS_A));
  msCurrent(f, MS_A, "fast");
  const a1 = f.currentContext, oldProps = f.keyedProps;
  // Explicit callback tokens from the outgoing actual hook, not an evaluator or
  // a callback manufactured by the fixture to implement currentness.
  const oldSystemCallback = f.loader, oldNameCallback = f.current.handleBuiltinSlashCommand;
  const oldRead = f.hold(request => command("get_state")(request) && request.path === `/api/agent/${MS_A}`, { stage: "body", abort: "ignore" });
  const oldBody = f.hold(request => request.method === "GET" && request.path === `/api/sessions/${MS_A}`, { stage: "body", abort: "ignore" });
  const staleState = msReply(f, MS_A, "standard");
  const staleSnapshot = f.snapshot(MS_A, { modelSpeed: "standard", snapshotRevision: "outgoing-A1-body" });
  try {
    const reading = await f.start("outgoing A1 System callback/full read catch finally", () => oldSystemCallback());
    await oldRead.entered.promise;
    const history = await f.start("outgoing A1 name callback/full canonical body", () => oldNameCallback("/name outgoing-A1"));
    await oldBody.entered.promise;
    assert.equal(oldProps.key, a1.key); assert.equal(oldProps.options.session.id, MS_A);

    await f.mountReady(f.existingOptions(MS_B));
    const b = f.currentContext;
    assert.notEqual(b.key, a1.key); assert.notEqual(b.owner, a1.owner);
    msCurrent(f, MS_B, "fast");
    await msChange(f, "standard"); await f.settleControl();
    msCurrent(f, MS_B, "standard");
    assert.deepEqual(f.requests.filter(command("set_model_speed")).map(request => [request.path, request.body]), [
      [`/api/agent/${MS_B}`, { type: "set_model_speed", modelSpeed: "standard" }],
    ]);
    assert.equal(f.record(MS_A).speed, "fast");

    await f.mountReady(f.existingOptions(MS_A));
    const a2 = f.currentContext;
    assert.notEqual(a2.key, a1.key); assert.notEqual(a2.key, b.key);
    assert.notEqual(a2.owner, a1.owner); assert.notEqual(a2.owner, b.owner);
    msCurrent(f, MS_A, "fast");
    assert.equal(f.current.modelSpeedChanging, false);
    const beforeLate = f.requests.length;
    await f.finish(reading, () => oldRead.resolve(staleState));
    await f.finish(history, () => oldBody.resolve(staleSnapshot));
    await f.settleMaintenance(a1.owner); await f.settleMaintenance(b.owner); await f.settleMaintenance(a2.owner);
    assert.equal(f.currentContext.key, a2.key);
    msCurrent(f, MS_A, "fast");
    assert.equal(f.current.data.sessionId, MS_A); assert.equal(f.current.data.modelSpeed, "fast");
    assert.equal(f.current.data.snapshotRevision === "outgoing-A1-body", false);
    assert.equal(f.current.modelSpeedChanging, false); assert.equal(f.current.loading, false); assert.equal(f.current.error, null);
    assert.equal(f.record(MS_B).speed, "standard");
    assert.equal(f.requests.slice(beforeLate).some(request => command("set_model_speed")(request) || command("prompt")(request)), false);
    f.assertNoFailures();
  } finally {
    oldRead.resolve(staleState); oldBody.resolve(staleSnapshot);
  }
});

test("MS3 legacy absent field receives Standard; explicit Codex Fast ensure omits Thinking/message and passive composer resets", options, async t => {
  // This created-client ID is external HTTP input, never the native predecessor.
  const createdId = "e2e-model-speed-created-client";
  const f = await msFixture(t, { savedSessionId: createdId, receiveCreatedSession: true });
  const absent = f.snapshot(MS_LEGACY); delete absent.modelSpeed;
  f.record(MS_LEGACY).state = { modelSpeed: undefined };
  // Strict replay can supersede its first header before JSON consumption. The
  // SAME exact absent-field input serves this finite initial-read window; the
  // entered gate must be the real current JSON consumer, not the obsolete one.
  const legacy = f.hold(request => request.method === "GET" && request.path === `/api/sessions/${MS_LEGACY}`, { repeat: true });
  let creation;
  const constructor = { sessionId: createdId, model: { provider: MS_CODEX.provider, modelId: MS_CODEX.id }, thinkingLevel: "low", modelSpeed: "fast" };
  try {
    await f.mount(f.existingOptions(MS_LEGACY));
    await legacy.entered.promise;
    await f.deliver(legacy, absent);
    const legacySource = f.sources.find(item => item.readyState !== 2);
    assert.equal(legacySource !== undefined, true);
    await f.connect(legacySource); await f.settleMaintenance();
    msCurrent(f, MS_LEGACY, "standard");
    assert.equal(Object.hasOwn(f.current.data, "modelSpeed"), false, "literal absent transport field reaches the actual fallback");

    await f.mountReady(f.newOptions({ persistNewSession: false }));
    assert.equal(f.current.modelSpeed, "standard");
    creation = f.hold(request => request.path === "/api/agent/new", { stage: "body" });
    await f.run("explicit Codex choice before ensure", value => value.handleModelChange(MS_CODEX.provider, MS_CODEX.id));
    await f.run("explicit Fast without changing Thinking", value => value.handleModelSpeedChange("fast"));
    assert.equal(f.current.thinkingLevel, "low");
    const creationOwner = f.maintenanceHandle;
    // Same actual receiving path already owned by hidden A35; only this explicit
    // Codex/Fast payload/omission tuple is new. Preserve the Probe key/state.
    await f.rerender({ ...f.mountedOptions, persistNewSession: true });
    await creation.entered.promise;
    assert.deepEqual(creation.request.body, { cwd: f.cwd, type: "ensure_session", modelSpeed: "fast",
      provider: MS_CODEX.provider, modelId: MS_CODEX.id });
    assert.equal(Object.hasOwn(creation.request.body, "thinkingLevel"), false);
    assert.equal(Object.hasOwn(creation.request.body, "message"), false);
    f.record(createdId).speed = "fast";
    await f.deliver(creation, constructor);
    // Release all HTTP peers before any connection/public/maintenance wait.
    for (const active of f.sources.filter(item => item.readyState !== 2)) await f.connect(active);
    await f.settleMaintenance(creationOwner);
    assert.equal(f.maintenanceHandle === creationOwner, true, "creation receiving preserved the actual hook fiber");
    assert.equal(f.promotions.length, 1); assert.equal(f.promotions[0].session.id, createdId);
    assert.equal(f.current.sessionIdRef.current, createdId);
    assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.thinkingLevel, "low");
    assert.equal(f.requests.filter(request => request.path === "/api/agent/new").length, 1);
    assert.equal(f.requests.filter(command("prompt")).length, 0);
    msNoBrowserDefault(f);
    await f.mountReady(f.newOptions({ persistNewSession: false }));
    assert.equal(f.current.modelSpeed, "standard"); assert.equal(msSelect(f)?.value, "standard");
    msNoBrowserDefault(f);
    f.assertNoFailures();
  } finally {
    legacy.resolve(absent); creation?.resolve(constructor);
  }
});

test("MS4 actual rendered Confirming/Send survives supplied bad HTTP status and rejected JSON body, then fully recovers without SSE", options, async t => {
  const time = policyClockFixture(), f = await msFixture(t, { policyTime: time });
  await f.mountReady(f.newOptions({ persistNewSession: false }));
  await f.run("real nonpromoting initializer for dormant hook", value => value.loadSlashCommands());
  assert.equal(f.current.isNew, true); assert.equal(f.current.sessionIdRef.current, MS_A);
  assert.equal(f.sources.length, 0);
  const key = f.currentContext.key;
  for (const fault of ["status", "body"]) {
    await f.run("restore known Standard before the next distinct HTTP input", value => value.handleModelSpeedChange("standard"));
    const before = states(f).length;
    // A non-OK response may legitimately be rejected before json() is called.
    // Gate that tuple at headers; the distinct 200/body tuple must enter json().
    const write = f.hold(command("set_model_speed"), { stage: fault === "status" ? "headers" : "body", status: fault === "status" ? 503 : 200 });
    const initial = f.hold(command("get_state"), { stage: fault === "status" ? "headers" : "body", status: fault === "status" ? 502 : 200 });
    const repair = f.hold(command("get_state"), { stage: "body" });
    try {
      const changing = await msChange(f, "fast");
      await write.entered.promise;
      assert.deepEqual(write.request.body, { type: "set_model_speed", modelSpeed: "fast" });
      assert.equal(write.request.path, `/api/agent/${MS_A}`);
      f.record(MS_A).speed = "fast"; // external committed-state input, NOT SDK proof
      await act(async () => {
        if (fault === "status") write.resolve({ error: "MS4 supplied write 503" });
        else write.reject(new SyntaxError("MS4 supplied write JSON body failure"));
        await initial.entered.promise;
      });
      await f.finish(changing, () => {
        if (fault === "status") initial.resolve({ error: "MS4 supplied initial read 502" });
        else initial.reject(new SyntaxError("MS4 supplied initial JSON body failure"));
      });
      await repair.entered.promise;
      assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, true);
      assert.equal(msSelect(f)?.value, "fast"); assert.equal(msSelect(f)?.disabled, true);
      assert.equal([...f.view.container.querySelectorAll('[role="status"]')]
        .some(node => node.textContent.includes("Confirming saved model speed")), true);
      await act(async () => { f.composerRef.current.insertIfEmpty("MS4 draft must not send while confirming"); });
      const textarea = f.view.container.querySelector("textarea");
      assert.equal(textarea.value, "MS4 draft must not send while confirming");
      const send = [...f.view.container.querySelectorAll("button")].find(node => node.textContent.trim() === "Send" || node.getAttribute("aria-label") === "Send");
      assert.equal(send !== undefined, true); assert.equal(send.disabled, true);
      await act(async () => { send.click(); });
      assert.equal(f.requests.filter(command("prompt")).length, 0);
      await f.deliver(repair, msReply(f, MS_A, "fast"));
      await f.settleMaintenance(); await f.settleControl(); await f.composerRef.current.whenSettled();
      assert.equal(f.currentContext.key, key); assert.equal(f.current.sessionIdRef.current, MS_A);
      assert.equal(f.current.modelSpeed, "fast"); assert.equal(f.current.modelSpeedChanging, false);
      assert.equal(msSelect(f)?.disabled, false); assert.equal(send.disabled, false);
      assert.equal(states(f).length - before, 2, "one failed initial confirmation and one admitted recovery, no replay");
      assert.equal(f.sources.length, 0, "actual dormant hook did not admit an SSE source");
      assert.equal(time.intervals.some(item => item.policy === "speed-recovery" && item.active), false);
      f.assertNoFailures();
    } finally {
      write.resolve({ success: true, data: { modelSpeed: "fast" } });
      initial.resolve(msReply(f, MS_A, "fast")); repair.resolve(msReply(f, MS_A, "fast"));
    }
  }
});

// Same synthetic policy inputs as checkBusyControls, not SDK activity or disk
// authority. The FIRST import and the existing fixture own fences/errors/joins.
for (const mobile of [false, true]) test(`MS5 ${mobile ? "mobile" : "desktop"} controlled streaming/settled and compaction start/end reach actual ChatInput without speed writes`, options, async t => {
  const f = await msFixture(t, { mobile, ownGraceTimers: true });
  const row = f.record(MS_A);
  row.speed = "fast";
  row.running = true;
  row.state = { isStreaming: true, isPromptRunning: false, isCompacting: false };
  const initialState = { running: true, state: f.live(MS_A) };
  // The existing hook can read the same running/state body through its saved
  // session-state facade or agent endpoint. Strict replay gets the SAME input;
  // this is not an independently authored copy of hook startup/selector policy.
  const initialRead = f.hold(request => request.method === "GET"
    && [ `/api/sessions/${MS_A}/state`, `/api/agent/${MS_A}` ].includes(request.path), { repeat: true });
  try {
    await f.mount(f.existingOptions(MS_A));
    await initialRead.entered.promise; // Actual JSON consumer, not headers alone.
    await f.deliver(initialRead, initialState);
    const active = source(f);
    assert.equal(active !== undefined, true, "MS5 owns the actual current event source");
    await f.connect(active, true); // Original connected/isStreaming:true input.
    const owner = f.maintenanceHandle, inputTail = f.composerRef.current.whenSettled;
    const settle = async () => {
      // Complete actual event/startup/history catch/finally and its descendants,
      // then public control/input tails; an act boundary alone is not this join.
      await f.settleMaintenance(owner);
      await f.settleControl();
      await act(async () => { await inputTail(); });
      f.assertNoFailures();
    };
    const check = (phase, streaming, compacting, disabled) => {
      msCurrent(f, MS_A, "fast");
      assert.equal(f.current.agentRunning, streaming, `MS5 ${phase}: current streaming input`);
      assert.equal(f.current.isCompacting, compacting, `MS5 ${phase}: current compacting input`);
      assert.equal(f.current.modelSwitching, false, `MS5 ${phase}: no unrelated model lock`);
      assert.equal(f.current.modelSpeedChanging, false, `MS5 ${phase}: no unrelated speed lock`);
      assert.equal(msSelect(f)?.disabled, disabled, `MS5 ${phase}: actual speed control disabled`);
      assert.equal(f.requests.filter(command("set_model_speed")).length, 0,
        `MS5 ${phase}: synthetic activity must not dispatch a speed write`);
    };
    await settle();
    check("streaming", true, false, true);

    row.state.isStreaming = false;
    await f.event(active, { type: "agent_settled" });
    await settle();
    check("settled", false, false, false);

    row.state.isCompacting = true;
    await f.event(active, { type: "compaction_start" });
    await settle();
    check("compaction_start", false, true, true);

    row.state.isCompacting = false;
    await f.event(active, { type: "compaction_end" });
    await settle();
    check("compaction_end", false, false, false);

    // Exercise unaided production unmount; fixture cleanup independently joins
    // captured owners/bodies, disposes the realm and restores host descriptors.
    await f.unmount();
    await settle();
    assert.equal(active.readyState, 2, "MS5 production unmount closes its source");
  } finally {
    // Release synchronously even when mount/body/React/any assertion failed.
    // The already-registered fixture owns independent full joins and SAME errors.
    initialRead.resolve(initialState);
  }
});
