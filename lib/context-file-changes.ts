import { loadProjectContextFiles } from "@earendil-works/pi-coding-agent";

export type ContextFile = { path: string; content: string };

/** Compare the SDK's loaded snapshot with its read-only context-file discovery.
 * This detects additions, removals, priority changes (e.g. AGENTS.override.md),
 * and edits without reloading resources or executing extensions during a poll.
 */
export function contextFilesDiffer(loaded: ContextFile[], current: ContextFile[]): boolean {
  return loaded.length !== current.length || loaded.some((file, index) =>
    file.path !== current[index].path || file.content !== current[index].content);
}

export function haveContextFilesChanged(loaded: ContextFile[], cwd: string, agentDir: string): boolean {
  return contextFilesDiffer(loaded, loadProjectContextFiles({ cwd, agentDir }));
}
