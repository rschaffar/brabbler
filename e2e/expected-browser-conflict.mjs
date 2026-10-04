import assert from "node:assert/strict";

const active = new WeakMap();
const conflictText = "Failed to load resource: the server responded with a status of 409 (Conflict)";

/** Only a currently declared fixture may claim a console message. The enclosing
 * helper MUST subsequently corroborate the one original request and response.
 * Console/response event ordering differs across Chromium versions.
 */
export function consumeExpectedBrowserConflict(page, event) {
  const expected = active.get(page);
  if (!expected || event.text() !== conflictText || event.location().url !== expected.url || expected.consumed) return false;
  expected.consumed = true;
  expected.consoleSeen();
  return true;
}

export async function withExpectedBrowserConflict(page, { scenario, url, method, body }, action) {
  assert.ok(scenario, "Name the deliberate negative fixture");
  assert.equal(active.has(page), false, "Conflict declarations cannot overlap");
  const requests = [], responses = [];
  const request = (http) => { if (http.url() === url) requests.push(http); };
  const response = (http) => { if (http.url() === url) responses.push(http); };
  let consoleSeen;
  const consoleReady = new Promise(resolve => { consoleSeen = resolve; });
  const expected = { url, consumed: false, consoleSeen };
  active.set(page, expected);
  page.on("request", request);
  page.on("response", response);
  let timer;
  try {
    // The caller asserts the real refusal body, no-retry and ref invariants,
    // then returns the very response it checked (not a reconstructed identity).
    const refused = await action();
    assert.equal(requests.length, 1, `${scenario}: exactly one request to ${url}`);
    assert.equal(requests[0].method(), method, scenario);
    assert.deepEqual(requests[0].postDataJSON(), body, `${scenario}: original approval identity`);
    assert.deepEqual(responses, [refused], `${scenario}: exactly the asserted response`);
    assert.equal(refused.request(), requests[0], scenario);
    assert.equal(refused.status(), 409, scenario);
    await Promise.race([consoleReady, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${scenario}: missing console 409 for ${method} ${url}`)), 5000);
    })]);
  } finally {
    clearTimeout(timer);
    active.delete(page);
    page.off("request", request);
    page.off("response", response);
  }
}
