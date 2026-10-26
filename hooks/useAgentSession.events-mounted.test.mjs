import '../lib/testing/client-native-boundary.fixture.mjs';
// Actual event/lease owners; completion is bounded to admitted per-hook work.
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { deferred } from "../lib/testing/async.fixture.mjs";
import { sessionFixture, command, models } from "./agent-session-mounted.fixture.mjs";
import { policyClockFixture } from "./agent-session-clock.fixture.mjs";
const options = { timeout: 10000 };
const activeSources = f => f.sources.filter(source => source.readyState !== 2);
const leases = f => f.requests.filter(request => request.path === `/api/agent/${f.savedId}/lease`);
const visible = f => f.view.dispatch(f.view.window.document, new f.view.window.Event("visibilitychange"));

test("mounted readiness: actual connected JSON, not transport open, precedes prompt admission", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  await f.run("lazy non-prompt initializer", value => value.loadSlashCommands());
  const send = await f.start("real Send including readiness/POST/promotion", value => value.handleSend("literal readiness message"));
  const source = f.sources.at(-1);
  assert.equal(source.url, `/api/agent/${f.savedId}/events`);
  assert.equal(f.requests.filter(command("prompt")).length, 0);
  await act(() => { source.readyState = 1; });
  assert.equal(f.requests.filter(command("prompt")).length, 0, "OPEN without connected is not agent readiness");
  await f.connect(source);
  await f.finish(send);
  await f.settleMaintenance();
  assert.deepEqual(f.requests.filter(command("prompt")).map(request => request.body),
    [{ type: "prompt", message: "literal readiness message" }]);
  assert.equal(f.promotions.length, 1);
});

test("mounted readiness: startup_error refuses prompt admission and completes actual rejection recovery", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  await f.run("initialize without sending or promoting", value => value.loadSlashCommands());
  const text = "  literal rejected readiness\nretained draft  ";
  const send = await f.start("Send waiting for actual agent readiness", value => value.handleSend(text));
  const source = f.sources.at(-1);
  assert.equal(f.requests.filter(command("prompt")).length, 0);
  f.expectConsoleError("Failed to send message:", error => error?.status === "startup_error" && error.message === "synthetic startup refusal");
  await f.finish(send, () => source.message({ type: "startup_error", errorMessage: "synthetic startup refusal" }));
  await f.settleMaintenance();
  assert.equal(f.requests.filter(command("prompt")).length, 0);
  assert.equal(f.current.agentRunning, false);
  assert.equal(f.current.notices.some(notice => notice.message === "synthetic startup refusal"), true);
  assert.equal(f.getDraft(f.draftKey).value, text);
  assert.equal(f.promotions.length, 0);
  assert.equal(activeSources(f).length, 0);
});

test("mounted warm stream: Strict replay leaves one current source and rejects retired-source delivery across keyed A/B/A", options, async t => {
  const f = await sessionFixture(t);
  await f.mount(f.existingOptions());
  assert.equal(activeSources(f).length, 1, "Strict cleanup/replay must leave a live selected stream");
  const current = activeSources(f)[0];
  const retiredReplay = f.sources.find(source => source !== current);
  assert.ok(retiredReplay, "real Strict Effects must exercise connection replacement");
  await f.connect(current);
  await f.settleMaintenance();
  const firstJoin = f.maintenanceHandle;
  await f.event(current, { type: "model_speed_change", modelSpeed: "fast" });
  assert.equal(f.current.modelSpeed, "fast");
  assert.equal(f.maintenanceHandle, firstJoin, "completion handle remains stable through rerender");
  await f.event(retiredReplay, { type: "model_speed_change", modelSpeed: "standard" });
  assert.equal(f.current.modelSpeed, "fast", "same-hook Strict source identity, not just mounted state");
  await f.mount(f.existingOptions(`${f.savedId}-B`));
  await f.settleMaintenance(firstJoin);
  assert.equal(current.readyState, 2);
  const middleJoin = f.maintenanceHandle;
  await f.mount(f.existingOptions(f.savedId));
  await f.settleMaintenance(middleJoin);
  assert.equal(activeSources(f).length, 1);
  const newA = activeSources(f)[0];
  assert.notEqual(newA, current);
  await f.connect(newA);
  await f.settleMaintenance();
  await f.event(newA, { type: "model_speed_change", modelSpeed: "fast" });
  const before = f.requests.length, finalJoin = f.maintenanceHandle;
  await f.event(current, { type: "connected", isStreaming: true });
  await f.event(current, { type: "model_speed_change", modelSpeed: "standard" });
  assert.equal(f.current.modelSpeed, "fast");
  assert.equal(f.current.agentRunning, false);
  assert.equal(f.requests.length, before);
  await f.unmount();
  await f.settleMaintenance(finalJoin);
  assert.equal(activeSources(f).length, 0);
  const sourceCount = f.sources.length;
  await f.event(newA, { type: "connected", isStreaming: true });
  await f.settleMaintenance(finalJoin);
  assert.equal(f.sources.length, sourceCount);
  assert.equal(f.requests.length, before);
});

