import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { writeGitScopedAuthorityFile, type GitAuthorityScope } from "./git-scoped-authority";
import { bindingFields, GitTaskBindingError, readBindingFile } from "./git-workflow-binding-io";

export function syncGitWorkflowDirectory(dir: string): void {
  // Preserve existing settings support where directory fsync is unavailable.
  // New source-review adoption is separately gated to Linux; Windows durability
  // is not advertised by this evidence-only slice.
  if (process.platform === "win32") return;
  const fd = openSync(dir, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
/** Publish every new directory entry durably, not only files inside the leaf. */
export function createDurableGitWorkflowDirectory(dir: string): void {
  try { mkdirSync(dir, { mode: 0o700 }); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
  syncGitWorkflowDirectory(dirname(dir));
}
function ensureAgentDirectory(dir: string): void {
  let physical;
  try { physical = realpathSync(dir); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    const parent = dirname(dir);
    if (parent === dir) throw new GitTaskBindingError();
    ensureAgentDirectory(parent);
    createDurableGitWorkflowDirectory(dir);
    return;
  }
  syncGitWorkflowDirectory(dirname(physical));
}
export function gitWorkflowPrivateParent(agentDir: string, create = false): string | null {
  const logical = resolve(agentDir);
  if (create) ensureAgentDirectory(logical);
  let root;
  try { root = realpathSync(logical); }
  catch (cause) { if (!create && (cause as NodeJS.ErrnoException).code === "ENOENT") return null; throw cause; }
  const dir = join(root, "pi-web");
  // A previous failed barrier can leave this entry present but not durable.
  if (create) createDurableGitWorkflowDirectory(dir);
  let stat;
  try { stat = lstatSync(dir); }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    if (!create) return null;
    throw cause;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new GitTaskBindingError();
  return dir;
}
export function readGitWorkflowWriteEpoch(agentDir: string): string {
  const parent = gitWorkflowPrivateParent(agentDir);
  if (!parent) return "none";
  let bytes;
  try { bytes = readBindingFile(join(parent, "git-workflow-write-epoch.json"), 1024, true).bytes; }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return "none"; throw cause; }
  const data = bindingFields(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), ["version", "epoch"]);
  if (data.version !== 1 || typeof data.epoch !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(data.epoch)) throw new GitTaskBindingError();
  return data.epoch;
}
/** Caller holds the common settings lock. A failed write must not resurrect old previews. */
export function advanceGitWorkflowWriteEpoch(agentDir: string, scopes?: readonly GitAuthorityScope[]): void {
  readGitWorkflowWriteEpoch(agentDir); // Refuse corrupt/newer state rather than repairing it.
  const parent = gitWorkflowPrivateParent(agentDir, true)!;
  writeGitScopedAuthorityFile(agentDir, join(parent, "git-workflow-write-epoch.json"), JSON.stringify({ version: 1, epoch: randomUUID() }), "settings", scopes);
  syncGitWorkflowDirectory(parent);
}
