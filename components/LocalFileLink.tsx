"use client";
import { createContext, useContext, useRef, useEffect, useLayoutEffect, useState, useCallback, useId, type ComponentProps, type ReactNode } from "react";
import { shouldOpenLocalFileInApp, type FileLineTarget, type OpenFileLink } from "@/lib/file-links";
import { fileLinkAnchor, fileLinkPopoverPosition } from "@/lib/file-link-popover";
import type { FileDisposition } from "@/lib/file-workspace";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";

export const FileLinkMenuContext = createContext<{ groups: { id: string; label: string }[]; canSplit: boolean; contextKey?: string }>({ groups: [], canSplit: false });
export function LocalFileLink({ href, filePath, page, lineTarget, onOpenFile, children, ...props }:
  Omit<ComponentProps<"a">, "onClick"> & { filePath: string; page?: number; lineTarget?: FileLineTarget; onOpenFile: OpenFileLink; children: ReactNode }) {
  const { t } = useI18n();
  const choices = useContext(FileLinkMenuContext);
  const anchor = useRef<HTMLAnchorElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const id = useId();
  const [active, setActive] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const dismissed = useRef(false);
  const pointerType = useRef("mouse");
  const pointer = useRef<{ x: number; y: number } | undefined>(undefined);
  const touchStart = useRef<{ x: number; y: number } | undefined>(undefined);
  const focusPending = useRef(false);
  const keyboardAnchor = useRef(false);
  const identity = JSON.stringify([choices.contextKey, filePath, href, page, lineTarget?.line, lineTarget?.endLine, lineTarget?.column]);
  const currentIdentity = useRef(identity);
  currentIdentity.current = identity;
  const openingIdentity = useRef<string | undefined>(undefined);
  const clearTimers = useCallback(() => {
    clearTimeout(hoverTimer.current); clearTimeout(leaveTimer.current); clearTimeout(holdTimer.current);
  }, []);
  const close = useCallback((restoreFocus = false) => {
    clearTimers(); dismissed.current = true; focusPending.current = false;
    if (popup.current?.matches(":popover-open")) popup.current.hidePopover();
    setActive(false); setExpanded(false);
    if (restoreFocus && anchor.current?.isConnected && anchor.current.getClientRects().length) anchor.current.focus({ preventScroll: true });
    // Native hiding can briefly restore focus outside this wrapper before our return focus.
    queueMicrotask(() => { dismissed.current = false; });
  }, [clearTimers]);
  const show = (more = false, focus = false) => {
    if (currentIdentity.current !== identity || !popup.current?.showPopover || !anchor.current?.getClientRects().length) return;
    clearTimers(); dismissed.current = false; openingIdentity.current = identity; focusPending.current = focus;
    setExpanded(more); setActive(true);
    for (const other of document.querySelectorAll<HTMLElement>(".file-link-hover:popover-open")) if (other !== popup.current) other.hidePopover();
    if (!popup.current.matches(":popover-open")) { popup.current.style.visibility = "hidden"; popup.current.showPopover(); }
  };
  const previousIdentity = useRef(identity);
  useEffect(() => {
    if (previousIdentity.current !== identity) { close(); previousIdentity.current = identity; }
  }, [identity, close]);
  useEffect(() => () => clearTimers(), [clearTimers]);

  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    const measure = () => {
      const link = anchor.current, element = popup.current;
      const modal = document.querySelector("dialog:modal");
      if (!link || !element || !link.isConnected || openingIdentity.current !== currentIdentity.current
        || link.closest("[hidden], [inert]") || (modal && !modal.contains(link))) { close(); return; }
      const visual = window.visualViewport;
      const viewport = { left: visual?.offsetLeft ?? 0, top: visual?.offsetTop ?? 0,
        width: visual?.width ?? innerWidth, height: visual?.height ?? innerHeight };
      const rect = fileLinkAnchor([...link.getClientRects()], viewport, pointer.current);
      if (!rect) { close(); return; }
      element.style.maxWidth = `${Math.max(0, viewport.width - 16)}px`;
      element.style.maxHeight = `${Math.max(0, viewport.height - 16)}px`;
      const position = fileLinkPopoverPosition(rect, element.getBoundingClientRect(), viewport);
      element.style.left = `${position.left}px`; element.style.top = `${position.top}px`; element.style.visibility = "visible";
      if (focusPending.current) { focusPending.current = false; element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true }); }
      frame = requestAnimationFrame(measure);
    };
    measure();
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node) && document.activeElement !== anchor.current
        && !popup.current?.contains(document.activeElement)) close();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !popup.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      const modal = document.querySelector("dialog:modal");
      if (event.key !== "Escape" || !popup.current?.matches(":popover-open") || (modal && !modal.contains(anchor.current))) return;
      const ownsFocus = document.activeElement === anchor.current || !!popup.current?.contains(document.activeElement);
      if (event.isComposing || (!ownsFocus && (event.target as HTMLElement)?.closest?.("input, textarea, [contenteditable='true']"))) { close(); return; }
      event.preventDefault(); event.stopImmediatePropagation(); close(ownsFocus);
    };
    const observer = new IntersectionObserver(entries => { if (!entries[0]?.isIntersecting) close(); });
    if (anchor.current) observer.observe(anchor.current);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("scroll", scroll, true); window.removeEventListener("pointerdown", outside, true); window.removeEventListener("keydown", escape, true); };
  }, [active, expanded, close]);

  const open = (disposition: FileDisposition) => {
    const valid = openingIdentity.current === currentIdentity.current;
    close(true);
    if (valid) onOpenFile(filePath, page, lineTarget, disposition);
  };
  const leave = () => {
    clearTimeout(hoverTimer.current);
    leaveTimer.current = setTimeout(() => {
      if (!popup.current?.contains(document.activeElement) && !(keyboardAnchor.current && document.activeElement === anchor.current)) close();
    }, 220);
  };
  return <span className="local-file-link" onBlurCapture={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
  }}>
    <a {...props} ref={anchor} href={href} aria-controls={id} aria-expanded={active} aria-keyshortcuts="Shift+F10"
      onPointerEnter={event => {
        if (event.pointerType === "touch") return;
        clearTimeout(leaveTimer.current); dismissed.current = false; keyboardAnchor.current = false;
        pointer.current = { x: event.clientX, y: event.clientY };
        hoverTimer.current = setTimeout(() => show(), 180);
      }} onPointerLeave={leave}
      onFocus={event => {
        if (!dismissed.current && event.currentTarget.matches(":focus-visible")) { keyboardAnchor.current = true; pointer.current = undefined; show(); }
      }}
      onClick={event => {
        if (held.current) { held.current = false; if (event.detail > 0) { event.preventDefault(); return; } }
        if (!shouldOpenLocalFileInApp(event)) return;
        const target = event.currentTarget.getAttribute("target");
        if (target && target !== "_self") return;
        event.preventDefault(); close(); onOpenFile(filePath, page, lineTarget);
      }} onContextMenu={event => {
        if (!popup.current?.showPopover) return;
        event.preventDefault(); const touch = pointerType.current !== "mouse"; if (touch) held.current = true; show(!touch, true);
      }} onKeyDown={event => {
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10") || (event.altKey && event.key === "ArrowDown")) {
          event.preventDefault(); pointer.current = undefined; show(true, true);
        }
      }} onPointerDown={event => {
        held.current = false; keyboardAnchor.current = false; pointerType.current = event.pointerType;
        pointer.current = { x: event.clientX, y: event.clientY }; touchStart.current = pointer.current;
        if (event.pointerType !== "mouse") holdTimer.current = setTimeout(() => { held.current = true; show(false, true); }, 550);
      }} onPointerUp={() => clearTimeout(holdTimer.current)} onPointerCancel={() => clearTimeout(holdTimer.current)}
      onPointerMove={event => {
        if (touchStart.current && Math.hypot(event.clientX - touchStart.current.x, event.clientY - touchStart.current.y) > 8) clearTimeout(holdTimer.current);
        if (event.pointerType === "mouse") pointer.current = { x: event.clientX, y: event.clientY };
      }}>
      {children}
    </a>
    {/* Manual light dismissal avoids native auto-popover dismissal when a held touch is released. */}
    <span ref={popup} id={id} popover="manual" role="toolbar" className="file-link-hover" aria-label={t("workspace.linkActions")}
      onBeforeToggle={event => { if (event.newState === "closed") { dismissed.current = true; queueMicrotask(() => { dismissed.current = false; }); } }}
      onToggle={() => { if (!popup.current?.matches(":popover-open")) { clearTimers(); setActive(false); setExpanded(false); } }}
      onPointerEnter={() => { clearTimeout(leaveTimer.current); clearTimeout(hoverTimer.current); }} onPointerLeave={leave}
      onKeyDown={event => {
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].filter(button => button.getClientRects().length);
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : event.key === "ArrowRight" ? (index + 1) % buttons.length : event.key === "ArrowLeft" ? (index - 1 + buttons.length) % buttons.length : undefined;
        if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
      }}>
      {active && <>
        <span className="file-link-hover-bar">
          <button type="button" aria-label={t("workspace.openHere")} title={t("workspace.openHere")} onClick={() => open({ kind: "here" })}>{t("workspace.hoverHere")}</button>
          <button type="button" disabled={!choices.canSplit} aria-label={t("workspace.openRight")} title={t("workspace.openRight")} onClick={() => open({ kind: "split", axis: "right" })}>▥ {t("workspace.hoverRight")}</button>
          <button type="button" disabled={!choices.canSplit} aria-label={t("workspace.openBelow")} title={t("workspace.openBelow")} onClick={() => open({ kind: "split", axis: "below" })}>▤ {t("workspace.hoverBelow")}</button>
          <button type="button" aria-label={t("workspace.moreActions")} aria-expanded={expanded} aria-controls={expanded ? `${id}-more` : undefined} onClick={() => setExpanded(value => !value)}>{t("workspace.hoverMore")} ⋯</button>
        </span>
        <span id={`${id}-more`} className="file-link-hover-more" hidden={!expanded} role="group" aria-label={t("workspace.moreActions")}>
          {choices.groups.map(group => <button type="button" key={group.id} onClick={() => open({ kind: "group", id: group.id })}>{t("workspace.openIn", { pane: group.label })}</button>)}
          <button type="button" onClick={() => { void copyText(href ?? filePath); close(true); }}>{t("workspace.copyLink")}</button>
        </span>
      </>}
    </span>
  </span>;
}
