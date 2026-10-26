import "../lib/testing/client-native-boundary.fixture.mjs";
// Additive actual-hook witnesses for the exact legacy identity vocabulary.
// Parent must prefix its independent EARLY native boundary before integration.
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { sessionFixture, command, detail, models } from "./agent-session-mounted.fixture.mjs";
const options = { timeout: 10000 };
const identity = modelId => ({ provider: "fixture", modelId });
const vocabulary = ["A", "B", "canonical", "old", "new", "chosen", "not-sent", "requested", "actually-saved", "previous", "stale", "fresh", "pending"];
const exactFixture = (t, savedSessionId = "one") => sessionFixture(t, {
  fixtureProvider: "fixture", modelIds: vocabulary, savedSessionId,
});
const writes = f => f.requests.filter(command("set_model"));

test("legacy tuple 1: fixture A/B, pending creation warmed, thinking off", options, async t => {
  const f = await exactFixture(t, "warmed");
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  const first = await f.start("literal first A full chain", value => value.handleModelChange("fixture", "A"));
  await f.run("literal refused B", value => value.handleModelChange("fixture", "B"));
  assert.deepEqual(f.current.displayModel, identity("A"));
  assert.equal(f.current.modelSwitching, true);
  assert.equal(writes(f).length, 0);
  f.record("warmed").thinking = "off";
  await f.finish(first, () => creation.resolve({ sessionId: "warmed", model: identity("B"), thinkingLevel: "off" }));
  await f.settleMaintenance();
  assert.deepEqual(f.requests.filter(request => command("set_model")(request) || command("get_state")(request)).map(request => [request.path, request.body]), [
    ["/api/agent/warmed", { type: "set_model", provider: "fixture", modelId: "A" }],
    ["/api/agent/warmed", { type: "get_state" }],
  ]);
  assert.deepEqual(f.current.displayModel, identity("A"));
  assert.equal(f.current.thinkingLevel, "off");
  assert.equal(f.current.modelSwitching, false);
});

test("legacy tuple 2: one fixture chosen/not-sent, no selection reads before ACK", options, async t => {
  const f = await exactFixture(t);
  await f.mountReady(f.existingOptions());
  const before = f.requests.length;
  const write = f.hold(command("set_model"));
  const selection = await f.start("literal chosen held ACK", value => value.handleModelChange("fixture", "chosen"));
  await write.entered.promise;
  await f.run("literal refused not-sent", value => value.handleModelChange("fixture", "not-sent"));
  assert.deepEqual(f.current.displayModel, identity("chosen"));
  assert.equal(f.current.modelSwitching, true);
  assert.deepEqual(f.requests.slice(before).map(request => [request.path, request.body]), [
    ["/api/agent/one", { type: "set_model", provider: "fixture", modelId: "chosen" }],
  ]);
  await f.run("separate legitimate name read", value => value.handleBuiltinSlashCommand("/name literal-pending"));
  assert.deepEqual(f.current.data.context.model, identity("B"));
  assert.deepEqual(f.current.displayModel, identity("chosen"));
  assert.equal(f.requests.slice(before).filter(detail).length, 1);
  assert.equal(f.requests.slice(before).filter(request => models(request) || request.path.endsWith("/state") || command("get_state")(request)).length, 0);
  f.record("one").model = "chosen";
  await f.finish(selection, () => write.resolve({ success: true, data: { provider: "fixture", id: "chosen" } }));
  assert.deepEqual(f.current.displayModel, identity("chosen"));
  assert.equal(f.current.modelSwitching, false);
  f.record("one").model = "B"; f.record("one").revision++;
  await f.run("literal later disk B", value => value.handleBuiltinSlashCommand("/name literal-settled"));
  assert.deepEqual(f.current.data.context.model, identity("B"));
  // /name is disk-only; the prior live chosen model still outranks disk B.
  // The registered real System loader supplies the separately authoritative live read.
  const beforeState = f.requests.length;
  await f.run("literal later authoritative live B", () => f.loader());
  assert.deepEqual(f.requests.slice(beforeState).filter(command("get_state")).map(request => [request.path, request.body]), [
    ["/api/agent/one", { type: "get_state" }],
  ]);
  assert.deepEqual(f.current.currentModel, identity("B"));
  assert.deepEqual(f.current.displayModel, identity("B"), "settled chosen override must not mask authoritative live B");
  const after = f.requests.length;
  await f.run("literal another public canonical read", value => value.handleBuiltinSlashCommand("/name literal-unblocked"));
  assert.equal(f.requests.slice(after).filter(detail).length, 1);
});

