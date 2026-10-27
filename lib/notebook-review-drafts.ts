import { strictJsonObject } from "./guided-review";
import { keys, stableId, questionIdentity, str, validateOperation, type Feedback, type Outcome, type ReviewAnchor, type ReviewOperation } from "./notebook-review";
import type { QuestionDraft } from "./question-set";
export type PendingReviewWrite = { action: "append"; operation: ReviewOperation; submissionId: string } | { action: "import"; batchId: string; text?: string; submissionId: string };
export type ReviewQuestionDraft = { key: string; draft: QuestionDraft; outcome: Outcome["kind"] };
export interface NotebookReviewDraft { questions: ReviewQuestionDraft[]; text: string; kind: Feedback["kind"]; editing: Feedback | null; anchor: ReviewAnchor | null; pending: PendingReviewWrite | null; replyText: string; replies: { batchId: string; text: string }[]; previewBatchId: string | null }
export const freshReviewDraft = (): NotebookReviewDraft => ({ questions: [], text: "", kind: "finding", editing: null, anchor: null, pending: null, replyText: "", replies: [], previewBatchId: null });
export const REVIEW_DRAFT_BYTES = 2 * 1024 * 1024;
export function validatePendingReviewWrite(v: unknown): PendingReviewWrite {
  const p = keys(v, ["action", "submissionId"], ["operation", "batchId", "text"]); stableId(p.submissionId);
  if (p.action === "append") { keys(p, ["action", "submissionId", "operation"]); const op = validateOperation(p.operation); if (op.kind === "import") throw new Error("Reply imports require their own pipeline"); }
  else if (p.action === "import") { keys(p, ["action", "submissionId", "batchId"], ["text"]); stableId(p.batchId); if (p.text !== undefined && (typeof p.text !== "string" || new TextEncoder().encode(p.text).length > 256 * 1024)) throw new Error("Reply draft exceeds 256 KiB"); }
  else throw new Error("Invalid pending operation");
  return v as PendingReviewWrite;
}
/** Malformed recovery data is never an input to React or a server operation. Caller preserves raw bytes. */
export function parseReviewDraft(source: string): NotebookReviewDraft {
  const d = keys(strictJsonObject(source, REVIEW_DRAFT_BYTES), ["questions", "text", "kind", "editing", "anchor", "pending"], ["replyText", "replies", "previewBatchId"]);
  if (typeof d.text !== "string" || d.text.length > 20_000 || !["finding", "question", "guide-issue"].includes(d.kind as string)) throw new Error("Invalid feedback draft");
  if (!Array.isArray(d.questions) || d.questions.length > 512) throw new Error("Question draft quota reached (512 versions)");
  const seen = new Set<string>();
  for (const value of d.questions) {
    const q = keys(value, ["key", "draft", "outcome"]); str(q.key, 1024); if (seen.has(q.key) || !["answer", "unsure", "not-applicable", "skip"].includes(q.outcome as string)) throw new Error("Invalid question draft"); seen.add(q.key);
    const f = keys(q.draft, ["selections", "writing", "text", "comment", "skipped"]);
    if (!Array.isArray(f.selections) || f.selections.length > 12 || new Set(f.selections).size !== f.selections.length || typeof f.writing !== "boolean" || typeof f.skipped !== "boolean") throw new Error("Invalid question fields");
    f.selections.forEach(questionIdentity);
    for (const k of ["text", "comment"]) if (typeof f[k] !== "string" || (f[k] as string).length > 20_000) throw new Error("Invalid question text");
  }
  if (d.editing !== null) validateOperation({ kind: "feedback", item: d.editing });
  // Fields may temporarily pair a guidance anchor with an unsaveable finding
  // classification. Validate anchor shape without turning that draft into a
  // reviewer operation; editing records and pending writes stay strict above/below.
  if (d.anchor !== null) validateOperation({ kind: "feedback", item: { id: "recovery", version: 1, kind: "guide-issue", text: "Recovery", resolved: false, anchor: d.anchor } });
  if (d.pending !== null) validatePendingReviewWrite(d.pending);
  if (d.replyText !== undefined && (typeof d.replyText !== "string" || new TextEncoder().encode(d.replyText).length > 256 * 1024)) throw new Error("Invalid reply draft");
  if (d.replies !== undefined) {
    if (!Array.isArray(d.replies) || d.replies.length > 100) throw new Error("Reply draft quota reached");
    const ids = new Set<string>();
    for (const value of d.replies) { const r = keys(value, ["batchId", "text"]); stableId(r.batchId); if (ids.has(r.batchId) || typeof r.text !== "string" || new TextEncoder().encode(r.text).length > 256 * 1024) throw new Error("Invalid batch reply draft"); ids.add(r.batchId); }
  }
  if (d.previewBatchId !== undefined && d.previewBatchId !== null) stableId(d.previewBatchId);
  return { ...d, replyText: d.replyText ?? "", replies: d.replies ?? [], previewBatchId: d.previewBatchId ?? null } as unknown as NotebookReviewDraft;
}
