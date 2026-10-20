import { join } from "node:path";
import { createAgentSessionServices, getAgentDir, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";

interface ListingBuild {
  runtime: ModelRuntime;
  reusable: () => boolean;
  settle: () => Promise<void>;
}

interface ListingEntry {
  build: Promise<ListingBuild>;
  tail: Promise<void>;
  expiresAt: number;
  generation: number;
}

interface ListingScope {
  generation: number;
  activeMutations: number;
  /** A failed SDK update can leave sibling writers running. Never retain its snapshots. */
  reuseDisabled: boolean;
  entry?: ListingEntry;
}

declare global {
  var __piSettingsListingScopes: Map<string, ListingScope> | undefined;
}

const LISTING_TTL_MS = 10 * 60_000;

function scopeFor(agentDir: string): ListingScope {
  const scopes = globalThis.__piSettingsListingScopes ??= new Map();
  let scope = scopes.get(agentDir);
  if (!scope) {
    scope = { generation: 0, activeMutations: 0, reuseDisabled: false };
    scopes.set(agentDir, scope);
  }
  return scope;
}

function invalidate(scope: ListingScope): void {
  scope.generation++;
  scope.entry = undefined;
}

/** Structural changes only; credentials/config/catalogs are reread on every call. */
export function invalidateSettingsListingRuntime(agentDir = getAgentDir()): void {
  invalidate(scopeFor(agentDir));
}

/**
 * Invalidate around package effects, not validation failures. SDK update() can
 * change both scopes regardless of the request's scope and reject before its
 * parallel siblings settle. A failed attempt disables reuse until process
 * restart; this is not cancellation or a claim that those siblings settled.
 */
export function beginSettingsListingMutation(agentDir = getAgentDir()): (succeeded: boolean) => void {
  const scope = scopeFor(agentDir);
  scope.activeMutations++;
  invalidate(scope);
  let finished = false;
  return (succeeded) => {
    if (finished) return;
    finished = true;
    scope.activeMutations--;
    if (!succeeded) scope.reuseDisabled = true;
    invalidate(scope);
  };
}

function buildEntry(agentDir: string, scope: ListingScope): ListingEntry {
  const entry: ListingEntry = {
    // Defer construction until the entry is published, including synchronous failures.
    build: Promise.resolve().then(async () => {
      const runtime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
        modelsStorePath: join(agentDir, "models-store.json"),
        refreshOnCreate: false,
      });
      // SDK 1.3 registration starts unawaited public refreshes. Serialize and
      // observe them BEFORE resources register providers. This wrapper belongs
      // only to this listing runtime, never a session or account-bound runtime.
      const refresh = runtime.refresh.bind(runtime);
      let refreshTail: Promise<void> = Promise.resolve();
      let refreshFailed = false;
      runtime.refresh = (options = {}) => {
        const pass = refreshTail.then(() => refresh({ ...options, allowNetwork: false }));
        refreshTail = pass.then((result) => {
          if (result.aborted || result.errors.size > 0) refreshFailed = true;
        }, () => { refreshFailed = true; });
        return pass;
      };
      const settle = async () => {
        let observed: Promise<void>;
        do { observed = refreshTail; await observed; } while (observed !== refreshTail);
      };
      const services = await createAgentSessionServices({
        cwd: agentDir,
        agentDir,
        modelRuntime: runtime,
        // cwd=agentDir alone would still admit agentDir/.pi resources.
        settingsManager: SettingsManager.create(agentDir, agentDir, { projectTrusted: false }),
      });
      await settle();
      return { runtime, settle, reusable: () => !refreshFailed
        && services.resourceLoader.getExtensions().errors.length === 0
        && !services.diagnostics.some((item) => item.type === "error") };
    }),
    tail: Promise.resolve(),
    expiresAt: Infinity,
    generation: scope.generation,
  };
  void entry.build.then(() => { entry.expiresAt = Date.now() + LISTING_TTL_MS; }, () => {
    if (scope.entry === entry) scope.entry = undefined;
  });
  return entry;
}

/**
 * Read-only Pi-default settings catalog, never a session/account runtime.
 * Callbacks must only project data: no credential/settings writes, provider
 * login, registration, network refresh, or returned runtime/provider closures.
 * Clone the projection under the same per-entry queue as refresh so later calls
 * cannot mutate a returned model or status. Invalidated reads fail, never replay
 * their callbacks. Private builders in model-runtime.ts remain unchanged.
 */
export async function readSettingsListing<T>(read: (runtime: ModelRuntime) => T | Promise<T>): Promise<T> {
  const agentDir = getAgentDir();
  const scope = scopeFor(agentDir);
  const retain = scope.activeMutations === 0 && !scope.reuseDisabled;
  let entry = retain ? scope.entry : undefined;
  if (!entry || entry.expiresAt <= Date.now()) {
    entry = buildEntry(agentDir, scope);
    if (retain) scope.entry = entry;
  }
  const current = entry;
  // Outside the queue: an old stuck build/refresh must not hold its replacement.
  const built = await current.build;
  const assertCurrent = () => {
    if (scope.generation !== current.generation) throw new Error("Resource listing changed; try again");
  };
  const operation = current.tail.then(async () => {
    assertCurrent();
    try {
      await built.runtime.refresh({ allowNetwork: false });
      await built.settle();
      assertCurrent();
      const result = structuredClone(await read(built.runtime));
      assertCurrent();
      return result;
    } finally {
      // SDK can resolve a degraded build/refresh rather than reject. Preserve
      // the current response/error but do not keep its incomplete registrations.
      if ((!built.reusable() || built.runtime.getError()) && scope.entry === current) scope.entry = undefined;
    }
  });
  // Preserve each caller's error without poisoning later operations.
  current.tail = operation.then(() => {}, () => {});
  try {
    return await operation;
  } catch (error) {
    if (scope.entry === current) scope.entry = undefined;
    throw error;
  }
}
