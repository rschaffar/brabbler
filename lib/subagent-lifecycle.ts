import { existsSync, statSync, writeFileSync } from "node:fs";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_RESULT_TYPE, type SubagentResultMetadata, type SubagentRunInfo, type SubagentRunMetadata } from "./subagents";

/** Setup entries alone do not flush on SDK 1.3. Persist before publishing a child ID. */
export function persistChildSession(manager: SessionManager): void {
  const file = manager.getSessionFile();
  const header = manager.getHeader();
  if (!file || !header) throw new Error("Subagent session must be persistent");
  if (existsSync(file)) throw new Error("Subagent session file already exists before publication");
  const id = manager.getSessionId();
  writeFileSync(file, `${[header, ...manager.getEntries()].map((entry) => JSON.stringify(entry)).join("\n")}\n`, { flag: "wx", mode: 0o600 });
  manager.setSessionFile(file);
  if (manager.getSessionId() !== id) throw new Error("Subagent session ID changed during persistence");
}

export function assertSubagentDirectory(cwd: string): void {
  try {
    if (statSync(cwd).isDirectory()) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    throw new Error(`Directory does not exist: ${cwd}. Start a new subagent or move this session to an existing folder instead.`);
  }
  throw new Error(`Subagent working path is not a directory: ${cwd}`);
}

export function subagentRunMetadata(run: SubagentRunInfo): SubagentRunMetadata {
  return {
    ...(run.runId ? { runId: run.runId } : {}),
    parentToolCallId: run.parentToolCallId,
    description: run.description,
    task: run.task,
    runInBackground: run.runInBackground,
    createdAt: run.createdAt,
    ...(run.resumed ? { resumed: true } : {}),
  };
}

/** No observation on permission/I/O failures; absence is not inferred from an inaccessible path. */
function worktreeExists(path: string): boolean | undefined {
  try { statSync(path); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? false : undefined; }
}

export function recordSubagentResult(manager: SessionManager, run: SubagentRunInfo): SubagentRunInfo {
  const observation = run.worktreePath ? worktreeExists(run.worktreePath) : undefined;
  const recorded = { ...run, ...(observation !== undefined ? { worktreeExists: observation } : {}) };
  const entry: SubagentResultMetadata = {
    ...subagentRunMetadata(recorded),
    version: 1,
    status: recorded.status as SubagentResultMetadata["status"],
    completedAt: recorded.completedAt!,
    ...(recorded.result ? { result: recorded.result } : {}),
    ...(recorded.error ? { error: recorded.error } : {}),
    ...(recorded.worktreeCleanupError ? { worktreeCleanupError: recorded.worktreeCleanupError } : {}),
    ...(observation !== undefined ? { worktreeExists: observation } : {}),
  };
  manager.appendCustomEntry(SUBAGENT_RESULT_TYPE, entry);
  return recorded;
}

export function settleOrphanedSubagent(run: SubagentRunInfo): SubagentRunInfo {
  return run.status === "running" || run.status === "queued" ? { ...run, status: "interrupted" } : run;
}
