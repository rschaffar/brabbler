// Internal native linear preparation. Not a route, tool, approval, or replay handle.
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, stat, unlink, writeFile } from "node:fs/promises";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { acquireGitCheckoutGate } from "./git-checkout-gate";
import { gitExecEnv } from "./git-exec";
import { assertGitOperationAdmission, beginSupervisedGitOperationIntent } from "./git-operation-admission";
import { planGitPreparationCandidate, type GitPreparationCandidate } from "./git-preparation-candidate";
import { preflightGitPreparation, type GitPreparationRequest, type GitPreparationSnapshot } from "./git-preparation";
import { selectCanonicalGitResources, revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { loadGitProjectSettings } from "./git-project-settings";
import type { GitReviewRepository } from "./git-review";
import { samePath } from "./paths";

const exec = promisify(execFile);
const OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const digest = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
type Bound = Exclude<GitReviewRepository, string>;
async function withPinnedRepositories<T>(source: GitProjectResources, target: GitProjectResources,
  action: (from: Bound, to: Bound) => Promise<T>): Promise<T> {
  if (process.platform !== "linux") refuse();
  const handles: Awaited<ReturnType<typeof open>>[] = [];
  const pin = async (path: string, expected: { device: string; inode: string; birthtime: string }) => {
    const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    handles.push(handle);
    const info = await handle.stat({ bigint: true });
    if (!info.isDirectory() || String(info.dev) !== expected.device || String(info.ino) !== expected.inode ||
        String(info.birthtimeNs) !== expected.birthtime) refuse();
    return `/proc/${process.pid}/fd/${handle.fd}`;
  };
  try {
    const from = { cwd: await pin(source.cwd, source.identities.checkout), gitDir: await pin(source.gitDir, source.identities.git),
      commonDir: await pin(source.commonDir, source.identities.common) };
    const to = { cwd: await pin(target.cwd, target.identities.checkout), gitDir: await pin(target.gitDir, target.identities.git),
      commonDir: await pin(target.commonDir, target.identities.common) };
    await revalidateGitProjectResources(source); await revalidateGitProjectResources(target);
    return await action(from, to);
  } finally { await Promise.allSettled(handles.map((handle) => handle.close())); }
}
const markers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer", "BISECT_START", "AUTO_MERGE", "MERGE_AUTOSTASH", "REBASE_HEAD", "ORIG_HEAD.lock"];
function refuse(): never { throw new Error("Preparation apply refused: stale or unsafe checkout; inspect and request a fresh candidate"); }
async function syncDir(dir: string): Promise<void> {
  const fd = await open(dir, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function syncPinnedDir(dir: string): Promise<void> {
  // /proc/<pid>/fd/<n> itself is a kernel symlink to our open directory.
  // The final "/." refers to the pinned directory, not a rediscovered path.
  const fd = await open(`${dir}/.`, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function privateRecovery(agentDir: string): Promise<string> {
  const root = await stat(agentDir);
  if (!root.isDirectory() || !samePath(agentDir, await realpath(agentDir))) refuse();
  let parent = agentDir;
  for (const name of ["pi-web", "git-preparation-recovery", "v1"]) {
    const next = join(parent, name);
    try { await mkdir(next, { mode: 0o700 }); await syncDir(parent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = await lstat(next);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) refuse();
    parent = next;
  }
  // No implicit retention, truncation or orphan cleanup. A full private history
  // fails closed before the next intent rather than accumulating unbounded data.
  if ((await readdir(parent)).length >= 128) refuse();
  return parent;
}
async function immutable(file: string, data: unknown): Promise<void> {
  const value = JSON.stringify(data) + "\n";
  if (Buffer.byteLength(value) > 1024 * 1024) refuse();
  const fd = await open(file, "wx", 0o600);
  try { await fd.writeFile(value); await fd.sync(); } finally { await fd.close(); }
  await syncDir(dirname(file));
}
async function git(repo: Bound, hooks: string, index: string | undefined, ...args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`,
    `--work-tree=${repo.cwd}`, "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${hooks}`,
    "-c", "commit.gpgsign=false", "-c", "core.attributesFile=/dev/null", ...args], {
    encoding: "utf8", timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    env: { ...gitExecEnv(index), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
      GIT_NO_LAZY_FETCH: "1", GIT_ATTR_NOSYSTEM: "1", GIT_PAGER: "cat" },
  });
  return stdout;
}
async function updateRefs(repo: Bound, hooks: string, snapshot: GitPreparationSnapshot, newOid: string): Promise<void> {
  // Both ref locks are held during prepare/commit. A separate show-ref followed
  // by update-ref on only the feature branch would not protect the target.
  const commands = `start\nverify ${snapshot.target.ref} ${snapshot.target.oid}\n` +
    `update ${snapshot.source.ref} ${newOid} ${snapshot.source.oid}\nprepare\ncommit\n`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("git", ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`,
      `--work-tree=${repo.cwd}`, "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${hooks}`,
      "-c", "commit.gpgsign=false", "-c", "core.attributesFile=/dev/null", "update-ref", "--stdin"], {
      stdio: ["pipe", "ignore", "ignore"], timeout: 30_000,
      env: { ...gitExecEnv(), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1", GIT_ATTR_NOSYSTEM: "1", GIT_PAGER: "cat" },
    });
    child.stdin.on("error", () => { /* close reports failure */ });
    child.stdin.end(commands);
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error("Ref transaction failed")));
  });
}
const selector = (item: GitPreparationSnapshot["source"]) => ({ repositoryPath: item.projectRoot,
  checkoutPath: item.cwd, workspaceBranch: item.branch });
