"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommittedPatchDiff } from "./CommittedPatchDiff";
import { GitDiffToolbar } from "./GitDiffToolbar";
import { ReviewFileBrowser } from "./ReviewFileBrowser";
import { useGitDiffPreferences } from "@/hooks/useGitDiffPreferences";
import { createDiffReview, type DiffReviewModel } from "@/lib/git-diff-review";
import { createPatchLoader, splitGitPatch, type DisplayFile, type DisplayPatch } from "@/lib/git-patch-display";
import type { DiffContext } from "@/lib/diff-context";
import type { GitDiffPreferences } from "@/lib/git-diff-preferences";

type ContextLoader = (id: string, signal: AbortSignal) => Promise<DiffContext>;
type ReviewModelFactory = (path: string, patch: string) => DiffReviewModel;
function ExpandedPatch({ file, load, loadContext, reviews, before, after, view, wrap, immediate, onReadWork, getReviewModel }: GitDiffPreferences & {
  file: DisplayFile; load?: (id: string, signal: AbortSignal) => Promise<DisplayPatch>;
  loadContext?: ContextLoader; reviews: Map<string, DiffReviewModel>;
  before: string; after: string; immediate: boolean; getReviewModel?: ReviewModelFactory;
  onReadWork?: (work: Promise<void>) => void;
}) {
  // Observation only: forward the original promise; its result is not consumed.
  const readObserver = useRef(onReadWork);
  readObserver.current = onReadWork;
  const observeRead = useCallback((work: Promise<unknown>) => { readObserver.current?.(work as Promise<void>); }, []);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(immediate);
  const [value, setValue] = useState(file.value);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(0);
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
    const controller = new AbortController(); setError(null);
    const work = load(file.id, controller.signal).then((patch) => {
      if (!controller.signal.aborted) setValue(patch);
    }, (cause) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Patch unavailable");
    });
    readObserver.current?.(work);
    return () => controller.abort();
  }, [file, load, visible, retry]);
  const review = useMemo(() => {
    if (!value) return undefined;
    if (getReviewModel) return getReviewModel(file.id, value.patch);
    let model = reviews.get(file.id);
    if (!model || model.patch !== value.patch) { model = createDiffReview(value.patch); reviews.set(file.id, model); }
    return model;
  }, [file.id, reviews, value, getReviewModel]);
  const context = useCallback((signal: AbortSignal) => loadContext!(file.id, signal), [loadContext, file.id]);
  return <div ref={ref} className="min-w-0 px-2 pb-2">
    {!visible ? <p className="py-3 text-xs text-text-muted">Diff renders when scrolled into view.</p>
      : error ? <div role="alert" className="py-2 text-xs text-text-muted">{error} <button type="button" className="text-accent underline" onClick={() => setRetry((value) => value + 1)}>Retry</button></div>
        : !value ? <p role="status" className="py-3 text-xs text-text-muted">Loading patch…</p>
          : <CommittedPatchDiff {...value} before={before} after={after} view={view} wrap={wrap} reviewModel={review} loadContext={loadContext ? context : undefined} onReadWork={observeRead} />}
  </div>;
}

