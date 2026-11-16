import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { fsCache: false });
const { createIdleChange } = await jiti.import("./session-idle-change.ts");
const change = (revision, value = revision) => Object.freeze({ revision, value });
const r7 = change("R7"), r8 = change("R8"), r9 = change("R9");
const current = () => createIdleChange({ desired: r7, applied: r7 });
const refused = (controller) => assert.throws(() => controller.assertFreshAdmission(), /Idle change/);

// Pure manual transitions prove controller policy only: no fake idle or action is
// evidence of real host admission, lease, card, queue, child or cleanup settlement.
test("baseline preserves known current applied; missing applied is pending", () => {
  const controller = current();
  assert.deepEqual(controller.snapshot(), {
    desired: r7, applied: r7, applying: undefined, error: undefined, pending: false,
  });
  assert.doesNotThrow(() => controller.assertFreshAdmission());
  assert.equal(controller.begin(), undefined);
  const unknown = createIdleChange({ desired: r7 });
  assert.equal(unknown.snapshot().applied, undefined);
  assert.equal(unknown.snapshot().pending, true);
  refused(unknown);
  assert.equal(unknown.begin().target.revision, "R7");
});

test("latest desired coalesces synchronously, preserving applied; cancel back needs no action", () => {
  const controller = current();
  controller.setDesired(r8);
  refused(controller);
  assert.equal(controller.snapshot().applied.revision, "R7");
  controller.setDesired(r9);
  assert.equal(controller.snapshot().desired.revision, "R9");
  controller.setDesired(r7);
  assert.equal(controller.snapshot().pending, false);
  assert.equal(controller.begin(), undefined);
  controller.assertFreshAdmission();
  controller.setDesired(r8);
  controller.setDesired(r9);
  assert.equal(controller.begin().target.revision, "R9");
});

test("begin owns one attempt and reentrant fresh input is visibly refused", () => {
  const controller = current();
  controller.setDesired(r8);
  const attempt = controller.begin();
  assert.equal(attempt.target.revision, "R8");
  assert.equal(controller.snapshot().applying.revision, "R8");
  assert.equal(controller.snapshot().applied, undefined);
  refused(controller);
  assert.equal(controller.begin(), undefined);
  assert.throws(() => controller.retry(), /unsettled work/);
  controller.settle(attempt, { applied: attempt.target });
  assert.equal(controller.snapshot().pending, false);
  assert.equal(controller.snapshot().applying, undefined);
  controller.assertFreshAdmission();
});

test("older completion records only its target, never acknowledges newer desired", () => {
  const controller = current();
  controller.setDesired(r8);
  const older = controller.begin();
  controller.setDesired(r9);
  controller.settle(older, { applied: older.target });
  assert.equal(controller.snapshot().applied.revision, "R8", "old completion must not acknowledge R9");
  assert.equal(controller.snapshot().desired.revision, "R9");
  assert.equal(controller.snapshot().pending, true);
  refused(controller);
  const newer = controller.begin();
  assert.equal(newer.target.revision, "R9");
  assert.throws(() => controller.settle(older, { applied: r8 }), /Unknown or settled/);
  assert.equal(controller.snapshot().applying.revision, "R9");
  controller.settle(newer, { applied: newer.target });
  controller.assertFreshAdmission();
});

test("revert while in flight does not cancel or silently restore old applied", () => {
  const controller = current();
  controller.setDesired(r8);
  const attempt = controller.begin();
  controller.setDesired(r7);
  refused(controller);
  assert.equal(controller.begin(), undefined);
  controller.settle(attempt, { applied: r8 });
  assert.equal(controller.snapshot().applied.revision, "R8");
  assert.equal(controller.begin().target.revision, "R7");
});

