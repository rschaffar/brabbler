import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, mkdirSync, openSync, readSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import lockfile from "proper-lockfile";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { nativeResourcesGitRepository, type TrustedGitRepository } from "./project-trust-repository";
import { validateNativeResourceSelection, type NativeResourceSelection } from "./session-native-resources";
import { EMPTY_NATIVE_PREFERENCES, patchNativePreferences, resolveNativeDefaults, nativeDefaultsServerCount, NativeResourceDefaultsLimitError, validateNativeDefaultChange, validateNativePreferences, type NativeResourcePreferences } from "./native-resource-defaults";

export interface ProjectNativeResources {
  supported: boolean;
  projectRoot: string | null;
  revision: string | null;
  selection: NativeResourceSelection | null;
  preferences: NativeResourcePreferences;
}
export interface GlobalNativeResources {
  revision: string;
  selection: NativeResourceSelection | null;
  preferences: NativeResourcePreferences;
}
interface Store {
  projects: Map<string, NativeResourceSelection>; globalSelection: NativeResourceSelection | null;
  globalPreferences: NativeResourcePreferences; projectPreferences: Map<string, NativeResourcePreferences>;
}
interface Entry { identity: string; selection: NativeResourceSelection }
const MAX_BYTES = 4 * 1024 * 1024;
const storePath = (agentDir: string) => join(agentDir, "brabbler", "project-native-resources.json");
const unavailable = () => new Error("Native-tool defaults are unavailable");

function readStore(file: string): Store {
  let fd: number;
  try { fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { projects: new Map(), globalSelection: null, globalPreferences: EMPTY_NATIVE_PREFERENCES, projectPreferences: new Map() };
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
    const data = JSON.parse(bytes.subarray(0, length).toString("utf8")) as { version?: unknown; projects?: unknown; globalSelection?: unknown; globalPreferences?: unknown; projectPreferences?: unknown };
    const after = fstatSync(fd, { bigint: true });
    if (length !== Number(before.size) || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
      || !data || typeof data !== "object" || Array.isArray(data)
      || Object.keys(data).some(key => !["version", "projects", "globalSelection", "globalPreferences", "projectPreferences"].includes(key))
      || data.version !== 1 || !Array.isArray(data.projects) || data.projects.length > 1000) throw unavailable();
    const entries = new Map<string, NativeResourceSelection>();
    for (const item of data.projects) {
      if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 2
        || typeof item.identity !== "string" || !item.identity || item.identity.length > 16_384
        || entries.has(item.identity)) throw unavailable();
      entries.set(item.identity, validateNativeResourceSelection(item.selection));
    }
    const globalSelection = data.globalSelection === undefined || data.globalSelection === null ? null : validateGlobalSelection(data.globalSelection);
    const globalPreferences = data.globalPreferences === undefined ? EMPTY_NATIVE_PREFERENCES : validateNativePreferences(data.globalPreferences, true);
    const projectPreferences = new Map<string, NativeResourcePreferences>();
    if (data.projectPreferences !== undefined) {
      if (!Array.isArray(data.projectPreferences) || data.projectPreferences.length > 1000) throw unavailable();
      for (const item of data.projectPreferences) {
        if (!item || typeof item !== "object" || Array.isArray(item) || Object.keys(item).length !== 2
          || typeof item.identity !== "string" || !item.identity || item.identity.length > 16_384 || projectPreferences.has(item.identity)) throw unavailable();
        projectPreferences.set(item.identity, validateNativePreferences(item.preferences));
      }
    }
    return { projects: entries, globalSelection, globalPreferences, projectPreferences };
  } catch { throw unavailable(); }
  finally { closeSync(fd); }
}

function repositoryInstance(repository: TrustedGitRepository): string[] {
  const stat = statSync(repository.common, { bigint: true });
  return [repository.common, String(stat.dev), String(stat.ino), String(stat.birthtimeNs)];
}
function metadata(repository: TrustedGitRepository | null, entries: Map<string, NativeResourceSelection>, preferencesByProject = new Map<string, NativeResourcePreferences>()): ProjectNativeResources {
  if (!repository) return { supported: false, projectRoot: null, revision: null, selection: null, preferences: EMPTY_NATIVE_PREFERENCES };
  const preferences = repository.key ? preferencesByProject.get(repository.key) ?? EMPTY_NATIVE_PREFERENCES : EMPTY_NATIVE_PREFERENCES;
  const selection = repository.key ? entries.get(repository.key) ?? null : null;
  // A stale browser cannot save into a replacement project or overwrite a newer
  // default. The revision exposes neither Git metadata paths nor selection keys.
  const revision = createHash("sha256").update(JSON.stringify([
    ...repositoryInstance(repository), repository.key, selection, preferences,
  ])).digest("hex");
  return { supported: true, projectRoot: repository.root, revision, selection, preferences };
}

/** Inert: no identity marker, configuration engine, transport or trust write. */
export function readProjectNativeResources(cwd: string, agentDir: string): ProjectNativeResources {
  const store = readStore(storePath(agentDir));
  return metadata(nativeResourcesGitRepository(cwd), store.projects, store.projectPreferences);
}

export class ProjectNativeResourcesConflict extends Error {
  constructor() { super("Native-tool defaults changed; refresh before saving"); }
}

