import type { UsageBucket, UsageReport } from "./provider-usage";

/** Only rate-limit windows, never weekly API-key spend or a provider's credit balance. */
export function remainingRateLimits(report: Pick<UsageReport, "buckets">): string[] {
  const relevant = report.buckets.filter((bucket) => (bucket.unit === "percent" || bucket.unit === "count") && (
    bucket.windowMinutes === 10_080 || bucket.label === "Weekly" ||
    bucket.windowMinutes === 300 || bucket.label === "5h"
  ));
  const weekly = relevant.filter((bucket) => bucket.windowMinutes === 10_080 || bucket.label === "Weekly");
  const fiveHour = relevant.filter((bucket) => bucket.windowMinutes === 300 || bucket.label === "5h");
  return [...weekly, ...fiveHour.filter((bucket) => !weekly.includes(bucket))]
    .map((bucket: UsageBucket) => {
      const name = bucket.windowMinutes === 10_080 || bucket.label === "Weekly" ? "Weekly" : "5h";
      const prefix = bucket.groupLabel ? `${bucket.groupLabel} ${name}` : name;
      if (bucket.period === "Unlimited") return `${prefix} unlimited`;
      if (bucket.remaining === undefined) return "";
      return bucket.unit === "count" && bucket.limit !== undefined
        ? `${prefix} ${bucket.remaining}/${bucket.limit} remaining`
        : `${prefix} ${Math.round(bucket.remaining)}% remaining`;
    }).filter(Boolean);
}
