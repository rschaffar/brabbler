"use client";

import { useId, useLayoutEffect, useRef, useState, type FocusEvent, type FormEventHandler, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { deepActiveElement, panelTabStops } from "@/lib/panel-focus";

/** Presentation only. Each caller still owns its response and cancellation contract. */
export function BlockingCard({ title, label, meta, collapsed = false, collapsedLabel, retainBodyWhenCollapsed = true, onCollapse, onExpand, children, footer, onSubmit, allowFullscreen = false }: {
  title: string;
  allowFullscreen?: boolean;
  label?: string;
  meta?: ReactNode;
  collapsed?: boolean;
  collapsedLabel?: string;
  retainBodyWhenCollapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
  children: ReactNode;
  footer: ReactNode;
  onSubmit?: FormEventHandler<HTMLFormElement>;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [fullscreen, setFullscreen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fullscreenTriggerRef = useRef<HTMLButtonElement>(null);
  const previousFullscreenRef = useRef(fullscreen);
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const scroll = rootRef.current?.querySelector(".blocking-card-body")?.scrollTop ?? 0;
    if (dialog.open) dialog.close();
    if (!collapsed) {
      if (fullscreen) dialog.showModal(); else dialog.show();
    }
    const body = rootRef.current?.querySelector(".blocking-card-body");
    if (body) body.scrollTop = scroll;
    if (!collapsed && previousFullscreenRef.current !== fullscreen) fullscreenTriggerRef.current?.focus({ preventScroll: true });
    previousFullscreenRef.current = fullscreen;
    return () => { if (dialog.open) dialog.close(); };
  }, [fullscreen, collapsed]);
  const rootRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);
  const previousCollapsedRef = useRef(collapsed);
  useLayoutEffect(() => {
    if (previousCollapsedRef.current === collapsed) return;
    previousCollapsedRef.current = collapsed;
    if (collapsed) { triggerRef.current?.focus({ preventScroll: true }); return; }
    const previous = lastFocusedRef.current;
    if (previous && rootRef.current?.contains(previous) && previous.getClientRects().length && !previous.matches(":disabled")) {
      previous.focus({ preventScroll: true });
    } else {
      const target = rootRef.current?.querySelector<HTMLElement>("[data-extension-option], input:not(:disabled), textarea:not(:disabled), footer button:not(:disabled)")
        ?? rootRef.current?.querySelector<HTMLElement>(".blocking-card-collapse");
      target?.focus({ preventScroll: true });
    }
  }, [collapsed]);
  const rememberFocus = (event: FocusEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (!target.closest(".blocking-card-header")) lastFocusedRef.current = target;
  };
  const collapsedTrigger = collapsed && <button ref={triggerRef} type="button" className="blocking-card-collapsed" aria-expanded={false} onClick={onExpand}>
    <span className="blocking-card-label">{collapsedLabel ?? t("chat.extensionPending")}</span>
    <span className="blocking-card-summary">{title}</span>
    {meta}
    <span>{t("chat.extensionExpand")}</span>
  </button>;
  const content = <>
    <header className="blocking-card-header">
      <div className="min-w-0 flex-1">
        {label && <div className="blocking-card-label">{label}</div>}
        <div id={titleId} className="blocking-card-title">{title}</div>
        {meta && <div className="blocking-card-meta">{meta}</div>}
      </div>
      {allowFullscreen && <button ref={fullscreenTriggerRef} type="button" className="blocking-card-collapse" aria-pressed={fullscreen}
        aria-label={t(fullscreen ? "chat.restoreCard" : "chat.fullscreenCard")} title={t(fullscreen ? "chat.restoreCard" : "chat.fullscreenCard")}
        onClick={() => setFullscreen(!fullscreen)}>{fullscreen ? "↙" : "⛶"}</button>}
      {onCollapse && !fullscreen && <button type="button" className="blocking-card-collapse" aria-expanded={true}
        aria-label={t("chat.extensionCollapse")} title={t("chat.extensionCollapse")} onClick={onCollapse}>−</button>}
    </header>
    <div className="blocking-card-body">{(!collapsed || retainBodyWhenCollapsed) && children}</div>
    <footer className="blocking-card-footer">{footer}</footer>
  </>;
  // Live forms retain drafts and nested diff state; receipts opt out to unmount their bodies.
  const card = onSubmit
    ? <form ref={(element) => { rootRef.current = element; }} onFocusCapture={rememberFocus} hidden={collapsed} role="group" aria-label={title} aria-labelledby={titleId} className="blocking-card" onSubmit={onSubmit}>{content}</form>
    : <section ref={(element) => { rootRef.current = element; }} onFocusCapture={rememberFocus} hidden={collapsed} role="group" aria-label={title} aria-labelledby={titleId} className="blocking-card">{content}</section>;
  return <>{collapsedTrigger}{allowFullscreen ? <dialog ref={dialogRef} className={`blocking-card-dialog${fullscreen ? " is-fullscreen" : ""}`}
    role={fullscreen ? "dialog" : "presentation"} aria-label={fullscreen ? title : undefined}
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setFullscreen(false); }}
    onKeyDown={(event) => {
      if (!fullscreen || event.defaultPrevented || (event.target as HTMLElement).closest("dialog") !== event.currentTarget) return;
      if (event.key === "Escape" && !event.nativeEvent.isComposing) {
        event.preventDefault(); event.stopPropagation(); setFullscreen(false);
      } else if (event.key === "Tab") {
        const controls = panelTabStops(event.currentTarget), first = controls[0], last = controls.at(-1);
        const active = deepActiveElement(document);
        if (event.shiftKey && (active === first || active === event.currentTarget)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (active === last || active === event.currentTarget)) {
          event.preventDefault(); first?.focus();
        }
      }
    }}>{card}</dialog> : card}</>;
}
