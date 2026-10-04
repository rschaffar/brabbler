// Internal native boundary checks. No reservation, usage lease or durable ACK.
import fs from "node:fs";
import path from "node:path";
import type { GitProjectResources } from "./git-project-resources";
import { readGitCleanupNativeProof, selectGitCleanupInventory, type GitCleanupDiagnostics, type GitCleanupEvidence,
  type GitCleanupInventory, type GitCleanupRemovalProof } from "./git-cleanup-operation";
import { admissionAbsent, admissionBytes, admissionClean, admissionEqual, admissionGit, admissionHash,
  admissionIdentity, admissionPhysical, admissionRefuse, admissionRows, admissionTracked, admissionSafeFiles } from "./git-workspace-admission";

function inventory(e: GitCleanupEvidence): GitCleanupInventory {
  const r = e.integration.target, resources = [e.integration.feature, r, e.main];
  const refs = admissionGit(r, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs");
  if (refs.split("\n").length > 2001) admissionRefuse();
  const registrations = admissionGit(r, "worktree", "list", "--porcelain", "-z"), checkouts: GitCleanupInventory["checkouts"] = {};
  for (const row of admissionRows(registrations)) {
    const cwd = row.split("\0")[0].slice(9);
    if (resources.some((r) => r.cwd === cwd)) {
      const id = admissionIdentity(cwd); admissionPhysical(cwd, id); checkouts[cwd] = id;
    }
  }
  const admins: Record<string, string> = {}, root = path.join(r.commonDir, "worktrees");
  try {
    const rootId = admissionIdentity(root); admissionPhysical(root, rootId);
    const names = fs.readdirSync(root).sort(); if (names.length > 2000) admissionRefuse();
    for (const name of names) {
      if (!resources.some((r) => r.gitDir === path.join(r.commonDir, "worktrees", name))) continue;
      const dir = path.join(root, name), id = admissionIdentity(dir); admissionPhysical(dir, id);
      const meta: unknown[] = [id]; let count = 0;
      const scan = (relative: string) => {
        for (const name of fs.readdirSync(path.join(dir, relative)).sort()) {
          if (++count > 2000) admissionRefuse();
          const child = relative ? `${relative}/${name}` : name, file = path.join(dir, child), s = fs.lstatSync(file);
          if (!relative && name === "logs") { admissionPhysical(file, admissionIdentity(file)); continue; }
          if (String(s.dev) !== id.device || s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) admissionRefuse();
          meta.push([child, admissionIdentity(file), s.isDirectory() ? "directory" : admissionHash(admissionBytes(file, 1024 * 1024))]);
          if (s.isDirectory()) scan(child);
        }
      };
      scan(""); admins[name] = admissionHash(JSON.stringify(meta));
    }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  return selectGitCleanupInventory({ refs, registrations, admins, checkouts }, resources);
}
function snapshot(r: GitProjectResources, s: GitCleanupEvidence["target"]): void {
  if (admissionHash(JSON.stringify(admissionIdentity(path.join(r.commonDir, "config"))) + admissionGit(r, "config", "--list", "--null")) !== s.config) admissionRefuse();
  admissionSafeFiles(r);
  const index = path.join(r.gitDir, "index"), head = path.join(r.gitDir, "HEAD");
  if (admissionHash(JSON.stringify(admissionIdentity(index)) + admissionHash(admissionBytes(index))) !== s.index ||
    admissionHash(JSON.stringify(admissionIdentity(head)) + admissionHash(admissionBytes(head))) !== s.head ||
    admissionTracked(r, s.oid, false) !== s.tracked) admissionRefuse();
  admissionClean(r, s.oid, s.tree);
  admissionAbsent(path.join(r.gitDir, "locked"));
}
function sourceIgnored(e: GitCleanupEvidence): void {
  const r = e.integration.feature, files = new Set<string>(), dirs = new Set<string>([""]);
  for (const row of admissionGit(r, "ls-tree", "-r", "-z", e.source.tree).split("\0").filter(Boolean)) {
    const relative = row.slice(row.indexOf("\t") + 1); files.add(relative);
    let parent = path.dirname(relative);
    while (parent !== ".") { dirs.add(parent); parent = path.dirname(parent); }
  }
  const ignored: GitCleanupEvidence["source"]["ignored"] = []; let count = 0;
  const scan = (relative: string) => {
    for (const name of fs.readdirSync(path.join(r.cwd, relative)).sort()) {
      if (++count > 2000 || /[\x00-\x1f\x7f]/.test(name)) admissionRefuse();
      const child = relative ? `${relative}/${name}` : name;
      if (child === ".git") continue;
      if (name === ".git" || name === ".gitattributes") admissionRefuse();
      const s = fs.lstatSync(path.join(r.cwd, child), { bigint: true });
      if (s.isSymbolicLink() || (!s.isDirectory() && !s.isFile()) || s.isFile() && s.nlink !== BigInt(1) ||
        String(s.dev) !== r.identities.checkout.device) admissionRefuse();
      if (!files.has(child) && !dirs.has(child)) ignored.push({ path: child, kind: s.isDirectory() ? "directory" : "file",
        ...admissionIdentity(path.join(r.cwd, child)), size: String(s.size), mode: String(s.mode), changed: String(s.ctimeNs), modified: String(s.mtimeNs) });
      if (s.isDirectory()) scan(child);
    }
  };
  scan(""); if (!admissionEqual(ignored, e.source.ignored)) admissionRefuse();
}
function removedInventory(e: GitCleanupEvidence): GitCleanupInventory {
  const source = e.integration.feature, rows = admissionRows(e.inventory.registrations);
  const own = rows.filter((row) => row.startsWith(`worktree ${source.cwd}\0`));
  if (own.length !== 1 || own[0] !== `worktree ${source.cwd}\0HEAD ${e.integration.featureOid}\0branch refs/heads/${source.branch}` ||
    rows.some((row) => row !== own[0] && row.split("\0").includes(`branch refs/heads/${source.branch}`)) ||
    path.dirname(source.gitDir) !== path.join(source.commonDir, "worktrees") || source.cwd === source.projectRoot ||
    !admissionEqual(e.inventory.checkouts[source.cwd], source.identities.checkout)) admissionRefuse();
  const admins = { ...e.inventory.admins }, checkouts = { ...e.inventory.checkouts }, admin = path.basename(source.gitDir);
  if (!Object.hasOwn(admins, admin)) admissionRefuse();
  delete admins[admin]; delete checkouts[source.cwd];
  return { refs: e.inventory.refs, registrations: rows.filter((row) => row !== own[0]).join("\0\0") + "\0\0", admins, checkouts };
}
/** A genuine original removal changes ONLY its exact source absence dependency.
 * This checks native state, not permission; the leaf also checks SAME invocation
 * identity and original authority before every effect. */
export function assertGitCleanupNativeStateSync(e: GitCleanupEvidence, removal?: GitCleanupRemovalProof): void {
  if (e.version !== 2) admissionRefuse();
  const source = e.integration.feature;
  snapshot(e.integration.target, e.target); snapshot(e.main, e.mainSnapshot);
  let expected = e.inventory;
  if (removal) {
    const native = readGitCleanupNativeProof(removal);
    expected = removedInventory(e);
    if (!native || native.kind !== "removed" || !admissionEqual(native, removal) || removal.actionId !== e.actionId ||
      removal.sourcePath !== source.cwd || removal.adminPath !== source.gitDir ||
      !admissionEqual(removal.sourceIdentity, source.identities.checkout) || removal.featureOid !== e.integration.featureOid ||
      !admissionEqual(removal.before, e.inventory) || !admissionEqual(removal.after, expected)) admissionRefuse();
    admissionAbsent(source.cwd); admissionAbsent(source.gitDir);
  } else { snapshot(source, e.source); sourceIgnored(e); }
  const adminParent = path.join(source.commonDir, "worktrees");
  try { admissionPhysical(adminParent, e.adminParentIdentity); }
  catch (error) { if (!removal || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (!admissionEqual(inventory(e), expected)) admissionRefuse();
  for (const branch of new Set([source.branch, e.integration.target.branch, e.main.branch])) {
    for (const prefix of ["refs/heads", "logs/refs/heads"]) {
      const file = path.join(source.commonDir, prefix, branch);
      let dir = path.dirname(file);
      while (dir !== source.commonDir) {
        try { admissionPhysical(dir, admissionIdentity(dir)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        dir = path.dirname(dir);
      }
      admissionAbsent(`${file}.lock`);
      try {
        const data = admissionBytes(file);
        if (prefix === "refs/heads" && data.toString().startsWith("ref:")) admissionRefuse();
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
}
export interface GitCleanupAdmissionOptions extends GitCleanupDiagnostics {
  /** Diagnostics location only; unavailable/corrupt history cannot veto effects. */
  agentDir?: string;
}
export type GitCleanupAdmissionAdapter = GitCleanupDiagnostics;
export function createGitCleanupAdmission(options: GitCleanupAdmissionOptions = {}): GitCleanupAdmissionAdapter {
  return { onIntent: options.onIntent, onRemoval: options.onRemoval, onCompleted: options.onCompleted, onFailure: options.onFailure };
}
