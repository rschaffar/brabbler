import "../lib/testing/client-native-boundary.fixture.mjs";
// UNEXECUTED. Native time is never shortened. Separate cases intentionally await
// real 30,000ms grace admission and 60,000ms ready_timeout. Not global idle.
import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture as mountedSessionFixture, command } from "./agent-session-mounted.fixture.mjs";
import { policyClockFixture } from "./agent-session-clock.fixture.mjs";
import { nativeTimerWitness } from "./agent-session-native-timers.fixture.mjs";
import { readinessWitness } from "./agent-session-readiness.fixture.mjs";
import { act } from "react";
// Opt in only this finite family; other fixture callers keep their old lifetime.
const sessionFixture = (t, fixtureOptions = {}) => mountedSessionFixture(t, { ...fixtureOptions, ownGraceTimers: true });
const options = { timeout: 10000 };
const source = f => f.sources.findLast(item => item.readyState !== 2);
const stateRead = request => request.method === "GET" && /^\/api\/agent\/[^/]+$/.test(request.path);
const ok = data => ({ success: true, data });
async function freshSend(f, text = "literal prompt") {
  // Existing public non-prompt initializer, not a replacement ensure algorithm.
  await f.run("initialize lazy identity", value => value.loadSlashCommands());
  const sending = await f.start("fresh prompt readiness/POST/promotion", value => value.handleSend(text));
  await f.connect(source(f)); await f.finish(sending); await f.settleMaintenance();
}

// Keep legacy timer observers live through domain joins too: an early assertion
// must not restore the host descriptor ahead of fixture cleanup. Install before
// mount (class imports are inert); the attributed observer uses the same lifetime.
async function nativeTimedFixture(t, fixtureOptions = {}) {
  let timers;
  const f = await sessionFixture(t, { ...fixtureOptions, observeProduction({ afterSettlement }) {
    timers = nativeTimerWitness({ after: afterSettlement });
  } });
  return { f, timers };
}

test("readiness native bridge: literal 60k registers once per attempt, non-connected frames do not restart it, connected/unmount clear exact handles", options, async t => {
  const { timers, f } = await nativeTimedFixture(t);
  await f.mountReady();
  await f.run("initialize identity", value => value.loadSlashCommands());
  const send = await f.start("one absolute readiness attempt", value => value.handleSend("awaiting real connected"));
  const pending = source(f), registrations = timers.at(60000);
  assert.equal(registrations.length, 1);
  assert.equal(timers.cleared(registrations[0]), false);
  pending.readyState = 1; // transport OPEN alone is not readiness
  await f.event(pending, { type: "queue_update", steering: [], followUp: [] });
  assert.equal(timers.at(60000).length, 1, "no per-frame deadline renewal");
  assert.equal(f.requests.some(command("prompt")), false);
  await f.connect(pending); await f.finish(send); await f.settleMaintenance();
  assert.equal(timers.cleared(registrations[0]), true);
  assert.equal(f.requests.some(command("prompt")), true);
  await f.unmount();
  assert.equal(pending.readyState, 2);
  // This registration-only case does not wait 60s or invoke a captured callback.
  // The separate default-policy expiry case below owns real native elapsed time.
});

test("readiness native bridge: Strict replay and unmount clear every actual pending 60k attempt by native handle", options, async t => {
  const { timers, f } = await nativeTimedFixture(t);
  await f.mount(f.existingOptions());
  const registrations = timers.at(60000);
  assert.equal(registrations.length >= 2, true, "actual Strict cleanup/replay");
  assert.equal(registrations.filter(entry => !timers.cleared(entry)).length, 1);
  await f.unmount(); await f.settleMaintenance();
  assert.equal(registrations.every(entry => timers.cleared(entry)), true);
});

