import fs, { type Stats } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, parse, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { claimSshSettingsLease } from "../bin/ssh-agent-lease.js";
import { sshIdentity, type BrowserSshCredential } from "./browser-ssh-protocol";

export type SshKeyRecord = {
  id: string;
  name: string;
  credential: BrowserSshCredential;
  origin: string;
  policy: "strict" | "session";
  protection: 1 | 2 | 3 | null;
  discoverability: "resident" | "non-resident" | "unknown";
  applicationOnly: boolean;
  createdAt: string;
};
export type SshKeySnapshot = { revision: string; keys: SshKeyRecord[] };
export type SshKeyRegistryErrorCode = "INVALID" | "CORRUPT" | "UNSAFE" | "CONFLICT" | "BUSY"
  | "POLICY_MISMATCH" | "KEY_MISMATCH" | "LIMIT" | "NOT_FOUND" | "IO" | "AMBIGUOUS";

export class SshKeyRegistryError extends Error {
  constructor(
    public readonly code: SshKeyRegistryErrorCode,
    message: string,
    // Only CONFLICT carries a current public snapshot, never a proposed write.
    public readonly snapshot?: SshKeySnapshot,
  ) { super(message); this.name = "SshKeyRegistryError"; }
}

type Candidate = Omit<SshKeyRecord, "id" | "createdAt">;
type Lease = ReturnType<typeof claimSshSettingsLease>;
type Transaction = { directory: Stats; lease: Lease; renamed: boolean };
const MAX_KEYS = 32;
const MAX_BYTES = 128 * 1024;
const RECORD_FIELDS = ["id", "name", "credential", "origin", "policy", "protection", "discoverability", "applicationOnly", "createdAt"];
const CANDIDATE_FIELDS = RECORD_FIELDS.filter(field => field !== "id" && field !== "createdAt");
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;
const sameInode = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const revision = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const invalid = () => new SshKeyRegistryError("INVALID", "Invalid SSH public-key metadata");

function object(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== "string" || !fields.includes(key))) throw invalid();
  // Refuse accessors as well as unknown properties: admission must be inert data.
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(Object.getOwnPropertyDescriptor(value, key), "value")) throw invalid();
  return value as Record<string, unknown>;
}
function label(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 80 || !value.trim()
    || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) throw invalid();
  return value;
}
function candidate(value: unknown, fields = CANDIDATE_FIELDS): Candidate {
  const input = object(value, fields);
  const credential = object(input.credential, ["id", "spki"]);
  if (typeof credential.id !== "string" || typeof credential.spki !== "string"
    || typeof input.origin !== "string" || input.origin.length > 2048
    || (input.policy !== "strict" && input.policy !== "session")
    || ![null, 1, 2, 3].includes(input.protection as number | null)
    || !["resident", "non-resident", "unknown"].includes(input.discoverability as string)
    || typeof input.applicationOnly !== "boolean") throw invalid();
  let validated: BrowserSshCredential;
  try {
    // Includes exact (not normalized) Origin and canonical base64url/P-256 checks.
    const identity = sshIdentity({ id: credential.id, spki: credential.spki }, input.origin);
    if (identity.key.export({ format: "der", type: "spki" }).toString("base64url") !== credential.spki) throw invalid();
    validated = identity.credential;
  } catch { throw invalid(); }
  return {
    name: label(input.name), credential: validated, origin: input.origin, policy: input.policy,
    protection: input.protection as Candidate["protection"],
    discoverability: input.discoverability as Candidate["discoverability"], applicationOnly: input.applicationOnly,
  };
}
function record(value: unknown): SshKeyRecord {
  const metadata = candidate(value, RECORD_FIELDS);
  const input = value as Record<string, unknown>;
  if (typeof input.id !== "string" || !UUID.test(input.id) || typeof input.createdAt !== "string"
    || input.createdAt.length !== 24 || !Number.isFinite(Date.parse(input.createdAt))
    || new Date(input.createdAt).toISOString() !== input.createdAt) throw invalid();
  return { id: input.id, ...metadata, createdAt: input.createdAt };
}
function schema(value: unknown): SshKeyRecord[] {
  const input = object(value, ["version", "keys"]);
  if (input.version !== 1 || !Array.isArray(input.keys) || input.keys.length > MAX_KEYS) throw invalid();
  const keys = input.keys.map(record), ids = new Set<string>(), credentials = new Set<string>();
  for (const key of keys) {
    const identity = JSON.stringify([key.origin, key.credential.id]);
    if (ids.has(key.id) || credentials.has(identity)) throw invalid();
    ids.add(key.id); credentials.add(identity);
  }
  return keys;
}

