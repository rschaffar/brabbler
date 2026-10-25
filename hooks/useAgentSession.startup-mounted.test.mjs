import "../lib/testing/client-native-boundary.fixture.mjs";
// Actual mounted startup owners; migration dispositions live in docs/test-ownership.md.
import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture, provider, selected, models, command } from "./agent-session-mounted.fixture.mjs";

const options = { timeout: 10000 };
const creations = f => f.requests.filter(request => request.path === "/api/agent/new");
const commands = f => f.requests.filter(request => request.method === "POST" && /^\/api\/agent\/[^/]+$/.test(request.path));

test("mounted startup: implicit catalog defaults/pins are displayed but omitted from lazy creation", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  assert.equal(creations(f).length, 0, "passive project browsing remains lazy");
  assert.deepEqual(f.current.displayModel, selected("B"));
  assert.equal(f.current.thinkingLevel, "high");
  await f.run("real System initializer", () => f.loader());
  await f.settleMaintenance();
  assert.equal(creations(f).length, 1);
  const body = creations(f)[0].body;
  assert.equal(body.type, "ensure_session");
  for (const key of ["provider", "modelId", "thinkingLevel", "toolNames", "message"]) {
    assert.equal(Object.hasOwn(body, key), false, `implicit ${key} must be omitted`);
  }
  assert.equal(commands(f).some(request => request.body.type === "prompt"), false);
  assert.equal(f.current.systemPrompt, `system:${f.savedId}`);
});

test("mounted startup: explicit model and thinking off are captured atomically in creation", options, async t => {
  const f = await sessionFixture(t, { preset: "none" });
  await f.mountReady();
  await f.run("choose model before creation", value => value.handleModelChange(provider, "A"));
  await f.run("explicit thinking off before creation", value => value.handleThinkingLevelChange("off"));
  assert.equal(creations(f).length, 0);
  await f.run("public commands initializer", value => value.loadSlashCommands());
  const body = creations(f)[0].body;
  assert.deepEqual({ provider: body.provider, modelId: body.modelId, thinkingLevel: body.thinkingLevel, toolNames: body.toolNames },
    { provider, modelId: "A", thinkingLevel: "off", toolNames: [] });
  assert.equal(commands(f).some(request => ["set_model", "set_thinking_level", "prompt"].includes(request.body.type)), false,
    "startup choices are constructor intent, not replayed RPC setters");
});

test("mounted startup: held eager creation cannot replace newer explicit model/thinking", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  await creation.entered.promise;
  const model = await f.start("model change waiting for eager creation", value => value.handleModelChange(provider, "A"));
  const thinking = await f.start("thinking change waiting for eager creation", value => value.handleThinkingLevelChange("off"));
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "off");
  await f.finish(model, () => creation.resolve({ sessionId: f.savedId, model: selected("B"), thinkingLevel: "low" }));
  await f.finish(thinking);
  await f.settleMaintenance();
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "off");
  assert.equal(creations(f).length, 1, "Strict replay and both actions share creation");
  assert.equal(Object.hasOwn(creations(f)[0].body, "modelId"), false, "request captured before explicit selection");
});

test("mounted startup: untouched composer adopts canonical startup model/thinking and metadata never overwrites explicit thinking", options, async t => {
  const f = await sessionFixture(t);
  f.setCatalog({ model: "canonical", thinking: "low", thinkingPins: {} });
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  const startup = await f.start("join shared creation using commands", value => value.loadSlashCommands());
  await f.finish(startup, () => creation.resolve({ sessionId: f.savedId, model: selected("canonical"), thinkingLevel: "low" }));
  await f.settleMaintenance();
  assert.deepEqual(f.current.displayModel, selected("canonical"));
  assert.equal(f.current.thinkingLevel, "low");
  await f.run("explicit warmed thinking", value => value.handleThinkingLevelChange("off"));
  f.setCatalog({ model: "canonical", thinking: "high", thinkingPins: { [`${provider}/canonical`]: "high" } });
  await f.run("actual metadata refresh", value => value.loadModels());
  assert.equal(f.current.thinkingLevel, "off", "metadata cannot replace warmed explicit thinking");
});

