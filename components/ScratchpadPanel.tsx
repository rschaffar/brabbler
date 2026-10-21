"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { SCRATCHPAD_MAX_LENGTH } from "@/lib/scratchpad";
import { ScratchpadController } from "@/lib/scratchpad-client";
import "./ScratchpadPanel.css";

function NoteEditor({ controller, session, open }: { controller: ScratchpadController; session: boolean; open: boolean }) {
  const { t } = useI18n();
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const before = useRef({ start: 0, end: 0 });
  const composing = useRef(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const label = t(session ? "scratchpad.session" : "scratchpad.global");
  useEffect(() => {
    if (!open) return;
    void controller.refresh();
    const refresh = () => { if (document.visibilityState === "visible") void controller.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [controller, open]);
  useEffect(() => {
    if (open && view.ready && !session) textarea.current?.focus();
  }, [open, view.ready, session]);
  useLayoutEffect(() => {
    if (view.selection && textarea.current && !composing.current) {
      textarea.current.setSelectionRange(view.selection.start, view.selection.end);
    }
  }, [view.selection]);
  const history = (direction: "undo" | "redo") => {
    if (composing.current) return;
    const element = textarea.current!;
    controller.history(direction, element.selectionStart, element.selectionEnd);
    element.focus();
  };
  const status = view.conflict ? "conflict" : view.error ? `${view.error}Error` : !view.ready ? "loading" : view.saving || view.dirty ? "saving" : "saved";
  return <section className="scratchpad-note" aria-label={label}>
    <div className="scratchpad-note-toolbar">
      <h3>{label}</h3>
      <button type="button" disabled={!view.canUndo} onClick={() => history("undo")} aria-label={t("scratchpad.undo", { scope: label })} title={t("scratchpad.undo", { scope: label })}>↶</button>
      <button type="button" disabled={!view.canRedo} onClick={() => history("redo")} aria-label={t("scratchpad.redo", { scope: label })} title={t("scratchpad.redo", { scope: label })}>↷</button>
      <button type="button" disabled={!view.ready && !view.text} onClick={() => { void copyText(view.text).then(() => setCopyFailed(false), () => setCopyFailed(true)); }} aria-label={t("scratchpad.copy", { scope: label })} title={t("scratchpad.copy", { scope: label })}>{t("scratchpad.copyShort")}</button>
    </div>
    <p className="scratchpad-hint">{t(session ? "scratchpad.sessionHint" : "scratchpad.globalHint")}</p>
    <textarea ref={textarea} aria-label={label} value={view.text} disabled={!view.ready}
      maxLength={SCRATCHPAD_MAX_LENGTH} spellCheck placeholder={t("scratchpad.placeholder")}
      onBlur={() => controller.breakGroup()}
      onBeforeInput={() => { const element = textarea.current!; before.current = { start: element.selectionStart, end: element.selectionEnd }; }}
      onSelect={() => { const element = textarea.current!; before.current = { start: element.selectionStart, end: element.selectionEnd }; }}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onChange={(event) => {
        const element = event.currentTarget;
        controller.edit(element.value, before.current.start, before.current.end, element.selectionStart, element.selectionEnd, (event.nativeEvent as InputEvent).inputType);
        before.current = { start: element.selectionStart, end: element.selectionEnd };
      }}
      onKeyDown={(event) => {
        if (composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
          return;
        }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) controller.breakGroup();
        const modifier = event.ctrlKey || event.metaKey;
        if (modifier && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
          event.preventDefault(); event.stopPropagation();
          history(event.shiftKey || event.key.toLowerCase() === "y" ? "redo" : "undo");
        }
      }} />
    <div className="scratchpad-status">
      <span role="status">{t(`scratchpad.${status}`)}</span>
      <span>{t("scratchpad.count", { count: view.text.length, max: SCRATCHPAD_MAX_LENGTH })}</span>
    </div>
    {view.error && <button type="button" onClick={() => controller.retry()}>{t("scratchpad.retry")}</button>}
    {view.recoveryUnavailable && <p role="alert">{t("scratchpad.recoveryUnavailable")}</p>}
    {copyFailed && <p role="alert">{t("scratchpad.copyFailed")}</p>}
    {view.conflict && <div className="scratchpad-conflict" role="alert">
      <p>{t("scratchpad.conflictHint")}</p>
      <details><summary>{t("scratchpad.serverVersion")}</summary><pre>{view.conflict.text || t("scratchpad.empty")}</pre></details>
      <div><button type="button" onClick={() => controller.resolve(true)}>{t("scratchpad.keepMine")}</button>
        <button type="button" onClick={() => controller.resolve(false)}>{t("scratchpad.useServer")}</button></div>
    </div>}
  </section>;
}

export function ScratchpadPanel({ open, sessionId, onClose }: { open: boolean; sessionId: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [controllers] = useState(() => new Map<string | null, ScratchpadController>());
  const controllerFor = (id: string | null) => {
    let controller = controllers.get(id);
    if (!controller) {
      let storage = null;
      try { storage = window.sessionStorage; } catch { /* Reported when a draft cannot be persisted. */ }
      controller = new ScratchpadController(id, storage);
      controllers.set(id, controller);
    }
    return controller;
  };
  useEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)")?.focus();
    } else if (!open && element.open) element.close();
  }, [open]);
  return <dialog ref={dialog} className="scratchpad-dialog" aria-labelledby="scratchpad-title"
    onCancel={(event) => { event.preventDefault(); onClose(); }}
    onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) onClose(); } }}>
    <div className="scratchpad-shell">
      <header><h2 id="scratchpad-title">{t("scratchpad.title")}</h2><button type="button" onClick={onClose} aria-label={t("scratchpad.close")}>×</button></header>
      <p className="scratchpad-intro">{t("scratchpad.intro")}</p>
      <div className="scratchpad-editors">
        <NoteEditor controller={controllerFor(null)} session={false} open={open} />
        {sessionId ? <NoteEditor key={sessionId} controller={controllerFor(sessionId)} session open={open} />
          : <section className="scratchpad-note scratchpad-unavailable"><h3>{t("scratchpad.session")}</h3><p>{t("scratchpad.noSession")}</p></section>}
      </div>
      <footer>{t("scratchpad.undoHint")}</footer>
    </div>
  </dialog>;
}
