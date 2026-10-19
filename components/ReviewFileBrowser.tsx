"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useGitDiffPreferences } from "@/hooks/useGitDiffPreferences";
import type { GitDiffPreferences } from "@/lib/git-diff-preferences";
import { GitDiffToolbar } from "./GitDiffToolbar";

export interface ReviewFile { id: string; label: string; description?: string }

/** Display navigation only: selection never changes the reviewed operation. */
export function ReviewFileBrowser({ files, children, pagination, hasPatches = true, paged = false }: {
  files: ReviewFile[];
  children: (file: ReviewFile, preferences: GitDiffPreferences) => ReactNode;
  pagination?: ReactNode; hasPatches?: boolean; paged?: boolean;
}) {
  const { t } = useI18n();
  const preferences = useGitDiffPreferences();
  const [selectedId, setSelectedId] = useState(files[0]?.id);
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  const selected = files.find((file) => file.id === selectedId) ?? files[0];
  const index = selected ? files.indexOf(selected) : -1;
  const matching = files.filter((file) => `${file.label} ${file.description ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (drawer && !element.open) element.showModal();
    if (!drawer && element.open) { element.close(); trigger.current?.focus({ preventScroll: true }); }
    return () => {
      if (!element.open) return;
      element.close();
      // The selected reader stays visible even when a resize hides the trigger/sidebar.
      const target = trigger.current?.getClientRects().length ? trigger.current : root.current?.querySelector<HTMLElement>(".review-file-content");
      target?.focus({ preventScroll: true });
    };
  }, [drawer]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width >= 760) setDrawer(false); });
    observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const select = (id: string) => { setSelectedId(id); setDrawer(false); };
  const list = (mobile: boolean) => <nav aria-label={t("review.fileNavigation")} className="review-file-list">
    <input type="search" autoFocus={mobile} aria-label={t(paged ? "review.filterPage" : "review.filterFiles")}
      placeholder={t(paged ? "review.filterPage" : "review.filterFiles")} value={query} onChange={(event) => setQuery(event.target.value)} />
    {matching.map((file) => <button key={file.id} type="button" aria-current={file.id === selected?.id ? "true" : undefined}
      aria-label={t("review.openFile", { path: file.label })} onClick={() => select(file.id)}>
      <span className="font-mono break-all">{file.label}</span>
      {file.description && <span className="text-text-muted">{file.description}</span>}
    </button>)}
    {!matching.length && <p role="status">{t("review.noMatchingFiles")}</p>}
  </nav>;
  return <section ref={root} aria-label={t("review.changedFiles")} className="review-file-browser">
    <div className="review-file-toolbar">
      <strong>{t(paged ? "review.pageEntries" : "review.fileCount", { count: files.length })}</strong>
      {hasPatches && <GitDiffToolbar view={preferences.view} wrap={preferences.wrap} onChange={preferences.setPreferences} />}
      <div className="review-file-navigation">
        <button ref={trigger} type="button" className="git-diff-control review-files-trigger" aria-haspopup="dialog"
          aria-expanded={drawer} onClick={() => setDrawer(true)}>{t("review.filesButton", { count: files.length })}</button>
        <span className="min-w-0 flex-1 break-all font-mono" aria-live="polite">{selected?.label}</span>
        <button type="button" className="git-diff-control" aria-label={t("review.previousFile")} disabled={index <= 0}
          onClick={() => select(files[index - 1].id)}>←</button>
        <span>{index + 1}/{files.length}</span>
        <button type="button" className="git-diff-control" aria-label={t("review.nextFile")} disabled={index < 0 || index >= files.length - 1}
          onClick={() => select(files[index + 1].id)}>→</button>
      </div>
      {paged && pagination && <div className="flex flex-wrap gap-3">{pagination}</div>}
    </div>
    <div className="review-file-layout">
      <div className="review-file-sidebar">{list(false)}</div>
      <div className="review-file-content" tabIndex={-1}>{selected && children(selected, preferences)}</div>
    </div>
    <dialog ref={dialog} className="review-file-drawer" aria-label={t("review.fileNavigation")}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setDrawer(false); }}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setDrawer(false); } }}>
      <header className="flex items-center justify-between gap-3"><strong>{t("review.filesButton", { count: files.length })}</strong>
        <button type="button" className="git-diff-control" onClick={() => setDrawer(false)}>{t("review.closeFiles")}</button></header>
      {list(true)}
    </dialog>
  </section>;
}
