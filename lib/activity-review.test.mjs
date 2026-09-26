import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { reconcileCompletedRuns, hasReviewedRunBaseline, loadReviewedRunTimes, mergeReviewedRunTimes, saveReviewedRunTimes } =
  await createJiti(import.meta.url, { tsconfigPaths: true }).import("./activity-review.ts");
const session = (id, props = {}) => ({ id, cwd: "/project", created: "2026-01-01", modified: "2026-01-01", firstMessage: id, ...props });

test("first browser observation can establish a baseline; cross-tab writes merge acknowledgements", (t) => {
  const oldWindow = globalThis.window;
  const values = new Map();
  globalThis.window = { localStorage: {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  } };
  t.after(() => { if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow; });
  assert.equal(hasReviewedRunBaseline(), false);
  saveReviewedRunTimes(new Map([["old", 5]]));
  assert.equal(hasReviewedRunBaseline(), true);
  assert.equal(loadReviewedRunTimes().get("old"), 5);
  assert.deepEqual([...mergeReviewedRunTimes(new Map([["old", 9]]), new Map([["old", 7], ["other", 3]]))],
    [["old", 9], ["other", 3]]);
  saveReviewedRunTimes(new Map([["other", 3]]));
  assert.deepEqual([...loadReviewedRunTimes()], [["other", 3], ["old", 5]]);
});

test("short background runs are reviewable even without an observed running transition", () => {
  const result = reconcileCompletedRuns([{ sessionId: "root", at: 15 }, { sessionId: "child", at: 20 }],
    new Map(), new Set(), [session("root"), session("child", { relation: { kind: "subagent", parentSessionId: "root" } })]);
  assert.deepEqual([...result.rootReady], ["root"]);
  assert.deepEqual([...result.subagentReady], ["child"]);
});

test("opening a session does not acknowledge it; only its explicit receipt hides that completion", () => {
  const completions = [{ sessionId: "root", at: 15 }];
  const sessions = [session("root")];
  assert.deepEqual([...reconcileCompletedRuns(completions, new Map(), new Set(), sessions).rootReady], ["root"]);
  assert.equal(reconcileCompletedRuns(completions, new Map([["root", 15]]), new Set(), sessions).rootReady.size, 0);
  assert.deepEqual([...reconcileCompletedRuns([{ sessionId: "root", at: 16 }], new Map([["root", 15]]),
    new Set(), sessions).rootReady], ["root"]);
});

test("running, missing, and archived families are never mistaken for finished work", () => {
  const sessions = [session("root"), session("archived", { archived: true }),
    session("hidden", { relation: { kind: "subagent", parentSessionId: "archived" } })];
  const result = reconcileCompletedRuns(["root", "archived", "hidden", "external"].map((id) => ({ sessionId: id, at: 12 })),
    new Map(), new Set(["root"]), sessions);
  assert.equal(result.rootReady.size, 0);
  assert.equal(result.subagentReady.size, 0);
});
