"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useNavigationWork } from "@/lib/navigation-work";
import { sendAgentCommand } from "@/lib/agent-client";
import type { BtwConversation } from "@/lib/btw-runtime";
import type { SessionInfo } from "@/lib/types";
import { ChatWindow } from "./ChatWindow";
import type { ChatInputHandle } from "./ChatInput";
import { MarkdownBody } from "./MarkdownBody";
import styles from "./BtwPanel.module.css";

export interface BtwPanelProps {
  parent: SessionInfo;
  open: boolean;
  runningIds: ReadonlySet<string>;
  archivedRootSessionId: string | null;
  onClose: () => void;
  onOpenSession: (id: string) => void;
  onDraft: (sourceId: string, text: string) => void;
  onChanged: () => void;
  onSessionRestored: (id: string) => void;
}

/** A second ordinary chat owner. Hiding the panel never aborts either session. */
export function BtwPanel(props: BtwPanelProps) {
  const { parent, open, runningIds, archivedRootSessionId } = props;
  const { t } = useI18n();
  const work = useNavigationWork();
  const latest = useRef(props); latest.current = props;
  const [conversation, setConversation] = useState<BtwConversation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(440);
  const mounted = useRef(false);
  const close = useRef<HTMLButtonElement>(null);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const action = useRef(false);
  const endpoint = `/api/sessions/${encodeURIComponent(parent.id)}/btw`;
  const child = conversation?.session;
  const running = Boolean(child && runningIds.has(child.id));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!open) return;
    close.current?.focus({ preventScroll: true });
    const controller = new AbortController();
    // Explicit opening creates/reopens an empty saved aside; it never sends a prompt.
    void work.observe((async () => {
      setBusy(true); setError(null);
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "ensure" }), signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        if (!controller.signal.aborted) { setConversation(data); latest.current.onChanged(); }
      } catch (cause) { if (!controller.signal.aborted) setError(String(cause instanceof Error ? cause.message : cause)); }
      finally { if (!controller.signal.aborted) setBusy(false); }
    })());
    return () => controller.abort();
  }, [open, endpoint, work]);

  const perform = (operation: () => Promise<void>) => {
    if (action.current) return;
    action.current = true; setBusy(true); setError(null); setCopied(false);
    void work.observe(operation().catch(cause => {
      if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => { action.current = false; if (mounted.current) setBusy(false); }));
  };
  const refresh = () => perform(async () => {
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (mounted.current) { setConversation(data); latest.current.onChanged(); }
  });
  const copyAnswer = () => {
    if (!child) return;
    perform(async () => {
      const { text } = await sendAgentCommand<{ text: string }>(child.id, { type: "get_last_assistant_text" });
      if (!text.trim()) throw new Error(t("btw.noAnswer"));
      if (mounted.current) { latest.current.onDraft(parent.id, text); setCopied(true); }
    });
  };
  const resize = (next: number) => setWidth(Math.max(320, Math.min(next, window.innerWidth * 0.65)));

  return <aside className={styles.panel} hidden={!open} inert={!open} style={{ width }} aria-label={t("btw.title")}
    onKeyDownCapture={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); props.onClose(); }
    }}>
    <div role="separator" tabIndex={0} aria-label={t("btw.resize")} aria-orientation="vertical" aria-valuemin={320} aria-valuenow={Math.round(width)} className={styles.resize}
      onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); resize(width + (event.key === "ArrowLeft" ? 24 : -24)); } }}
      onPointerDown={event => { resizing.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (resizing.current) resize(resizing.current.width + resizing.current.x - event.clientX); }}
      onPointerUp={event => { resizing.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { resizing.current = null; }} />
    <header className={styles.header}>
      <div><strong>{t("btw.title")}</strong><small>{t("btw.chatOnly")}</small></div>
      {child && <button type="button" onClick={() => props.onOpenSession(child.id)}>{t("btw.fullSize")}</button>}
      <button type="button" ref={close} onClick={props.onClose} aria-label={t("btw.close")} title={t("btw.close")}>×</button>
    </header>
    <div className={styles.context}>
      <span>{t("btw.source", { name: parent.name || parent.firstMessage || parent.id })}</span>
      {conversation?.snapshot && <details><summary>{t("btw.context")} · {new Date(conversation.snapshot.capturedAt).toLocaleTimeString("en")}</summary>
        <div className={styles.snapshot}><MarkdownBody>{conversation.snapshot.text || t("btw.emptyContext")}</MarkdownBody></div>
      </details>}
      <button type="button" disabled={busy || running} onClick={refresh}>{t(child ? "btw.refresh" : "btw.retry")}</button>
    </div>
    {error && <div role="alert" className={styles.error}>{error}</div>}
    {busy && <div role="status" className={styles.status}>{t("btw.loading")}</div>}
    <div className={styles.chat}>
      {child && <ChatWindow key={child.id} session={child} secondary chatInputRef={chatInputRef} covered={!open} sessionRunning={running}
        newSessionCwd={null} newSessionDraftKey={null} archivedRootSessionId={archivedRootSessionId}
        archiveActionBusy={running} onSessionRestored={props.onSessionRestored}
        onAgentEnd={props.onChanged} onOpenSession={props.onOpenSession} soundEnabled={false} />}
    </div>
    {child && <footer className={styles.footer}>
      <button type="button" disabled={busy || running || Boolean(archivedRootSessionId)} onClick={copyAnswer}>{t(copied ? "btw.drafted" : "btw.copyToMain")}</button>
      <small>{t("btw.independent")}</small>
    </footer>}
  </aside>;
}
