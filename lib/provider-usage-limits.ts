import type { UsageBucket, UsageReport } from "./provider-usage";

/** Only rate-limit windows, never weekly API-key spend or a provider's credit balance. */
export function remainingRateLimits(report: Pick<UsageReport, "buckets">, detailLocale?: string): string[] {
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
      const remaining = bucket.unit === "count" && bucket.limit !== undefined
        ? `${bucket.remaining}/${bucket.limit}` : `${Math.round(bucket.remaining)}%`;
      const resetDate = bucket.resetsAt === undefined ? NaN : bucket.resetsAt * 1_000;
      const reset = detailLocale && Number.isFinite(resetDate) && resetDate >= 0 && resetDate <= 8_640_000_000_000_000
        ? ` (resets ${new Date(resetDate).toLocaleString(detailLocale, { dateStyle: "medium", timeStyle: "short" })})` : "";
      return `${prefix} ${remaining} remaining${reset}`;
    }).filter(Boolean);
}
