import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionInfo } from "./types";

const MAX_FILES = 500;
const MAX_RESULTS = 30;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_LINE_CHARS = 1024 * 1024;
const TIME_BUDGET_MS = 3000;

export interface SessionSearchResult {
  session: SessionInfo;
  kind: "title" | "preview" | "id" | "message";
  familyArchived?: boolean;
  entryId?: string;
  blockIndex: number;
  before: string;
  match: string;
  after: string;
}

export interface SessionSearchResponse {
  results: SessionSearchResult[];
  truncated: boolean;
}

function snippet(text: string, match: RegExpExecArray) {
  const start = match.index;
  const end = start + match[0].length;
  return {
    before: (start > 80 ? "..." : "") + text.slice(Math.max(0, start - 80), start).replace(/\s+/g, " ").trimStart(),
    match: match[0].replace(/\s+/g, " "),
    after: text.slice(end, end + 80).replace(/\s+/g, " ").trimEnd() + (end + 80 < text.length ? "..." : ""),
  };
}

function metadataMatch(session: SessionInfo, matcher: RegExp): { result: SessionSearchResult; rank: number } | null {
  const fields = [
    { kind: "title" as const, text: session.name || "" },
    { kind: "preview" as const, text: session.firstMessage || "" },
    { kind: "id" as const, text: session.id },
  ];
  const matches = fields.flatMap(({ kind, text }) => {
    const match = matcher.exec(text);
    if (!match) return [];
    const rank = text.length === match[0].length ? 0 : match.index === 0 ? 1 : 2;
    return [{ rank, result: { session, kind, blockIndex: 0, ...snippet(text, match) } }];
  });
  // Prefer the strongest match, then title over preview over ID at the same rank.
  return matches.sort((a, b) => a.rank - b.rank)[0] ?? null;
}

async function scanMessage(session: SessionInfo, matcher: RegExp, signal: AbortSignal, deadline: number): Promise<{ hit?: SessionSearchResult; truncated: boolean }> {
  const stream = createReadStream(session.path, { encoding: "utf8", end: MAX_FILE_BYTES - 1, signal });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let truncated = false;
  try {
    for await (const line of lines) {
      if (signal.aborted || Date.now() >= deadline) {
        truncated = true;
        break;
      }
      if (line.length > MAX_LINE_CHARS) {
        truncated = true;
        continue;
      }
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry?.type !== "message" || !["user", "assistant"].includes(entry.message?.role)) continue;
      const content: unknown = entry.message.content;
      const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
      const textBlocks = blocks.flatMap((block, blockIndex) => block?.type === "text" && typeof block.text === "string" ? [{ text: block.text as string, blockIndex }] : []);
      const text = textBlocks.map((block) => block.text).join("\n");
      const match = matcher.exec(text);
      if (!match) continue;
      let blockOffset = 0;
      const matchedBlock = textBlocks.find((block) => {
        const blockEnd = blockOffset + block.text.length;
        blockOffset = blockEnd + 1;
        return match.index <= blockEnd;
      });
      return { hit: {
        session, kind: "message", ...(typeof entry.id === "string" ? { entryId: entry.id } : {}),
        blockIndex: matchedBlock!.blockIndex, ...snippet(text, match),
      }, truncated };
    }
  } catch {
    // Missing/unreadable files and interrupted reads must not hide other results.
    truncated = true;
  } finally {
    lines.close();
    stream.destroy();
  }
  return { truncated: truncated || stream.bytesRead >= MAX_FILE_BYTES };
}

// Scan recent files without an index; metadata is searched across the whole catalogue.
export async function searchSessionContents(
  sessions: readonly SessionInfo[],
  query: string,
  requestSignal?: AbortSignal,
): Promise<SessionSearchResponse> {
  const response: SessionSearchResponse = { results: [], truncated: false };
  const needle = query.trim();
  if (!needle) return response;
  if (needle.length > 200) throw new RangeError("Search query exceeds 200 characters");
  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const deadline = Date.now() + TIME_BUDGET_MS;
  const timeout = AbortSignal.timeout(TIME_BUDGET_MS);
  const signal = requestSignal ? AbortSignal.any([requestSignal, timeout]) : timeout;
  if (signal.aborted) return { results: [], truncated: true };
  const candidates = sessions
    .filter((session) => !session.transient && session.path)
    .sort((a, b) => b.modified.localeCompare(a.modified) || a.id.localeCompare(b.id));

  const metadata = candidates.map((session) => metadataMatch(session, matcher)).filter((hit) => hit !== null)
    .sort((a, b) => a.rank - b.rank || b.result.session.modified.localeCompare(a.result.session.modified)
      || a.result.session.id.localeCompare(b.result.session.id));
  response.results.push(...metadata.slice(0, MAX_RESULTS).map(({ result }) => result));
  if (metadata.length > MAX_RESULTS) response.truncated = true;
  const matchedIds = new Set(metadata.map(({ result }) => result.session.id));
  const remaining = candidates.filter((session) => !matchedIds.has(session.id));
  // A preview comes from a real first message; recover its entry ID so that
  // selecting a preview hit still jumps to the matching message. Keep the
  // metadata hit when its file is missing, and share the same file/time budget.
  let filesScanned = 0;
  for (const result of response.results) {
    if (result.kind !== "preview") continue;
    if (filesScanned >= MAX_FILES || signal.aborted || Date.now() >= deadline) {
      response.truncated = true;
      break;
    }
    filesScanned++;
    const scan = await scanMessage(result.session, matcher, signal, deadline);
    if (scan.truncated) response.truncated = true;
    if (scan.hit?.entryId) {
      result.entryId = scan.hit.entryId;
      result.blockIndex = scan.hit.blockIndex;
    }
  }
  if (response.results.length === MAX_RESULTS) {
    if (remaining.length > 0) response.truncated = true;
    return response;
  }

  for (const [index, session] of remaining.entries()) {
    if (filesScanned >= MAX_FILES || signal.aborted || Date.now() >= deadline) {
      response.truncated = true;
      break;
    }
    filesScanned++;
    const scan = await scanMessage(session, matcher, signal, deadline);
    if (scan.truncated) response.truncated = true;
    if (scan.hit) response.results.push(scan.hit);
    if (response.results.length === MAX_RESULTS) {
      if (index + 1 < remaining.length) response.truncated = true;
      break;
    }
  }
  return response;
}