for (const outcome of ["connected", "startup_error", "unmount"]) test(`readiness attributed API: ${outcome} joins two real waiters on the hook's actual instance and exact native 60000 handle`, options, async t => {
  const witness = readinessWitness();
  const f = await sessionFixture(t, { observeProduction: witness.observeProduction });
  await f.mount(f.existingOptions());
  const pending = source(f);
  const send = await f.start("real Send sharing selected maintenance readiness", value => value.handleSend("literal attributed readiness"));
  const waiters = witness.calls.filter(call => call.name === "ensureConnected" && call.source === pending);
  assert.equal(waiters.length, 2, "nested maintain ensure plus actual hook Send ensure");
  const [maintenanceWaiter, sendWaiter] = waiters;
  const instance = sendWaiter.instance;
  assert.equal(instance instanceof witness.Connection, true, "same physical production graph, never a substituted class");
  assert.equal(maintenanceWaiter.instance === instance, true);
  assert.equal(maintenanceWaiter.parent.name, "maintain");
  assert.equal(maintenanceWaiter.parent.instance === instance, true);
  assert.equal(sendWaiter.parent, null);
  assert.equal(waiters.every(call => call.sid === f.savedId && call.optionMs === 60000), true);
  assert.equal(waiters[0].attempt === waiters[1].attempt, true);
  assert.equal(instance.current.source === pending, true);
  assert.equal(pending.url, `/api/agent/${f.savedId}/events`);
  const registration = witness.timers.at(60000).find(entry => entry.owner === maintenanceWaiter);
  assert.ok(registration, "60000 must originate inside THIS instance's original ensure/open");
  assert.equal(witness.timers.at(60000).filter(entry => waiters.includes(entry.owner)).length, 1);
  const beforeFrames = witness.timers.at(60000).length;
  assert.equal(witness.timers.cleared(registration), false);
  await act(() => { pending.readyState = 1; });
  await act(() => pending.onmessage({ data: "{malformed" }));
  await f.event(pending, { type: "queue_update", steering: [], followUp: [] });
  assert.equal(waiters.every(call => call.status === undefined), true);
  assert.equal(f.requests.some(command("prompt")), false);
  assert.equal(witness.timers.at(60000).length, beforeFrames, "OPEN/malformed/nonconnected never renew the attempt");
  assert.equal(witness.timers.cleared(registration), false);
  if (outcome === "connected") {
    await f.connect(pending); await f.finish(send);
  } else {
    const status = outcome === "unmount" ? "closed" : "startup_error";
    f.expectConsoleError("Failed to send message:", error => error?.status === status);
    if (outcome === "unmount") await f.unmount();
    await f.finish(send, outcome === "startup_error"
      ? () => pending.message({ type: "startup_error", errorMessage: "attributed startup refusal" }) : undefined);
  }
  await f.settleMaintenance(); await witness.join();
  assert.equal(waiters.every(call => call.status === (outcome === "connected" ? "fulfilled" : "rejected")), true);
  if (outcome !== "connected") assert.equal(waiters.every(call => call.error.status === (outcome === "unmount" ? "closed" : "startup_error")), true);
  assert.equal(witness.timers.cleared(registration), true);
  assert.equal(f.requests.filter(command("prompt")).length, outcome === "connected" ? 1 : 0);
  if (outcome === "connected") await f.run("ready real maintain forwards its exact original work", () => {
    const index = witness.calls.length;
    const forwarded = instance.maintain(f.savedId);
    assert.equal(forwarded === witness.calls[index].originalPromise, true);
    return forwarded;
  });
  await f.unmount(); await f.settleMaintenance();
  const beforeLate = f.requests.length, sourcesBeforeLate = f.sources.length;
  await f.event(pending, { type: "connected", isStreaming: true });
  await f.event(pending, { type: "agent_start" });
  await f.settleMaintenance(); await witness.join();
  assert.equal(pending.readyState, 2);
  assert.equal(f.requests.length, beforeLate);
  assert.equal(f.sources.length, sourcesBeforeLate);
});

