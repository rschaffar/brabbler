"use client";
import { useId, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { MAX_ANSWER_LENGTH, selectQuestionOption, type QuestionDraft, type SetQuestion } from "@/lib/question-set";
import { MarkdownBody } from "./MarkdownBody";

/** Presentation only. The caller owns live submission OR persistent notebook outcomes. */
export function QuestionFields({ question, draft, update, name, cwd, onOpenFile, disabled = false, allowSkip = true, renderContext }: {
  question: SetQuestion; draft: QuestionDraft; update: (patch: Partial<QuestionDraft>) => void; name: string; disabled?: boolean; allowSkip?: boolean; renderContext?: (markdown: string) => ReactNode;
  cwd?: string; onOpenFile?: import("@/lib/file-links").OpenFileLink;
}) {
  const { t } = useI18n();
  const descriptionPrefix = useId();
  const markdown = renderContext ?? ((text: string) => <MarkdownBody cwd={cwd} onOpenFile={onOpenFile}>{text}</MarkdownBody>);
  return <fieldset disabled={disabled} className="m-0 grid min-w-0 gap-3 border-0 p-0">
    <legend className="blocking-card-section-title">{t(question.required ? "chat.questionsRequired" : "chat.questionsOptional")}</legend>
    {question.context && <details open className="min-w-0 text-xs text-text-muted"><summary>{t("chat.questionsWhy")}</summary>{markdown(question.context)}</details>}
    {question.options.length > 0 && <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0">
      <legend className="blocking-card-section-title">{t(question.type === "multiple" ? "chat.askUserMultiple" : "chat.askUserSingle")}</legend>
      {question.options.map(option => {
        const active = !draft.skipped && !draft.writing && draft.selections.includes(option.id);
        return <div key={option.id} className="blocking-card-choice" data-selected={active}>
          <div className="min-w-0 flex-1">
            <label className="flex cursor-pointer items-start gap-2">
              <input type={question.type === "multiple" ? "checkbox" : "radio"} name={name} checked={active} aria-describedby={option.description ? `${descriptionPrefix}-${option.id}` : undefined} onChange={() => update(selectQuestionOption(question, draft, option.id))} className="mt-0.5 accent-accent" />
              <strong className="block text-[13px] font-medium">{option.title}{option.recommended && <span className="ml-2 text-xs text-text-muted">{t("chat.questionsRecommended")}</span>}</strong>
            </label>
            {option.description && <div id={`${descriptionPrefix}-${option.id}`} className="ml-6 mt-1 text-xs text-text-muted">{renderContext ? <span className="whitespace-pre-wrap">{option.description}</span> : markdown(option.description)}</div>}
          </div>
        </div>;
      })}
      <label className="blocking-card-choice" data-selected={draft.writing && !draft.skipped}><input type="radio" name={name} checked={draft.writing && !draft.skipped} onChange={() => update({ writing: true })} className="accent-accent" />{t("chat.questionsAlternative")}</label>
    </fieldset>}
    {draft.writing && <label className="grid gap-1 text-xs text-text-muted">{t("chat.askUserAnswerPlaceholder")}<textarea value={draft.text} onChange={e => update({ text: e.target.value })} rows={3} maxLength={MAX_ANSWER_LENGTH} className="blocking-card-field resize-y" /></label>}
    <label className="grid gap-1 text-xs text-text-muted">{t("chat.questionsDetails")}<textarea value={draft.comment} onChange={e => update({ comment: e.target.value })} rows={2} maxLength={MAX_ANSWER_LENGTH} placeholder={t("chat.questionsDetailsHint")} className="blocking-card-field resize-y" /></label>
    {allowSkip && !question.required && <label className="flex items-center gap-2 text-xs text-text-muted"><input type="checkbox" checked={draft.skipped} onChange={e => update({ skipped: e.target.checked })} className="accent-accent" />{t("chat.questionsSkip")}</label>}
    {draft.skipped && <p className="text-xs text-text-muted">{t("chat.questionsSkipHint")}</p>}
  </fieldset>;
}