for (const explicit of [false, true]) test(`mounted startup: pre-creation metadata follows refreshed pins only without explicit thinking: ${explicit}`, options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  assert.equal(f.current.thinkingLevel, "high");
  if (explicit) await f.run("explicit high before constructor admission", value => value.handleThinkingLevelChange("high"));
  f.setCatalog({ model: "A", thinking: "low", thinkingPins: { [`${provider}/A`]: "off" } });
  await f.run("actual sessionless metadata refresh", value => value.loadModels());
  assert.equal(creations(f).length, 0, "metadata refresh must not create a session");
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, explicit ? "high" : "off");
  assert.equal(f.requests.filter(models).at(-1).query.has("sessionId"), false);
});

test("mounted startup: account change during creation waits and targets saved ID", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  const selection = await f.start("account change including PUT handlers", value =>
    value.handleSessionAccountChange(provider, "account-A", { [provider]: "account-A" }));
  assert.equal(f.requests.some(request => request.path === "/api/auth/accounts/selection"), false);
  await f.finish(selection, () => creation.resolve({ sessionId: f.savedId }));
  assert.deepEqual(f.requests.filter(request => request.path === "/api/auth/accounts/selection").map(request => request.body),
    [{ scope: "session", sessionId: f.savedId, provider, accountId: "account-A" }]);
  await f.run("account-scoped metadata refresh", value => value.loadModels());
  const metadata = f.requests.filter(models).at(-1);
  assert.equal(metadata.query.get("sessionId"), f.savedId);
  assert.equal(metadata.query.has("accounts"), false, "saved session owns account resolution");
});

test("mounted startup: keyed departure refuses account PUT and rekeys only outgoing draft before publication", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  f.setDraft(f.draftKey, { value: "  outgoing\nunsent  ", images: [] });
  const selection = await f.start("outgoing account rejection", value =>
    value.handleSessionAccountChange(provider, "account-A", { [provider]: "account-A" }), { rejects: /Session selection changed/ });
  const outgoing = f.maintenanceHandle;
  const nextKey = `${f.draftKey}:next`;
  f.setDraft(nextKey, { value: "next input", images: [] });
  await f.mountReady(f.newOptions({ newSessionDraftKey: nextKey })); // distinct keyed incarnation, same realm
  await f.finish(selection, () => creation.resolve({ sessionId: f.savedId }));
  await f.settleMaintenance(outgoing);
  assert.equal(f.requests.some(request => request.path === "/api/auth/accounts/selection"), false);
  assert.deepEqual(f.rekeys, [], "retired composer must not use the current input handle");
  assert.equal(f.getDraft(f.draftKey), null);
  assert.equal(f.getDraft(f.savedId).value, "  outgoing\nunsent  ");
  assert.equal(f.getDraft(nextKey).value, "next input");
  assert.equal(f.promotions.length, 1);
  assert.equal(f.promotions[0].key, f.draftKey);
  assert.equal(f.promotions[0].draftAtCallback.value, "  outgoing\nunsent  ", "rekey precedes publication");
});

test("mounted startup: mounted input rekeys before real-ID publication", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  f.setDraft(f.draftKey, { value: "literal draft", images: [] });
  const startup = await f.start("join eager startup", value => value.loadSlashCommands());
  await f.finish(startup, () => creation.resolve({ sessionId: f.savedId }));
  await f.settleMaintenance();
  assert.deepEqual(f.rekeys, [[f.draftKey, f.savedId]]);
  assert.equal(f.promotions[0].draftAtCallback.value, "literal draft");
});

test("mounted startup: failed creation retains provisional text without promotion or rekey", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new", { stage: "headers", status: 500 });
  await f.mount(f.newOptions({ persistNewSession: true }));
  f.setDraft(f.draftKey, { value: "keep failed draft", images: [] });
  const startup = await f.start("failed initializer including ensure finally", value => value.loadSlashCommands(), { rejects: /HTTP 500/ });
  await f.finish(startup, () => creation.resolve({ error: "synthetic creation failure" }));
  await f.settleMaintenance();
  assert.match(f.current.error, /HTTP 500/);
  assert.equal(f.current.sessionIdRef.current, null);
  assert.deepEqual(f.promotions, []);
  assert.deepEqual(f.rekeys, []);
  assert.equal(f.getDraft(f.draftKey).value, "keep failed draft");
  // A public second attempt proves the old single-flight finally was released.
  await f.run("explicit retry after failed creation", value => value.loadSlashCommands());
  assert.equal(creations(f).length, 2);
});