// NEW contract: this case alone needs >60s. Ordinary runner has no per-file
// deadline or --test-timeout; retain every existing 10000/45000 case unchanged.
// This is admission-to-real-ready_timeout, not a sleep, timer delivery or idle.
test("readiness default-policy expiry: actual controller/native API 60000 rejects both original waiters and closes the stalled source", { timeout: 70000 }, async t => {
  const witness = readinessWitness();
  const f = await sessionFixture(t, { observeProduction: witness.observeProduction });
  const events = [];
  const connection = new witness.Connection({
    createSource: sid => new EventSource(`/api/agent/${sid}/events`),
    onEvent: event => events.push(event), shouldMaintain: () => false,
    readinessTimeoutMs: 60000, reconnectDelayMs: 1200,
  });
  // Local finally closes/rejects/joins before fixture domain drain, even when
  // an assertion or second open fails. Do not depend on t.after FIFO/LIFO order.
  let first, second;
  try {
  const startedAt = process.hrtime.bigint();
  first = connection.ensureConnected(f.savedId);
  second = connection.ensureConnected(f.savedId);
  const waiters = witness.calls.filter(call => call.instance === connection);
  assert.equal(waiters.length, 2);
  assert.equal(first === waiters[0].originalPromise, true, "wrapper returns EXACT original API promise");
  assert.equal(second === waiters[1].originalPromise, true);
  assert.equal(waiters[0].attempt === waiters[1].attempt, true);
  assert.equal(waiters[0].source === waiters[1].source, true);
  const registration = witness.timers.at(60000).find(entry => entry.owner === waiters[0]);
  assert.ok(registration);
  assert.equal(witness.timers.at(60000).length, 1);
  const outcomes = await Promise.allSettled([first, second]);
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  // Node timer scheduling is not exact wall-clock precision; allow 100ms edge
  // tolerance, while the unchanged API argument is separately exact above.
  assert.equal(elapsedMs >= 59900, true, `real ready_timeout after ${elapsedMs}ms`);
  assert.equal(outcomes.every(item => item.status === "rejected" && item.reason.status === "ready_timeout"), true);
  assert.equal(outcomes[0].reason === outcomes[1].reason, true);
  await witness.join();
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].readyState, 2);
  assert.equal(f.sources[0].closeCount, 1);
  assert.equal(witness.timers.cleared(registration), true);
  assert.deepEqual(events, []);
  const before = witness.timers.registrations.length;
  f.sources[0].message({ type: "connected", isStreaming: true });
  assert.deepEqual(events, []);
  assert.equal(witness.timers.registrations.length, before, "no demand: no retry/resurrection");
  } finally {
    try { connection.close(); }
    finally { await Promise.allSettled([first, second].filter(Boolean)); }
  }
});

