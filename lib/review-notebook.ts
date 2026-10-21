/** Declarative authoring data only; this parser grants no file or Git authority. */
export const MAX_REVIEW_BLOCK_CHARS = 16_384;
export const MAX_REVIEW_SOURCE_LINES = 400;
export interface ReviewCommitReference {
  cwd: string;
  branch: string;
  oid: string;
}
export type ReviewBlock = ReviewCommitReference & {
  version: 1;
  id: string;
  title: string;
  priority?: "thorough" | "focused" | "brief" | "tooling";
} & ({ kind: "commit" } | { kind: "source"; path: string; start: number; end: number });
export type ReviewBlockResult = { value: ReviewBlock; error?: never } | { error: string; value?: never };

export function isReviewSourcePath(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096 &&
    !/[\x00-\x1f\\]/.test(value) && !value.startsWith("/") && !/^[a-z]:/i.test(value) &&
    value.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
export function isReviewSourceRange(start: unknown, end: unknown): start is number {
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && (start as number) >= 1 &&
    (end as number) >= (start as number) && (end as number) - (start as number) < MAX_REVIEW_SOURCE_LINES;
}

export function parseReviewBlock(source: string): ReviewBlockResult {
  const invalid = (error: string): ReviewBlockResult => ({ error });
  if (source.length > MAX_REVIEW_BLOCK_CHARS) return invalid("Review block exceeds the 16,384-character text limit.");
  let data: unknown;
  try { data = JSON.parse(source); } catch { return invalid("Review block must contain a JSON object."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return invalid("Review block must contain a JSON object.");
  const value = data as Record<string, unknown>;
  if (value.version !== 1) return invalid("Unsupported review block version; expected 1.");
  if (value.kind !== "commit" && value.kind !== "source") return invalid("Review kind must be source or commit.");
  const fields = ["version", "kind", "id", "title", "priority", "cwd", "branch", "oid", ...(value.kind === "source" ? ["path", "start", "end"] : [])];
  if (Object.keys(value).some(key => !fields.includes(key))) return invalid("Unknown review block field.");
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value.id)) return invalid("Review id must be a stable identifier (1–128 letters, digits, hyphens or underscores).");
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 240 || /[\x00-\x1f]/.test(value.title)) return invalid("Review title must be a short, nonempty line.");
  if (typeof value.cwd !== "string" || value.cwd.length > 4096 || /[\x00-\x1f]/.test(value.cwd) ||
    !/^(?:\/|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value.cwd)) return invalid("Review cwd must be an absolute checkout path.");
  if (typeof value.branch !== "string" || !value.branch || value.branch.length > 256 || /[\x00-\x20]/.test(value.branch)) return invalid("Review branch must name a local branch.");
  if (typeof value.oid !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value.oid)) return invalid("Review oid must be a full lowercase commit ID.");
  if (value.priority !== undefined && (typeof value.priority !== "string" || !["thorough", "focused", "brief", "tooling"].includes(value.priority))) return invalid("Unknown review priority.");
  if (value.kind === "source" && (!isReviewSourcePath(value.path) || !isReviewSourceRange(value.start, value.end))) return invalid("Source requires a literal repository-relative path and a range of 1–400 lines.");
  return { value: value as unknown as ReviewBlock };
}

export interface ReviewSource {
  oid: string; path: string; start: number; end: number; totalLines: number; contents: string;
}
export interface ReviewNavigation extends ReviewCommitReference { head: string; requestId: number }

export function reviewExplorerUrl(reference: ReviewCommitReference, op: "log" | "commit" | "source" | "patch" | "context", extra: Record<string, string> = {}): string {
  return `/api/git/explorer?${new URLSearchParams({ cwd: reference.cwd, branch: reference.branch, ...(op === "log" ? {} : { oid: reference.oid }), op, ...extra })}`;
}
