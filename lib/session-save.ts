import { closeSync, constants, existsSync, fsyncSync, fstatSync, openSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionManager } from "@earendil-works/pi-coding-agent";

type SavedSession = Pick<SessionManager, "getSessionFile" | "getHeader" | "getEntries">;
const quarantine = Symbol.for("brabbler:session-save-quarantined");
export function isSessionSaveQuarantined(manager: object): boolean { return (manager as { [quarantine]?: true })[quarantine] === true; }
/** SDK append mutates its tree before persisting. After an uncertain write, keep
 * every byte/entry for recovery, but never present that memory as saved history
 * or let a tool result become a child of a potentially unwritten entry.
 *
 * This is instance-local containment, NOT rollback, a receipt retry or automatic
 * recovery. A fresh owner must load actual disk history after this owner settles.
 * The pinned SDK's shared append/persist/rewrite hooks also fence already-bound
 * public append methods. No SDK private entry/index/leaf state is rewritten. */
export function quarantineSessionAfterSaveFailure(manager: SessionManager): void {
  if (isSessionSaveQuarantined(manager)) return;
  Object.defineProperty(manager, quarantine, { value: true });
  const target = manager as unknown as Record<string, unknown>;
  const refuse = () => { throw new Error("Session persistence is uncertain; SDK history and continuation are quarantined. Inspect saved history before reopening; do not repeat the native operation."); };
  const methods = [
    "_appendEntry", "_persist", "_rewriteFile", "setSessionFile", "newSession", "createBranchedSession",
    "branch", "resetLeaf", "branchWithSummary", "getEntries", "getEntry", "getEntryCount", "getTree",
    "getBranch", "getLeafId", "getLeafEntry", "getChildren", "getLabel", "getSessionName",
    "buildContextEntries", "buildSessionProjection", "buildSessionContext",
  ];
  // Include every public append method, including additions in a compatible SDK.
  for (let prototype: object | null = manager; prototype && prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const name of Object.getOwnPropertyNames(prototype)) if (name.startsWith("append")) methods.push(name);
  }
  for (const name of new Set(methods)) {
    if (typeof target[name] === "function") Object.defineProperty(manager, name, { value: refuse, configurable: true, writable: true });
  }
}
/** SDK 1.4 delays custom-only first flush. Use its exact entries/IDs before any
 * reopen (notably fork_branch); a new SDK ID must never replace copied history. */
export function flushSessionEntries(manager: SavedSession): void {
  const path = manager.getSessionFile();
  if (!path || existsSync(path)) return;
  const header = manager.getHeader();
  if (!header) throw new Error("Persisted session is missing a session header");
  writeFileSync(path, [header, ...manager.getEntries()].map(entry => JSON.stringify(entry)).join("\n") + "\n",
    { encoding: "utf8", flag: "wx", mode: 0o600 });
  (manager as unknown as { flushed: boolean }).flushed = true;
}
/** Successful append/initial flush alone is not durability. Called before exposing
 * metadata references, decision/operation receipts or copied session identities.
 * The SDK remains the JSONL writer; no second store or automatic append retry. */
export function sessionSaveBarrier(manager: SavedSession): void {
  const path = manager.getSessionFile();
  if (!path) throw new Error("Saving requires a persistent session");
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Invalid session file");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  if (process.platform !== "win32") {
    const parent = openSync(dirname(path), "r");
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
}