for (const outcome of ["busy", "idle", "body error"]) test(`rejected reconcile-session fence: same-hook Tools A-to-B ignores late A ${outcome} while B's public Tools work is pending`, options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  let ended = 0;
  await f.mountReady({ ...f.existingOptions(), onAgentEnd: () => { ended++; } });
  const identity = f.maintenanceHandle, store = f.current.streamingStore, oldSource = source(f);
  const prompt = f.hold(command("prompt"));
  const recovery = f.hold(request => stateRead(request) && request.path === `/api/agent/${f.savedId}`);
  f.expectConsoleError("Failed to send message:", error => error?.code === "prompt_rejected");
  const rejected = await f.start("A actual rejected Send", value => value.handleSend("A refused literal"));
  await prompt.entered.promise;
  await f.finish(rejected, () => prompt.resolve({ error: "A refused", code: "prompt_rejected", accepted: false }));
  await recovery.entered.promise;
  const nextId = `${f.savedId}-tools-B`;
  f.declareSession(nextId);
  const rebuild = f.hold(command("set_tools"));
  const bState = f.hold(request => command("get_state")(request) && request.path === `/api/agent/${nextId}`);
  let bComplete = false;
  const tools = await f.start("SAME HOOK actual Tools rebuild and full B get_state finally", value => value.handleToolPresetChange("read-only").then(() => { bComplete = true; }));
  await rebuild.entered.promise;
  await f.deliver(rebuild, ok({ sessionId: nextId, recreated: true }));
  await bState.entered.promise;
  assert.equal(f.maintenanceHandle === identity, true, "not keyed/remounted");
  assert.equal(f.current.streamingStore === store, true);
  assert.equal(f.current.sessionIdRef.current, nextId, "actual Tools response moved the live identity");
  assert.equal(oldSource.readyState, 2);
  assert.equal(source(f), undefined, "B is not the selected prop: no invented warm B stream");
  const phase = f.current.agentPhase;
  assert.equal(f.current.agentRunning, true);
  assert.equal(phase.kind, "waiting_model");
  const before = { requests: f.requests.length, sources: f.sources.length, restores: f.restores.length,
    system: f.current.systemPrompt, auto: f.current.autoCompactionEnabled, notices: f.current.notices.length,
    queued: f.current.queuedMessages, streaming: store.getState().isStreaming };
  // Do NOT start another prompt run or deliver a new compaction event before A:
  // those would change independent run/version guards and mask exact77.
  const joinA = await f.start("full original A reconciliation catch/continuation", () => identity());
  await f.finish(joinA, () => outcome === "body error"
    ? recovery.reject(new SyntaxError("late A body failed"))
    : recovery.resolve({ running: outcome === "busy", state: { ...f.live(f.savedId),
      isStreaming: outcome === "busy", isPromptRunning: outcome === "busy", isCompacting: outcome === "busy",
      autoCompactionEnabled: false, systemPrompt: "STALE A", queuedMessages: { steering: ["stale A"], followUp: [] } } }));
  assert.equal(f.current.sessionIdRef.current, nextId);
  assert.equal(f.maintenanceHandle === identity, true);
  assert.equal(f.current.agentRunning, true);
  assert.equal(f.current.agentPhase === phase, true, "A cannot end/change B's current stage");
  assert.equal(f.current.isCompacting, false);
  assert.equal(f.current.autoCompactionEnabled, before.auto);
  assert.equal(f.current.systemPrompt, before.system);
  assert.equal(f.current.queuedMessages === before.queued, true);
  assert.equal(store.getState().isStreaming, before.streaming);
  assert.equal(f.current.notices.length, before.notices);
  assert.equal(f.restores.length, before.restores);
  assert.equal(ended, 0);
  assert.equal(bComplete, false, "A delivery cannot settle B's held public work");
  assert.equal(f.requests.length, before.requests, "no stale A followup/read/prompt admission");
  assert.equal(f.sources.length, before.sources);
  assert.equal(source(f), undefined);
  await f.run("current stage still refuses duplicate Send", value => value.handleSend("B must stay pending"));
  assert.equal(f.requests.length, before.requests);
  assert.equal(f.restores.at(-1)[0], "B must stay pending");
  assert.equal(bComplete, false);
  await f.finish(tools, () => bState.resolve(ok(f.live(nextId))));
  await f.settleMaintenance();
  assert.equal(bComplete, true);
  assert.equal(f.current.sessionIdRef.current, nextId);
  assert.equal(f.current.systemPrompt, `system:${nextId}`);
});

test("Send memo identity survives preset-only rerender and the same callback admits the fresh preset at creation", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  const send = f.current.handleSend;
  await f.run("public precreation preset rerender", value => value.handleToolPresetChange("read-only"));
  assert.equal(f.current.toolPreset, "read-only");
  assert.equal(f.current.handleSend === send, true);
  assert.equal(f.requests.some(request => request.path === "/api/agent/new"), false);
  const sending = await f.start("same Send reference consumes newly selected preset", () => send("fresh preset admission"));
  await f.connect(source(f)); await f.finish(sending); await f.settleMaintenance();
  assert.deepEqual(f.requests.find(request => request.path === "/api/agent/new").body.toolNames, ["read", "grep", "find", "ls"]);
  assert.deepEqual(f.requests.find(command("prompt")).body, { type: "prompt", message: "fresh preset admission" });
});

