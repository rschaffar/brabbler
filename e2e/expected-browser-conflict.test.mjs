import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { consumeExpectedBrowserConflict, withExpectedBrowserConflict } from "./expected-browser-conflict.mjs";

const url = "http://127.0.0.1:12345/api/git/integration";
const body = { sessionId: "fixture", operation: "confirm", planId: "original", approvePlanId: "original", actionId: "action" };
const declaration = { scenario: "moved target", url, method: "POST", body };
const event = (where = url, status = 409) => ({
  text: () => `Failed to load resource: the server responded with a status of ${status} (${status === 409 ? "Conflict" : "Internal Server Error"})`,
  location: () => ({ url: where }),
});
function fixture({ method = "POST", requestBody = body, status = 409, requestUrl = url } = {}) {
  const page = new EventEmitter();
  const request = { url: () => requestUrl, method: () => method, postDataJSON: () => requestBody };
  const response = { url: () => requestUrl, request: () => request, status: () => status };
  return { page, request, response };
}

for (const consoleFirst of [true, false]) test(`one corroborated conflict, console first=${consoleFirst}`, async () => {
  const { page, request, response } = fixture();
  assert.equal(consumeExpectedBrowserConflict(page, event()), false, "undeclared errors survive");
  await withExpectedBrowserConflict(page, declaration, async () => {
    page.emit("request", request);
    if (!consoleFirst) page.emit("response", response);
    assert.equal(consumeExpectedBrowserConflict(page, event()), true);
    assert.equal(consumeExpectedBrowserConflict(page, event()), false, "duplicates survive");
    if (consoleFirst) page.emit("response", response);
    return response;
  });
  assert.equal(consumeExpectedBrowserConflict(page, event()), false, "late errors survive");
  assert.equal(page.listenerCount("request"), 0);
  assert.equal(page.listenerCount("response"), 0);
});

for (const [name, options] of [
  ["wrong method", { method: "GET" }],
  ["foreign session", { requestBody: { ...body, sessionId: "foreign" } }],
  ["replacement plan", { requestBody: { ...body, planId: "replacement" } }],
  ["replacement approval", { requestBody: { ...body, approvePlanId: "replacement" } }],
  ["foreign action", { requestBody: { ...body, actionId: "foreign" } }],
  ["foreign URL", { requestUrl: `${url}?sessionId=foreign` }],
  ["server error", { status: 500 }],
]) test(`${name} cannot corroborate an expected console conflict`, async () => {
  const { page, request, response } = fixture(options);
  await assert.rejects(withExpectedBrowserConflict(page, declaration, async () => {
    page.emit("request", request);
    page.emit("response", response);
    consumeExpectedBrowserConflict(page, event());
    return response;
  }), assert.AssertionError);
  assert.equal(consumeExpectedBrowserConflict(page, event()), false);
});

test("other URLs, non-conflict errors and retries are not ignored", async () => {
  const { page, request, response } = fixture();
  await assert.rejects(withExpectedBrowserConflict(page, declaration, async () => {
    for (const where of ["http://other.invalid/api/git/integration", `${url}?sessionId=fixture`, url.replace("integration", "verification")]) {
      assert.equal(consumeExpectedBrowserConflict(page, event(where)), false);
    }
    assert.equal(consumeExpectedBrowserConflict(page, event(url, 500)), false);
    page.emit("request", request);
    page.emit("request", request);
    page.emit("response", response);
    consumeExpectedBrowserConflict(page, event());
    return response;
  }), /exactly one request/);
});

test("a failed body/ref assertion still fails and retires the declaration", async () => {
  const { page } = fixture();
  await assert.rejects(withExpectedBrowserConflict(page, declaration, async () => {
    consumeExpectedBrowserConflict(page, event());
    throw new Error("unexpected native outcome");
  }), /unexpected native outcome/);
  assert.equal(consumeExpectedBrowserConflict(page, event()), false);
});
