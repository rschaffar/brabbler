"use client";

import { useEffect, useState } from "react";
import type { PluginReviewReference } from "@/lib/plugins/types";
import { SuppliedPatchStack } from "../GitPatchStack";

interface Entry { id: number; label: string; kind: "text" | "patch"; bytes: number; sha256: string }
interface Page { entries: Entry[]; total: number; next: number | null }
interface Preview { text: string; offset: number; next: number | null; complete: boolean }
function EntryContent({ entry, url, before, after }: { entry: Entry; url: string; before: string; after: string }) {
  const [offset, setOffset] = useState(0);
  const [value, setValue] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${url}?entry=${entry.id}&offset=${offset}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as Preview; })
      .then((body) => { if (!controller.signal.aborted) { setValue(body); setError(""); } }, (cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [url, entry.id, offset]);
  return <div className="min-w-0 space-y-2 p-2">
    <a className="text-accent underline" href={`${url}?entry=${entry.id}&download=1`}>Download exact entry ({entry.bytes.toLocaleString()} bytes)</a>
    {error && <p role="alert" className="break-words">{error}</p>}
    {!value && !error && <p role="status">Loading review…</p>}
    {value && (value.complete && entry.kind === "patch"
      ? <SuppliedPatchStack patch={value.text} before={before} after={after} />
      : <><p className="text-text-muted">{value.complete ? "Exact details" : `Raw preview at byte ${value.offset.toLocaleString()}. Display is paged; download contains every byte.`}</p>
        <pre className="max-h-[44vh] overflow-auto whitespace-pre font-mono text-xs">{value.text}</pre>
        <div className="flex gap-3">
          {offset > 0 && <button type="button" onClick={() => setOffset(Math.max(0, offset - 256 * 1024))}>Previous content</button>}
          {value.next !== null && <button type="button" onClick={() => setOffset(value.next!)}>Next content</button>}
        </div></>)}
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
export function ReviewAttachment({ review, sessionId, before = "Before", after = "After", contextHandle, pluginId }: {
  review: PluginReviewReference; sessionId?: string; before?: string; after?: string; contextHandle?: string; pluginId?: string;
}) {
  const [start, setStart] = useState(0), [retry, setRetry] = useState(0);
  const [page, setPage] = useState<Page | null>(null), [error, setError] = useState("");
  const [patch, setPatch] = useState<string | null>(null);
  const inline = review.bytes <= 256 * 1024;
  const url = `/api/sessions/${encodeURIComponent(sessionId ?? "")}/reviews/${review.id}`;
  useEffect(() => {
    if (!sessionId) return;
    const controller = new AbortController();
    void fetch(`${url}?start=${start}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); return body as Page; })
      .then((body) => { if (!controller.signal.aborted) { setPage(body); setError(""); } }, (cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [url, sessionId, start, retry]);
  useEffect(() => {
    if (!sessionId || !inline) return;
    const controller = new AbortController();
    void fetch(`${url}?patch=1`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Exact patch unavailable");
      return response.text();
    }).then((text) => { if (!controller.signal.aborted) setPatch(text); }, (cause) => { if (!controller.signal.aborted) setError(String(cause)); });
    return () => controller.abort();
  }, [url, sessionId, inline, retry]);
  return <section aria-label="Exact operation review" className="min-w-0 space-y-2 text-xs">
    <h3 className="blocking-card-section-title">Exact operation review</h3>
    <p>{review.entries.toLocaleString()} review entries · {review.bytes.toLocaleString()} bytes. Approval covers the entire operation, not just this page.</p>
    {sessionId ? <div className="flex flex-wrap gap-3"><a className="text-accent underline" href={`${url}?download=1`}>Download complete exact review</a>
      <a className="text-accent underline" href={`${url}?patch=1&download=1`}>Download complete exact patch</a></div> : <p>Open the saved session to read its review attachments.</p>}
    {patch && <SuppliedPatchStack patch={patch} before={before} after={after} contextHandle={contextHandle} pluginId={pluginId} />}
    {error && <div role="alert"><p className="break-words">{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry review</button></div>}
    {page && <><p>Showing entries {start + 1}–{start + page.entries.length} of {page.total}.</p>
      {page.entries.filter((entry) => !patch || entry.kind !== "patch").map((entry) => <EntryRow key={`${review.id}:${entry.id}`} entry={entry} url={url} before={before} after={after} />)}
      <div className="flex gap-3">
        {start > 0 && <button type="button" onClick={() => setStart(Math.max(0, start - 40))}>Previous files</button>}
        {page.next !== null && <button type="button" onClick={() => setStart(page.next!)}>Next files</button>}
      </div></>}
  </section>;
}
