import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { gitExecEnv } from "./git-exec";
import { samePath, toNativePath } from "./paths";

/** A Git repository grant is never inferred from a shared parent folder. */
export interface TrustedGitRepository {
  key: string | null;
  common: string;
  root: string;
  checkout: string;
  worktrees: string[];
}

const MARKER = "pi-web-trust-id";
const MARKER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function readMarker(common: string): string | null {
  const path = join(common, MARKER);
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error("Invalid Git trust identity marker");
  const id = readFileSync(path, "utf8").trim();
  if (!MARKER_ID.test(id)) throw new Error("Invalid Git trust identity marker");
  return id;
}
function ensureMarker(common: string): string {
  const existing = readMarker(common);
  if (existing) return existing;
  let fd: number;
  try { fd = openSync(join(common, MARKER), "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const concurrent = readMarker(common);
    if (!concurrent) throw new Error("Git project identity is unavailable");
    return concurrent;
  }
  try { const id = randomUUID(); writeSync(fd, `${id}\n`); return id; }
  finally { closeSync(fd); }
}
function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, "--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    encoding: "utf8", env: { ...gitExecEnv(), GIT_NO_LAZY_FETCH: "1" },
    timeout: 10_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Verify membership afresh; cached sidebar grouping is not a trust boundary. */
export function trustedGitRepository(cwd: string): TrustedGitRepository | null {
  try {
    const physical = realpathSync(cwd);
    const checkout = realpathSync(toNativePath(git(physical, ["rev-parse", "--show-toplevel"]).trim()));
    const common = realpathSync(toNativePath(git(physical, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim()));
    const entries = git(physical, ["worktree", "list", "--porcelain", "-z"])
      .split("\0\0").filter(Boolean)
      .map((entry) => entry.split("\0"))
      .filter((fields) => !fields.some((field) => field === "prunable" || field.startsWith("prunable ")))
      .map((fields) => fields.find((field) => field.startsWith("worktree "))?.slice(9))
      .filter((path): path is string => Boolean(path))
      .flatMap((path) => { try { return [realpathSync(toNativePath(path))]; } catch { return []; } });
    if (!samePath(physical, checkout) || !entries.some((path) => samePath(path, checkout))) return null;
    if (!statSync(common).isDirectory()) return null;
    // A marker in the common Git directory distinguishes a replacement at the same path,
    // even if the filesystem reuses the old directory inode. Reads never create it.
    const id = readMarker(common);
    return { key: id ? JSON.stringify([common, id]) : null, common, root: entries[0], checkout, worktrees: entries };
  } catch {
    return null;
  }
}

/** Initialize only the shared repository identity, never a trust grant. Explicit
 * user-settings saves may use it; metadata reads and session startup must not. */
export function ensureGitRepositoryIdentity(cwd: string): TrustedGitRepository {
  const before = trustedGitRepository(cwd);
  if (!before) throw new Error("Select a registered Git checkout root");
  const identity = statSync(before.common, { bigint: true });
  const id = ensureMarker(before.common);
  const after = trustedGitRepository(cwd), current = statSync(before.common, { bigint: true });
  if (!after || after.key !== JSON.stringify([before.common, id])
    || identity.dev !== current.dev || identity.ino !== current.ino || identity.birthtimeNs !== current.birthtimeNs) {
    throw new Error("Git project changed while saving settings");
  }
  return after;
}

function storePath(agentDir: string): string { return join(agentDir, "pi-web", "trusted-git-repositories.json"); }
function readStore(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid Git project trust store");
  const record = data as { version?: unknown; keys?: unknown };
  if (record.version !== 1 || !Array.isArray(record.keys) || record.keys.length > 10_000
    || record.keys.some((key) => typeof key !== "string" || key.length > 16_384)) throw new Error("Invalid Git project trust store");
  return new Set(record.keys as string[]);
}

export function isGitRepositoryTrusted(repository: TrustedGitRepository, agentDir: string): boolean {
  return repository.key !== null && readStore(storePath(agentDir)).has(repository.key);
}

export function setGitRepositoryTrusted(repository: TrustedGitRepository, agentDir: string, trusted: boolean): void {
  const path = storePath(agentDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = lockfile.lockSync(path, { realpath: false, lockfilePath: `${path}.lock` });
  try {
    const keys = readStore(path);
    const id = trusted ? ensureMarker(repository.common) : readMarker(repository.common);
    const key = id ? JSON.stringify([repository.common, id]) : null;
    if (trusted && key) keys.add(key);
    else if (key) keys.delete(key);
    if (keys.size > 10_000) throw new Error("Too many trusted Git projects");
    writePrivateFileAtomicSync(path, `${JSON.stringify({ version: 1, keys: [...keys].sort() }, null, 2)}\n`);
  } finally { release(); }
}
