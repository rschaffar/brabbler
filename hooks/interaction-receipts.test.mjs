import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { sessionFixture, detail, command } from "./agent-session-mounted.fixture.mjs";
import { policyClockFixture } from "./agent-session-clock.fixture.mjs";
const options = { timeout: 10000 }, stamp = Date.parse("2026-10-06T10:00:00.000Z");
const source = f => f.sources.find(item => item.readyState !== 2);
const contexts = f => request => request.path === `/api/sessions/${f.savedId}/context`;
const chain = ids => ids.reduceRight((children, id, index) => [{ entry: { type: "custom", id, parentId: ids[index - 1] ?? null,
  timestamp: new Date(stamp).toISOString(), customType: "fixture:branch", data: {} }, children }], []);
function entry(f, id = "entry", parentId = "live", offset = 0) {
  return { type: "custom", customType: f.receipts.INTERACTION_RECEIPT_TYPE, id, parentId,
    timestamp: new Date(stamp + offset).toISOString(), data: { version: 1, outcome: "answered", response: { confirmed: true },
      request: { type: "extension_ui_request", id: `request-${id}`, method: "confirm", title: "Continue?", message: "Context" } } };
}
function operation(f, id, sequence, phase, parentId = "live") {
  return { ...entry(f, id, parentId), customType: f.operations.OPERATION_RECEIPT_TYPE,
    data: f.operations.snapshotOperationReceipt("example", { version: 1, operationId: "a046677d-8293-4445-9a2b-558317345abc",
      card: { title: "Operation", actions: [] }, phase, authorization: { mode: "allow", source: "session", revision: "r1", decision: "policy-authorized" },
      checks: [], effectStarted: phase === "succeeded" }, sequence) };
}
function history(f, entries, ordinary = []) {
  return { ...f.snapshot(f.savedId).context,
    messages: [...entries.map(value => f.receipts.interactionReceiptMessage(value) ?? f.operations.operationReceiptMessage(value)), ...ordinary],
    entryIds: [...entries.map(value => value.id), ...ordinary.map((_, index) => `ordinary-${index}`)] };
}
async function ready(t) {
  const time = policyClockFixture(), f = await sessionFixture(t, { policyTime: time });
  f.record(f.savedId).leaf = "live"; f.record(f.savedId).tree = chain(["live"]);
  await f.mountReady(f.existingOptions()); return f;
}
async function emit(f, value) { await f.event(source(f), { type: value.customType === f.receipts.INTERACTION_RECEIPT_TYPE ? "interaction_receipt" : "operation_receipt", entry: value }); }
async function advanceCanonical(f, leaf = "new-canonical-leaf", messages = [], entryIds = []) {
  const row = f.record(f.savedId); row.leaf = leaf; row.tree = chain(["live", leaf]); row.messages = messages; row.entryIds = entryIds; row.revision++;
  await f.run("actual canonical read without changing browser navigation revision", value => value.handleBuiltinSlashCommand("/name canonical"));
  assert.equal(f.current.activeLeafId, leaf);
}
async function browse(f, leaf = "browsed") {
  const nav = f.hold(command("navigate_tree"));
  const action = await f.start("actual independent branch context and cancelled live navigation", () => f.leafChange(leaf));
  await nav.entered.promise;
  await f.finish(action, () => nav.resolve({ success: true, data: { cancelled: true } }));
  assert.equal(f.current.activeLeafId, leaf);
}
async function retryAtNewAnchor(f, receipt) {
  const first = f.hold(contexts(f)), second = f.hold(contexts(f));
  await emit(f, { ...receipt, parentId: "remote-ancestor" }); await first.entered.promise;
  assert.equal(first.request.query.get("leafId"), receipt.id);
  assert.equal(first.request.query.get("ancestorId"), "live");
  await advanceCanonical(f);
  await act(async () => { first.resolve({ context: history(f, [receipt]) }); await second.entered.promise; });
  assert.equal(second.request.query.get("ancestorId"), "new-canonical-leaf");
  assert.equal(second.request.query.has("leafId"), false, "never invert descendant anchor and captured receipt leaf");
  return second;
}

