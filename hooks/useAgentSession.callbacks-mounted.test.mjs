import '../lib/testing/client-native-boundary.fixture.mjs';
// UNEXECUTED narrow callbacks/currentness complements. No shell/UI child stubs.
import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture, command, detail } from "./agent-session-mounted.fixture.mjs";
const options = { timeout: 10000 };
const source = f => f.sources.findLast(item => item.readyState !== 2);
const ok = data => ({ success: true, data });

test("navigation: branch revision rejects an older coalesced canonical body and navigation launches a fresh read", options, async t => {
  const f = await sessionFixture(t);
  await f.mountReady(f.existingOptions());
  const old = f.hold(detail);
  const naming = await f.start("old canonical reload", value => value.handleBuiltinSlashCommand("/name old-read"));
  await old.entered.promise;
  const fresh = f.hold(detail);
  const navigation = await f.start("navigate invalidates old client flight", value => value.handleNavigate("first-user"));
  await fresh.entered.promise;
  assert.equal(fresh.request.query.has("force"), false);
  const row = f.record(f.savedId); row.leaf = "new-leaf";
  row.messages = [{ role: "user", content: "new canonical", timestamp: 2 }]; row.entryIds = ["new-entry"];
  await f.finish(navigation, () => fresh.resolve(f.snapshot(f.savedId)));
  await f.finish(naming, () => old.resolve(f.snapshot(f.savedId, { leafId: "old-leaf", context: { ...f.snapshot(f.savedId).context, messages: [{ role: "user", content: "obsolete", timestamp: 1 }], entryIds: ["obsolete"] } })));
  assert.deepEqual(f.current.entryIds, ["new-entry"]);
  assert.equal(f.current.activeLeafId, "new-leaf");
  assert.equal(f.current.messages[0].content, "new canonical");
});

test("callbacks: current fork/clone invocations use the latest callback after real same-instance rerender", options, async t => {
  const f = await sessionFixture(t), old = [], latest = [];
  f.record(f.savedId).leaf = "leaf";
  await f.mountReady({ ...f.existingOptions(), onSessionForked: sid => old.push(sid) });
  await f.rerender({ ...f.existingOptions(), onSessionForked: sid => latest.push(sid) });
  for (const type of ["fork", "clone"]) {
    const gate = f.hold(command(type));
    const operation = await f.start(`latest ${type} callback`, value => type === "fork" ? value.handleFork("first-user") : value.handleBuiltinSlashCommand("/clone"));
    await gate.entered.promise;
    assert.equal(gate.request.path, `/api/agent/${f.savedId}`);
    await f.finish(operation, () => gate.resolve(ok({ newSessionId: `${f.savedId}-${type}` })));
  }
  assert.deepEqual(old, []);
  assert.deepEqual(latest, [`${f.savedId}-fork`, `${f.savedId}-clone`]);
});

for (const result of [{ cancelled: true, newSessionId: "never-select-cancelled" }, {}]) test(`callbacks: cancelled/unsaved clone ${Boolean(result.cancelled)} never publishes child navigation`, options, async t => {
  const f = await sessionFixture(t), children = [];
  await f.mountReady({ ...f.existingOptions(), onSessionForked: sid => children.push(sid) });
  const gate = f.hold(command("clone")); let outcome;
  const operation = await f.start("cancelled clone", async value => { outcome = await value.handleBuiltinSlashCommand("/clone"); });
  await gate.entered.promise; await f.finish(operation, () => gate.resolve(ok(result)));
  assert.deepEqual(children, []);
  assert.equal(outcome.error, "Cannot clone an empty or unsaved session");
});

test("attention hook bridge: blocking events reach the current external callback; dedup/browser delivery stays a shell obligation", options, async t => {
  const f = await sessionFixture(t), old = [], current = [];
  await f.mountReady({ ...f.existingOptions(), onAttentionNeeded: request => old.push(request.id) });
  await f.rerender({ ...f.existingOptions(), onAttentionNeeded: request => current.push(request.id) });
  const blocking = { type: "extension_ui_request", id: "exact-dialog", method: "confirm", title: "Continue?", message: "literal request" };
  await f.event(source(f), blocking); await f.event(source(f), blocking);
  await f.event(source(f), { type: "extension_ui_request", id: "status", method: "setStatus", statusKey: "work", statusText: "working" });
  await f.event(source(f), { type: "extension_ui_request", id: "closed-custom", method: "custom", closed: true });
  assert.deepEqual(old, []);
  assert.deepEqual(current, ["exact-dialog", "exact-dialog"], "hook forwards; AppShell owns deduplication");
  assert.equal(f.current.extensionDialog.id, "exact-dialog");
});
