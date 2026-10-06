"use client";

import { useEffect, useState } from "react";
import type { AskUserAnswer } from "@/lib/ask-user";
import type { ExtensionUiRequest } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";
import { BlockingCard } from "./BlockingCard";

type Request = Extract<ExtensionUiRequest, { method: "ask_user" }>;

export function AskUserDialog({ request, onRespond }: {
  request: Request;
  onRespond: (request: Request, response: { answer: AskUserAnswer } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [freeform, setFreeform] = useState("");
  const [comment, setComment] = useState("");
  const [writing, setWriting] = useState(request.options.length === 0);
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (request.expiresAt === undefined) return;
    // The server owns expiry; this is only a countdown, not another response.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [request.expiresAt]);

  const remaining = request.expiresAt === undefined ? null : Math.max(0, Math.ceil((request.expiresAt - now) / 1000));
  const answer: AskUserAnswer | null = writing
    ? (freeform.trim() ? { kind: "freeform", text: freeform.trim() } : null)
    : (selected.length ? { kind: "selection", selections: selected, ...(request.allowComment && comment.trim() ? { comment: comment.trim() } : {}) } : null);
  const select = (title: string) => {
    setWriting(false);
    setSelected((current) => request.allowMultiple
      ? current.includes(title) ? current.filter((item) => item !== title) : [...current, title]
      : [title]);
  };
  const cancel = () => onRespond(request, { cancelled: true });

  return <div onKeyDown={(event) => {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault(); event.stopPropagation(); cancel();
  }} className="w-full min-w-0">
    <BlockingCard title={request.question} label={t("chat.askUserTitle")} collapsed={collapsed}
      onCollapse={() => setCollapsed(true)} onExpand={() => setCollapsed(false)}
      meta={remaining !== null ? t("chat.extensionExpiresIn", { seconds: remaining }) : undefined}
      onSubmit={(event) => { event.preventDefault(); if (answer) onRespond(request, { answer }); }}
      footer={<>
        <button type="button" onClick={cancel}>{t("chat.cancel")}</button>
        <button type="submit" data-primary disabled={!answer}>{t("chat.submit")}</button>
      </>}>
      {request.context && <details open={request.contextExpanded || request.context.length <= 240} className="min-w-0 text-xs text-text-muted">
        <summary className="blocking-card-section-title cursor-pointer">{t("chat.askUserContext")}</summary>
        <div className="break-words"><MarkdownBody>{request.context}</MarkdownBody></div>
      </details>}
      {request.options.length > 0 && <fieldset className="m-0 grid gap-2 border-0 p-0">
        <legend className="blocking-card-section-title">{t(request.allowMultiple ? "chat.askUserMultiple" : "chat.askUserSingle")}</legend>
        {request.options.map((option, index) => {
          const active = !writing && selected.includes(option.title);
          return <label key={`${index}-${option.title}`} className="blocking-card-choice" data-selected={active}>
            <input type={request.allowMultiple ? "checkbox" : "radio"} name="ask-user-choice" checked={active} autoFocus={index === 0}
              onChange={() => select(option.title)} className="mt-0.5 accent-accent" />
            <span className="min-w-0"><strong className="block text-[13px] font-medium text-text">{option.title}</strong>
              {option.description && <span className="mt-1 block whitespace-pre-wrap text-xs text-text-muted">{option.description}</span>}
            </span>
          </label>;
        })}
      </fieldset>}
      {(request.allowFreeform || request.options.length === 0) && <div className="min-w-0">
        {request.options.length > 0 && <label className="blocking-card-choice mb-2" data-selected={writing}>
          <input type="radio" name="ask-user-choice" checked={writing} onChange={() => setWriting(true)} className="accent-accent" />
          {t("chat.askUserOther")}
        </label>}
        {writing && <textarea autoFocus={request.options.length === 0} value={freeform} onChange={(event) => setFreeform(event.target.value)} rows={3}
          placeholder={t("chat.askUserAnswerPlaceholder")} aria-label={t("chat.askUserAnswerPlaceholder")}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && answer) { event.preventDefault(); onRespond(request, { answer }); } }}
          className="blocking-card-field min-h-[70px] resize-y" />}
      </div>}
      {request.allowComment && !writing && request.options.length > 0 && <label className="grid gap-1 text-xs text-text-muted">{t("chat.askUserComment")}
        <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} className="blocking-card-field resize-y" />
      </label>}
    </BlockingCard>
  </div>;
}
