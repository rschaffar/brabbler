/** GET /api/sessions/search — scoped, bounded search of demo sessions. */
import type { SessionEntry, SessionInfo } from "@/lib/types";
import type { SessionSearchResult, SessionSearchResponse } from "@/lib/session-search";
import { listSessionFamilies } from "@/lib/session-family";
import { sessionsForProject } from "@/lib/project-groups";
import { allSessions, sessionInfo } from "./sessions/store";

function blocksOf(entry: SessionEntry): { text: string; blockIndex: number }[] {
  if (entry.type !== "message") return [];
  const message = entry.message as { role: string; content?: unknown };
  if (message.role !== "user" && message.role !== "assistant") return [];
  if (typeof message.content === "string") return [{ text: message.content, blockIndex: 0 }];
  if (!Array.isArray(message.content)) return [];
  return message.content.flatMap((block: { type?: string; text?: string }, blockIndex: number) =>
    block?.type === "text" && typeof block.text === "string" ? [{ text: block.text, blockIndex }] : []);
}

function excerpt(text: string, index: number, length: number) {
  return {
    before: (index > 80 ? "..." : "") + text.slice(Math.max(0, index - 80), index).replace(/\s+/g, " ").trimStart(),
    match: text.slice(index, index + length).replace(/\s+/g, " "),
    after: text.slice(index + length, index + length + 80).replace(/\s+/g, " ").trimEnd(),
  };
}

export async function searchSessions(query: string, scope: { projectKey?: string; allProjects: boolean; status: "active" | "archived" | "both" }): Promise<SessionSearchResponse> {
  const needle = query.trim();
  if (!needle) return { results: [], truncated: false };
  const matcher = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const sessions = allSessions();
  const info = sessions.filter((session) => !session.transient).map(sessionInfo);
  const scoped = scope.allProjects ? info : sessionsForProject(info, scope.projectKey!);
  const families = listSessionFamilies(scoped).filter((family) => scope.status === "both" || Boolean(family.root.archived) === (scope.status === "archived"));
  const archived = new Map(families.flatMap((family) => [family.root, ...family.subagents].map((session) => [session.id, Boolean(family.root.archived)] as const)));
  const eligible = new Map(families.flatMap((family) => [family.root, ...family.subagents]).map((session) => [session.id, session]));
  const metadata: { rank: number; result: SessionSearchResult }[] = [];
  const content: SessionSearchResult[] = [];
  for (const session of sessions) {
    const summary = eligible.get(session.id);
    if (!summary || !summary.path) continue;
    const fields = [
      { kind: "title" as const, text: summary.name || "" },
      { kind: "preview" as const, text: summary.firstMessage || "" },
      { kind: "id" as const, text: summary.id },
    ];
    const hits = fields.flatMap(({ kind, text }) => {
      const match = matcher.exec(text);
      if (!match) return [];
      const rank = text.length === match[0].length ? 0 : match.index === 0 ? 1 : 2;
      return [{ rank, result: { session: summary, familyArchived: archived.get(session.id), kind, blockIndex: 0, ...excerpt(text, match.index, match[0].length) } }];
    }).sort((a, b) => a.rank - b.rank);
    if (hits.length) {
      const hit = hits[0];
      if (hit.result.kind === "preview") {
        for (const entry of session.entries) {
          const blocks = blocksOf(entry);
          const text = blocks.map((block) => block.text).join("\n");
          const match = matcher.exec(text);
          if (!match) continue;
          let offset = 0;
          const matched = blocks.find((block) => {
            const end = offset + block.text.length;
            offset = end + 1;
            return match.index <= end;
          });
          hit.result.entryId = entry.id;
          hit.result.blockIndex = matched!.blockIndex;
          break;
        }
      }
      metadata.push(hit);
      continue;
    }
    for (const entry of session.entries) {
      const blocks = blocksOf(entry);
      const text = blocks.map((block) => block.text).join("\n");
      const match = matcher.exec(text);
      if (!match) continue;
      let offset = 0;
      const matched = blocks.find((block) => {
        const end = offset + block.text.length;
        offset = end + 1;
        return match.index <= end;
      });
      content.push({ session: summary, familyArchived: archived.get(session.id), kind: "message", entryId: entry.id, blockIndex: matched!.blockIndex, ...excerpt(text, match.index, match[0].length) });
      break;
    }
  }
  const recent = (a: SessionInfo, b: SessionInfo) => b.modified.localeCompare(a.modified) || a.id.localeCompare(b.id);
  metadata.sort((a, b) => a.rank - b.rank || recent(a.result.session, b.result.session));
  content.sort((a, b) => recent(a.session, b.session));
  const hits = [...metadata.map(({ result }) => result), ...content];
  return { results: hits.slice(0, 30), truncated: hits.length > 30 };
}
