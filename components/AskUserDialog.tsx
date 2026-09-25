"use client";

import { useEffect, useId, useState } from "react";
import type { AskUserAnswer } from "@/lib/ask-user";
import type { ExtensionUiRequest } from "@/lib/types";
import { useI18n } from "@/hooks/useI18n";
import { MarkdownBody } from "./MarkdownBody";

type Request = Extract<ExtensionUiRequest, { method: "ask_user" }>;

export function AskUserDialog({ request, onRespond }: {
  request: Request;
  onRespond: (request: Request, response: { answer: AskUserAnswer } | { cancelled: true }) => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
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
  const fieldStyle = {
    width: "100%", padding: "9px 10px", borderRadius: 7, border: "1px solid var(--border)",
    background: "var(--bg-panel)", color: "var(--text)", fontSize: 13, lineHeight: 1.5,
  } as const;

  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }}
      style={{ position: "absolute", inset: 0, zIndex: 90, display: "flex", alignItems: collapsed ? "flex-start" : "center", justifyContent: "center", padding: "min(20px, 4vw)", pointerEvents: "none" }}
    >
      {collapsed ? (
        <button type="button" aria-expanded={false} onClick={() => setCollapsed(false)}
          style={{ pointerEvents: "auto", width: "min(680px, 100%)", padding: 12, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", boxShadow: "0 12px 32px rgba(0,0,0,.18)", cursor: "pointer", textAlign: "left", display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ color: "var(--accent)", fontSize: 11, fontWeight: 650, whiteSpace: "nowrap" }}>{t("chat.extensionPending")}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{request.question}</span>
          {remaining !== null && <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>{t("chat.extensionExpiresIn", { seconds: remaining })}</span>}
          <span style={{ fontSize: 12, whiteSpace: "nowrap" }}>{t("chat.extensionExpand")}</span>
        </button>
      ) : (
        <form role="dialog" aria-modal="true" aria-labelledby={titleId}
          onSubmit={(event) => { event.preventDefault(); if (answer) onRespond(request, { answer }); }}
          style={{ pointerEvents: "auto", width: "min(680px, 100%)", maxHeight: "100%", display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", boxShadow: "0 20px 60px rgba(0,0,0,.28)", overflow: "hidden" }}>
          <header style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 650, marginBottom: 5 }}>{t("chat.askUserTitle")}</div>
              <div id={titleId} style={{ fontSize: 16, fontWeight: 650, color: "var(--text)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{request.question}</div>
              {remaining !== null && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("chat.extensionExpiresIn", { seconds: remaining })}</span>}
            </div>
            <button type="button" onClick={() => setCollapsed(true)} aria-label={t("chat.extensionCollapse")} title={t("chat.extensionCollapse")}
              style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "5px 8px", background: "var(--bg-panel)", color: "var(--text-muted)", cursor: "pointer" }}>−</button>
          </header>
          <div style={{ padding: "14px 18px 20px", minHeight: 0, overflowY: "auto", display: "grid", gap: 14 }}>
            {request.context && (
              <details open={request.contextExpanded || request.context.length <= 240} style={{ padding: 12, borderRadius: 8, background: "var(--bg-panel)", color: "var(--text-muted)", fontSize: 13 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>{t("chat.askUserContext")}</summary>
                <div style={{ paddingTop: 8, overflowWrap: "anywhere" }}><MarkdownBody>{request.context}</MarkdownBody></div>
              </details>
            )}
            {request.options.length > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 8 }}>
                <legend style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 8 }}>{t(request.allowMultiple ? "chat.askUserMultiple" : "chat.askUserSingle")}</legend>
                {request.options.map((option, index) => {
                  const active = !writing && selected.includes(option.title);
                  return (
                    <label key={`${index}-${option.title}`} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 12px", border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, background: active ? "var(--bg-selected)" : "var(--bg-panel)", cursor: "pointer", overflowWrap: "anywhere" }}>
                      <input type={request.allowMultiple ? "checkbox" : "radio"} name="ask-user-choice" checked={active} autoFocus={index === 0}
                        onChange={() => select(option.title)} style={{ marginTop: 3, accentColor: "var(--accent)" }} />
                      <span style={{ minWidth: 0 }}><strong style={{ display: "block", fontSize: 13, color: "var(--text)" }}>{option.title}</strong>
                        {option.description && <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{option.description}</span>}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            {(request.allowFreeform || request.options.length === 0) && (
              <div style={{ padding: request.options.length ? "11px 12px" : 0, border: request.options.length ? `1px solid ${writing ? "var(--accent)" : "var(--border)"}` : "none", borderRadius: 8, background: request.options.length ? (writing ? "var(--bg-selected)" : "var(--bg-panel)") : "transparent" }}>
                {request.options.length > 0 && <label style={{ display: "flex", gap: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, marginBottom: writing ? 8 : 0 }}>
                  <input type="radio" name="ask-user-choice" checked={writing} onChange={() => setWriting(true)} style={{ accentColor: "var(--accent)" }} />
                  {t("chat.askUserOther")}
                </label>}
                {writing && <textarea autoFocus={request.options.length === 0} value={freeform} onChange={(event) => setFreeform(event.target.value)} rows={3}
                  placeholder={t("chat.askUserAnswerPlaceholder")} aria-label={t("chat.askUserAnswerPlaceholder")}
                  onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && answer) { event.preventDefault(); onRespond(request, { answer }); } }}
                  style={{ ...fieldStyle, resize: "vertical", minHeight: 70 }} />}
              </div>
            )}
            {request.allowComment && !writing && request.options.length > 0 && (
              <label style={{ display: "grid", gap: 6, color: "var(--text-muted)", fontSize: 12 }}>{t("chat.askUserComment")}
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
              </label>
            )}
          </div>
          <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--bg-panel)" }}>
            <button type="button" onClick={cancel} style={{ padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer" }}>{t("chat.cancel")}</button>
            <button type="submit" disabled={!answer} style={{ padding: "8px 14px", border: "1px solid var(--accent)", borderRadius: 6, background: "var(--accent)", color: "var(--accent-contrast)", opacity: answer ? 1 : .5, cursor: answer ? "pointer" : "not-allowed" }}>{t("chat.submit")}</button>
          </footer>
        </form>
      )}
    </div>
  );
}
