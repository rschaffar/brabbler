import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { readActivityReview, recordActivityCompletion, acknowledgeActivityCompletions, deferActivityCompletions, deferActivityRequests, ActivityReviewConflict } =
  await createJiti(import.meta.url, { tsconfigPaths: true }).import("./activity-review-server.ts");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-activity-review-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "pi-web", "activity-review.json");
}

test("completions survive reload and newer runs outrank receipts even if the clock moves backwards", (t) => {
  const path = fixture(t);
  const first = recordActivityCompletion("root", path, 100);
  assert.deepEqual(first, { sessionId: "root", at: 100 });
  acknowledgeActivityCompletions([first], path);
  assert.deepEqual(recordActivityCompletion("root", path, 1), { sessionId: "root", at: 101 });
  assert.deepEqual(readActivityReview(path), {
    completedRuns: [{ sessionId: "root", at: 101 }], reviewedRuns: [first], laterRuns: [], laterRequests: [],
  });
  assert.equal(JSON.parse(readFileSync(path, "utf8")).version, 1);
});

test("two clients' receipts merge rather than replacing one another; stale receipts cannot hide a new run", (t) => {
  const path = fixture(t);
  const first = recordActivityCompletion("root", path, 100);
  const child = recordActivityCompletion("child", path, 200);
  acknowledgeActivityCompletions([first], path);
  acknowledgeActivityCompletions([child], path);
  const newer = recordActivityCompletion("root", path, 300);
  acknowledgeActivityCompletions([first], path);
  assert.deepEqual(readActivityReview(path).reviewedRuns, [first, child]);
  acknowledgeActivityCompletions([newer], path);
  assert.deepEqual(readActivityReview(path).reviewedRuns, [newer, child]);
});

