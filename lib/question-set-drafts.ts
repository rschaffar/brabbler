import { emptyQuestionDraft, MAX_ANSWER_LENGTH, type QuestionDraft, type QuestionSet } from "./question-set";

const PREFIX = "brabbler:question-draft:";
const MAX_AGE = 24 * 60 * 60 * 1000;
const MAX_DRAFTS = 12;
interface StorageLike { length: number; key(index: number): string | null; getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type QuestionDrafts = Record<string, QuestionDraft>;
export function questionDraftKey(sessionId: string, requestId: string): string {
  return `${PREFIX}${encodeURIComponent(sessionId)}:${encodeURIComponent(requestId)}`;
}
export function initialQuestionDrafts(set: QuestionSet): QuestionDrafts {
  return Object.fromEntries(set.questions.map((q) => [q.id, emptyQuestionDraft(q)]));
}
function storage(): StorageLike { return window.sessionStorage; }
export function clearQuestionDraft(sessionId: string, requestId: string, store?: StorageLike): void {
  try { (store ?? storage()).removeItem(questionDraftKey(sessionId, requestId)); } catch { /* best effort */ }
}

/** An SSE connection supplies an authoritative pending snapshot, including after restart. */
export function reconcileQuestionDrafts(sessionId: string, pendingIds: string[], store?: StorageLike): void {
  try {
    const target = store ?? storage();
    const prefix = `${PREFIX}${encodeURIComponent(sessionId)}:`;
    const keep = new Set(pendingIds.map((id) => questionDraftKey(sessionId, id)));
    const remove: string[] = [];
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i);
      if (key?.startsWith(prefix) && !keep.has(key)) remove.push(key);
    }
    for (const key of remove) target.removeItem(key);
  } catch { /* best effort */ }
}

/** Only same-request, same-presentation data can be restored. Drafts never leave this tab. */
export function loadQuestionDrafts(sessionId: string, requestId: string, set: QuestionSet, store?: StorageLike): { drafts: QuestionDrafts; available: boolean } {
  const drafts = initialQuestionDrafts(set);
  try {
    const target = store ?? storage();
    const key = questionDraftKey(sessionId, requestId);
    const raw = target.getItem(key);
    if (!raw) return { drafts, available: true };
    const saved = JSON.parse(raw);
    if (saved.version !== 1 || saved.signature !== JSON.stringify(set) || !Number.isFinite(saved.updatedAt)
      || Date.now() - saved.updatedAt > MAX_AGE || !saved.drafts || typeof saved.drafts !== "object") {
      target.removeItem(key);
      return { drafts, available: true };
    }
    for (const q of set.questions) {
      const d = saved.drafts[q.id];
      if (!d || !Array.isArray(d.selections) || d.selections.length > q.options.length
        || d.selections.some((id: unknown) => !q.options.some((o) => o.id === id))
        || typeof d.writing !== "boolean" || typeof d.skipped !== "boolean"
        || typeof d.text !== "string" || d.text.length > MAX_ANSWER_LENGTH
        || typeof d.comment !== "string" || d.comment.length > MAX_ANSWER_LENGTH) continue;
      Object.defineProperty(drafts, q.id, { value: { selections: [...d.selections], writing: q.type === "text" || d.writing,
        text: d.text, comment: d.comment, skipped: !q.required && d.skipped }, enumerable: true, writable: true, configurable: true });
    }
    return { drafts, available: true };
  } catch { return { drafts, available: false }; }
}
export function saveQuestionDrafts(sessionId: string, requestId: string, set: QuestionSet, drafts: QuestionDrafts, store?: StorageLike): boolean {
  try {
    const target = store ?? storage();
    const key = questionDraftKey(sessionId, requestId);
    const entries: Array<{ key: string; time: number; order: number }> = [];
    for (let i = 0; i < target.length; i++) {
      const candidate = target.key(i);
      if (candidate?.startsWith(PREFIX) && candidate !== key) {
        let time = 0;
        try { time = JSON.parse(target.getItem(candidate) ?? "{}").updatedAt || 0; } catch { /* remove malformed draft */ }
        entries.push({ key: candidate, time, order: i });
      }
    }
    entries.sort((a, b) => b.time - a.time || b.order - a.order).forEach((entry, i) => {
      if (i >= MAX_DRAFTS - 1 || Date.now() - entry.time > MAX_AGE) target.removeItem(entry.key);
    });
    target.setItem(key, JSON.stringify({ version: 1, signature: JSON.stringify(set), updatedAt: Date.now(), drafts }));
    return true;
  } catch { return false; }
}