/**
 * Synchronous, public metadata ONLY; no authentication/possession proof is done
 * here. The authenticated same-origin caller must prove possession before add,
 * default enrollment to strict, and revoke connections/grants when removing.
 *
 * `root` is the registry DIRECTORY (default getAgentDir()/ssh-keys). Disk format
 * is {version:1,keys:[...]}; revision is SHA-256 of the actual file bytes, or
 * "initial" when absent. Reads always reload; returned objects are detached.
 *
 * add returns {record,snapshot}. Same exact origin+credential ID+SPKI+policy is
 * idempotent, returning ORIGINAL metadata unchanged (even if name/reports differ).
 * An existing policy or SPKI mismatch is an error, never an update/downgrade.
 * Even idempotent mutations first require the current expectedRevision.
 *
 * Writers use the existing PID/nonce lease for one short synchronous transaction,
 * NOT a broker/runtime lease. BUSY and CONFLICT require explicit caller action;
 * there is no wait, automatic retry or mutation replay. AMBIGUOUS means rename
 * happened but acknowledgement/durability failed: reload snapshot to reconcile
 * the actual file before deciding what to do. Never treat that error as rollback.
 *
 * Existing ancestors must be UID/root-owned, non-symlink and not group/world
 * writable, except root-owned sticky ancestors such as /tmp. The filesystem root
 * is the trusted OS mount-namespace boundary: its UID can be unmapped in an
 * ordinary sandbox, but writable/symlink checks still apply. The registry root
 * must be UID-owned and private; files must be private, regular, single-link.
 * Existing unsafe permissions are refused, not repaired. Same-UID processes are
 * trusted; pathname rechecks do not sandbox a malicious same-UID filesystem actor.
 */
export class SshKeyRegistry {
  private readonly root: string;
  private readonly file: string;
  private readonly uid: number;

  constructor(options: { root?: string } = {}) {
    if (typeof process.getuid !== "function") throw new SshKeyRegistryError("UNSAFE", "SSH registry requires Unix ownership checks");
    this.uid = process.getuid();
    this.root = resolve(options.root ?? join(getAgentDir(), "ssh-keys"));
    this.file = join(this.root, "registry.json");
  }

  snapshot(): SshKeySnapshot {
    try { return this.read(this.directory(true)); }
    catch (error) { throw this.failure(error); }
  }

  get(id: string): SshKeyRecord | undefined { return this.snapshot().keys.find(key => key.id === id); }

  add(input: Candidate, expectedRevision: string): { record: SshKeyRecord; snapshot: SshKeySnapshot } {
    const proposed = candidate(input); // No policy default/implicit weakening here.
    return this.mutate(expectedRevision, (current, tx) => {
      const existing = current.keys.find(key => key.origin === proposed.origin && key.credential.id === proposed.credential.id);
      if (existing) {
        if (existing.policy !== proposed.policy) throw new SshKeyRegistryError("POLICY_MISMATCH", "SSH key policy is immutable; existing policy differs");
        if (existing.credential.spki !== proposed.credential.spki) throw new SshKeyRegistryError("KEY_MISMATCH", "SSH credential is already registered with a different public key");
        return { record: existing, snapshot: current };
      }
      if (current.keys.length >= MAX_KEYS) throw new SshKeyRegistryError("LIMIT", "SSH key registry is limited to 32 keys");
      const added: SshKeyRecord = { id: randomUUID(), ...proposed, createdAt: new Date().toISOString() };
      return { record: added, snapshot: this.save([...current.keys, added], current, tx) };
    });
  }

  rename(id: string, name: string, expectedRevision: string): SshKeySnapshot {
    const nextName = label(name);
    return this.mutate(expectedRevision, (current, tx) => {
      const existing = current.keys.find(key => key.id === id);
      if (!existing) throw new SshKeyRegistryError("NOT_FOUND", "SSH key is not registered");
      if (existing.name === nextName) return current;
      return this.save(current.keys.map(key => key.id === id ? { ...key, name: nextName } : key), current, tx);
    });
  }

