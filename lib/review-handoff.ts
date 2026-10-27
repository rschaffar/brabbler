export interface ReviewChatDestination { id: string; label: string }
export type ReviewBatchDraft = (expected: ReviewChatDestination, text: string) => void;
export interface EvidenceSelection { quote: string; context: string; start?: number; end?: number; side?: "additions" | "deletions"; path?: string }
/** Current selected session, never a captured old destination or implicit new session. */
export function prepareReviewDraft(expected: ReviewChatDestination, current: ReviewChatDestination | undefined, composer: { insertText: (text: string, options?: { atEnd?: boolean }) => void } | null, text: string) {
  if (!current || current.id !== expected.id) throw new Error("Chat destination changed or is missing. Return to the expected session and retry the retained preview.");
  if (!composer) throw new Error("Chat composer is not mounted. Open the expected chat and retry.");
  composer.insertText(text, { atEnd: true });
}