/** Expanding or reading a file never changes the operation's approval scope. */
export function GitPatchStack({ files, before, after, loadPatch, loadContext, completePatch, navigation = false, onReadWork, getReviewModel }: {
  files: DisplayFile[]; before: string; after: string; navigation?: boolean;
  loadPatch?: (id: string, signal: AbortSignal) => Promise<DisplayPatch>;
  loadContext?: ContextLoader; completePatch?: string; getReviewModel?: ReviewModelFactory;
  onReadWork?: (work: Promise<void>) => void;
}) {
  const [expanded, setExpanded] = useState(() => new Set(files[0] ? [files[0].id] : []));
  const { view, wrap, setPreferences } = useGitDiffPreferences();
  const reviews = useRef(new Map<string, DiffReviewModel>());
  const readObserver = useRef(onReadWork);
  readObserver.current = onReadWork;
  const load = useMemo(() => loadPatch ? createPatchLoader(loadPatch, 3, work => readObserver.current?.(work)) : undefined, [loadPatch]);
  const context = useMemo(() => loadContext ? createPatchLoader(loadContext, 3, work => readObserver.current?.(work)) : undefined, [loadContext]);
  const totals = files.every((file) => file.additions !== undefined && file.deletions !== undefined)
    ? files.reduce((sum, file) => ({ additions: sum.additions + file.additions!, deletions: sum.deletions + file.deletions! }), { additions: 0, deletions: 0 }) : null;
  if (navigation) return <><ReviewFileBrowser files={files.map((file) => ({ id: file.id,
    label: file.previousPath && file.previousPath !== file.path ? `${file.previousPath} → ${file.path}` : file.path,
    description: `${file.status}${file.additions === undefined ? "" : ` · +${file.additions} −${file.deletions}`}` }))}>
    {(selected, preferences) => {
      const file = files.find((file) => file.id === selected.id)!;
      return <section aria-label={`File changes: ${file.path}`}>
        <p className="text-xs text-text-muted">{file.status}</p>
        <ExpandedPatch key={selected.id} file={file} load={load} loadContext={context} reviews={reviews.current}
          before={before} after={after} {...preferences} immediate onReadWork={onReadWork} getReviewModel={getReviewModel} />
      </section>;
    }}
  </ReviewFileBrowser>
    {completePatch !== undefined && <details className="mt-3 text-xs text-text-muted">
      <summary className="cursor-pointer font-medium">Complete raw patch</summary>
      <pre className="mt-2 overflow-x-auto font-mono text-xs text-text">{completePatch}</pre>
    </details>}
  </>;
  return <section aria-label="Changed files" className="min-w-0">
    <div className="git-patch-stack-toolbar">
      <h2 className="font-semibold">Changed files ({files.length})</h2>
      {totals && <span className="text-text-muted">+{totals.additions} −{totals.deletions}</span>}
      <GitDiffToolbar view={view} wrap={wrap} onChange={setPreferences} />
      <button type="button" className="text-accent hover:underline" onClick={() => setExpanded(new Set(files.map((file) => file.id)))}>Expand all files</button>
      <button type="button" className="text-accent hover:underline" onClick={() => setExpanded(new Set())}>Collapse all files</button>
    </div>
    <div className="grid min-w-0 gap-2">
      {files.map((file, index) => <section key={file.id} aria-label={`File changes: ${file.path}`} className="git-patch-file min-w-0 rounded border border-border">
        <button type="button" aria-expanded={expanded.has(file.id)} aria-label={`Toggle diff: ${file.path}`}
          className="git-patch-file-heading flex w-full min-w-0 items-start gap-2 rounded bg-bg-panel px-3 py-2 text-left text-xs hover:bg-bg-hover"
          onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(file.id)) next.delete(file.id); else next.add(file.id); return next; })}>
          <span aria-hidden="true" className="shrink-0 text-text-muted">{expanded.has(file.id) ? "▾" : "▸"}</span>
          <span className="shrink-0 text-text-muted">{file.status}</span>
          <span className="min-w-0 flex-1 break-all font-mono">{file.previousPath && file.previousPath !== file.path ? `${file.previousPath} → ` : ""}{file.path}</span>
          {file.additions !== undefined && <span className="shrink-0 text-text-muted">+{file.additions} −{file.deletions}</span>}
        </button>
        {expanded.has(file.id) && <ExpandedPatch file={file} load={load} loadContext={context} reviews={reviews.current}
          before={before} after={after} view={view} wrap={wrap} immediate={index === 0} onReadWork={onReadWork} getReviewModel={getReviewModel} />}
      </section>)}
    </div>
    {completePatch !== undefined && <details className="mt-3 text-xs text-text-muted">
      <summary className="cursor-pointer font-medium">Complete raw patch</summary>
      <pre className="mt-2 overflow-x-auto font-mono text-xs text-text">{completePatch}</pre>
    </details>}
  </section>;
}

export function SuppliedPatchStack({ patch, before, after, contextHandle, pluginId, navigation = false, onReadWork }: {
  patch: string; before: string; after: string; contextHandle?: string; pluginId?: string; navigation?: boolean;
  onReadWork?: (work: Promise<void>) => void;
}) {
  const files = useMemo(() => { try { return splitGitPatch(patch); } catch { return null; } }, [patch]);
  const loadContext = useCallback(async (id: string, signal: AbortSignal): Promise<DiffContext> => {
    const response = await fetch(`/api/plugins/bundled/${encodeURIComponent(pluginId!)}/patch-context?${new URLSearchParams({ handle: contextHandle!, file: id })}`, { signal, cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Full-file context unavailable");
    return body;
  }, [contextHandle, pluginId]);
  return files ? <GitPatchStack key={`${contextHandle ?? "patch"}:${patch}`} files={files} before={before} after={after} completePatch={patch} navigation={navigation}
    loadContext={contextHandle && pluginId ? loadContext : undefined} onReadWork={onReadWork} />
    : <div className="min-w-0 text-xs">
      <p className="mb-2 text-text-muted">The patch could not be separated into files; showing the complete raw patch.</p>
      <pre role="region" aria-label="Raw patch" className="overflow-x-auto font-mono">{patch}</pre>
    </div>;
}
