"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReviewFileBrowser } from "../ReviewFileBrowser";
import { CommittedPatchDiff } from "../CommittedPatchDiff";
import { createDiffReview, type DiffReviewModel } from "@/lib/git-diff-review";
import type { GitDiffPreferences } from "@/lib/git-diff-preferences";
import type { PluginReviewReference } from "@/lib/plugins/types";
import { SuppliedPatchStack } from "../GitPatchStack";

interface Entry { id: number; label: string; kind: "text" | "patch"; bytes: number; sha256: string }
interface Page { entries: Entry[]; total: number; next: number | null }
interface Preview { text: string; offset: number; next: number | null; complete: boolean }
// Retain navigation, never parsed patches or file contents, across large-review pages.
type ReviewPosition = Pick<DiffReviewModel, "full" | "reading" | "changeIndex" | "expansions" | "anchors" | "scrollLeft" | "query">;
function EntryContent({ entry, url, before, after, preferences, reviews, offsets }: {
  entry: Entry; url: string; before: string; after: string; preferences?: GitDiffPreferences;
  reviews?: Map<number, ReviewPosition>; offsets?: Map<number, number>;
}) {
  const [offset, updateOffset] = useState(offsets?.get(entry.id) ?? 0);
  const setOffset = (value: number) => { offsets?.set(entry.id, value); updateOffset(value); };
  const [value, setValue] = useState<(Preview & { url: string }) | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${url}?entry=${entry.id}&offset=${offset}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as Preview; })
      .then((body) => { if (!controller.signal.aborted) { setValue({ ...body, url }); setError(""); } }, (cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [url, entry.id, offset, retry]);
  const current = value?.offset === offset && value.url === url ? value : null;
  const model = useMemo(() => {
    if (!current?.complete || entry.kind !== "patch") return undefined;
    return Object.assign(createDiffReview(current.text), reviews?.get(entry.id));
  }, [current, entry.id, entry.kind, reviews]);
  useEffect(() => () => {
    if (model) {
      const { full, reading, changeIndex, expansions, anchors, scrollLeft, query } = model;
      reviews?.set(entry.id, { full, reading, changeIndex, expansions, anchors, scrollLeft, query });
    }
  }, [entry.id, model, reviews]);
  return <div className="min-w-0 space-y-2 p-2">
    <a className="text-accent underline" href={`${url}?entry=${entry.id}&download=1`}>Download exact entry ({entry.bytes.toLocaleString()} bytes)</a>
    {error && <div role="alert" className="break-words">{error} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry content</button></div>}
    {!current && !error && <p role="status">Loading review…</p>}
    {current && (current.complete && entry.kind === "patch"
      ? <CommittedPatchDiff patch={current.text} hasBinaryChanges={/^(?:GIT binary patch|Binary files .+ differ)$/m.test(current.text)}
          before={before} after={after} {...preferences} reviewModel={model} />
      : <><p className="text-text-muted">{current.complete ? "Exact details" : `Raw preview at byte ${current.offset.toLocaleString()}. Display is paged; download contains every byte.`}</p>
        <pre className="max-h-[44vh] overflow-auto whitespace-pre font-mono text-xs">{current.text}</pre>
      </>)}
    <div className="flex gap-3">
      {offset > 0 && <button type="button" onClick={() => setOffset(Math.max(0, offset - 256 * 1024))}>Previous content</button>}
      {current?.next != null && <button type="button" onClick={() => setOffset(current.next!)}>Next content</button>}
    </div>
  </div>;
}
function EntryRow(props: { entry: Entry; url: string; before: string; after: string }) {
  const [expanded, setExpanded] = useState(false);
  return <details className="min-w-0 rounded border border-border" onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary className="cursor-pointer break-all p-2">{props.entry.label} · {props.entry.bytes.toLocaleString()} bytes</summary>
    {expanded && <EntryContent {...props} />}
  </details>;
}
/** Small bounded pages; review failures never replace a live card's action footer. */
export function ReviewAttachment({ review, sessionId, before = "Before", after = "After", contextHandle, pluginId, reviewBaseUrl }: {
  review: PluginReviewReference; sessionId?: string; before?: string; after?: string; contextHandle?: string; pluginId?: string;
  /** Host-authorized operation review endpoint, never an arbitrary resource URL. */
  reviewBaseUrl?: string;
}) {
  const [start, setStart] = useState(0), [retry, setRetry] = useState(0);
  const reviews = useRef(new Map<number, ReviewPosition>()), offsets = useRef(new Map<number, number>());
  const [loadedPage, setPage] = useState<(Page & { start: number; url: string }) | null>(null), [error, setError] = useState("");
  const [loadedPatch, setPatch] = useState<{ url: string; text: string } | null>(null);
  const [patchError, setPatchError] = useState("");
  const inline = review.bytes <= 256 * 1024;
  const url = reviewBaseUrl ?? `/api/sessions/${encodeURIComponent(sessionId ?? "")}/reviews/${review.id}`;
  const available = Boolean(sessionId || reviewBaseUrl);
  const page = loadedPage?.start === start && loadedPage.url === url ? loadedPage : null;
  const patch = loadedPatch?.url === url ? loadedPatch.text : null;
  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    void fetch(`${url}?start=${start}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as Page; })
      .then((body) => { if (!controller.signal.aborted) { setPage({ ...body, start, url }); setError(""); } }, (cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [url, available, start, retry]);
  useEffect(() => {
    if (!available || !inline) return;
    const controller = new AbortController();
    void fetch(`${url}?patch=1`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Exact patch unavailable");
      return response.text();
    }).then((text) => { if (!controller.signal.aborted) { setPatch({ url, text }); setPatchError(""); } }, (cause) => { if (!controller.signal.aborted) setPatchError(String(cause)); });
    return () => controller.abort();
  }, [url, available, inline, retry]);
  return <section aria-label="Exact operation review" className="min-w-0 space-y-2 text-xs">
    <h3 className="blocking-card-section-title">Exact operation review</h3>
    <p>{review.entries.toLocaleString()} review entries · {review.bytes.toLocaleString()} bytes. Approval covers the entire operation, not just this page.</p>
    {available ? <div className="flex flex-wrap gap-3"><a className="text-accent underline" href={`${url}?download=1`}>Download complete exact review</a>
      <a className="text-accent underline" href={`${url}?patch=1&download=1`}>Download complete exact patch</a></div> : <p>Open the saved session to read its review attachments.</p>}
    {patch && <SuppliedPatchStack navigation patch={patch} before={before} after={after} contextHandle={contextHandle} pluginId={pluginId} />}
    {(error || patchError) && <div role="alert"><p className="break-words">{error || patchError}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry review</button></div>}
    {available && !page && !error && <p role="status">Loading review…</p>}
    {page && <><p>Showing entries {start + 1}–{start + page.entries.length} of {page.total}.</p>
      {(inline && (patch || !patchError)) || !page.entries.some((entry) => entry.kind === "patch") ? <>
        {page.entries.filter((entry) => entry.kind !== "patch").map((entry) => <EntryRow key={`${review.id}:${entry.id}`} entry={entry} url={url} before={before} after={after} />)}
        <div className="flex gap-3">
          {start > 0 && <button type="button" onClick={() => setStart(Math.max(0, start - 40))}>Previous files</button>}
          {page.next !== null && <button type="button" onClick={() => setStart(page.next!)}>Next files</button>}
        </div>
      </> : <ReviewFileBrowser paged hasPatches={page.entries.some((entry) => entry.kind === "patch")}
        files={page.entries.map((entry) => ({ id: String(entry.id), label: entry.label, description: `${entry.bytes.toLocaleString()} bytes` }))}
        pagination={<>
          {start > 0 && <button type="button" onClick={() => setStart(Math.max(0, start - 40))}>Previous files</button>}
          {page.next !== null && <button type="button" onClick={() => setStart(page.next!)}>Next files</button>}
        </>}>
        {(selected, preferences) => <EntryContent key={`${review.id}:${selected.id}`} entry={page.entries.find((entry) => String(entry.id) === selected.id)!}
          url={url} before={before} after={after} preferences={preferences} reviews={reviews.current} offsets={offsets.current} />}
      </ReviewFileBrowser>}</>}
  </section>;
}
