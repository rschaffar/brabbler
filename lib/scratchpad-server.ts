import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { SCRATCHPAD_MAX_LENGTH, validScratchpadScope, type ScratchpadNote, type ScratchpadProject, type ScratchpadScope } from "./scratchpad";
import { projectIdentityKey } from "./project-identity";
import { registeredGitRepository } from "./project-trust-repository";

const digest = (text: string) => createHash("sha256").update(text).digest("hex");
export function scratchpadPath(scope: ScratchpadScope, agentDir = getAgentDir()): string {
  if (!validScratchpadScope(scope)) throw new Error("Invalid scratchpad scope");
  return join(agentDir, "pi-web", "scratchpads", `${digest(JSON.stringify(scope))}.json`);
}
/** Fresh grouping only: no trust/default marker, project-file write or new file root. */
export function scratchpadProject(cwd: string): ScratchpadProject {
  if (!isAbsolute(cwd)) throw new Error("Select an absolute project directory");
  const physical = realpathSync(cwd);
  if (!statSync(physical).isDirectory()) throw new Error("Project must be a directory");
  const repository = registeredGitRepository(physical);
  if (!repository) {
    // A failed Git probe at a checkout root must not silently create folder notes.
    try { lstatSync(join(physical, ".git")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { projectId: digest(JSON.stringify(["project", "directory", projectIdentityKey(physical)])), root: physical };
      }
      throw error;
    }
    throw new Error("Project checkout could not be resolved");
  }
  // Common Git metadata is shared across registered worktrees. Ignore mutable
  // trust/native-resource marker identities: personal notes grant no authority.
  return { projectId: digest(JSON.stringify(["project", "git", projectIdentityKey(repository.common)])), root: repository.root };
}
function snapshot(text: string): ScratchpadNote { return { text, revision: digest(text) }; }
export function readScratchpad(path: string): ScratchpadNote {
  let raw: string;
  try { raw = readFileSync(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return snapshot("");
    throw error;
  }
  const value = JSON.parse(raw) as { version?: unknown; text?: unknown };
  if (!value || value.version !== 1 || typeof value.text !== "string" || value.text.length > SCRATCHPAD_MAX_LENGTH) {
    throw new Error("Invalid scratchpad file");
  }
  return snapshot(value.text);
}
export class ScratchpadConflict extends Error {
  constructor(public current: ScratchpadNote) { super("Scratchpad changed in another client"); }
}
/** Re-read under a stable pathname lock; content equality recovers lost acknowledgements. */
export async function saveScratchpad(path: string, text: string, revision: string): Promise<ScratchpadNote> {
  if (typeof text !== "string" || text.length > SCRATCHPAD_MAX_LENGTH || !/^[a-f0-9]{64}$/.test(revision)) {
    throw new Error("Invalid scratchpad update");
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = await lockfile.lock(path, {
    realpath: false, stale: 30_000,
    retries: { retries: 10, minTimeout: 50, maxTimeout: 500 },
  });
  try {
    const current = readScratchpad(path);
    if (current.text === text) return current;
    if (current.revision !== revision) throw new ScratchpadConflict(current);
    writePrivateFileAtomicSync(path, JSON.stringify({ version: 1, text }));
    return snapshot(text);
  } finally { await release(); }
}
