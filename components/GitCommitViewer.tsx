"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { ExplorerFile } from "@/lib/git-explorer";
import { copyText } from "@/lib/clipboard";
import type { DiffContext } from "@/lib/diff-context";

// Keep the diff parser/renderer out of the normal chat and sidebar bundles.
const GitPatchStack = dynamic(() => import("./GitPatchStack").then((module) => module.GitPatchStack), {
  ssr: false,
  loading: () => <p role="status" className="mt-2 text-xs text-text-muted">Preparing diff…</p>,
});

type Detail = { oid: string; parents: string[]; author: string; date: string; message: string; files: ExplorerFile[] };
type Patch = { patch: string; hasBinaryChanges: boolean };
const FILE_STATUS: Record<string, string> = { A: "Added", M: "Modified", D: "Deleted", T: "Type changed", C: "Copied", U: "Unmerged" };
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
  const files = useMemo(() => detail?.files.map((file) => ({ id: file.path, path: file.path, status: FILE_STATUS[file.status] ?? file.status })) ?? [], [detail]);
  const loadPatch = useCallback((path: string, signal: AbortSignal) =>
    load<Patch>(url(cwd, "patch", { branch, head, oid, path }), signal), [cwd, branch, head, oid]);
  const loadContext = useCallback((path: string, signal: AbortSignal) =>
    load<DiffContext>(url(cwd, "context", { branch, head, oid, path }), signal), [cwd, branch, head, oid]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setDetailError(null);
    void load<Detail>(url(cwd, "commit", { branch, head, oid }), controller.signal)
      .then((result) => { if (!controller.signal.aborted) setDetail(result); })
      .catch((cause) => { if (!controller.signal.aborted) setDetailError(message(cause)); });
    return () => controller.abort();
  }, [cwd, branch, head, oid]);
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
      <p className="mt-2 text-xs text-text-muted">{detail.author} · {new Date(detail.date).toLocaleString("en")}</p>
      {detail.parents.length > 1 && <p className="mt-2 text-xs text-text-muted">Merge commit · changes vs first parent</p>}
      <div className="mt-5 min-w-0">
        {files.length === 0 ? <p className="text-xs text-text-muted">No changes against the first parent.</p>
          : <GitPatchStack key={`${branch}:${head}:${oid}`} files={files} loadPatch={loadPatch} loadContext={loadContext}
            before={detail.parents[0]?.slice(0, 8) ?? "empty tree"} after={oid.slice(0, 8)} />}
      </div>
    </>}
  </section>;
}