test("settled failure stays latched across saves and requires explicit latest-target retry", () => {
  const controller = current();
  controller.setDesired(r8);
  const failed = controller.begin();
  controller.settle(failed, { error: "bind failed" });
  assert.equal(controller.snapshot().applied, undefined);
  assert.deepEqual(controller.snapshot().error, { revision: "R8", message: "bind failed" });
  controller.setDesired(r9);
  controller.setDesired(r7);
  assert.equal(controller.snapshot().error.message, "bind failed");
  refused(controller);
  assert.equal(controller.begin(), undefined);
  controller.retry();
  assert.equal(controller.snapshot().error, undefined);
  refused(controller);
  const retried = controller.begin();
  assert.notEqual(retried, failed);
  assert.equal(retried.target.revision, "R7");
  controller.settle(retried, { applied: retried.target });
  controller.assertFreshAdmission();
});

test("same revision retry gets a new token; old error/completion cannot overwrite it", () => {
  const controller = createIdleChange({ desired: r8 });
  const first = controller.begin();
  controller.settle(first, { error: "first failure" });
  controller.retry();
  const second = controller.begin();
  const before = controller.snapshot();
  assert.throws(() => controller.reportError(first, "obsolete timeout"), /Unknown or settled/);
  assert.throws(() => controller.settle(first, { applied: r8 }), /Unknown or settled/);
  assert.deepEqual(controller.snapshot(), before);
  controller.settle(second, { applied: r8 });
  controller.setDesired(r9);
  const third = controller.begin();
  assert.throws(() => controller.settle(first, { error: "obsolete failure" }), /Unknown or settled/);
  assert.equal(controller.snapshot().error, undefined);
  controller.settle(third, { applied: r9 });
  controller.assertFreshAdmission();
});

test("reported timeout does not settle work or permit retry, even after desired advances", () => {
  const controller = current();
  controller.setDesired(r8);
  const attempt = controller.begin();
  controller.reportError(attempt, "response deadline");
  controller.setDesired(r9);
  assert.equal(controller.snapshot().applying.revision, "R8");
  assert.equal(controller.snapshot().error.revision, "R8");
  assert.equal(controller.snapshot().applied, undefined);
  assert.equal(controller.begin(), undefined);
  assert.throws(() => controller.retry(), /unsettled work/);
  refused(controller);
  controller.settle(attempt, { applied: r8, error: "cleanup failed" });
  assert.equal(controller.snapshot().applying, undefined);
  assert.equal(controller.snapshot().applied.revision, "R8");
  assert.equal(controller.snapshot().error.message, "response deadline\ncleanup failed");
  assert.equal(controller.snapshot().error.revision, "R8");
  assert.equal(controller.begin(), undefined);
  controller.retry();
  const next = controller.begin();
  assert.equal(next.target.revision, "R9");
  controller.settle(next, { applied: r9 });
  controller.assertFreshAdmission();
});

test("late success preserves timeout until explicit revalidation of the exact target", () => {
  const controller = createIdleChange({ desired: r8 });
  const attempt = controller.begin();
  controller.reportError(attempt, "timeout");
  controller.settle(attempt, { applied: r8 });
  assert.equal(controller.snapshot().applied.revision, "R8");
  assert.equal(controller.snapshot().pending, true);
  assert.equal(controller.snapshot().error.message, "timeout");
  refused(controller);
  assert.equal(controller.begin(), undefined);
  controller.retry();
  assert.equal(controller.snapshot().applied, undefined);
  const retry = controller.begin();
  assert.notEqual(retry, attempt);
  assert.equal(retry.target.revision, "R8");
  controller.settle(retry, { applied: retry.target });
  controller.assertFreshAdmission();
});

