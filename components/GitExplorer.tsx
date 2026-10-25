"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { layoutGitGraph } from "@/lib/git-graph-layout";
import type { ExplorerCommit } from "@/lib/git-explorer";
import type { ReviewNavigation } from "@/lib/review-notebook";
import { useI18n } from "@/hooks/useI18n";

type Page = { head: string; branch: string; refs: { branch: string; oid: string }[]; commits: ExplorerCommit[]; nextSkip: number | null };
// Pixel height shared by the SVG coordinates and commit rows (not rem-based h-9).
const ROW = 36;
const GAP = 15;
const X = 12;
const colors = ["#60a5fa", "#fb923c", "#4ade80", "#c084fc", "#f87171", "#2dd4bf"];

const address = (cwd: string, extra: Record<string, string> = {}) =>
  `/api/git/explorer?${new URLSearchParams({ cwd, op: "log", ...extra })}`;
function errorText(error: unknown) { return error instanceof Error ? error.message : "Git history is unavailable"; }
async function load(address: string, signal: AbortSignal): Promise<Page> {
  const response = await fetch(address, { cache: "no-store", signal });
  const body = await response.json() as Page & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
function laneColor(lane: number) { return colors[lane % colors.length]; }

/** Read-only local-branch history for the selected checkout, not the open chat. */
export function GitExplorer({ cwd, onOpenCommit, onBranchChange, initialSelection, onReadWork }: {
  cwd: string;
  onOpenCommit: (branch: string, head: string, oid: string) => void;
  onBranchChange: () => void;
  initialSelection?: ReviewNavigation;
  /** Observe complete read continuations without changing their cancellation or error policy. */
  onReadWork?: (work: Promise<void>) => void;
}) {
  const { t } = useI18n();
  const readObserver = useRef(onReadWork);
  readObserver.current = onReadWork;
  const observeRead = useCallback((work: Promise<void>) => { readObserver.current?.(work); }, []);
  const [revision, setRevision] = useState(0);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(initialSelection?.branch ?? null);
  const [expectedHead, setExpectedHead] = useState<string | null>(initialSelection?.head ?? null);
  const [page, setPage] = useState<Page | null>(null);
  const [availableRefs, setAvailableRefs] = useState<Page["refs"]>([]);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [selectedOid, setSelectedOid] = useState<string | null>(initialSelection?.oid ?? null);
  const graphViewport = useRef<HTMLDivElement>(null);
  const pendingGraphReveal = useRef(initialSelection?.oid ?? null);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => () => { moreController.current?.abort(); }, [cwd, revision, selectedBranch]);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setSelectedOid(expectedHead ? initialSelection?.oid ?? null : null); setError(null); setLoading(true); setMoreLoading(false);
    const work = load(address(cwd, { ...(selectedBranch ? { branch: selectedBranch } : {}), ...(expectedHead ? { head: expectedHead } : {}) }), controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setPage(result); setAvailableRefs(result.refs); setCurrentBranch(result.branch); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    observeRead(work);
    return () => controller.abort();
  }, [cwd, revision, selectedBranch, expectedHead, initialSelection?.oid, observeRead]);

  useEffect(() => {
    const viewport = graphViewport.current;
    if (!viewport || !pendingGraphReveal.current) return;
    const reveal = () => {
      // Mobile starts in detail; a display:none graph cannot consume its jump yet.
      if (!viewport.clientHeight || !viewport.clientWidth) return;
      const index = page?.commits.findIndex(commit => commit.oid === pendingGraphReveal.current) ?? -1;
      if (index < 0) return;
      viewport.scrollTop = index * ROW;
      pendingGraphReveal.current = null;
    };
    const observer = new ResizeObserver(reveal);
    observer.observe(viewport);
    reveal();
    return () => observer.disconnect();
  }, [page]);

  const loadMore = useCallback(async () => {
    if (!page || page.nextSkip === null || moreLoading) return;
    moreController.current?.abort();
    const controller = new AbortController();
    moreController.current = controller;
    setMoreLoading(true);
    try {
      const result = await load(address(cwd, { branch: page.branch, head: page.head, skip: String(page.nextSkip) }), controller.signal);
      if (!controller.signal.aborted) {
        setPage((previous) => previous?.head === result.head && previous.branch === result.branch && previous.nextSkip === page.nextSkip
          ? { ...previous, commits: [...previous.commits, ...result.commits], nextSkip: result.nextSkip, refs: result.refs } : previous);
        setError(null);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
    finally { if (!controller.signal.aborted) setMoreLoading(false); }
  }, [cwd, page, moreLoading]);

  return <div className="flex min-h-0 flex-1 flex-col text-xs" aria-label="Git Explorer">
    <div className="flex items-center gap-2 border-b border-border px-2 py-1 text-text-muted">
      <select aria-label="History branch" className="min-w-0 flex-1 rounded border border-border bg-bg px-1 py-1 text-text"
        value={selectedBranch ?? page?.branch ?? currentBranch ?? ""} disabled={!availableRefs.length}
        onChange={(event) => { pendingGraphReveal.current = null; onBranchChange(); setExpectedHead(null); setPage(null); setSelectedBranch(event.target.value); }}>
        {!availableRefs.length && <option value="">Loading branches…</option>}
        {availableRefs.map((ref) => <option key={ref.branch} value={ref.branch}>{ref.branch}</option>)}
      </select>
      <button type="button" className="shrink-0 text-accent" onClick={() => { pendingGraphReveal.current = null; onBranchChange(); setExpectedHead(null); setPage(null); setRevision((n) => n + 1); }}>Refresh</button>
    </div>
    {page && <p className="truncate px-2 py-1 font-mono text-[10px] text-text-dim" title={cwd}>{page.head.slice(0, 10)} · {cwd}</p>}
    {loading && <p className="p-2 text-text-muted" role="status">Loading Git history…</p>}
    {error && <p className="p-2 text-red-400" role="alert">{error}</p>}
    {page && selectedOid && !page.commits.some(commit => commit.oid === selectedOid) && <p className="p-2 text-text-muted" role="status">{t("review.outsidePage")}</p>}
    {page && <GitExplorerGraph page={page} selectedOid={selectedOid} graphViewport={graphViewport} moreLoading={moreLoading}
      onSelect={(oid) => { pendingGraphReveal.current = null; setSelectedOid(oid); onOpenCommit(page.branch, page.head, oid); }}
      onLoadMore={() => { const work = loadMore(); observeRead(work); }} />}
  </div>;
}

/** Loaded immutable graph projection, shared by the live reader and inert SSR. */
export function GitExplorerGraph({ page, selectedOid, graphViewport, moreLoading = false, onSelect, onLoadMore }: {
  page: Page; selectedOid: string | null; graphViewport?: RefObject<HTMLDivElement | null>; moreLoading?: boolean;
  onSelect: (oid: string) => void; onLoadMore: () => void;
}) {
  const graph = useMemo(() => layoutGitGraph(page.commits), [page.commits]);
  const graphWidth = Math.max(28, graph.laneCount * GAP + 16);
  const refs = useMemo(() => {
    const byOid = new Map<string, string[]>();
    for (const ref of page.refs) byOid.set(ref.oid, [...(byOid.get(ref.oid) ?? []), ref.branch]);
    return byOid;
  }, [page.refs]);
  return <div ref={graphViewport} className="min-h-0 flex-1 overflow-auto" aria-label="Commit graph">
    <div className="relative" style={{ minWidth: graphWidth + 135, height: page.commits.length * ROW }}>
      <svg aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-10" width={graphWidth} height={page.commits.length * ROW}>
        {graph.links.map((link, index) => {
          const x1 = X + link.childLane * GAP;
          const x2 = X + link.parentLane * GAP;
          const y1 = link.childRow * ROW + ROW / 2;
          const y2 = link.parentRow * ROW + ROW / 2;
          return <path key={index} d={`M ${x1} ${y1} C ${x1} ${y1 + 12}, ${x2} ${y2 - 12}, ${x2} ${y2}`}
            fill="none" stroke={laneColor(link.parentLane)} strokeWidth="2" />;
        })}
        {page.commits.map((commit, row) => <circle key={commit.oid} cx={X + graph.lanes[row] * GAP}
          cy={row * ROW + ROW / 2} r="4" fill="var(--bg-panel)" stroke={laneColor(graph.lanes[row])} strokeWidth="2" />)}
      </svg>
      {page.commits.map((commit) => <button key={commit.oid} type="button" aria-pressed={selectedOid === commit.oid}
        className="flex w-full min-w-0 flex-col justify-center pr-2 text-left text-text hover:bg-bg-hover aria-pressed:bg-bg-selected"
        style={{ height: ROW, paddingLeft: graphWidth }} onClick={() => onSelect(commit.oid)}
        title={[commit.oid, `${commit.author} · ${commit.date}`, commit.subject,
          ...(refs.get(commit.oid) ?? []).map((branch) => `Local branch: ${branch}`),
          ...(commit.tags ?? []).map((tag) => `Local tag: ${tag}`)].join("\n")}>
        <span className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate">{commit.subject || "(no subject)"}</span>
          <span className="shrink-0 font-mono text-text-dim">{commit.oid.slice(0, 7)}</span>
        </span>
        {(refs.get(commit.oid)?.length || commit.tags?.length) ? <span className="flex w-full min-w-0 items-center gap-1 overflow-hidden text-[10px]">
          {refs.get(commit.oid)?.map((branch) => <span key={`branch:${branch}`} className="min-w-0 max-w-40 truncate text-accent"
            title={`Local branch: ${branch}`} aria-label={`Local branch: ${branch}`}>{branch}</span>)}
          {(commit.tags ?? []).map((tag) => <span key={`tag:${tag}`} className="min-w-0 max-w-40 truncate rounded bg-amber-400/10 px-1 text-amber-300"
            title={`Local tag: ${tag}`} aria-label={`Local tag: ${tag}`}>tag: {tag}</span>)}
        </span> : null}
      </button>)}
    </div>
    {page.nextSkip !== null && <button type="button" disabled={moreLoading} className="w-full p-2 text-accent disabled:opacity-50"
      onClick={onLoadMore}>{moreLoading ? "Loading…" : "Load older commits"}</button>}
  </div>;
}