test("legacy tuple 3: warmed fixture requested/actually-saved high to off lost ACK", options, async t => {
  const f = await exactFixture(t, "warmed");
  await f.mountReady(f.newOptions({ persistNewSession: true }));
  await f.run("join warmed constructor", value => value.loadSlashCommands());
  await f.run("literal explicit high", value => value.handleThinkingLevelChange("high"));
  const write = f.hold(command("set_model"), { stage: "headers" });
  const selection = await f.start("literal requested lost acknowledgement", value => value.handleModelChange("fixture", "requested"));
  f.record("warmed").model = "actually-saved"; f.record("warmed").thinking = "off";
  await f.finish(selection, () => write.reject(new Error("synthetic lost acknowledgement")));
  assert.deepEqual(writes(f).at(-1).body, { type: "set_model", provider: "fixture", modelId: "requested" });
  assert.deepEqual(f.current.displayModel, identity("actually-saved"));
  assert.equal(f.current.thinkingLevel, "off");
  assert.equal(f.current.modelSwitching, false);
  assert.ok(f.current.notices.some(notice => /lost acknowledgement/.test(notice.message)));
  assert.equal(f.requests.filter(models).at(-1).query.get("sessionId"), "warmed");
});

test("legacy tuple 4: one fixture new successful canonical disk/live capabilities", options, async t => {
  const f = await exactFixture(t);
  await f.mountReady(f.existingOptions());
  const before = f.requests.length;
  f.record("one").thinking = "off"; f.record("one").window = 256000;
  await f.run("literal new successful selection", value => value.handleModelChange("fixture", "new"));
  const reads = f.requests.slice(before);
  assert.deepEqual(writes(f).at(-1).body, { type: "set_model", provider: "fixture", modelId: "new" });
  assert.equal(reads.filter(detail).length, 1);
  assert.equal(reads.filter(detail)[0].query.has("force"), false);
  assert.equal(reads.filter(request => request.path === "/api/sessions/one/state").length, 1);
  assert.equal(reads.filter(models).length, 1);
  assert.deepEqual(f.current.displayModel, identity("new"));
  assert.equal(f.current.thinkingLevel, "off");
  assert.equal(f.current.contextUsage.contextWindow, 256000);
  assert.equal(f.current.modelSwitching, false);
});

test("legacy tuple 5: one fixture previous/new lost ACK restores actual prior identity", options, async t => {
  const f = await exactFixture(t);
  await f.mountReady(f.existingOptions());
  const oldBody = f.hold(detail);
  const prior = await f.start("genuine previous selection, canonical body held", value => value.handleModelChange("fixture", "previous"));
  await oldBody.entered.promise;
  const oldSnapshot = f.snapshot("one");
  assert.deepEqual(f.current.displayModel, identity("previous"));
  const write = f.hold(command("set_model"), { stage: "headers" });
  const body = f.hold(detail);
  const before = f.requests.length;
  const selection = await f.start("literal new lost ACK", value => value.handleModelChange("fixture", "new"));
  const lost = new Error("synthetic lost acknowledgement");
  f.expectConsoleError("Failed to set model:", error => error === lost);
  await act(() => write.reject(lost));
  await body.entered.promise;
  assert.deepEqual(f.current.displayModel, identity("previous"), "real previous optimism survives until current canonical body");
  assert.equal(f.current.modelSwitching, true);
  f.record("one").model = "new"; f.record("one").revision++;
  await f.finish(selection, () => body.resolve(f.snapshot("one")));
  assert.deepEqual(f.current.displayModel, identity("new"));
  assert.ok(f.current.notices.some(notice => /Failed to switch model:.*lost acknowledgement/.test(notice.message)));
  assert.equal(f.current.modelSwitching, false);
  await f.finish(prior, () => oldBody.resolve(oldSnapshot));
  assert.deepEqual(f.current.displayModel, identity("new"));
  assert.equal(f.requests.slice(before).filter(detail).length, 1);
  assert.equal(f.requests.slice(before).filter(detail)[0].query.has("force"), false);
  assert.equal(f.requests.slice(before).filter(models).length, 1);
});