async function checkRefs(source: Bound, target: Bound, hooks: string, snapshot: GitPreparationSnapshot): Promise<void> {
  if ((await git(source, hooks, undefined, "symbolic-ref", "--quiet", "HEAD")).trim() !== snapshot.source.ref ||
      (await git(target, hooks, undefined, "symbolic-ref", "--quiet", "HEAD")).trim() !== snapshot.target.ref ||
      (await git(source, hooks, undefined, "show-ref", "--verify", "--hash", snapshot.source.ref)).trim() !== snapshot.source.oid ||
      (await git(target, hooks, undefined, "show-ref", "--verify", "--hash", snapshot.target.ref)).trim() !== snapshot.target.oid ||
      (await git(source, hooks, undefined, "show-ref", "--verify", "--hash", snapshot.designatedMain.ref)).trim() !== snapshot.designatedMain.oid) refuse();
}
async function noMarkers(gitDir: string): Promise<void> {
  for (const name of markers) {
    try { await lstat(join(gitDir, name)); refuse(); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
async function ownedLock(path: string, info: { dev: number; ino: number }): Promise<void> {
  const now = await lstat(path);
  if (!now.isFile() || now.dev !== info.dev || now.ino !== info.ino) refuse();
}
async function collisionCheck(repo: Bound, hooks: string, oldTree: string, newTree: string, index?: string): Promise<void> {
  const changed = (await git(repo, hooks, index, "diff", "--no-renames", "--name-only", "-z", oldTree, newTree, "--")).split("\0").filter(Boolean);
  const ignored = (await git(repo, hooks, index, "ls-files", "--others", "--ignored", "--exclude-standard", "-z")).split("\0").filter(Boolean);
  for (const path of changed) {
    if (ignored.some((item) => item === path || item.startsWith(`${path}/`) || path.startsWith(`${item}/`))) refuse();
    let parent = repo.cwd;
    for (const component of path.split("/").slice(0, -1)) {
      parent = join(parent, component);
      try { if ((await lstat(parent)).isSymbolicLink()) refuse(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
}

export type GitPreparationApplyResult =
  | { status: "already-prepared"; oldSourceOid: string; newSourceOid: string; targetOid: string }
  | { status: "prepared"; oldSourceOid: string; newSourceOid: string; targetOid: string; treeOid: string; recoveryPath: string }
  | { status: "partial-state"; oldSourceOid: string; observedSourceOid: string | null; targetOid: string; recoveryPath: string };
export interface GitPreparedApply {
  readonly snapshot: GitPreparationSnapshot;
  readonly candidate: GitPreparationCandidate;
}
type Saved = { snapshot: GitPreparationSnapshot; candidate: GitPreparationCandidate; source: GitProjectResources;
  target: GitProjectResources; settingsRevision: string; agentDir: string; issuedAt: number };
function assertDesignatedMain(snapshot: GitPreparationSnapshot): void {
  if (snapshot.source.branch === snapshot.target.branch || snapshot.source.ref === snapshot.designatedMain.ref ||
      snapshot.target.ref !== snapshot.designatedMain.ref || snapshot.target.oid !== snapshot.designatedMain.oid) refuse();
}
async function assertMainSettings(source: GitProjectResources, agentDir: string, snapshot: GitPreparationSnapshot,
  revision: string): Promise<void> {
  const settings = await loadGitProjectSettings(source, [], agentDir);
  if (settings.revision !== revision || settings.project.mainBranch !== snapshot.target.branch ||
      `refs/heads/${settings.project.mainBranch}` !== snapshot.designatedMain.ref) refuse();
  assertDesignatedMain(snapshot);
}
const handleKey = Symbol.for("pi-web:git-preparation-apply:issued");
function issued(): WeakMap<GitPreparedApply, Saved> {
  const shared = globalThis as unknown as Record<symbol, WeakMap<GitPreparedApply, Saved> | undefined>;
  return shared[handleKey] ??= new WeakMap();
}
/** An in-process, single-use comparison. A serialized snapshot/candidate, journal
 * record or caller-constructed object cannot be used to start an apply. */
export async function prepareGitPreparationApply(request: GitPreparationRequest, agentDir = getAgentDir()): Promise<GitPreparedApply> {
  const source = await selectCanonicalGitResources(request.source);
  const target = await selectCanonicalGitResources(request.target);
  const settings = await loadGitProjectSettings(source, [], agentDir);
  const snapshot = await preflightGitPreparation(request, agentDir);
  await assertMainSettings(source, agentDir, snapshot, settings.revision);
  await revalidateGitProjectResources(source); await revalidateGitProjectResources(target);
  if (!samePath(source.cwd, snapshot.source.cwd) || !samePath(target.cwd, snapshot.target.cwd) ||
      source.branch !== snapshot.source.branch || target.branch !== snapshot.target.branch) refuse();
  await assertGitOperationAdmission(source, agentDir);
  const candidate = await planGitPreparationCandidate(snapshot, agentDir);
  await assertMainSettings(source, agentDir, snapshot, settings.revision);
  await revalidateGitProjectResources(source); await revalidateGitProjectResources(target);
  const handle = Object.freeze({ snapshot: structuredClone(snapshot), candidate: structuredClone(candidate) });
  issued().set(handle, { snapshot: structuredClone(snapshot), candidate: structuredClone(candidate),
    source, target, settingsRevision: settings.revision, agentDir, issuedAt: Date.now() });
  return handle;
}
export interface GitPreparationApplyOptions {
  prepared: GitPreparedApply;
  /** Actor-specific LIVE permission, checked before work and again immediately at the ref boundary. */
  authorize: (phase: "before-apply" | "final-ref") => Promise<void>;
  /** Test seams; never supplied by an external request. */
  afterIntent?: () => void | Promise<void>;
  afterCheckout?: () => void | Promise<void>;
  afterRef?: () => void | Promise<void>;
  /** node:test only: force a failure after the real index has been installed. */
  afterIndexInstall?: () => void | Promise<void>;
}

/** Every comparison is recomputed on the server. Caller-supplied OIDs are consistency
 * assertions, not authority. No recovery or retry entry point exists. */
export async function applyGitPreparation(options: GitPreparationApplyOptions): Promise<GitPreparationApplyResult> {
  if (!options || typeof options.authorize !== "function" || !options.prepared ||
      options.afterIndexInstall && !process.env.NODE_TEST_CONTEXT) refuse();
  const saved = issued().get(options.prepared);
  if (!saved) refuse();
  issued().delete(options.prepared); // one attempt, even if gate acquisition or validation fails
  const { snapshot, candidate, settingsRevision, agentDir } = saved;
  assertDesignatedMain(snapshot);
  if (Date.now() - saved.issuedAt > 5 * 60_000 ||
      JSON.stringify(options.prepared.snapshot) !== JSON.stringify(snapshot) ||
      JSON.stringify(options.prepared.candidate) !== JSON.stringify(candidate)) refuse();
  const release = acquireGitCheckoutGate([snapshot.source.cwd, snapshot.target.cwd]);
  try {
    const sourceSelection = saved.source, targetSelection = saved.target;
    await revalidateGitProjectResources(sourceSelection); await revalidateGitProjectResources(targetSelection);
    if (sourceSelection.commonDir !== targetSelection.commonDir || samePath(sourceSelection.cwd, targetSelection.cwd)) refuse();
    const request = { source: selector(snapshot.source), target: selector(snapshot.target) };
    const fresh = async () => {
      const checked = await preflightGitPreparation(request, agentDir);
      if (JSON.stringify(checked) !== JSON.stringify(snapshot)) refuse();
      return checked;
    };
    await fresh();
    await assertMainSettings(sourceSelection, agentDir, snapshot, settingsRevision);
    await assertGitOperationAdmission(sourceSelection, agentDir);
    if (JSON.stringify(await planGitPreparationCandidate(snapshot, agentDir)) !== JSON.stringify(candidate)) refuse();
    if (snapshot.status === "already-prepared") {
      if (candidate.status !== "already-prepared" || candidate.oldSourceOid !== candidate.newSourceOid) refuse();
      return { status: "already-prepared", oldSourceOid: snapshot.source.oid, newSourceOid: snapshot.source.oid, targetOid: snapshot.target.oid };
    }
    if (candidate.status !== "candidate" || candidate.oldSourceOid !== snapshot.source.oid || candidate.targetOid !== snapshot.target.oid ||
        candidate.newSourceOid === snapshot.source.oid || !OID.test(candidate.newSourceOid) ||
        candidate.comparison.commits.length !== snapshot.rewriteSeries.length) refuse();
    await options.authorize("before-apply");
    await fresh();
    await assertMainSettings(sourceSelection, agentDir, snapshot, settingsRevision);
    if (JSON.stringify(await planGitPreparationCandidate(snapshot, agentDir)) !== JSON.stringify(candidate)) refuse();
    await assertGitOperationAdmission(sourceSelection, agentDir);
    return await withPinnedRepositories(sourceSelection, targetSelection, async (source, target) => {
      const hooks = await privateRecovery(agentDir).then(async (dir) => {
        const path = join(dir, `hooks-${randomUUID()}`);
        await mkdir(path, { mode: 0o700 }); await syncDir(dir);
        return path;
      });
      const runSource = (index: string | undefined, ...args: string[]) => git(source, hooks, index, ...args);
      const runTarget = (...args: string[]) => git(target, hooks, undefined, ...args);
      const safeConfig = async () => {
        for (const repo of [source, target]) {
          for (const record of (await git(repo, hooks, undefined, "config", "--list", "--null")).split("\0")) {
            if (!record) continue;
            const boundary = record.indexOf("\n");
            if (boundary < 0) refuse();
            const name = record.slice(0, boundary).toLowerCase(), value = record.slice(boundary + 1);
            if (name === "core.hookspath" && value === hooks || name === "core.fsmonitor" && value === "false" ||
                name === "commit.gpgsign" && value === "false" || name === "core.attributesfile" && value === "/dev/null" ||
                name === "core.autocrlf" && (value === "false" || value === "input")) continue;
            if (/^(filter\.|merge\.|diff\.|index\.|extensions\.|core\.(?:hookspath|fsmonitor|attributesfile|external|sparsecheckout|splitindex|worktree|ignorecase|protecthfs|protectntfs|eol|autocrlf|symlinks)|commit\.|i18n\.commitencoding)/.test(name)) refuse();
          }
        }
      };
      const tree = (await runSource(undefined, "rev-parse", `${candidate.newSourceOid}^{tree}`)).trim();
      const oldTree = (await runSource(undefined, "rev-parse", `${snapshot.source.oid}^{tree}`)).trim();
      if (!OID.test(tree) || tree !== candidate.comparison.commits.at(-1)?.newTreeOid || !OID.test(oldTree)) refuse();
      await checkRefs(source, target, hooks, snapshot);
      await noMarkers(source.gitDir); await noMarkers(target.gitDir);
      await collisionCheck(source, hooks, oldTree, tree);
      await fresh();
      await revalidateGitProjectResources(sourceSelection); await revalidateGitProjectResources(targetSelection);
      // All live filesystem operations use the pinned Git-directory descriptor.
      // The physical path is retained only as human-readable recovery metadata.
      const index = join(source.gitDir, "index"), lockPath = `${index}.lock`;
      const indexStat = await lstat(index);
      if (!indexStat.isFile() || indexStat.isSymbolicLink() || indexStat.nlink !== 1 || indexStat.size > 8 * 1024 * 1024) refuse();
      const original = await readFile(index);
      if (digest(original) !== snapshot.source.indexDigest) refuse();
      const assertOriginalIndex = async () => {
        const current = await lstat(index);
        if (!current.isFile() || current.isSymbolicLink() || current.dev !== indexStat.dev || current.ino !== indexStat.ino ||
            current.size !== indexStat.size || digest(await readFile(index)) !== snapshot.source.indexDigest) refuse();
      };
      const recoveryDir = await privateRecovery(agentDir);
      const id = randomUUID();
      const recoveryPath = join(recoveryDir, `${id}.json`);
      const tempIndex = join(recoveryDir, `${id}.index`);
      // Immutable evidence is durable before the admission intent and before ANY index/checkout/ref effect.
      await immutable(recoveryPath, { version: 1, phase: "prepared", source: sourceSelection, target: targetSelection,
        snapshot, candidate, settingsRevision, oldTree, newTree: tree,
        physicalIndexPath: join(sourceSelection.gitDir, "index"), physicalLockPath: join(sourceSelection.gitDir, "index.lock"), tempIndex });
      const admission = await beginSupervisedGitOperationIntent(sourceSelection, id, "prepare", agentDir);
      let lock: Awaited<ReturnType<typeof open>> | undefined;
      let started = false;
      let installed = false;
      let phase = "before-checkout";
      let lockIdentity: { dev: number; ino: number } | undefined;
      try {
        await options.afterIntent?.();
        lock = await open(lockPath, "wx", 0o600);
        const info = await lock.stat(); lockIdentity = { dev: info.dev, ino: info.ino };
        await writeFile(tempIndex, original, { flag: "wx", mode: 0o600 });
        // The owned index.lock intentionally blocks ordinary preflight. Inspect the
        // physical index and refs directly under the gate instead.
        await checkRefs(source, target, hooks, snapshot);
        if ((await runSource(tempIndex, "write-tree")).trim() !== oldTree ||
            await runSource(tempIndex, "status", "--porcelain=v1", "-z", "--untracked-files=all") !== "") refuse();
        await revalidateGitProjectResources(sourceSelection); await revalidateGitProjectResources(targetSelection);
        await noMarkers(source.gitDir); await noMarkers(target.gitDir);
        await ownedLock(lockPath, lockIdentity);
        await assertOriginalIndex();
        await collisionCheck(source, hooks, oldTree, tree);
        await safeConfig();
        await assertMainSettings(sourceSelection, agentDir, snapshot, settingsRevision);
        admission.assertOwned();
        started = true; // read-tree -u may partially modify the worktree even on nonzero exit.
        phase = "checkout";
        await runSource(tempIndex, "read-tree", "-u", "-m", snapshot.source.oid, candidate.newSourceOid);
        await options.afterCheckout?.();
        if ((await lstat(tempIndex)).size > 16 * 1024 * 1024 || (await runSource(tempIndex, "write-tree")).trim() !== tree) refuse();
        await assertOriginalIndex();
        if (await runSource(tempIndex, "diff-files", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--") !== "" ||
            await runSource(tempIndex, "ls-files", "--others", "--exclude-standard", "-z") !== "") refuse();
        await checkRefs(source, target, hooks, snapshot);
        await revalidateGitProjectResources(sourceSelection); await revalidateGitProjectResources(targetSelection);
        await noMarkers(source.gitDir); await noMarkers(target.gitDir);
        await ownedLock(lockPath, lockIdentity);
        await checkRefs(source, target, hooks, snapshot);
        await revalidateGitProjectResources(sourceSelection); await revalidateGitProjectResources(targetSelection);
        await noMarkers(source.gitDir); await noMarkers(target.gitDir);
        await assertOriginalIndex();
        if ((await runSource(tempIndex, "write-tree")).trim() !== tree ||
            await runSource(tempIndex, "diff-files", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--") !== "" ||
            await runSource(tempIndex, "ls-files", "--others", "--exclude-standard", "-z") !== "") refuse();
        await ownedLock(lockPath, lockIdentity);
        await collisionCheck(source, hooks, oldTree, tree, tempIndex);
        await safeConfig();
        if (digest(await readFile(join(target.gitDir, "index"))) !== snapshot.target.indexDigest ||
            await runTarget("status", "--porcelain=v1", "-z", "--untracked-files=all") !== "") refuse();
        try { await lstat(join(target.gitDir, "index.lock")); refuse(); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        // The caller owns live pause/opt-out/actor checks. An intervening policy
        // write, even with equal values, also fences this exact approved candidate.
        await options.authorize("final-ref");
        await assertMainSettings(sourceSelection, agentDir, snapshot, settingsRevision);
        await checkRefs(source, target, hooks, snapshot);
        await revalidateGitProjectResources(sourceSelection); await revalidateGitProjectResources(targetSelection);
        await noMarkers(source.gitDir); await noMarkers(target.gitDir);
        await ownedLock(lockPath, lockIdentity);
        await assertOriginalIndex();
        admission.assertOwned();
        phase = "ref-transaction";
        await updateRefs(source, hooks, snapshot, candidate.newSourceOid);
        phase = "install-index";
        await options.afterRef?.();
        await lock.writeFile(await readFile(tempIndex)); await lock.sync(); await lock.close(); lock = undefined;
        await assertOriginalIndex();
        await ownedLock(lockPath, lockIdentity);
        // There is no atomic inode-CAS for rename(2): an external writer can
        // replace the lock between this check and rename. Verify its installed
        // inode immediately afterwards and quarantine on any discrepancy.
        await rename(lockPath, index); installed = true;
        phase = "verify-installed-index";
        await ownedLock(index, lockIdentity);
        phase = "sync-installed-index";
        await syncPinnedDir(source.gitDir);
        await options.afterIndexInstall?.();
        phase = "verify-repository";
        // No success based on Git exit status alone: compare actual refs, tree, index,
        // checkout status, marker state and completed children before recording outcome.
        await revalidateGitProjectResources(sourceSelection); await revalidateGitProjectResources(targetSelection);
        await noMarkers(source.gitDir); await noMarkers(target.gitDir);
        await collisionCheck(source, hooks, oldTree, tree);
        for (const repo of [source, target]) {
          try { await lstat(join(repo.gitDir, "index.lock")); refuse(); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
        const actual = (await runSource(undefined, "show-ref", "--verify", "--hash", snapshot.source.ref)).trim();
        if (actual !== candidate.newSourceOid || (await runSource(undefined, "symbolic-ref", "--quiet", "HEAD")).trim() !== snapshot.source.ref ||
            (await runSource(undefined, "rev-parse", "HEAD^{commit}")).trim() !== actual ||
            (await runTarget("show-ref", "--verify", "--hash", snapshot.target.ref)).trim() !== snapshot.target.oid ||
            (await runSource(undefined, "show-ref", "--verify", "--hash", snapshot.designatedMain.ref)).trim() !== snapshot.designatedMain.oid ||
            (await runSource(undefined, "write-tree")).trim() !== tree ||
            digest(await readFile(join(target.gitDir, "index"))) !== snapshot.target.indexDigest ||
            (await runTarget("symbolic-ref", "--quiet", "HEAD")).trim() !== snapshot.target.ref ||
            await runTarget("status", "--porcelain=v1", "-z", "--untracked-files=all") !== "" ||
            (await runTarget("ls-files", "-v", "-z")).split("\0").some((row) => row && !row.startsWith("H ")) ||
            await runSource(undefined, "status", "--porcelain=v1", "-z", "--untracked-files=all") !== "" ||
            await runSource(undefined, "ls-files", "-u", "-z") !== "" ||
            (await runSource(undefined, "ls-files", "-v", "-z")).split("\0").some((row) => row && !row.startsWith("H "))) refuse();
        // This is measured state, not a completed claim: durable admission must
        // still resolve. A failure resolving it leaves this record quarantined.
        await ownedLock(index, lockIdentity);
        phase = "record-outcome";
        await immutable(`${recoveryPath}.outcome`, { version: 1, status: "verified-pending-admission", beforeOid: snapshot.source.oid,
          afterOid: actual, targetOid: snapshot.target.oid, resultTreeOid: tree });
        phase = "resolve-admission";
        admission.resolve({ version: 1, outcome: "completed", beforeOid: snapshot.source.oid, afterOid: actual, resultTreeOid: tree });
        return { status: "prepared", oldSourceOid: snapshot.source.oid, newSourceOid: actual,
          targetOid: snapshot.target.oid, treeOid: tree, recoveryPath };
      } catch {
        if (started) {
          let lockRetained = false;
          if (installed) {
            // rename consumed our original index.lock. Best-effort exclusive
            // replacement blocks ordinary Git writers while admission remains
            // unresolved. This is NOT atomic with rename and cannot fence an
            // external writer that entered the gap or removes the new lock.
            let replacement: Awaited<ReturnType<typeof open>> | undefined;
            try {
              replacement = await open(lockPath, "wx", 0o600);
              const info = await replacement.stat();
              await replacement.sync();
              await replacement.close(); replacement = undefined;
              await syncPinnedDir(source.gitDir);
              await ownedLock(lockPath, { dev: info.dev, ino: info.ino });
              lockRetained = true;
            } catch { /* Never overwrite or remove somebody else's lock. */ }
            finally { await replacement?.close().catch(() => {}); }
          } else if (lockIdentity) {
            try { await ownedLock(lockPath, lockIdentity); lockRetained = true; }
            catch { /* An absent or replaced lock is not protection. */ }
          }
          const observed = await runSource(undefined, "show-ref", "--verify", "--hash", snapshot.source.ref).then((s) => s.trim(), () => "");
          const observedSourceOid = OID.test(observed) ? observed : null;
          try {
            await immutable(`${recoveryPath}.partial`, { version: 1, status: "partial-state", phase,
              oldSourceOid: snapshot.source.oid, observedSourceOid, targetOid: snapshot.target.oid,
              indexInstalled: installed, indexLock: lockRetained ? "owned-retained" : "unconfirmed" });
          } catch {
            // The original prepared evidence and unresolved intent still exist.
            // Never claim an outcome if additional durable evidence failed.
            throw new Error(`Preparation ${id} requires manual recovery; partial record unavailable; do not retry`);
          }
          if (!lockRetained) throw new Error(`Preparation ${id} requires manual recovery; index lock not retained; do not retry`);
          return { status: "partial-state", oldSourceOid: snapshot.source.oid,
            observedSourceOid, targetOid: snapshot.target.oid, recoveryPath };
        }
        throw new Error(`Preparation intent ${id} requires manual recovery; do not retry`);
      } finally {
        await lock?.close().catch(() => {});
        // Once read-tree starts retain our owned index lock on partial failure:
        // Git writers must not mistake a dirty worktree + old index for a clean
        // checkout. No stash/reset/repair or automatic admission release.
        if (!started && !installed && lockIdentity) {
          const current = await lstat(lockPath).catch(() => null);
          if (current?.dev === lockIdentity.dev && current.ino === lockIdentity.ino) {
            await unlink(lockPath).catch(() => {});
          }
        }
      }
    });
  } finally { release(); }
}
