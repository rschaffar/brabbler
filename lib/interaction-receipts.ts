import { appendOperationReceipt, mergeOperationReceiptHistory } from "./operation-receipts";
import { askUserSummary, normalizeAskUserAnswer } from "./ask-user";
import { normalizeSetAnswers, parseQuestionSet, questionSetSummary, type SetAnswer } from "./question-set";
import { validatePluginCard, validPluginAction } from "./plugins/ui";
import type { CustomMessage, ExtensionUiRequest, ExtensionUiResponse, SessionEntry, SessionTreeNode } from "./types";

export const INTERACTION_RECEIPT_TYPE = "brabbler:interaction-receipt";
export type InteractionRequest = Extract<ExtensionUiRequest, {
  method: "select" | "confirm" | "input" | "editor" | "ask_user" | "ask_user_batch" | "plugin_card";
}>;
export type InteractionResponse =
  | { value: string } | { confirmed: boolean } | { action: string; details?: string }
  | { answer: import("./ask-user").AskUserAnswer } | { answers: SetAnswer[] } | { cancelled: true };
export type InteractionOutcome = "answered" | "cancelled" | "timed_out" | "aborted";
export interface InteractionReceipt {
  version: 1;
  request: InteractionRequest;
  outcome: InteractionOutcome;
  response?: InteractionResponse;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Normalize at the server boundary; only the matching request can accept an answer. */
export function normalizeInteractionResponse(request: InteractionRequest, response: unknown): InteractionResponse | null {
  if (!record(response)) return null;
  if (response.cancelled === true) return { cancelled: true };
  switch (request.method) {
    case "ask_user_batch": {
      const answers = normalizeSetAnswers(response.answers, request);
      return answers ? { answers } : null;
    }
    case "ask_user": {
      const answer = normalizeAskUserAnswer(response.answer, request);
      return answer ? { answer } : null;
    }
    case "plugin_card":
      if (!validPluginAction(request, response.action)) return null;
      if (response.details !== undefined && (!request.allowDetails || typeof response.details !== "string" || response.details.length > 20000)) return null;
      return { action: response.action, ...(typeof response.details === "string" ? { details: response.details } : {}) };
    case "confirm":
      return typeof response.confirmed === "boolean" ? { confirmed: response.confirmed } : null;
    case "select":
      return typeof response.value === "string" && request.options.includes(response.value) ? { value: response.value } : null;
    case "input":
    case "editor":
      return typeof response.value === "string" ? { value: response.value } : null;
  }
}

/** Snapshot presentation data, not live timeouts, drafts, callbacks or tool authority. */
export function snapshotInteractionRequest(request: InteractionRequest): InteractionRequest {
  const snapshot = JSON.parse(JSON.stringify(request)) as InteractionRequest & { timeout?: number; expiresAt?: number };
  delete snapshot.timeout;
  delete snapshot.expiresAt;
  return snapshot;
}

function isInteractionRequest(value: unknown): value is InteractionRequest {
  if (!record(value) || value.type !== "extension_ui_request" || typeof value.id !== "string") return false;
  if (value.method === "ask_user_batch") return parseQuestionSet(value) !== null;
  if (value.method === "ask_user") {
    return typeof value.question === "string" && (value.context === undefined || typeof value.context === "string")
      && Array.isArray(value.options) && value.options.every((option) => record(option)
        && typeof option.title === "string" && (option.description === undefined || typeof option.description === "string"))
      && [value.allowMultiple, value.allowFreeform, value.allowComment, value.contextExpanded].every((flag) => typeof flag === "boolean");
  }
  if (typeof value.title !== "string") return false;
  switch (value.method) {
    case "plugin_card":
      if (typeof value.pluginId !== "string") return false;
      try { validatePluginCard(value as unknown as Extract<InteractionRequest, { method: "plugin_card" }>); return true; }
      catch { return false; }
    case "select": return Array.isArray(value.options) && value.options.every((option) => typeof option === "string");
    case "confirm": return typeof value.message === "string";
    case "input": return value.placeholder === undefined || typeof value.placeholder === "string";
    case "editor": return value.prefill === undefined || typeof value.prefill === "string";
    default: return false;
  }
}

/** Unknown versions and malformed custom entries stay hidden instead of breaking history. */
export function readInteractionReceipt(value: unknown): InteractionReceipt | null {
  if (!record(value) || value.version !== 1 || !isInteractionRequest(value.request)) return null;
  const request = value.request.method === "ask_user_batch"
    ? { ...value.request, ...parseQuestionSet(value.request)! } : value.request;
  if (value.outcome === "answered" || value.outcome === "cancelled") {
    const response = normalizeInteractionResponse(request, value.response);
    if (!response || ("cancelled" in response) !== (value.outcome === "cancelled")) return null;
    return { version: 1, request, outcome: value.outcome, response };
  }
  if (value.outcome === "timed_out" || value.outcome === "aborted") {
    return { version: 1, request, outcome: value.outcome };
  }
  return null;
}

export function interactionTitle(request: InteractionRequest): string {
  return request.method === "ask_user" ? request.question : request.title;
}

export function interactionAnswer(receipt: InteractionReceipt): string | null {
  const response = receipt.response;
  if (!response || "cancelled" in response) return null;
  if ("answer" in response) return askUserSummary(response.answer);
  if ("answers" in response && receipt.request.method === "ask_user_batch") return questionSetSummary(receipt.request, response.answers);
  if ("value" in response) return response.value;
  if ("action" in response && receipt.request.method === "plugin_card") {
    const label = receipt.request.actions.find((action) => action.id === response.action)?.label ?? response.action;
    return response.details ? `${label}\n${response.details}` : label;
  }
  return null;
}

/** UI-only projection. Never append this display message as a model-context message. */
export function interactionReceiptMessage(entry: SessionEntry): CustomMessage | null {
  if (entry.type !== "custom" || entry.customType !== INTERACTION_RECEIPT_TYPE) return null;
  const receipt = readInteractionReceipt(entry.data);
  if (!receipt) return null;
  return {
    role: "custom", customType: INTERACTION_RECEIPT_TYPE, display: true,
    content: interactionTitle(receipt.request), details: receipt,
    timestamp: Date.parse(entry.timestamp),
  };
}

/** The same persisted entry may arrive over SSE and a refreshed history snapshot. */
export function appendInteractionReceipt<T extends { messages: import("./types").AgentMessage[]; entryIds: string[] }>(
  transcript: T, entry: SessionEntry,
): T {
  const message = interactionReceiptMessage(entry);
  if (!message) return appendOperationReceipt(transcript, entry);
  if (transcript.entryIds.includes(entry.id) || transcript.messages.some((existing) =>
    existing.role === "custom" && existing.customType === INTERACTION_RECEIPT_TYPE
    && readInteractionReceipt(existing.details)?.request.id === (message.details as InteractionReceipt).request.id)) return transcript;
  return { ...transcript, messages: [...transcript.messages, message], entryIds: [...transcript.entryIds, entry.id] };
}

/** Only carry recent receipts into a canonical snapshot on the same branch. */
export function receiptBranchContains(tree: SessionTreeNode[], leafId: string | null, ancestorId: string | null): boolean {
  if (ancestorId === null || leafId === ancestorId) return true;
  const stack = tree.map((node) => ({ node, containsAncestor: false }));
  while (stack.length) {
    const { node, containsAncestor } = stack.pop()!;
    let contains = containsAncestor;
    for (const id of [...(node.compressedEntryIds ?? []), node.entry.id]) {
      if (id === ancestorId) contains = true;
      if (id === leafId) return contains;
    }
    for (const child of node.children) stack.push({ node: child, containsAncestor: contains });
  }
  return false;
}

/** Reconcile receipts only: never replace or duplicate ordinary streamed messages. */
export function mergeInteractionReceiptHistory<T extends { messages: import("./types").AgentMessage[]; entryIds: string[] }>(
  transcript: T,
  history: { messages: import("./types").AgentMessage[]; entryIds: string[] },
  minimumTimestamp = transcript.messages.find((message) => Number.isFinite(message.timestamp))?.timestamp ?? -Infinity,
): T {
  let next = transcript;
  for (let index = 0; index < history.messages.length; index++) {
    const message = history.messages[index];
    const id = history.entryIds[index];
    if (!id || message.role !== "custom" || message.customType !== INTERACTION_RECEIPT_TYPE
      || !Number.isFinite(message.timestamp) || message.timestamp! < minimumTimestamp) continue;
    const receipt = readInteractionReceipt(message.details);
    if (!receipt || next.entryIds.includes(id) || next.messages.some((existing) =>
      existing.role === "custom" && existing.customType === INTERACTION_RECEIPT_TYPE
      && readInteractionReceipt(existing.details)?.request.id === receipt.request.id)) continue;
    // Prefer the saved branch's following entry when it is already displayed.
    // Live ordinary messages may not have entry IDs yet; timestamps provide the fallback.
    const following = history.entryIds.slice(index + 1).find((entryId) => entryId && next.entryIds.includes(entryId));
    let position = following ? next.entryIds.indexOf(following) : next.messages.findIndex((existing) =>
      Number.isFinite(existing.timestamp) && existing.timestamp! > message.timestamp!);
    if (position < 0) position = next.messages.length;
    next = { ...next,
      messages: [...next.messages.slice(0, position), message, ...next.messages.slice(position)],
      entryIds: [...next.entryIds.slice(0, position), id, ...next.entryIds.slice(position)],
    };
  }
  return mergeOperationReceiptHistory(next, history, minimumTimestamp);
}

export function responseForExtension(id: string, response: InteractionResponse): ExtensionUiResponse {
  return { type: "extension_ui_response", id, ...response };
}
