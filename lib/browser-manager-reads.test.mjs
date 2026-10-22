import assert from "node:assert/strict";
import test from "node:test";
import { readManagerJson, readManagerResponse } from "../e2e/worktree-manager-discard.mjs";
import { createTaskOwner, deferred } from "./testing/async.fixture.mjs";

// Execute the real serialized browser callback with a process-local fetch double.
// This proves its response/error contract, not browser networking or socket reuse.
const page = { evaluate: (callback, url) => callback(url) };
const options = { concurrency: false };

test("manager JSON verification owns the actual body and preserves its exact query", options, async t => {
  const owner = createTaskOwner(), entered = deferred(), release = deferred();
  t.after(async () => { release.resolve('{"operations":[]}'); await owner.join(); });
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return { status: 200, async text() { entered.resolve(); return release.promise; } };
  });
  const url = `http://fixture.invalid/api/project-actions?${new URLSearchParams({ cwd: "/private/repo with spaces" })}`;
  let completed = false;
  const work = owner.track("browser response including JSON consumption", readManagerJson(page, url).then(value => {
    completed = true; return value;
  }));
  await entered.promise;
  assert.equal(completed, false, "an entered but unreleased body is not complete");
  release.resolve('{"operations":[{"id":"exact-id","state":"succeeded"}]}');
  assert.deepEqual(await work, { operations: [{ id: "exact-id", state: "succeeded" }] });
  assert.deepEqual(calls, [{ url, init: { cache: "no-store" } }]);
});

test("manager exact-review download preserves the complete response text", options, async t => {
  const text = `exact ref ${"a".repeat(40)}\nfull review\n`;
  t.mock.method(globalThis, "fetch", async () => new Response(text, { status: 200 }));
  assert.equal(await readManagerResponse(page, "http://fixture.invalid/exact-review"), text);
});

test("manager positive verification rejects a non-200 after consuming its body", options, async t => {
  let requests = 0, bodies = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return { status: 409, async text() { bodies++; return "fixture conflict detail"; } };
  });
  await assert.rejects(readManagerJson(page, "http://fixture.invalid/operations"), error =>
    error.code === "ERR_ASSERTION" && error.message.includes("fixture conflict detail"));
  assert.equal(requests, 1); assert.equal(bodies, 1);
});

test("manager JSON verification rejects an invalid successful body", options, async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("not JSON", { status: 200 }));
  await assert.rejects(readManagerJson(page, "http://fixture.invalid/operations"), SyntaxError);
});

test("manager verification propagates the exact transport failure without retry", options, async t => {
  const failure = new Error("controlled transport failure");
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; throw failure; });
  await assert.rejects(readManagerJson(page, "http://fixture.invalid/operations"), error => error === failure);
  assert.equal(requests, 1);
});

test("manager verification propagates the exact body failure without retry", options, async t => {
  const failure = new Error("controlled body failure");
  let requests = 0, bodies = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return { status: 200, async text() { bodies++; throw failure; } };
  });
  await assert.rejects(readManagerResponse(page, "http://fixture.invalid/review"), error => error === failure);
  assert.equal(requests, 1); assert.equal(bodies, 1);
});
