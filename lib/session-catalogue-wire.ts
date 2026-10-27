import type { SessionInfo } from "./types";

// Only these display/project strings may be references. IDs, paths, timestamps,
// counts, flags and relation discriminants keep their ordinary representation.
const TEXT_FIELDS = ["cwd", "firstMessage", "name", "projectRoot", "projectKey", "branch"] as const;
type TextField = typeof TEXT_FIELDS[number];
type Relation = NonNullable<SessionInfo["relation"]>;
type Subagent = Extract<Relation, { kind: "subagent" }>;
type WireRow = Omit<SessionInfo, TextField | "relation"> & {
  cwd: string | number;
  firstMessage: string | number;
  name?: string | number;
  projectRoot?: string | number;
  projectKey?: string | number;
  branch?: string | number;
  relation?: Exclude<Relation, Subagent> | (Omit<Subagent, "profile" | "description"> & {
    profile: string | number; description: string | number;
  });
};
interface CompactCatalogue { format: 1; strings: string[]; rows: WireRow[] }

function mapText(row: WireRow, text: (value: string | number) => string | number): WireRow {
  const result = { ...row };
  for (const field of TEXT_FIELDS) {
    const value = row[field];
    if (value !== undefined) result[field] = text(value);
  }
  if (row.relation) {
    result.relation = row.relation.kind === "subagent"
      ? { ...row.relation, profile: text(row.relation.profile), description: text(row.relation.description) }
      : { ...row.relation };
  }
  return result;
}

/** Response-local lossless sharing; canonical rows and persisted data stay full. */
export function encodeSessionCatalogue(sessions: SessionInfo[]): SessionInfo[] | CompactCatalogue {
  const counts = new Map<string, number>();
  const countText = (value: string | undefined) => {
    if (value !== undefined && value.length >= 24) counts.set(value, (counts.get(value) ?? 0) + 1);
  };
  for (const row of sessions) {
    for (const field of TEXT_FIELDS) countText(row[field]);
    if (row.relation?.kind === "subagent") {
      countText(row.relation.profile); countText(row.relation.description);
    }
  }
  const strings: string[] = [], indices = new Map<string, number>();
  let savings = 0;
  for (const [value, count] of counts) {
    // value.length + quotes is a LOWER bound on JSON UTF-8 bytes, including
    // escaped/control/astral text. Use actual final index widths and one table
    // separator per entry (conservative even for the first entry).
    const gain = (count - 1) * (value.length + 2) - count * String(strings.length).length - 1;
    if (gain <= 0) continue;
    indices.set(value, strings.length); strings.push(value); savings += gain;
  }
  // 128 bytes comfortably covers the small fixed JSON envelope. Small/unique
  // inputs keep the legacy shape; no speculative JSON serialization/compression.
  if (savings <= 128) return sessions;
  return { format: 1, strings, rows: sessions.map(row => mapText(row, value =>
    typeof value === "string" ? indices.get(value) ?? value : value)) };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalid(): never { throw new Error("Invalid compact session catalogue"); }

/** Decode completely before publication. Unknown formats never become legacy rows. */
export function decodeSessionCatalogue(value: unknown): SessionInfo[] {
  if (Array.isArray(value)) return value as SessionInfo[];
  if (!record(value) || value.format !== 1 || !Array.isArray(value.strings) || !Array.isArray(value.rows)) return invalid();
  const strings: unknown[] = value.strings;
  if (!strings.every(text => typeof text === "string")) return invalid();
  const text = (slot: unknown): string => {
    if (typeof slot === "string") return slot;
    if (typeof slot !== "number" || !Number.isSafeInteger(slot) || slot < 0 || slot >= strings.length) return invalid();
    return strings[slot] as string;
  };
  return value.rows.map((row: unknown) => {
    if (!record(row) || !["id", "path", "created", "modified"].every(key => typeof row[key] === "string")
      || typeof row.messageCount !== "number" || !Number.isFinite(row.messageCount)) return invalid();
    for (const field of TEXT_FIELDS) {
      if (field === "cwd" || field === "firstMessage" || row[field] !== undefined) text(row[field]);
    }
    if (row.relation !== undefined) {
      const relation = row.relation;
      if (!record(relation)) return invalid();
      if (relation.kind === "subagent") {
        if (typeof relation.parentSessionId !== "string") return invalid();
        text(relation.profile); text(relation.description);
      } else if (relation.kind !== "fork" || (relation.originSessionId !== undefined && typeof relation.originSessionId !== "string")) return invalid();
    }
    // The fixed slots above are validated before this private shape cast. mapText
    // copies row/relation objects; mutating the decoded model cannot edit the wire.
    return mapText(row as unknown as WireRow, text) as SessionInfo;
  });
}

/** One HTTP-body boundary used by Sidebar, workspace restore and hydration. */
export async function readSessionCatalogueReply<T extends { sessions: SessionInfo[] }>(
  response: Pick<Response, "json">,
): Promise<T> {
  const data: unknown = await response.json();
  if (!record(data)) return invalid();
  return { ...data, sessions: decodeSessionCatalogue(data.sessions) } as T;
}
