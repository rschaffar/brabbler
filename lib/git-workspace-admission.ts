// Internal native state checks and optional diagnostics. No application reservations.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gitExecEnv } from "./git-exec";
import { parseBoundedGitWorktreePaths, type GitProjectResources } from "./git-project-resources";
import type { GitWorkspaceAdmission, GitWorkspaceEvidence, GitWorkspaceKnownParentCreation } from "./git-workspace-operation";
import { validLocalBranchName } from "./git-workflow-policy";

export const admissionHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const admissionEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function admissionRefuse(): never { throw new Error("Native Git state changed or is unsupported."); }
export function admissionKeys(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}
export function admissionIdentity(file: string) {
  const s = fs.lstatSync(file, { bigint: true });
  if (s.isSymbolicLink()) admissionRefuse();
  return { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) };
}
export function admissionPhysical(file: string, expected: ReturnType<typeof admissionIdentity>): void {
  if (!fs.lstatSync(file).isDirectory() || fs.realpathSync(file) !== file || !admissionEqual(admissionIdentity(file), expected)) admissionRefuse();
}
export function admissionResource(r: GitProjectResources): void {
  if (!admissionKeys(r, ["projectRoot", "cwd", "branch", "commonDir", "gitDir", "identities"]) ||
    !validLocalBranchName(r.branch) || !admissionKeys(r.identities, ["project", "checkout", "common", "git", "marker"])) admissionRefuse();
  for (const key of ["projectRoot", "cwd", "commonDir", "gitDir"] as const) {
    const file = r[key];
    if (typeof file !== "string" || file.length > 4096 || path.resolve(file) !== file || /[\x00-\x1f\x7f]/.test(file)) admissionRefuse();
  }
  for (const id of [r.identities.project, r.identities.checkout, r.identities.common, r.identities.git]) {
    if (!admissionKeys(id, ["device", "inode", "birthtime"]) || Object.values(id).some((v) => typeof v !== "string" || !/^[0-9]+$/.test(v))) admissionRefuse();
  }
  for (const [file, expected] of [[r.projectRoot, r.identities.project], [r.commonDir, r.identities.common],
    [r.cwd, r.identities.checkout], [r.gitDir, r.identities.git]] as const) admissionPhysical(file, expected);
  const marker = path.join(r.cwd, ".git"), s = fs.lstatSync(marker, { bigint: true });
  const actual = { ...admissionIdentity(marker), ...(s.isFile() ? { changed: String(s.ctimeNs), size: String(s.size) } : {}) };
  if (!admissionEqual(actual, r.identities.marker)) admissionRefuse();
  if (r.gitDir !== r.commonDir && (admissionBytes(marker).toString() !== `gitdir: ${r.gitDir}\n` ||
    admissionBytes(path.join(r.gitDir, "gitdir")).toString() !== `${r.cwd}/.git\n` ||
    path.resolve(r.gitDir, admissionBytes(path.join(r.gitDir, "commondir")).toString().trim()) !== r.commonDir)) admissionRefuse();
}
export function admissionBytes(file: string, limit = 64 * 1024 * 1024): Buffer {
  const s = fs.lstatSync(file);
  if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > limit) admissionRefuse();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const start = fs.fstatSync(fd), data = fs.readFileSync(fd), end = fs.fstatSync(fd), named = fs.lstatSync(file);
    if (data.length !== s.size || start.dev !== s.dev || start.ino !== s.ino || end.ctimeMs !== s.ctimeMs ||
      end.mtimeMs !== s.mtimeMs || named.dev !== s.dev || named.ino !== s.ino) admissionRefuse();
    return data;
  } finally { fs.closeSync(fd); }
}
/** Explicit Git/common dirs; never rediscover through a replaced .git marker. */
export function admissionGit(r: GitProjectResources, ...args: string[]): string {
  admissionResource(r);
  return execFileSync("git", ["--no-optional-locks", "-C", r.cwd, `--git-dir=${r.gitDir}`, `--work-tree=${r.cwd}`,
    ...(args[0] === "config" ? [] : ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "core.attributesFile=/dev/null"]), ...args], {
    encoding: "utf8", timeout: 15000, maxBuffer: 2 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: { ...gitExecEnv(), GIT_COMMON_DIR: r.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_ATTR_NOSYSTEM: "1" },
  });
}
export function admissionInventory(r: GitProjectResources) {
  const refs = admissionGit(r, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs");
  if (refs.split("\n").length > 2001) admissionRefuse();
  const registrations = admissionGit(r, "worktree", "list", "--porcelain", "-z");
  const checkouts = Object.fromEntries(parseBoundedGitWorktreePaths(Buffer.from(registrations)).map((cwd) => {
    const id = admissionIdentity(cwd); admissionPhysical(cwd, id); return [cwd, id];
  }));
  return { refs, registrations, checkouts };
}
export function admissionRows(registrations: string): string[] {
  parseBoundedGitWorktreePaths(Buffer.from(registrations));
  return registrations.slice(0, -2).split("\0\0");
}
export function admissionAbsent(file: string): void {
  try { fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  admissionRefuse();
}
const markers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START",
  "AUTO_MERGE", "MERGE_AUTOSTASH", "REBASE_HEAD", "ORIG_HEAD.lock", "index.lock", "HEAD.lock", "config.lock", "packed-refs.lock"];
export function admissionSafeFiles(r: GitProjectResources): void {
  for (const file of ["config", "packed-refs"]) {
    try { admissionBytes(path.join(r.commonDir, file), 2 * 1024 * 1024); }
    catch (error) { if (file === "config" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  for (const dir of new Set([r.gitDir, r.commonDir])) {
    for (const file of ["info/attributes", "info/grafts", "shallow", "config.worktree"]) admissionAbsent(path.join(dir, file));
    if (fs.readdirSync(dir).some((name) => name.startsWith("sharedindex."))) admissionRefuse();
    const hooks = path.join(dir, "hooks");
    try {
      admissionPhysical(hooks, admissionIdentity(hooks));
      const names = fs.readdirSync(hooks);
      if (names.length > 10000 || names.some((name) => !name.endsWith(".sample"))) admissionRefuse();
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  if (admissionGit(r, "for-each-ref", "--format=%(refname)", "refs/replace").trim()) admissionRefuse();
}
export function admissionClean(r: GitProjectResources, oid: string, tree: string): void {
  for (const marker of markers) admissionAbsent(path.join(r.gitDir, marker));
  for (const marker of ["config.lock", "packed-refs.lock"]) admissionAbsent(path.join(r.commonDir, marker));
  if (admissionGit(r, "symbolic-ref", "--quiet", "HEAD").trim() !== `refs/heads/${r.branch}` ||
    admissionGit(r, "rev-parse", "HEAD^{commit}").trim() !== oid || admissionGit(r, "rev-parse", "HEAD^{tree}").trim() !== tree ||
    admissionGit(r, "status", "--porcelain=v1", "-z", "--untracked-files=all") !== "" ||
    admissionGit(r, "diff", "--cached", "--no-ext-diff", "--no-textconv", "--name-only", "-z", oid, "--") !== "" ||
    admissionGit(r, "ls-files", "-u", "-z") !== "" ||
    admissionGit(r, "ls-files", "-v", "-z").split("\0").some((row) => row && !row.startsWith("H "))) admissionRefuse();
}
/** Independently hash tracked bytes/modes rather than trusting status's stat cache. */
export function admissionTracked(r: GitProjectResources, oid: string, workspace: boolean): string {
  const rows = admissionGit(r, "ls-tree", "-r", "-z", `${oid}^{tree}`).split("\0").filter(Boolean);
  if (rows.length > (workspace ? 10000 : 2000)) admissionRefuse();
  const files: unknown[] = [], dirs = new Map<string, ReturnType<typeof admissionIdentity>>([["", r.identities.checkout]]);
  let total = 0;
  const parsed = rows.map((row) => {
    const match = /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/.exec(row);
    if (!match || /(^|\/)\.(gitattributes|git)(\/|$)/.test(match[3]) || /[\x00-\x1f\x7f]/.test(match[3]) ||
      match[3].split("/").some((part) => !part || part === "." || part === "..")) admissionRefuse();
    let dir = "";
    for (const part of match[3].split("/").slice(0, -1)) {
      dir = dir ? `${dir}/${part}` : part;
      const file = path.join(r.cwd, dir), id = admissionIdentity(file); admissionPhysical(file, id); dirs.set(dir, id);
    }
    return match;
  });
  for (const dir of dirs.keys()) admissionAbsent(path.join(r.cwd, dir, ".gitattributes"));
  for (const match of parsed) {
    const file = path.join(r.cwd, match[3]), s = fs.lstatSync(file), data = admissionBytes(file);
    total += data.length; if (total > 64 * 1024 * 1024 || Boolean(s.mode & 0o100) !== (match[1] === "100755")) admissionRefuse();
    if (createHash(oid.length === 40 ? "sha1" : "sha256").update(`blob ${data.length}\0`).update(data).digest("hex") !== match[2]) admissionRefuse();
    files.push(workspace ? `${match[3]}\0${s.mode}\0${admissionHash(data)}` :
      [match[3], admissionIdentity(file), String(s.mode), admissionHash(data)]);
  }
  if (workspace) return admissionHash(JSON.stringify({ files, directories: [...dirs] }));
  return admissionHash(JSON.stringify([... [...dirs.keys()].sort().map((dir) =>
    [dir, dirs.get(dir), String(fs.lstatSync(path.join(r.cwd, dir), { bigint: true }).mode)]), ...files]));
}
function workspaceSnapshot(r: GitProjectResources, s: GitWorkspaceEvidence["sourceSnapshot"]): void {
  if (admissionHash(admissionGit(r, "config", "--list", "--null")) !== s.configDigest) admissionRefuse();
  admissionSafeFiles(r);
  const tree = admissionGit(r, "rev-parse", `${s.oid}^{tree}`).trim();
  if (admissionHash(admissionBytes(path.join(r.gitDir, "index"))) !== s.indexDigest ||
    admissionHash(admissionBytes(path.join(r.gitDir, "HEAD"))) !== s.headDigest ||
    !admissionEqual(admissionIdentity(path.join(r.gitDir, "index")), s.indexIdentity) ||
    !admissionEqual(admissionIdentity(path.join(r.gitDir, "HEAD")), s.headIdentity) ||
    admissionTracked(r, s.oid, true) !== s.trackedFilesDigest) admissionRefuse();
  admissionClean(r, s.oid, tree);
}
/** Final native boundary check. No external callback, ledger or busy inventory. */
export function assertGitWorkspaceNativeStateSync(e: GitWorkspaceEvidence, parent?: GitWorkspaceKnownParentCreation): void {
  if (e.version !== 2) admissionRefuse();
  workspaceSnapshot(e.source, e.sourceSnapshot);
  if (e.baseCheckout && e.baseSnapshot) workspaceSnapshot(e.baseCheckout, e.baseSnapshot);
  admissionAbsent(e.request.destinationPath);
  if (e.parentCreation) {
    const p = e.parentCreation;
    admissionPhysical(p.ancestorPath, p.ancestorIdentity);
    if (!parent) admissionAbsent(p.path);
    else {
      if (parent.path !== p.path || parent.mode !== p.mode || parent.ownerUid !== process.geteuid?.() ||
        parent.ancestorPath !== p.ancestorPath || !admissionEqual(parent.ancestorIdentity, p.ancestorIdentity)) admissionRefuse();
      admissionPhysical(p.path, parent.identity);
      const s = fs.lstatSync(p.path);
      if ((s.mode & 0o7777) !== parent.mode || s.uid !== parent.ownerUid) admissionRefuse();
    }
  } else {
    if (!e.parentIdentity || parent) admissionRefuse();
    admissionPhysical(path.dirname(e.request.destinationPath), e.parentIdentity);
  }
  const selected = new Set([e.source.branch, e.request.baseBranch, e.request.branch].map((b) => `refs/heads/${b}`));
  const overlap = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
  const refs = admissionGit(e.source, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs");
  if (refs.split("\n").length > 1001 || refs.split("\n").filter((row) => selected.has(row.split("\0")[0])).sort().join("\n") + "\n" !== e.refs) admissionRefuse();
  const registrations = admissionGit(e.source, "worktree", "list", "--porcelain", "-z");
  const relevant = admissionRows(registrations).filter((row) => {
    const fields = row.split("\0"), cwd = fields[0].slice(9);
    return fields.some((f) => f.startsWith("branch ") && selected.has(f.slice(7))) ||
      overlap(cwd, e.request.destinationPath) || overlap(cwd, e.request.sourceCheckoutPath);
  }).sort().join("\0\0") + "\0\0";
  if (relevant !== e.registrations) admissionRefuse();
  for (const branch of selected) {
    for (const prefix of ["", "logs/"]) {
      const file = path.join(e.source.commonDir, prefix + branch);
      let dir = path.dirname(file);
      while (dir !== e.source.commonDir) {
        try { admissionPhysical(dir, admissionIdentity(dir)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        dir = path.dirname(dir);
      }
      admissionAbsent(`${file}.lock`);
      try {
        const data = admissionBytes(file);
        if (!prefix && data.toString().startsWith("ref:")) admissionRefuse();
        if (!prefix && e.request.mode === "create" && branch === `refs/heads/${e.request.branch}`) admissionRefuse();
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
  const worktrees = path.join(e.source.commonDir, "worktrees");
  try { admissionPhysical(worktrees, admissionIdentity(worktrees)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
export interface GitWorkspaceAdmissionOptions extends GitWorkspaceAdmission {
  /** Retained only as a diagnostics location; never consulted for authorization. */
  agentDir?: string;
}
export function createGitWorkspaceAdmission(options: GitWorkspaceAdmissionOptions = {}): GitWorkspaceAdmission {
  return { onIntent: options.onIntent, onCompleted: options.onCompleted, onFailure: options.onFailure };
}
