import { GIT_ACTION_ANCHOR_TYPE, GIT_ACTION_ID_PATTERN, type GitActionUpdateEvent } from "./git-action-types";
import type { AgentMessage, CustomMessage } from "./types";

/** Browser invalidation carries identifiers only, never a candidate or capability. */
export const GIT_ACTION_UPDATE_EVENT = "pi-web:git-action-update";
export type GitActionInvalidation = Pick<GitActionUpdateEvent, "actionId" | "revision"> & { sessionId: string };

export function gitActionId(message: AgentMessage): string | null {
  if (message.role !== "custom" || message.customType !== GIT_ACTION_ANCHOR_TYPE || !message.display) return null;
  const details = message.details as { actionId?: unknown } | undefined;
  return typeof details?.actionId === "string" && GIT_ACTION_ID_PATTERN.test(details.actionId) ? details.actionId : null;
}

export function gitActionMessage(actionId: string, timestamp?: number): CustomMessage {
  return { role: "custom", customType: GIT_ACTION_ANCHOR_TYPE, content: "", display: true, details: { actionId }, timestamp };
}

export function isGitActionUpdate(event: { type: string; [key: string]: unknown }): event is GitActionUpdateEvent & Record<string, unknown> {
  return event.type === "git_action_update" && typeof event.actionId === "string" && GIT_ACTION_ID_PATTERN.test(event.actionId)
    && Number.isSafeInteger(event.revision) && (event.revision as number) > 0
    && (event.entryId === undefined || (typeof event.entryId === "string" && event.entryId.length > 0))
    && (event.timestamp === undefined || (typeof event.timestamp === "number" && Number.isFinite(event.timestamp)));
}

export interface UiTranscript { messages: AgentMessage[]; entryIds: string[] }

/** Empty IDs represent not-yet-persisted live messages, never a navigation target. */
export function alignEntryIds(messages: AgentMessage[], entryIds: string[]): string[] {
  return Array.from({ length: messages.length }, (_, index) => entryIds[index] ?? "");
}

/** Retain paged-in ancestors only when the new disk tail extends the EXACT
 * loaded suffix. A shared root alone is not enough: it may be a sibling branch.
 * Gaps/unpersisted messages or non-overlapping tails use the authoritative read.
 */
export function mergeGitActionTail(current: UiTranscript, incoming: UiTranscript): UiTranscript | null {
  if (!incoming.entryIds.length || current.messages.length !== current.entryIds.length || current.entryIds.some((id) => !id)) return null;
  const overlap = current.entryIds.indexOf(incoming.entryIds[0]);
  if (overlap < 0 || current.entryIds.slice(overlap).some((id, index) => id !== incoming.entryIds[index])) return null;
  return {
    messages: [...current.messages.slice(0, overlap), ...incoming.messages],
    entryIds: [...current.entryIds.slice(0, overlap), ...incoming.entryIds],
  };
}

/** Idempotent even if a disk refresh beat SSE, or SSE is replayed after settlement. */
export function projectGitActionUpdate(transcript: UiTranscript, event: GitActionUpdateEvent): UiTranscript {
  if (!event.entryId) return transcript;
  const { messages, entryIds } = transcript;
  const index = messages.findIndex((message, i) => gitActionId(message) === event.actionId || entryIds[i] === event.entryId);
  if (index >= 0 && entryIds[index] === event.entryId && gitActionId(messages[index]) === event.actionId) return transcript;
  const nextMessages = [...messages];
  const nextIds = alignEntryIds(messages, entryIds);
  const message = gitActionMessage(event.actionId, index >= 0 ? messages[index].timestamp ?? event.timestamp : event.timestamp);
  if (index < 0) {
    nextMessages.push(message);
    nextIds.push(event.entryId);
  } else {
    nextMessages[index] = message;
    nextIds[index] = event.entryId;
  }
  return { messages: nextMessages, entryIds: nextIds };
}
