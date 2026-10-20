"use client";
import { createContext, useContext, useRef, useEffect, type ComponentProps, type ReactNode } from "react";
import { shouldOpenLocalFileInApp, type FileLineTarget, type OpenFileLink } from "@/lib/file-links";
import type { FileDisposition } from "@/lib/file-workspace";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";

export const FileLinkMenuContext = createContext<{ groups: { id: string; label: string }[]; canSplit: boolean; contextKey?: string }>({ groups: [], canSplit: false });
export function LocalFileLink({ href, filePath, page, lineTarget, onOpenFile, children, ...props }:
  Omit<ComponentProps<"a">, "onClick"> & { filePath: string; page?: number; lineTarget?: FileLineTarget; onOpenFile: OpenFileLink; children: ReactNode }) {
  const { t } = useI18n();
  const choices = useContext(FileLinkMenuContext);
  const dialog = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const held = useRef(false);
  const openingContext = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (dialog.current?.open && openingContext.current !== choices.contextKey) dialog.current.close();
  }, [choices.contextKey]);
  useEffect(() => () => clearTimeout(timer.current), []);
  const stopTimer = () => { clearTimeout(timer.current); };
  const show = () => { openingContext.current = choices.contextKey; if (!dialog.current?.open) dialog.current?.showModal(); };
  const open = (disposition: FileDisposition) => {
    dialog.current?.close();
    if (openingContext.current === choices.contextKey) onOpenFile(filePath, page, lineTarget, disposition);
  };
  return <span className="local-file-link">
    <a {...props} href={href} onClick={event => {
      if (held.current) { event.preventDefault(); held.current = false; return; }
      if (!shouldOpenLocalFileInApp(event)) return;
      const target = event.currentTarget.getAttribute("target");
      if (target && target !== "_self") return;
      event.preventDefault(); onOpenFile(filePath, page, lineTarget);
    }} onContextMenu={event => { event.preventDefault(); show(); }}
      onKeyDown={event => { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); show(); } }}
      onPointerDown={event => { held.current = false; if (event.pointerType !== "mouse") timer.current = setTimeout(() => { held.current = true; show(); }, 550); }}
      onPointerUp={stopTimer} onPointerCancel={stopTimer} onPointerMove={stopTimer}>
      {children}
    </a>
    <button type="button" className="local-file-link-actions" aria-label={t("workspace.linkActions")} onClick={show}>⋯</button>
    <dialog ref={dialog} className="file-link-dialog" aria-label={t("workspace.linkActions")}
      onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); dialog.current?.close(); } }}>
      <div className="file-workspace-menu">
        <button type="button" onClick={() => open({ kind: "here" })}>{t("workspace.openHere")}</button>
        {choices.groups.map(group => <button type="button" key={group.id} onClick={() => open({ kind: "group", id: group.id })}>{t("workspace.openIn", { pane: group.label })}</button>)}
        {choices.canSplit && <>
          <button type="button" onClick={() => open({ kind: "split", axis: "right" })}>{t("workspace.openRight")}</button>
          <button type="button" onClick={() => open({ kind: "split", axis: "below" })}>{t("workspace.openBelow")}</button>
        </>}
        <button type="button" onClick={() => { void copyText(href ?? filePath); dialog.current?.close(); }}>{t("workspace.copyLink")}</button>
        <button type="button" onClick={() => dialog.current?.close()}>{t("i18n.cancel")}</button>
      </div>
    </dialog>
  </span>;
}
