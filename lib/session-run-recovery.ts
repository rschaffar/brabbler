import { randomUUID } from "crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

// This is intentionally not a Pi JSONL entry: new sessions need not have a
// transcript file when preflight accepts, and Pi may rewrite its session file.
const runRoot = () => join(getAgentDir(), "pi-web", "run-journal", "v1");
const validId = (value: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(value);

interface RunStart {
  version: 1;
  runId: string;
  sessionId: string;
  ownerPid: number;
  startedAt: string;
}

export interface PossibleInterruptedRun {
  runId: string;
  startedAt: string;
}

function sessionDir(sessionId: string, root: string): string {
  if (!validId(sessionId)) throw new Error("Invalid session ID for run journal");
  return join(root, sessionId);
}

function runPath(dir: string, runId: string, suffix: "start" | "settled" | "ack"): string {
  if (!validId(runId)) throw new Error("Invalid run ID for run journal");
  return join(dir, `${runId}.${suffix}.json`);
}

function writeReceipt(path: string, value: object): void {
  writeFileSync(path, JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export function recordRunStart(sessionId: string, root = runRoot()): string {
  const dir = sessionDir(sessionId, root);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const runId = randomUUID();
  writeReceipt(runPath(dir, runId, "start"), {
    version: 1, runId, sessionId, ownerPid: process.pid, startedAt: new Date().toISOString(),
  } satisfies RunStart);
  return runId;
}

export function recordRunSettlement(sessionId: string, runId: string, root = runRoot()): void {
  const dir = sessionDir(sessionId, root);
  const receipt = runPath(dir, runId, "settled");
  writeReceipt(receipt, { version: 1, settledAt: new Date().toISOString() });
  // Receipt first: a crash while cleaning up cannot reclassify a settled run.
  // Successful runs leave no growing history of sidecar files.
  unlinkSync(runPath(dir, runId, "start"));
  unlinkSync(receipt);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return true; // Unknown is not evidence of a crash.
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means alive but inaccessible; all other unexpected errors are unknown.
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** An absent settlement is evidence of *possible*, never certain, interruption. */
export function readPossibleInterruptedRun(
  sessionId: string,
  root = runRoot(),
  ownerAlive: (pid: number) => boolean = isProcessAlive,
): PossibleInterruptedRun | null {
  const dir = sessionDir(sessionId, root);
  let files: string[];
  try { files = readdirSync(dir); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  const candidates: PossibleInterruptedRun[] = [];
  const names = new Set(files);
  for (const name of files) {
    if (!name.endsWith(".start.json")) continue;
    const runId = name.slice(0, -".start.json".length);
    if (!validId(runId) || names.has(`${runId}.settled.json`) || names.has(`${runId}.ack.json`)) continue;
    try {
      const start = JSON.parse(readFileSync(runPath(dir, runId, "start"), "utf8")) as Partial<RunStart>;
      if (start.version !== 1 || start.runId !== runId || start.sessionId !== sessionId
        || typeof start.startedAt !== "string" || !Number.isFinite(Date.parse(start.startedAt))
        || typeof start.ownerPid !== "number" || ownerAlive(start.ownerPid)) continue;
      candidates.push({ runId, startedAt: start.startedAt });
    } catch { /* Corrupt or concurrently removed records are not proof. */ }
  }
  return candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null;
}

/** Only acknowledge a run that this session actually owns. */
export function acknowledgePossibleInterruptedRun(sessionId: string, runId: string, root = runRoot()): boolean {
  const dir = sessionDir(sessionId, root);
  try {
    const start = JSON.parse(readFileSync(runPath(dir, runId, "start"), "utf8")) as Partial<RunStart>;
    if (start.version !== 1 || start.runId !== runId || start.sessionId !== sessionId) return false;
    writeReceipt(runPath(dir, runId, "ack"), { version: 1, acknowledgedAt: new Date().toISOString() });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return true;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function clearSessionRunRecovery(sessionId: string, root = runRoot()): void {
  rmSync(sessionDir(sessionId, root), { recursive: true, force: true });
}
