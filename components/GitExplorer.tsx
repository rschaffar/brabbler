"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutGitGraph } from "@/lib/git-graph-layout";
import type { ExplorerCommit } from "@/lib/git-explorer";

type Page = { head: string; branch: string; refs: { branch: string; oid: string }[]; commits: ExplorerCommit[]; nextSkip: number | null };
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

/** Read-only history for the sidebar's selected checkout, not the open chat. */
export function GitExplorer({ cwd, onOpenCommit }: { cwd: string; onOpenCommit: (cwd: string, head: string, oid: string) => void }) {
  const [revision, setRevision] = useState(0);
  const [page, setPage] = useState<Page | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [selectedOid, setSelectedOid] = useState<string | null>(null);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => () => { moreController.current?.abort(); }, [cwd, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setSelectedOid(null); setError(null); setLoading(true); setMoreLoading(false);
    void load(address(cwd), controller.signal)
      .then((result) => { if (!controller.signal.aborted) setPage(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cwd, revision]);

  const graph = useMemo(() => layoutGitGraph(page?.commits ?? []), [page?.commits]);
  const graphWidth = Math.max(28, graph.laneCount * GAP + 16);
  const refs = useMemo(() => {
    const byOid = new Map<string, string[]>();
    for (const ref of page?.refs ?? []) byOid.set(ref.oid, [...(byOid.get(ref.oid) ?? []), ref.branch]);
    return byOid;
  }, [page?.refs]);
  const loadMore = useCallback(async () => {
    if (!page || page.nextSkip === null || moreLoading) return;
    moreController.current?.abort();
    const controller = new AbortController();
    moreController.current = controller;
    setMoreLoading(true);
    try {
      const result = await load(address(cwd, { head: page.head, skip: String(page.nextSkip) }), controller.signal);
      if (!controller.signal.aborted) {
        setPage((previous) => previous?.head === result.head && previous.nextSkip === page.nextSkip
          ? { ...previous, commits: [...previous.commits, ...result.commits], nextSkip: result.nextSkip, refs: result.refs } : previous);
        setError(null);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(errorText(cause)); }
    finally { if (!controller.signal.aborted) setMoreLoading(false); }
  }, [cwd, page, moreLoading]);

  return <div className="flex min-h-0 flex-1 flex-col text-xs" aria-label="Git Explorer">
    <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-1 text-text-muted">
      <span className="min-w-0 truncate" title={cwd}>{page ? `${page.branch} · ${page.head.slice(0, 10)}` : "Selected worktree history"}</span>
      <button type="button" className="shrink-0 text-accent" onClick={() => setRevision((n) => n + 1)}>Refresh</button>
    </div>
    {loading && <p className="p-2 text-text-muted" role="status">Loading Git history…</p>}
    {error && <p className="p-2 text-red-400" role="alert">{error}</p>}
    {page && <div className="min-h-0 flex-1 overflow-auto" aria-label="Commit graph">
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
          className="flex h-9 w-full min-w-0 flex-col justify-center pr-2 text-left text-text hover:bg-bg-hover aria-pressed:bg-bg-selected"
          style={{ paddingLeft: graphWidth }} onClick={() => { setSelectedOid(commit.oid); onOpenCommit(cwd, page.head, commit.oid); }}
          title={`${commit.oid}\n${commit.author} · ${commit.date}\n${commit.subject}`}>
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 flex-1 truncate">{commit.subject || "(no subject)"}</span>
            <span className="shrink-0 font-mono text-text-dim">{commit.oid.slice(0, 7)}</span>
          </span>
          {refs.get(commit.oid)?.length ? <span className="truncate text-[10px] text-accent" title={refs.get(commit.oid)?.join(", ")}>
            {refs.get(commit.oid)?.join(" · ")}
          </span> : null}
        </button>)}
      </div>
      {page.nextSkip !== null && <button type="button" disabled={moreLoading} className="w-full p-2 text-accent disabled:opacity-50"
        onClick={() => void loadMore()}>{moreLoading ? "Loading…" : "Load older commits"}</button>}
    </div>}
  </div>;
}