test("grace: agent_end is not terminal; agent_start cancels the exact native grace handle and extension settlement notifies separately", options, async t => {
  const time = policyClockFixture(), { timers, f } = await nativeTimedFixture(t, { policyTime: time });
  let ended = 0;
  await f.mountReady(f.newOptions({ onAgentEnd: () => { ended++; } }));
  await freshSend(f);
  const current = source(f);
  await f.event(current, { type: "agent_start" });
  await f.event(current, { type: "agent_end" }); await f.settleMaintenance();
  assert.equal(current.readyState, 1);
  assert.equal(f.current.agentRunning, true);
  assert.equal(ended, 0);
  await f.event(current, { type: "agent_settled" });
  assert.equal(f.current.agentRunning, true, "wrapper prompt still owns its stage");
  await f.event(current, { type: "prompt_done" }); await f.settleMaintenance();
  const grace = timers.at(30000).at(-1);
  assert.ok(grace);
  assert.equal(current.readyState, 1);
  assert.equal(ended, 1);
  await f.event(current, { type: "prompt_done" }); await f.settleMaintenance();
  assert.equal(ended, 1, "duplicate completion notification is suppressed");
  await f.event(current, { type: "agent_start" });
  assert.equal(timers.cleared(grace), true);
  await f.event(current, { type: "agent_settled" }); await f.settleMaintenance();
  assert.equal(ended, 2);
  const extensionGrace = timers.at(30000).at(-1);
  assert.notEqual(extensionGrace.handle, grace.handle);
  await f.unmount();
  assert.equal(timers.cleared(extensionGrace), true);
});

test("grace native chain: real 30k verification keeps compaction/failure alive via unchanged 600ms rechecks, then closes only confirmed idle", { timeout: 45000 }, async t => {
  const time = policyClockFixture(), { timers, f } = await nativeTimedFixture(t, { policyTime: time });
  await f.mountReady(); await freshSend(f);
  const current = source(f), first = f.hold(stateRead);
  const admitted = f.nextRequest(stateRead);
  await f.event(current, { type: "prompt_done" }); await f.settleMaintenance();
  assert.equal(current.readyState, 1);
  assert.equal(timers.at(30000).at(-1).ms, 30000);
  // This is an admission wait for the actual native timer, not a sleep-as-idle.
  const waiting = await f.start("native grace admission", () => admitted);
  await f.finish(waiting);
  await first.entered.promise;
  const second = f.hold(stateRead), secondAdmitted = f.nextRequest(stateRead);
  await f.deliver(first, { running: true, state: { ...f.live(f.savedId), isCompacting: true } });
  await f.settleMaintenance();
  assert.equal(current.readyState, 1);
  assert.equal(f.current.isCompacting, true);
  assert.equal(timers.at(600).at(-1).ms, 600);
  const waitSecond = await f.start("native compaction recheck admission", () => secondAdmitted);
  await f.finish(waitSecond); await second.entered.promise;
  const third = f.hold(stateRead), thirdAdmitted = f.nextRequest(stateRead);
  const failedJoin = await f.start("full grace failure/catch/rearm", () => f.maintenanceHandle());
  await f.finish(failedJoin, () => second.reject(new Error("controlled offline grace body")));
  assert.equal(current.readyState, 1, "uncertain state must not close SSE");
  const waitThird = await f.start("native failed-state recheck admission", () => thirdAdmitted);
  await f.finish(waitThird); await third.entered.promise;
  const idleJoin = await f.start("full admitted grace idle chain", () => f.maintenanceHandle());
  await f.finish(idleJoin, () => third.resolve({ running: false }));
  assert.equal(current.readyState, 2);
});

