"use client";

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { parseReviewBlock, reviewExplorerUrl, type ReviewBlock, type ReviewCommitReference, type ReviewSource } from "@/lib/review-notebook";
import type { DiffContext } from "@/lib/diff-context";
import { CodeBlock } from "./MermaidBlock";
import { ReviewNotebookSource } from "./ReviewNotebookSource";
import { useI18n } from "@/hooks/useI18n";

/** Explicit navigation only. Documents never change session/workspace identity. */
export const ReviewNavigationContext = createContext<(() => (reference: ReviewCommitReference, head: string) => void) | null>(null);
const GitCommitViewer = dynamic(() => import("./GitCommitViewer").then(module => module.GitCommitViewer), { ssr: false });
const CommittedPatchDiff = dynamic(() => import("./CommittedPatchDiff").then(module => module.CommittedPatchDiff), { ssr: false });

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}

type Material = { head: string } & ({ kind: "source"; source: ReviewSource } |
  { kind: "diff"; patch: string; hasBinaryChanges: boolean; before: string } | { kind: "commit" });
type Mode = "source" | "diff" | "commit";

function ActiveReviewBlock({ block }: { block: ReviewBlock }) {
  const { t } = useI18n();
  const navigate = useContext(ReviewNavigationContext);
  const bodyId = useId();
  const [mode, setMode] = useState<Mode | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [revealing, setRevealing] = useState(false);
  const revealController = useRef<AbortController | null>(null);
  useEffect(() => {
    setRevealing(false);
    return () => revealController.current?.abort();
  }, [navigate]);
  useEffect(() => {
    if (!mode) return;
    const controller = new AbortController();
    const signal = controller.signal;
    setMaterial(null); setError(null); setLoading(true);
    void (async () => {
      // Capture authorization at activation, never replace the authored immutable oid.
      const { head } = await read<{ head: string }>(reviewExplorerUrl(block, "log"), signal);
      if (mode === "source" && block.kind === "source") {
        const source = await read<ReviewSource>(reviewExplorerUrl(block, "source", { head, path: block.path, start: String(block.start), end: String(block.end) }), signal);
        return { kind: "source" as const, head, source };
      }
      if (mode === "diff" && block.kind === "source") {
        const patch = await read<{ patch: string; hasBinaryChanges: boolean }>(reviewExplorerUrl(block, "patch", { head, path: block.path }), signal);
        const detail = await read<{ parents: string[] }>(reviewExplorerUrl(block, "commit", { head }), signal);
        return { kind: "diff" as const, head, ...patch, before: detail.parents[0]?.slice(0, 8) ?? "empty tree" };
      }
      return { kind: "commit" as const, head };
    })().then(value => { if (!signal.aborted) setMaterial(value); })
      .catch(cause => { if (!signal.aborted) setError(cause instanceof Error ? cause.message : t("review.unavailable")); })
      .finally(() => { if (!signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [block, mode, retry, t]);
  const toggle = (next: Mode) => { setError(null); setMode(previous => previous === next ? null : next); };
  const reveal = async () => {
    if (!navigate) return;
    revealController.current?.abort();
    const controller = new AbortController(); revealController.current = controller;
    const finishNavigation = navigate(); // Allocate the shared command before any asynchronous read.
    setRevealing(true); setError(null);
    try {
      const { head } = await read<{ head: string }>(reviewExplorerUrl(block, "log"), controller.signal);
      // Validate reachability before displaying an authored checkout/commit as selected history.
      await read(reviewExplorerUrl(block, "commit", { head }), controller.signal);
      if (!controller.signal.aborted) finishNavigation(block, head);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("review.commitUnavailable")); }
    finally { if (!controller.signal.aborted) setRevealing(false); }
  };
  return <section className="review-notebook-block" aria-label={t("review.stop", { title: block.title })} data-review-stop={block.id}>
    <div className="review-notebook-heading"><strong>{block.title}</strong>{block.priority && <span>{t("review.effort", { priority: block.priority })}</span>}</div>
    <div className="review-notebook-identity">{t("review.readOnly")} · {block.cwd} · {block.branch}<br />
      <span title={block.oid}>{block.oid}</span>{block.kind === "source" && <> · {block.path}:{block.start}–{block.end}</>}</div>
    <div className="review-notebook-actions">
      {block.kind === "source" ? <>
        <button type="button" aria-expanded={mode === "source"} aria-controls={bodyId} onClick={() => toggle("source")}>{t(mode === "source" ? "review.collapseSource" : "review.expandSource")}</button>
        <button type="button" aria-expanded={mode === "diff"} aria-controls={bodyId} onClick={() => toggle("diff")}>{t(mode === "diff" ? "review.collapseDiff" : "review.showDiff")}</button>
      </> : <button type="button" aria-expanded={mode === "commit"} aria-controls={bodyId} onClick={() => toggle("commit")}>{t(mode === "commit" ? "review.collapseCommit" : "review.expandCommit")}</button>}
      {navigate && <button type="button" disabled={revealing} onClick={() => void reveal()}>{t(revealing ? "review.locating" : "review.reveal")}</button>}
    </div>
    {error && <div role="alert">{error}{mode && <button type="button" className="ml-2 text-accent underline" onClick={() => setRetry(value => value + 1)}>{t("review.retry")}</button>}</div>}
    <div id={bodyId}>
      {mode && loading && <p role="status">{t("review.loading")}</p>}
      {mode === "source" && material?.kind === "source" && <ReviewNotebookSource source={material.source} />}
      {mode === "diff" && material?.kind === "diff" && block.kind === "source" && <CommittedPatchDiff
        patch={material.patch} hasBinaryChanges={material.hasBinaryChanges} before={material.before} after={block.oid.slice(0, 8)}
        loadContext={signal => read<DiffContext>(reviewExplorerUrl(block, "context", { head: material.head, path: block.path }), signal)} />}
      {mode === "commit" && material?.kind === "commit" && <div className="review-notebook-commit"><GitCommitViewer cwd={block.cwd} branch={block.branch} head={material.head} oid={block.oid} /></div>}
    </div>
  </section>;
}

/** Opted-in, settled Markdown only. Neither parsing nor mounting performs a read. */
export function ReviewNotebookBlock({ source, isStreaming = false }: { source: string; isStreaming?: boolean }) {
  const { t } = useI18n();
  const parsed = useMemo(() => parseReviewBlock(source), [source]);
  if (isStreaming) return <CodeBlock code={source} lang="json" isStreaming />;
  if (parsed.error) return <div className="review-notebook-invalid"><p role="note">{t("review.inactive", { error: parsed.error })}</p><CodeBlock code={source} lang="json" /></div>;
  return <ActiveReviewBlock key={source} block={parsed.value!} />;
}
