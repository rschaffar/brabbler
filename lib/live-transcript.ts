import type { AgentMessage } from "./types";
import { userMessageKey } from "./prompt-recovery";

interface Transcript { messages: AgentMessage[]; entryIds: string[] }

/** Capture only the display projection, never the enclosing SSE event. */
export function completedMessageUpdate(completed: AgentMessage, entryId: string, optimisticKey: string | null = null) {
  return (current: Transcript): Transcript => appendCompletedMessage(current, completed, entryId, optimisticKey);
}

/** Reconcile a canonical overlapping window without discarding a reader's
 * older prefix or live completions newer than the captured server snapshot.
 * The caller verifies ancestry and fills a missed-event gap before merging. */
export function mergeCanonicalTranscript(current: Transcript, saved: Transcript, keepUnpersisted: boolean) {
  const positions = new Map(current.entryIds.flatMap((id, index) => id ? [[id, index] as const] : []));
  const savedIds = new Set(saved.entryIds.filter(Boolean));
  const firstMatch = saved.entryIds.find(id => positions.has(id));
  const prefixEnd = firstMatch ? positions.get(firstMatch)! : 0;
  // Backfill may overshoot the reader's oldest record. Discard that overshoot
  // rather than moving the retained boundary behind its exclusive raw cursor.
  const savedStart = firstMatch && prefixEnd === 0 ? saved.entryIds.indexOf(firstMatch) : 0;
  let lastMatch = -1;
  current.entryIds.forEach((id, index) => { if (id && savedIds.has(id)) lastMatch = index; });
  const extras = current.messages.flatMap((message, index) => {
    if (index <= lastMatch || (current.entryIds[index] && savedIds.has(current.entryIds[index]))) return [];
    if (!current.entryIds[index]) {
      if (!keepUnpersisted) return [];
      // Only an unreconciled user envelope is eligible for this exact match;
      // ordinary repeated messages are never deduplicated by text/timestamp.
      if (message.role === "user" && saved.messages.some(candidate => candidate.role === "user"
        && (candidate.timestamp ?? -Infinity) >= (message.timestamp ?? Infinity)
        && userMessageKey(candidate) === userMessageKey(message))) return [];
    }
    return [{ message, id: current.entryIds[index] ?? "" }];
  });
  return {
    transcript: { messages: [...current.messages.slice(0, prefixEnd), ...saved.messages.slice(savedStart), ...extras.map(row => row.message)],
      entryIds: [...current.entryIds.slice(0, prefixEnd), ...saved.entryIds.slice(savedStart), ...extras.map(row => row.id)] },
    extraMessages: extras.map(row => row.message),
  };
}

/** Commit live content and its persisted navigation target in one state update. */
export function appendCompletedMessage(
  current: Transcript,
  completed: AgentMessage,
  entryId: string,
  optimisticKey: string | null = null,
): Transcript {
  const last = current.messages.at(-1);
  if (completed.role === "user" && optimisticKey && last?.role === "user" && userMessageKey(last) === optimisticKey) {
    return {
      messages: optimisticKey === userMessageKey(completed)
        ? current.messages
        : [...current.messages.slice(0, -1), completed],
      entryIds: [...current.entryIds.slice(0, -1), entryId],
    };
  }
  return {
    messages: [...current.messages, completed],
    entryIds: [...current.entryIds, entryId],
  };
}
