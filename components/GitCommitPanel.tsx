"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GitFileDiffResponse, GitFileStatus, GitStatusResponse } from "@/lib/git-types";
import type { GitCommitPreview, GitCommitResult } from "@/lib/git-commit";
import type { GitReviewDiff } from "@/lib/git-review";

type CommitCandidate = { actionId: string; preview: GitCommitPreview } & (
  | { candidateDiff: GitReviewDiff; candidateDiffUnavailable?: never }
  | { candidateDiff?: never; candidateDiffUnavailable: string }
);

type CommitResponse = GitCommitResult & { actionId: string; recoveryWarning?: string };
type Props = { sessionId: string; cwd: string; busy: boolean };

function sameCheckoutPath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/$/, "");
  const a = normalize(left);
  const b = normalize(right);
  return /^[a-z]:\//i.test(a) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function relativePath(root: string, file: string): string {
  const base = root.replace(/\\/g, "/").replace(/\/$/, "");
  const target = file.replace(/\\/g, "/");
  return target.slice(base.length + 1);
}

async function responseBody<T>(response: Response, sessionId?: string): Promise<T> {
  const body = await response.json() as T & { error?: string; recoveryRequired?: boolean; recoveryWarning?: string };
  // Idle sessions may have no SSE connection. Reconcile anchors even on an anchored refusal.
  if (sessionId) window.dispatchEvent(new CustomEvent("pi-web:git-actions-changed", { detail: { sessionId } }));
  if (!response.ok && body.recoveryRequired) throw new Error(body.recoveryWarning ?? body.error ?? "Manual recovery required; do not retry.");
  if (!response.ok) throw new Error(response.status === 409
    ? `${body.error ?? "Checkout changed"}. Preview is stale; refresh status and preview again.`
    : body.error ?? `HTTP ${response.status}`);
  return body;
}

function FileDiff({ cwd, file }: { cwd: string; file: GitFileStatus }) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<GitFileDiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    void fetch(`/api/git/diff?${new URLSearchParams({ cwd, path: file.filePath })}`, {
      cache: "no-store", signal: controller.signal,
    }).then(responseBody<GitFileDiffResponse>).then((value) => {
      if (!controller.signal.aborted) setDiff(value);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => controller.abort();
  }, [cwd, file.filePath, expanded]);
  return (
    <div className="min-w-0 pl-6">
      <button type="button" className="text-xs text-accent hover:underline" aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}>{expanded ? "Hide" : "Show"} non-authoritative working-tree diff</button>
      {expanded && <div className="mt-1 text-xs" aria-live="polite">
        {error ? <span role="alert" className="text-red-400">Diff unavailable: {error}</span>
          : !diff ? "Loading diff…"
            : !diff.supported || !diff.patch ? <span className="text-amber-500">Diff unsupported (binary, large, non-regular or unavailable file). The whole file may still be committed.</span>
              : <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-bg p-2 font-mono text-text">{diff.patch}</pre>}
      </div>}
    </div>
  );
}

