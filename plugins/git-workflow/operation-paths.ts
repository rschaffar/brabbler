import { gitText } from "./process";

export const OPERATION_MARKERS = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"] as const;

/** Batch only path resolution; callers still inspect every marker afresh. */
export async function operationMarkerPaths(cwd: string, read = gitText): Promise<string[]> {
  const output = await read(cwd, ["rev-parse", "--path-format=absolute", ...OPERATION_MARKERS.flatMap((name) => ["--git-path", name])]);
  // These per-worktree paths normally share one directory prefix. Git does not
  // NUL-frame --git-path output: splitting on newlines would corrupt legal POSIX
  // paths. Derive the prefix length, then validate the complete response exactly.
  for (const ending of ["\n", "\r\n"]) {
    const prefixLength = (output.length - OPERATION_MARKERS.reduce((length, name) => length + name.length + ending.length, 0)) / OPERATION_MARKERS.length;
    if (!Number.isInteger(prefixLength) || prefixLength <= 0) continue;
    const prefix = output.slice(0, prefixLength);
    const paths = OPERATION_MARKERS.map((name) => prefix + name);
    if (output === paths.map((path) => path + ending).join("")) return paths;
  }
  // Preserve unusual Git layouts/output formats rather than guessing paths.
  // A failed command propagates; this fallback never retries a Git failure.
  const paths: string[] = [];
  for (const name of OPERATION_MARKERS) paths.push((await read(cwd, ["rev-parse", "--path-format=absolute", "--git-path", name])).trim());
  return paths;
}
