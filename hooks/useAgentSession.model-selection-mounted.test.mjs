import "../lib/testing/client-native-boundary.fixture.mjs";
// Actual mounted selection owners; migration dispositions live in docs/test-ownership.md.
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { sessionFixture, provider, selected, command, detail, models } from "./agent-session-mounted.fixture.mjs";
const options = { timeout: 10000 };
const modelCommands = f => f.requests.filter(command("set_model"));

test("mounted selection: pending composer creation serializes before optimistic second click", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  const first = await f.start("first model selection waiting for creation", value => value.handleModelChange(provider, "A"));
  await f.run("second model selection must not be admitted", value => value.handleModelChange(provider, "B"));
  assert.equal(f.current.modelSwitching, true);
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(modelCommands(f).length, 0);
  await f.finish(first, () => creation.resolve({ sessionId: f.savedId, model: selected("B"), thinkingLevel: "off" }));
  assert.deepEqual(modelCommands(f).map(request => [request.body.provider, request.body.modelId]), [[provider, "A"]]);
  assert.equal(f.current.modelSwitching, false);
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.requests.filter(command("get_state")).length, 1);
  assert.equal(f.current.thinkingLevel, "off", "pending creation accepts actual thinking off");
});

test("mounted selection: existing selection is optimistic and ordinary canonical read preserves pending identity", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const beforeAck = f.requests.length;
  const canonicalRead = request => detail(request) || models(request) || request.path.endsWith("/state") || command("get_state")(request);
  const write = f.hold(command("set_model"));
  const selection = await f.start("held real model command", value => value.handleModelChange(provider, "A"));
  await write.entered.promise;
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.modelSwitching, true);
  await f.run("second optimistic click", value => value.handleModelChange(provider, "canonical"));
  assert.equal(modelCommands(f).length, 1);
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.deepEqual(f.requests.slice(beforeAck).filter(canonicalRead), [], "selection admits no detail/state/models before ACK");
  // /name owns a real non-force disk-only loadSession and its full continuation.
  await f.run("canonical read during pending selection", value => value.handleBuiltinSlashCommand("/name during-selection"));
  assert.equal(f.requests.slice(beforeAck).filter(detail).length, 1, "only separately invoked /name owns this disk read");
  assert.equal(f.requests.slice(beforeAck).filter(canonicalRead).length, 1, "no selection-induced state or models while ACK held");
  assert.deepEqual(f.current.data.context.model, selected("B"));
  assert.deepEqual(f.current.displayModel, selected("A"), "canonical updater must preserve pending optimistic model");
  f.record(f.savedId).model = "A";
  await f.finish(selection, () => write.resolve({ success: true, data: { provider, id: "A" } }));
  assert.equal(f.current.modelSwitching, false);
  assert.deepEqual(f.current.displayModel, selected("A"));
  const afterSelection = f.requests.length;
  f.record(f.savedId).model = "B";
  f.record(f.savedId).revision++;
  const laterBody = f.hold(detail);
  const laterRead = await f.start("later authoritative public canonical read", value => value.handleBuiltinSlashCommand("/name after-selection"));
  await laterBody.entered.promise;
  await f.finish(laterRead, () => laterBody.resolve(f.snapshot(f.savedId)));
  assert.equal(f.requests.slice(afterSelection).filter(detail).length, 1, "settled read is not blocked by a pending client flight");
  assert.deepEqual(f.current.data.context.model, selected("B"));
  assert.deepEqual(f.current.displayModel, selected("A"), "disk-only B does not supersede established live A");
  // Supply authoritative LIVE B through the actual registered public System loader.
  // Its get_state is independent of the disk-only loadSession flight above.
  const liveBody = f.hold(command("get_state"));
  const liveRead = await f.start("later authoritative public live B", () => f.loader());
  await liveBody.entered.promise;
  assert.equal(liveBody.request.path, `/api/agent/${f.savedId}`);
  assert.deepEqual(liveBody.request.body, { type: "get_state" });
  await f.finish(liveRead, () => liveBody.resolve({ success: true, data: { ...f.live(f.savedId), model: { provider, id: "B" } } }));
  assert.deepEqual(f.current.currentModel, selected("B"));
  assert.deepEqual(f.current.displayModel, selected("B"), "settled optimistic override releases to later live authority");
  const afterLaterRead = f.requests.length;
  await f.run("another public canonical read after full join", value => value.handleBuiltinSlashCommand("/name unblocked"));
  assert.equal(f.requests.slice(afterLaterRead).filter(detail).length, 1);
  assert.equal(f.current.modelSwitching, false);
});

