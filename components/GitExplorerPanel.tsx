"use client";

import { useState } from "react";
import { GitExplorer } from "./GitExplorer";
import { GitCommitViewer } from "./GitCommitViewer";

type SelectedCommit = { branch: string; head: string; oid: string };

/** Worktree-scoped, read-only history alongside chat. The detail never opens a file tab. */
export function GitExplorerPanel({ cwd, onClose }: { cwd: string | null; onClose: () => void }) {
  const [selected, setSelected] = useState<SelectedCommit | null>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const clearSelection = () => { setSelected(null); setMobileDetail(false); };

  return <section className="git-explorer-overview" role="region" aria-label="Git Explorer">
    <div className="activity-header">
      <div className="min-w-0">
        <h1>Git Explorer</h1>
        <small className="block truncate" title={cwd ?? undefined}>Read-only · {cwd ?? "Select a worktree"}</small>
      </div>
      <button type="button" className="activity-close" onClick={onClose} aria-label="Close Git Explorer" title="Close Git Explorer">×</button>
    </div>
    {cwd ? <div className={`git-explorer-columns${mobileDetail ? " git-explorer-mobile-detail" : ""}`}>
      <div className="git-explorer-graph">
        <GitExplorer cwd={cwd} onBranchChange={clearSelection} onOpenCommit={(branch, head, oid) => {
          setSelected({ branch, head, oid });
          setMobileDetail(true);
        }} />
      </div>
      <div className="git-explorer-detail">
        <button type="button" className="git-explorer-back" onClick={() => setMobileDetail(false)}>← Back to commits</button>
        {selected ? <GitCommitViewer key={`${selected.branch}:${selected.head}:${selected.oid}`}
          cwd={cwd} branch={selected.branch} head={selected.head} oid={selected.oid} />
          : <p className="p-4 text-sm text-text-muted">Select a commit to inspect its files and patch.</p>}
      </div>
    </div> : <p className="p-4 text-sm text-text-muted">Select a worktree to browse its local branches.</p>}
  </section>;
}
