// Internal read-only evidence. Not a candidate-tree verifier or operation authority.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { constants, type BigIntStats } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gitExecEnv } from "./git-exec";
import type { GitProjectResources } from "./git-project-resources";

export const GIT_WORKING_WORKSPACE_LIMITS = Object.freeze({
  paths: 20_000, directories: 1024, pathBytes: 4096, depth: 64,
  inventoryEntries: 40_000, inventoryNameBytes: 8 * 1024 * 1024,
  gitStdoutBytes: 4 * 1024 * 1024, gitInputBytes: 4 * 1024 * 1024, gitCommands: 2048,
  fileBytes: 16 * 1024 * 1024, symlinkBytes: 4096, totalBytes: 128 * 1024 * 1024,
  indexBytes: 16 * 1024 * 1024, ignoreFileBytes: 256 * 1024,
  ignoreTotalBytes: 4 * 1024 * 1024, readBytes: 192 * 1024 * 1024, captureMs: 60_000,
});
type Limits = { -readonly [K in keyof typeof GIT_WORKING_WORKSPACE_LIMITS]: number };
export class GitWorkingWorkspaceSnapshotError extends Error {
  constructor(readonly code: "unsupported" | "bounded" | "changed" | "unavailable") {
    super(`Working-workspace content capture ${code}; no candidate tree was verified.`);
  }
}
function refuse(code: GitWorkingWorkspaceSnapshotError["code"]): never { throw new GitWorkingWorkspaceSnapshotError(code); }
export interface GitWorkingWorkspaceContentManifest {
  readonly version: 2;
  readonly digest: string;
  /** Actual index bytes, independently bound AND included in digest. */
  readonly indexDigest: string;
  readonly summary: Readonly<{
    coverage: "tracked-index-head-union-and-nonignored-physical-workspace";
    ignoredCachesCovered: false; externalInputsCovered: false;
    /** Covered relative paths, including directories, but not checkout '.' itself. */
    paths: number; tracked: number; untracked: number;
    regularFiles: number; symlinks: number; absent: number; directories: number;
    totalBytes: number; indexBytes: number;
    /** Enumerated direct names include pruned ignored/admin entries; directories include checkout root, not pruned subtrees. */
    inventoryEntries: number; inventoryDirectories: number; inventoryNameBytes: number;
    /** Ignore/config inputs; readBytes counts ALL own content reads and rereads, not Git-child disk reads. */
    ignoreFiles: number; ignoreBytes: number; readBytes: number;
  }>;
}
const identity = (s: BigIntStats) => `${s.dev}:${s.ino}:${s.birthtimeNs}`;
const stamp = (s: BigIntStats) => `${identity(s)}:${s.mode}:${s.nlink}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
const directoryIdentity = (s: BigIntStats) => `${identity(s)}:${s.mode}`;
const directoryStamp = (s: BigIntStats) => `${directoryIdentity(s)}:${s.mtimeNs}:${s.ctimeNs}`;
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const inside = (root: string, file: string) => file === root || file.startsWith(`${root}/`);
function absent(file: string): BigIntStats | undefined {
  try { return fs.lstatSync(file, { bigint: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
interface Pinned { fd: number; named: string; before: BigIntStats; proc: string; watchChanges: boolean }
interface Entry { head?: string; index?: string }

/**
 * Synchronous actual-byte recapture for a caller's final release/CAS fence; no
 * cached manifest or async fallback. Accept only an authorized, physical,
 * server-owned selection. Outer checks own refs/config policy, unsafe-index,
 * active operation markers and authority. Dirty source is supported, not v2
 * clean proof or an isolated commit tree. Callers store only digest + summary
 * in their v3 snapshot: evidenceScope:'working-workspace',
 * candidateTreeVerified:false, repositoryChecksWaived:false.
 *
 * Physical inventory (including empty directories and Git-invisible specials)
 * is bounded and FD-pinned. Ignored subtrees are classified then pruned without
 * reading contents. Tracked index/HEAD union paths remain covered even under
 * ignored directories. Administrative roots are excluded by path AND identity;
 * all regular hardlinks are conservatively unsupported, including ordinary
 * hardlinks. Symlinks bind readlink bytes only, never target bytes.
 *
 * Budgets bound OUR directory entries/name bytes, pinned directories, paths,
 * file/ignore/config/index reads (including rereads), input/output and command
 * count. captureMs is a cooperative elapsed budget between operations, not a
 * hard interrupt of a blocking filesystem syscall. Known config/ignore inputs
 * are prechecked before their affected classification;
 * includes and arbitrary external core.excludesFile paths are unsupported.
 * Known default global ignore and info/exclude files use the bounded reader.
 * This is NOT a proof of Git child filesystem syscall volume: object/config
 * reads can exceed stdout size. Commands have timeout/output limits, not a
 * claimed disk-read-volume bound. Nor is this universally race-free/atomic:
 * original FDs and observed before/after stamps cap, not eliminate, external
 * writer races. Ignored cache contents and other external inputs aren't hashed.
 */
export function captureGitWorkingWorkspaceContentManifest(
  selection: Readonly<GitProjectResources>, reducedLimits: Partial<Limits> = {},
): GitWorkingWorkspaceContentManifest {
  if (process.platform !== "linux") refuse("unsupported");
  const limits: Limits = { ...GIT_WORKING_WORKSPACE_LIMITS };
  for (const key of Object.keys(reducedLimits) as (keyof Limits)[]) {
    const value = reducedLimits[key];
    if (!Object.hasOwn(limits, key) || value === undefined || !Number.isSafeInteger(value) || value < 1 || value > limits[key]) refuse("bounded");
    limits[key] = value;
  }
  const started = performance.now();
  const tick = () => { if (performance.now() - started > limits.captureMs) refuse("bounded"); };
  const pins = new Map<string, Pinned>();
  const retained: number[] = [];
  const observed: { named: string; before?: BigIntStats }[] = [];
  const inputs = new Map<string, { digest: string; bytes: number; fd?: number }>();
  let readBytes = 0, ignoreBytes = 0, commands = 0, inventoryEntries = 0, inventoryNameBytes = 0, inventoryDirectories = 0;
  const checkPins = () => {
    for (const p of pins.values()) {
      const named = absent(p.named), fdState = fs.fstatSync(p.fd, { bigint: true });
      // Only inventoried checkout directories bind their contents' timestamps.
      // Ancestors and administration-only roots bind original names, instances
      // and modes, not unrelated sibling entries or another checkout's locks.
      const fingerprint = p.watchChanges ? directoryStamp : directoryIdentity;
      if (!named || !named.isDirectory() || fingerprint(named) !== fingerprint(p.before) ||
        fingerprint(fdState) !== fingerprint(p.before)) refuse("changed");
    }
  };
  const pinChild = (key: string, named: string, watchChanges = false): Pinned => {
    tick();
    const cached = pins.get(key);
    if (cached) { cached.watchChanges ||= watchChanges; return cached; }
    if (pins.size >= limits.directories) refuse("bounded");
    const before = fs.lstatSync(named, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || (before.mode & BigInt(0o444)) === BigInt(0) ||
      (before.mode & BigInt(0o111)) === BigInt(0)) refuse("unsupported");
    const fd = fs.openSync(named, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const p = { fd, named, before, proc: `/proc/${process.pid}/fd/${fd}`, watchChanges };
    pins.set(key, p);
    const opened = fs.fstatSync(fd, { bigint: true });
    // Every handoff retains the original directory instance and mode. Only
    // inventoried directories watch timestamps; later promotion still compares
    // against this original `before` stamp, never a recaptured baseline.
    if (identity(opened) !== identity(before) || opened.mode !== before.mode ||
      watchChanges && directoryStamp(opened) !== directoryStamp(before)) refuse("changed");
    return p;
  };
  const pinAbsolute = (absolute: string, expected: { device: string; inode: string; birthtime: string }, watchChanges = false) => {
    if (!path.isAbsolute(absolute) || path.resolve(absolute) !== absolute || absolute.includes("\0")) refuse("unsupported");
    let key = "/", parent = pinChild(key, key);
    for (const part of absolute.split("/").filter(Boolean)) {
      key = path.join(key, part); parent = pinChild(key, `${parent.proc}/${part}`);
    }
    parent.watchChanges ||= watchChanges;
    if (identity(parent.before) !== `${expected.device}:${expected.inode}:${expected.birthtime}`) refuse("changed");
    return parent;
  };
  const limitsCheck = (size: bigint, max: number) => { if (size < BigInt(0) || size > BigInt(max)) refuse("bounded"); };
  const readRegular = (named: string, before: BigIntStats, max: number, retainedFd?: number, collect = false) => {
    tick();
    if (!before.isFile() || before.nlink !== BigInt(1) || (before.mode & BigInt(0o444)) === BigInt(0)) refuse("unsupported");
    // Reserve one byte for the EOF probe: don't silently trust st_size on
    // unusual regular resources, including a zero-size readable pseudo-file.
    limitsCheck(before.size, Math.min(max, limits.readBytes - readBytes - 1));
    const fd = retainedFd ?? fs.openSync(named, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if (stamp(fs.fstatSync(fd, { bigint: true })) !== stamp(before)) refuse("changed");
      const hash = createHash("sha256"), chunk = Buffer.alloc(64 * 1024), chunks: Buffer[] = [];
      let bytes = 0;
      const expectedBytes = Number(before.size);
      while (bytes < expectedBytes) {
        tick();
        const count = fs.readSync(fd, chunk, 0, Math.min(chunk.length, expectedBytes - bytes), bytes);
        if (count === 0) refuse("changed");
        bytes += count; readBytes += count;
        hash.update(chunk.subarray(0, count));
        if (collect) chunks.push(Buffer.from(chunk.subarray(0, count))); // bounded config parsing only
      }
      const extra = fs.readSync(fd, chunk, 0, 1, bytes);
      readBytes += extra;
      if (extra !== 0) refuse("changed");
      const namedAfter = absent(named);
      if (!namedAfter || BigInt(bytes) !== before.size || stamp(fs.fstatSync(fd, { bigint: true })) !== stamp(before) ||
        stamp(namedAfter) !== stamp(before)) refuse("changed");
      return { digest: hash.digest("hex"), bytes, config: collect ? Buffer.concat(chunks, bytes) : undefined };
    } finally { if (retainedFd === undefined) fs.closeSync(fd); }
  };
  const decode = (bytes: Buffer) => {
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { return refuse("unsupported"); }
  };
  const records = (bytes: Buffer, visit: (row: Buffer) => void) => {
    if (bytes.length > limits.gitStdoutBytes) refuse("bounded");
    let start = 0;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0) {
      if (i === start) refuse("unsupported");
      visit(bytes.subarray(start, i)); start = i + 1;
    }
    if (start !== bytes.length) refuse("unsupported");
  };
  // Config parsing deliberately runs outside any repository with all automatic
  // config discovery disabled. Only bounded bytes already read enter stdin.
  const isolatedEnv = { ...gitExecEnv(), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1", GIT_NO_LAZY_FETCH: "1",
    GIT_ALLOW_PROTOCOL: "", GIT_OPTIONAL_LOCKS: "0" };
  const run = (args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: Buffer, allowOne = false) => {
    tick();
    if (++commands > limits.gitCommands || input && input.length > limits.gitInputBytes) refuse("bounded");
    const options = { cwd, env, input, timeout: Math.max(1, Math.min(15_000, limits.captureMs - Math.floor(performance.now() - started))),
      maxBuffer: limits.gitStdoutBytes, stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"] };
    try { return execFileSync("git", args, options); }
    catch (error) {
      const result = error as { status?: number; stdout?: Buffer; code?: string };
      if (allowOne && result.status === 1 && result.stdout?.length === 0) return Buffer.alloc(0);
      throw error;
    }
  };
  try {
    const checkout = pinAbsolute(selection.cwd, selection.identities.checkout, true);
    const gitDir = pinAbsolute(selection.gitDir, selection.identities.git);
    const common = pinAbsolute(selection.commonDir, selection.identities.common);
    const adminRoots = [selection.gitDir, selection.commonDir];
    const adminIdentities = new Set([identity(gitDir.before), identity(common.before)]);
    if (adminIdentities.has(identity(checkout.before))) refuse("unsupported");
    const administrative = (name: string, info?: BigIntStats) =>
      adminRoots.some((root) => inside(root, path.join(selection.cwd, name))) || !!info && adminIdentities.has(identity(info));
    const entries = new Map<string, Entry>();
    const validate = (nameBytes: Buffer) => {
      if (nameBytes.length === 0 || nameBytes.length > limits.pathBytes) refuse("bounded");
      const name = decode(nameBytes), parts = name.split("/");
      if (parts.length > limits.depth) refuse("bounded");
      if (parts.some((part) => !part || part === "." || part === ".." || part === ".git") || administrative(name)) refuse("unsupported");
      return name;
    };
    const add = (name: string) => {
      let entry = entries.get(name);
      if (!entry) {
        if (entries.size >= limits.paths) refuse("bounded");
        entry = {}; entries.set(name, entry);
      }
      return entry;
    };
    const indexNamed = `${gitDir.proc}/index`, indexBefore = absent(indexNamed);
    if (!indexBefore || !indexBefore.isFile() || indexBefore.nlink !== BigInt(1)) refuse("unsupported");
    limitsCheck(indexBefore.size, limits.indexBytes);
    const indexFd = fs.openSync(indexNamed, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    retained.push(indexFd);
    const index = readRegular(indexNamed, indexBefore, limits.indexBytes, indexFd);

    // No symlink parents or arbitrary external files for ignore/config input.
    // Missing known inputs are observed too. All content opens use O_NOFOLLOW.
    const optionalAbsolute = (file: string): string | undefined => {
      if (!path.isAbsolute(file) || path.resolve(file) !== file || file.includes("\0")) refuse("unsupported");
      let parent = pinChild("/", "/"), key = "/";
      const parts = file.split("/").filter(Boolean);
      for (const part of parts.slice(0, -1)) {
        const named = `${parent.proc}/${part}`, info = absent(named);
        if (!info) { observed.push({ named }); return; }
        key = path.join(key, part); parent = pinChild(key, named);
      }
      return `${parent.proc}/${parts.at(-1)}`;
    };
    const precheck = (key: string, named: string | undefined, config = false) => {
      const cached = inputs.get(key);
      if (cached) return { ...cached, config: undefined };
      const before = named === undefined ? undefined : absent(named);
      if (named !== undefined) observed.push({ named, before });
      if (!before) { const missing = { digest: "absent", bytes: 0 }; inputs.set(key, missing); return { ...missing, config: undefined }; }
      limitsCheck(before.size, Math.min(limits.ignoreFileBytes, limits.ignoreTotalBytes - ignoreBytes));
      if (!before.isFile() || before.nlink !== BigInt(1) || (before.mode & BigInt(0o444)) === BigInt(0)) refuse("unsupported");
      const fd = fs.openSync(named!, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      retained.push(fd);
      const read = readRegular(named!, before, limits.ignoreFileBytes, fd, config);
      ignoreBytes += read.bytes;
      inputs.set(key, { digest: read.digest, bytes: read.bytes, fd });
      return { ...read, fd };
    };
    const home = process.env.HOME || os.homedir();
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    if (!path.isAbsolute(home) || !path.isAbsolute(xdg) || home !== path.resolve(home) || xdg !== path.resolve(xdg)) refuse("unsupported");
    const defaultIgnore = path.join(xdg, "git", "ignore");
    const configFiles = [...new Set(["/etc/gitconfig", path.join(xdg, "git", "config"), path.join(home, ".gitconfig"),
      path.join(selection.commonDir, "config")])];
    let excludes: string | undefined, ignoreCase: string | undefined, worktreeConfig = false;
    for (let i = 0; i < configFiles.length; i++) {
      const file = configFiles[i];
      const read = precheck(`config:${file}`, optionalAbsolute(file), true);
      if (!read.config) continue;
      const parsed = run(["config", "--file", "-", "--no-includes", "--null", "--list"], "/", isolatedEnv, read.config);
      records(parsed, (row) => {
        const text = decode(row), newline = text.indexOf("\n");
        const key = (newline < 0 ? text : text.slice(0, newline)).toLowerCase();
        const value = newline < 0 ? "" : text.slice(newline + 1);
        if (key.startsWith("include.") || key.startsWith("includeif.")) refuse("unsupported");
        if (key === "core.excludesfile") excludes = value;
        if (key === "core.ignorecase") ignoreCase = newline < 0 ? "true" : value;
        if (key === "extensions.worktreeconfig") {
          // Git also accepts nonzero numeric encodings (e.g. 2). Never turn
          // an unknown encoding into false: that would skip config.worktree
          // prechecking while Git can load its external includes. Bare keys
          // are true; explicit empty/other encodings are unsupported here.
          if (newline < 0 || /^(?:true|yes|on|1)$/i.test(value)) worktreeConfig = true;
          else if (/^(?:false|no|off|0)$/i.test(value)) worktreeConfig = false;
          else refuse("unsupported");
        }
      });
      if (file === path.join(selection.commonDir, "config") && worktreeConfig &&
        !configFiles.includes(path.join(selection.gitDir, "config.worktree"))) configFiles.push(path.join(selection.gitDir, "config.worktree"));
    }
    let excludeFile = defaultIgnore;
    if (excludes !== undefined) {
      if (excludes.startsWith("~") && !excludes.startsWith("~/") || excludes.includes("%(prefix)")) refuse("unsupported");
      excludeFile = excludes.startsWith("~/") ? path.join(home, excludes.slice(2)) : path.resolve(selection.cwd, excludes);
      if (excludeFile !== defaultIgnore && excludeFile !== "/dev/null" && !inside(selection.cwd, excludeFile)) refuse("unsupported");
      if (adminRoots.some((root) => inside(root, excludeFile)) || path.relative(selection.cwd, excludeFile).split("/").includes(".git")) refuse("unsupported");
    }
    const excludeInput = excludeFile === "/dev/null" ? undefined : precheck(`exclude:${excludeFile}`, optionalAbsolute(excludeFile));
    precheck("info/exclude", optionalAbsolute(path.join(selection.commonDir, "info", "exclude")));
    const git = (args: string[], input?: Buffer, allowOne = false) => run(["--no-optional-locks", `--git-dir=${gitDir.proc}`,
      `--work-tree=${checkout.proc}`, "-c", "core.fsmonitor=false", "-c", `core.excludesFile=${excludeInput?.fd === undefined ? "/dev/null" : `/proc/${process.pid}/fd/${excludeInput.fd}`}`,
      ...(ignoreCase === undefined ? [] : ["-c", `core.ignoreCase=${ignoreCase}`]), ...args], checkout.proc,
    { ...isolatedEnv, GIT_COMMON_DIR: common.proc, GIT_INDEX_FILE: `/proc/${process.pid}/fd/${indexFd}` }, input, allowOne);
    // Only tracked enumeration; physical scan below replaces ls-files --others.
    const enumerate = () => [git(["ls-files", "--stage", "-z"]), git(["ls-tree", "-r", "-z", "--full-tree", "HEAD"])];
    precheck("ignore:", `${checkout.proc}/.gitignore`);
    const listings = enumerate();
    for (const [i, kind] of (["index", "head"] as const).entries()) {
      records(listings[i], (row) => {
        const tab = row.indexOf(9);
        if (tab < 0) refuse("unsupported");
        const metadata = row.subarray(0, tab).toString("ascii");
        const pattern = kind === "index" ? /^(100644|100755|120000) (?:[a-f0-9]{40}|[a-f0-9]{64}) 0$/ : /^(100644|100755|120000) blob (?:[a-f0-9]{40}|[a-f0-9]{64})$/;
        if (!pattern.test(metadata)) refuse("unsupported");
        const entry = add(validate(row.subarray(tab + 1)));
        if (entry[kind]) refuse("unsupported");
        entry[kind] = metadata;
      });
    }
    const scan = (directory: Pinned, relative: string) => {
      tick(); inventoryDirectories++;
      if (relative && absent(`${directory.proc}/.git`)) refuse("unsupported");
      // Must happen BEFORE Git can load this directory's ignore file while
      // classifying its children, even if .gitignore itself would be ignored.
      precheck(`ignore:${relative}`, `${directory.proc}/.gitignore`);
      const children: { name: string; named: string; before: BigIntStats }[] = [];
      let inputBytes = 0;
      // Node supports raw directory-name buffers at runtime; its opendir
      // options typing currently omits the special "buffer" encoding.
      const dir = fs.opendirSync(directory.proc, { encoding: "buffer" as BufferEncoding, bufferSize: 16 });
      try {
        for (;;) {
          tick();
          const item = dir.readSync();
          if (!item) break;
          const bytes = Buffer.isBuffer(item.name) ? item.name : Buffer.from(item.name);
          if (++inventoryEntries > limits.inventoryEntries || (inventoryNameBytes += bytes.length) > limits.inventoryNameBytes) refuse("bounded");
          const component = decode(bytes);
          const name = relative ? `${relative}/${component}` : component;
          const named = `${directory.proc}/${component}`, before = fs.lstatSync(named, { bigint: true });
          // Exclude actual administrative paths/identities BEFORE reading any
          // config, objects, ignore files or ordinary content in that subtree.
          if (administrative(name, before) || !relative && component === ".git") continue;
          validate(Buffer.from(name));
          inputBytes += Buffer.byteLength(name) + 1;
          if (inputBytes > limits.gitInputBytes) refuse("bounded");
          children.push({ name, named, before });
          if (children.length > limits.paths) refuse("bounded");
        }
      } finally { dir.closeSync(); }
      if (!children.length) return;
      const input = Buffer.from(children.map(({ name }) => `${name}\0`).join(""));
      const ignored = new Set<string>();
      records(git(["check-ignore", "--no-index", "-z", "--stdin"], input, true), (row) => { ignored.add(decode(row)); });
      for (const child of children) {
        tick();
        // Even if a tracked HEAD path is now an ignored directory, do not
        // inventory its ignored descendants. The union loop below still
        // captures every tracked leaf/type through its original parent FDs.
        if (ignored.has(child.name)) continue;
        add(child.name);
        observed.push({ named: child.named, before: child.before });
        if (child.before.isDirectory()) {
          scan(pinChild(path.join(selection.cwd, child.name), child.named, true), child.name);
        } else if (!child.before.isFile() && !child.before.isSymbolicLink() || child.before.isFile() &&
          (child.before.nlink !== BigInt(1) || (child.before.mode & BigInt(0o444)) === BigInt(0))) refuse("unsupported");
      }
    };
    scan(checkout, "");
    const summary = { coverage: "tracked-index-head-union-and-nonignored-physical-workspace" as const,
      ignoredCachesCovered: false as const, externalInputsCovered: false as const,
      paths: entries.size, tracked: 0, untracked: 0, regularFiles: 0, symlinks: 0, absent: 0,
      directories: 0, totalBytes: 0, indexBytes: index.bytes,
      inventoryEntries, inventoryDirectories, inventoryNameBytes, ignoreFiles: 0, ignoreBytes: 0, readBytes: 0 };
    const aggregate = createHash("sha256");
    aggregate.update(JSON.stringify(["git-working-workspace-content-v2", index.digest, index.bytes, (checkout.before.mode & BigInt(0o7777)).toString(8)]) + "\n");
    const names = [...entries.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of names) {
      tick();
      const entry = entries.get(name)!;
      if (entry.index || entry.head) summary.tracked++; else summary.untracked++;
      const parts = name.split("/");
      let parent = checkout, missing = false, key = selection.cwd;
      for (const part of parts.slice(0, -1)) {
        key = path.join(key, part);
        const named = `${parent.proc}/${part}`, s = absent(named);
        if (!s) { observed.push({ named }); missing = true; break; }
        if (!s.isDirectory() || s.isSymbolicLink() || administrative(path.relative(selection.cwd, key), s)) refuse("unsupported");
        parent = pinChild(key, named, true);
        if (absent(`${parent.proc}/.git`)) refuse("unsupported");
      }
      const named = `${parent.proc}/${parts.at(-1)}`, before = missing ? undefined : absent(named);
      let type: string, digest: string | null = null, bytes = 0, mode: string | null = null;
      if (!before) {
        if (!entry.index && !entry.head) refuse("changed");
        type = "absent"; summary.absent++;
      } else {
        if (administrative(name, before)) refuse("unsupported");
        mode = (before.mode & BigInt(0o7777)).toString(8);
        if (before.isFile()) {
          type = "regular"; summary.regularFiles++;
          const read = readRegular(named, before, Math.min(limits.fileBytes, limits.totalBytes - summary.totalBytes));
          digest = read.digest; bytes = read.bytes;
        } else if (before.isSymbolicLink()) {
          type = "symlink"; summary.symlinks++;
          // Ordinary Linux symlink targets are PATH_MAX-bounded. Reject
          // zero-size/dynamic pseudo-links; reserve a full PATH_MAX read so
          // replacement with a longer target cannot overspend our read budget.
          if (before.size === BigInt(0)) refuse("unsupported");
          limitsCheck(before.size, Math.min(limits.fileBytes, limits.symlinkBytes, limits.totalBytes - summary.totalBytes));
          if (limits.readBytes - readBytes < GIT_WORKING_WORKSPACE_LIMITS.symlinkBytes) refuse("bounded");
          const target = fs.readlinkSync(named, { encoding: "buffer" });
          readBytes += target.length;
          if (BigInt(target.length) !== before.size || stamp(fs.lstatSync(named, { bigint: true })) !== stamp(before)) refuse("changed");
          bytes = target.length; digest = sha(target);
        } else if (before.isDirectory()) {
          type = "directory"; summary.directories++;
          const directory = pinChild(path.join(selection.cwd, name), named, true);
          if (absent(`${directory.proc}/.git`)) refuse("unsupported");
        } else refuse("unsupported");
      }
      if (!missing) observed.push({ named, before });
      summary.totalBytes += bytes;
      if (summary.totalBytes > limits.totalBytes || readBytes > limits.readBytes) refuse("bounded");
      aggregate.update(JSON.stringify([name, entry.head ?? null, entry.index ?? null, type, mode, bytes, digest]) + "\n");
    }
    // Bind classification input hashes privately; no configuration values,
    // physical paths or raw rows escape in the result. Working ignore files
    // are already ordinary inputs too; duplicate reads count against budget.
    for (const [key, value] of [...inputs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      aggregate.update(JSON.stringify(["classification-input", key, value.digest, value.bytes]) + "\n");
    }
    const second = enumerate();
    if (second.some((bytes, i) => !bytes.equals(listings[i]))) refuse("changed");
    const indexAfter = absent(indexNamed);
    if (!indexAfter || stamp(indexAfter) !== stamp(indexBefore) ||
      readRegular(indexNamed, indexAfter, limits.indexBytes, indexFd).digest !== index.digest) refuse("changed");
    for (const { named, before } of observed) {
      const after = absent(named);
      if (before ? !after || stamp(after) !== stamp(before) : !!after) refuse("changed");
    }
    checkPins(); tick();
    summary.ignoreFiles = [...inputs.values()].filter((input) => input.fd !== undefined).length;
    summary.ignoreBytes = ignoreBytes; summary.readBytes = readBytes;
    return Object.freeze({ version: 2 as const, digest: aggregate.digest("hex"), indexDigest: index.digest, summary: Object.freeze(summary) });
  } catch (error) {
    if (error instanceof GitWorkingWorkspaceSnapshotError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOBUFS" || (error as NodeJS.ErrnoException).code === "ETIMEDOUT") refuse("bounded");
    return refuse("unavailable");
  } finally {
    for (const fd of retained.reverse()) fs.closeSync(fd);
    for (const p of [...pins.values()].reverse()) fs.closeSync(p.fd);
  }
}
