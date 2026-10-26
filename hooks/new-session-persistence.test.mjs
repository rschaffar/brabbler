import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { sessionFixture, storageKey } from "./agent-session-mounted.fixture.mjs";

// Preserve the four original mounted cases through the SAME lazily guarded
// production graph as the new cases; never import a registered test as support.
async function mountedFixture(t, { preset = "configured", leaving = false } = {}) {
  const f = await sessionFixture(t, { preset });
  const creation = f.hold(request => request.path === "/api/agent/new");
  await f.mount(f.newOptions({ persistNewSession: true }));
  f.setDraft(f.draftKey, { value: "outgoing unsent text", images: [] });
  f.setDraft("next-chat", { value: "next input", images: [] });
  const eagerRequests = f.requests.filter(request => request.path === "/api/agent/new").length;
  const outgoing = f.maintenanceHandle;
  const operation = leaving
    ? await f.start("account selection rejects after real unmount", value =>
      value.handleSessionAccountChange("fixture-provider", "account", { "fixture-provider": "account" }), { rejects: /Session selection changed/ })
    : await f.start("concurrent slash-command initialization", value => value.loadSlashCommands());
  return {
    view: { ...f.view, unmount: () => f.unmount() }, requests: f.requests, inputRekeys: f.rekeys, draftKey: f.draftKey, savedId: f.savedId, storageKey, eagerRequests,
    get created() { return f.promotions.map(({ session, key }) => [session, key]); },
    async complete() {
      await f.finish(operation, () => creation.resolve({ sessionId: f.savedId }));
      await f.settleMaintenance(outgoing);
    },
  };
}

test("mounted production hook: eager StrictMode startup and concurrent initialization share one non-prompt creation", async t => {
  const f = await mountedFixture(t);
  assert.equal(f.eagerRequests, 1, "creation starts before any public action, despite Strict Effects replay");
  assert.equal(f.created.length, 0);
  assert.equal(f.requests.filter(request => request.url === "/api/agent/new").length, 1);
  const request = f.requests.find(request => request.url === "/api/agent/new");
  assert.equal(request.body.type, "ensure_session");
  assert.equal(Object.hasOwn(request.body, "message"), false);
  assert.equal(Object.hasOwn(request.body, "toolNames"), false);
  await f.complete();
  assert.deepEqual(f.inputRekeys, [[f.draftKey, f.savedId]]);
  assert.equal(f.created.length, 1);
  assert.equal(f.created[0][0].messageCount, 0);
  assert.equal(f.created[0][1], f.draftKey);
  assert.deepEqual(f.requests.filter(request => request.url === `/api/agent/${f.savedId}`).map(request => request.body),
    [{ type: "get_commands" }], "initialization never sends a prompt");
});

for (const [preset, toolNames] of [["none", []], ["read-only", ["read", "grep", "find", "ls"]]]) {
  test(`mounted production hook: layout-hydrated ${preset} reaches eager creation`, async t => {
    const f = await mountedFixture(t, { preset });
    assert.equal(f.eagerRequests, 1);
    assert.deepEqual(f.requests.find(request => request.url === "/api/agent/new").body.toolNames, toolNames);
    await f.complete();
    assert.equal(f.created.length, 1);
  });
}

test("mounted production hook: unmount before delayed response rekeys outgoing stored text, never the next input", async t => {
  const f = await mountedFixture(t, { preset: "none", leaving: true });
  assert.equal(f.eagerRequests, 1);
  assert.equal(f.created.length, 0);
  await f.view.unmount();
  await f.complete();
  assert.deepEqual(f.inputRekeys, []);
  assert.equal(f.view.window.localStorage.getItem(f.storageKey(f.draftKey)), null);
  assert.deepEqual(JSON.parse(f.view.window.localStorage.getItem(f.storageKey(f.savedId))), { value: "outgoing unsent text" });
  assert.deepEqual(JSON.parse(f.view.window.localStorage.getItem(f.storageKey("next-chat"))), { value: "next input" });
  assert.equal(f.created.length, 1, "outgoing promotion is delivered for AppShell's separate adoption guard");
  assert.equal(f.created[0][1], f.draftKey);
  assert.equal(f.requests.some(request => request.url === "/api/auth/accounts/selection"), false);
});