for (const liveOwner of ["SDK", "RPC"]) test(`rejection: definitive refusal restores literal envelope but preserves another ${liveOwner} run from server`, options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  let ended = 0;
  await f.mountReady({ ...f.existingOptions(), onAgentEnd: () => { ended++; } });
  const prompt = f.hold(command("prompt")), recovery = f.hold(stateRead);
  const text = "  literal rejected submission\n ", images = [{ data: "aGVsbG8=", mimeType: "image/png", previewUrl: "blob:fixture-only" }];
  f.expectConsoleError("Failed to send message:", error => error?.code === "prompt_rejected" && error.accepted === false);
  const operation = await f.start("actual definitively rejected submission", value => value.handleSend(text, images));
  await prompt.entered.promise;
  await f.finish(operation, () => prompt.resolve({ error: "not accepted", code: "prompt_rejected", accepted: false }));
  await recovery.entered.promise;
  const joining = await f.start("full rejected-submission reconciliation", () => f.maintenanceHandle());
  await f.finish(joining, () => recovery.resolve({ running: true, state: { ...f.live(f.savedId), isStreaming: liveOwner === "SDK", isPromptRunning: liveOwner === "RPC" } }));
  assert.deepEqual(f.restores, [[text, [{ data: "aGVsbG8=", mimeType: "image/png" }], f.savedId]]);
  assert.equal(f.current.messages.length, 0);
  assert.equal(f.current.agentRunning, true);
  assert.equal(source(f).readyState, 1);
  await f.event(source(f), { type: "agent_settled" }); await f.settleMaintenance();
  assert.equal(f.current.agentRunning, liveOwner === "RPC");
  if (liveOwner === "RPC") { await f.event(source(f), { type: "prompt_done" }); await f.settleMaintenance(); }
  assert.equal(ended, 1);
});

for (const mode of ["lost ACK", "slash command"]) test(`settlement: ${mode} owns real 800ms probe and canonical finish, without duplicate draft restoration`, options, async t => {
  const time = policyClockFixture(), { timers, f } = await nativeTimedFixture(t, { policyTime: time });
  let ended = 0;
  await f.mountReady({ ...f.existingOptions(), onAgentEnd: () => { ended++; } });
  const text = mode === "slash command" ? "/extension literal" : "literal accepted before lost ACK";
  const prompt = f.hold(command("prompt"), { stage: mode === "lost ACK" ? "headers" : "body" });
  const read = f.hold(stateRead);
  if (mode === "lost ACK") f.expectConsoleError("Failed to send message:", error => error?.message === "controlled lost acknowledgement");
  const operation = await f.start("actual prompt dispatch including ambiguous catch", value => value.handleSend(text));
  await prompt.entered.promise;
  const row = f.record(f.savedId); row.messages = [{ role: "user", content: text, timestamp: 1 }]; row.entryIds = ["accepted-user"];
  await f.finish(operation, () => mode === "lost ACK" ? prompt.reject(new Error("controlled lost acknowledgement")) : prompt.resolve(ok({})));
  assert.equal(timers.at(800).length, 1);
  assert.deepEqual(f.restores, []);
  assert.equal(source(f).readyState, 1);
  await read.entered.promise;
  const join = await f.start("complete delayed settlement and nested canonical reload", () => f.maintenanceHandle());
  await f.finish(join, () => read.resolve({ running: false, state: f.live(f.savedId) }));
  assert.equal(f.current.agentRunning, false);
  assert.equal(ended, 1);
  assert.deepEqual(f.current.entryIds, ["accepted-user"]);
  assert.deepEqual(f.restores, []);
  assert.equal(source(f).readyState, 1, "selected session stays warm after confirmed finish");
});

