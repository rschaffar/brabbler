"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { SCRATCHPAD_MAX_LENGTH, type ScratchpadProject, type ScratchpadScope } from "@/lib/scratchpad";
import { resolveScratchpadProject, ScratchpadController, type ScratchpadWorkObserver } from "@/lib/scratchpad-client";
import "./ScratchpadPanel.css";

function NoteEditor({ controller, project, open, projectRoot }: { controller: ScratchpadController; project: boolean; open: boolean; projectRoot?: string }) {
  const { t } = useI18n();
  const view = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const before = useRef({ start: 0, end: 0 });
  const composing = useRef(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const label = t(project ? "scratchpad.project" : "scratchpad.global");
  useEffect(() => {
    if (!open) return;
    void controller.refresh();
    const refresh = () => { if (document.visibilityState === "visible") void controller.refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [controller, open]);
  useEffect(() => {
    if (open && view.ready && !project) textarea.current?.focus();
  }, [open, view.ready, project]);
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
    <p className="scratchpad-hint">{t(project ? "scratchpad.projectHint" : "scratchpad.globalHint")}</p>
    {projectRoot && <p className="scratchpad-hint" style={{ overflowWrap: "anywhere" }} title={projectRoot}>{projectRoot}</p>}
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

export function ScratchpadPanel({ open, projectCwd, onClose, onWork }: { open: boolean; projectCwd: string | null; onClose: () => void; onWork?: ScratchpadWorkObserver }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<{ cwd: string; project: ScratchpadProject | null; failed: boolean } | null>(null);
  const [resolveKey, setResolveKey] = useState(0);
  const observeWork = useRef(onWork);
  observeWork.current = onWork;
  useEffect(() => {
    if (!open || !projectCwd) return;
    let current = true;
    setSelection({ cwd: projectCwd, project: null, failed: false });
    const work = (async () => {
      try {
        const project = await resolveScratchpadProject(projectCwd);
        if (current) setSelection({ cwd: projectCwd, project, failed: false });
      } catch {
        if (current) setSelection({ cwd: projectCwd, project: null, failed: true });
      }
    })();
    observeWork.current?.(work);
    return () => { current = false; };
  }, [open, projectCwd, resolveKey]);
  const current = selection?.cwd === projectCwd ? selection : null;
  const project = current?.project;
  const [controllers] = useState(() => new Map<string, ScratchpadController>());
  const controllerFor = (scope: ScratchpadScope) => {
    const key = JSON.stringify(scope);
    let controller = controllers.get(key);
    if (!controller) {
      let storage = null;
      try { storage = window.sessionStorage; } catch { /* Reported when a draft cannot be persisted. */ }
      controller = new ScratchpadController(scope, storage, undefined, onWork);
      controllers.set(key, controller);
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
        <NoteEditor controller={controllerFor(null)} project={false} open={open} />
        {projectCwd && project ? <NoteEditor key={project.projectId} controller={controllerFor({ projectId: project.projectId })} project projectRoot={project.root} open={open} />
          : <section className="scratchpad-note scratchpad-unavailable" aria-label={t("scratchpad.project")}><h3>{t("scratchpad.project")}</h3>
            <p role={current?.failed ? "alert" : "status"}>{t(!projectCwd ? "scratchpad.noProject" : current?.failed ? "scratchpad.projectError" : "scratchpad.loading")}</p>
            {projectCwd && current?.failed && <button type="button" onClick={() => setResolveKey(key => key + 1)}>{t("scratchpad.retry")}</button>}
          </section>}
      </div>
      <footer>{t("scratchpad.undoHint")}</footer>
    </div>
  </dialog>;
}
