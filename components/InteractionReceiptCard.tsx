"use client";

import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { interactionAnswer, interactionTitle, type InteractionReceipt } from "@/lib/interaction-receipts";
import { BlockingCard } from "./BlockingCard";
import { MarkdownBody } from "./MarkdownBody";
import { PluginCardContent } from "./plugin-ui/PluginCard";
import { QuestionSetReview } from "./QuestionSetReview";

/** No live request, submit callback, editable draft or timer exists in this component. */
export function InteractionReceiptCard({ receipt, sessionId }: { receipt: InteractionReceipt; sessionId?: string }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(true);
  const { request, response } = receipt;
  const answer = response && "confirmed" in response
    ? t(response.confirmed ? "chat.receiptConfirmed" : "chat.receiptDeclined")
    : interactionAnswer(receipt);
  const outcome = t(`chat.receipt.${receipt.outcome}`);
  return <div className="my-4 min-w-0" data-interaction-receipt={request.id}
    data-operation-id={request.method === "plugin_card" ? request.operationId : undefined}>
    <BlockingCard allowFullscreen={request.method === "plugin_card" && Boolean(request.review || request.patch)} title={interactionTitle(request)}
      label={request.method === "plugin_card" && request.subtitle ? `${request.subtitle} · ${outcome}` : outcome}
      collapsedLabel={outcome}
      collapsed={collapsed} retainBodyWhenCollapsed={false}
      onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)}
      meta={request.method === "ask_user_batch" ? t("chat.questionsReceiptCount", { total: request.questions.length,
        answered: response && "answers" in response ? response.answers.filter((a) => a.kind !== "skipped").length : 0 }) : answer !== null ? <span className="block max-w-[220px] truncate" title={answer}>{answer}</span> : undefined}
      footer={<p className="min-w-0 text-xs text-text-muted">
        {request.method === "plugin_card" ? t("chat.receiptDecisionOnly") : outcome}
      </p>}>
      {answer !== null && request.method !== "ask_user_batch" && <section className="min-w-0">
        <h3 className="blocking-card-section-title">{t("chat.receiptResponse")}</h3>
        <pre className="blocking-card-code">{answer}</pre>
      </section>}
      {request.method === "plugin_card" ? <>
        {request.scope && <p className="blocking-card-scope">{request.scope}</p>}
        <PluginCardContent request={request} sessionId={sessionId} />
        {request.operationId && <pre className="blocking-card-code">Operation: {request.operationId}</pre>}
      </>
        : request.method === "ask_user_batch" ? <>
          {request.context && <MarkdownBody>{request.context}</MarkdownBody>}
          <QuestionSetReview set={request} answers={response && "answers" in response ? response.answers : []} showOptions />
        </> : request.method === "ask_user" ? <>
          {request.context && <section className="min-w-0">
            <h3 className="blocking-card-section-title">{t("chat.askUserContext")}</h3>
            <MarkdownBody>{request.context}</MarkdownBody>
          </section>}
          <ul className="grid list-none gap-2 p-0">{request.options.map((option, index) => <li key={index}
            className="blocking-card-choice" data-selected={response && "answer" in response
              && response.answer.kind === "selection" && response.answer.selections.includes(option.title) || undefined}>
            <span className="min-w-0"><strong className="block text-[13px]">{option.title}</strong>
              {option.description && <span className="block whitespace-pre-wrap text-xs text-text-muted">{option.description}</span>}
            </span>
          </li>)}</ul>
        </> : request.method === "select" ? <ul className="grid list-none gap-2 p-0">{request.options.map((option, index) =>
          <li key={index} className="blocking-card-choice" data-selected={response && "value" in response && response.value === option || undefined}>{option}</li>)}</ul>
          : request.method === "confirm" ? <p className="whitespace-pre-wrap break-words text-xs">{request.message}</p>
            : request.method === "editor" ? <pre className="blocking-card-code">{request.prefill}</pre>
              : request.placeholder ? <p className="text-xs text-text-muted">{request.placeholder}</p> : null}
    </BlockingCard>
  </div>;
}