test("mounted maintenance: connected receipt body remains owned after unmount through its actual handler", options, async t => {
  const f = await sessionFixture(t);
  await f.mount(f.existingOptions());
  const receipt = f.hold(request => request.path === `/api/sessions/${f.savedId}/context`);
  await f.connect(activeSources(f)[0]);
  await receipt.entered.promise;
  const outgoing = f.maintenanceHandle;
  let complete = false;
  const joining = await f.start("actual receipt maintenance join", () => outgoing().then(() => { complete = true; }));
  assert.equal(complete, false);
  await f.unmount();
  assert.equal(complete, false, "React cleanup is not body/receipt-handler settlement");
  await f.finish(joining, () => receipt.resolve({ context: f.snapshot(f.savedId).context }));
  assert.equal(complete, true);
  assert.equal(activeSources(f).length, 0);
});

for (const outcome of ["success", "HTTP failure"]) test(`mounted maintenance: mount-owned nested tools ${outcome} is joined after parent state delivery and unmount`, options, async t => {
  const f = await sessionFixture(t);
  const state = f.hold(request => request.path === `/api/sessions/${f.savedId}/state`);
  const tools = f.hold(command("get_tools"), { status: outcome === "success" ? 200 : 500 });
  if (outcome !== "success") f.expectConsoleError("Failed to load tools:", error => error?.message === "synthetic tools refusal" && error.status === 500);
  await f.mount(f.existingOptions());
  await f.connect(activeSources(f)[0]);
  await state.entered.promise;
  await f.deliver(state, { running: true, state: f.live(f.savedId) }); // idle alive wrapper; no prompt/bash poll
  await tools.entered.promise;
  const outgoing = f.maintenanceHandle;
  let complete = false;
  const joining = await f.start("mount continuation including independently observed tools", () => outgoing().then(() => { complete = true; }));
  assert.equal(complete, false);
  await f.unmount();
  await f.finish(joining, () => tools.resolve(outcome === "success" ? { success: true, data: [] } : { error: "synthetic tools refusal" }));
  assert.equal(complete, true, "existing loadTools catch/finally must settle too");
  assert.equal(activeSources(f).length, 0);
});

test("mounted maintenance: eager promotion does not certify detached creation metadata; full observed child is joined", options, async t => {
  const f = await sessionFixture(t), published = deferred();
  const creation = f.hold(request => request.path === "/api/agent/new");
  const metadata = f.hold(request => models(request) && request.query.get("sessionId") === f.savedId);
  const mountOptions = f.newOptions({ persistNewSession: true });
  const publish = mountOptions.onSessionCreated;
  mountOptions.onSessionCreated = (...args) => { publish(...args); published.resolve(); };
  await f.mount(mountOptions);
  const outgoing = f.maintenanceHandle;
  const startup = await f.start("shared creation public command", value => value.loadSlashCommands());
  let complete = false;
  const joining = await f.start("actual eager plus nested metadata join", () => outgoing().then(() => { complete = true; }));
  await f.deliver(creation, { sessionId: f.savedId });
  await Promise.all([metadata.entered.promise, published.promise]);
  await f.finish(startup);
  assert.equal(f.promotions.length, 1);
  assert.equal(complete, false, "the independently launched metadata body is still owned");
  await f.unmount();
  await f.finish(joining, () => metadata.resolve(f.metadata()));
  assert.equal(complete, true);
});

test("mounted lease: the actual selected owner registers and renews at exactly 30k", options, async t => {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  await f.mountReady(f.existingOptions());
  const intervals = time.intervals.filter(item => item.active && item.policy === "session-lease");
  assert.equal(intervals.length, 1, "Strict replay cancels the retired lease interval");
  assert.equal(intervals[0].ms, 30000);
  const lease = f.hold(request => request.path === `/api/agent/${f.savedId}/lease`);
  const before = leases(f).length;
  await act(async () => { time.advance(29999); });
  assert.equal(leases(f).length, before);
  await act(async () => { time.advance(1); });
  await lease.entered.promise;
  assert.equal(leases(f).length, before + 1);
  await f.deliver(lease, { renewed: 1 });
  await f.settleMaintenance();
  await f.unmount();
  assert.equal(intervals[0].active, false);
});

