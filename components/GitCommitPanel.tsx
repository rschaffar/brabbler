"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { GitFileDiffResponse, GitFileStatus, GitStatusResponse } from "@/lib/git-types";
import type { GitCommitPreview, GitCommitResult } from "@/lib/git-commit";
import type { GitReviewDiff } from "@/lib/git-review";

type Receipt = { id: string; checkIndex: number; finishedAt: number; expiresAt: number; freshness: "current" };
type CheckRequirements = { revision: string; status: "required" | "no-defined" | "no-required";
  evidenceScope: "working-workspace"; candidateTreeVerified: false; repositoryChecksWaived: false;
  checks: { checkIndex: number; label: string }[]; receipts: Receipt[] };
type CheckPreview = { previewId: string; revision: string; source: string; expiresAt: number;
  checks: { checkIndex: number; label: string; argv: string[]; cwd: string; envOverrides: Record<string, string>; environmentDigest: string }[] };
type CommitCandidate = { actionId: string; expiresAt: number; preview: GitCommitPreview; verification: { receiptIds: string[] } } & (
  | { candidateDiff: GitReviewDiff; candidateDiffUnavailable?: never }
  | { candidateDiff?: never; candidateDiffUnavailable: string }
);

type CommitResponse = GitCommitResult & { actionId: string; recoveryWarning?: string; diagnosticsUnavailable?: boolean };
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
  const [mode, setMode] = useState<"whole-file" | "staged">("whole-file");
  const [message, setMessage] = useState("");
  const [candidate, setCandidate] = useState<CommitCandidate | null>(null);
  const preview = candidate?.preview ?? null;
  const [result, setResult] = useState<CommitResponse | null>(null);
  const [resultCwd, setResultCwd] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [operation, setOperation] = useState<"preview" | "confirm" | "check-preview" | "check-run" | "check-status" | "decline" | null>(null);
  const [requirements, setRequirements] = useState<CheckRequirements | null>(null);
  const [requirementsError, setRequirementsError] = useState<string | null>(null);
  const [checkIndexes, setCheckIndexes] = useState<number[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [checkPreview, setCheckPreview] = useState<CheckPreview | null>(null);
  const checkRun = useRef<AbortController | null>(null);
  const operationRef = useRef(false);
  // Invalidate pending HTTP responses as well as already displayed previews on edits/refresh.
  const generation = useRef(0);
  const invalidate = () => { generation.current++; setCandidate(null); setReceipts([]); setCheckPreview(null); };

  useEffect(() => {
    if (busy) { generation.current++; setCandidate(null); setReceipts([]); setCheckPreview(null); checkRun.current?.abort(); }
  }, [busy]);

  useEffect(() => {
    setSelected([]); setMessage(""); setMode("whole-file");
  }, [sessionId, cwd]);

  useEffect(() => {
    generation.current++;
    setCandidate(null); setReceipts([]); setCheckPreview(null); setRequirements(null); setRequirementsError(null);
    const version = generation.current;
    const controller = new AbortController();
    void fetch(`/api/git/verification?${new URLSearchParams({ sessionId })}`, { cache: "no-store", signal: controller.signal })
      .then((response) => responseBody<CheckRequirements>(response)).then((body) => {
        if (!controller.signal.aborted) {
          setRequirements(body); setCheckIndexes(body.checks.map((check) => check.checkIndex));
          if (generation.current === version) setReceipts(body.receipts);
        }
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) setRequirementsError(cause instanceof Error ? cause.message : String(cause));
      });
    const retireScope = () => { checkRun.current?.abort(); generation.current++; };
    return () => { controller.abort(); retireScope(); };
  }, [sessionId, cwd, revision]);

  useEffect(() => {
    if (!receipts.length && !checkPreview && !candidate) return;
    const timer = setInterval(() => {
      if (receipts.some((receipt) => receipt.expiresAt <= Date.now()) ||
        checkPreview && checkPreview.expiresAt <= Date.now() || candidate && candidate.expiresAt <= Date.now()) {
        generation.current++; setCandidate(null); setReceipts([]); setCheckPreview(null);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [receipts, checkPreview, candidate]);

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
  const checksReady = Boolean(requirements && requirements.checks.every((check) => receipts.some((receipt) =>
    receipt.checkIndex === check.checkIndex && receipt.expiresAt > Date.now())));
  const receiptIds = requirements?.checks.map((check) => receipts.find((receipt) => receipt.checkIndex === check.checkIndex)?.id)
    .filter((id): id is string => Boolean(id)) ?? [];

  async function checksRequest(op: "check-preview" | "check-run" | "check-status" | "decline") {
    if (disabled || operationRef.current || !requirements || op === "check-preview" && !checkIndexes.length ||
      (op === "check-run" || op === "decline") && (!checkPreview || checkPreview.expiresAt <= Date.now())) return;
    operationRef.current = true;
    const version = ++generation.current;
    const controller = new AbortController();
    if (op === "check-run") checkRun.current = controller;
    setOperation(op); setCandidate(null); setError(null);
    try {
      if (op === "check-status") {
        const response = await fetch(`/api/git/verification?${new URLSearchParams({ sessionId })}`, { cache: "no-store", signal: controller.signal });
        const body = await responseBody<CheckRequirements>(response, sessionId);
        if (generation.current === version) {
          setRequirements(body); setReceipts(body.receipts); setCheckPreview(null);
          setCheckIndexes(body.checks.map((check) => check.checkIndex));
        }
      } else {
        const input = op === "check-preview" ? { sessionId, operation: "preview", checkIndexes }
          : { sessionId, operation: op === "check-run" ? "run" : "decline", previewId: checkPreview!.previewId, revision: checkPreview!.revision };
        // Consent consumes the preview; its deadline is not a run deadline.
        // Capture the exact request first, then retire the local capability so
        // its expiry timer cannot invalidate an already-awaited native result.
        if (op === "check-run") setCheckPreview(null);
        const response = await fetch("/api/git/verification", { method: "POST", headers: { "Content-Type": "application/json" },
          signal: controller.signal, body: JSON.stringify(input) });
        const body = await responseBody<CheckPreview & { receipts?: Receipt[] }>(response, sessionId);
        if (generation.current === version && !controller.signal.aborted) {
          if (op === "check-preview") setCheckPreview(body);
          else { setCheckPreview(null); if (body.receipts) setReceipts((old) => [...old.filter((r) => !body.receipts!.some((n) => n.checkIndex === r.checkIndex)), ...body.receipts!]); }
        }
      }
    } catch (cause) {
      if (generation.current === version) { setReceipts([]); setCheckPreview(null); setError(controller.signal.aborted
        ? "Checks cancelled. Inspect the working workspace and recovery history before retrying." : cause instanceof Error ? cause.message : String(cause)); }
    } finally { if (checkRun.current === controller) checkRun.current = null; operationRef.current = false; setOperation(null); }
  }

  async function submitPreview(event: FormEvent) {
    event.preventDefault();
    if (disabled || !available || !checksReady || !selected.length || !message.trim() || operationRef.current) return;
    const paths = mode === "staged" ? [...new Set(selected.flatMap((picked) => {
      const file = status?.files.find((entry) => relativePath(root!, entry.filePath) === picked);
      return file?.indexStatus === "R" && file.originalFilePath
        ? [relativePath(root!, file.originalFilePath), picked] : [picked];
    }))] : selected;
    operationRef.current = true;
    const version = ++generation.current;
    setOperation("preview"); setCandidate(null); setError(null);
    try {
      const response = await fetch("/api/git/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "preview", sessionId, paths, mode, message, receiptIds }),
      });
      const body = await responseBody<CommitCandidate>(response, sessionId);
      if (generation.current === version) setCandidate(body);
    } catch (cause) {
      if (generation.current === version) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { operationRef.current = false; setOperation(null); }
  }

  async function confirm() {
    if (disabled || !checksReady || !preview || !candidate?.actionId || !message.trim() || operationRef.current) return;
    operationRef.current = true;
    const version = ++generation.current;
    setOperation("confirm"); setError(null);
    try {
      const response = await fetch("/api/git/commit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operation: "confirm", sessionId, preview, message, actionId: candidate.actionId, receiptIds: candidate.verification.receiptIds }),
      });
      const body = await responseBody<CommitResponse>(response, sessionId);
      // Even if another UI action happened during the request, never hide a created commit.
      setResult(body); setResultCwd(cwd);
      if (generation.current === version) {
        setCandidate(null);
        setReceipts([]); setCheckPreview(null);
        setSelected([]);
        setStatus(null);
        setRevision((value) => value + 1);
      }
    } catch (cause) {
      if (generation.current === version) {
        setCandidate(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally { operationRef.current = false; setOperation(null); }
  }

  return <section className="git-panel-content min-w-0 text-sm text-text" aria-label="Review & commit panel" data-testid="git-commit-panel">
    <div className="space-y-2">
      <p className="text-xs text-text-muted">Session checkout: <span className="break-all font-mono">{cwd}</span>. Preview changes no index or ref; staged mode uses content already staged before confirmation.</p>
      <button type="button" disabled={operation !== null} onClick={refresh} className="text-xs text-accent hover:underline disabled:opacity-50">Refresh changed files</button>
      <div className="space-y-2 rounded border border-border p-2" aria-label="Commit prerequisites" data-testid="git-commit-prerequisites">
        <strong>Required commit-stage checks</strong>
        <p className="text-xs text-amber-500">Evidence scope: working-workspace. Checks bind current dirty file bytes and index, NOT the selected commit tree (candidateTreeVerified: false). Repository checks are not waived (repositoryChecksWaived: false); project instructions still apply when no prerequisite is configured.</p>
        {requirementsError && <p role="alert" className="text-red-400">Requirements unavailable: {requirementsError}</p>}
        {!requirements && !requirementsError && <p role="status">Loading prerequisites…</p>}
        {requirements && !requirements.checks.length && <p className="text-xs">{requirements.status === "no-defined"
          ? "No verification recipes are defined (no-defined)."
          : "No configured recipe is required at commit stage (no-required); omitted stages mean integration."} This is not a waiver of project instructions.</p>}
        {requirements && <ul className="space-y-1 text-xs">{requirements.checks.map((check) => {
          const receipt = receipts.find((r) => r.checkIndex === check.checkIndex);
          return <li key={check.checkIndex}><label><input data-testid={`git-commit-required-check-${check.checkIndex}`} type="checkbox" checked={checkIndexes.includes(check.checkIndex)} disabled={disabled}
            onChange={(event) => { invalidate(); setCheckIndexes((old) => event.target.checked ? [...old, check.checkIndex] : old.filter((i) => i !== check.checkIndex)); }} /> {check.label} (saved index {check.checkIndex})</label>
            <span data-testid={`git-commit-check-freshness-${check.checkIndex}`} className="ml-2">{receipt ? `Current evidence; expires ${new Date(receipt.expiresAt).toLocaleTimeString()}` : "Missing or stale evidence"}</span></li>;
        })}</ul>}
        <button data-testid="git-commit-check-preview" type="button" disabled={disabled || !requirements || !checkIndexes.length} onClick={() => void checksRequest("check-preview")}
          className="rounded border border-border px-2 py-1 text-accent disabled:opacity-50">Review required check run</button>
        <button data-testid="git-commit-check-status" type="button" disabled={disabled || !requirements} onClick={() => void checksRequest("check-status")}
          className="ml-2 text-xs text-accent disabled:opacity-50">Check evidence freshness</button>
        {checkPreview && <div className="space-y-1 text-xs" aria-label="Check execution preview">
          <p>Run only these exact saved recipes in {checkPreview.source}. Commands may modify files. This approval does not approve or perform a commit.</p>
          <ul>{checkPreview.checks.map((check) => <li key={check.checkIndex} className="break-all font-mono">{check.label}: {JSON.stringify(check.argv)}; cwd: {check.cwd}; saved environment overrides: {JSON.stringify(check.envOverrides)}; sanitized environment digest: {check.environmentDigest}</li>)}</ul>
          <button data-testid="git-commit-check-run" type="button" disabled={disabled || checkPreview.expiresAt <= Date.now()} onClick={() => void checksRequest("check-run")}
            className="rounded border border-amber-500 px-2 py-1">Run selected required checks</button>
          <button data-testid="git-commit-check-decline" type="button" disabled={disabled} onClick={() => void checksRequest("decline")} className="ml-2 text-accent">Decline check run</button>
        </div>}
        {operation === "check-run" && <button data-testid="git-commit-check-cancel" type="button" onClick={() => checkRun.current?.abort()} className="text-accent">Cancel running checks</button>}
      </div>
      {statusError && <p role="alert" className="text-red-400">Status unavailable: {statusError}</p>}
      {!status && !statusError && <p role="status">Loading changed files…</p>}
      {status && !status.isGitRepository && <p>Not a Git repository.</p>}
      {status?.isGitRepository && !atRoot && <p role="alert" className="text-amber-500">This session cwd is not the checkout root ({root}). Commit preview requires a session at the checkout root.</p>}
      {status?.isGitRepository && root && <form onSubmit={(event) => void submitPreview(event)} className="space-y-2">
        <label className="block text-xs">Commit source
          <select data-testid="git-commit-mode" value={mode} disabled={disabled} onChange={(event) => { invalidate(); setSelected([]); setMode(event.target.value as typeof mode); }}
            className="ml-2 rounded border border-border bg-bg p-1 text-text disabled:opacity-50">
            <option value="whole-file">Whole files from working tree</option>
            <option value="staged">Only selected staged index entries</option>
          </select>
        </label>
        <p className="text-xs text-text-muted">{mode === "staged" ? "Select changed index entries. Unstaged changes and unrelated staged entries remain; a staged rename includes both source and destination." : "Select complete changed files (none selected by default). Staged changes or conflicts may make preview unavailable."}</p>
        {status.files.length === 0 ? <p>No changed files.</p> : <ul className="space-y-1">
          {status.files.map((file) => {
            const path = relativePath(root!, file.filePath);
            const unavailable = mode === "staged" && (file.indexStatus === " " || file.indexStatus === "?" || file.status === "conflict" || file.indexStatus === "R" && !file.originalFilePath);
            return <li key={file.filePath} className="min-w-0 rounded border border-border px-2 py-1">
              <label className="flex min-w-0 items-start gap-2">
                <input data-testid={`git-commit-path-${path}`} type="checkbox" className="mt-1" checked={selected.includes(path)} disabled={disabled || unavailable}
                  onChange={(event) => { invalidate(); setSelected((old) => event.target.checked ? [...old, path] : old.filter((item) => item !== path)); }} />
                <span className="min-w-0 break-all font-mono text-xs">{path} <span className="font-sans text-text-muted">({file.status}; index {file.indexStatus}, worktree {file.worktreeStatus})</span></span>
              </label>
              <FileDiff key={`${revision}:${file.filePath}`} cwd={cwd} file={file} />
            </li>;
          })}
        </ul>}
        <p className="text-xs text-amber-500">Working-tree diffs above are read-only aids, NOT the authoritative commit candidate. Preview identifies the exact {mode === "staged" ? "selected index" : "whole-file"} tree. {mode === "staged" ? "Only selected staged content is committed; other staged and unstaged content remains." : "Selected files include all their contents, not just visible hunks."} Binary, large and unsupported diffs may have no patch here.</p>
        <label className="block text-xs">Commit message
          <textarea data-testid="git-commit-message" aria-label="Commit message" value={message} disabled={disabled} rows={3} onChange={(event) => { invalidate(); setMessage(event.target.value); }}
            className="mt-1 block w-full rounded border border-border bg-bg p-2 text-text disabled:opacity-50" />
        </label>
        <button data-testid="git-commit-preview" type="submit" disabled={disabled || !available || !checksReady || !selected.length || !message.trim()} className="rounded border border-border px-3 py-1 text-accent disabled:opacity-50">{operation === "preview" ? "Preparing…" : "Preview"}</button>
      </form>}
      {preview && available && <div className="space-y-2 rounded border border-amber-500/50 p-3" aria-label="Commit preview">
        <strong>Review exact commit candidate</strong>
        <p className="text-xs text-amber-500">{preview.mode === "staged" ? "Only the selected index entries will be committed; other staged and unstaged changes remain." : "Whole files will be committed."} Diffs above are not the candidate and unsupported diffs do not exclude a file. Re-preview if the checkout changes.</p>
        <dl className="space-y-1 break-all font-mono text-xs">
          <dt>Mode</dt><dd>{preview.mode}</dd><dt>Branch</dt><dd>{preview.branch}</dd><dt>HEAD (parent)</dt><dd>{preview.head}</dd><dt>Candidate tree</dt><dd>{preview.tree}</dd>
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
        <button data-testid="git-commit-confirm" type="button" disabled={disabled || !checksReady} onClick={() => void confirm()} className="rounded border border-amber-500 px-3 py-1 font-medium text-text disabled:opacity-50">{operation === "confirm" ? "Committing…" : "Confirm commit"}</button>
      </div>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {result && <div role="status" className="space-y-1 rounded border border-border p-2 text-xs">
        <strong>{result.status === "partial-success" ? "Last commit: partial success — commit created; checkout finalization failed" : "Last commit created"}</strong>
        <p className="break-all">Checkout: {resultCwd}</p>
        {result.status === "partial-success" && <p className="text-amber-500">{result.reason}. Inspect the checkout before further changes; do not retry blindly.</p>}
        {result.recoveryWarning && <p role="alert" className="text-amber-500">{result.recoveryWarning}</p>}
        {result.diagnosticsUnavailable && !result.recoveryWarning && <p className="text-amber-500">Commit created; some outcome diagnostics are unavailable. Do not repeat this operation.</p>}
        <dl className="break-all font-mono"><dt>Commit ID</dt><dd>{result.commit}</dd><dt>Tree</dt><dd>{result.tree}</dd><dt>Parent(s)</dt><dd>{result.parents.join(", ") || "none"}</dd><dt>Author email</dt><dd>{result.authorEmail}</dd></dl>
      </div>}
    </div>
  </section>;
}
