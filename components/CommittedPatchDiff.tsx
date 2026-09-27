"use client";

import { useMemo, useState } from "react";
import { Decoration, Diff, Hunk, parseDiff } from "react-diff-view";

type View = "split" | "unified" | "raw";
const MAX_RENDERED_LINES = 2500;

/** A presentation-only adapter over the existing bounded, first-parent Git patch. */
export function CommittedPatchDiff({ patch, hasBinaryChanges, before, after }: {
  patch: string;
  hasBinaryChanges: boolean;
  before: string;
  after: string;
}) {
  const [view, setView] = useState<View>("split");
  const { files, fallback } = useMemo(() => {
    try {
      const parsed = parseDiff(patch, { nearbySequences: "zip" }).filter((file) => file.hunks.length > 0);
      const lineCount = parsed.reduce((sum, file) => sum + file.hunks.reduce((total, hunk) => total + hunk.changes.length, 0), 0);
      return lineCount > MAX_RENDERED_LINES ? { files: [], fallback: "Too many lines for the interactive diff; showing the complete raw patch." }
        : { files: parsed, fallback: null };
    } catch { return { files: [], fallback: "The patch could not be displayed as a diff; showing the raw patch." }; }
  }, [patch]);
  const hasTextHunks = files.length > 0;
  const visibleView = hasTextHunks ? view : "raw";

  return <div className="git-commit-diff mt-2 min-w-0 rounded border border-border bg-bg">
    {hasTextHunks && <div role="group" aria-label="Patch view" className="flex items-center gap-1 border-b border-border bg-bg-panel p-1 text-xs">
      {(["split", "unified", "raw"] as const).map((mode) => <button key={mode} type="button"
        aria-pressed={visibleView === mode} onClick={() => setView(mode)}
        className="rounded px-2 py-1 text-text-muted hover:bg-bg-hover aria-pressed:bg-bg-selected aria-pressed:text-text">
        {mode === "split" ? "Side by side" : mode === "unified" ? "Unified" : "Raw patch"}
      </button>)}
    </div>}
    {hasBinaryChanges && <p className="px-3 pt-2 text-xs text-text-muted">Binary changes are summarized; file contents are not shown.</p>}
    {fallback && <p className="px-3 pt-2 text-xs text-text-muted">{fallback}</p>}
    {!hasTextHunks && !hasBinaryChanges && !fallback && <p className="px-3 pt-2 text-xs text-text-muted">No text hunks in this patch (metadata-only change).</p>}
    {visibleView === "raw" ? <pre className="overflow-auto p-3 font-mono text-xs text-text">{patch}</pre> :
      <div role="region" aria-label={visibleView === "split" ? "Side-by-side diff" : "Unified diff"} className="overflow-x-auto">
        {files.map((file, fileIndex) => <div key={fileIndex} className="min-w-0">
          {visibleView === "split" && <div className="git-commit-diff-headings flex border-b border-border bg-bg-panel text-xs text-text-muted">
            <span className="w-1/2 border-r border-border px-3 py-1">Before · {before}</span>
            <span className="w-1/2 px-3 py-1">After · {after}</span>
          </div>}
          <Diff viewType={visibleView} diffType={file.type} hunks={file.hunks}>
            {(hunks) => hunks.flatMap((hunk, index) => [
              <Decoration key={`label-${index}`}><span className="block bg-bg-panel px-2 py-1 text-xs text-text-muted">{hunk.content}</span></Decoration>,
              <Hunk key={`hunk-${index}`} hunk={hunk} />,
            ])}
          </Diff>
        </div>)}
      </div>}
  </div>;
}
