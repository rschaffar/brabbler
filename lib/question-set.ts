/** Browser question sets: IDs carry identity; labels are presentation only. */
export interface QuestionSetOption {
  id: string;
  title: string;
  description?: string;
  recommended?: boolean;
  exclusive?: boolean;
}
export interface SetQuestion {
  id: string;
  shortLabel: string;
  question: string;
  context?: string;
  type: "single" | "multiple" | "text";
  required: boolean;
  options: QuestionSetOption[];
}
export interface QuestionSet {
  title: string;
  context?: string;
  questions: SetQuestion[];
}
export type SetAnswer =
  | { id: string; kind: "selection"; selections: string[]; comment?: string }
  | { id: string; kind: "freeform"; text: string; comment?: string }
  | { id: string; kind: "skipped" };

export const MAX_SET_QUESTIONS = 6;
export const MAX_ANSWER_LENGTH = 20_000;
const ID = /^[a-zA-Z0-9_-]{1,64}$/;
export function isQuestionSetId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= max;
}
function optionalText(value: unknown, max: number): boolean {
  return value === undefined || (typeof value === "string" && value.length <= max);
}

/** Also used when reading historical receipts; malformed data must not break chat. */
export function parseQuestionSet(value: unknown): QuestionSet | null {
  if (!record(value) || !text(value.title, 200) || !optionalText(value.context, 8000)
    || !Array.isArray(value.questions) || !value.questions.length || value.questions.length > MAX_SET_QUESTIONS) return null;
  const questions: SetQuestion[] = [];
  const ids = new Set<string>();
  for (const q of value.questions) {
    if (!record(q) || !isQuestionSetId(q.id) || ids.has(q.id)
      || !text(q.shortLabel, 60) || !text(q.question, 2000) || !optionalText(q.context, 8000)
      || !["single", "multiple", "text"].includes(q.type as string)
      || (q.required !== undefined && typeof q.required !== "boolean")) return null;
    const raw = q.options ?? [];
    if (!Array.isArray(raw) || raw.length > 12 || (q.type === "text" ? raw.length !== 0 : raw.length === 0)) return null;
    const options: QuestionSetOption[] = [];
    const optionIds = new Set<string>();
    for (const o of raw) {
      if (!record(o) || !isQuestionSetId(o.id) || optionIds.has(o.id)
        || !text(o.title, 200) || !optionalText(o.description, 2000)
        || (o.recommended !== undefined && typeof o.recommended !== "boolean")
        || (o.exclusive !== undefined && typeof o.exclusive !== "boolean")) return null;
      optionIds.add(o.id);
      options.push({ id: o.id, title: o.title, ...(o.description ? { description: o.description as string } : {}),
        ...(o.recommended === true ? { recommended: true } : {}), ...(o.exclusive === true ? { exclusive: true } : {}) });
    }
    ids.add(q.id);
    questions.push({ id: q.id, shortLabel: q.shortLabel, question: q.question, type: q.type as SetQuestion["type"],
      required: q.required !== false, options, ...(q.context ? { context: q.context as string } : {}) });
  }
  return { title: value.title, ...(value.context ? { context: value.context as string } : {}), questions };
}

export function normalizeSetAnswer(value: unknown, question: SetQuestion): SetAnswer | null {
  if (!record(value) || value.id !== question.id) return null;
  if (value.kind === "skipped") return question.required || value.comment !== undefined ? null : { id: question.id, kind: "skipped" };
  if (!optionalText(value.comment, MAX_ANSWER_LENGTH)) return null;
  const comment = typeof value.comment === "string" ? value.comment.trim() : "";
  const extra = comment ? { comment } : {};
  if (value.kind === "freeform") return text(value.text, MAX_ANSWER_LENGTH)
    ? { id: question.id, kind: "freeform", text: value.text.trim(), ...extra } : null;
  if (value.kind !== "selection" || question.type === "text" || !Array.isArray(value.selections)
    || !value.selections.length || (question.type === "single" && value.selections.length !== 1)) return null;
  const selections = value.selections;
  if (new Set(selections).size !== selections.length || selections.some((id) => typeof id !== "string"
    || !question.options.some((o) => o.id === id))
    || (selections.length > 1 && question.options.some((o) => o.exclusive && selections.includes(o.id)))) return null;
  // Canonical display order, not click order.
  return { id: question.id, kind: "selection", selections: question.options.filter((o) => selections.includes(o.id)).map((o) => o.id), ...extra };
}

/** All questions must occur exactly once. No partial answer is ever accepted. */
export function normalizeSetAnswers(value: unknown, set: QuestionSet): SetAnswer[] | null {
  if (!Array.isArray(value) || value.length !== set.questions.length || value.some((a) => !record(a))
    || new Set(value.map((a) => a.id)).size !== value.length) return null;
  const answers = set.questions.map((q) => normalizeSetAnswer(value.find((a) => a.id === q.id), q));
  return answers.every((a) => a !== null) ? answers : null;
}

export function setAnswerSummary(answer: SetAnswer, question: SetQuestion): string {
  if (answer.kind === "skipped") return "Skipped";
  const main = answer.kind === "freeform" ? answer.text
    : answer.selections.map((id) => question.options.find((o) => o.id === id)?.title ?? id).join(", ");
  return answer.comment ? `${main}\nAdditional details: ${answer.comment}` : main;
}
export function questionSetSummary(set: QuestionSet, answers: SetAnswer[]): string {
  return set.questions.map((q) => `${q.question}\n${setAnswerSummary(answers.find((a) => a.id === q.id)!, q)}`).join("\n\n");
}

export interface QuestionDraft {
  selections: string[];
  writing: boolean;
  text: string;
  comment: string;
  skipped: boolean;
}
export function emptyQuestionDraft(q: SetQuestion): QuestionDraft {
  return { selections: [], writing: q.type === "text", text: "", comment: "", skipped: false };
}
export function selectQuestionOption(question: SetQuestion, draft: QuestionDraft, id: string): Partial<QuestionDraft> {
  const option = question.options.find(o => o.id === id);
  if (!option) return {};
  const selections = question.type === "single" || draft.writing || draft.skipped ? [id]
    : draft.selections.includes(id) ? draft.selections.filter(i => i !== id)
      : option.exclusive ? [id] : [...draft.selections.filter(i => !question.options.find(o => o.id === i)?.exclusive), id];
  return { writing: false, selections };
}
export function draftAnswer(q: SetQuestion, draft: QuestionDraft): SetAnswer | null {
  return normalizeSetAnswer(draft.skipped ? { id: q.id, kind: "skipped" }
    : draft.writing ? { id: q.id, kind: "freeform", text: draft.text, comment: draft.comment }
      : { id: q.id, kind: "selection", selections: draft.selections, comment: draft.comment }, q);
}