test("mounted selection: warmed new composer reconciles canonical model/thinking after lost acknowledgement", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.newOptions({ persistNewSession: true }));
  await f.run("join eager startup", value => value.loadSlashCommands());
  await f.run("explicit thinking before lost model acknowledgement", value => value.handleThinkingLevelChange("high"));
  const write = f.hold(command("set_model"), { stage: "headers" });
  const selection = await f.start("lost selection acknowledgement", value => value.handleModelChange(provider, "A"));
  f.record(f.savedId).model = "canonical";
  f.record(f.savedId).thinking = "off";
  await f.finish(selection, () => write.reject(new TypeError("synthetic lost acknowledgement")));
  assert.deepEqual(f.current.displayModel, selected("canonical"));
  assert.equal(f.current.thinkingLevel, "off");
  assert.equal(f.current.modelSwitching, false);
  assert.ok(f.current.notices.some(notice => /lost acknowledgement/.test(notice.message)));
  assert.equal(f.requests.filter(models).at(-1).query.get("sessionId"), f.savedId);
});

for (const outcome of ["success", "lost acknowledgement"]) test(`mounted selection: existing ${outcome} reloads canonical disk/live/capabilities without force`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const before = f.requests.length;
  const lost = new TypeError("synthetic lost acknowledgement");
  if (outcome !== "success") f.expectConsoleError("Failed to set model:", error => error === lost);
  const write = f.hold(command("set_model"), { stage: outcome === "success" ? "body" : "headers" });
  const selection = await f.start("complete existing selection", value => value.handleModelChange(provider, "A"));
  f.record(f.savedId).model = "A";
  f.record(f.savedId).thinking = "off";
  f.record(f.savedId).window = 256000;
  f.record(f.savedId).revision++;
  await f.finish(selection, () => outcome === "success"
    ? write.resolve({ success: true, data: { provider, id: "A" } })
    : write.reject(lost));
  const admitted = f.requests.slice(before);
  assert.equal(admitted.filter(detail).length, 1);
  assert.equal(admitted.filter(detail)[0].query.has("force"), false, "fresh must not become an external disk probe");
  assert.equal(admitted.filter(request => request.path === `/api/sessions/${f.savedId}/state`).length, 1);
  assert.equal(admitted.filter(models).length, 1);
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "off");
  assert.equal(f.current.contextUsage.contextWindow, 256000);
  assert.deepEqual(f.current.modelThinkingLevelMaps[`${provider}:A`], { high: "low" });
  assert.equal(f.current.modelSwitching, false);
  if (outcome !== "success") assert.ok(f.current.notices.some(notice => /lost acknowledgement/.test(notice.message)));
});

test("mounted selection: failed second selection restores the actual prior optimistic identity until canonical reconciliation", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const firstBody = f.hold(request => detail(request) && !request.query.has("force"));
  const first = await f.start("first acknowledged selection with canonical body held", value => value.handleModelChange(provider, "old"));
  await firstBody.entered.promise;
  const firstSnapshot = f.snapshot(f.savedId);
  // The first command has acknowledged (pending admission released), but its
  // canonical read has not committed, so an actual prior override still exists.
  assert.deepEqual(f.current.displayModel, selected("old"));
  const secondWrite = f.hold(command("set_model"), { stage: "headers" });
  const secondBody = f.hold(request => detail(request) && !request.query.has("force"));
  const second = await f.start("second selection including lost-ack rollback", value => value.handleModelChange(provider, "A"));
  assert.deepEqual(f.current.displayModel, selected("A"));
  const lost = new TypeError("synthetic second acknowledgement lost");
  f.expectConsoleError("Failed to set model:", error => error === lost);
  await act(() => secondWrite.reject(lost));
  await secondBody.entered.promise;
  assert.deepEqual(f.current.displayModel, selected("old"), "restore actual previous override, not a fabricated default");
  assert.equal(f.current.modelSwitching, true, "canonical confirmation still pending");
  f.record(f.savedId).model = "canonical";
  f.record(f.savedId).revision++;
  await f.finish(second, () => secondBody.resolve(f.snapshot(f.savedId)));
  assert.deepEqual(f.current.displayModel, selected("canonical"));
  await f.finish(first, () => firstBody.resolve(firstSnapshot));
  assert.deepEqual(f.current.data.context.model, selected("canonical"));
  assert.equal(f.current.modelSwitching, false);
});

