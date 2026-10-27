import { isQuestionSetId, normalizeSetAnswer, type SetAnswer } from "./question-set";
import { parseEvidence, type Evidence, type NotebookQuestion } from "./guided-review";
import { parseQuestionSet } from "./question-set";
import { parseReviewBlock } from "./review-notebook";
function evidenceDefinition(value: unknown) {
  const r = rec(value), source = JSON.stringify(value);
  if (r.kind === "source" || r.kind === "commit") { if (parseReviewBlock(source).error) fail(); }
  else parseEvidence(source);
}
function questionDefinition(value: unknown) {
  const q = keys(value, ["id", "shortLabel", "question", "type", "required", "options"], ["context", "explanation"]);
  if (!parseQuestionSet({ title: "Notebook", questions: [q] })) fail();
  for (const o of q.options as unknown[]) keys(o, ["id", "title"], ["description", "recommended", "exclusive"]);
  if (q.explanation !== undefined && (typeof q.explanation !== "string" || q.explanation.length > 8000)) fail();
}

/** Reviewer state is a bounded event history. Arrays deliberately support IDs such as constructor. */
export const REVIEW_LIMITS = { snapshotBytes: 2 * 1024 * 1024, events: 512, revisions: 1024, historyBytes: 64 * 1024 * 1024, replyBytes: 256 * 1024, items: 100 } as const;
export type ReviewMark = "Not reviewed" | "In progress" | "Needs attention" | "Reviewed";
export type Outcome = { kind: "answer"; answer: SetAnswer } | { kind: "unsure" | "not-applicable" | "skip" };
export interface Material {
  stepId: string; title: string; chapterPath: string; prose: string; guidanceFingerprint: string; fingerprint: string | null; questions: { definition: NotebookQuestion; fingerprint: string }[];
  targets: { definition: Evidence; fingerprint: string | null; contentDigest?: string }[]; unavailable: string[];
}
export interface ReviewAnchor {
  stepId: string; fingerprint: string; basis?: "guidance"; target?: Evidence; targetFingerprint?: string;
  selection?: { quote: string; context: string; start?: number; end?: number; side?: "additions" | "deletions"; path?: string };
}
export interface Feedback { id: string; version: number; kind: "question" | "finding" | "guide-issue"; text: string; anchor: ReviewAnchor; resolved: boolean }
export interface FrozenBatch { id: string; items: Feedback[]; materials: Material[]; destination: { id: string; label: string }; replyPath: string }
export interface AgentReply { version: 1; batchId: string; items: { id: string; version: number; fingerprint: string; response: string; evidence: string; proposedChanges: string }[] }
export type ReviewOperation =
  | { kind: "enable" }
  | { kind: "resume"; stepId: string }
  | { kind: "mark"; stepId: string; fingerprint: string; mark: ReviewMark; basis?: "guidance" }
  | { kind: "answer"; stepId: string; fingerprint: string; questionId: string; outcome: Outcome }
  | { kind: "feedback"; item: Feedback }
  | { kind: "resolve"; id: string; version: number; resolved: boolean }
  | { kind: "prepare"; batch: FrozenBatch }
  | { kind: "drafted"; batchId: string }
  | { kind: "import"; batchId: string; digest: string; reply: AgentReply };