test("simultaneous receipts from separate processes retain both sessions", async (t) => {
  const path = fixture(t);
  const first = recordActivityCompletion("root", path, 100);
  const second = recordActivityCompletion("child", path, 200);
  const script = `const { createJiti } = require("jiti");
    const review = createJiti(process.cwd() + "/lib/activity-review-server.test.mjs", { tsconfigPaths: true }).import("./activity-review-server.ts");
    const entry = process.argv[4] === "deferActivityRequests"
      ? { sessionId: process.argv[2], requestId: "request-" + process.argv[2] }
      : { sessionId: process.argv[2], at: Number(process.argv[3]) };
    review.then((store) => store[process.argv[4]]([entry], process.argv[1]));`;
  const acknowledge = ({ sessionId, at }, operation = "acknowledgeActivityCompletions") => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", script, path, sessionId, String(at), operation], { cwd: process.cwd() });
    let errorText = "";
    child.stderr.on("data", (data) => { errorText += data; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Child failed: ${errorText}`)));
  });
  await Promise.all([acknowledge(first), acknowledge(second)]);
  assert.deepEqual(readActivityReview(path).reviewedRuns.sort((a, b) => a.sessionId.localeCompare(b.sessionId)),
    [second, first]);
  await Promise.all([acknowledge(first, "deferActivityCompletions"), acknowledge(second, "deferActivityCompletions"), acknowledge(first)]);
  assert.deepEqual(readActivityReview(path).laterRuns.sort((a, b) => a.sessionId.localeCompare(b.sessionId)), [second, first]);
  await Promise.all([acknowledge(first, "deferActivityRequests"), acknowledge(second, "deferActivityRequests"), acknowledge(first)]);
  assert.deepEqual(readActivityReview(path).laterRequests.sort((a, b) => a.sessionId.localeCompare(b.sessionId)), [
    { sessionId: "child", requestId: "request-child" }, { sessionId: "root", requestId: "request-root" },
  ]);
  assert.deepEqual(readActivityReview(path).reviewedRuns.sort((a, b) => a.sessionId.localeCompare(b.sessionId)), [second, first]);
});

test("reject unknown and future receipts without changing the store; legacy imports ignore vanished runs", (t) => {
  const path = fixture(t);
  const current = recordActivityCompletion("root", path, 100);
  assert.throws(() => acknowledgeActivityCompletions([{ sessionId: "unknown", at: 100 }], path), ActivityReviewConflict);
  assert.throws(() => acknowledgeActivityCompletions([{ sessionId: "root", at: 101 }], path), ActivityReviewConflict);
  assert.deepEqual(readActivityReview(path).reviewedRuns, []);
  acknowledgeActivityCompletions([{ sessionId: "unknown", at: 100 }, current], path, true);
  assert.deepEqual(readActivityReview(path).reviewedRuns, [current]);
});

test("bounds both completions and acknowledgements by the most recently settled sessions", (t) => {
  const path = fixture(t);
  const first = recordActivityCompletion("old", path, 1);
  acknowledgeActivityCompletions([first], path);
  deferActivityCompletions([first], path);
  for (let i = 0; i < 1000; i++) recordActivityCompletion(`new-${i}`, path, i + 2);
  const snapshot = readActivityReview(path);
  assert.equal(snapshot.completedRuns.length, 1000);
  assert.deepEqual(snapshot.laterRuns, []);
  assert.equal(snapshot.completedRuns.some((entry) => entry.sessionId === "old"), false);
  assert.deepEqual(snapshot.reviewedRuns, []);
});

test("Later receipts survive reload, merge clients, and never read a result or defer its newer completion", (t) => {
  const path = fixture(t);
  const root = recordActivityCompletion("root", path, 100);
  const child = recordActivityCompletion("child", path, 200);
  deferActivityCompletions([root], path);
  deferActivityCompletions([child], path);
  assert.deepEqual(readActivityReview(path).laterRuns, [root, child]);
  assert.deepEqual(readActivityReview(path).reviewedRuns, []);
  const newer = recordActivityCompletion("root", path, 1);
  deferActivityCompletions([root], path);
  assert.ok(readActivityReview(path).laterRuns.find((entry) => entry.sessionId === "root").at < newer.at);
  deferActivityCompletions([newer], path);
  deferActivityCompletions([root], path);
  assert.deepEqual(readActivityReview(path).laterRuns, [newer, child]);
  acknowledgeActivityCompletions([newer], path);
  deferActivityCompletions([newer], path);
  assert.deepEqual(readActivityReview(path).reviewedRuns, [newer], "Read wins even when another client defers the same result");
  const before = readFileSync(path, "utf8");
  assert.throws(() => deferActivityCompletions([{ sessionId: "missing", at: 1 }], path), ActivityReviewConflict);
  assert.throws(() => deferActivityCompletions([{ ...child, at: 201 }], path), ActivityReviewConflict);
  assert.equal(readFileSync(path, "utf8"), before);
});

test("request deferrals persist exact IDs independently of completions, merge clients and remain bounded", (t) => {
  const path = fixture(t);
  const first = { sessionId: "root", requestId: "first" };
  const second = { sessionId: "child", requestId: "question" };
  deferActivityRequests([first], path);
  deferActivityRequests([second, first], path);
  assert.deepEqual(readActivityReview(path).laterRequests, [first, second]);
  assert.deepEqual(readActivityReview(path).reviewedRuns, []);
  assert.deepEqual(readActivityReview(path).completedRuns, []);
  const newer = { sessionId: "root", requestId: "replacement" };
  deferActivityRequests([newer], path);
  assert.deepEqual(readActivityReview(path).laterRequests, [first, second, newer]);
  deferActivityRequests(Array.from({ length: 1000 }, (_, i) => ({ sessionId: "root", requestId: `request-${i}` })), path);
  assert.equal(readActivityReview(path).laterRequests.length, 1000);
  assert.equal(readActivityReview(path).laterRequests.some((entry) => entry.requestId === "first"), false);
  const before = readFileSync(path, "utf8");
  assert.throws(() => deferActivityRequests([{ sessionId: "root", requestId: "" }], path), /Invalid activity requests/);
  assert.equal(readFileSync(path, "utf8"), before);
});

test("legacy files without Later are readable; malformed deferrals fail closed", (t) => {
  const path = fixture(t);
  const root = recordActivityCompletion("root", path, 100);
  const legacy = { version: 1, completedRuns: [root], reviewedRuns: [] };
  writeFileSync(path, JSON.stringify(legacy));
  assert.deepEqual(readActivityReview(path).laterRuns, []);
  assert.deepEqual(readActivityReview(path).laterRequests, []);
  for (const laterRequests of [null, {}, [{ sessionId: "root", requestId: "" }], [root]]) {
    writeFileSync(path, JSON.stringify({ ...legacy, laterRequests }));
    assert.throws(() => readActivityReview(path), /Invalid activity/);
  }
  for (const laterRuns of [null, {}, [root, root], [{ ...root, at: 101 }], [{ sessionId: "missing", at: 1 }]]) {
    writeFileSync(path, JSON.stringify({ ...legacy, laterRuns }));
    const corrupt = readFileSync(path, "utf8");
    assert.throws(() => deferActivityCompletions([root], path), /Invalid activity/);
    assert.equal(readFileSync(path, "utf8"), corrupt);
  }
});

test("malformed storage is never silently overwritten", (t) => {
  const path = fixture(t);
  recordActivityCompletion("root", path, 100);
  writeFileSync(path, '{"version":1,"completedRuns":[],"reviewedRuns":[{"sessionId":"root","at":100}]}');
  const corrupt = readFileSync(path, "utf8");
  assert.throws(() => readActivityReview(path), /Invalid activity acknowledgement/);
  assert.throws(() => recordActivityCompletion("root", path, 101), /Invalid activity acknowledgement/);
  assert.equal(readFileSync(path, "utf8"), corrupt);
});