test("legacy tuple 6: one fixture stale/fresh/pending canonical loader full joins", options, async t => {
  const f = await exactFixture(t);
  f.record("one").model = "stale";
  f.record("one").leaf = "stale";
  await f.mountReady(f.existingOptions());
  const staleSnapshot = f.snapshot("one", { leafId: "stale", snapshotRevision: "stale" });
  const oldBody = f.hold(detail);
  const oldRead = await f.start("literal stale disk flight", value => value.handleBuiltinSlashCommand("/name stale"));
  await oldBody.entered.promise;
  const freshBody = f.hold(detail);
  const before = f.requests.length;
  const selection = await f.start("literal fresh selection bypasses old flight", value => value.handleModelChange("fixture", "fresh"));
  await freshBody.entered.promise;
  f.record("one").thinking = "off"; f.record("one").window = 256000;
  f.record("one").leaf = "fresh";
  await f.finish(selection, () => freshBody.resolve(f.snapshot("one", { leafId: "fresh", snapshotRevision: "fresh" })));
  assert.equal(f.requests.slice(before).filter(detail).length, 1);
  assert.equal(f.requests.slice(before).filter(detail)[0].query.has("force"), false);
  assert.deepEqual(f.current.data.context.model, identity("fresh"));
  assert.equal(f.current.thinkingLevel, "off");
  assert.equal(f.current.contextUsage.contextWindow, 256000);
  await f.finish(oldRead, () => oldBody.resolve(staleSnapshot));
  assert.deepEqual(f.current.data.context.model, identity("fresh"));
  assert.equal(f.current.activeLeafId, "fresh", "late literal stale leaf is inert");
  const write = f.hold(command("set_model"));
  const pending = await f.start("literal pending optimism", value => value.handleModelChange("fixture", "pending"));
  await write.entered.promise;
  await f.run("actual canonical updater while literal pending", value => value.handleBuiltinSlashCommand("/name pending"));
  assert.deepEqual(f.current.data.context.model, identity("fresh"));
  assert.deepEqual(f.current.displayModel, identity("pending"));
  await f.finish(pending, () => write.resolve({ success: true, data: { provider: "fixture", id: "fresh" } }));
  assert.deepEqual(f.current.displayModel, identity("fresh"));
  const after = f.requests.length;
  await f.run("another read after stale/current full joins", value => value.handleBuiltinSlashCommand("/name fresh"));
  assert.equal(f.requests.slice(after).filter(detail).length, 1);
  assert.equal(f.current.modelSwitching, false);
});

for (const outcome of ["success", "failure"]) test(`legacy tuple 7/8: one to different fixture old late ${outcome} is inert`, options, async t => {
  const f = await exactFixture(t);
  await f.mountReady(f.existingOptions());
  const write = f.hold(command("set_model"), { status: outcome === "failure" ? 500 : 200 });
  const old = await f.start("literal outgoing one/old selection", value => value.handleModelChange("fixture", "old"));
  await write.entered.promise;
  const sameHook = f.maintenanceHandle;
  f.declareSession("different");
  const tools = f.hold(command("set_tools"));
  const replacement = await f.start("public reachable same-hook replacement", value => value.handleToolPresetChange("none"));
  await f.finish(replacement, () => tools.resolve({ success: true, data: { sessionId: "different", recreated: true } }));
  assert.equal(f.current.sessionIdRef.current, "different");
  // This is the SAME hook fiber: the mount-only reset does not rerun.
  // Connect the receiving-prop source before joining its real readiness work.
  await f.rerender(f.existingOptions("different"));
  const active = f.sources.filter(source => source.readyState !== 2);
  assert.equal(active.length, 1);
  assert.equal(active[0].url, "/api/agent/different/events");
  await f.connect(active[0]);
  await f.settleMaintenance(sameHook);
  assert.equal(f.maintenanceHandle, sameHook, "changed ID must not become a keyed remount witness");
  assert.equal(f.current.modelSwitching, true);
  const beforeRefused = f.requests.length;
  await f.run("same-hook second selection is still serialized", value => value.handleModelChange("fixture", "new"));
  assert.equal(f.requests.length, beforeRefused, "no second model command is admitted while old selection awaits ACK");
  const modelBeforeOld = f.current.displayModel;
  const before = f.requests.length;
  await f.finish(old, () => write.resolve(outcome === "failure" ? { error: "old failure" } : { success: true, data: { provider: "fixture", id: "old" } }));
  assert.equal(f.requests.length, before);
  assert.equal(f.current.sessionIdRef.current, "different");
  assert.deepEqual(f.current.displayModel, modelBeforeOld);
  assert.equal(f.current.modelSwitching, true, "old finally cannot publish an unlock after same-hook ID change");
  assert.equal(f.current.notices.some(notice => /old failure/.test(notice.message)), false);
  await f.settleMaintenance(sameHook);
  await f.settleMaintenance(f.maintenanceHandle);
});

