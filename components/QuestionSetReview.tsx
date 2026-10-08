"use client";

import { useI18n } from "@/hooks/useI18n";
import type { QuestionSet, SetAnswer } from "@/lib/question-set";
import { MarkdownBody } from "./MarkdownBody";

/** Shared read-only answer rendering. Historical use has no edit callbacks. */
export function QuestionSetReview({ set, answers, onEdit, showOptions = false }: {
  set: QuestionSet;
  answers: Array<SetAnswer | null>;
  onEdit?: (index: number) => void;
  showOptions?: boolean;
}) {
  const { t } = useI18n();
  return <div className="grid min-w-0 gap-4">{set.questions.map((q, index) => {
    const answer = answers.find((a) => a?.id === q.id);
    const main = !answer ? t("chat.questionsUnanswered") : answer.kind === "skipped" ? t("chat.questionsSkipped")
      : answer.kind === "freeform" ? answer.text
        : answer.selections.map((id) => q.options.find((o) => o.id === id)?.title ?? id).join(", ");
    return <section key={q.id} className="min-w-0 border-b border-border pb-3">
      <div className="flex items-start justify-between gap-2">
        <h4 className="m-0 break-words text-xs font-medium">{q.question}</h4>
        {onEdit && <button type="button" className="shrink-0 text-xs text-accent" onClick={() => onEdit(index)}
          aria-label={t("chat.questionsEditLabel", { label: q.shortLabel })}>{t("chat.questionsEdit")}</button>}
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-xs text-text-muted">{main}</p>
      {answer && answer.kind !== "skipped" && answer.comment && <div className="mt-2 text-xs">
        <strong className="font-medium">{t("chat.questionsDetails")}</strong>
        <p className="whitespace-pre-wrap break-words text-text-muted">{answer.comment}</p>
      </div>}
      {showOptions && <>
        {q.context && <MarkdownBody>{q.context}</MarkdownBody>}
        <ul className="mt-2 grid list-none gap-1 p-0">{q.options.map((o) => <li key={o.id} className="blocking-card-choice"
          data-selected={answer?.kind === "selection" && answer.selections.includes(o.id) || undefined}>
          <span className="min-w-0"><strong className="block text-xs font-medium">{o.title}
            {o.recommended && <span className="ml-2 text-text-muted">{t("chat.questionsRecommended")}</span>}
          </strong>{o.description && <span className="block whitespace-pre-wrap text-xs text-text-muted">{o.description}</span>}</span>
        </li>)}</ul>
      </>}
    </section>;
  })}</div>;
}
