import assert from "node:assert/strict";

/** Positive HTTP verification through actual browser transport, including the
 * complete body in the retained trace. No retry, fallback or error exemption.
 * expectedStatus is exact by default; "2xx" preserves APIResponse.ok() callers.
 * body, when supplied, is passed through unchanged (no JSON encoding). */
export async function readBrowserResponse(page, url, { method = "GET", body, expectedStatus = 200 } = {}) {
  const response = await page.evaluate(async ({ target, method, body }) => {
    const result = await fetch(target, { method, cache: "no-store", ...(body === undefined ? {} : { body }) });
    return { status: result.status, text: await result.text() };
  }, { target: url, method, body });
  if (expectedStatus === "2xx") assert.ok(response.status >= 200 && response.status < 300, response.text);
  else assert.equal(response.status, expectedStatus, response.text);
  return response.text;
}

export async function readBrowserJson(page, url, options) {
  return JSON.parse(await readBrowserResponse(page, url, options));
}