test("actual receipt SSE deduplicates aligned IDs, rejects malformed entries, and closes only its request dialog", options, async t => {
  const f = await ready(t), saved = entry(f);
  await f.event(source(f), { type: "extension_ui_request", id: "other", method: "confirm", title: "Other", message: "Keep" });
  await emit(f, saved); assert.equal(f.current.extensionDialog.id, "other");
  assert.deepEqual(f.current.entryIds, ["entry"]); assert.equal(f.current.messages.length, 1);
  await f.event(source(f), saved.data.request); await emit(f, saved);
  assert.equal(f.current.extensionDialog, null); assert.equal(f.current.messages.length, 1);
  await emit(f, { ...saved, id: "malformed", data: { ...saved.data, version: 2 } });
  assert.deepEqual(f.current.entryIds, ["entry"]);

  // Keep the answered-confirm tuple above. The same real Source/hook receiver
  // must consume the policy-aborted plugin-card closure, without sending an
  // invented approval/cancellation response back to an already-settled server.
  const plugin = { type: "extension_ui_request", id: "selected-policy-pending", method: "plugin_card",
    pluginId: "git-workflow", title: "Git commit", actions: [{ id: "approve", label: "Approve commit" }] };
  const responses = () => f.requests.filter(command("extension_ui_response"));
  const responsesBefore = responses().length;
  await f.event(source(f), plugin); assert.equal(f.current.extensionDialog.id, plugin.id);
  await f.event(source(f), { type: "extension_ui_closed", id: "another-policy-request" });
  assert.equal(f.current.extensionDialog.id, plugin.id, "unrelated close cannot clear the current plugin request");
  await f.event(source(f), { type: "extension_ui_closed", id: plugin.id });
  assert.equal(f.current.extensionDialog === null, true, "actual matching policy-close event removes the live plugin dialog");
  assert.equal(responses().length, responsesBefore);
  assert.deepEqual(f.current.entryIds, ["entry"], "closed event is not a fabricated receipt");

  const abortedRequest = { ...plugin, id: "selected-policy-aborted-receipt" };
  await f.event(source(f), abortedRequest);
  const aborted = { ...saved, id: "aborted-plugin-entry", data: { version: 1, outcome: "aborted", request: abortedRequest } };
  await emit(f, aborted);
  assert.equal(f.current.extensionDialog === null, true, "actual aborted plugin receipt independently closes its matching request");
  assert.deepEqual(f.current.entryIds, ["entry", "aborted-plugin-entry"]);
  assert.equal(responses().length, responsesBefore);
});

test("actual operation SSE chooses terminal sequence, keeps IDs aligned and ignores malformed/older stages", options, async t => {
  const f = await ready(t), prepared = operation(f, "prepared", 1, "prepared"), terminal = operation(f, "terminal", 2, "succeeded");
  await emit(f, prepared); await emit(f, terminal); await emit(f, terminal); await emit(f, prepared);
  await emit(f, { ...terminal, id: "bad", data: { ...terminal.data, version: 2 } });
  assert.deepEqual(f.current.entryIds, ["terminal"]); assert.equal(f.current.messages.length, 1);
  assert.equal(f.current.messages[0].details.phase, "succeeded");
});

test("idle connected JSON reconciles real history and current-session question drafts only", options, async t => {
  const f = await ready(t), keys = f.questionDrafts.questionDraftKey, store = f.view.window.sessionStorage;
  store.setItem(keys(f.savedId, "settled"), "outgoing draft"); store.setItem(keys(f.savedId, "pending"), "keep"); store.setItem(keys("another-session", "settled"), "other identity");
  const batch = id => ({ type: "extension_ui_request", id, method: "ask_user_batch", title: "Questions",
    questions: [{ id: "q", shortLabel: "Q", question: "Why?", type: "text", required: true, options: [] }] });
  await f.event(source(f), batch("settled"));
  const read = f.hold(contexts(f));
  await f.event(source(f), { type: "connected", isStreaming: false, pendingQuestionSetIds: ["pending"] }); await read.entered.promise;
  assert.equal(f.current.extensionDialog, null); assert.equal(store.getItem(keys(f.savedId, "settled")), null);
  assert.equal(store.getItem(keys(f.savedId, "pending")), "keep"); assert.equal(store.getItem(keys("another-session", "settled")), "other identity");
  await f.deliver(read, { context: history(f, [entry(f)]) }); await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, ["entry"]); assert.equal(f.current.agentRunning, false);
  await f.event(source(f), batch("pending"));
  await f.event(source(f), { type: "connected", isStreaming: false, pendingQuestionSetIds: ["pending"] }); await f.settleMaintenance();
  assert.equal(f.current.extensionDialog.id, "pending");
});

for (const kind of ["interaction", "operation"]) test(`${kind} receipt cannot enter an independently browsed branch`, options, async t => {
  const f = await ready(t), saved = kind === "interaction" ? entry(f) : operation(f, "terminal", 2, "succeeded");
  await browse(f);
  const before = f.requests.filter(contexts(f)).length;
  await f.event(source(f), { type: "extension_ui_request", id: "request-entry", method: "confirm", title: "Confirm", message: "Wait" });
  await emit(f, saved);
  assert.equal(f.current.messages.length, 0); assert.equal(f.requests.filter(contexts(f)).length, before);
  if (kind === "interaction") assert.equal(f.current.extensionDialog, null, "only the matching live request settles");
});