  remove(id: string, expectedRevision: string): SshKeySnapshot {
    return this.mutate(expectedRevision, (current, tx) => {
      if (!current.keys.some(key => key.id === id)) throw new SshKeyRegistryError("NOT_FOUND", "SSH key is not registered");
      return this.save(current.keys.filter(key => key.id !== id), current, tx);
    });
  }

  private failure(error: unknown): SshKeyRegistryError {
    if (error instanceof SshKeyRegistryError) return error;
    if (codeOf(error) === "ELOCKED") return new SshKeyRegistryError("BUSY", "SSH key registry is busy; reload and retry explicitly");
    return new SshKeyRegistryError("IO", "SSH key registry filesystem operation failed");
  }

  private mutate<T>(expected: string, operation: (current: SshKeySnapshot, tx: Transaction) => T): T {
    if (typeof expected !== "string" || expected.length > 128) throw invalid();
    let tx: Transaction | undefined, failure: SshKeyRegistryError | undefined, result: T | undefined;
    try {
      const directory = this.directory(true);
      const lease = claimSshSettingsLease(this.file);
      tx = { directory, lease, renamed: false };
      this.assertDirectory(directory); lease.assertOwned();
      // Critically, no read or revision comparison before acquiring the lease.
      const current = this.read(directory);
      if (current.revision !== expected) throw new SshKeyRegistryError("CONFLICT", "SSH key registry changed; reload before editing", current);
      result = operation(current, tx);
    } catch (error) { failure = tx?.renamed ? this.ambiguous() : this.failure(error); }
    finally {
      if (tx) {
        try { tx.lease.release(); }
        catch (error) { if (!failure) failure = tx.renamed ? this.ambiguous() : this.failure(error); }
      }
    }
    if (failure) throw failure;
    return result as T;
  }

  private ambiguous(): SshKeyRegistryError {
    return new SshKeyRegistryError("AMBIGUOUS", "SSH key registry was renamed but acknowledgement failed; reload status to reconcile, do not replay automatically");
  }

