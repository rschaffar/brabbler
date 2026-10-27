import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createJiti } from "jiti";
const { ScratchpadController } = await createJiti(import.meta.url, { fsCache: false }).import("./scratchpad-client.ts");
const note = (text) => ({ text, revision: createHash("sha256").update(text).digest("hex") });
const tick = () => new Promise((resolve) => setImmediate(resolve));
function fixture(scope = null, storage = new Map()) {
  const requests = [];
  let remote = note("");
  const local = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
  const transport = { read: async () => remote, save: (sessionId, text, revision) => {
    const gate = Promise.withResolvers(); requests.push({ sessionId, text, revision, ...gate }); return gate.promise;
  } };
  const controller = new ScratchpadController(scope, local, transport);
  return { controller, requests, storage, local, transport, remote(value) { remote = note(value); }, get view() { return controller.getSnapshot(); },
    edit(text, kind = "", time = 1) { const start = controller.getSnapshot().text.length; controller.edit(text, start, start, text.length, text.length, kind, time); },
    async ack(index) { const request = requests[index]; remote = note(request.text); request.resolve(remote); await tick(); } };
}
test("a lost save response after undo keeps final intent recoverable and cannot falsely report saved", async () => {
  const f = fixture(); f.remote("A"); await f.controller.refresh(); f.edit("B");
  f.controller.history("undo", 1, 1); assert.equal(f.view.text, "A");
  f.remote("B"); f.requests[0].reject(new Error("ack lost")); await tick();
  assert.equal(f.view.error, "save"); assert.equal(f.view.dirty, true);
  assert.equal(JSON.parse([...f.storage.values()][0]).text, "A");
  // Further edits/undo back to the baseline must not erase uncertainty either.
  f.edit("AA"); f.controller.history("undo", 2, 2);
  assert.equal(f.view.dirty, true); assert.equal(f.view.text, "A");
  const recovered = new ScratchpadController(null, f.local, f.transport); await recovered.refresh();
  assert.equal(recovered.getSnapshot().text, "A"); assert.equal(recovered.getSnapshot().conflict.text, "B");
  f.controller.retry(); assert.equal(f.requests[1].text, "A");
  f.requests[1].resolve({ current: note("B") }); await tick();
  assert.equal(f.view.conflict.text, "B"); f.controller.resolve(true); await f.ack(2);
  assert.equal(f.view.text, "A"); assert.equal(f.view.dirty, false);
});
test("conflict plus undo to the old baseline cannot be refreshed away on reopen/focus", async () => {
  const f = fixture(); f.remote("A"); await f.controller.refresh(); f.edit("B");
  f.requests[0].resolve({ current: note("C") }); await tick();
  f.controller.history("undo", 1, 1); assert.equal(f.view.text, "A"); f.remote("C");
  await f.controller.refresh();
  assert.equal(f.view.text, "A"); assert.equal(f.view.conflict.text, "C"); assert.equal(f.view.canRedo, true);
  assert.equal(JSON.parse([...f.storage.values()][0]).text, "A");
  f.controller.resolve(false); assert.equal(f.view.text, "C");
});
test("every input is synchronously recoverable; writes coalesce serially and retain newer typing", async () => {
  const f = fixture(); await f.controller.refresh();
  f.edit("a"); assert.equal(f.requests.length, 1); assert.equal(JSON.parse([...f.storage.values()][0]).text, "a");
  f.edit("ab"); f.edit("abc"); assert.equal(f.requests.length, 1);
  await f.ack(0); assert.equal(f.requests.length, 2); assert.equal(f.requests[1].text, "abc");
  assert.equal(f.requests[1].revision, note("a").revision);
  await f.ack(1); assert.equal(f.view.text, "abc"); assert.equal(f.view.dirty, false); assert.equal(f.storage.size, 0);
});
test("undo while a save is pending persists the final empty intent until both saves settle", async () => {
  const f = fixture(); await f.controller.refresh(); f.edit("abc");
  f.controller.history("undo", 3, 3); assert.equal(f.view.text, "");
  assert.equal(JSON.parse([...f.storage.values()][0]).text, "");
  await f.ack(0); assert.equal(f.requests[1].text, ""); await f.ack(1);
  assert.equal(f.storage.size, 0); assert.equal(f.view.canRedo, true);
  f.controller.history("redo", 0, 0); assert.equal(f.view.text, "abc"); await f.ack(2);
});
test("bulk insertText replacement and blur boundaries cannot join a later typing burst", async () => {
  const f = fixture(); await f.controller.refresh();
  f.edit("seed", "insertText", 100); f.edit("seed ", "insertText", 200); f.edit("seed x", "insertText", 250);
  f.controller.history("undo", 6, 6); assert.equal(f.view.text, "seed");
  f.controller.history("redo", 4, 4); f.controller.breakGroup(); f.edit("seed xy", "insertText", 300);
  f.controller.breakGroup(); f.edit("seed xyz", "insertText", 350);
  f.controller.history("undo", 8, 8); assert.equal(f.view.text, "seed xy");
  await f.ack(0); await f.ack(1);
});
test("typing groups undo but paste and caret changes split groups; redo clears after new edits", async () => {
  const f = fixture(); await f.controller.refresh();
  f.edit("a", "insertText", 100); f.edit("ab", "insertText", 200); f.edit("abc", "insertText", 300);
  f.controller.history("undo", 3, 3); assert.equal(f.view.text, "");
  f.controller.history("redo", 0, 0); assert.equal(f.view.text, "abc");
  f.edit("abc paste", "insertFromPaste", 400); f.controller.history("undo", 9, 9); assert.equal(f.view.text, "abc");
  f.edit("abcd", "insertText", 500); assert.equal(f.view.canRedo, false);
  await f.ack(0); await f.ack(1);
});
test("failed save retains edits and requires explicit retry; reload reconciles a lost acknowledgement", async () => {
  const f = fixture(); await f.controller.refresh(); f.edit("draft");
  f.requests[0].reject(new Error("offline")); await tick();
  f.edit("draft later"); assert.equal(f.requests.length, 1); assert.equal(f.view.error, "save");
  f.controller.retry(); assert.equal(f.requests[1].text, "draft later");
  f.remote("draft later"); // Server committed, response was lost before reload.
  const reopened = new ScratchpadController(null, f.local, f.transport);
  await reopened.refresh(); assert.equal(reopened.getSnapshot().text, "draft later");
  assert.equal(reopened.getSnapshot().dirty, false); assert.equal(reopened.getSnapshot().canUndo, false);
  await f.ack(1);
});
test("conflicts preserve local text, show remote text and only explicit resolution saves against it", async () => {
  const f = fixture(); await f.controller.refresh(); f.edit("mine");
  f.requests[0].resolve({ current: note("theirs") }); await tick();
  f.edit("mine newer"); assert.equal(f.requests.length, 1); assert.equal(f.view.conflict.text, "theirs");
  f.controller.resolve(true); assert.equal(f.requests[1].text, "mine newer"); assert.equal(f.requests[1].revision, note("theirs").revision);
  f.requests[1].resolve({ current: note("theirs newer") }); await tick();
  f.controller.resolve(false); assert.equal(f.view.text, "theirs newer"); assert.equal(f.view.dirty, false);
  assert.equal(f.requests.length, 2); f.controller.history("undo", 0, 0);
  assert.equal(f.view.text, "mine newer"); assert.equal(f.requests[2].revision, note("theirs newer").revision); await f.ack(2);
});
test("recovered stale drafts never overwrite a remote edit; failed reads can be retried", async () => {
  const f = fixture(); await f.controller.refresh(); f.edit("pending");
  f.remote("external"); const recovered = new ScratchpadController(null, f.local, f.transport);
  await recovered.refresh(); assert.equal(recovered.getSnapshot().text, "pending"); assert.equal(recovered.getSnapshot().conflict.text, "external");
  assert.equal(f.requests.length, 1);
  let fail = true;
  const c = new ScratchpadController("other", f.local, { ...f.transport, read: async () => { if (fail) throw new Error("offline"); return note("remote"); } });
  await c.refresh(); assert.equal(c.getSnapshot().error, "load"); fail = false; c.retry(); await tick();
  assert.equal(c.getSnapshot().text, "remote"); await f.ack(0);
});
test("global/project recovery and histories are independent; legacy keys remain separate and unavailable storage is visible", async () => {
  const shared = new Map(), firstId = "a".repeat(64);
  shared.set(`pi-web:scratchpad:${JSON.stringify(firstId)}`, JSON.stringify(note("legacy session draft")));
  const global = fixture(null, shared), a = fixture({ projectId: firstId }, shared), b = fixture({ projectId: "b".repeat(64) }, shared);
  await Promise.all([global.controller.refresh(), a.controller.refresh(), b.controller.refresh()]);
  global.edit("global"); a.edit("a"); b.edit("b"); assert.equal(shared.size, 4);
  assert.equal(JSON.parse(shared.get(`pi-web:scratchpad:${JSON.stringify(firstId)}`)).text, "legacy session draft");
  a.controller.history("undo", 1, 1); assert.equal(b.view.text, "b"); assert.equal(global.view.text, "global");
  const c = new ScratchpadController("blocked", null, global.transport); await c.refresh();
  c.edit("text", 0, 0, 4, 4); assert.equal(c.getSnapshot().recoveryUnavailable, true);
  await global.ack(0); await global.ack(1); await a.ack(0); await a.ack(1); await b.ack(0);
});
test("clean external refresh clears stale undo while a dirty refresh cannot replace input", async () => {
  const f = fixture(); await f.controller.refresh(); f.edit("mine"); await f.ack(0);
  f.remote("external"); await f.controller.refresh(); assert.equal(f.view.text, "external"); assert.equal(f.view.canUndo, false);
  f.edit("local"); f.remote("external again"); await f.controller.refresh(); assert.equal(f.view.text, "local"); await f.ack(1);
});
test("typing during a failed clean refresh can retry without losing the draft", async () => {
  const f = fixture(); await f.controller.refresh();
  f.transport.read = async () => { throw new Error("offline"); };
  await f.controller.refresh(); f.edit("new"); assert.equal(f.view.error, "load");
  f.transport.read = async () => note(""); f.controller.retry(); await tick();
  assert.equal(f.requests[0].text, "new"); await f.ack(0);
});
