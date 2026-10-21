import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { fsCache: false });
const { runSessionMoveBatches: run, readSessionMoveResponse: read, SessionMoveResponseError } = await jiti.import("./session-move-client.ts");
const plan = (count = 12) => ({ project: "/old", cwd: "/new", missingOnly: false,
  roots: Array.from({ length: count }, (_, i) => ({ id: `root-${i}`, sourceCwd: "/old", memberIds: [`root-${i}`], bindings: [{ id: `root-${i}`, cwd: "/old", path: `/sessions/root-${i}.jsonl` }] })),
  sessionCount: count, archivedCount: 0, affectedIds: Array.from({ length: count }, (_, i) => `root-${i}`) });
const ok = data => Response.json(data);
const success = ids => ({ succeeded: ids, skipped: [], failed: [], movedIds: ids, pending: [] });

test("sequential five-root requests retain exact reviewed bindings and report real progress", async () => {
  const reviewed = plan(), calls = [], progress = []; let active = 0;
  const result = await run(reviewed, p => progress.push(p), async (_url, init) => {
    assert.equal(++active, 1); const body = JSON.parse(init.body); calls.push(body);
    assert.equal(body.mode, "execute"); assert.deepEqual(body.plan, reviewed);
    await new Promise(resolve => setImmediate(resolve)); active--;
    return ok(success(body.rootIds));
  });
  assert.deepEqual(calls.map(call => call.rootIds.length), [5, 5, 2]);
  assert.equal(result.movedIds.length, 12); assert.equal(result.uncertain, false); assert.deepEqual(result.pending, []);
  assert.deepEqual(progress.map(p => p.completedRoots), [0, 5, 10, 12]);
});

test("cooperative server yield advances only the explicitly pending roots", async () => {
  const calls = [];
  const result = await run(plan(3), () => {}, async (_url, init) => {
    const { rootIds: ids } = JSON.parse(init.body); calls.push(ids);
    return ok({ ...success(ids.slice(0, 1)), pending: ids.slice(1) });
  });
  assert.deepEqual(calls, [["root-0", "root-1", "root-2"], ["root-1", "root-2"], ["root-2"]]);
  assert.equal(result.movedIds.length, 3);
});

for (const failure of ["html", "network", "malformed", "zero-progress", "missing-members"]) {
  test(`uncertain ${failure} acknowledgement stops every subsequent mutation and reconciles only that batch`, async () => {
    const calls = [], progress = [];
    const result = await run(plan(), p => progress.push(p), async (_url, init) => {
      const body = JSON.parse(init.body); calls.push(body);
      if (calls.length === 1) return ok(success(body.rootIds));
      if (body.mode === "reconcile") return ok({ roots: body.rootIds.map((id, index) => ({ id, state: index === 0 ? "destination" : index === 1 ? "source" : index === 2 ? "changed" : "unknown", memberIds: [id] })) });
      if (failure === "html") return new Response("<html>gateway timeout PRIVATE_BODY</html>", { status: 504 });
      if (failure === "network") throw new TypeError("Network disconnected");
      if (failure === "malformed") return ok({ succeeded: body.rootIds });
      if (failure === "zero-progress") return ok({ ...success([]), pending: body.rootIds });
      return ok({ ...success(body.rootIds), movedIds: [] });
    });
    assert.deepEqual(calls.map(call => call.mode), ["execute", "execute", "reconcile"]);
    assert.deepEqual(calls[2].rootIds, calls[1].rootIds);
    assert.equal(result.uncertain, true); assert.equal(result.succeeded.length, 5);
    assert.equal(result.pending.length, 7); assert.deepEqual(result.observedDestinationIds, ["root-5"]);
    assert.equal(result.movedIds.includes("root-5"), false, "observed locations are not execution receipts");
    assert.deepEqual(result.invalidatedIds, ["root-5", "root-6", "root-7", "root-8", "root-9"], "invalidate possibly stale chats but not unattempted future families");
    assert.equal(progress.at(-1).checking, true);
    assert.doesNotMatch(String(result.error), /PRIVATE_BODY|Unexpected token/);
  });
}

test("failed or malformed reconciliation leaves everything unconfirmed without retry", async () => {
  for (const response of [() => { throw Error("offline"); }, () => ok({ roots: [{ id: "injected", state: "destination", memberIds: ["injected"] }] })]) {
    const calls = [];
    const result = await run(plan(2), () => {}, async (_url, init) => {
      const body = JSON.parse(init.body); calls.push(body.mode);
      if (body.mode === "execute") return new Response("timeout", { status: 504 });
      return response();
    });
    assert.deepEqual(calls, ["execute", "reconcile"]);
    assert.equal(result.observation, undefined); assert.deepEqual(result.observedDestinationIds, []);
    assert.deepEqual(result.movedIds, []);
    assert.deepEqual(result.invalidatedIds, ["root-0", "root-1"], "failed observation still invalidates uncertain chats without claiming moved results");
  }
});

test("safe HTTP errors do not expose proxy HTML or parser details", async () => {
  await assert.rejects(read(new Response("secret proxy body", { status: 502 })), error => error instanceof SessionMoveResponseError && error.status === 502 && !String(error).includes("secret"));
  await assert.rejects(read(Response.json({ error: "Stop the session first" }, { status: 409 })), /Stop the session first/);
  await assert.rejects(read(Response.json({ error: "Fixture listing unavailable" })), /Fixture listing unavailable/);
  await assert.rejects(read(Response.json(null)), SessionMoveResponseError);
});