test("legacy tuple 9: unmounted fixture A pending creation warmed dispatches nothing", options, async t => {
  const f = await exactFixture(t, "warmed");
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  const selection = await f.start("literal pending A before actual unmount", value => value.handleModelChange("fixture", "A"));
  const outgoing = f.maintenanceHandle;
  await f.unmount();
  const before = f.requests.length;
  await f.finish(selection, () => creation.resolve({ sessionId: "warmed" }));
  await f.settleMaintenance(outgoing);
  assert.equal(writes(f).length, 0);
  assert.equal(f.requests.slice(before).some(request => command("get_state")(request)), false);
});

for (const leaving of [false, true]) test(`legacy persistence account: fixture-provider/new-account/saved after creation, departure=${leaving}`, options, async t => {
  const f = await sessionFixture(t, { fixtureProvider: "fixture-provider", savedSessionId: "saved", fixtureCwd: "/new-project" });
  const creation = f.hold(request => request.path === "/api/agent/new");
  const draftKey = "new:temporary:/new-project";
  const outgoingDraft = { value: "literal outgoing alias payload", images: [] };
  await f.mount(f.newOptions({ newSessionDraftKey: draftKey, persistNewSession: true }));
  // The real draft-store is process-private and intentionally survives realms.
  // Establish the original empty target for each repeated literal saved ID;
  // otherwise the prior tuple's text is correctly merged by production.
  f.setDraft("saved", { value: "", images: [] });
  assert.equal(f.getDraft("saved"), null);
  f.setDraft(draftKey, outgoingDraft);
  const selection = await f.start("exact legacy account body/full rejection", value => value.handleSessionAccountChange(
    "fixture-provider", "new-account", { "fixture-provider": "new-account" }), leaving ? { rejects: /Session selection changed/ } : {});
  assert.equal(f.requests.some(request => request.path === "/api/auth/accounts/selection"), false);
  const outgoing = f.maintenanceHandle;
  if (leaving) await f.unmount();
  await f.finish(selection, () => creation.resolve({ sessionId: "saved" }));
  await f.settleMaintenance(outgoing);
  assert.deepEqual(f.requests.filter(request => request.path === "/api/auth/accounts/selection").map(request => request.body), leaving ? [] : [
    { scope: "session", sessionId: "saved", provider: "fixture-provider", accountId: "new-account" },
  ]);
  assert.deepEqual(f.rekeys, leaving ? [] : [[draftKey, "saved"]], "only the still-mounted input receives the exact alias pair");
  assert.deepEqual(f.getDraft("saved"), outgoingDraft, "actual storage rekeys the literal outgoing draft even after departure");
  assert.equal(f.getDraft(draftKey), null, "the exact old storage key is consumed, not an unrelated draft");
});

