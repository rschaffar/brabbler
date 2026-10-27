"use client";
import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MAX_ANSWER_LENGTH, selectQuestionOption, type QuestionDraft, type SetQuestion } from "@/lib/question-set";
import { MarkdownBody } from "./MarkdownBody";

/** Presentation only. The caller owns live submission OR persistent notebook outcomes. */
export function QuestionFields({ question, draft, update, name, disabled = false, allowSkip = true, renderContext }: {
  question: SetQuestion; draft: QuestionDraft; update: (patch: Partial<QuestionDraft>) => void; name: string; disabled?: boolean; allowSkip?: boolean; renderContext?: (markdown: string) => ReactNode;
}) {
  const { t } = useI18n();
  return <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-3 border-0 p-0">
    <legend className="blocking-card-section-title">{t(question.required ? "chat.questionsRequired" : "chat.questionsOptional")}</legend>
    {question.context && <details open className="min-w-0 text-xs text-text-muted"><summary>{t("chat.questionsWhy")}</summary>{renderContext ? renderContext(question.context) : <MarkdownBody>{question.context}</MarkdownBody>}</details>}
    {question.options.length > 0 && <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="blocking-card-section-title">{t(question.type === "multiple" ? "chat.askUserMultiple" : "chat.askUserSingle")}</legend>
      {question.options.map(option => {
        const active = !draft.skipped && !draft.writing && draft.selections.includes(option.id);
        return <label key={option.id} className="blocking-card-choice" data-selected={active}>
          <input type={question.type === "multiple" ? "checkbox" : "radio"} name={name} checked={active} onChange={() => update(selectQuestionOption(question, draft, option.id))} className="mt-0.5 accent-accent" />
          <span className="min-w-0"><strong className="block text-[13px] font-medium">{option.title}{option.recommended && <span className="ml-2 text-xs text-text-muted">{t("chat.questionsRecommended")}</span>}</strong>
            {option.description && <span className="mt-1 block whitespace-pre-wrap text-xs text-text-muted">{option.description}</span>}</span>
        </label>;
      })}
      <label className="blocking-card-choice" data-selected={draft.writing && !draft.skipped}><input type="radio" name={name} checked={draft.writing && !draft.skipped} onChange={() => update({ writing: true })} className="accent-accent" />{t("chat.questionsAlternative")}</label>
    </fieldset>}
    {draft.writing && <label className="grid gap-1 text-xs text-text-muted">{t("chat.askUserAnswerPlaceholder")}<textarea value={draft.text} onChange={e => update({ text: e.target.value })} rows={3} maxLength={MAX_ANSWER_LENGTH} className="blocking-card-field resize-y" /></label>}
    <label className="grid gap-1 text-xs text-text-muted">{t("chat.questionsDetails")}<textarea value={draft.comment} onChange={e => update({ comment: e.target.value })} rows={2} maxLength={MAX_ANSWER_LENGTH} placeholder={t("chat.questionsDetailsHint")} className="blocking-card-field resize-y" /></label>
    {allowSkip && !question.required && <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={draft.skipped} onChange={e => update({ skipped: e.target.checked })} className="accent-accent" />{t("chat.questionsSkip")}</label>}
    {draft.skipped && <p className="text-xs text-text-muted">{t("chat.questionsSkipHint")}</p>}
  </fieldset>;
}
