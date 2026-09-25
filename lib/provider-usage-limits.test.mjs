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

test("does not mislabel currency spend, absent windows, or other rolling windows", () => {
  assert.deepEqual(remainingRateLimits({ buckets: [
    { id: "weekly-spend", label: "Usage this week", remaining: 20, unit: "currency" },
    { id: "rolling", label: "Rolling", remaining: 10, unit: "percent" },
  ] }), []);
  assert.deepEqual(remainingRateLimits({ buckets: [
    { id: "weekly", label: "Weekly", remaining: 5, limit: 20, unit: "count" },
  ] }), ["Weekly 5/20 remaining"]);
});
