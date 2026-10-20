import { isDeepStrictEqual } from "node:util";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ModelLike } from "./pi-types";

type Runtime = AgentSessionLike["modelRuntime"];
type Member = {
  session: AgentSessionLike;
  busy: (requester: AgentSessionLike) => boolean;
  alive: () => boolean;
  persist: () => void;
  bind: AgentSessionLike["setModel"];
  selectionRequired: boolean;
  binding: boolean;
};
type Access = {
  members: Set<Member>;
  uses: number;
  refreshing: boolean;
  failed: boolean;
  settlement?: Promise<void>;
  abort?: AbortController;
  refresh: Runtime["refresh"];
};

declare global {
  var __piSessionModelRuntimeAccess: WeakMap<object, Access> | undefined;
}

const FAILURE = "Model definitions could not be applied. Fix the configuration and select a model again before continuing.";
const BUSY = "Cannot apply model definitions while a session sharing this runtime is busy. Try again when idle.";
export const MODEL_DEFINITION_REFRESH_TIMEOUT_MS = 15_000;

function access(runtime: Runtime): Access {
  const states = globalThis.__piSessionModelRuntimeAccess ??= new WeakMap();
  let state = states.get(runtime);
  if (!state) {
    const refresh = runtime.refresh?.bind(runtime);
    state = { members: new Set(), uses: 0, refreshing: false, failed: false,
      refresh: (options) => refresh ? refresh(options) : Promise.reject(new Error(FAILURE)) };
    states.set(runtime, state);
    // SDK registerProvider launches this public method without awaiting it. Track
    // its real settlement too, rather than racing an invisible background refresh.
    if (refresh) runtime.refresh = async (options) => {
      const release = acquireModelRuntimeUse(runtime);
      try { return await refresh(options); }
      finally { release(); }
    };
  }
  return state;
}

export function assertModelRuntimeReady(runtime: Runtime): void {
  const state = access(runtime);
  if (state.refreshing) throw new Error("Model definitions are being applied. Try again when idle.");
  if (state.failed) throw new Error(FAILURE);
}

/** Construction/title leases exclude reselection without banning normal concurrent runs. */
export function acquireModelRuntimeUse(runtime: Runtime): () => void {
  assertModelRuntimeReady(runtime);
  const state = access(runtime);
  state.uses++;
  let released = false;
  return () => { if (!released) { released = true; state.uses--; } };
}

export function modelRuntimeRefreshState(runtime: Runtime, session?: AgentSessionLike): { refreshing: boolean; error?: string } {
  const state = access(runtime);
  const removed = [...state.members].some((member) => member.session === session && member.selectionRequired);
  return { refreshing: state.refreshing, ...(state.failed ? { error: FAILURE }
    : removed ? { error: "This session's model was removed. Select an available model before continuing." } : {}) };
}

export function pendingModelRuntimeRefresh(runtime: Runtime): Promise<void> | undefined {
  const state = access(runtime);
  return state.refreshing ? state.settlement : undefined;
}

export function abortModelRuntimeRefresh(runtime: Runtime): void {
  access(runtime).abort?.abort();
}

/** Preserve family identity through speed views without replacing shared stream implementations. */
export function withModelRuntimeAccess(source: ModelRuntime, view: ModelRuntime): ModelRuntime {
  const state = access(source);
  const guarded = new Proxy(view, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      if (["stream", "streamSimple", "complete", "completeSimple"].includes(String(key))) {
        return (...args: unknown[]) => {
          const release = acquireModelRuntimeUse(guarded);
          try {
            const result = value.apply(target, args);
            if (result && typeof result.result === "function") {
              void Promise.resolve(result.result()).then(release, release);
            } else if (result && typeof result.then === "function") {
              return Promise.resolve(result).finally(release);
            } else release();
            return result;
          } catch (error) { release(); throw error; }
        };
      }
      // Extension provider effects reach this view too. Do not allow a new registration
      // (and its SDK background refresh) to interleave with an explicit application.
      if (["refresh", "registerProvider", "registerNativeProvider", "unregisterProvider", "registerVirtualModel", "unregisterVirtualModel"].includes(String(key))) {
        return (...args: unknown[]) => {
          const release = acquireModelRuntimeUse(guarded);
          try {
            const result = value.apply(target, args);
            if (result && typeof result.then === "function") return Promise.resolve(result).finally(release);
            release();
            return result;
          } catch (error) { release(); throw error; }
        };
      }
      return value.bind(target);
    },
  });
  const states = globalThis.__piSessionModelRuntimeAccess!;
  states.set(view, state);
  states.set(guarded, state);
  return guarded;
}

