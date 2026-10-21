import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { ensureGitRepositoryIdentity, trustedGitRepository, type TrustedGitRepository } from "./project-trust-repository";
import { validateNativeResourceSelection, type NativeResourceSelection } from "./session-native-resources";

export interface ProjectNativeResources {
  supported: boolean;
  projectRoot: string | null;
  revision: string | null;
  selection: NativeResourceSelection | null;
}
interface Entry { identity: string; selection: NativeResourceSelection }
const MAX_BYTES = 4 * 1024 * 1024;
const storePath = (agentDir: string) => join(agentDir, "pi-web", "project-native-resources.json");
const unavailable = () => new Error("Project native-tool defaults are unavailable");

function readStore(file: string): Map<string, NativeResourceSelection> {
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw unavailable();
  }
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_BYTES)) throw unavailable();
    const bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    const data = JSON.parse(bytes.subarray(0, length).toString("utf8")) as { version?: unknown; projects?: unknown };
    const after = fstatSync(fd, { bigint: true });
    if (length !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || !data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 2
      || data.version !== 1 || !Array.isArray(data.projects) || data.projects.length > 1000) throw unavailable();
    const entries = new Map<string, NativeResourceSelection>();
    for (const item of data.projects) {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 2
        || typeof item.identity !== "string" || !item.identity || item.identity.length > 16_384
        || entries.has(item.identity)) throw unavailable();
      entries.set(item.identity, validateNativeResourceSelection(item.selection));
    }
    return entries;
  } catch { throw unavailable(); }
  finally { closeSync(fd); }
}

function repositoryInstance(repository: TrustedGitRepository): string[] {
  const stat = statSync(repository.common, { bigint: true });
  return [repository.common, String(stat.dev), String(stat.ino), String(stat.birthtimeNs)];
}
function metadata(repository: TrustedGitRepository | null, entries: Map<string, NativeResourceSelection>): ProjectNativeResources {
  if (!repository) return { supported: false, projectRoot: null, revision: null, selection: null };
  const selection = repository.key ? entries.get(repository.key) ?? null : null;
  // A stale browser cannot save into a replacement project or overwrite a newer
  // default. The revision exposes neither Git metadata paths nor selection keys.
  const revision = createHash("sha256").update(JSON.stringify([
    ...repositoryInstance(repository), repository.key, selection,
  ])).digest("hex");
  return { supported: true, projectRoot: repository.root, revision, selection };
}

/** Inert: no identity marker, configuration engine, transport or trust write. */
export function readProjectNativeResources(cwd: string, agentDir: string): ProjectNativeResources {
  return metadata(trustedGitRepository(cwd), readStore(storePath(agentDir)));
}

export class ProjectNativeResourcesConflict extends Error {
  constructor() { super("Project defaults changed; refresh before saving"); }
}

/** User-owned settings only. A Git identity marker is not project trust. */
export function saveProjectNativeResources(cwd: string, agentDir: string, revision: unknown, requested: unknown): ProjectNativeResources {
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new ProjectNativeResourcesConflict();
  const selection = requested === null ? null : validateNativeResourceSelection(requested);
  const file = storePath(agentDir);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // Synchronous Git probes block proper-lockfile's timer heartbeat. Use an
  // explicit lease, much longer than the permitted write budget, and fence every
  // probe group plus the final write. Each probe group has at most six 10s Git
  // calls; a slow/paused save must fail rather than publish an expired snapshot.
  const started = performance.now(), wallStarted = Date.now();
  const release = lockfile.lockSync(file, { realpath: false, lockfilePath: `${file}.lock`, stale: 120_000 });
  const assertWriteBudget = () => {
    if (Math.max(performance.now() - started, Date.now() - wallStarted) > 30_000) throw new Error("Project default save exceeded its lease budget");
  };
  try {
    const entries = readStore(file), repository = trustedGitRepository(cwd);
    assertWriteBudget();
    if (!repository) throw new Error("Project defaults require a registered Git checkout root");
    if (metadata(repository, entries).revision !== revision) throw new ProjectNativeResourcesConflict();
    const instance = JSON.stringify(repositoryInstance(repository));
    const identified = selection ? ensureGitRepositoryIdentity(cwd) : repository;
    assertWriteBudget();
    if (JSON.stringify(repositoryInstance(identified)) !== instance || repository.key && identified.key !== repository.key) throw new ProjectNativeResourcesConflict();
    if (identified.key) {
      if (selection) entries.set(identified.key, selection);
      else entries.delete(identified.key);
    }
    if (entries.size > 1000) throw new Error("Too many project native-tool defaults");
    const projects: Entry[] = [...entries].sort(([a], [b]) => a.localeCompare(b)).map(([identity, value]) => ({ identity, selection: value }));
    const contents = `${JSON.stringify({ version: 1, projects }, null, 2)}\n`;
    if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error("Too many project native-tool defaults");
    // Verify current membership/identity once more before the atomic write.
    if (trustedGitRepository(cwd)?.key !== identified.key) throw new ProjectNativeResourcesConflict();
    assertWriteBudget();
    writePrivateFileAtomicSync(file, contents);
    return metadata(identified, entries);
  } finally { release(); }
}

/** Only the ordinary new-session route calls this. Existing sessions and generic
 * RPC/child/launch startup never consult mutable project defaults. */
export function projectNativeResourceSelection(cwd: string, agentDir: string): NativeResourceSelection | undefined {
  return readProjectNativeResources(cwd, agentDir).selection ?? undefined;
}