for (const explicit of [false, true]) test(`mounted startup: rejected creation after leaving restores only ${explicit ? "explicit-New" : "not passive"} outgoing text`, options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new", { stage: "headers", status: 500 });
  await f.mount(f.newOptions({ persistNewSession: explicit }));
  f.expectConsoleError("Failed to send message:", error => error?.message === "HTTP 500");
  const send = await f.start("real rejected Send including restore/finally", value => value.handleSend("  rejected text\nkeep spacing  "));
  await creation.admitted.promise;
  const outgoing = f.maintenanceHandle;
  const nextKey = `${f.draftKey}:next`;
  f.setDraft(nextKey, { value: "next input", images: [] });
  await f.mount(f.newOptions({ newSessionDraftKey: nextKey }));
  await f.finish(send, () => creation.resolve({ error: "synthetic failed startup" }));
  await f.settleMaintenance(outgoing);
  assert.equal(f.getDraft(f.draftKey)?.value ?? null, explicit ? "  rejected text\nkeep spacing  " : null);
  assert.equal(f.getDraft(nextKey).value, "next input");
  assert.deepEqual(f.restores, [], "retired Send cannot touch next mounted input");
  assert.equal(commands(f).some(request => request.body.type === "prompt"), false);
});

test("mounted existing session: empty persisted composer displays catalog default", options, async t => {
  const f = await sessionFixture(t);
  f.record(f.savedId).model = null;
  await f.mountReady(f.existingOptions());
  assert.equal(f.current.data.context.messages.length, 0);
  assert.deepEqual(f.current.displayModel, selected("B"));
});

test("mounted existing session: newer live wrapper model wins over persisted metadata", options, async t => {
  const f = await sessionFixture(t);
  f.record(f.savedId).model = "old";
  const state = f.hold(request => request.path === `/api/sessions/${f.savedId}/state`);
  await f.mount(f.existingOptions());
  await state.entered.promise;
  assert.deepEqual(f.current.data.context.model, selected("old"));
  await f.connect(f.sources.at(-1));
  await f.deliver(state, { running: false, state: { ...f.live(f.savedId), model: { provider, id: "A" } } });
  await f.settleMaintenance();
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.deepEqual(f.current.data.context.model, selected("old"));
});

test("mounted startup EXTRA: held ensure changes model ONLY; unchanged thinking adopts low", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  await creation.entered.promise;
  const write = f.hold(command("set_model"));
  const selection = await f.start("model-only during held ensure", value => value.handleModelChange(provider, "A"));
  f.record(f.savedId).thinking = "low";
  await f.deliver(creation, { sessionId: f.savedId, model: selected("B"), thinkingLevel: "low" });
  await write.entered.promise;
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.deepEqual(f.current.currentModel, selected("A"), "late ensure must not replace pending model behind visible explicit choice");
  assert.equal(f.current.thinkingLevel, "low", "unchanged thinking adopts before selection get_state can mask the ensure guard");
  f.record(f.savedId).model = "A";
  await f.finish(selection, () => write.resolve({ success: true, data: { provider, id: "A" } }));
  await f.settleMaintenance();
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "low");
});

test("mounted startup EXTRA: held ensure changes thinking ONLY; untouched model adopts canonical", options, async t => {
  const f = await sessionFixture(t);
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  await creation.entered.promise;
  const write = f.hold(command("set_thinking_level"));
  const thinking = await f.start("thinking-only during held ensure", value => value.handleThinkingLevelChange("off"));
  // Suppress later metadata masking with a body gate, not a fake loadModels callback.
  const metadata = f.hold(models);
  await f.deliver(creation, { sessionId: f.savedId, model: selected("canonical"), thinkingLevel: "low" });
  await write.entered.promise;
  await metadata.entered.promise;
  assert.deepEqual(f.current.displayModel, selected("canonical"));
  assert.deepEqual(f.current.currentModel, selected("canonical"));
  assert.equal(f.current.thinkingLevel, "off");
  await f.run("return to automatic thinking reveals protected default", value => value.handleThinkingLevelChange("auto"));
  assert.equal(f.current.thinkingLevel, "high", "changed thinking guard also prevents replacing the prior automatic default with low");
  await f.finish(thinking, () => write.resolve({ success: true, data: {} }));
  await f.deliver(metadata, f.metadata());
  await f.settleMaintenance();
});

