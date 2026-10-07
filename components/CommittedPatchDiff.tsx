"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getFiletypeFromFileName, preloadHighlighter, type FileDiffContentsLoader } from "@pierre/diffs";
import { CodeView, type CodeViewHandle, type CodeViewReactOptions } from "@pierre/diffs/react";
import type { LoadDiffContext } from "@/lib/diff-context";
import { createDiffReview, matchingLines, rememberExpansion, validLine, validateReviewContext,
  type DiffLineTarget, type DiffReviewModel, type ReadingMode } from "@/lib/git-diff-review";
import type { PatchView } from "@/lib/git-diff-preferences";
import { useGitDiffPreferences } from "@/hooks/useGitDiffPreferences";
import { useTheme } from "@/hooks/useTheme";
import { GitDiffToolbar } from "./GitDiffToolbar";
export type { PatchView } from "@/lib/git-diff-preferences";

const GAP_CSS = `[data-expand-all-button] { display: flex !important; }`;

/** Display only: the original patch and its approval scope never change. */
export function CommittedPatchDiff({ patch, hasBinaryChanges, before, after, independentScroll = false,
  view: controlledView, wrap: controlledWrap, reviewModel, loadContext, onRefresh }: {
  patch: string; hasBinaryChanges: boolean; before: string; after: string;
  independentScroll?: boolean; view?: PatchView; wrap?: boolean;
  reviewModel?: DiffReviewModel; loadContext?: LoadDiffContext; onRefresh?: () => void;
}) {
  const localModel = useMemo(() => createDiffReview(patch), [patch]);
  const model = reviewModel ?? localModel;
  const { file, fallback } = model;
  const preferences = useGitDiffPreferences();
  const view = controlledView ?? preferences.view, wrap = controlledWrap ?? preferences.wrap;
  const { isDark } = useTheme();
  const [, render] = useState(0);
  const refresh = useCallback(() => render((value) => value + 1), []);
  const [ready, setReady] = useState(false), [highlightFailed, setHighlightFailed] = useState(false);
  const [loading, setLoading] = useState(false), [contextError, setContextError] = useState<string | null>(null);
  const [wide, setWide] = useState(false), [line, setLine] = useState("");
  const [matchIndex, setMatchIndex] = useState(-1), [searchSide, setSearchSide] = useState<"additions" | "deletions">("additions");
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const viewport = useRef<HTMLDivElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null), wideButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false), pending = useRef<Promise<NonNullable<DiffReviewModel["context"]>> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const bound = useRef(new WeakSet<object>()), accessibleButtons = useRef(new WeakSet<HTMLElement>());

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); pending.current = null; };
  }, []);
  useEffect(() => {
    setReady(false); setHighlightFailed(false);
    if (!file || hasBinaryChanges) return;
    let active = true;
    void preloadHighlighter({ themes: ["pierre-light", "pierre-dark"],
      langs: [getFiletypeFromFileName(file.prevName ?? file.name), getFiletypeFromFileName(file.name)] }).then(
      () => { if (active) setReady(true); }, () => { if (active) setHighlightFailed(true); });
    return () => { active = false; };
  }, [file, hasBinaryChanges]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (wide) { if (!element.open) element.showModal(); }
    else { if (element.open) element.close(); if (returnFocus.current) (returnFocus.current.isConnected ? returnFocus.current : wideButton.current)?.focus(); }
    return () => { if (element.open) element.close(); };
  }, [wide]);

  const ensureContext = useCallback(() => {
    if (model.context) return Promise.resolve(model.context);
    if (pending.current) return pending.current;
    if (!loadContext) return Promise.reject(new Error("Full-file context is unavailable for this supplied patch."));
    const request = new AbortController(); controller.current = request;
    setLoading(true); setContextError(null);
    const promise = Promise.resolve().then(() => loadContext(request.signal)).then((context) => {
      if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
      validateReviewContext(model, context);
      model.context = context;
      if (mounted.current) refresh();
      return context;
    }).catch((error) => {
      if (mounted.current && !request.signal.aborted) setContextError(error instanceof Error ? error.message : "Context unavailable");
      throw error;
    }).finally(() => {
      if (pending.current === promise) pending.current = null;
      if (mounted.current && !request.signal.aborted) setLoading(false);
    });
    pending.current = promise;
    return promise;
  }, [loadContext, model, refresh]);
  const loader = useCallback<FileDiffContentsLoader>(async () => {
    const context = await ensureContext();
    if (file?.type === "rename-pure" && context.newFile) return { oldFile: null, newFile: context.newFile };
    if (!context.oldFile || !context.newFile) throw new Error("This patch does not have two complete versions.");
    return { oldFile: context.oldFile, newFile: context.newFile };
  }, [ensureContext, file]);

  const rememberPosition = useCallback(() => {
    const instance = viewer.current?.getInstance(), item = instance?.getRenderedItems()[0];
    if (!instance || !item) return;
    const top = instance.getScrollTop(), anchor = item.instance.getNumericScrollAnchor(top);
    if (anchor) model.anchors[model.reading] = { lineNumber: anchor.lineNumber, side: anchor.side ?? "additions", offset: anchor.top - top };
    model.scrollLeft = viewport.current?.scrollLeft ?? 0;
  }, [model]);
  const bindViewer = useCallback(() => {
    if (!mounted.current) return;
    const item = viewer.current?.getInstance()?.getRenderedItems()[0];
    if (!item) return;
    for (const button of item.element.shadowRoot?.querySelectorAll<HTMLElement>("[data-expand-button]") ?? []) {
      button.tabIndex = 0;
      button.setAttribute("aria-label", button.hasAttribute("data-expand-all-button") ? "Expand entire gap"
        : button.hasAttribute("data-expand-up") ? "Expand previous context" : button.hasAttribute("data-expand-down") ? "Expand following context" : "Expand nearby context");
      if (!accessibleButtons.current.has(button)) {
        accessibleButtons.current.add(button);
        button.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); button.click(); }
        });
      }
    }
    if (bound.current.has(item.instance)) return;
    bound.current.add(item.instance);
    if (item.type === "diff") {
      const nativeExpand = item.instance.expandHunk;
      // Observe the public expansion method, not Pierre's protected renderer state.
      item.instance.expandHunk = (index, direction, count = 20) => {
        void ensureContext().then(() => {
          if (!mounted.current) return;
          rememberExpansion(model, index, direction, count);
          nativeExpand(index, direction, count);
        }).catch(() => {}); // The request error is shown beside the unchanged patch.
      };
      for (const [index, amount] of model.expansions) {
        if (amount.fromStart) nativeExpand(index, "up", amount.fromStart);
        if (amount.fromEnd) nativeExpand(index, "down", amount.fromEnd);
      }
    }
    const anchor = model.anchors[model.reading];
    if (anchor) viewer.current?.scrollTo({ type: "line", id: model.reading, lineNumber: anchor.lineNumber,
      side: model.reading === "diff" ? anchor.side : undefined, offset: -anchor.offset, align: "start", behavior: "instant" });
    if (viewport.current) viewport.current.scrollLeft = model.scrollLeft;
  }, [ensureContext, model]);
  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(() => ({
    diffStyle: view === "unified" ? "unified" : "split", themeType: isDark ? "dark" : "light", disableFileHeader: true,
    hunkSeparators: loadContext || model.context ? "line-info" : "metadata", expansionLineCount: 20,
    expandUnchanged: model.full, loadDiffFiles: loadContext || model.context ? loader : undefined,
    overflow: wrap ? "wrap" : "scroll", tokenizeMaxLength: 100_000, unsafeCSS: GAP_CSS,
    layout: { paddingTop: 0, paddingBottom: 0, gap: 0 },
    onPostRender: () => { requestAnimationFrame(bindViewer); },
  }), [view, isDark, loadContext, model.context, model.full, loader, wrap, bindViewer]);
  const contextFile = model.reading === "before" ? model.context?.oldFile : model.context?.newFile;
  const diffVersion = file?.isPartial ? 0 : 1;
  const items = useMemo(() => file ? model.reading === "diff"
    ? [{ id: "diff", type: "diff" as const, fileDiff: file, version: diffVersion }]
    : contextFile ? [{ id: model.reading, type: "file" as const, file: contextFile, version: 1 }] : [] : [],
  [file, diffVersion, model.reading, contextFile]);
  const canContext = !hasBinaryChanges && Boolean(file && (loadContext || model.context));
  const interactive = Boolean(file?.hunks.length && !fallback && !hasBinaryChanges);
  const visibleView = model.reading !== "diff" ? model.reading : interactive && ready ? view : "raw";
  const searchFile = model.reading === "before" || model.reading === "diff" && searchSide === "deletions"
    ? model.context?.oldFile : model.context?.newFile;
  const matches = matchingLines(searchFile?.contents ?? "", model.query);
  const navigate = useCallback((target: DiffLineTarget, reveal = false) => {
    if (reveal && model.reading === "diff") { model.full = true; refresh(); }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      viewer.current?.scrollTo({ type: "line", id: model.reading, lineNumber: target.lineNumber,
        side: model.reading === "diff" ? target.side : undefined, align: "center", behavior: "instant" });
      const element = viewport.current;
      if (model.reading === "diff" && view === "split" && element && element.scrollWidth > element.clientWidth) {
        element.scrollLeft = target.side === "additions" ? element.scrollWidth - element.clientWidth : 0;
      }
      viewer.current?.setSelectedLines({ id: model.reading, range: { start: target.lineNumber, end: target.lineNumber,
        ...(model.reading === "diff" ? { side: target.side } : {}) } });
    }));
  }, [model, refresh, view]);
  const chooseReading = async (mode: ReadingMode) => {
    try {
      if (mode !== "diff") await ensureContext();
      rememberPosition(); model.reading = mode; setNavigationError(null); setMatchIndex(-1); refresh();
    } catch { /* Error state is owned by ensureContext. */ }
  };
  const change = (direction: number) => {
    const count = model.changes.length;
    if (!count) return;
    model.changeIndex = model.changeIndex < 0 ? direction < 0 ? count - 1 : 0 : (model.changeIndex + direction + count) % count;
    navigate(model.changes[model.changeIndex]); refresh();
  };
  const find = async (direction: number) => {
    try {
      const context = await ensureContext();
      const side = model.reading === "before" ? "deletions" : model.reading === "after" ? "additions" : searchSide;
      const contents = (side === "deletions" ? context.oldFile : context.newFile)?.contents ?? "";
      const found = matchingLines(contents, model.query);
      if (!found.length) { setMatchIndex(-1); setNavigationError("No matches in this file version."); return; }
      const index = matchIndex < 0 ? direction < 0 ? found.length - 1 : 0 : (matchIndex + direction + found.length) % found.length;
      setMatchIndex(index); setNavigationError(null); navigate({ lineNumber: found[index], side }, true);
    } catch { /* Keep the patch visible. */ }
  };
  const jump = async () => {
    try {
      const context = await ensureContext();
      const side = model.reading === "before" ? "deletions" : model.reading === "after" ? "additions" : searchSide;
      const contents = (side === "deletions" ? context.oldFile : context.newFile)?.contents;
      const target = contents === undefined ? null : validLine(line, contents);
      if (!target) { setNavigationError("Enter an existing line number in this file version."); return; }
      setNavigationError(null); navigate({ lineNumber: target, side }, true);
    } catch { /* Keep the patch visible. */ }
  };
  const readingRows = model.reading === "diff" ? model.full ? Math.max(file?.splitLineCount ?? 1, 20)
    : (file?.hunks.reduce((sum, hunk) => sum + hunk.splitLineCount + 2, 0) ?? 1) : (contextFile?.contents.split("\n").length ?? 1);
  const body = <div className="git-commit-diff mt-2 min-w-0 rounded border border-border bg-bg">
    <div className="git-diff-review-toolbar">
      {file && !hasBinaryChanges && controlledView === undefined && <GitDiffToolbar view={visibleView === "raw" ? "raw" : view} wrap={wrap} onChange={preferences.setPreferences} />}
      {file && !hasBinaryChanges && <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="git-diff-control" disabled={!canContext || loading || !interactive || view === "raw" || model.reading !== "diff"}
          aria-pressed={model.full} title={!canContext ? "The supplied patch has no matching full-file snapshot" : "Reveal all unchanged lines for this file only"}
          onClick={() => { if (model.full) { model.full = false; refresh(); } else void ensureContext().then(() => { model.full = true; refresh(); }).catch(() => {}); }}>
          {model.full ? "Diff context" : "Show full file"}
        </button>
        <div role="group" aria-label="File version" className="flex gap-1">
          {(["diff", "before", "after"] as const).map((mode) => <button key={mode} type="button" className="git-diff-control"
            aria-pressed={model.reading === mode} disabled={mode !== "diff" && (!canContext || loading)} onClick={() => void chooseReading(mode)}>
            {mode === "diff" ? "Changes" : mode === "before" ? "Before" : "After"}
          </button>)}
        </div>
        {model.reading === "diff" && interactive && <>
          <button type="button" className="git-diff-control" aria-label="Previous change" disabled={visibleView === "raw"} onClick={() => change(-1)}>↑ Change</button>
          <button type="button" className="git-diff-control" aria-label="Next change" disabled={visibleView === "raw"} onClick={() => change(1)}>↓ Change</button>
          <span className="text-text-muted">{model.changeIndex < 0 ? model.changes.length : `${model.changeIndex + 1}/${model.changes.length}`} changes</span>
        </>}
        <button ref={wideButton} type="button" className="git-diff-control ml-auto" onClick={(event) => {
          if (!wide) { returnFocus.current = event.currentTarget; rememberPosition(); }
          else rememberPosition();
          setWide(!wide);
        }}>{wide ? "Close wide view" : "Wide view"}</button>
      </div>}
      {canContext && <form className="flex flex-wrap items-center gap-1" onSubmit={(event) => { event.preventDefault(); void find(1); }}>
        {model.reading === "diff" && <select aria-label="Search file version" className="git-diff-field" value={searchSide} onChange={(event) => { setSearchSide(event.target.value as typeof searchSide); setMatchIndex(-1); }}>
          <option value="additions">After</option><option value="deletions">Before</option>
        </select>}
        <input type="search" aria-label="Search full file" placeholder="Find in file…" className="git-diff-field min-w-0 flex-1" value={model.query}
          onChange={(event) => { model.query = event.target.value; setMatchIndex(-1); setNavigationError(null); refresh(); }} />
        <button type="button" className="git-diff-control" aria-label="Previous match" disabled={!model.query || loading || visibleView === "raw"} onClick={() => void find(-1)}>↑ Find</button>
        <button type="submit" className="git-diff-control" aria-label="Next match" disabled={!model.query || loading || visibleView === "raw"}>↓ Find</button>
        {matches.length > 0 && <span aria-live="polite" className="text-text-muted">{matchIndex < 0 ? matches.length : `${matchIndex + 1}/${matches.length}`} matches</span>}
        <input aria-label="Line number" inputMode="numeric" placeholder="Line" className="git-diff-field w-16" value={line} onChange={(event) => setLine(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void jump(); } }} />
        <button type="button" className="git-diff-control" disabled={!line || loading || visibleView === "raw"} onClick={() => void jump()}>Go to line</button>
      </form>}
    </div>
    {loading && <p role="status" className="px-3 py-2 text-xs text-text-muted">Loading matching full-file context…</p>}
    {contextError && <p role="alert" className="px-3 py-2 text-xs text-text-muted">{contextError} <button type="button" className="text-accent underline" onClick={() => void ensureContext().catch(() => {})}>Retry context</button>
      {onRefresh && <button type="button" className="ml-2 text-accent underline" onClick={onRefresh}>Refresh diff</button>}</p>}
    {navigationError && <p role="status" className="px-3 py-2 text-xs text-text-muted">{navigationError}</p>}
    {hasBinaryChanges && <p className="px-3 pt-2 text-xs text-text-muted">Binary changes are summarized; file contents are not shown.</p>}
    {(fallback || highlightFailed) && model.reading === "diff" && <p className="px-3 pt-2 text-xs text-text-muted">{fallback || "The diff could not be highlighted; showing the raw patch."}</p>}
    {!file?.hunks.length && !hasBinaryChanges && !fallback && model.reading === "diff" && <p className="px-3 pt-2 text-xs text-text-muted">No text hunks in this patch (metadata-only change).</p>}
    {interactive && !ready && !highlightFailed && <p role="status" className="px-3 pt-2 text-xs text-text-muted">Preparing highlighted diff; the raw patch is available below.</p>}
    {visibleView === "raw" ? <pre role="region" aria-label="Raw patch" className={`${independentScroll ? "max-h-[44vh] " : ""}overflow-auto p-3 font-mono text-xs text-text`}>{patch}</pre>
      : <div role="region" aria-label={model.reading !== "diff" ? `${model.reading === "before" ? "Before" : "After"} file` : view === "split" ? "Side-by-side diff" : "Unified diff"} className="min-w-0">
        <div className={`git-diff-version-heading ${model.reading === "diff" && view === "split" ? "grid grid-cols-2" : ""}`}>
          {model.reading === "diff" && view === "split" ? <><span>Before · {before}</span><span>After · {after}</span></>
            : <span>{model.reading === "before" ? `Before · ${before}` : model.reading === "after" ? `After · ${after}` : `${before} → ${after}`}</span>}
        </div>
        {model.reading === "diff" && file?.hunks[0]?.hunkSpecs && <div aria-label="Patch hunk" className="px-2 py-1 font-mono text-xs text-text-muted">{file.hunks[0].hunkSpecs.trim()}</div>}
        {model.reading !== "diff" && !contextFile ? <p className="p-3 text-xs text-text-muted">This file does not exist in the {model.reading} version.</p>
          : model.reading !== "diff" && contextFile?.contents === "" ? <p className="p-3 text-xs text-text-muted">Empty file.</p>
            : <CodeView key={model.reading} ref={viewer} containerRef={viewport} items={items} options={options} onScroll={rememberPosition}
              className={`git-diff-code-view${model.reading === "diff" && view === "split" ? " is-split" : ""}`} style={{ height: wide ? "65vh" : Math.min(420, Math.max(100, readingRows * 22 + 32)) }} />}
      </div>}
  </div>;
  return <>
    {!wide ? body : <p className="p-2 text-xs text-text-muted">File opened in wide view.</p>}
    <dialog ref={dialog} className="git-diff-dialog" aria-label={`Review file: ${file?.name ?? "patch"}`}
      onCancel={(event) => { event.preventDefault(); event.stopPropagation(); rememberPosition(); setWide(false); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); rememberPosition(); setWide(false); } }}>
      {wide && body}
    </dialog>
  </>;
}