for (const kind of ["interaction", "operation"]) for (const allowed of [false, true]) test(`remote ${kind} entry requires exact server ancestry (${allowed ? "admitted" : "refused"})`, options, async t => {
  const f = await ready(t), saved = kind === "interaction" ? entry(f) : operation(f, "terminal", 2, "succeeded");
  const read = f.hold(contexts(f), { stage: allowed ? "body" : "headers", status: allowed ? 200 : 409 });
  await emit(f, { ...saved, parentId: "remote-ancestor" }); await read.entered.promise;
  assert.equal(read.request.query.get("leafId"), saved.id); assert.equal(read.request.query.get("ancestorId"), "live");
  assert.equal(f.current.messages.length, 0, "event is not itself branch authorization");
  await f.deliver(read, { context: history(f, [saved]) }); await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, allowed ? [saved.id] : []);
});

test("slow connected history preserves newer cards and never preloads ordinary SSE messages", options, async t => {
  const f = await ready(t), saved = entry(f), newer = entry(f, "newer", "live", 2000);
  const ordinary = { role: "user", content: "ordinary SSE", timestamp: stamp + 1000 };
  const read = f.hold(contexts(f)); await f.event(source(f), { type: "connected", isStreaming: false }); await read.entered.promise;
  await emit(f, newer);
  await f.deliver(read, { context: history(f, [saved], [ordinary]) }); await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, ["entry", "newer"]);
  assert.equal(f.current.messages.some(message => message.role === "user"), false);
  await f.event(source(f), { type: "agent_start" });
  await f.event(source(f), { type: "message_end", entryId: "ordinary-0", message: ordinary });
  assert.equal(f.current.messages.filter(message => message.role === "user" && message.content === ordinary.content).length, 1);
});

for (const missed of [false, true]) test(`slow operation history ${missed ? "repairs missed terminal" : "cannot downgrade live terminal"}`, options, async t => {
  const f = await ready(t), prepared = operation(f, "prepared", 1, "prepared"), terminal = operation(f, "terminal", 2, "succeeded");
  await emit(f, prepared); const read = f.hold(contexts(f)); await f.event(source(f), { type: "connected", isStreaming: false }); await read.entered.promise;
  if (!missed) await emit(f, terminal);
  await f.deliver(read, { context: history(f, [missed ? terminal : prepared]) }); await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, ["terminal"]);
});

for (const kind of ["interaction", "operation"]) test(`canonical advancement rereads ${kind} without stale leaf and excludes ordinary history`, options, async t => {
  const f = await ready(t), saved = kind === "interaction" ? entry(f) : operation(f, "terminal", 2, "succeeded");
  const retry = await retryAtNewAnchor(f, saved);
  await f.deliver(retry, { context: history(f, [saved], [{ role: "user", content: "not preloaded", timestamp: stamp + 1000 }]) });
  await f.settleMaintenance(); assert.deepEqual(f.current.entryIds, [saved.id]);
  assert.equal(f.current.messages.some(message => message.role === "user"), false);
});

test("canonical reread never appends captured old receipt absent from revalidated branch", options, async t => {
  const f = await ready(t), saved = entry(f), sibling = entry(f, "sibling-receipt");
  const retry = await retryAtNewAnchor(f, saved);
  await f.deliver(retry, { context: history(f, [sibling]) }); await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, ["sibling-receipt"]);
});

for (const reason of ["session recreation", "keyed A/B/A unmount", "navigation revision", "independent leaf"]) test(`canonical retry drops delivery after actual ${reason}`, options, async t => {
  const f = await ready(t), saved = entry(f), retry = await retryAtNewAnchor(f, saved), outgoing = f.maintenanceHandle;
  if (reason === "session recreation") {
    const sid = `${f.savedId}-replacement`; f.declareSession(sid);
    const tools = f.hold(command("set_tools")), changing = await f.start("real Tools identity replacement", value => value.handleToolPresetChange("none"));
    await f.finish(changing, () => tools.resolve({ success: true, data: { sessionId: sid, recreated: true } }));
  } else if (reason === "keyed A/B/A unmount") {
    await f.mountReady(f.existingOptions(`${f.savedId}-B`)); await f.mountReady(f.existingOptions());
  } else if (reason === "navigation revision") {
    const nav = f.hold(command("navigate_tree")), moving = await f.start("real vetoed navigation still advances revision", value => value.handleNavigate("another"));
    await f.finish(moving, () => nav.resolve({ success: true, data: { cancelled: true } }));
  } else await browse(f);
  const count = f.requests.filter(contexts(f)).length;
  await f.deliver(retry, { context: history(f, [saved]) }); await f.settleMaintenance(outgoing);
  assert.equal(f.current.entryIds.includes(saved.id), false); assert.equal(f.requests.filter(contexts(f)).length, count);
});