test("mounted startup EXTRA: existing LIVE A/off survives conflicting refreshed B/high", options, async t => {
  const f = await sessionFixture(t);
  f.record(f.savedId).model = "A";
  f.record(f.savedId).thinking = "off";
  await f.mountReady(f.existingOptions());
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "off");
  const before = f.requests.length;
  f.setCatalog({ model: "B", thinking: "high", thinkingPins: { [`${provider}/B`]: "high" } });
  await f.run("conflicting live metadata", value => value.loadModels());
  assert.equal(f.requests.slice(before).filter(models).length, 1);
  assert.equal(f.requests.filter(models).at(-1).query.get("sessionId"), f.savedId);
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.deepEqual(f.current.currentModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "off");
});

for (const explicit of [false, true]) test(`mounted startup EXTRA: sessionless default B/high projection is observable independently: ${explicit}`, options, async t => {
  const f = await sessionFixture(t);
  f.setCatalog({ model: "A", thinking: "low", thinkingPins: {} });
  await f.mountReady();
  assert.deepEqual(f.current.displayModel, selected("A"));
  assert.equal(f.current.thinkingLevel, "low");
  if (explicit) await f.run("explicit thinking off masks only thinking projection", value => value.handleThinkingLevelChange("off"));
  f.setCatalog({ model: "B", thinking: "high", thinkingPins: {} });
  await f.run("sessionless refreshed defaults", value => value.loadModels());
  assert.deepEqual(f.current.displayModel, selected("B"));
  assert.equal(f.current.newSessionModel, null, "displayed model is automatic, not explicit selection");
  assert.equal(f.current.isAutoModelSelection, true);
  assert.equal(f.current.thinkingLevel, explicit ? "off" : "high");
  assert.equal(creations(f).length, 0);
  if (explicit) {
    await f.run("clear explicit thinking via public auto", value => value.handleThinkingLevelChange("auto"));
    assert.equal(f.current.thinkingLevel, "low", "explicit refresh did not silently rewrite the masked automatic thinking default");
    await f.run("refresh now automatic", value => value.loadModels());
    assert.equal(f.current.thinkingLevel, "high");
  }
});

for (const explicit of [false, true]) test(`mounted startup EXTRA: exact rejected text with undefined images after departure: ${explicit}`, options, async t => {
  const f = await sessionFixture(t, { fixtureCwd: "/new-project" });
  const draftKey = "new:temporary:/new-project";
  const creation = f.hold(request => request.path === "/api/agent/new", { stage: "headers", status: 500 });
  await f.mount(f.newOptions({ persistNewSession: explicit, newSessionDraftKey: draftKey }));
  f.expectConsoleError("Failed to send message:", error => error?.message === "HTTP 500");
  const send = await f.start("exact legacy rejected Send/undefined images/full finally", value => value.handleSend("rejected text", undefined));
  await creation.admitted.promise;
  const outgoing = f.maintenanceHandle;
  const nextKey = `${draftKey}:literal-next`;
  f.setDraft(nextKey, { value: "next input", images: [] });
  await f.mount(f.newOptions({ newSessionDraftKey: nextKey }));
  await f.finish(send, () => creation.resolve({ error: "synthetic failed startup" }));
  await f.settleMaintenance(outgoing);
  assert.deepEqual(f.getDraft(draftKey), explicit ? { value: "rejected text", images: [] } : null);
  assert.deepEqual(f.getDraft(nextKey), { value: "next input", images: [] });
  assert.deepEqual(f.restores, [], "outgoing Send cannot call the next input capability");
  assert.equal(commands(f).some(request => request.body.type === "prompt"), false);
});
