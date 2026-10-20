import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as turn } from "node:timers/promises";
import { createOwnedRoutes } from "../e2e/owned-routes.mjs";
import { continueCompactionProbeDuringDisposal } from "../e2e/compaction.mjs";

const gate = () => Promise.withResolvers();
const get = (continueRequest) => ({ request: () => ({ method: () => "GET" }), continue: continueRequest });

test("owned route disposal joins fetch, terminal action and callbacks admitted during unregister", async () => {
  const fetched = gate(), fulfilling = gate(), fulfilled = gate(), unregistering = gate(), continued = gate();
  let removed = false, finished = false, synthetic = 0, continuedCount = 0;
  const owned = createOwnedRoutes(async () => {
    synthetic += 1;
    await fetched.promise;
    fulfilling.resolve();
    await fulfilled.promise;
    assert.equal(removed, false, "A late fulfill must not see already removed interception");
  }, continueCompactionProbeDuringDisposal);
  const original = owned.handler({});
  const disposing = owned.dispose(async (handler) => {
    assert.equal(handler, owned.handler, "Remove only this exact registered handler");
    removed = true;
    // Model a callback selected before an asynchronous unroute completed.
    void handler(get(async () => { continuedCount += 1; await continued.promise; }));
    unregistering.resolve();
  }).then(() => { finished = true; });
  await owned.handler(get(async () => { continuedCount += 1; }));
  assert.equal(synthetic, 1, "New disposal reads must not enter synthetic fetch/fulfill");
  assert.equal(removed, false);
  fetched.resolve();
  await fulfilling.promise;
  assert.equal(removed, false, "Fetching alone is not terminal settlement");
  fulfilled.resolve();
  await original;
  await unregistering.promise;
  await turn();
  assert.equal(finished, false, "Post-unregister drain must join the final continuation");
  continued.resolve();
  await disposing;
  assert.equal(continuedCount, 2);
  assert.equal(finished, true);
});

test("owned route disposal retains earlier callback errors and drains peers despite removal errors", async () => {
  const callbackError = new Error("fetch failed"), removalError = new Error("unroute failed"), held = gate();
  let removed = false;
  const owned = createOwnedRoutes(async (route) => {
    if (route.bad) throw callbackError;
    await held.promise;
  }, continueCompactionProbeDuringDisposal);
  await assert.rejects(owned.handler({ bad: true }), (error) => error === callbackError);
  const peer = owned.handler({});
  const disposing = owned.dispose(async () => { removed = true; throw removalError; });
  const checked = assert.rejects(disposing, (error) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [callbackError, removalError]);
    return true;
  });
  await turn();
  assert.equal(removed, false);
  held.resolve();
  await peer;
  await checked;
  assert.equal(removed, true);
});

test("late compaction commands remain synthetic and fail instead of reaching the provider", async () => {
  let continued = false, reply;
  const owned = createOwnedRoutes(() => { throw new Error("Unexpected normal handler"); }, continueCompactionProbeDuringDisposal);
  owned.beginDisposal();
  await assert.rejects(owned.handler({
    request: () => ({ method: () => "POST", postDataJSON: () => ({ type: "compact" }) }),
    continue: async () => { continued = true; },
    fulfill: async (options) => { reply = options; },
  }), /Unexpected compaction-fixture command during disposal/);
  assert.equal(continued, false);
  assert.equal(reply.status, 409);
  await assert.rejects(owned.dispose(async () => {}), AggregateError);
});