/**
 * Guard public SDK effect entry points as well as HTTP commands. In SDK 1.3,
 * extension custom/user turns and deferred settled actions call these methods
 * on the session, not the host's send(). No private SDK state is modified.
 */
export function registerModelRuntimeSession(
  session: AgentSessionLike,
  busy: Member["busy"],
  alive: Member["alive"],
  persist: () => void = () => {},
): () => void {
  const runtime = session.modelRuntime;
  if (!runtime) return () => {}; // Legacy host/test doubles without a runtime.
  const state = access(runtime);
  const member: Member = { session, busy, alive, persist, bind: session.setModel?.bind(session), selectionRequired: false, binding: false };
  state.members.add(member);
  const guardedRunners = new WeakSet<object>();
  const installExtensionGuards = () => {
    const runner = session.extensionRunner;
    if (runner?.createToolContext && !guardedRunners.has(runner)) {
      guardedRunners.add(runner);
      const create = runner.createToolContext.bind(runner);
      runner.createToolContext = (...args) => {
        const context = create(...args);
        const descriptors = Object.getOwnPropertyDescriptors(context);
        const execute = context.executeTool.bind(context);
        // SDK defines executeTool as nonconfigurable. Return a descriptor clone,
        // preserving its getters and signal without touching private runner state.
        descriptors.executeTool = { ...descriptors.executeTool, value: async (...callArgs: Parameters<typeof execute>) => {
          if (!alive()) throw new Error("Session is unavailable");
          assertModelRuntimeSessionReady(session);
          const release = acquireModelRuntimeUse(runtime);
          try { return await execute(...callArgs); }
          finally { release(); }
        } };
        return Object.create(Object.getPrototypeOf(context), descriptors);
      };
    }
    const extensionRuntime = session.resourceLoader?.getExtensions?.().runtime;
    if (extensionRuntime) {
      for (const name of ["setActiveTools", "refreshTools"] as const) {
        const original = extensionRuntime[name];
        extensionRuntime[name] = (...args: Parameters<typeof original>) => {
          if (!alive()) throw new Error("Session is unavailable");
          // Native cross-model model_select handlers may synchronously update
          // tools. Permit only these non-running registry actions during bind;
          // never give callbacks a run/provider/credential admission bypass.
          if (!member.binding) assertModelRuntimeSessionReady(session);
          return Reflect.apply(original, extensionRuntime, args);
        };
      }
    }
  };
  installExtensionGuards();
  const methods = ["prompt", "sendUserMessage", "sendCustomMessage", "steer", "followUp", "compact", "executeBash", "navigateTree", "reload", "setModel"] as const;
  const target = session as unknown as Record<string, unknown>;
  for (const name of methods) {
    const original = target[name];
    if (typeof original !== "function") continue;
    target[name] = async (...args: unknown[]) => {
      if (!alive()) throw new Error("Session is unavailable");
      assertModelRuntimeSessionReady(session);
      const release = acquireModelRuntimeUse(runtime);
      try {
        if (name === "reload") {
          const options = (args[0] ?? {}) as { beforeSessionStart?: () => void | Promise<void> };
          args[0] = { ...options, beforeSessionStart: async () => {
            installExtensionGuards();
            await options.beforeSessionStart?.();
          } };
        }
        return await original.apply(session, args);
      } finally {
        try { if (name === "reload") installExtensionGuards(); }
        finally { release(); }
      }
    };
  }
  return () => { state.members.delete(member); };
}