test("settlement: confirmed fresh slash completion starts its native grace rather than closing the unselected source", options, async t => {
  const time = policyClockFixture(), { timers, f } = await nativeTimedFixture(t, { policyTime: time });
  await f.mountReady();
  await f.run("lazy fresh identity", value => value.loadSlashCommands());
  const read = f.hold(stateRead);
  const operation = await f.start("fresh slash prompt", value => value.handleSend("/extension fresh"));
  await f.connect(source(f)); await f.finish(operation);
  await read.entered.promise;
  const joining = await f.start("actual fresh finish/history/grace", () => f.maintenanceHandle());
  await f.finish(joining, () => read.resolve({ running: false, state: f.live(f.savedId) }));
  assert.equal(f.current.agentRunning, false);
  assert.equal(source(f).readyState, 1);
  const grace = timers.at(30000).at(-1);
  assert.ok(grace);
  await f.unmount(); assert.equal(timers.cleared(grace), true);
});

test("post-accept prompt_error publishes a notice, never restores or duplicates the user submission", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  await f.run("accepted prompt", value => value.handleSend("accepted literal"));
  await f.event(source(f), { type: "prompt_error", errorMessage: "controlled post-accept failure" });
  assert.deepEqual(f.restores, []);
  assert.equal(f.current.messages.filter(message => message.role === "user").length, 1);
  assert.equal(f.current.notices.some(notice => notice.message === "controlled post-accept failure" && notice.type === "error"), true);
});

for (const behavior of ["steer", "followUp"]) for (const disposition of ["accepted", "rejected", "ambiguous"]) {
  test(`queue: ${behavior}/${disposition} uses atomic prompt envelope, restores only definitive refusal`, options, async t => {
    const f = await sessionFixture(t);
    await f.mountReady(f.existingOptions());
    const gate = f.hold(command("prompt"), { stage: disposition === "ambiguous" ? "headers" : "body" });
    if (disposition !== "accepted") f.expectConsoleError("Failed to submit streaming prompt:", error => disposition === "ambiguous" ? error?.message === "controlled ambiguous queue ACK" : error?.code === "prompt_rejected");
    const text = "literal queued text", images = [{ data: "aGVsbG8=", mimeType: "image/png", previewUrl: "blob:fixture-only" }];
    const operation = await f.start("real streaming submission", value => behavior === "steer" ? value.handleSteer(text, images) : value.handleFollowUp(text, images));
    await gate.entered.promise;
    assert.deepEqual(gate.request.body, { type: "prompt", message: text, streamingBehavior: behavior, images: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }] });
    await f.finish(operation, () => disposition === "ambiguous" ? gate.reject(new Error("controlled ambiguous queue ACK")) : gate.resolve(disposition === "rejected" ? { error: "not admitted", code: "prompt_rejected", accepted: false } : ok({})));
    assert.deepEqual(f.restores, disposition === "rejected" ? [[text, [{ data: "aGVsbG8=", mimeType: "image/png" }], f.savedId]] : []);
  });
}

test("bash restore: actual 1000ms poll retries HTTP failure, owns canonical reload, then clears shell state", options, async t => {
  const time = policyClockFixture(), { timers, f } = await nativeTimedFixture(t, { policyTime: time });
  const row = f.record(f.savedId); row.running = true; row.state = { isBashRunning: true };
  const first = f.hold(stateRead, { stage: "headers", status: 503 });
  await f.mount(f.existingOptions()); await f.connect(source(f));
  await first.entered.promise;
  assert.equal(f.current.bashRunning, true);
  assert.equal(timers.at(1000).some(entry => entry.ms === 1000), true);
  const second = f.hold(stateRead);
  await f.deliver(first, { error: "controlled bash status unavailable" });
  await second.entered.promise;
  row.messages = [{ role: "bashExecution", command: "printf restored", output: "restored", exitCode: 0, cancelled: false, truncated: false, timestamp: 1 }]; row.entryIds = ["bash-entry"];
  const joining = await f.start("full restored bash poll/history/final state", () => f.maintenanceHandle());
  await f.finish(joining, () => second.resolve({ running: true, state: { ...f.live(f.savedId), isBashRunning: false } }));
  assert.equal(f.current.bashRunning, false);
  assert.equal(f.current.pendingBash, null);
  assert.deepEqual(f.current.entryIds, ["bash-entry"]);
  assert.equal(f.current.messages[0].output, "restored");
});