// SOURCE-ONLY additions. Parent must run positive and isolated setter faults.
// No private hook state/ref/setter is read or changed by these witnesses.
test("hidden public A30: automatic new composer adopts ensure B before account-scoped metadata can overwrite it", options, async t => {
  const f = await exactFixture(t);
  f.setCatalog({ model: "A", thinking: "high", thinkingPins: {} });
  await f.mountReady(f.newOptions({ persistNewSession: false }));
  assert.deepEqual(f.current.displayModel, identity("A"));
  assert.equal(f.current.thinkingLevel, "high");
  const owner = f.maintenanceHandle, store = f.current.streamingStore;
  const creation = f.hold(request => request.path === "/api/agent/new");
  const metadata = f.hold(request => models(request) && request.query.get("sessionId") === "one", { stage: "headers", repeat: true });
  const constructorResult = { sessionId: "one", model: identity("B"), thinkingLevel: "off" };
  try {
    const initialize = await f.start("public nonpromoting initializer with real ensure", value => value.loadSlashCommands());
    await creation.entered.promise;
    assert.equal(Object.hasOwn(creation.request.body, "modelId"), false);
    assert.equal(Object.hasOwn(creation.request.body, "thinkingLevel"), false);
    // The atomic constructor is newer than the already-rendered catalog A.
    // Its subsequent real metadata is also B, but remains header-held below.
    f.setCatalog({ model: "B", thinking: "off", thinkingPins: {} });
    f.record("one").model = "B"; f.record("one").thinking = "off";
    await f.finish(initialize, () => creation.resolve(constructorResult));
    await metadata.entered.promise;
    assert.equal(metadata.done, false);
    assert.equal(f.current.isNew, true);
    assert.equal(f.current.isAutoModelSelection, true);
    assert.equal(f.current.newSessionModel, null);
    assert.deepEqual(f.current.currentModel, identity("B"));
    assert.deepEqual(f.current.displayModel, identity("B"), "automatic display observes the ensure default, not merely pending B");
    assert.equal(f.current.thinkingLevel, "off");
    assert.equal(f.maintenanceHandle === owner, true);
    assert.equal(f.current.streamingStore === store, true);
    assert.deepEqual(f.promotions, [], "loadSlashCommands does not promote or replace the draft");
    assert.equal(f.requests.some(command("get_state")), false, "no live state read masks the constructor projection");
    await f.deliver(metadata, f.metadata());
    await f.settleMaintenance(owner);
    f.assertNoFailures();
  } finally {
    // Synchronous release before any subsequent teardown/public/maintenance await.
    creation.resolve(constructorResult);
    metadata.resolve(f.metadata());
  }
});

test("hidden public A35: real creation callback receives saved props on the same fiber before any authoritative read body", options, async t => {
  const f = await sessionFixture(t, { fixtureProvider: "fixture", modelIds: vocabulary,
    savedSessionId: "one", receiveCreatedSession: true });
  f.setCatalog({ model: "A", thinking: "high", thinkingPins: {} });
  const initial = f.newOptions({ persistNewSession: false });
  await f.mountReady(initial);
  assert.equal(f.current.isNew, true);
  assert.equal(f.current.thinkingLevel, "high");
  const owner = f.maintenanceHandle, store = f.current.streamingStore;
  const creation = f.hold(request => request.path === "/api/agent/new");
  const metadata = f.hold(request => models(request) && request.query.get("sessionId") === "one", { stage: "headers", repeat: true });
  const history = f.hold(detail, { stage: "headers", repeat: true });
  const state = f.hold(request => request.method === "GET" && (request.path === "/api/sessions/one/state" || request.path === "/api/agent/one"), { stage: "headers", repeat: true });
  const rpcState = f.hold(command("get_state"), { stage: "headers", repeat: true });
  const context = f.hold(request => request.path === "/api/sessions/one/context", { stage: "headers", repeat: true });
  const constructorResult = { sessionId: "one", model: identity("B"), thinkingLevel: "off" };
  try {
    await f.rerender({ ...initial, persistNewSession: true });
    await creation.entered.promise;
    f.record("one").model = "B"; f.record("one").thinking = "off";
    await f.deliver(creation, constructorResult);
    await metadata.entered.promise;
    assert.equal(f.promotions.length, 1);
    assert.equal(f.promotions[0].session.id, "one");
    assert.equal(f.promotions[0].key, initial.newSessionDraftKey);
    assert.equal(f.promotions[0].session.relation, undefined, "ordinary root session, not subagent policy");
    assert.equal(f.current.isNew, false, "only the real onSessionCreated argument supplied receiving saved props");
    assert.equal(f.maintenanceHandle === owner, true, "no hook incarnation/key reset at receiving promotion");
    assert.equal(f.current.streamingStore === store, true);
    assert.equal(f.current.data, null, "no canonical history has installed a context-thinking fallback");
    assert.equal([metadata, history, state, rpcState, context].every(gate => !gate.done), true);
    assert.equal(f.current.thinkingLevel, "off", "saved-mode public thinking exposes the ensure LIVE write before read overwrite");
    assert.equal(JSON.parse(f.view.container.querySelector('[data-testid="session-probe"]').textContent).thinking, "off");
    const active = f.sources.filter(source => source.readyState !== 2);
    assert.equal(active.length, 1);
    assert.equal(active[0].url, "/api/agent/one/events");
    // Release every peer BEFORE connection/maintenance waits. Later delivery is
    // cleanup/continuation ownership, never the evidence for the assertion above.
    metadata.resolve(f.metadata()); history.resolve(f.snapshot("one"));
    state.resolve({ running: false, state: f.live("one") });
    rpcState.resolve({ success: true, data: f.live("one") });
    context.resolve({ context: f.snapshot("one").context });
    await f.connect(active[0]);
    await f.settleMaintenance(owner);
    f.assertNoFailures();
  } finally {
    creation.resolve(constructorResult);
    metadata.resolve(f.metadata()); history.resolve(f.snapshot("one"));
    state.resolve({ running: false, state: f.live("one") });
    rpcState.resolve({ success: true, data: f.live("one") });
    context.resolve({ context: f.snapshot("one").context });
  }
});

