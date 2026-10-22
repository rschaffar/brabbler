import assert from "node:assert/strict";
import test from "node:test";
import { readBrowserJson, readBrowserResponse } from "../e2e/browser-http.mjs";
import { createTaskOwner, deferred } from "./testing/async.fixture.mjs";

// Execute the actual callback passed to page.evaluate with a restored, process-
// local fetch double. This is NOT Chromium transport, native SDK shutdown,
// session cleanup ordering, or proof of the cause/resolution of a socket reset.
const page = { evaluate: (callback, argument) => callback(argument) };
const options = { concurrency: false };
const contracts = [
  { name: "manager GET JSON", read: readBrowserJson, request: undefined, status: 200,
    body: '{"operations":[{"id":"exact-id","state":"succeeded"}]}',
    value: { operations: [{ id: "exact-id", state: "succeeded" }] }, method: "GET" },
  { name: "Pause cleanup DELETE text", read: readBrowserResponse,
    request: { method: "DELETE", expectedStatus: "2xx" }, status: 204,
    body: "", value: "", method: "DELETE" },
];

for (const contract of contracts) {
  test(`${contract.name} owns body completion and preserves the exact method/query`, options, async t => {
    const owner = createTaskOwner(), entered = deferred(), release = deferred();
    t.after(async () => { release.resolve(contract.body); await owner.join(); });
    const calls = [];
    let bodies = 0;
    t.mock.method(globalThis, "fetch", async (url, init) => {
      calls.push({ url, init });
      return { status: contract.status, async text() { bodies++; entered.resolve(); return release.promise; } };
    });
    const url = "http://fixture.invalid/api/resource?cwd=%2Fprivate%2Frepo+with+spaces&key=a%2Bb&key=%252F";
    let completed = false;
    const work = owner.track("HTTP callback including body/JSON consumption",
      contract.read(page, url, contract.request).then(value => { completed = true; return value; }));
    await entered.promise;
    assert.equal(completed, false, "response headers do not settle an unreleased body");
    release.resolve(contract.body);
    assert.deepEqual(await work, contract.value);
    assert.deepEqual(calls, [{ url, init: { method: contract.method, cache: "no-store" } }]);
    assert.equal(bodies, 1);
  });
}

test("JSON reader forwards explicit method, raw body and exact expected status", options, async t => {
  const calls = [];
  let bodies = 0;
  const url = "http://fixture.invalid/api/resource?cwd=%2Fexact%20path&token=%2B";
  const body = '{ "literal": "body + %2F", "line": "\\n" }';
  t.mock.method(globalThis, "fetch", async (url, init) => {
    calls.push({ url, init });
    return { status: 202, async text() { bodies++; return '{"accepted":true}'; } };
  });
  assert.deepEqual(await readBrowserJson(page, url, { method: "DELETE", body, expectedStatus: 202 }), { accepted: true });
  assert.deepEqual(calls, [{ url, init: { method: "DELETE", cache: "no-store", body } }]);
  assert.equal(bodies, 1);
});

test("text reader preserves complete exact review text, including non-JSON", options, async t => {
  const text = `exact ref ${"a".repeat(40)}\r\nfull review π\n\n`;
  let requests = 0, bodies = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return { status: 200, async text() { bodies++; return text; } };
  });
  assert.equal(await readBrowserResponse(page, "http://fixture.invalid/exact-review"), text);
  assert.equal(requests, 1); assert.equal(bodies, 1);
});

for (const status of [201, 204, 299, 409, 500]) {
  test(`default exact-200 JSON read rejects HTTP ${status} after consuming its body, without retry`, options, async t => {
    let requests = 0, bodies = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return { status, async text() { bodies++; return "exact non-JSON HTTP failure detail"; } };
    });
    await assert.rejects(readBrowserJson(page, "http://fixture.invalid/operations"), error =>
      error.code === "ERR_ASSERTION" && error.actual === status && error.expected === 200
        && error.message.includes("exact non-JSON HTTP failure detail"));
    assert.equal(requests, 1); assert.equal(bodies, 1);
  });
}

for (const status of [200, 201, 204, 299]) {
  test(`DELETE preserves APIResponse.ok() success semantics for HTTP ${status}`, options, async t => {
    let requests = 0, bodies = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return { status, async text() { bodies++; return "text, not necessarily JSON"; } };
    });
    assert.equal(await readBrowserResponse(page, "http://fixture.invalid/session", {
      method: "DELETE", expectedStatus: "2xx",
    }), "text, not necessarily JSON");
    assert.equal(requests, 1); assert.equal(bodies, 1);
  });
}

for (const status of [199, 300, 409, 500]) {
  test(`DELETE rejects HTTP ${status} after consuming its body, without retry`, options, async t => {
    let requests = 0, bodies = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return { status, async text() { bodies++; return "exact DELETE failure detail"; } };
    });
    await assert.rejects(readBrowserResponse(page, "http://fixture.invalid/session", {
      method: "DELETE", expectedStatus: "2xx",
    }), error => error.code === "ERR_ASSERTION" && error.message.includes("exact DELETE failure detail"));
    assert.equal(requests, 1); assert.equal(bodies, 1);
  });
}

test("JSON read rejects a non-JSON successful body without retry", options, async t => {
  let requests = 0, bodies = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requests++;
    return { status: 200, async text() { bodies++; return "not JSON"; } };
  });
  await assert.rejects(readBrowserJson(page, "http://fixture.invalid/operations"), SyntaxError);
  assert.equal(requests, 1); assert.equal(bodies, 1);
});

for (const contract of contracts) {
  test(`${contract.name} propagates the exact transport failure without retry`, options, async t => {
    const failure = new Error("controlled transport failure");
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => { requests++; throw failure; });
    await assert.rejects(contract.read(page, "http://fixture.invalid/resource", contract.request), error => error === failure);
    assert.equal(requests, 1);
  });

  test(`${contract.name} propagates the exact body failure without retry`, options, async t => {
    const failure = new Error("controlled body failure");
    let requests = 0, bodies = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return { status: contract.status, async text() { bodies++; throw failure; } };
    });
    await assert.rejects(contract.read(page, "http://fixture.invalid/resource", contract.request), error => error === failure);
    assert.equal(requests, 1); assert.equal(bodies, 1);
  });
}

test("evaluate rejection propagates unchanged without another evaluation or Node fallback", options, async () => {
  const failure = new Error("controlled browser evaluation failure");
  let evaluations = 0;
  const unavailablePage = {
    evaluate: async () => { evaluations++; throw failure; },
    request: { delete() { assert.fail("must not fall back to Node HTTP"); } },
  };
  await assert.rejects(readBrowserResponse(unavailablePage, "http://fixture.invalid/session", {
    method: "DELETE", expectedStatus: "2xx",
  }), error => error === failure);
  assert.equal(evaluations, 1);
});
