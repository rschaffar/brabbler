/** Display-only SDK Code-mode snapshots. IDs may be duplicated/unstable while
 * calls run, and args is a truncated preview, never authoritative arguments.
 * Do not merge this with transcript nestedCalls or derive file authority. */
export interface NativeCallDisplay {
  name: string; preview: string; status: "running" | "ok" | "error" | "cancelled";
  durationMs?: number; error?: string; cost?: number;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export function nativeCallSnapshot(details: unknown): { calls: NativeCallDisplay[]; omitted: number } | null {
  if (!record(details) || !Array.isArray(details.calls)) return null;
  const calls: NativeCallDisplay[] = [];
  for (const value of details.calls.slice(0, 256)) {
    if (!record(value) || typeof value.name !== "string" || typeof value.args !== "string"
      || typeof value.status !== "string" || !["running", "ok", "error", "cancelled"].includes(value.status)) return null;
    calls.push({ name: value.name.slice(0, 256), preview: value.args.slice(0, 200), status: value.status as NativeCallDisplay["status"],
      ...(nonnegative(value.durationMs) ? { durationMs: value.durationMs } : {}),
      ...(typeof value.error === "string" ? { error: value.error.slice(0, 500) } : {}),
      ...(nonnegative(value.cost) ? { cost: value.cost } : {}),
    });
  }
  return { calls, omitted: Math.max(0, details.calls.length - calls.length) };
}