for (const target of ["chosen", "new"]) test(`hidden public C64/C88: ACK LIVE ${target} wins before canonical release, independent of its optimistic override`, options, async t => {
  const f = await exactFixture(t);
  await f.mountReady(f.existingOptions());
  assert.deepEqual(f.current.displayModel, identity("B"));
  const owner = f.maintenanceHandle, store = f.current.streamingStore;
  const oldSnapshot = f.snapshot("one");
  const write = f.hold(command("set_model"));
  // This B snapshot belongs to a legitimate disk read started WHILE ACK was
  // pending, not an invented stale disk after Pi's synchronous model append.
  const pendingRead = f.hold(detail);
  const freshCanonical = f.hold(detail);
  const state = f.hold(request => request.path === "/api/sessions/one/state", { stage: "headers", repeat: true });
  const rpcState = f.hold(command("get_state"), { stage: "headers", repeat: true });
  const metadata = f.hold(models, { stage: "headers", repeat: true });
  const before = f.requests.length;
  try {
    const selection = await f.start(`real ${target} selection ACK and full canonical chain`, value => value.handleModelChange("fixture", target));
    await write.entered.promise;
    const diskRead = await f.start("separately admitted /name during this exact selection version", value => value.handleBuiltinSlashCommand(`/name pending-${target}`));
    await pendingRead.entered.promise;
    assert.deepEqual(f.current.displayModel, identity(target));
    // The server durably chose target before it acknowledges; default later
    // canonical/live responses now agree. Only the pre-ACK read retained B.
    f.record("one").model = target; f.record("one").revision++;
    await f.deliver(write, { success: true, data: { provider: "fixture", id: target } });
    await freshCanonical.entered.promise;
    assert.equal(freshCanonical.done, false);
    assert.equal(freshCanonical.request.query.has("force"), false);
    await f.finish(diskRead, () => pendingRead.resolve(oldSnapshot));
    assert.deepEqual(f.current.data.context.model, identity("B"));
    assert.deepEqual(f.current.currentModel, identity(target), "LIVE command ACK, not pending/disk/canonical state, supplies currentModel");
    assert.deepEqual(f.current.displayModel, identity(target));
    assert.equal(f.current.modelSwitching, true, "the original selection still owns held canonical work");
    assert.equal(f.maintenanceHandle === owner, true);
    assert.equal(f.current.streamingStore === store, true);
    assert.equal([freshCanonical, state, rpcState, metadata].every(gate => !gate.done), true);
    assert.equal(f.requests.slice(before).filter(request => request.path === "/api/sessions/one/state" || command("get_state")(request) || models(request)).length, 0,
      "no subsequent live/canonical metadata can mask an omitted ACK setter");
    assert.deepEqual(write.request.body, { type: "set_model", provider: "fixture", modelId: target });
    await f.finish(selection, () => {
      freshCanonical.resolve(f.snapshot("one"));
      state.resolve({ running: false, state: f.live("one") });
      rpcState.resolve({ success: true, data: f.live("one") });
      metadata.resolve(f.metadata());
    });
    await f.settleMaintenance(owner);
    assert.deepEqual(f.current.displayModel, identity(target));
    assert.equal(f.current.modelSwitching, false);
    f.assertNoFailures();
  } finally {
    write.resolve({ success: true, data: { provider: "fixture", id: target } });
    pendingRead.resolve(oldSnapshot); freshCanonical.resolve(f.snapshot("one"));
    state.resolve({ running: false, state: f.live("one") });
    rpcState.resolve({ success: true, data: f.live("one") });
    metadata.resolve(f.metadata());
  }
});