export function assertModelRuntimeSessionReady(session: AgentSessionLike): void {
  if (!session.modelRuntime) return;
  assertModelRuntimeReady(session.modelRuntime);
  const member = [...access(session.modelRuntime).members].find((entry) => entry.session === session);
  if (member?.selectionRequired) throw new Error("This session's model was removed. Select an available model before continuing.");
}

/** Only an explicit, exclusive reselect may repair a failed runtime family. */
export async function applySessionModelDefinition(
  session: AgentSessionLike,
  provider: string,
  modelId: string,
  timeoutMs = MODEL_DEFINITION_REFRESH_TIMEOUT_MS,
): Promise<ModelLike> {
  const state = access(session.modelRuntime);
  if (state.refreshing || state.uses > 0 || [...state.members].some((member) => member.busy(session))) throw new Error(BUSY);
  // No await between idle validation and publication. Effect/admission guards now
  // exclude new work, including on siblings and through SDK extension callbacks.
  const fullRepair = state.failed;
  state.refreshing = true;
  state.abort = new AbortController();
  const controller = state.abort;
  let rejectTimeout!: (error: Error) => void;
  const timeout = new Promise<never>((_resolve, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    state.failed = true;
    controller.abort();
    rejectTimeout(new Error("Applying model definitions timed out. Retry after the pending refresh settles."));
  }, timeoutMs);
  const work = (async () => {
    let phase = "refresh";
    try {
      // A failed pass may have changed providers without rebinding their models,
      // or left a global composition/availability error. Repair all definitions,
      // not just a newly selected provider, before reopening the family.
      const result = await state.refresh({ allowNetwork: false,
        ...(!fullRepair ? { providers: [provider] } : {}), signal: controller.signal });
      phase = "refresh validation";
      if (controller.signal.aborted || result.aborted || result.errors.size || session.modelRuntime.getError()) throw new Error(FAILURE);
      if (![...state.members].some((member) => member.session === session && member.alive())) throw new Error(FAILURE);
      phase = "model lookup";
      const selected = session.modelRuntime.getModel(provider, modelId);
      if (!selected) throw new Error(`Model not found: ${provider}/${modelId}`);
      for (const member of state.members) {
        if (controller.signal.aborted) throw new Error(FAILURE);
        if (!member.alive()) continue;
        const current = member.session.model;
        if (member.session === session || (current && (fullRepair || current.provider === provider))) {
          const fresh = member.session === session ? selected
            : member.session.modelRuntime.getModel(current!.provider, current!.id);
          if (!fresh) member.selectionRequired = true;
          else {
            const sameId = current?.provider === fresh.provider && current.id === fresh.id;
            const thinking = member.session.agent.state?.thinkingLevel;
            if (!isDeepStrictEqual(current, fresh)) {
              phase = "model binding";
              member.binding = true;
              try { await member.bind(fresh); }
              finally { member.binding = false; }
              if (controller.signal.aborted || !member.alive()) throw new Error(FAILURE);
              if (sameId && thinking) member.session.setThinkingLevel(thinking);
              member.persist();
            }
            member.selectionRequired = false;
          }
        }
        if (controller.signal.aborted || !member.alive()) throw new Error(FAILURE);
        phase = "scope binding";
        const scoped = member.session.scopedModels;
        if (scoped) member.session.setScopedModels(scoped.map((entry) => ({
          ...entry,
          model: fullRepair || entry.model.provider === provider
            ? member.session.modelRuntime.getModel(entry.model.provider, entry.model.id) ?? entry.model
            : entry.model,
        })));
      }
      state.failed = false;
      return selected;
    } catch (error) {
      state.failed = true;
      // Never disclose provider/config errors, which may include request secrets.
      if (error instanceof Error && error.message.startsWith("Model not found: ")) throw error;
      throw new Error(`${FAILURE} (${phase})`);
    } finally {
      clearTimeout(timer);
      state.refreshing = false;
      state.abort = undefined;
    }
  })();
  state.settlement = work.then(() => {}, () => {});
  // A deadline bounds the response, not SDK settlement. work retains exclusivity
  // until it really finishes; a timed-out operation cannot admit new runs.
  return Promise.race([work, timeout]);
}