  private safeDirectory(stat: Stats, isRoot: boolean, filesystemRoot = false): void {
    const stickyRootAncestor = !isRoot && stat.uid === 0 && Boolean(stat.mode & 0o1000);
    const trustedAncestor = !isRoot && (stat.uid === 0 || filesystemRoot);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.uid !== this.uid && !trustedAncestor)
      || ((stat.mode & 0o022) && !stickyRootAncestor)
      || (isRoot && (stat.uid !== this.uid || (stat.mode & 0o077)))) {
      throw new SshKeyRegistryError("UNSAFE", `Unsafe SSH key registry directory ownership, permissions or symlink (uid ${stat.uid}, expected ${this.uid}, mode ${(stat.mode & 0o7777).toString(8)}, registry root ${isRoot})`);
    }
  }

  private syncDirectory(path: string, expected: Stats): void {
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      if (!sameInode(expected, fs.fstatSync(fd))) throw new SshKeyRegistryError("UNSAFE", "SSH key registry parent changed");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  }

  private syncParents(directory: Stats): void {
    // Flush the private ancestor chain and its first containing directory. A
    // failed mkdir fsync may have left a private directory's entry unflushed.
    // Preexisting non-private ancestors (e.g. /tmp) are the trusted boundary;
    // do not fsync unrelated mount roots above them.
    this.assertDirectory(directory);
    let location = dirname(this.root);
    for (;;) {
      const stat = fs.lstatSync(location); this.safeDirectory(stat, false, location === parse(location).root);
      this.syncDirectory(location, stat);
      const parent = dirname(location);
      if (parent === location || stat.uid !== this.uid || (stat.mode & 0o077)) break;
      location = parent;
    }
    this.assertDirectory(directory);
  }

  private directory(create: boolean): Stats {
    let location = parse(this.root).root;
    let current = fs.lstatSync(location);
    this.safeDirectory(current, location === this.root, true);
    for (const component of this.root.slice(location.length).split("/").filter(Boolean)) {
      const parent = location, parentStat = current;
      location = join(location, component);
      let made = false;
      try { current = fs.lstatSync(location); }
      catch (error) {
        if (codeOf(error) !== "ENOENT" || !create) throw error;
        try { fs.mkdirSync(location, { mode: 0o700 }); made = true; }
        catch (mkdirError) { if (codeOf(mkdirError) !== "EEXIST") throw mkdirError; }
        current = fs.lstatSync(location);
      }
      this.safeDirectory(current, location === this.root);
      if (made) this.syncDirectory(parent, parentStat);
    }
    return current;
  }

  private assertDirectory(expected: Stats): void {
    if (!sameInode(expected, this.directory(false))) throw new SshKeyRegistryError("UNSAFE", "SSH key registry directory changed");
  }

  private safeFile(stat: Stats): void {
    if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== this.uid || (stat.mode & 0o077) || stat.nlink !== 1) {
      throw new SshKeyRegistryError("UNSAFE", "Unsafe SSH key registry file ownership, permissions, type or link count");
    }
    if (stat.size > MAX_BYTES) throw new SshKeyRegistryError("CORRUPT", "SSH key registry exceeds its size limit");
  }

  private read(directory: Stats): SshKeySnapshot {
    this.assertDirectory(directory);
    let before: Stats;
    try { before = fs.lstatSync(this.file); }
    catch (error) { if (codeOf(error) === "ENOENT") return { revision: "initial", keys: [] }; throw error; }
    this.safeFile(before);
    const fd = fs.openSync(this.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const opened = fs.fstatSync(fd); this.safeFile(opened);
      if (!sameInode(before, opened)) throw new SshKeyRegistryError("UNSAFE", "SSH key registry file changed while opening");
      const buffer = Buffer.alloc(MAX_BYTES + 1);
      let length = 0, read = 0;
      do { read = fs.readSync(fd, buffer, length, buffer.length - length, null); length += read; }
      while (read && length < buffer.length);
      const after = fs.fstatSync(fd); this.safeFile(after);
      if (length > MAX_BYTES || length !== after.size || opened.size !== after.size
        || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) {
        throw new SshKeyRegistryError("CORRUPT", "SSH key registry changed during read or exceeds its bounds");
      }
      bytes = buffer.subarray(0, length);
    } finally { fs.closeSync(fd); }
    try {
      const keys = schema(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
      return { revision: revision(bytes), keys };
    } catch { throw new SshKeyRegistryError("CORRUPT", "SSH key registry is corrupt or has an unsupported schema; preserve it for recovery"); }
  }

  private save(keys: SshKeyRecord[], previous: SshKeySnapshot, tx: Transaction): SshKeySnapshot {
    const bytes = Buffer.from(JSON.stringify({ version: 1, keys }) + "\n");
    if (bytes.length > MAX_BYTES) throw new SshKeyRegistryError("LIMIT", "SSH key registry exceeds its size limit");
    const stage = join(this.root, `.registry-${randomUUID()}.tmp`);
    let fd: number | undefined, staged: Stats | undefined;
    try {
      this.syncParents(tx.directory); tx.lease.assertOwned();
      fd = fs.openSync(stage, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      staged = fs.fstatSync(fd);
      fs.fchmodSync(fd, 0o600); // Exactly private even under a restrictive umask.
      fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      this.assertDirectory(tx.directory); tx.lease.assertOwned();
      const stagedNow = fs.lstatSync(stage); this.safeFile(stagedNow);
      if (!sameInode(staged, stagedNow)) throw new SshKeyRegistryError("UNSAFE", "SSH key registry stage changed");
      const actual = this.read(tx.directory);
      if (actual.revision !== previous.revision) throw new SshKeyRegistryError("CONFLICT", "SSH key registry changed before installation; reload", actual);
      fs.renameSync(stage, this.file); tx.renamed = true;
      this.syncDirectory(this.root, tx.directory);
      return { revision: revision(bytes), keys };
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* Preserve the primary failure. */ } }
      if (!tx.renamed && staged) {
        // Never recursively clean, follow a replacement root, or remove a foreign stage.
        try {
          this.assertDirectory(tx.directory);
          if (sameInode(staged, fs.lstatSync(stage))) fs.unlinkSync(stage);
        } catch { /* Retain uncertain staging evidence; the original file is untouched. */ }
      }
    }
  }
}
