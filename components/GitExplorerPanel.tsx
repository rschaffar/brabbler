"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { deepActiveElement, panelTabStops } from "@/lib/panel-focus";
import { GitExplorer } from "./GitExplorer";
import { GitCommitViewer } from "./GitCommitViewer";
import type { ReviewNavigation } from "@/lib/review-notebook";

type SelectedCommit = { branch: string; head: string; oid: string };

/** Worktree-scoped, read-only history alongside chat. The detail never opens a file tab. */
export function GitExplorerPanel({ cwd, onClose, expanded, canExpand, onToggleExpanded, initialSelection, onReturnToWorkspace, onReadWork }: {
  cwd: string | null;
  onClose: () => void;
  expanded: boolean;
  canExpand: boolean;
  onToggleExpanded: () => void;
  initialSelection?: ReviewNavigation;
  onReturnToWorkspace?: () => void;
  onReadWork?: (work: Promise<void>) => void;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<SelectedCommit | null>(initialSelection ?? null);
  const [mobileDetail, setMobileDetail] = useState(Boolean(initialSelection));
  const panelRef = useRef<HTMLElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const clearSelection = () => { setSelected(null); setMobileDetail(false); };

  useEffect(() => { if (initialSelection) panelRef.current?.focus(); }, [initialSelection]);
  useEffect(() => {
    if (expanded || wasExpanded.current) {
      // CSS-only expansion keeps the reader mounted. Restore focus after inert clears.
      (expandRef.current ?? panelRef.current)?.focus();
    }
    wasExpanded.current = expanded;
  }, [expanded]);

  return <section ref={panelRef} tabIndex={-1} className="git-explorer-overview" role="region" aria-label="Git Explorer"
    onKeyDown={(event) => {
      if (!expanded || event.defaultPrevented || (event.target as HTMLElement).closest("dialog[open]")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation(); // Never reach the global running-agent abort shortcut.
        onToggleExpanded();
      } else if (event.key === "Tab") {
        const controls = panelTabStops(event.currentTarget);
        const first = controls[0], last = controls.at(-1), active = deepActiveElement(document);
        if (event.shiftKey && (active === first || active === event.currentTarget)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (active === last || active === event.currentTarget)) {
          event.preventDefault(); first?.focus();
        }
      }
    }}>
    <div className="activity-header">
      <div className="min-w-0">
        <h1>Git Explorer</h1>
        <small className="block truncate" title={cwd ?? undefined}>Read-only · {cwd ?? "Select a worktree"}</small>
      </div>
      <div className="git-explorer-header-actions">
        {canExpand && <button ref={expandRef} type="button" className="git-explorer-expand-button"
          onClick={onToggleExpanded} aria-controls="git-explorer-panel" aria-pressed={expanded}
          aria-label={t(expanded ? "gitExplorer.restore" : "gitExplorer.expand")}
          title={t(expanded ? "gitExplorer.restore" : "gitExplorer.expand")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={expanded
              ? "M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"
              : "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"} />
          </svg>
        </button>}
        <button type="button" className="activity-close" onClick={onClose} aria-label={t("gitExplorer.close")} title={t("gitExplorer.close")}>×</button>
      </div>
    </div>
    {onReturnToWorkspace && <div className="border-b border-border px-3 py-2 text-xs text-text-muted">
      {t("review.referencedRepository")}
      <button type="button" className="ml-2 text-accent underline" onClick={onReturnToWorkspace}>{t("review.returnHistory")}</button>
    </div>}
    {cwd ? <div className={`git-explorer-columns${mobileDetail ? " git-explorer-mobile-detail" : ""}`}>
      <div className="git-explorer-graph">
        <GitExplorer cwd={cwd} initialSelection={initialSelection} onReadWork={onReadWork} onBranchChange={clearSelection} onOpenCommit={(branch, head, oid) => {
          setSelected({ branch, head, oid });
          setMobileDetail(true);
        }} />
      </div>
      <div className="git-explorer-detail">
        <button type="button" className="git-explorer-back" onClick={() => setMobileDetail(false)}>← Back to commits</button>
        {selected ? <GitCommitViewer key={`${selected.branch}:${selected.head}:${selected.oid}`}
          cwd={cwd} branch={selected.branch} head={selected.head} oid={selected.oid} onReadWork={onReadWork} />
          : <p className="p-4 text-sm text-text-muted">Select a commit to inspect its files and patch.</p>}
      </div>
    </div> : <p className="p-4 text-sm text-text-muted">Select a worktree to browse its local branches.</p>}
  </section>;
}