/** User-owned settings only. A Git identity marker is not project trust. */
export function saveProjectNativeResources(cwd: string, agentDir: string, revision: unknown, requested: unknown, requestedChange?: unknown): ProjectNativeResources {
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new ProjectNativeResourcesConflict();
  const change = requestedChange === undefined ? undefined : validateNativeDefaultChange(requestedChange);
  const selection = change || requested === null ? null : validateNativeResourceSelection(requested);
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
    const store = readStore(file), entries = store.projects, repository = nativeResourcesGitRepository(cwd);
    assertWriteBudget();
    if (!repository) throw new Error("Project defaults require a registered Git checkout root");
    const previous = metadata(repository, entries, store.projectPreferences);
    if (previous.revision !== revision) throw new ProjectNativeResourcesConflict();
    const previousCount = nativeDefaultsServerCount(store.globalSelection, store.globalPreferences, previous.selection, previous.preferences);
    const instance = JSON.stringify(repositoryInstance(repository));
    const identified = selection || change ? nativeResourcesGitRepository(cwd, true) : repository;
    assertWriteBudget();
    if (JSON.stringify(repositoryInstance(identified)) !== instance || repository.key && identified.key !== repository.key) throw new ProjectNativeResourcesConflict();
    if (identified.key) {
      if (change) store.projectPreferences.set(identified.key, patchNativePreferences(store.projectPreferences.get(identified.key) ?? EMPTY_NATIVE_PREFERENCES, change));
      else {
        if (selection) entries.set(identified.key, selection); else entries.delete(identified.key);
        store.projectPreferences.delete(identified.key);
      }
    }
    if (new Set([...entries.keys(), ...store.projectPreferences.keys()]).size > 1000) throw new Error("Too many project native-tool defaults");
    const candidate = metadata(identified, entries, store.projectPreferences);
    const count = nativeDefaultsServerCount(store.globalSelection, store.globalPreferences, candidate.selection, candidate.preferences);
    if (count > 128 && count >= previousCount) throw new NativeResourceDefaultsLimitError();
    const contents = serializeStore(store);
    // Verify current membership/identity once more before the atomic write.
    if (nativeResourcesGitRepository(cwd)?.key !== identified.key) throw new ProjectNativeResourcesConflict();
    assertWriteBudget();
    writePrivateFileAtomicSync(file, contents);
    return metadata(identified, entries, store.projectPreferences);
  } finally { release(); }
}

function validateGlobalSelection(value: unknown): NativeResourceSelection {
  const selection = validateNativeResourceSelection(value);
  if (selection.mcpServers.some(server => server.scope !== "global")) throw new Error("Global defaults require globally configured MCP servers");
  return selection;
}
function serializeStore(store: Store): string {
  const projects: Entry[] = [...store.projects].sort(([a], [b]) => a.localeCompare(b)).map(([identity, selection]) => ({ identity, selection }));
  const projectPreferences = [...store.projectPreferences].sort(([a], [b]) => a.localeCompare(b)).map(([identity, preferences]) => ({ identity, preferences }));
  const contents = `${JSON.stringify({ version: 1, projects, ...(store.globalSelection ? { globalSelection: store.globalSelection } : {}),
    globalPreferences: store.globalPreferences, projectPreferences }, null, 2)}\n`;
  if (Buffer.byteLength(contents) > MAX_BYTES) throw new Error("Too many native-tool defaults");
  return contents;
}
function globalMetadata(store: Store): GlobalNativeResources {
  return { revision: createHash("sha256").update(JSON.stringify(["global", store.globalSelection, store.globalPreferences])).digest("hex"), selection: store.globalSelection, preferences: store.globalPreferences };
}

/** Global defaults never inspect a repository or create an identity/trust marker. */
export function readGlobalNativeResources(agentDir: string): GlobalNativeResources {
  return globalMetadata(readStore(storePath(agentDir)));
}
export function saveGlobalNativeResources(agentDir: string, revision: unknown, requested: unknown, requestedChange?: unknown): GlobalNativeResources {
  if (typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new ProjectNativeResourcesConflict();
  const change = requestedChange === undefined ? undefined : validateNativeDefaultChange(requestedChange, true);
  const selection = change || requested === null ? null : validateGlobalSelection(requested);
  const file = storePath(agentDir);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const started = performance.now(), wallStarted = Date.now();
  const release = lockfile.lockSync(file, { realpath: false, lockfilePath: `${file}.lock`, stale: 120_000 });
  try {
    const store = readStore(file);
    if (globalMetadata(store).revision !== revision) throw new ProjectNativeResourcesConflict();
    const previousCount = nativeDefaultsServerCount(store.globalSelection, store.globalPreferences, null, EMPTY_NATIVE_PREFERENCES);
    if (change) store.globalPreferences = patchNativePreferences(store.globalPreferences, change);
    else { store.globalSelection = selection; store.globalPreferences = EMPTY_NATIVE_PREFERENCES; }
    const count = nativeDefaultsServerCount(store.globalSelection, store.globalPreferences, null, EMPTY_NATIVE_PREFERENCES);
    if (count > 128 && count >= previousCount) throw new NativeResourceDefaultsLimitError();
    const contents = serializeStore(store);
    if (Math.max(performance.now() - started, Date.now() - wallStarted) > 30_000) throw new Error("Global default save exceeded its lease budget");
    writePrivateFileAtomicSync(file, contents);
    return globalMetadata(store);
  } finally { release(); }
}

/** Only the ordinary new-session route consults mutable defaults. Explicit
 * per-session intent is resolved by its caller before this lookup. */
export function ordinaryNativeResourceSelection(cwd: string, agentDir: string): NativeResourceSelection | undefined {
  const store = readStore(storePath(agentDir));
  const project = metadata(nativeResourcesGitRepository(cwd), store.projects, store.projectPreferences);
  return resolveNativeDefaults(store.globalSelection, store.globalPreferences, project.selection, project.preferences);
}

/** Project-only lookup, without global fallback. */
export function projectNativeResourceSelection(cwd: string, agentDir: string): NativeResourceSelection | undefined {
  return readProjectNativeResources(cwd, agentDir).selection ?? undefined;
}
