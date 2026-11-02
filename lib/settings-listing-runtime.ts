import { join } from "node:path";
import { createAgentSessionServices, getAgentDir, SettingsManager, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { prepareAccountModelRuntime, type AccountModelRuntimeBinding } from "./account-model-runtime";
import type { AccountSelection } from "./provider-accounts";

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
  entries: Map<string, ListingEntry>;
}

declare global {
  var __piSettingsListingScopes: Map<string, ListingScope> | undefined;
}

const LISTING_TTL_MS = 10 * 60_000;

function scopeFor(agentDir: string): ListingScope {
  const scopes = globalThis.__piSettingsListingScopes ??= new Map();
  let scope = scopes.get(agentDir);
  if (!scope) {
    scope = { generation: 0, activeMutations: 0, reuseDisabled: false, entries: new Map() };
    scopes.set(agentDir, scope);
  }
  return scope;
}

function invalidate(scope: ListingScope): void {
  scope.generation++;
  scope.entries.clear();
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

function buildEntry(agentDir: string, scope: ListingScope, binding: AccountModelRuntimeBinding): ListingEntry {
  const entry: ListingEntry = {
    // Defer construction until the entry is published, including synchronous failures.
    build: Promise.resolve().then(async () => {
      const runtime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        ...binding.runtimeOptions,
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
    if (scope.entries.get(binding.modelsStorePath) === entry) scope.entries.delete(binding.modelsStorePath);
  });
  return entry;
}

/**
 * Read-only settings catalog bound to a complete immutable account snapshot,
 * never a session runtime. Definitions and settings remain shared.
 * Callbacks must only project data: no credential/settings writes, provider
 * login, registration, network refresh, or returned runtime/provider closures.
 * Clone the projection under the same per-entry queue as refresh so later calls
 * cannot mutate a returned model or status. Invalidated reads fail, never replay
 * their callbacks. Private builders in model-runtime.ts remain unchanged.
 */
export async function readSettingsListing<T>(
  read: (runtime: ModelRuntime) => T | Promise<T>,
  accounts: Readonly<AccountSelection> = {},
): Promise<T> {
  const agentDir = getAgentDir();
  // Validate/capture before any await; credentials and catalog have one owner.
  const binding = prepareAccountModelRuntime(accounts, { agentDir, refreshOnCreate: false });
  const key = binding.modelsStorePath;
  const scope = scopeFor(agentDir);
  const retain = scope.activeMutations === 0 && !scope.reuseDisabled;
  let entry = retain ? scope.entries.get(key) : undefined;
  if (!entry || entry.expiresAt <= Date.now()) {
    entry = buildEntry(agentDir, scope, binding);
    if (retain) {
      for (const [identity, cached] of scope.entries) if (cached.expiresAt <= Date.now()) scope.entries.delete(identity);
      if (scope.entries.size >= 32) scope.entries.delete(scope.entries.keys().next().value!);
      scope.entries.set(key, entry);
    }
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
      if ((!built.reusable() || built.runtime.getError()) && scope.entries.get(key) === current) scope.entries.delete(key);
    }
  });
  // Preserve each caller's error without poisoning later operations.
  current.tail = operation.then(() => {}, () => {});
  try {
    return await operation;
  } catch (error) {
    if (scope.entries.get(key) === current) scope.entries.delete(key);
    throw error;
  }
}
