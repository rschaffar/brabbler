/** Presentation only: operation equality continues to compare canonical per-path changes. */
export const GIT_RENAME_ARGS = ["--no-renames", "--find-renames=50%", "--rename-empty", "-l1000"];

export function isGitRenameStatus(status: string): boolean {
  return status.length === 4 && /^R(?:0\d{2}|100)$/.test(status);
}

export interface GitChangedPath { path: string; previousPath?: string }

export function nestedRenameRoot(file: GitChangedPath): string | undefined {
  const old = file.previousPath;
  if (!old) return undefined;
  if (file.path.startsWith(`${old}/`)) return old;
  if (old.startsWith(`${file.path}/`)) return file.path;
  return undefined;
}

/** Callers admit the selected entry from a complete immutable inventory first.
 * Git's literal pathspecs include descendants, and exclusions override includes.
 * For nested moves, enumerate the same inventory to exclude unrelated leaves,
 * not the selected descendant. No content scan or alternative rename inference.
 * Invoke Git with command-local --no-literal-pathspecs for this explicit magic.
 */
export async function gitFilePathspecs(file: GitChangedPath,
  inventory: Iterable<GitChangedPath> | AsyncIterable<GitChangedPath>): Promise<string[]> {
  const endpoints = file.previousPath ? [file.previousPath, file.path] : [file.path];
  const root = nestedRenameRoot(file);
  const paths = endpoints.map(path => `:(literal)${path}`);
  // A bare trailing slash also matches a gitlink itself. Escape every glob
  // metacharacter in the literal prefix, then exclude only actual descendants.
  for (const path of endpoints) if (path !== root) {
    const escaped = path.replace(/[\\*?[\]]/g, "\\$&");
    paths.push(`:(exclude,glob)${escaped}/**`);
  }
  if (root) {
    const excluded = new Set<string>();
    for await (const other of inventory) {
      if (other.path === file.path && other.previousPath === file.previousPath) continue;
      for (const path of other.previousPath ? [other.previousPath, other.path] : [other.path]) {
        if (!path.startsWith(`${root}/`)) continue;
        if (endpoints.some(endpoint => endpoint === path || endpoint.startsWith(`${path}/`))) {
          throw new Error("Cannot isolate the selected rename from other changed paths");
        }
        excluded.add(path);
      }
    }
    for (const path of excluded) paths.push(`:(exclude,literal)${path}`);
  }
  return paths;
}
