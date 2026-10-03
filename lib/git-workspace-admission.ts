// Server-only callback adapter. Never install from route JSON, saved grants or history.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent,
  type GitOperationReservation } from "./git-operation-admission";
import { gitExecEnv } from "./git-exec";
import { parseBoundedGitWorktreePaths, type GitProjectResources } from "./git-project-resources";
import { readGitWorkspaceNativeProof, type GitWorkspaceAdmission, type GitWorkspaceCompletedProof, type GitWorkspaceEvidence,
  type GitWorkspaceFailureEvidence } from "./git-workspace-operation";
import { validLocalBranchName } from "./git-workflow-policy";

export const admissionHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const admissionEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function admissionRefuse(): never { throw new Error("Native Git admission requires manual recovery; do not retry."); }
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
}
export function admissionClean(r: GitProjectResources, oid: string, tree: string): void {
  for (const dir of new Set([r.gitDir, r.commonDir])) for (const marker of markers) admissionAbsent(path.join(dir, marker));
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
  // Check the captured safe configuration before commands such as status can
  // consult attributes/filters. A late authority callback is not a config waiver.
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
function expectedWorkspace(e: GitWorkspaceEvidence) {
  const rows = admissionRows(e.registrations), added = `worktree ${e.request.destinationPath}\0HEAD ${e.resultOid}\0branch refs/heads/${e.request.branch}`;
  const refs = e.refs.trimEnd().split("\n").filter(Boolean);
  if (e.request.mode === "create") refs.push(`refs/heads/${e.request.branch}\0${e.resultOid}\0`);
  return { rows: [...rows, added].sort(), refs: refs.sort() };
}
function workspaceDestinationEntries(r: GitProjectResources, oid: string): void {
  const children = new Map<string, Set<string>>([["", new Set([".git"])]]);
  for (const row of admissionGit(r, "ls-tree", "-r", "-z", `${oid}^{tree}`).split("\0").filter(Boolean)) {
    let parent = "";
    for (const part of row.slice(row.indexOf("\t") + 1).split("/")) {
      const entries = children.get(parent) ?? new Set<string>(); entries.add(part); children.set(parent, entries);
      parent = parent ? `${parent}/${part}` : part;
    }
  }
  for (const [relative, expected] of children) {
    const dir = path.join(r.cwd, relative), seen = fs.readdirSync(dir);
    if (seen.length !== expected.size || seen.some((name) => !expected.has(name))) admissionRefuse();
    for (const name of seen) {
      const child = relative ? `${relative}/${name}` : name, s = fs.lstatSync(path.join(r.cwd, child));
      if (s.isSymbolicLink() || (children.has(child) ? !s.isDirectory() : !s.isFile())) admissionRefuse();
    }
  }
}
function verifyWorkspace(e: GitWorkspaceEvidence, p: GitWorkspaceCompletedProof,
  originalCheckouts: ReturnType<typeof admissionInventory>["checkouts"]) {
  if (!admissionKeys(p, ["version", "outcome", "actionId", "mode", "destination", "sourceOid", "baseOid", "branchRef", "resultOid", "treeOid",
    "sourceIndexDigest", "destinationIndexDigest", "sourceTrackedFilesDigest", "destinationTrackedFilesDigest", "configDigest", "refsDigest",
    "registrationsDigest", "backlinkDigest", "status", ...(p?.knownParentCreation ? ["knownParentCreation"] : [])]) || p.version !== 1 || p.outcome !== "completed" || p.actionId !== e.actionId ||
    p.mode !== e.request.mode || p.sourceOid !== e.sourceSnapshot.oid || p.baseOid !== e.request.expectedBaseOid ||
    p.branchRef !== `refs/heads/${e.request.branch}` || p.resultOid !== e.resultOid || p.treeOid !== e.treeOid || p.status !== "clean") admissionRefuse();
  const d = p.destination;
  if (d.cwd !== e.request.destinationPath || d.branch !== e.request.branch || d.projectRoot !== e.source.projectRoot ||
    d.commonDir !== e.source.commonDir || path.dirname(d.gitDir) !== path.join(d.commonDir, "worktrees") ||
    !admissionEqual(d.identities.common, e.source.identities.common) || !admissionEqual(d.identities.project, e.source.identities.project)) admissionRefuse();
  workspaceSnapshot(e.source, e.sourceSnapshot);
  if (e.baseCheckout && e.baseSnapshot) workspaceSnapshot(e.baseCheckout, e.baseSnapshot);
  if (e.parentCreation) {
    const plan = e.parentCreation, known = p.knownParentCreation;
    if (!known || !admissionKeys(known, ["path", "identity", "mode", "ownerUid", "ancestorPath", "ancestorIdentity"]) ||
      known.path !== plan.path || known.ancestorPath !== plan.ancestorPath || known.mode !== 0o700 || known.mode !== plan.mode ||
      known.ownerUid !== process.geteuid?.() || !admissionEqual(known.ancestorIdentity, plan.ancestorIdentity)) admissionRefuse();
    admissionPhysical(plan.ancestorPath, plan.ancestorIdentity); admissionPhysical(plan.path, known.identity);
    const s = fs.lstatSync(plan.path);
    if ((s.mode & 0o7777) !== known.mode || s.uid !== known.ownerUid) admissionRefuse();
  } else {
    if (!e.parentIdentity || p.knownParentCreation) admissionRefuse();
    admissionPhysical(path.dirname(e.request.destinationPath), e.parentIdentity);
  }
  admissionClean(d, e.resultOid, e.treeOid); workspaceDestinationEntries(d, e.resultOid);
  const current = admissionInventory(e.source), expected = expectedWorkspace(e);
  const survivingCheckouts = { ...current.checkouts }; delete survivingCheckouts[d.cwd];
  if (!admissionEqual(survivingCheckouts, originalCheckouts)) admissionRefuse();
  if (!admissionEqual(admissionRows(current.registrations).sort(), expected.rows) ||
    !admissionEqual(current.refs.trimEnd().split("\n").filter(Boolean).sort(), expected.refs) ||
    admissionGit(e.source, "show-ref", "--verify", "--hash", `refs/heads/${e.request.baseBranch}`).trim() !== e.request.expectedBaseOid ||
    p.sourceIndexDigest !== e.sourceSnapshot.indexDigest || p.sourceTrackedFilesDigest !== e.sourceSnapshot.trackedFilesDigest ||
    p.destinationIndexDigest !== admissionHash(admissionBytes(path.join(d.gitDir, "index"))) ||
    p.destinationTrackedFilesDigest !== admissionTracked(d, e.resultOid, true) || p.configDigest !== e.sourceSnapshot.configDigest ||
    p.configDigest !== admissionHash(admissionGit(d, "config", "--list", "--null")) || p.refsDigest !== admissionHash(current.refs) ||
    p.registrationsDigest !== admissionHash(current.registrations) || p.backlinkDigest !== admissionHash(admissionBytes(path.join(d.gitDir, "gitdir")))) admissionRefuse();
  return current;
}
export interface GitWorkspaceAdmissionOptions {
  agentDir: string;
  /** The coordinator must create/anchor its journal with THIS native-generated ID. */
  onIntent(evidence: Readonly<GitWorkspaceEvidence>): Promise<void>;
  /** Runs before release; rejection keeps both completed artifact and quarantine. */
  onCompleted(proof: Readonly<GitWorkspaceCompletedProof>): Promise<void>;
  onFailure?(facts: Readonly<GitWorkspaceFailureEvidence>): Promise<void>;
}
export function createGitWorkspaceAdmission(options: GitWorkspaceAdmissionOptions): GitWorkspaceAdmission {
  return {
    async assertAdmission(source, destination, parentCreation) {
      admissionAbsent(destination);
      if (parentCreation) {
        if (parentCreation.path !== path.dirname(destination) || parentCreation.path !== `${source.projectRoot}-worktrees` ||
          parentCreation.expectedAbsent !== true || parentCreation.mode !== 0o700 ||
          parentCreation.ancestorPath !== path.dirname(source.projectRoot)) admissionRefuse();
        admissionAbsent(parentCreation.path); admissionPhysical(parentCreation.ancestorPath, parentCreation.ancestorIdentity);
      }
      await assertGitOperationAdmission(source, options.agentDir);
    },
    async beginIntent(input) {
      const e = structuredClone(input), initial = admissionInventory(e.source);
      if (initial.refs !== e.refs || initial.registrations !== e.registrations) admissionRefuse();
      admissionAbsent(e.request.destinationPath); workspaceSnapshot(e.source, e.sourceSnapshot);
      const op: GitOperationReservation = await beginSupervisedGitOperationIntent(e.source, e.actionId, "workspace", options.agentDir);
      op.recordNativeEvidence("binding", { evidence: e, checkouts: initial.checkouts });
      await options.onIntent(structuredClone(e));
      let measured: GitWorkspaceCompletedProof | undefined, token: import("./git-operation-admission").GitNativeEvidenceSeal | undefined;
      const transition = (proof: GitWorkspaceCompletedProof) => {
        // A structurally valid payload and matching Git state do not establish
        // that THIS native verifier issued the result. Require private identity.
        const native = readGitWorkspaceNativeProof(proof);
        if (!native || !admissionEqual(native, proof)) admissionRefuse();
        if (measured) { if (!admissionEqual(measured, proof)) admissionRefuse(); verifyWorkspace(e, proof, initial.checkouts); return; }
        verifyWorkspace(e, proof, initial.checkouts);
        // Publication precedes the inventory allowance change, never the reverse.
        token = op.recordNativeEvidence("completed", proof);
        measured = structuredClone(proof);
      };
      const assertOwned = (proof?: GitWorkspaceCompletedProof) => {
        if (proof) transition(proof);
        op.assertOwned();
        if (measured) verifyWorkspace(e, measured, initial.checkouts);
        else {
          workspaceSnapshot(e.source, e.sourceSnapshot);
          if (e.baseCheckout && e.baseSnapshot) workspaceSnapshot(e.baseCheckout, e.baseSnapshot);
          if (e.parentIdentity) admissionPhysical(path.dirname(e.request.destinationPath), e.parentIdentity);
          if (e.parentCreation) admissionPhysical(e.parentCreation.ancestorPath, e.parentCreation.ancestorIdentity);
          if (!admissionEqual(admissionInventory(e.source), initial)) admissionRefuse();
          admissionAbsent(e.request.destinationPath);
        }
      };
      return {
        assertOwned,
        async completed(proof) {
          transition(proof); assertOwned();
          await options.onCompleted(structuredClone(measured!));
          assertOwned(); op.resolveNativeOutcome(token!);
        },
        async recordFailure(failure) {
          if (failure.version !== 1 || failure.actionId !== e.actionId || failure.recoveryRequired !== true) admissionRefuse();
          op.recordNativeEvidence("failure", structuredClone(failure));
          await options.onFailure?.(structuredClone(failure));
        },
      };
    },
  };
}
