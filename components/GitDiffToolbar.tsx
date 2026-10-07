"use client";

import type { GitDiffPreferences } from "@/lib/git-diff-preferences";

export function GitDiffToolbar({ view, wrap, onChange }: GitDiffPreferences & {
  onChange: (value: Partial<GitDiffPreferences>) => void;
}) {
  return <div className="flex flex-wrap items-center gap-2">
    <div role="group" aria-label="Patch view" className="flex flex-wrap gap-1">
      {(["split", "unified", "raw"] as const).map((mode) => <button type="button" key={mode}
        aria-pressed={view === mode} onClick={() => onChange({ view: mode })}
        className="git-diff-control">
        {mode === "split" ? "Side by side" : mode === "unified" ? "Unified" : "Raw patch"}
      </button>)}
    </div>
    <button type="button" className="git-diff-control" aria-pressed={wrap} onClick={() => onChange({ wrap: !wrap })}
      title={wrap ? "Use horizontal scrolling for long lines" : "Wrap long lines"}>Wrap lines</button>
  </div>;
}
