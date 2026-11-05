"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewFileBrowser } from "../ReviewFileBrowser";
import { useI18n } from "@/hooks/useI18n";
import { CommittedPatchDiff } from "../CommittedPatchDiff";
import { createDiffReview } from "@/lib/git-diff-review";
import { ReviewNavigationState } from "@/lib/operation-review-state";
import type { DiffContext } from "@/lib/diff-context";
import type { GitDiffPreferences } from "@/lib/git-diff-preferences";
import type { PluginReviewReference } from "@/lib/plugins/types";
import type { ReviewAvailability, ReviewOverview, ReviewPage, ReviewPreview, ReviewView } from "@/lib/plugins/review-protocol";

type Observe = (work: Promise<void>) => void;
function useRead<T>(url: string | null, observe: Observe) {
  const [value, setValue] = useState<{ url: string; body?: T; error?: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const work = fetch(url, { signal: controller.signal, cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Review unavailable.");
      return body as T;
    }).then(body => { if (!controller.signal.aborted) setValue({ url, body }); }, error => {
      if (!controller.signal.aborted) setValue({ url, error: String(error) });
    });
    observe(work); // Includes decoding, publication/error and complete continuation.
    return () => controller.abort();
  }, [url, retry, observe]);
  return { ...(value?.url === url ? value : {}), retry: () => setRetry(value => value + 1) };
}
function SelectedFile({ id, path, status, url, source, preferences, navigation, observe }: {
  id: number; path: string; status?: string; url: string; source: ReviewAvailability; preferences: GitDiffPreferences;
  navigation: ReviewNavigationState; observe: Observe;
}) {
  const { t } = useI18n();
  const key = `${source.view}:${id}`;
  const [offset, updateOffset] = useState(() => navigation.offset(key));
  const setOffset = (value: number) => { navigation.saveOffset(key, value); updateOffset(value); };
  const base = `${url}?view=${source.view}&file=${id}`;
  const read = useRead<ReviewPreview>(`${base}&op=preview&offset=${offset}`, observe);
  const model = useMemo(() => read.body?.complete ? Object.assign(createDiffReview(read.body.text), navigation.position(key)) : undefined,
    [read.body, navigation, key]);
  useEffect(() => () => { if (model) navigation.savePosition(key, model); }, [model, navigation, key]);
  const loadContext = useCallback(async (signal: AbortSignal): Promise<DiffContext> => {
    const response = await fetch(`${base}&op=context`, { signal, cache: "no-store" });
    const body = await response.json();
    signal.throwIfAborted();
    if (!response.ok) throw new Error(body.error ?? "Full-file context unavailable.");
    return body;
  }, [base]);
  return <section aria-label={`File changes: ${path}`} className="min-w-0 space-y-2 p-2">
    <p>{status === "R" ? t("files.renamed") : ({ A: "Added", D: "Deleted", M: "Modified", T: "Type changed", C: "Copied" } as Record<string, string>)[status ?? ""] ?? "File change"}</p>
    <a className="text-accent underline" href={`${base}&op=patch`}>Download complete file patch</a>
    {read.error && <p role="alert">{read.error} <button type="button" onClick={read.retry}>Retry content</button></p>}
    {!read.body && !read.error && <p role="status">Loading review…</p>}
    {read.body && (read.body.complete
      ? <CommittedPatchDiff patch={read.body.text} hasBinaryChanges={/^(?:GIT binary patch|Binary files .+ differ)$/m.test(read.body.text)}
          before={`Before · ${source.before ?? ""}`} after={`${source.label} · ${source.after ?? ""}`} {...preferences}
          reviewModel={model} loadContext={loadContext} onReadWork={work => observe(work as Promise<void>)} />
      : <><p>Raw preview at byte {offset.toLocaleString()}. Download contains every byte.</p>
        <pre aria-label="Raw patch" className="max-h-[44vh] overflow-auto whitespace-pre font-mono text-xs">{read.body.text}</pre></>)}
    <div className="flex gap-3">
      {offset > 0 && <button type="button" onClick={() => setOffset(Math.max(0, offset - 256 * 1024))}>Previous content</button>}
      {read.body?.next != null && <button type="button" onClick={() => setOffset(read.body!.next!)}>Next content</button>}
    </div>
  </section>;
}
function Files({ url, source, observe, navigation }: { url: string; source: ReviewAvailability; observe: Observe;
  navigation: ReviewNavigationState }) {
  const [start, setStart] = useState(0);
  const read = useRead<ReviewPage>(`${url}?op=page&view=${source.view}&start=${start}`, observe);
  return <>
    {read.error && <p role="alert">{read.error} <button type="button" onClick={read.retry}>Retry files</button></p>}
    {!read.body && !read.error && <p role="status">Loading files…</p>}
    {read.body && (read.body.total === 0 ? <p>No file changes in this comparison.</p> : <>
      <p>Showing files {start + 1}–{start + read.body.files.length} of {read.body.total}.</p>
      <ReviewFileBrowser paged files={read.body.files.map(file => ({ id: String(file.id), label: file.previousPath ? `${file.previousPath} → ${file.path}` : file.path, description: file.status }))}
        pagination={<>
          {start > 0 && <button type="button" onClick={() => setStart(Math.max(0, start - 40))}>Previous files</button>}
          {read.body.next !== null && <button type="button" onClick={() => setStart(read.body!.next!)}>Next files</button>}
        </>}>
        {(selected, preferences) => <SelectedFile key={`${source.view}:${selected.id}`} id={Number(selected.id)} path={selected.label} status={read.body!.files.find(file => file.id === Number(selected.id))?.status} url={url} source={source}
          preferences={preferences} navigation={navigation} observe={observe} />}
      </ReviewFileBrowser>
    </>)}
  </>;
}
function Details({ url, observe }: { url: string; observe: Observe }) {
  const [offset, setOffset] = useState(0);
  const read = useRead<ReviewPreview>(`${url}?op=details&offset=${offset}`, observe);
  return <div className="space-y-2">
    <a className="text-accent underline" href={`${url}?op=details&download=1`}>Download complete operation metadata</a>
    {read.error && <p role="alert">{read.error} <button type="button" onClick={read.retry}>Retry details</button></p>}
    {read.body ? <><p>Metadata at byte {offset.toLocaleString()} of {read.body.bytes.toLocaleString()}.</p>
      <pre className="max-h-[44vh] overflow-auto whitespace-pre font-mono text-xs">{read.body.text}</pre>
      <div className="flex gap-3">
        {offset > 0 && <button type="button" onClick={() => setOffset(Math.max(0, offset - 256 * 1024))}>Previous details</button>}
        {read.body.next !== null && <button type="button" onClick={() => setOffset(read.body!.next!)}>Next details</button>}
      </div></> : !read.error && <p role="status">Loading operation metadata…</p>}
  </div>;
}
function NativeReview({ url, observe }: { url: string; observe: Observe }) {
  const read = useRead<ReviewOverview>(`${url}?op=overview`, observe);
  const [selected, setSelected] = useState<ReviewView>();
  const [details, setDetails] = useState(false);
  const [navigation] = useState(() => new ReviewNavigationState());
  const overview = read.body, view = selected ?? overview?.defaultView;
  const source = overview?.views.find(item => item.view === view);
  const alternative = overview?.defaultView === "result" && overview.views.some(item => item.view === "proposal")
    && (overview.relation !== "same" || !overview.views.find(item => item.view === "result")?.available);
  return <>
    {read.error && <p role="alert">{read.error} <button type="button" onClick={read.retry}>Retry review</button></p>}
    {!overview && !read.error && <p role="status">Loading review…</p>}
    {overview && source && <>
      <strong>{source.label}</strong>
      {overview.relation === "different" && <p>The recorded result and original proposal contain different file-version changes.</p>}
      {alternative && <button className="git-diff-control" type="button" onClick={() => setSelected(view === "result" ? "proposal" : "result")}>
        {view === "result" ? "View original proposal" : "Actual result"}</button>}
      {!source.available ? <p role="status">{source.reason}</p> : <>
        <a className="text-accent underline" href={`${url}?op=patch&view=${view}`}>Download complete {source.label.toLowerCase()} patch</a>
        <Files key={view} url={url} source={source} observe={observe} navigation={navigation} />
      </>}
      {overview.details && <details onToggle={event => setDetails(event.currentTarget.open)}>
        <summary className="cursor-pointer">Operation metadata and complete resource details</summary>
        {details && <Details url={url} observe={observe} />}
      </details>}
    </>}
  </>;
}
/** The same shared file browser/Pierre reader as supplied-patch cards and Explorer.
 * Saved source/view/file scopes own all async publication and reading state. */
export function ReviewAttachment({ review, sessionId, reviewBaseUrl, onReadWork }: {
  review: PluginReviewReference; sessionId?: string; before?: string; after?: string; contextHandle?: string; pluginId?: string;
  reviewBaseUrl?: string; onReadWork?: Observe;
}) {
  const observer = useRef(onReadWork); observer.current = onReadWork;
  const observe = useCallback((work: Promise<void>) => observer.current?.(work), []);
  const url = reviewBaseUrl ?? `/api/sessions/${encodeURIComponent(sessionId ?? "")}/reviews/${encodeURIComponent(review.id)}`;
  return <section aria-label="Exact operation review" className="min-w-0 space-y-2 text-xs">
    <h3 className="blocking-card-section-title">Operation review</h3>
    <p>Approval covers the entire operation, not just this page.</p>
    {review.version === 1 ? <p role="status">Legacy review unavailable; offline migration required.</p>
      : sessionId || reviewBaseUrl ? <NativeReview key={url} url={url} observe={observe} /> : <p>Open the saved owner to read its review.</p>}
  </section>;
}
