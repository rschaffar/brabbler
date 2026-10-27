"use client";

import { useEffect, useRef, useState } from "react";
import { notebookAssetHasSignature, notebookAssetLimit, notebookAssetMime } from "@/lib/guided-review-assets";
import { ImagePreview } from "./ImagePreview";
import { NativeDocumentPreview } from "./NativeDocumentPreview";

/** Only selected local assets mount this owner. Never accepts an authored browser URL.
 * One bounded, authorized response becomes a private typed blob snapshot, revoked on exit. */
export function NotebookBinaryEvidence({ indexPath, path, title, onWork, onSnapshot }: {
  indexPath: string; path: string; title: string; onWork?: (work: Promise<unknown>) => void; onSnapshot?: (contentDigest: string | null) => void;
}) {
  const [src, setSrc] = useState<string | null>(null), [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0), observer = useRef(onWork); observer.current = onWork;
  const snapshotObserver = useRef(onSnapshot); snapshotObserver.current = onSnapshot;
  const mime = notebookAssetMime(path);
  useEffect(() => {
    const controller = new AbortController(); let snapshot: string | undefined;
    setSrc(null); setError(null); snapshotObserver.current?.(null);
    const work = (async () => {
      if (!mime) throw new Error("Unsupported binary evidence");
      const response = await fetch(`/api/review-notebook?${new URLSearchParams({ index: indexPath, asset: path })}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error ?? `HTTP ${response.status}`); }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      if (blob.type !== mime || blob.size > notebookAssetLimit(mime)) throw new Error("Evidence MIME or byte limit mismatch");
      const bytes = await blob.arrayBuffer();
      if (controller.signal.aborted) return;
      if (!notebookAssetHasSignature(new Uint8Array(bytes), mime)) throw new Error("Evidence format mismatch");
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (controller.signal.aborted) return;
      snapshotObserver.current?.(digest);
      snapshot = URL.createObjectURL(new Blob([bytes], { type: mime }));
      setSrc(snapshot);
    })().catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Binary evidence unavailable"); });
    observer.current?.(work);
    return () => { controller.abort(); if (snapshot) URL.revokeObjectURL(snapshot); };
  }, [indexPath, path, mime, retry]);
  return <div className="guided-binary-evidence">
    <p>Mutable working asset · {path} · snapshot read, no watching</p>
    {error ? <p role="alert">{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry evidence</button></p>
      : !src ? <p role="status">Loading evidence…</p> : <>
        {mime === "application/pdf" ? <div style={{ height: "65vh", minHeight: 240 }}><NativeDocumentPreview src={src} title={title} pdf /></div>
          : <ImagePreview src={src} alt={title}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={title} style={{ display: "block", maxWidth: "100%", height: "auto" }} onError={() => { snapshotObserver.current?.(null); setError("Image could not be decoded"); }} />
          </ImagePreview>}
        <a href={src} download={path.split("/").at(-1)}>Download this snapshot</a>
        {mime === "application/pdf" && <p>Native PDF preview; use Download if unavailable. No PDF selection anchors.</p>}
      </>}
  </div>;
}