test("mounted lease: renewed zero reconnects current source and actual completion includes caught replacement readiness", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const original = activeSources(f)[0], lease = f.hold(request => request.path === `/api/agent/${f.savedId}/lease`);
  await visible(f);
  await lease.entered.promise;
  let complete = false;
  const joining = await f.start("actual current renewal and nested maintenance join", () => f.maintenanceHandle().then(() => { complete = true; }));
  assert.equal(complete, false);
  const replacementEntered = f.nextSource(source => source !== original && source.url === original.url);
  let replacement;
  await act(async () => { lease.resolve({ renewed: 0 }); replacement = await replacementEntered; });
  assert.equal(original.readyState, 2);
  assert.equal(complete, false, "lease handler completion must not lose the observed replacement attempt");
  await f.connect(replacement);
  await f.finish(joining);
  assert.equal(complete, true);
  assert.equal(activeSources(f).length, 1);
  await visible(f);
  await f.settleMaintenance();
  assert.equal(leases(f).length, 2, "renewing finally releases the next actual request");
});

for (const [outcome, stage, status] of [["HTTP failure", "headers", 503], ["JSON failure", "body", 200]]) {
  test(`mounted lease: ${outcome} joins existing catch/finally without reconnect and permits next renewal`, options, async t => {
    const f = await sessionFixture(t);
    await f.mountReady(f.existingOptions());
    const lease = f.hold(request => request.path === `/api/agent/${f.savedId}/lease`, { stage, status });
    const sourceCount = f.sources.length;
    await visible(f);
    await lease.entered.promise;
    let complete = false;
    const joining = await f.start("actual failing renewal promise", () => f.maintenanceHandle().then(() => { complete = true; }));
    assert.equal(complete, false);
    await f.finish(joining, () => stage === "body"
      ? lease.reject(new SyntaxError("synthetic lease JSON failure")) : lease.resolve({ error: "synthetic HTTP failure" }));
    assert.equal(complete, true);
    assert.equal(f.sources.length, sourceCount);
    assert.equal(f.current.error, null, "preserve existing lease failure feedback policy");
    await visible(f);
    await f.settleMaintenance();
    assert.equal(leases(f).length, 2, "failed renewal finally must clear its own renewing flag");
  });
}

for (const outcome of ["late zero", "late JSON failure"]) test(`mounted lease: keyed A/B/A ${outcome} cannot reconnect or release new A's renewal`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const oldLease = f.hold(request => request.path === `/api/agent/${f.savedId}/lease`);
  await visible(f);
  await oldLease.entered.promise;
  const outgoing = f.maintenanceHandle;
  await f.mountReady(f.existingOptions(`${f.savedId}-B`));
  await f.mountReady(f.existingOptions(f.savedId));
  const newLease = f.hold(request => request.path === `/api/agent/${f.savedId}/lease`);
  await visible(f);
  await newLease.entered.promise;
  let currentComplete = false;
  const currentJoin = await f.start("new A actual pending renewal", () => f.maintenanceHandle().then(() => { currentComplete = true; }));
  const oldJoin = await f.start("outgoing A exact completion", () => outgoing());
  const sourceCount = f.sources.length;
  await f.finish(oldJoin, () => outcome === "late zero"
    ? oldLease.resolve({ renewed: 0 }) : oldLease.reject(new SyntaxError("old body failed")));
  assert.equal(f.sources.length, sourceCount, "old generation cannot reconnect equal-ID new A");
  assert.equal(currentComplete, false);
  await visible(f);
  assert.equal(leases(f).length, 2, "old finally cannot clear the new instance's renewing flag");
  await f.finish(currentJoin, () => newLease.resolve({ renewed: 1 }));
  assert.equal(currentComplete, true);
  await visible(f);
  await f.settleMaintenance();
  assert.equal(leases(f).length, 3);
});

test("mounted lease: actual renewal remains joined across unmount and late zero cannot reopen stream", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const lease = f.hold(request => request.path === `/api/agent/${f.savedId}/lease`);
  await visible(f);
  await lease.entered.promise;
  const outgoing = f.maintenanceHandle, sourceCount = f.sources.length;
  let complete = false;
  const joining = await f.start("unmounted actual renewal join", () => outgoing().then(() => { complete = true; }));
  await f.unmount();
  assert.equal(activeSources(f).length, 0);
  assert.equal(complete, false);
  await f.finish(joining, () => lease.resolve({ renewed: 0 }));
  assert.equal(complete, true);
  assert.equal(f.sources.length, sourceCount);
  await act(() => f.view.window.document.dispatchEvent(new f.view.window.Event("visibilitychange")));
  await f.settleMaintenance(outgoing);
  assert.equal(leases(f).length, 1);
});
