import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { waitForForkResponse } from "../e2e/running-session-forks.mjs";

test("fork fixture response waits preserve the original response and options", async () => {
  const response = { status: () => 200 };
  const pending = Promise.resolve(response);
  const predicate = () => true;
  const options = { timeout: 120_000 };
  const page = { waitForResponse: (...args) => {
    assert.deepEqual(args, [predicate, options]);
    return pending;
  } };
  const observed = waitForForkResponse(page, predicate, options);
  assert.equal(observed, pending);
  assert.equal(await observed, response);
});

test("fork fixture observes an early rejection without swallowing the later await failure", async () => {
  const failure = new Error("Fixture response timeout");
  const pending = Promise.reject(failure);
  const page = { waitForResponse: () => pending };
  const observed = waitForForkResponse(page, () => true);
  assert.equal(observed, pending);
  // An unobserved rejection here fails Node's test harness while another UI
  // assertion is pending, before normal browser-harness teardown can run.
  await delay(0);
  await assert.rejects(observed, (error) => error === failure);
});