test("canonical retry preserves newer live cards and terminal operation order", options, async t => {
  const f = await ready(t), prepared = operation(f, "prepared", 1, "prepared"), terminal = operation(f, "terminal", 2, "succeeded"), saved = entry(f), newer = entry(f, "newer", "new-canonical-leaf", 2000);
  await emit(f, prepared); const retry = await retryAtNewAnchor(f, prepared);
  await emit(f, { ...terminal, parentId: "new-canonical-leaf" }); await emit(f, newer);
  await f.deliver(retry, { context: history(f, [prepared, saved]) }); await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, ["terminal", "entry", "newer"]);
});

test("branch navigation discards initial in-flight reconnect history", options, async t => {
  const f = await ready(t), read = f.hold(contexts(f));
  await f.event(source(f), { type: "connected", isStreaming: false }); await read.entered.promise;
  await browse(f);
  await f.deliver(read, { context: history(f, [entry(f)]) }); await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, []);
});

for (const invalidation of ["branch", "selection"]) test(`delayed canonical JSON cannot install data/transcript across ${invalidation}`, options, async t => {
  const f = await ready(t), old = f.hold(request => detail(request) && !request.query.has("force"));
  const read = await f.start("real disk-only canonical load", value => value.handleBuiltinSlashCommand("/name old"));
  await old.entered.promise;
  if (invalidation === "branch") await browse(f);
  else await f.run("real model selection version change", value => value.handleModelChange("mounted-fixture", "A"));
  const before = f.current.data.context.model.modelId;
  await f.finish(read, () => old.resolve(f.snapshot(f.savedId, { leafId: "old-live", context: { ...f.snapshot(f.savedId).context, model: { provider: "mounted-fixture", modelId: "old" } } })));
  assert.notEqual(f.current.data.leafId, "old-live"); assert.equal(f.current.data.context.model.modelId, before);
});

test("warm cache restores actual transcript/live anchor before its held canonical freshness read", options, async t => {
  const f = await ready(t); await emit(f, entry(f));
  const original = f.maintenanceHandle;
  await f.mountReady(f.existingOptions(`${f.savedId}-B`)); await f.settleMaintenance(original);
  const force = f.hold(request => detail(request) && request.path === `/api/sessions/${f.savedId}` && request.query.get("force") === "1", { repeat: true, stage: "headers" });
  const read = f.hold(contexts(f));
  await f.mount(f.existingOptions());
  assert.deepEqual(f.current.entryIds, ["entry"], "actual synchronous cache restoration, not extracted setters");
  assert.equal(force.used, true, "cached live refs must admit the actual forced freshness read");
  await f.connect(source(f)); await read.entered.promise;
  assert.equal(read.request.query.get("ancestorId"), "live", "live refs precede freshness response");
  await f.deliver(read, { context: history(f, []) });
  // The real GET revision includes leafId. A sibling cannot reuse the cached
  // live branch's opaque token (which deliberately preserves wider history).
  await f.deliver(force, f.snapshot(f.savedId, { snapshotRevision: `${f.id}:sibling-v1`, leafId: "sibling", tree: chain(["sibling"]),
    context: { ...f.snapshot(f.savedId).context, messages: [], entryIds: [] } }));
  await f.settleMaintenance();
  assert.deepEqual(f.current.entryIds, [], "a sibling canonical branch must not inherit the cached live receipt");
});

for (const view of ["live", "browsed"]) test(`slow canonical snapshot carries recent receipt only in ${view} live context`, options, async t => {
  const f = await ready(t), row = f.record(f.savedId);
  row.messages = [{ role: "user", content: "Before", timestamp: stamp - 1000 }]; row.entryIds = ["user"]; row.revision++;
  await f.run("load canonical baseline", value => value.handleBuiltinSlashCommand("/name baseline"));
  const snapshot = f.snapshot(f.savedId), body = f.hold(request => detail(request) && !request.query.has("force"));
  const reading = await f.start("snapshot captured before live card", value => value.handleBuiltinSlashCommand("/name pending"));
  await body.entered.promise; await emit(f, entry(f));
  if (view === "browsed") await browse(f);
  await f.finish(reading, () => body.resolve(snapshot));
  assert.deepEqual(f.current.entryIds, view === "live" ? ["user", "entry"] : ["user"]);
});
