import { lstatSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { beginGitAction, failGitAction, finishGitAction, gitActionSink, GitActionRecordingError, type GitActionHandle, type GitActionSink } from "./git-action-controller";
import type { GitActionCandidateSnapshot, GitActionOutcome } from "./git-action-types";
import type { GitCommitPreview } from "./git-commit";
import type { IntegrationPlan, FastForwardIntegrationPlan } from "./git-integration";
import { samePath } from "./paths";
import { getRpcSession } from "./rpc-manager";
import { readLatestSessionEntryId, readSessionHeader } from "./session-reader";

export interface HumanGitScope { sessionId: string; sessionFile: string; cwd: string }
export class HumanGitSessionChangedError extends Error {
  constructor() { super("Session changed before recording Git history; reload the session before continuing."); }
}
function sessionFileState(file: string) {
  const stat = lstatSync(file); // Never let SessionManager.open recreate a removed/moved source.
  if (!stat.isFile() || stat.isSymbolicLink()) throw new HumanGitSessionChangedError();
  return stat;
}
function sameFile(a: ReturnType<typeof sessionFileState>, b: ReturnType<typeof sessionFileState>) {
  return a.dev === b.dev && a.ino === b.ino;
}
function unchangedFile(a: ReturnType<typeof sessionFileState>, b: ReturnType<typeof sessionFileState>) {
  return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
/** Fresh read only; reuse the current wrapper's manager, but never create a wrapper or refresh it behind its back. */
export function readHumanGitSessionManager(scope: HumanGitScope) {
  const { sessionId, sessionFile, cwd } = scope;
  const before = sessionFileState(sessionFile);
  const header = readSessionHeader(sessionFile);
  if (header?.id !== sessionId || !samePath(header.cwd, cwd)) throw new HumanGitSessionChangedError();
  const live = getRpcSession(sessionId);
  if (live?.isAlive() && (!samePath(live.sessionFile, sessionFile) || !samePath(live.cwd, cwd))) throw new HumanGitSessionChangedError();
  const manager = live?.isAlive() ? live.inner.sessionManager : SessionManager.open(sessionFile, undefined);
  if (!manager.isPersisted() || manager.getSessionId() !== sessionId || manager.getHeader()?.id !== sessionId
    || !samePath(manager.getCwd(), cwd) || !samePath(manager.getSessionFile() ?? "", sessionFile)) throw new HumanGitSessionChangedError();
  const latest = readLatestSessionEntryId(sessionFile);
  if (latest && !manager.getEntry(latest) || !unchangedFile(before, sessionFileState(sessionFile))) throw new HumanGitSessionChangedError();
  return manager;
}
/** Caller authorizes scope first. Resolve again INSIDE append, after any awaited Git/artifact work. */
export function humanGitActionSink(scope: HumanGitScope): GitActionSink {
  const bound = { ...scope };
  const original = sessionFileState(bound.sessionFile);
  return { sessionId: bound.sessionId, append(record) {
    if (record.sessionId !== bound.sessionId || !sameFile(original, sessionFileState(bound.sessionFile))) throw new HumanGitSessionChangedError();
    const manager = readHumanGitSessionManager(bound);
    // No await between manager freshness checks and the SDK append; use its CURRENT branch parent.
    return gitActionSink(manager, (type, data) => manager.appendCustomEntry(type, data)).append(record);
  } };
}

type Commit = { kind: "commit"; preview: GitCommitPreview; message: string };
type Integration = {
  kind: "integration"; plan: IntegrationPlan | FastForwardIntegrationPlan; targetCwd: string; intended: GitActionOutcome;
};
type NativeCandidate = Commit | Integration;
interface Pending {
  scope: HumanGitScope;
  native: NativeCandidate;
  handle: GitActionHandle;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}
const TTL = 15 * 60_000;
const MAX_PENDING = 128;
const key = Symbol.for("pi-web:git-action-human:v1");
interface Runtime { pending: Map<string, Pending>; creating: number }
function runtime(): Runtime {
  const shared = globalThis as unknown as Record<symbol, Runtime | undefined>;
  return shared[key] ??= { pending: new Map(), creating: 0 };
}
export class HumanGitCandidateError extends Error {
  constructor() { super("Manual candidate is unavailable, expired or mismatched; prepare a new preview."); }
}
function retire(id: string): void {
  const item = runtime().pending.get(id);
  if (!item) return;
  runtime().pending.delete(id);
  clearTimeout(item.timer);
  // Release projects an awaiting record as expired. Never restore liveness from history.
  item.handle.release();
}

/** Call only after validating the saved session, allowed roots, authority and idle checkout. */
export async function keepHumanGitCandidate(sink: GitActionSink, scope: HumanGitScope, native: NativeCandidate,
  snapshot: GitActionCandidateSnapshot): Promise<{ actionId: string; expiresAt: number }> {
  const state = runtime();
  for (const [id, item] of state.pending) if (item.expiresAt <= Date.now()) retire(id);
  if (sink.sessionId !== scope.sessionId || state.pending.size + state.creating >= MAX_PENDING) throw new HumanGitCandidateError();
  state.creating++;
  let handle: GitActionHandle | undefined;
  try {
    handle = await beginGitAction(sink, "human", snapshot);
    await handle.update("awaiting-decision");
    const expiresAt = Math.min(Date.now() + TTL, native.kind === "integration" ? native.plan.expiresAt : Infinity);
    if (expiresAt <= Date.now()) throw new HumanGitCandidateError();
    const actionId = handle.record.id;
    const timer = setTimeout(() => retire(actionId), expiresAt - Date.now());
    timer.unref?.();
    state.pending.set(actionId, { scope: { ...scope }, native: native.kind === "commit" ? structuredClone(native)
      : { ...native, plan: structuredClone(native.plan), intended: { ...native.intended } }, handle, expiresAt, timer });
    return { actionId, expiresAt };
  } catch (cause) {
    if (handle) { await failGitAction(handle, false); handle.release(); }
    throw cause;
  } finally { state.creating--; }
}

type CommitApproval = { kind: "commit"; preview: GitCommitPreview; message: string };
type IntegrationApproval = { kind: "integration"; planId: string; targetCwd: string };
export function takeHumanGitCandidate(scope: HumanGitScope, actionId: string, approval: CommitApproval): { handle: GitActionHandle; native: Commit };
export function takeHumanGitCandidate(scope: HumanGitScope, actionId: string, approval: IntegrationApproval): { handle: GitActionHandle; native: Integration };
/** Single use; an action ID alone (including an inherited/history anchor) is never authority. */
export function takeHumanGitCandidate(scope: HumanGitScope, actionId: string, approval: CommitApproval | IntegrationApproval) {
  const item = runtime().pending.get(actionId);
  if (!item || item.scope.sessionId !== scope.sessionId || !samePath(item.scope.sessionFile, scope.sessionFile)
    || !samePath(item.scope.cwd, scope.cwd)) throw new HumanGitCandidateError();
  if (item.expiresAt <= Date.now()) { retire(actionId); throw new HumanGitCandidateError(); }
  const { native, handle } = item;
  if (handle.record.state !== "awaiting-decision" || (approval.kind === "commit"
    ? native.kind !== "commit" || native.message !== approval.message || !isDeepStrictEqual(native.preview, approval.preview)
    : native.kind !== "integration" || native.plan.planId !== approval.planId || !samePath(native.targetCwd, approval.targetCwd))) {
    throw new HumanGitCandidateError();
  }
  runtime().pending.delete(actionId);
  clearTimeout(item.timer);
  return { handle, native };
}

export const HUMAN_GIT_RECOVERY_WARNING = "Outcome recording failed. Inspect the action history and checkouts before further action; do not repeat this operation.";
/** Preserve the engine's actual result even if its final journal write fails. */
export async function finishHumanGitAction<T extends object>(handle: GitActionHandle, result: T, outcome: GitActionOutcome, partial = false) {
  try {
    await finishGitAction(handle, outcome, partial);
    return { ...result, actionId: handle.record.id };
  } catch (cause) {
    return { ...result, actionId: handle.record.id, recoveryRequired: true, recoveryWarning: HUMAN_GIT_RECOVERY_WARNING,
      ...(cause instanceof GitActionRecordingError ? { outcome: cause.outcome } : {}) };
  }
}
