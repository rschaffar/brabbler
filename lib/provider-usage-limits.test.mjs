import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { remainingRateLimits } = await createJiti(import.meta.url).import("./provider-usage-limits.ts");

test("shows reported subscription windows in weekly then 5h order", () => {
  assert.deepEqual(remainingRateLimits({ buckets: [
    { id: "primary", label: "5h", remaining: 88, unit: "percent", windowMinutes: 300 },
    { id: "secondary", label: "Weekly", remaining: 60, unit: "percent", windowMinutes: 10080 },
  ] }), ["Weekly 60% remaining", "5h 88% remaining"]);
});

test("reset dates appear only in the detailed view when supplied", () => {
  const report = { buckets: [
    { id: "weekly", label: "Weekly", remaining: 40, unit: "percent", resetsAt: 1_800_000_000 },
    { id: "5h", label: "5h", remaining: 2, limit: 10, unit: "count" },
  ] };
  assert.deepEqual(remainingRateLimits(report), ["Weekly 40% remaining", "5h 2/10 remaining"]);
  const date = new Date(1_800_000_000_000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
  assert.deepEqual(remainingRateLimits(report, "en-US"), [`Weekly 40% remaining (resets ${date})`, "5h 2/10 remaining"]);
  assert.deepEqual(remainingRateLimits({ buckets: [{ id: "weekly", label: "Weekly", remaining: 0, unit: "percent", resetsAt: NaN }] }, "en-US"), ["Weekly 0% remaining"]);
});

test("does not mislabel currency spend, absent windows, or other rolling windows", () => {
  assert.deepEqual(remainingRateLimits({ buckets: [
    { id: "weekly-spend", label: "Usage this week", remaining: 20, unit: "currency" },
    { id: "rolling", label: "Rolling", remaining: 10, unit: "percent" },
  ] }), []);
  assert.deepEqual(remainingRateLimits({ buckets: [
    { id: "weekly", label: "Weekly", remaining: 5, limit: 20, unit: "count" },
  ] }), ["Weekly 5/20 remaining"]);
});
