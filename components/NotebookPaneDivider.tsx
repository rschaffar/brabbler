"use client";

import { useCallback, useEffect, useRef, type PointerEvent } from "react";
import { useI18n } from "@/hooks/useI18n";

export const NOTEBOOK_DEFAULT_SHARE = 33;

/** Presentation only: no storage, document-wide listeners or reader remounts. */
export function NotebookPaneDivider({ value, onChange, controls, hidden }: {
  value: number; onChange: (value: number) => void; controls: string; hidden: boolean;
}) {
  const { t } = useI18n();
  const drag = useRef<{ id: number; x: number; value: number; width: number } | null>(null);
  const element = useRef<HTMLDivElement>(null);
  const change = (next: number) => onChange(Math.max(20, Math.min(80, Math.round(next))));
  const release = useCallback((target: HTMLDivElement, cancel = false) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    if (cancel) onChange(current.value);
    if (target.hasPointerCapture(current.id)) target.releasePointerCapture(current.id);
  }, [onChange]);
  const finish = (event: PointerEvent<HTMLDivElement>, cancel = false) => {
    if (drag.current?.id === event.pointerId) release(event.currentTarget, cancel);
  };
  useEffect(() => { if (hidden && element.current) release(element.current, true); }, [hidden, release]);
  useEffect(() => {
    const target = element.current;
    if (!target) return;
    // Container queries can remove the divider while it owns capture.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      if (entries.some(entry => entry.contentRect.width === 0)) release(target, true);
    });
    observer?.observe(target);
    return () => { observer?.disconnect(); release(target); };
  }, [release]);
  return <div ref={element} className="guided-pane-divider" role="separator" tabIndex={0} hidden={hidden}
    onBlur={event => release(event.currentTarget, true)}
    aria-label={t("notebook.resize")} aria-orientation="vertical" aria-controls={controls}
    aria-valuemin={20} aria-valuemax={80} aria-valuenow={value} aria-valuetext={t("notebook.share", { value })}
    title={t("notebook.resizeHelp")}
    onPointerDown={event => {
      if (!event.isPrimary || event.button !== 0 || drag.current) return;
      const width = (event.currentTarget.parentElement?.getBoundingClientRect().width ?? 0) - event.currentTarget.getBoundingClientRect().width;
      if (width <= 0) return;
      event.preventDefault(); event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, x: event.clientX, value, width };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      if (event.pointerType === "mouse" && event.buttons === 0) { finish(event); return; }
      event.preventDefault();
      change(current.value + (event.clientX - current.x) * 100 / current.width);
    }}
    onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)}
    onLostPointerCapture={event => finish(event)}
    onDoubleClick={() => change(NOTEBOOK_DEFAULT_SHARE)}
    onKeyDown={event => {
      if (event.key === "Escape" && drag.current) {
        release(event.currentTarget, true);
      } else if (event.key === "ArrowLeft") change(value - (event.shiftKey ? 10 : 2));
      else if (event.key === "ArrowRight") change(value + (event.shiftKey ? 10 : 2));
      else if (event.key === "Home") change(20);
      else if (event.key === "End") change(80);
      else if (event.key === "Enter") change(NOTEBOOK_DEFAULT_SHARE);
      else return;
      event.preventDefault(); event.stopPropagation();
    }} />;
}
