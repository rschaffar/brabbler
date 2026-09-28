"use client";

import { useEffect, useMemo, useState } from "react";
import { getFiletypeFromFileName, parsePatchFiles, preloadHighlighter, type FileDiffMetadata } from "@pierre/diffs";
import { FileDiff } from "@pierre/diffs/react";
import { useTheme } from "@/hooks/useTheme";

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
  const { isDark } = useTheme();
  const [highlighterReady, setHighlighterReady] = useState(false);
  const [highlighterFailed, setHighlighterFailed] = useState(false);
  const { file, fallback } = useMemo((): { file: FileDiffMetadata | null; fallback: string | null } => {
    try {
      const patches = parsePatchFiles(patch, undefined, true);
      if (patches.length === 0 || (patches.length === 1 && patches[0].files.length === 0)) {
        return { file: null, fallback: null };
      }
      // The Git Explorer API returns one file per response; never silently drop extra files.
      if (patches.length !== 1 || patches[0].files.length !== 1) {
        return { file: null, fallback: "The patch could not be displayed as a diff; showing the raw patch." };
      }
      const parsed = patches[0].files[0];
      if (parsed.hunks.length === 0) return { file: null, fallback: null };
      const lineCount = parsed.hunks.reduce((sum, hunk) => sum + hunk.hunkContent.reduce(
        (total, content) => total + (content.type === "context" ? content.lines : content.additions + content.deletions), 0,
      ), 0);
      return lineCount > MAX_RENDERED_LINES
        ? { file: null, fallback: "Too many lines for the interactive diff; showing the complete raw patch." }
        : { file: parsed, fallback: null };
    } catch {
      return { file: null, fallback: "The patch could not be displayed as a diff; showing the raw patch." };
    }
  }, [patch]);
  useEffect(() => {
    setHighlighterReady(false);
    setHighlighterFailed(false);
    if (!file) return;
    let active = true;
    const langs = [getFiletypeFromFileName(file.prevName ?? file.name), getFiletypeFromFileName(file.name)];
    // Pierre renders nothing until its themes and language have loaded. Keep the raw patch visible meanwhile.
    void preloadHighlighter({ themes: ["pierre-light", "pierre-dark"], langs }).then(
      () => { if (active) setHighlighterReady(true); },
      () => { if (active) setHighlighterFailed(true); },
    );
    return () => { active = false; };
  }, [file]);
  const visibleView = file && highlighterReady ? view : "raw";

  return <div className="git-commit-diff mt-2 min-w-0 rounded border border-border bg-bg">
    {file && <div role="group" aria-label="Patch view" className="flex items-center gap-1 border-b border-border bg-bg-panel p-1 text-xs">
      {(["split", "unified", "raw"] as const).map((mode) => <button key={mode} type="button"
        aria-pressed={visibleView === mode} onClick={() => setView(mode)}
        className="rounded px-2 py-1 text-text-muted hover:bg-bg-hover aria-pressed:bg-bg-selected aria-pressed:text-text">
        {mode === "split" ? "Side by side" : mode === "unified" ? "Unified" : "Raw patch"}
      </button>)}
    </div>}
    {hasBinaryChanges && <p className="px-3 pt-2 text-xs text-text-muted">Binary changes are summarized; file contents are not shown.</p>}
    {(fallback || highlighterFailed) && <p className="px-3 pt-2 text-xs text-text-muted">{fallback || "The diff could not be highlighted; showing the raw patch."}</p>}
    {!file && !hasBinaryChanges && !fallback && <p className="px-3 pt-2 text-xs text-text-muted">No text hunks in this patch (metadata-only change).</p>}
    {visibleView === "raw" ? <pre className="overflow-auto p-3 font-mono text-xs text-text">{patch}</pre> :
      <div role="region" aria-label={visibleView === "split" ? "Side-by-side diff" : "Unified diff"} className="overflow-x-auto">
        {visibleView === "split" && <div className="git-commit-diff-headings flex border-b border-border bg-bg-panel text-xs text-text-muted">
          <span className="w-1/2 border-r border-border px-3 py-1">Before · {before}</span>
          <span className="w-1/2 px-3 py-1">After · {after}</span>
        </div>}
        {file?.hunks[0]?.hunkSpecs && <div aria-label="Patch hunk" className="border-b border-border bg-bg-panel px-2 py-1 font-mono text-xs text-text-muted">{file.hunks[0].hunkSpecs.trim()}</div>}
        <FileDiff fileDiff={file!} className={visibleView === "split" ? "git-commit-diff-file git-commit-diff-file-split" : "git-commit-diff-file"}
          options={{ diffStyle: visibleView, themeType: isDark ? "dark" : "light", disableFileHeader: true, hunkSeparators: "metadata", overflow: "wrap" }} />
      </div>}
  </div>;
}
