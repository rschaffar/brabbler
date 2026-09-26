export type BulkSessionAction = "archive" | "restore" | "delete";

export interface BulkSessionResult {
  succeeded: string[];
  failed: { id: string; status: number | "network" }[];
}

// Use the same per-session routes as the row actions. A batch is intentionally
// not atomic: sequential requests avoid overlapping family rewrites on delete,
// and callers keep the failed IDs selected for retry.
export async function runBulkSessionAction(
  ids: readonly string[],
  action: BulkSessionAction,
  fetchSession: typeof fetch = fetch,
  onProgress?: (completed: number) => void,
): Promise<BulkSessionResult> {
  const result: BulkSessionResult = { succeeded: [], failed: [] };
  for (const id of new Set(ids)) {
    try {
      const response = await fetchSession(`/api/sessions/${encodeURIComponent(id)}`, action === "delete"
        ? { method: "DELETE" }
        : {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ archived: action === "archive" }),
          });
      if (response.ok) result.succeeded.push(id);
      else result.failed.push({ id, status: response.status });
    } catch {
      result.failed.push({ id, status: "network" });
    }
    onProgress?.(result.succeeded.length + result.failed.length);
  }
  return result;
}