test("no confirmed target is not success; independently verified old state remains honest", () => {
  for (const actual of [undefined, r7, r9]) {
    const controller = createIdleChange({ desired: r8, applied: r7 });
    const attempt = controller.begin();
    controller.settle(attempt, { applied: actual });
    assert.equal(controller.snapshot().applied?.revision, actual?.revision);
    assert.match(controller.snapshot().error.message, /without confirming the attempted target/);
    refused(controller);
  }
  const controller = createIdleChange({ desired: r8, applied: r7 });
  const attempt = controller.begin();
  controller.settle(attempt, { applied: r7, error: "verified unchanged after failure" });
  controller.setDesired(r7);
  assert.equal(controller.snapshot().applied.revision, "R7");
  refused(controller); // Cancel-back cannot clear a failure.
});

test("unknown, forged, foreign and duplicate tokens never complete or diagnose work", () => {
  const controller = createIdleChange({ desired: r8 });
  const foreign = createIdleChange({ desired: r8 }).begin();
  for (const token of [undefined, {}, foreign]) {
    assert.throws(() => controller.settle(token, { applied: r8 }), /Unknown or settled/);
    assert.throws(() => controller.reportError(token, "unknown"), /Unknown or settled/);
  }
  const attempt = controller.begin();
  const before = controller.snapshot();
  for (const token of [{ ...attempt }, foreign, undefined]) {
    assert.throws(() => controller.settle(token, { applied: r9 }), /Unknown or settled/);
    assert.throws(() => controller.reportError(token, "forged"), /Unknown or settled/);
    assert.deepEqual(controller.snapshot(), before);
  }
  controller.settle(attempt, { applied: r8 });
  assert.throws(() => controller.settle(attempt, { error: "duplicate" }), /Unknown or settled/);
  assert.equal(controller.snapshot().pending, false);
});

test("snapshots/wrappers/tokens are immutable and detached; arbitrary values remain caller-owned", () => {
  const value = Object.freeze({ enabled: Object.freeze(["synthetic-resource"]) });
  const input = { revision: "opaque-z", value };
  const controller = createIdleChange({ desired: input });
  const before = controller.snapshot();
  input.revision = "caller-mutated-wrapper";
  assert.equal(before.desired.revision, "opaque-z");
  assert.notEqual(before.desired, input);
  assert.equal(before.desired.value, value);
  assert.throws(() => { before.pending = false; }, TypeError);
  assert.throws(() => { before.desired.revision = "forged"; }, TypeError);
  const attempt = controller.begin();
  assert.throws(() => { attempt.target = r9; }, TypeError);
  assert.throws(() => { attempt.target.value = "forged"; }, TypeError);
  controller.reportError(attempt, "first\u0000 diagnostic\n" + "x".repeat(800));
  const failed = controller.snapshot();
  assert.equal(failed.error.message.length, 512);
  assert.doesNotMatch(failed.error.message, /\p{Cc}/u);
  assert.throws(() => { failed.error.message = "cleared"; }, TypeError);
  controller.reportError(attempt, "second report");
  assert.equal(controller.snapshot().error.message, failed.error.message);
  const actual = { revision: "opaque-z", value };
  controller.settle(attempt, { applied: actual });
  actual.revision = "mutated-outcome-wrapper";
  assert.equal(controller.snapshot().applied.revision, "opaque-z");
  assert.equal(before.applied, undefined);
  assert.equal(before.error, undefined);
  assert.equal(failed.applying.revision, "opaque-z");
  const next = { revision: "opaque-a", value: () => "setter-shaped value" };
  controller.retry();
  controller.setDesired(next);
  next.revision = "changed";
  assert.equal(controller.begin().target.revision, "opaque-a"); // No lexical ordering.
  const cyclic = {}; cyclic.self = cyclic;
  assert.equal(createIdleChange({ desired: change("cycle", cyclic) }).snapshot().desired.value, cyclic);
});

test("empty settlement errors are failures, including empty report diagnostics", () => {
  const controller = createIdleChange({ desired: r8 });
  const attempt = controller.begin();
  controller.reportError(attempt, "\n\u0000 ");
  controller.settle(attempt, { applied: r8, error: "" });
  assert.equal(controller.snapshot().error.message, "Idle change failed.");
  refused(controller);
});