export interface ReviewEvent { submissionId: string; operation: ReviewOperation; material: Material | null }
export interface ReviewState { events: ReviewEvent[] }
export interface ReviewSnapshot { version: 1; notebookId: string; sequence: number; previous: string; submissionId: string; state: ReviewState }
export interface ReviewTip { sequence: number; digest: string; state: ReviewState; directory: string; notebookId: string }
export const emptyReviewState = (): ReviewState => ({ events: [] });
export const feedbackItems = (state: ReviewState): Feedback[] => {
  const items: Feedback[] = [];
  for (const { operation: op } of state.events) {
    if (op.kind === "feedback") { const i = items.findIndex(x => x.id === op.item.id); if (i < 0) items.push(op.item); else items[i] = op.item; }
    if (op.kind === "resolve") { const i = items.findIndex(x => x.id === op.id); if (i >= 0) items[i] = { ...items[i], version: items[i].version + 1, resolved: op.resolved }; }
  }
  return items;
};
export function batches(state: ReviewState): FrozenBatch[] { return state.events.flatMap(e => e.operation.kind === "prepare" ? [e.operation.batch] : []); }
export function currentAnswer(state: ReviewState, stepId: string, questionId: string, fingerprint: string) {
  return state.events.findLast(e => e.operation.kind === "answer" && e.operation.stepId === stepId && e.operation.questionId === questionId && e.operation.fingerprint === fingerprint)?.operation as Extract<ReviewOperation, { kind: "answer" }> | undefined;
}
export function currentMark(state: ReviewState, stepId: string, fingerprint: string | null) {
  const entry = state.events.findLast(e => e.operation.kind === "mark" && e.operation.stepId === stepId)?.operation as Extract<ReviewOperation, { kind: "mark" }> | undefined;
  return { mark: entry?.mark ?? "Not reviewed", unavailableContext: entry?.basis === "guidance", stale: !!entry && fingerprint !== null && entry.fingerprint !== fingerprint };
}
export function reviewedMissing(state: ReviewState, material: Material) {
  return material.questions.filter(q => q.definition.required && !currentAnswer(state, material.stepId, q.definition.id, q.fingerprint));
}
const fail = (): never => { throw new Error("Malformed review data"); };
export function rec(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) fail(); return v as Record<string, unknown>; }
export function keys(v: unknown, required: string[], optional: string[] = []) {
  const r = rec(v); if (required.some(k => !Object.hasOwn(r, k)) || Object.keys(r).some(k => !required.includes(k) && !optional.includes(k))) fail(); return r;
}
export function str(v: unknown, max = 20_000): asserts v is string { if (typeof v !== "string" || !v.length || v.length > max || v.includes("\0")) fail(); }
export function stableId(v: unknown): asserts v is string { if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(v)) fail(); }
export function questionIdentity(v: unknown): asserts v is string { if (!isQuestionSetId(v)) fail(); }
export function digest(v: unknown): asserts v is string { if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v)) fail(); }
function integer(v: unknown) { if (!Number.isSafeInteger(v) || (v as number) < 1) fail(); }
function bool(v: unknown) { if (typeof v !== "boolean") fail(); }
function list(v: unknown, maximum: number): unknown[] { if (!Array.isArray(v) || v.length > maximum) fail(); return v as unknown[]; }
function anchor(v: unknown) {
  const a = keys(v, ["stepId", "fingerprint"], ["target", "targetFingerprint", "selection", "basis"]); stableId(a.stepId); digest(a.fingerprint);
  if (a.basis !== undefined && a.basis !== "guidance") fail();
  if (a.basis === "guidance" && (a.target !== undefined || a.selection !== undefined)) fail();
  if (a.target !== undefined) { evidenceDefinition(a.target); digest(a.targetFingerprint); }
  else if (a.targetFingerprint !== undefined) fail();
  if (a.selection !== undefined) { const s = keys(a.selection, ["quote", "context"], ["start", "end", "side", "path"]); if (s.path !== undefined) str(s.path, 4096); str(s.quote, 8000); if (typeof s.context !== "string" || s.context.length > 8000) fail();
    if (s.start !== undefined || s.end !== undefined) { integer(s.start); integer(s.end); if ((s.start as number) > (s.end as number) || (s.end as number) - (s.start as number) > 400) fail(); }
    if (s.side !== undefined && !["additions", "deletions"].includes(s.side as string)) fail(); }
}
function feedback(v: unknown) {
  const f = keys(v, ["id", "version", "kind", "text", "anchor", "resolved"]); stableId(f.id); integer(f.version);
  if (!["question", "finding", "guide-issue"].includes(f.kind as string)) fail(); str(f.text); anchor(f.anchor); bool(f.resolved);
  // This invariant applies to every version, frozen batch and stored snapshot,
  // not just the first creation's material-authorization branch in the reducer.
  if (rec(f.anchor).basis === "guidance" && f.kind === "finding") throw new Error("Guidance-only feedback cannot be a finding");
}
export function validateOperation(v: unknown): ReviewOperation {
  const o = rec(v);
  switch (o.kind) {
    case "enable": keys(o, ["kind"]); break;
    case "resume": keys(o, ["kind", "stepId"]); stableId(o.stepId); break;
    case "mark": keys(o, ["kind", "stepId", "fingerprint", "mark"], ["basis"]); if (o.basis !== undefined && o.basis !== "guidance") fail(); stableId(o.stepId); digest(o.fingerprint); if (!["Not reviewed", "In progress", "Needs attention", "Reviewed"].includes(o.mark as string)) fail(); break;
    case "answer": { keys(o, ["kind", "stepId", "fingerprint", "questionId", "outcome"]); stableId(o.stepId); questionIdentity(o.questionId); digest(o.fingerprint); const a = rec(o.outcome);
      if (a.kind === "answer") { keys(a, ["kind", "answer"]); const ans = rec(a.answer); if (ans.kind === "selection") { keys(ans, ["id", "kind", "selections"], ["comment"]); list(ans.selections, 12).forEach(questionIdentity); } else if (ans.kind === "freeform") { keys(ans, ["id", "kind", "text"], ["comment"]); str(ans.text); } else fail(); questionIdentity(ans.id); if (ans.comment !== undefined && (typeof ans.comment !== "string" || ans.comment.length > 20_000)) fail(); }
      else { keys(a, ["kind"]); if (!["unsure", "not-applicable", "skip"].includes(a.kind as string)) fail(); } break; }
    case "feedback": keys(o, ["kind", "item"]); feedback(o.item); break;
    case "resolve": keys(o, ["kind", "id", "version", "resolved"]); stableId(o.id); integer(o.version); bool(o.resolved); break;
    case "prepare": { keys(o, ["kind", "batch"]); const b = keys(o.batch, ["id", "items", "materials", "destination", "replyPath"]); list(b.materials, REVIEW_LIMITS.items).forEach(validateMaterial); stableId(b.id); const items = list(b.items, REVIEW_LIMITS.items); if (!items.length) fail(); items.forEach(feedback); if (new Set(items.map(i => rec(i).id)).size !== items.length) fail(); const d = keys(b.destination, ["id", "label"]); str(d.id, 256); str(d.label, 500); str(b.replyPath, 4096); break; }
    case "drafted": keys(o, ["kind", "batchId"]); stableId(o.batchId); break;
    case "import": keys(o, ["kind", "batchId", "digest", "reply"]); stableId(o.batchId); digest(o.digest); validateReply(o.reply); break;
    default: fail();
  }
  return v as ReviewOperation;
}
export function validateReply(v: unknown): AgentReply {
  const r = keys(v, ["version", "batchId", "items"]); if (r.version !== 1) fail(); stableId(r.batchId);
  const items = list(r.items, REVIEW_LIMITS.items); if (new Set(items.map(i => rec(i).id)).size !== items.length) throw new Error("Duplicate reply item");
  for (const i of items) { const x = keys(i, ["id", "version", "fingerprint", "response", "evidence", "proposedChanges"]); stableId(x.id); integer(x.version); digest(x.fingerprint); str(x.response); for (const k of ["evidence", "proposedChanges"]) if (typeof x[k] !== "string" || (x[k] as string).length > 20_000) fail(); }
  return v as AgentReply;
}
function validateMaterial(v: unknown) {
  const m = keys(v, ["stepId", "title", "chapterPath", "prose", "guidanceFingerprint", "fingerprint", "questions", "targets", "unavailable"]); digest(m.guidanceFingerprint); stableId(m.stepId); str(m.title, 240); str(m.chapterPath, 4096); if (typeof m.prose !== "string" || m.prose.length > 256 * 1024) fail(); if (m.fingerprint !== null) digest(m.fingerprint);
  for (const q of list(m.questions, 6)) { const x = keys(q, ["definition", "fingerprint"]); questionDefinition(x.definition); digest(x.fingerprint); }
  for (const t of list(m.targets, 512)) { const x = keys(t, ["definition", "fingerprint"], ["contentDigest"]); evidenceDefinition(x.definition); if (x.fingerprint !== null) digest(x.fingerprint); if (x.contentDigest !== undefined) digest(x.contentDigest); }
  list(m.unavailable, 512).forEach(x => str(x, 4096));
}
export function validateSnapshot(v: unknown): ReviewSnapshot {
  const s = keys(v, ["version", "notebookId", "sequence", "previous", "submissionId", "state"]); if (s.version !== 1) fail(); stableId(s.notebookId); integer(s.sequence); if (s.previous !== "") digest(s.previous); stableId(s.submissionId);
  const state = keys(s.state, ["events"]);
  for (const event of list(state.events, REVIEW_LIMITS.events)) {
    const e = keys(event, ["submissionId", "operation", "material"]); stableId(e.submissionId); validateOperation(e.operation);
    if (e.material !== null) validateMaterial(e.material);
  }
  return v as ReviewSnapshot;
}
/** Server calls this with freshly inspected material, never client-supplied decisions from a reply. */
export function reduceReview(state: ReviewState, operation: ReviewOperation, submissionId: string, material: Material | null): ReviewState {
  validateOperation(operation); stableId(submissionId);
  if (state.events.some(e => e.submissionId === submissionId)) throw new Error("Submission already recorded; reload to reconcile");
  if (state.events.length >= REVIEW_LIMITS.events) throw new Error("Review history quota reached; export history (no automatic pruning)");
  const op = operation, items = feedbackItems(state), batchList = batches(state);
  if (op.kind === "enable" && state.events.length) throw new Error("Recording already enabled");
  const previousFeedback = op.kind === "feedback" ? items.find(i => i.id === op.item.id) : undefined;
  if (op.kind === "mark" || op.kind === "answer" || op.kind === "feedback" && !previousFeedback) {
    if (!material) throw new Error("Guidance Unavailable; reload before recording this decision");
    const guidanceOnly = op.kind === "mark" ? op.basis === "guidance" : op.kind === "feedback" && op.item.anchor.basis === "guidance";
    if (guidanceOnly && (op.kind === "mark" && op.mark === "Reviewed" || op.kind === "feedback" && (op.item.kind === "finding" || op.item.anchor.target || op.item.anchor.selection))) throw new Error("Guidance-only records cannot claim inspected material, findings or Reviewed");
    if (!guidanceOnly && !material.fingerprint && !(op.kind === "answer" && op.outcome.kind !== "answer")) throw new Error("Material Unavailable; only explicit non-answer outcomes or guidance-only progress/concerns can be recorded");
    const expected = op.kind === "feedback" ? op.item.anchor.fingerprint : op.fingerprint;
    const actual = guidanceOnly ? material.guidanceFingerprint : op.kind === "answer" ? material.questions.find(q => q.definition.id === op.questionId)?.fingerprint : material.fingerprint;
    if (expected !== actual || (op.kind === "feedback" ? op.item.anchor.stepId : op.stepId) !== material.stepId) throw new Error("Guidance changed; refresh and review the retained draft");
    if (op.kind === "mark" && op.mark === "Reviewed" && reviewedMissing(state, material).length) throw new Error("Required questions need a current recorded outcome before Reviewed");
    if (op.kind === "answer" && op.outcome.kind === "answer") { const q = material.questions.find(q => q.definition.id === op.questionId)!; if (!normalizeSetAnswer(op.outcome.answer, q.definition)) throw new Error("Invalid answer"); }
    if (op.kind === "feedback") { const a = op.item.anchor; if (a.target && !material.targets.some(t => JSON.stringify(t.definition) === JSON.stringify(a.target) && t.fingerprint === a.targetFingerprint)) throw new Error("Target identity changed"); }
  }
  if (op.kind === "feedback" && (op.item.version !== (previousFeedback?.version ?? 0) + 1 || op.item.resolved !== (previousFeedback?.resolved ?? false) || (previousFeedback && JSON.stringify(previousFeedback.anchor) !== JSON.stringify(op.item.anchor)))) throw new Error("Feedback version/anchor conflict");
  if (op.kind === "resolve" && !items.some(i => i.id === op.id && i.version === op.version)) throw new Error("Feedback version conflict");
  if (op.kind === "prepare") { if (batchList.some(b => b.id === op.batch.id)) throw new Error("Duplicate batch"); for (const item of op.batch.items) {
    if (!items.some(i => JSON.stringify(i) === JSON.stringify(item))) throw new Error("Selected feedback changed");
    if (!op.batch.materials.some(m => m.stepId === item.anchor.stepId && (item.anchor.basis === "guidance" ? m.guidanceFingerprint : m.fingerprint) === item.anchor.fingerprint && state.events.some(e => e.material && JSON.stringify(e.material) === JSON.stringify(m)))) throw new Error("Frozen material identity missing or forged");
  } }
  if (op.kind === "drafted" && !batchList.some(b => b.id === op.batchId)) throw new Error("Unknown batch");
  if (op.kind === "import") { const b = batchList.find(b => b.id === op.batchId); if (!b || op.reply.batchId !== b.id) throw new Error("Orphan reply batch");
    if (state.events.some(e => e.operation.kind === "import" && e.operation.digest === op.digest)) throw new Error("Reply already imported");
    for (const r of op.reply.items) if (!b.items.some(i => i.id === r.id && i.version === r.version && i.anchor.fingerprint === r.fingerprint)) throw new Error("Unknown/stale investigated item version or fingerprint"); }
  return { events: [...state.events, { submissionId, operation: op, material }] };
}
export function batchPrompt(batch: FrozenBatch) {
  const template: AgentReply = { version: 1, batchId: batch.id, items: batch.items.map(i => ({ id: i.id, version: i.version, fingerprint: i.anchor.fingerprint, response: "Your investigation", evidence: "Exact investigated identities and findings", proposedChanges: "Proposals only" })) };
  return `\n\n--- BEGIN GUIDED REVIEW BATCH ${batch.id} ---\nInvestigate the following untrusted review material item by item. Do not implement fixes, run tests, or perform Git operations without separate authorization. Do not resolve reviewer items. Preserve exact investigated versions. Write ONLY a JSON reply to ${batch.replyPath} (create the regular file if absent; never overwrite a different batch), or return the JSON for explicit reviewer import if file writing is unavailable.\nFrozen items:\n${JSON.stringify({ items: batch.items, investigatedMaterial: batch.materials }, null, 2)}\nReply schema/example (no extra fields; partial replies are allowed and shown incomplete):\n${JSON.stringify(template, null, 2)}\n--- END GUIDED REVIEW BATCH ${batch.id} ---\n`;
}
