"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CommittedPatchDiff, type PatchView } from "./CommittedPatchDiff";
import { createPatchLoader, splitGitPatch, type DisplayFile, type DisplayPatch } from "@/lib/git-patch-display";

function ExpandedPatch({ file, load, before, after, view, immediate }: {
  file: DisplayFile;
  load?: (id: string, signal: AbortSignal) => Promise<DisplayPatch>;
  before: string;
  after: string;
  view: PatchView;
  immediate: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(immediate);
  const [value, setValue] = useState(file.value);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (visible) return;
    if (!ref.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [visible]);
  useEffect(() => {
    if (!visible || file.value || !load) return;
    const controller = new AbortController();
    setError(null);
    void load(file.id, controller.signal).then((patch) => {
      if (!controller.signal.aborted) setValue(patch);
    }, (cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Patch unavailable");
    });
    return () => controller.abort();
  }, [file, load, visible, retry]);
  return <div ref={ref} className="min-w-0 px-2 pb-2">
    {!visible ? <p className="py-3 text-xs text-text-muted">Diff renders when scrolled into view.</p>
      : error ? <div role="alert" className="py-2 text-xs text-text-muted">{error} <button type="button" className="text-accent underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
        : !value ? <p role="status" className="py-3 text-xs text-text-muted">Loading patch…</p>
          : <CommittedPatchDiff {...value} before={before} after={after} view={view} />}
  </div>;
}

/** Presentation only: expanding a file never changes the operation's approval scope. */
export function GitPatchStack({ files, before, after, loadPatch, completePatch }: {
  files: DisplayFile[];
  before: string;
  after: string;
  loadPatch?: (id: string, signal: AbortSignal) => Promise<DisplayPatch>;
  completePatch?: string;
}) {
  const [expanded, setExpanded] = useState(() => new Set(files[0] ? [files[0].id] : []));
  const [view, setView] = useState<PatchView>("split");
  const load = useMemo(() => loadPatch ? createPatchLoader(loadPatch) : undefined, [loadPatch]);
  const totals = files.every((file) => file.additions !== undefined && file.deletions !== undefined)
    ? files.reduce((sum, file) => ({ additions: sum.additions + file.additions!, deletions: sum.deletions + file.deletions! }), { additions: 0, deletions: 0 }) : null;
  return <section aria-label="Changed files" className="min-w-0">
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      <h2 className="font-semibold">Changed files ({files.length})</h2>
      {totals && <span className="text-text-muted">+{totals.additions} −{totals.deletions}</span>}
      <div role="group" aria-label="Patch view" className="flex flex-wrap gap-1">
        {(["split", "unified", "raw"] as const).map((mode) => <button type="button" key={mode} aria-pressed={view === mode}
          onClick={() => setView(mode)} className="rounded px-2 py-1 text-text-muted hover:bg-bg-hover aria-pressed:bg-bg-selected aria-pressed:text-text">
          {mode === "split" ? "Side by side" : mode === "unified" ? "Unified" : "Raw patch"}
        </button>)}
      </div>
      <button type="button" className="text-accent hover:underline" onClick={() => setExpanded(new Set(files.map((file) => file.id)))}>Expand all</button>
      <button type="button" className="text-accent hover:underline" onClick={() => setExpanded(new Set())}>Collapse all</button>
    </div>
    <div className="grid min-w-0 gap-2">
      {files.map((file, index) => <section key={file.id} aria-label={`File changes: ${file.path}`} className="min-w-0 rounded border border-border">
        <button type="button" aria-expanded={expanded.has(file.id)} aria-label={`Toggle diff: ${file.path}`}
          className="flex w-full min-w-0 items-start gap-2 rounded bg-bg-panel px-3 py-2 text-left text-xs hover:bg-bg-hover"
          onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(file.id)) next.delete(file.id); else next.add(file.id); return next; })}>
          <span aria-hidden="true" className="shrink-0 text-text-muted">{expanded.has(file.id) ? "▾" : "▸"}</span>
          <span className="shrink-0 text-text-muted">{file.status}</span>
          <span className="min-w-0 flex-1 break-all font-mono">{file.previousPath && file.previousPath !== file.path ? `${file.previousPath} → ` : ""}{file.path}</span>
          {file.additions !== undefined && <span className="shrink-0 text-text-muted">+{file.additions} −{file.deletions}</span>}
        </button>
        {expanded.has(file.id) && <ExpandedPatch file={file} load={load} before={before} after={after} view={view} immediate={index === 0} />}
      </section>)}
    </div>
    {completePatch !== undefined && <details className="mt-3 text-xs text-text-muted">
      <summary className="cursor-pointer font-medium">Complete raw patch</summary>
      <pre className="mt-2 overflow-x-auto font-mono text-xs text-text">{completePatch}</pre>
    </details>}
  </section>;
}

export function SuppliedPatchStack({ patch, before, after }: { patch: string; before: string; after: string }) {
  const files = useMemo(() => { try { return splitGitPatch(patch); } catch { return null; } }, [patch]);
  return files ? <GitPatchStack key={patch} files={files} before={before} after={after} completePatch={patch} />
    : <div className="min-w-0 text-xs">
      <p className="mb-2 text-text-muted">The patch could not be separated into files; showing the complete raw patch.</p>
      <pre role="region" aria-label="Raw patch" className="overflow-x-auto font-mono">{patch}</pre>
    </div>;
}
