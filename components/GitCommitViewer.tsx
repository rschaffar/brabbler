"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { ExplorerFile } from "@/lib/git-explorer";
import { copyText } from "@/lib/clipboard";

// Keep the diff parser/renderer out of the normal chat and sidebar bundles.
const CommittedPatchDiff = dynamic(() => import("./CommittedPatchDiff").then((module) => module.CommittedPatchDiff), {
  ssr: false,
  loading: () => <p role="status" className="mt-2 text-xs text-text-muted">Preparing diff…</p>,
});

type Detail = { oid: string; parents: string[]; author: string; date: string; message: string; files: ExplorerFile[] };
type Patch = { patch: string; hasBinaryChanges: boolean };
function url(cwd: string, op: string, extra: Record<string, string>) {
  return `/api/git/explorer?${new URLSearchParams({ cwd, op, ...extra })}`;
}
async function load<T>(address: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(address, { cache: "no-store", signal });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body;
}
function message(error: unknown) { return error instanceof Error ? error.message : "Commit unavailable"; }

function CopyCommitField({ label, value }: { label: string; value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => { setStatus("idle"); }, [value]);
  return <button type="button" className="git-commit-copy" aria-live="polite"
    aria-label={status === "copied" ? `Copied ${label}` : status === "failed" ? `Copy ${label} failed; retry` : `Copy ${label}`}
    title={`Copy ${label}`}
    onClick={() => void copyText(value).then(() => setStatus("copied"), () => setStatus("failed"))}>
    {status === "copied" ? "Copied" : status === "failed" ? "Retry copy" : "Copy"}
  </button>;
}

/** Committed objects only. Never reads the working tree or authorizes a Git action. */
export function GitCommitViewer({ cwd, branch, head, oid }: { cwd: string; branch: string; head: string; oid: string }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [patch, setPatch] = useState<{ path: string; value: Patch } | null>(null);
  const [patchError, setPatchError] = useState<{ path: string; message: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setDetailError(null); setSelectedPath(null);
    void load<Detail>(url(cwd, "commit", { branch, head, oid }), controller.signal)
      .then((result) => { if (!controller.signal.aborted) setDetail(result); })
      .catch((cause) => { if (!controller.signal.aborted) setDetailError(message(cause)); });
    return () => controller.abort();
  }, [cwd, branch, head, oid]);
  useEffect(() => {
    const controller = new AbortController();
    setPatch(null); setPatchError(null);
    if (selectedPath) {
      void load<Patch>(url(cwd, "patch", { branch, head, oid, path: selectedPath }), controller.signal)
        .then((result) => { if (!controller.signal.aborted) setPatch({ path: selectedPath, value: result }); })
        .catch((cause) => { if (!controller.signal.aborted) setPatchError({ path: selectedPath, message: message(cause) }); });
    }
    return () => controller.abort();
  }, [cwd, branch, head, oid, selectedPath]);

  const activePatch = patch?.path === selectedPath ? patch.value : null;
  const activeError = patchError?.path === selectedPath ? patchError.message : null;
  return <section aria-label="Git commit details" className="h-full min-w-0 overflow-auto p-4 text-sm text-text">
    <p className="mb-2 text-xs text-text-muted">Read-only committed history · {cwd}</p>
    <div className="git-commit-copy-row">
      <p className="min-w-0 break-all font-mono text-xs text-text-muted">{oid}</p>
      <CopyCommitField label="commit ID" value={oid} />
    </div>
    {detailError && <p role="alert" className="mt-3 text-red-400">{detailError}</p>}
    {!detail && !detailError && <p role="status" className="mt-3 text-text-muted">Loading commit…</p>}
    {detail && <>
      <div className="git-commit-copy-row mt-3">
        <p className="min-w-0 whitespace-pre-wrap break-words text-text">{detail.message}</p>
        <CopyCommitField label="commit message" value={detail.message} />
      </div>
      <p className="mt-2 text-xs text-text-muted">{detail.author} · {new Date(detail.date).toLocaleString()}</p>
      {detail.parents.length > 1 && <p className="mt-2 text-xs text-text-muted">Merge commit · changes vs first parent</p>}
      <h2 className="mt-5 font-semibold">Changed files ({detail.files.length})</h2>
      {detail.files.length === 0 && <p className="mt-2 text-xs text-text-muted">No changes against the first parent.</p>}
      <div className="mt-2 max-h-48 overflow-auto rounded border border-border">
        {detail.files.map((file) => <button type="button" key={file.path} aria-pressed={selectedPath === file.path}
          onClick={() => setSelectedPath(file.path)} className="flex w-full min-w-0 gap-3 border-b border-border p-2 text-left text-accent hover:bg-bg-hover aria-pressed:bg-bg-selected">
          <span className="shrink-0 font-mono text-text-muted">{file.status}</span><span className="break-all">{file.path}</span>
        </button>)}
      </div>
      {selectedPath && <div className="mt-5 min-w-0">
        <h3 className="break-all font-medium">{selectedPath}</h3>
        {activeError && <p role="alert" className="mt-2 text-red-400">{activeError}</p>}
        {!activePatch && !activeError && <p role="status" className="mt-2 text-text-muted">Loading patch…</p>}
        {activePatch && <CommittedPatchDiff key={selectedPath} patch={activePatch.patch}
          hasBinaryChanges={activePatch.hasBinaryChanges}
          before={detail.parents[0]?.slice(0, 8) ?? "empty tree"} after={oid.slice(0, 8)} />}
      </div>}
    </>}
  </section>;
}
