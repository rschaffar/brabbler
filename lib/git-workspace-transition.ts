import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { chmodSync, closeSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import type { GitWorkspaceTransition } from "./git-workspace-start-extension";

export type GitWorkspaceTransitionStatus = {
  status: "pending" | "claimed" | "succeeded" | "manual-recovery";
  action: "continue" | "fork";
  sourceCwd: string;
  destinationPath: string;
  newSessionId?: string;
  reason?: string;
  nonce: string;
};

type Receipt = { version: 1; sessionId: string; transition: GitWorkspaceTransition };
const activeKey = Symbol.for("pi-web:git-workspace-active-receipts");
const claimsKey = Symbol.for("pi-web:git-workspace-running-claims");
function receiptSet(key: symbol): Set<string> {
  const global = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  return (global[key] ??= new Set());
}
const activeReceipts = () => receiptSet(activeKey);
const runningClaims = () => receiptSet(claimsKey);
const activeId = (sessionId: string, nonce: string) => `${sessionId}:${nonce}`;
const uuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const rootDir = () => join(getAgentDir(), "pi-web", "git-workspace-transitions", "v1");
function dir(id: string, root: string): string {
  if (!uuid(id)) throw new Error("Invalid session ID");
  return join(root, id);
}
function path(id: string, name: string, root: string): string { return join(dir(id, root), `${name}.json`); }
function physicalPrivateDir(folder: string): void {
  let created = false;
  try { mkdirSync(folder, { mode: 0o700 }); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const stat = lstatSync(folder);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe private receipt directory");
  if ((stat.mode & 0o077) !== 0) chmodSync(folder, 0o700);
  if (created && process.platform !== "win32") {
    const fd = openSync(dirname(folder), "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
}
function safeReceiptDirs(sessionId: string, root: string): boolean {
  try {
    const folders = root === rootDir()
      ? [getAgentDir(), join(getAgentDir(), "pi-web"), join(getAgentDir(), "pi-web", "git-workspace-transitions"), root, dir(sessionId, root)]
      : [root, dir(sessionId, root)];
    return folders.every((folder) => lstatSync(folder).isDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
function ensureReceiptDirs(sessionId: string, root: string): void {
  if (root === rootDir()) {
    // Do not allow symlinked agent roots or private parents to redirect receipts.
    const agent = getAgentDir();
    if (!lstatSync(agent).isDirectory()) throw new Error("Unsafe agent directory");
    physicalPrivateDir(join(agent, "pi-web"));
    physicalPrivateDir(join(agent, "pi-web", "git-workspace-transitions"));
  }
  physicalPrivateDir(root);
  physicalPrivateDir(dir(sessionId, root));
}
function exclusive(file: string, value: object): void {
  const staging = `${file}.${randomUUID()}.tmp`;
  const fd = openSync(staging, "wx", 0o600);
  try { writeSync(fd, JSON.stringify(value)); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { linkSync(staging, file); }
  finally { unlinkSync(staging); }
  if (process.platform !== "win32") {
    const directoryFd = openSync(dirname(file), "r");
    try { fsyncSync(directoryFd); } finally { closeSync(directoryFd); }
  }
}
function read<T>(file: string): T | null {
  try {
    if (!lstatSync(dirname(file)).isDirectory() || !lstatSync(file).isFile()) throw new Error("Unsafe receipt");
    return JSON.parse(readFileSync(file, "utf8")) as T;
  }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Private, write-once receipt. A duplicate start cannot overwrite an earlier attempt. */
export function recordGitWorkspaceTransition(sessionId: string, transition: GitWorkspaceTransition, root = rootDir()): void {
  if (transition.onCreate === "stay") return;
  ensureReceiptDirs(sessionId, root);
  exclusive(path(sessionId, "receipt", root), { version: 1, sessionId, transition } satisfies Receipt);
  // The private file survives restarts; only the same process/run may dispatch it.
  activeReceipts().add(activeId(sessionId, transition.nonce));
}

/** One automatic start per chat, including after successful completion. Check before creating a worktree. */
export function canRecordGitWorkspaceTransition(sessionId: string, root = rootDir()): boolean {
  if (!uuid(sessionId)) return false;
  // Check the private directory as well: any damaged or unreadable receipt fails closed.
  try {
    ensureReceiptDirs(sessionId, root);
    lstatSync(path(sessionId, "receipt", root));
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

/** Exclusive claim precedes any check or session copy. Never retry an existing claim. */
export function claimGitWorkspaceTransition(sessionId: string, nonce: string, root = rootDir()): boolean {
  if (!safeReceiptDirs(sessionId, root)) {
    activeReceipts().delete(activeId(sessionId, nonce));
    return false;
  }
  const receipt = read<Receipt>(path(sessionId, "receipt", root));
  if (receipt?.version !== 1 || receipt.sessionId !== sessionId || receipt.transition?.nonce !== nonce) {
    activeReceipts().delete(activeId(sessionId, nonce));
    return false;
  }
  try {
    exclusive(path(sessionId, "claimed", root), { nonce, at: new Date().toISOString() });
    runningClaims().add(activeId(sessionId, nonce));
    return true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  finally { activeReceipts().delete(activeId(sessionId, nonce)); }
}

export function recordGitWorkspaceForkId(sessionId: string, nonce: string, newSessionId: string, root = rootDir()): void {
  if (!uuid(newSessionId) || !read<Receipt>(path(sessionId, "receipt", root)) || !read(path(sessionId, "claimed", root))) throw new Error("Invalid fork receipt");
  exclusive(path(sessionId, "fork", root), { nonce, newSessionId });
}

export function finishGitWorkspaceTransition(sessionId: string, nonce: string, actualCwd: string, root = rootDir()): void {
  try { exclusive(path(sessionId, "succeeded", root), { nonce, actualCwd, at: new Date().toISOString() }); }
  finally { runningClaims().delete(activeId(sessionId, nonce)); }
}

export function failGitWorkspaceTransition(sessionId: string, nonce: string, root = rootDir()): void {
  // No exception text or filesystem paths from failures enter the UI-facing state.
  try { exclusive(path(sessionId, "manual", root), { nonce, reason: "Transition needs manual recovery" }); }
  finally { runningClaims().delete(activeId(sessionId, nonce)); }
}

/** Safe, bounded lookup: no directory listing, transcript parsing or private receipt path. */
export async function readGitWorkspaceTransitionStatus(sessionId: string): Promise<GitWorkspaceTransitionStatus | null> {
  return readGitWorkspaceTransitionStatusFromRoot(sessionId, rootDir());
}

export function readGitWorkspaceTransitionStatusFromRoot(sessionId: string, root: string): GitWorkspaceTransitionStatus | null {
  if (!uuid(sessionId) || !safeReceiptDirs(sessionId, root)) return null;
  const receipt = read<Receipt>(path(sessionId, "receipt", root));
  if (!receipt || receipt.version !== 1 || receipt.sessionId !== sessionId) return null;
  const t = receipt.transition;
  if (!t || !uuid(t.nonce) || !["continue", "fork"].includes(t.onCreate)) return null;
  const fork = read<{ nonce: string; newSessionId: string }>(path(sessionId, "fork", root));
  const success = read<{ nonce: string; actualCwd: string }>(path(sessionId, "succeeded", root));
  const manual = read<{ nonce: string }>(path(sessionId, "manual", root));
  const claimed = read<{ nonce: string }>(path(sessionId, "claimed", root));
  const claimIsRunning = runningClaims().has(activeId(sessionId, t.nonce));
  const status = success?.nonce === t.nonce ? "succeeded"
    : manual?.nonce === t.nonce || claimed?.nonce === t.nonce && !claimIsRunning
      || claimed?.nonce !== t.nonce && !activeReceipts().has(activeId(sessionId, t.nonce))
      ? "manual-recovery"
      : claimed?.nonce === t.nonce ? "claimed" : "pending";
  return {
    status,
    action: t.onCreate as "continue" | "fork", sourceCwd: t.originCwd,
    destinationPath: success?.nonce === t.nonce ? success.actualCwd : t.destinationPath, nonce: t.nonce,
    ...(fork?.nonce === t.nonce && uuid(fork.newSessionId) ? { newSessionId: fork.newSessionId } : {}),
    ...(status === "manual-recovery" ? { reason: "Transition needs manual recovery" } : {}),
  };
}
