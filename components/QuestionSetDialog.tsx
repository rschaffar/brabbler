"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { draftAnswer, type QuestionDraft, type SetAnswer } from "@/lib/question-set";
import { clearQuestionDraft, loadQuestionDrafts, saveQuestionDrafts } from "@/lib/question-set-drafts";
import type { ExtensionUiRequest } from "@/lib/types";
import { BlockingCard } from "./BlockingCard";
import { MarkdownBody } from "./MarkdownBody";
import { QuestionSetReview } from "./QuestionSetReview";
import { QuestionFields } from "./QuestionFields";

type Request = Extract<ExtensionUiRequest, { method: "ask_user_batch" }>;
export function QuestionSetDialog({ request, sessionId, onRespond, onSubmissionWork }: {
  request: Request;
  sessionId: string;
  onRespond: (request: Request, response: { answers: SetAnswer[] } | { cancelled: true }) => Promise<void>;
  /** Passive complete send/catch/finally observation; absent in default UI. */
  onSubmissionWork?: (work: Promise<void>) => void;
}) {
  const { t } = useI18n();
  const [initial] = useState(() => loadQuestionDrafts(sessionId, request.id, request));
  const [drafts, setDrafts] = useState(initial.drafts);
  const [storageAvailable, setStorageAvailable] = useState(initial.available);
  const [page, setPage] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sending = useRef(false);
  const settled = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const review = page === request.questions.length;
  const question = request.questions[page];
  const draft = question ? drafts[question.id] : undefined;
  const answers = request.questions.map((q) => draftAnswer(q, drafts[q.id]));
  const valid = answers.every((a) => a !== null);
  const answered = answers.filter((a) => a && a.kind !== "skipped").length;
  const dirty = Object.values(drafts).some((d) => d.selections.length || d.text || d.comment || d.skipped);
  const remaining = request.expiresAt === undefined ? null : Math.max(0, Math.ceil((request.expiresAt - now) / 1000));

  useEffect(() => {
    if (!settled.current) setStorageAvailable(saveQuestionDrafts(sessionId, request.id, request, drafts));
  }, [drafts, request, sessionId]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [page]);
  useEffect(() => {
    if (request.expiresAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.expiresAt]);

  const update = (patch: Partial<QuestionDraft>) => {
    setDrafts((current) => ({ ...current, [question.id]: { ...current[question.id], skipped: false, ...patch } }));
    setError(false);
  };
  const send = async (cancelled = false) => {
    if (sending.current || remaining === 0 || (!cancelled && !valid)) return;
    sending.current = true;
    setSubmitting(true);
    setError(false);
    try {
      await onRespond(request, cancelled ? { cancelled: true } : { answers: answers as SetAnswer[] });
      settled.current = true;
      clearQuestionDraft(sessionId, request.id);
    } catch {
      setError(true);
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  };
  const submit = (cancelled = false) => {
    const work = send(cancelled);
    onSubmissionWork?.(work);
    return work;
  };
  const cancel = () => { if (dirty) setConfirmCancel(true); else void submit(true); };
  const status = (index: number) => answers[index]?.kind === "skipped" ? t("chat.questionsSkipped")
    : answers[index] ? t("chat.questionsAnswered") : t("chat.questionsUnanswered");

  return <div className="w-full min-w-0" data-question-set={request.id} onKeyDown={(event) => {
    // Escape never discards a set. Enter in fields never submits it implicitly.
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.preventDefault(); event.stopPropagation(); setConfirmCancel(false);
    }
  }}>
    <BlockingCard title={request.title} label={t("chat.questionsTitle")} collapsed={collapsed}
      onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)}
      meta={remaining === null ? t("chat.questionsProgress", { answered, total: request.questions.length }) : t("chat.extensionExpiresIn", { seconds: remaining })}
      footer={confirmCancel ? <>
        <span className="mr-auto text-xs text-text-muted">{t("chat.questionsDiscard")}</span>
        <button type="button" disabled={submitting} onClick={() => setConfirmCancel(false)}>{t("chat.questionsKeep")}</button>
        <button type="button" disabled={submitting} onClick={() => void submit(true)}>{t("chat.questionsCancelSet")}</button>
      </> : <>
        <button type="button" disabled={submitting} onClick={cancel}>{t("chat.cancel")}</button>
        <button type="button" disabled={submitting || page === 0} onClick={() => setPage(page - 1)}>{t("chat.questionsBack")}</button>
        {!review && <button type="button" disabled={submitting} onClick={() => setPage(page + 1)}>
          {page === request.questions.length - 1 ? t("chat.questionsReview") : t("chat.questionsNext")}
        </button>}
        {(valid || review) && <button type="button" data-primary disabled={submitting || !valid || remaining === 0} onClick={() => void submit()}>
          {submitting ? t("chat.questionsSubmitting") : error ? t("chat.questionsRetry") : t("chat.questionsSubmit")}
        </button>}
      </>}>
      {error && <p role="alert" className="text-xs text-red-400">{t("chat.questionsSendFailed")}</p>}
      {!storageAvailable && <p role="status" className="text-xs text-text-muted">{t("chat.questionsStorageUnavailable")}</p>}
      {request.context && <details open className="min-w-0 text-xs text-text-muted">
        <summary className="blocking-card-section-title cursor-pointer">{t("chat.askUserContext")}</summary>
        <MarkdownBody>{request.context}</MarkdownBody>
      </details>}
      <nav aria-label={t("chat.questionsNavigation")} className="hidden flex-wrap gap-1 sm:flex">
        {request.questions.map((q, i) => <button key={q.id} type="button" disabled={submitting}
          aria-current={page === i ? "step" : undefined} aria-label={`${q.shortLabel}: ${status(i)}`}
          onClick={() => setPage(i)} className={`rounded border px-2 py-1 text-xs ${page === i ? "border-accent bg-bg-selected" : "border-border"}`}>
          {answers[i]?.kind === "skipped" ? "−" : answers[i] ? "✓" : i + 1} {q.shortLabel}
        </button>)}
        <button type="button" disabled={submitting} aria-current={review ? "step" : undefined} onClick={() => setPage(request.questions.length)}
          className="rounded border border-border px-2 py-1 text-xs">{t("chat.questionsReview")}</button>
      </nav>
      <label className="grid gap-1 text-xs sm:hidden">{t("chat.questionsNavigation")}
        <select value={page} disabled={submitting} onChange={(e) => setPage(Number(e.target.value))} className="blocking-card-field">
          {request.questions.map((q, i) => <option key={q.id} value={i}>{i + 1}/{request.questions.length} · {q.shortLabel} · {status(i)}</option>)}
          <option value={request.questions.length}>{t("chat.questionsReview")}</option>
        </select>
      </label>
      <h3 ref={heading} tabIndex={-1} className="m-0 break-words text-sm font-medium outline-none">
        {review ? t("chat.questionsReview") : question.question}
      </h3>
      {review ? <>
        <p className="text-xs text-text-muted">{t("chat.questionsNotSent")}</p>
        <QuestionSetReview set={request} answers={answers} onEdit={submitting ? undefined : setPage} />
      </> : question && draft && <QuestionFields question={question} draft={draft} update={update} disabled={submitting} name={`question-${request.id}-${question.id}`} />}
    </BlockingCard>
  </div>;
}
