import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { gitExecEnv } from "../../lib/git-exec";
import { readGitFileContext, DiffContextError } from "../../lib/git-file-context";
import { splitGitPatch } from "../../lib/git-patch-display";
import { toNativePath } from "../../lib/paths";

export const GIT_CONTEXT_TTL_MS = 60 * 60 * 1000;
const MAX_SNAPSHOTS = 64;
interface Snapshot {
  cwd: string; identity: string; before: string; after: string; created: number;
  files: Map<string, { path: string; previousPath?: string }>;
}
const key = Symbol.for("pi-web:git-plugin-context");
const global = globalThis as typeof globalThis & { [key]?: Map<string, Snapshot> };
const snapshots = global[key] ??= new Map<string, Snapshot>();
function identity(cwd: string) {
  const common = realpathSync(toNativePath(execFileSync("git", ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
    env: { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "" },
    encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024,
  }).trim()));
  const stat = statSync(common);
  return `${common}:${stat.dev}:${stat.ino}`;
}

/** Register only an already-previewed immutable comparison; never create refs or content in GET. */
export function registerGitPatchContext(cwd: string, before: string, after: string, patch: string, now = Date.now()): string | undefined {
  let files;
  try { files = splitGitPatch(patch); } catch { return undefined; }
  if (files.length > 256) return undefined;
  for (const [id, snapshot] of snapshots) if (now - snapshot.created >= GIT_CONTEXT_TTL_MS) snapshots.delete(id);
  while (snapshots.size >= MAX_SNAPSHOTS) snapshots.delete(snapshots.keys().next().value!);
  const handle = randomUUID();
  snapshots.set(handle, { cwd, identity: identity(cwd), before, after, created: now,
    files: new Map(files.map((file) => [file.id, { path: file.path, previousPath: file.previousPath }])) });
  return handle;
}

export async function readGitPatchContext(handle: string, fileId: string, now = Date.now()) {
  const snapshot = snapshots.get(handle);
  if (!snapshot || now - snapshot.created >= GIT_CONTEXT_TTL_MS) {
    throw new DiffContextError("This context snapshot has expired or the server restarted; the saved patch remains available.");
  }
  const file = snapshot.files.get(fileId);
  if (!file) throw new DiffContextError("File is not part of this reviewed snapshot.", 404);
  try {
    if (identity(snapshot.cwd) !== snapshot.identity) throw new Error("repository changed");
  } catch { throw new DiffContextError("The reviewed repository is no longer available; the saved patch remains available."); }
  return readGitFileContext(snapshot.cwd, snapshot.before, snapshot.after, file.path, file.previousPath);
}