test("mounted selection: fresh canonical read bypasses held coalesced disk body and ignores old delivery", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  assert.ok(f.requests.filter(detail).every(request => request.query.get("force") === "1"), "only mount probes disk");
  const oldData = f.snapshot(f.savedId);
  const oldBody = f.hold(request => detail(request) && !request.query.has("force"));
  const oldRead = await f.start("real disk-only pre-selection read", value => value.handleBuiltinSlashCommand("/name before-selection"));
  await oldBody.entered.promise;
  const beforeSelection = f.requests.length;
  // Default transport applies the model to its synthetic canonical records.
  const selection = await f.start("fresh selection while disk-only body held", value => value.handleModelChange(provider, "A"));
  await f.finish(selection);
  assert.equal(f.requests.slice(beforeSelection).filter(detail).length, 1, "fresh bypasses old client flight");
  assert.equal(f.requests.slice(beforeSelection).filter(detail)[0].query.has("force"), false);
  assert.deepEqual(f.current.data.context.model, selected("A"));
  await f.finish(oldRead, () => oldBody.resolve(oldData));
  assert.deepEqual(f.current.data.context.model, selected("A"));
  assert.deepEqual(f.current.displayModel, selected("A"));
});

for (const outcome of ["success", "failure"]) test(`mounted selection: keyed A/B/A rejects old ${outcome}/finally while new A remains pending`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const oldWrite = f.hold(command("set_model"), { status: outcome === "failure" ? 500 : 200 });
  const oldSelection = await f.start("old A selection full handlers", value => value.handleModelChange(provider, "old"));
  await oldWrite.entered.promise;
  await f.mountReady(f.existingOptions(`${f.savedId}-B`));
  await f.mountReady(f.existingOptions(f.savedId)); // new key, equal session ID
  const newWrite = f.hold(command("set_model"));
  const newSelection = await f.start("new A selection full handlers", value => value.handleModelChange(provider, "A"));
  await newWrite.entered.promise;
  const beforeOldDelivery = f.requests.length;
  await f.finish(oldSelection, () => oldWrite.resolve(outcome === "failure"
    ? { error: "old selection failed" } : { success: true, data: { provider, id: "old" } }));
  assert.equal(f.requests.length, beforeOldDelivery, "retired A cannot launch canonical or metadata reads");
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.modelSwitching, true, "old finally cannot clear new A's pending selection");
  assert.equal(f.current.notices.some(notice => /old selection failed/.test(notice.message)), false);
  f.record(f.savedId).model = "A";
  await f.finish(newSelection, () => newWrite.resolve({ success: true, data: { provider, id: "A" } }));
  assert.equal(f.current.modelSwitching, false);
});

test("mounted selection: unmounted pending creation never dispatches the model selection", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  const selection = await f.start("selection waiting for outgoing creation", value => value.handleModelChange(provider, "A"));
  const outgoing = f.maintenanceHandle;
  await f.mountReady(f.newOptions({ newSessionDraftKey: `${f.draftKey}:next` }));
  await f.finish(selection, () => creation.resolve({ sessionId: f.savedId }));
  await f.settleMaintenance(outgoing);
  assert.equal(modelCommands(f).length, 0);
  assert.equal(f.current.modelSwitching, false);
  assert.deepEqual(f.current.displayModel, selected("B"));
});
