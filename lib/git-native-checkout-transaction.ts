// Internal foundation only: exact inputs + independent live authority, never a public approval API.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, fstatSync, lstatSync, readSync, renameSync, unlinkSync, type BigIntStats } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readdir, realpath, rm, writeFile, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { gitExecEnv } from "./git-exec";
import { verifyGitPreparationTrackedContents, type GitPreparationTrackedContents } from "./git-preparation";
import { revalidateGitProjectResources, type GitProjectResources } from "./git-project-resources";
import { prepareNativeRefTransaction, getNativeRefTransactionOutcome, getNativeRefTransactionReaped, type NativeRefTransaction } from "./git-native-ref-transaction";

const exec = promisify(execFile);
const OID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_INDEX = 8 * 1024 * 1024;
const markers = ["MERGE_HEAD", "rebase-merge", "rebase-apply", "CHERRY_PICK_HEAD", "REVERT_HEAD", "sequencer",
  "BISECT_START", "AUTO_MERGE", "MERGE_AUTOSTASH", "REBASE_HEAD", "ORIG_HEAD.lock"];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function refuse(): never { throw new Error("Native checkout refused: stale, unsupported or unsafe exact state"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export interface NativeCheckoutBound {
  resources: GitProjectResources;
  expectedOid: string;
  treeOid: string;
  indexDigest: string;
}
export interface NativeCheckoutRequest {
  source: NativeCheckoutBound;
  target: NativeCheckoutBound;
  resultOid: string;
  resultTreeOid: string;
  assertAuthoritySync(): void;
  timeoutMs?: number;
}
declare const candidateBrand: unique symbol;
export interface NativeCheckoutCandidate { readonly [candidateBrand]: true }
declare const completionBrand: unique symbol;
export interface NativeCheckoutCompletion { readonly [completionBrand]: true }
export interface NativeCheckoutOutcome {
  readonly status: "no-checkout-effect" | "partial" | "unknown" | "complete";
  readonly checkoutAttempted: boolean;
  readonly refPrepared: boolean;
  readonly refCommitSent: boolean;
  readonly refAcknowledged: boolean;
  readonly indexInstalled: boolean;
  readonly indexSynced: boolean;
  /** Ref acknowledgement + same-inode installation remain facts if directory fsync fails. */
  readonly directorySyncFailed: boolean;
  readonly childReaped: boolean;
}
type Bounds = Pick<NativeCheckoutRequest, "source" | "target" | "resultOid" | "resultTreeOid">;
export interface NativeCheckoutEvidence extends Bounds {
  readonly sourceContents: Readonly<GitPreparationTrackedContents>;
  readonly targetContents: Readonly<GitPreparationTrackedContents>;
  readonly outcome: NativeCheckoutOutcome;
}
type Saved = { bounds: Bounds; guard: () => void; timeoutMs: number };
const candidates = new WeakMap<object, Saved>();
const completions = new WeakMap<object, NativeCheckoutEvidence>();
const outcomes = new WeakMap<object, NativeCheckoutOutcome>();
export function readNativeCheckoutCompletion(value: unknown): NativeCheckoutEvidence | undefined {
  return value && typeof value === "object" ? completions.get(value) : undefined;
}
export function getNativeCheckoutOutcome(value: unknown): NativeCheckoutOutcome | undefined {
  return value && typeof value === "object" ? outcomes.get(value) : undefined;
}
function authority(callback: unknown): () => void {
  if (typeof callback !== "function" || Object.prototype.toString.call(callback) !== "[object Function]") refuse();
  return () => {
    const value: unknown = callback();
    if (value !== undefined) {
      // Consume an accidental async rejection without treating its result as authority.
      if (value && typeof (value as PromiseLike<unknown>).then === "function") void Promise.resolve(value).catch(() => {});
      refuse();
    }
  };
}
type Repo = { cwd: string; gitDir: string; commonDir: string };
async function pinned<T>(bounds: Bounds, action: (source: Repo, target: Repo) => Promise<T>, lifetimes: Promise<void>[] = []): Promise<T> {
  if (process.platform !== "linux") refuse();
  const handles: FileHandle[] = [];
  const pin = async (path: string, expected: GitProjectResources["identities"]["git"]) => {
    if (!isAbsolute(path) || path.length > 4096 || await realpath(path) !== path) refuse();
    const fd = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); handles.push(fd);
    const info = await fd.stat({ bigint: true });
    if (String(info.dev) !== expected.device || String(info.ino) !== expected.inode || String(info.birthtimeNs) !== expected.birthtime) refuse();
    return `/proc/${process.pid}/fd/${fd.fd}`;
  };
  const repo = async (r: GitProjectResources): Promise<Repo> => ({ cwd: await pin(r.cwd, r.identities.checkout),
    gitDir: await pin(r.gitDir, r.identities.git), commonDir: await pin(r.commonDir, r.identities.common) });
  try {
    const source = await repo(bounds.source.resources), target = await repo(bounds.target.resources);
    await identities(bounds);
    return await action(source, target);
  } finally {
    const close = () => Promise.allSettled(handles.map((fd) => fd.close()));
    // A bounded cleanup failure must NOT recycle /proc/<parent>/fd numbers while
    // a delayed child can still use them. These are lifetime pins, not app locks.
    if (lifetimes.length) void Promise.allSettled(lifetimes).then(close);
    else await close();
  }
}
async function identities(b: Bounds): Promise<void> {
  await revalidateGitProjectResources(b.source.resources); await revalidateGitProjectResources(b.target.resources);
}
async function absent(path: string): Promise<void> {
  try { await lstat(path); refuse(); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}
async function indexBytes(path: string, original?: FileHandle): Promise<Buffer> {
  const fd = original ?? await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await fd.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== BigInt(1) || before.size > BigInt(MAX_INDEX)) refuse();
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await fd.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const after = await lstat(path, { bigint: true });
    if (length !== Number(before.size) || before.dev !== after.dev || before.ino !== after.ino ||
        before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs || before.size !== after.size) refuse();
    return buffer.subarray(0, length);
  } finally { if (!original) await fd.close(); }
}
function sameIndex(a: BigIntStats, b: BigIntStats): boolean {
  return a.isFile() && b.isFile() && a.nlink === BigInt(1) && b.nlink === BigInt(1) &&
    a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs && a.mode === b.mode &&
    a.size === b.size && a.ctimeNs === b.ctimeNs && a.mtimeNs === b.mtimeNs;
}
/** Final bounded FD/path/content proof. No awaited I/O or caller code can intervene before rename. */
function proveIndexSync(path: string, fd: FileHandle, expected: BigIntStats, digest: string): void {
  const before = fstatSync(fd.fd, { bigint: true });
  if (!sameIndex(expected, before) || before.size > BigInt(MAX_INDEX)) refuse();
  const buffer = Buffer.alloc(Number(before.size) + 1);
  let length = 0;
  while (length < buffer.length) {
    const count = readSync(fd.fd, buffer, length, buffer.length - length, length);
    if (!count) break;
    length += count;
  }
  if (length !== Number(before.size) || hash(buffer.subarray(0, length)) !== digest ||
      !sameIndex(before, fstatSync(fd.fd, { bigint: true })) || !sameIndex(before, lstatSync(path, { bigint: true }))) refuse();
}
type Run = (repo: Repo, index: string | undefined, args: string[], guard?: () => void) => Promise<string>;
function runner(hooks: string, signal?: AbortSignal, remaining = () => 15_000,
  processes = { reaped: true, lifetimes: [] as Promise<void>[] }): Run {
  return async (repo, index, args, guard) => {
    const argv = ["--no-optional-locks", "-C", repo.cwd, `--git-dir=${repo.gitDir}`, `--work-tree=${repo.cwd}`,
      "-c", "core.fsmonitor=false", "-c", `core.hooksPath=${hooks}`, "-c", "commit.gpgsign=false",
      "-c", "core.attributesFile=/dev/null", ...args];
    // Checkout gets a reap margin before the prepared-ref deadline, not an extension
    // of it. Ref locks must not time out while a normally killable read-tree still runs.
    const budget = remaining(), timeout = guard ? budget - 1500 : budget;
    if (timeout <= 0) refuse();
    const options = { encoding: "utf8" as const, maxBuffer: MAX_INDEX, timeout, signal,
      env: { ...gitExecEnv(index), GIT_COMMON_DIR: repo.commonDir, GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1", GIT_ATTR_NOSYSTEM: "1", GIT_ALLOW_PROTOCOL: "", GIT_PAGER: "cat" } };
    guard?.(); // no await between the original live guard and execFile's spawn
    if (guard) { options.timeout = remaining() - 1500; if (options.timeout <= 0) refuse(); }
    const pending = exec("git", argv, options), child = pending.child;
    processes.reaped = false;
    const closed = new Promise<void>((resolve) => child.once("close", () => { processes.reaped = true; resolve(); }));
    processes.lifetimes.push(closed);
    const kill = setTimeout(() => child.kill("SIGKILL"), options.timeout + 100);
    let hard: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { hard = setTimeout(() => reject(new Error("Git child reap deadline exceeded")), options.timeout + 1100); });
    try { return (await Promise.race([pending, deadline])).stdout; }
    finally {
      clearTimeout(kill); clearTimeout(hard);
      if (!processes.reaped) {
        child.kill("SIGTERM");
        const force = setTimeout(() => child.kill("SIGKILL"), 100);
        let limit: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([closed, new Promise<void>((resolve) => { limit = setTimeout(resolve, 1100); })]);
        clearTimeout(force); clearTimeout(limit);
        if (!processes.reaped) {
          child.unref();
          for (const stream of child.stdio) (stream as { unref?(): void } | null)?.unref?.();
        }
      }
    }
  };
}
async function safe(repo: Repo, run: Run, hooks: string, ownsIndex: boolean): Promise<void> {
  // Inspect every config entry (including overridden ones), before any status/filter-capable command.
  for (const record of (await run(repo, undefined, ["config", "--list", "--null"])).split("\0")) {
    if (!record) continue;
    const n = record.indexOf("\n"); if (n < 0) refuse();
    const name = record.slice(0, n).toLowerCase(), value = record.slice(n + 1);
    if (name === "core.hookspath" && value === hooks || name === "core.fsmonitor" && value === "false" ||
        name === "commit.gpgsign" && value === "false" || name === "core.attributesfile" && value === "/dev/null" ||
        name === "core.autocrlf" && (value === "false" || value === "input")) continue;
    if (/^(filter\.|merge\.|diff\.|index\.|extensions\.|core\.(?:hookspath|fsmonitor|attributesfile|external|sparsecheckout|splitindex|worktree|ignorecase|protecthfs|protectntfs|eol|autocrlf|symlinks)|commit\.|i18n\.commitencoding)/.test(name)) refuse();
  }
  for (const marker of [...markers, ...(!ownsIndex ? ["index.lock"] : [])]) await absent(join(repo.gitDir, marker));
  for (const dir of new Set([repo.gitDir, repo.commonDir])) {
    for (const name of ["info/attributes", "info/grafts", "shallow"]) await absent(join(dir, name));
    if ((await readdir(dir)).some((name) => name.startsWith("sharedindex."))) refuse();
  }
  if ((await run(repo, undefined, ["for-each-ref", "--format=%(refname)", "refs/replace"])).trim()) refuse();
}
async function bindings(repo: Repo, bound: NativeCheckoutBound, run: Run, oid = bound.expectedOid): Promise<void> {
  const ref = `refs/heads/${bound.resources.branch}`;
  if ((await run(repo, undefined, ["symbolic-ref", "--quiet", "HEAD"])).trim() !== ref ||
      (await run(repo, undefined, ["for-each-ref", "--format=%(symref)", ref])).trim() !== "" ||
      (await run(repo, undefined, ["show-ref", "--verify", "--hash", ref])).trim() !== oid ||
      (await run(repo, undefined, ["rev-parse", "HEAD^{commit}"])).trim() !== oid) refuse();
}
async function clean(repo: Repo, run: Run, index?: string): Promise<void> {
  if ((await run(repo, index, ["ls-files", "-v", "-z"])).split("\0").some((row) => row && !row.startsWith("H ")) ||
      await run(repo, index, ["diff-files", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "--"]) !== "" ||
      await run(repo, index, ["ls-files", "--others", "--exclude-standard", "-z"]) !== "") refuse();
}
async function collision(repo: Repo, b: Bounds, run: Run, index?: string): Promise<void> {
  const changed = (await run(repo, index, ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--name-only", "-z",
    b.target.treeOid, b.resultTreeOid, "--"])).split("\0").filter(Boolean);
  const ignored = (await run(repo, index, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
  for (const path of changed) {
    if (ignored.some((p) => p === path || p.startsWith(`${path}/`) || path.startsWith(`${p}/`))) refuse();
    let parent = repo.cwd;
    for (const part of path.split("/").slice(0, -1)) {
      parent = join(parent, part);
      try { if ((await lstat(parent)).isSymbolicLink()) refuse(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
  }
}
async function objects(source: Repo, b: Bounds, run: Run): Promise<void> {
  for (const [oid, tree] of [[b.source.expectedOid, b.source.treeOid], [b.target.expectedOid, b.target.treeOid], [b.resultOid, b.resultTreeOid]]) {
    if ((await run(source, undefined, ["cat-file", "-t", oid])).trim() !== "commit" ||
        (await run(source, undefined, ["rev-parse", `${oid}^{tree}`])).trim() !== tree) refuse();
  }
  // Check result inventory before checkout: the physical verifier rejects unsupported current trees;
  // don't let a newly introduced attribute/submodule reach read-tree first.
  for (const row of (await run(source, undefined, ["ls-tree", "-r", "-z", b.resultTreeOid])).split("\0")) {
    if (!row) continue;
    const match = /^(100644|100755|120000) blob [a-f0-9]+\t(.+)$/.exec(row);
    if (!match || match[2].split("/").some((p) => p === ".gitattributes" || p.toLowerCase() === ".git")) refuse();
  }
}
async function verify(source: Repo, target: Repo, b: Bounds, run: Run, hooks: string, phase: "capture" | "locked" | "applied", temp?: string) {
  const applied = phase === "applied";
  await identities(b);
  await safe(source, run, hooks, false); await safe(target, run, hooks, phase === "locked" || phase === "applied");
  await bindings(source, b.source, run); await bindings(target, b.target, run);
  if (hash(await indexBytes(join(source.gitDir, "index"))) !== b.source.indexDigest ||
      hash(await indexBytes(join(target.gitDir, "index"))) !== b.target.indexDigest) refuse();
  const sourceContents = await verifyGitPreparationTrackedContents(source, b.source.treeOid);
  const targetContents = await verifyGitPreparationTrackedContents(target, applied ? b.resultTreeOid : b.target.treeOid,
    { indexFile: temp, previousTreeOid: applied ? b.target.treeOid : b.resultTreeOid });
  if (sourceContents.indexDigest !== b.source.indexDigest || !applied && targetContents.indexDigest !== b.target.indexDigest) refuse();
  await clean(source, run); await clean(target, run, temp); await collision(target, b, run, temp);
  return { sourceContents, targetContents };
}
/** Capture exact original bounds, not refreshed candidate discovery. No lock, app gate or history read. */
export async function captureNativeCheckoutTransaction(request: NativeCheckoutRequest): Promise<NativeCheckoutCandidate> {
  const guard = authority(request?.assertAuthoritySync);
  const bounds = freeze(structuredClone({ source: request.source, target: request.target, resultOid: request.resultOid, resultTreeOid: request.resultTreeOid }));
  const timeoutMs = request.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 || JSON.stringify(bounds).length > 32_768) refuse();
  const oids = [bounds.source.expectedOid, bounds.source.treeOid, bounds.target.expectedOid, bounds.target.treeOid, bounds.resultOid, bounds.resultTreeOid];
  if (oids.some((oid) => !OID.test(oid) || /^0+$/.test(oid) || oid.length !== oids[0].length) ||
      [bounds.source, bounds.target].some((x) => !/^[a-f0-9]{64}$/.test(x.indexDigest)) ||
      bounds.source.resources.commonDir !== bounds.target.resources.commonDir || bounds.source.resources.cwd === bounds.target.resources.cwd ||
      bounds.source.resources.branch === bounds.target.resources.branch || bounds.resultOid === bounds.target.expectedOid) refuse();
  guard();
  const processes = { reaped: true, lifetimes: [] as Promise<void>[] };
  await pinned(bounds, async (source, target) => {
    const run = runner("/dev/null", undefined, undefined, processes);
    await safe(source, run, "/dev/null", false); await safe(target, run, "/dev/null", false);
    await objects(source, bounds, run); await verify(source, target, bounds, run, "/dev/null", "capture");
  }, processes.lifetimes);
  guard();
  const handle = Object.freeze(Object.create(null)) as NativeCheckoutCandidate;
  candidates.set(handle, { bounds, guard, timeoutMs }); return handle;
}
export interface NativeCheckoutTestHooks {
  afterLocks?(): void | Promise<void>;
  afterCheckout?(): void | Promise<void>;
  afterRef?(): void | Promise<void>;
  beforeDirectorySync?(): void | Promise<void>;
  afterIndexInstall?(): void | Promise<void>;
}
/** One attempt only. No production callback payload or replacement authority guard. */
export async function applyNativeCheckoutTransaction(candidate: NativeCheckoutCandidate): Promise<NativeCheckoutCompletion> {
  return applyCandidate(candidate);
}
/** Explicit trusted node:test adapter; never wire this to a production request. */
export async function applyNativeCheckoutTransactionForTest(candidate: NativeCheckoutCandidate,
  testHooks: NativeCheckoutTestHooks): Promise<NativeCheckoutCompletion> {
  if (!process.env.NODE_TEST_CONTEXT) refuse();
  return applyCandidate(candidate, testHooks);
}
/** A failed apply never retries, rolls back, or leaves an intentional quarantine lock. */
async function applyCandidate(candidate: NativeCheckoutCandidate, testHooks?: NativeCheckoutTestHooks): Promise<NativeCheckoutCompletion> {
  const saved = candidate && candidates.get(candidate);
  if (!saved) refuse();
  candidates.delete(candidate);
  const hooksForTest = { ...testHooks };
  const { bounds: b } = saved;
  const started = performance.now(), controller = new AbortController();
  const remaining = () => { const ms = Math.ceil(saved.timeoutMs - (performance.now() - started)); if (ms <= 0) refuse(); return ms; };
  const timer = setTimeout(() => controller.abort(), saved.timeoutMs);
  let tx: NativeRefTransaction | undefined, refError: unknown;
  const processes = { reaped: true, lifetimes: [] as Promise<void>[] };
  const state = { checkoutAttempted: false, refPrepared: false, refCommitSent: false, refAcknowledged: false,
    indexInstalled: false, indexSynced: false, directorySyncFailed: false, childReaped: true };
  const measure = (): NativeCheckoutOutcome => {
    const refs = getNativeRefTransactionOutcome(tx) ?? getNativeRefTransactionOutcome(refError);
    if (refs) {
      state.refPrepared = refs.preparationAcknowledged; state.refCommitSent = refs.commitSent;
      state.refAcknowledged = refs.commitAcknowledged; state.childReaped = refs.childReaped;
    }
    state.childReaped = state.childReaped && processes.reaped;
    return Object.freeze({ ...state, status: !state.childReaped || state.refCommitSent && !state.refAcknowledged ? "unknown" :
      state.checkoutAttempted ? "partial" : "no-checkout-effect" });
  };
  const guard = () => {
    remaining(); if (controller.signal.aborted) refuse();
    saved.guard();
    remaining(); if (controller.signal.aborted) refuse(); // a synchronous guard can consume the deadline
  };
  let verified: Awaited<ReturnType<typeof verify>> | undefined;
  try {
    guard();
    await pinned(b, async (source, target) => {
      let lock: FileHandle | undefined, originalIndex: FileHandle | undefined;
      let lockInfo: { dev: number; ino: number } | undefined, temporary: string | undefined;
      const index = join(target.gitDir, "index"), lockPath = `${index}.lock`;
      const owned = (path = lockPath) => {
        const info = lstatSync(path);
        if (!lockInfo || !info.isFile() || info.nlink !== 1 || info.dev !== lockInfo.dev || info.ino !== lockInfo.ino) refuse();
      };
      try {
        guard(); lock = await open(lockPath, "wx+", 0o600); lockInfo = await lock.stat();
        temporary = await mkdtemp(join(tmpdir(), "pi-native-checkout-"));
        const hooks = join(temporary, "hooks"), temp = join(temporary, "index");
        await mkdir(hooks, { mode: 0o700 });
        const run = runner(hooks, controller.signal, remaining, processes);
        originalIndex = await open(index, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const originalInfo = fstatSync(originalIndex.fd, { bigint: true });
        const original = await indexBytes(index, originalIndex);
        proveIndexSync(index, originalIndex, originalInfo, b.target.indexDigest);
        await writeFile(temp, original, { flag: "wx", mode: 0o600 });
        await safe(source, run, hooks, false); await safe(target, run, hooks, true); await objects(source, b, run);
        try {
          tx = await prepareNativeRefTransaction({ gitDir: target.gitDir, commonDir: target.commonDir, workTree: target.cwd,
            sourceBranch: `refs/heads/${b.source.resources.branch}`, expectedSourceOid: b.source.expectedOid,
            targetBranch: `refs/heads/${b.target.resources.branch}`, expectedTargetOid: b.target.expectedOid,
            updateOid: b.resultOid, assertAuthoritySync: guard, timeoutMs: remaining(), signal: controller.signal });
        } catch (error) { refError = error; throw error; }
        await hooksForTest.afterLocks?.();
        await verify(source, target, b, run, hooks, "locked", temp);
        await run(target, temp, ["read-tree", "-u", "-m", b.target.expectedOid, b.resultOid], () => {
          owned();
          const refs = getNativeRefTransactionOutcome(tx);
          if (!refs?.preparationAcknowledged || refs.childReaped || refs.commitSent) refuse();
          guard(); state.checkoutAttempted = true;
        });
        await hooksForTest.afterCheckout?.();
        if ((await run(target, temp, ["write-tree"])).trim() !== b.resultTreeOid) refuse();
        verified = await verify(source, target, b, run, hooks, "applied", temp);
        const next = await indexBytes(temp);
        if (hash(next) !== verified.targetContents.indexDigest) refuse();
        owned(); guard();
        await lock.writeFile(next); await lock.truncate(next.length); await lock.sync(); // original real FD, never Git's replaceable temp inode
        if (hash(await indexBytes(lockPath, lock)) !== hash(next)) refuse();
        owned();
        await identities(b); await bindings(source, b.source, run); await bindings(target, b.target, run);
        proveIndexSync(index, originalIndex, originalInfo, b.target.indexDigest);
        try { await tx.commit(); } catch (error) { refError = error; throw error; }
        if (!getNativeRefTransactionOutcome(tx)?.commitAcknowledged) refuse();
        await hooksForTest.afterRef?.();
        guard(); // LAST caller callback, before BOTH final FD/content/path proofs
        proveIndexSync(index, originalIndex, originalInfo, b.target.indexDigest);
        owned();
        proveIndexSync(lockPath, lock, fstatSync(lock.fd, { bigint: true }), hash(next));
        remaining(); // synchronous deadline check only, never caller code
        // No await/callback between these proofs and rename. No rename inode-CAS
        // exists: an external syscall writer can still race this bounded sequence.
        renameSync(lockPath, index); state.indexInstalled = true; owned(index);
        // Native result is proven now. After rename another healthy invocation may
        // legitimately advance this checkout; asynchronous rereads cannot revoke our facts.
        try {
          await hooksForTest.beforeDirectorySync?.();
          const dir = await open(`${target.gitDir}/.`, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
          try { await dir.sync(); state.indexSynced = true; } finally { await dir.close(); }
        } catch { state.directorySyncFailed = true; }
        try { await hooksForTest.afterIndexInstall?.(); } catch { /* Test-only post-completion observation, not authority. */ }
      } finally {
        // abort also waits/reaps a failed/dead transaction; never delete Git-owned ref locks ourselves.
        if (tx) await tx.abort().catch(() => {});
        const reaped = getNativeRefTransactionReaped(tx) ?? getNativeRefTransactionReaped(refError);
        if (reaped) processes.lifetimes.push(reaped); // genuine notification, never inferred from diagnostic fields
        await lock?.close().catch(() => {});
        await originalIndex?.close().catch(() => {});
        if (lockInfo) {
          try { owned(); unlinkSync(lockPath); } catch { /* Missing/replaced lock is NEVER ours to remove. */ }
        }
        if (temporary) {
          const remove = () => rm(temporary!, { recursive: true, force: true }).catch(() => {});
          if (!processes.reaped) void Promise.allSettled(processes.lifetimes).then(remove);
          else await remove();
        }
      }
    }, processes.lifetimes);
    const measured = measure();
    if (!verified || !measured.refAcknowledged || !measured.childReaped || !measured.indexInstalled) refuse();
    const outcome = Object.freeze({ ...measured, status: "complete" as const });
    const completion = Object.freeze(Object.create(null)) as NativeCheckoutCompletion;
    completions.set(completion, freeze({ ...b, ...verified, outcome })); outcomes.set(completion, outcome);
    return completion;
  } catch (cause) {
    const error = new Error("Native checkout did not complete; inspect measured outcome; do not retry this candidate", { cause });
    outcomes.set(error, measure()); throw error;
  } finally { clearTimeout(timer); }
}