/** A deliberate human review surface; the read-only diff is NOT the commit candidate. */
export function GitCommitPanel({ sessionId, cwd, busy }: Props) {
  const [status, setStatus] = useState<GitStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState<CommitCandidate | null>(null);
  const preview = candidate?.preview ?? null;
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<"preview" | "confirm" | null>(null);
  const operationRef = useRef(false);
  // Invalidate pending HTTP responses as well as already displayed previews on edits/refresh.
  const generation = useRef(0);
  const invalidate = () => { generation.current++; setCandidate(null); };

  useEffect(() => {
    if (busy) { generation.current++; setCandidate(null); }
  }, [busy]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/git/status?${new URLSearchParams({ cwd })}`, { cache: "no-store", signal: controller.signal })
      .then(responseBody<GitStatusResponse>).then((value) => {
        if (!controller.signal.aborted) { setStatus(value); setStatusError(null); }
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) { setStatus(null); setStatusError(cause instanceof Error ? cause.message : String(cause)); }
      });
    return () => controller.abort();
  }, [cwd, revision]);

  const refresh = () => {
    invalidate();
    setStatus(null);
    setSelected([]);
    setRevision((value) => value + 1);
  };
  const disabled = busy || operation !== null;
  const root = status?.repositoryRoot;
  // The commit endpoint only accepts a session whose cwd is the physical checkout root.
  const atRoot = Boolean(root && sameCheckoutPath(root, cwd));
  const available = Boolean(status?.isGitRepository && atRoot);

  async function submitPreview(event: FormEvent) {
    event.preventDefault();
    if (disabled || !available || !selected.length || !message.trim() || operationRef.current) return;
    operationRef.current = true;
    const version = ++generation.current;
    setOperation("preview"); setCandidate(null); setError(null);
    try {
      const response = await fetch("/api/git/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "preview", sessionId, paths: selected, message }),
      });
      const body = await responseBody<CommitCandidate>(response, sessionId);
      if (generation.current === version) setCandidate(body);
    } catch (cause) {
      if (generation.current === version) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { operationRef.current = false; setOperation(null); }
  }

  async function confirm() {
    if (disabled || !preview || !candidate?.actionId || !message.trim() || operationRef.current) return;
    operationRef.current = true;
    const version = ++generation.current;
    setOperation("confirm"); setError(null);
    try {
      const response = await fetch("/api/git/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "confirm", sessionId, preview, message, actionId: candidate.actionId }),
      });
      const body = await responseBody<CommitResponse>(response, sessionId);
      // Even if another UI action happened during the request, never hide a created commit.
      setResult(body);
      setCandidate(null);
      setSelected([]);
      setStatus(null);
      setRevision((value) => value + 1);
    } catch (cause) {
      if (generation.current === version) {
        setCandidate(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally { operationRef.current = false; setOperation(null); }
  }

  return <section className="git-panel-content min-w-0 text-sm text-text" aria-label="Review & commit panel">
    <div className="space-y-2">
      <p className="text-xs text-text-muted">Session checkout: <span className="break-all font-mono">{cwd}</span>. Nothing is staged or committed until you confirm.</p>
      <button type="button" disabled={operation !== null} onClick={refresh} className="text-xs text-accent hover:underline disabled:opacity-50">Refresh changed files</button>
      {statusError && <p role="alert" className="text-red-400">Status unavailable: {statusError}</p>}
      {!status && !statusError && <p role="status">Loading changed files…</p>}
      {status && !status.isGitRepository && <p>Not a Git repository.</p>}
      {status?.isGitRepository && !atRoot && <p role="alert" className="text-amber-500">This session cwd is not the checkout root ({root}). Commit preview requires a session at the checkout root.</p>}
      {status?.isGitRepository && root && <form onSubmit={(event) => void submitPreview(event)} className="space-y-2">
        <p className="text-xs text-text-muted">Select complete changed files (none selected by default). Staged changes or conflicts may make preview unavailable.</p>
        {status.files.length === 0 ? <p>No changed files.</p> : <ul className="space-y-1">
          {status.files.map((file) => {
            const path = relativePath(root!, file.filePath);
            return <li key={file.filePath} className="min-w-0 rounded border border-border px-2 py-1">
              <label className="flex min-w-0 items-start gap-2">
                <input type="checkbox" className="mt-1" checked={selected.includes(path)} disabled={disabled}
                  onChange={(event) => { invalidate(); setSelected((old) => event.target.checked ? [...old, path] : old.filter((item) => item !== path)); }} />
                <span className="min-w-0 break-all font-mono text-xs">{path} <span className="font-sans text-text-muted">({file.status}; index {file.indexStatus}, worktree {file.worktreeStatus})</span></span>
              </label>
              <FileDiff key={`${revision}:${file.filePath}`} cwd={cwd} file={file} />
            </li>;
          })}
        </ul>}
        <p className="text-xs text-amber-500">Working-tree diffs above are read-only aids, NOT the authoritative commit candidate. Preview identifies the exact whole-file tree; selected files include all their contents, not just visible hunks. Binary, large and unsupported diffs may have no patch here.</p>
        <label className="block text-xs">Commit message
          <textarea value={message} disabled={disabled} rows={3} onChange={(event) => { invalidate(); setMessage(event.target.value); }}
            className="mt-1 block w-full rounded border border-border bg-bg p-2 text-text disabled:opacity-50" />
        </label>
        <button type="submit" disabled={disabled || !available || !selected.length || !message.trim()} className="rounded border border-border px-3 py-1 text-accent disabled:opacity-50">{operation === "preview" ? "Preparing…" : "Preview"}</button>
      </form>}
      {preview && available && <div className="space-y-2 rounded border border-amber-500/50 p-3" aria-label="Commit preview">
        <strong>Review exact commit candidate</strong>
        <p className="text-xs text-amber-500">Whole files will be committed. Diffs above are not the candidate and unsupported diffs do not exclude a file. Re-preview if the checkout changes.</p>
        <dl className="space-y-1 break-all font-mono text-xs">
          <dt>Branch</dt><dd>{preview.branch}</dd><dt>HEAD (parent)</dt><dd>{preview.head}</dd><dt>Candidate tree</dt><dd>{preview.tree}</dd>
          <dt>Exact review token</dt><dd>{preview.reviewToken}</dd>
          <dt>Exact selected paths</dt><dd><ul>{preview.paths.map((path) => <li key={path}>{path}</li>)}</ul></dd>
        </dl>
        {candidate?.candidateDiff && <div className="space-y-1 text-xs" aria-label="Authoritative candidate patch">
          <strong>Authoritative candidate patch (HEAD tree → candidate tree)</strong>
          {candidate.candidateDiff.hasBinaryChanges && <p className="text-amber-500">Binary changes are included in the candidate; the patch shows summaries, not binary contents.</p>}
          {candidate.candidateDiff.patch
            ? <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded border border-border bg-bg p-2 font-mono text-text">{candidate.candidateDiff.patch}</pre>
            : <p>No textual changes between these trees.</p>}
        </div>}
        {candidate?.candidateDiffUnavailable && <p role="alert" className="text-xs text-amber-500">Authoritative candidate patch unavailable: {candidate.candidateDiffUnavailable} The working-tree diffs above are not a substitute.</p>}
        <p className="whitespace-pre-wrap break-words text-xs">Message: {message}</p>
        <button type="button" disabled={disabled} onClick={() => void confirm()} className="rounded border border-amber-500 px-3 py-1 font-medium text-text disabled:opacity-50">{operation === "confirm" ? "Committing…" : "Confirm commit"}</button>
      </div>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {result && <div role="status" className="space-y-1 rounded border border-border p-2 text-xs">
        <strong>{result.status === "partial-success" ? "Last commit: partial success — commit created; checkout finalization failed" : "Last commit created"}</strong>
        {result.status === "partial-success" && <p className="text-amber-500">{result.reason}. Inspect the checkout before further changes; do not retry blindly.</p>}
        {result.recoveryWarning && <p role="alert" className="text-amber-500">{result.recoveryWarning}</p>}
        <dl className="break-all font-mono"><dt>Commit ID</dt><dd>{result.commit}</dd><dt>Tree</dt><dd>{result.tree}</dd><dt>Parent(s)</dt><dd>{result.parents.join(", ") || "none"}</dd><dt>Author email</dt><dd>{result.authorEmail}</dd></dl>
      </div>}
    </div>
  </section>;
}
