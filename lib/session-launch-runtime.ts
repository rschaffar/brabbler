import { getAgentDir, type ModelRuntime, SettingsManager } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { createAccountModelRuntime } from "./account-model-runtime";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { LaunchConfiguration, SessionLaunchHost } from "./session-launch-types";
import { validateAccountSelection } from "./provider-accounts";
import { readSessionAccounts } from "./session-accounts";
import { readSessionModelSpeed } from "./session-model-speed";
import { isModelSpeed } from "./model-speed";
import { validateSessionToolSelection } from "./session-tool-selection";
import { PRESET_FULL } from "./tool-presets";
import { replaceShellTool } from "./powershell-settings";
import { SUBAGENT_META_TYPE } from "./subagents";
import { resolveVisibleModels, selectInitialModelScope } from "./model-scope";
import { getRpcSession, startRpcSession } from "./rpc-manager";
import { samePath } from "./paths";
import { allowFileRoot } from "./file-access";
import { invalidateSessionListCache } from "./session-reader";
import { getProjectTrustStatus } from "./project-trust";
import type { SessionEntry } from "./types";

const thinkingLevels = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
function callerSession(id: string, cwd: string) {
  const session = getRpcSession(id);
  if (!session?.isAlive() || !samePath(session.cwd, cwd) || session.isChatOnly()
    || (session.inner.sessionManager.getEntries() as unknown as SessionEntry[]).some((entry) => entry.type === "custom" && entry.customType === SUBAGENT_META_TYPE)) {
    throw new Error("Only ordinary live coding sessions can start sessions");
  }
  return session;
}
function sameConfig(actual: { model?: { provider: string; id: string }; thinkingLevel?: string; modelSpeed?: string }, config: LaunchConfiguration): boolean {
  return actual.model?.provider === config.provider && actual.model.id === config.modelId
    && actual.thinkingLevel === config.thinkingLevel && actual.modelSpeed === config.modelSpeed;
}
export function launchBuiltinTools(active: string[]): string[] {
  const builtins = new Set<string>(PRESET_FULL);
  return validateSessionToolSelection(replaceShellTool(active, false).filter((name) => builtins.has(name)));
}
export const sessionLaunchHost: SessionLaunchHost = {
  async resolve(request, caller) {
    const parent = callerSession(caller.id, caller.cwd);
    const entries = parent.inner.sessionManager.getEntries() as unknown as SessionEntry[];
    const accounts = structuredClone(request.accounts ?? readSessionAccounts(entries) ?? {});
    if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)
      || Object.entries(accounts).some(([key, value]) => !key || typeof value !== "string" || !value)) throw new Error("Invalid provider account selection");
    validateAccountSelection(accounts);
    const provider = request.provider ?? parent.inner.model?.provider;
    const modelId = request.modelId ?? parent.inner.model?.id;
    if (!provider || !modelId || (request.provider === undefined) !== (request.modelId === undefined)) throw new Error("Specify provider and modelId together; a current model is required");
    const thinkingLevel = request.thinkingLevel ?? parent.inner.agent.state?.thinkingLevel ?? "off";
    if (!thinkingLevels.has(thinkingLevel)) throw new Error("Invalid thinking level");
    const modelSpeed = request.modelSpeed ?? readSessionModelSpeed(entries);
    if (!isModelSpeed(modelSpeed)) throw new Error("Invalid model speed");
    const toolNames = request.toolNames === undefined ? launchBuiltinTools(parent.inner.getActiveToolNames()) : validateSessionToolSelection(request.toolNames);
    const agentDir = getAgentDir();
    const runtime = request.accounts === undefined ? parent.inner.modelRuntime as ModelRuntime : await createAccountModelRuntime(accounts, { agentDir });
    const settings = SettingsManager.create(request.cwd!, agentDir);
    // Match ordinary startup: untrusted project settings cannot widen model scope.
    settings.setProjectTrusted(getProjectTrustStatus(request.cwd!, agentDir).trusted);
    const scope = await resolveVisibleModels(runtime, settings.getEnabledModels());
    selectInitialModelScope(scope, { requestedModel: { provider, modelId }, thinkingLevel: thinkingLevel as ThinkingLevel });
    return { cwd: request.cwd!, provider, modelId, thinkingLevel: thinkingLevel as ThinkingLevel, modelSpeed, toolNames, accounts };
  },
  async start(config, prompt, caller, operationId, beforePrompt, signal) {
    callerSession(caller.id, caller.cwd);
    signal?.throwIfAborted();
    let observedPrompt: string | undefined;
    const owner = Symbol("session-launch initial prompt");
    let session: Awaited<ReturnType<typeof startRpcSession>>["session"] | undefined;
    let promptAccepted = false;
    const cancelPreflight = () => {
      if (!promptAccepted && session) session.refuseInitialPrompt(owner, signal?.reason ?? new DOMException("Launch cancelled", "AbortError"));
    };
    // Register before startup; cancellation may arrive before a destination exists.
    signal?.addEventListener("abort", cancelPreflight, { once: true });
    try {
      // A unique startup lock and independent wrapper: creator Stop/shutdown does not own the child run.
      const started = await startRpcSession(`__launch__${randomUUID()}`, "", config.cwd, {
        initialPromptOwner: owner,
        initialModel: { provider: config.provider, modelId: config.modelId }, thinkingLevel: config.thinkingLevel,
        modelSpeed: config.modelSpeed, accounts: config.accounts, toolNames: config.toolNames, persistPreferences: false,
        observePrompt: (text) => { observedPrompt = text; },
      });
      session = started.session;
      const { realSessionId } = started;
      // Metadata persists even if Stop/policy changes arrived during startup.
      // Announce creation before any subsequent failure so the retained ID is reported.
      try { beforePrompt(realSessionId); }
      finally { session.recordSpawnOrigin(caller.id, operationId); }
      allowFileRoot(config.cwd);
      invalidateSessionListCache();
      if (signal?.aborted) cancelPreflight();
      signal?.throwIfAborted();
      const destination = session;
      const state = await destination.waitForInitialPrompt(owner, destination.send({ type: "get_state" })) as Parameters<typeof sameConfig>[0];
      if (!sameConfig(state, config)) throw new Error("Startup did not preserve the approved model/thinking/speed; initial prompt not sent");
      // The literal first prompt cannot execute slash commands or expand templates.
      // Final admission is AFTER all awaited SDK hooks, before any provider request.
      await destination.waitForInitialPrompt(owner, destination.send({ type: "prompt", message: prompt }, { owner, literal: true, validate: (disposition) => {
        signal?.throwIfAborted();
        beforePrompt(realSessionId);
        if (disposition === undefined) return;
        const entries = destination.inner.sessionManager.getEntries() as unknown as SessionEntry[];
        const actual = { model: destination.inner.model, thinkingLevel: destination.inner.agent.state?.thinkingLevel,
          modelSpeed: readSessionModelSpeed(entries) };
        const orderedAccounts = (accounts: Record<string, string>) => JSON.stringify(Object.entries(accounts).sort(([a], [b]) => a.localeCompare(b)));
        if (disposition !== "started" || observedPrompt !== prompt || !sameConfig(actual, config)
          || JSON.stringify(launchBuiltinTools(destination.inner.getActiveToolNames()).sort()) !== JSON.stringify([...config.toolNames].sort())
          || orderedAccounts(readSessionAccounts(entries) ?? {}) !== orderedAccounts(config.accounts)) {
          throw new Error("Initial prompt or configuration changed during SDK preflight; approved launch refused");
        }
        validateAccountSelection(config.accounts);
        promptAccepted = true;
        // After actual acceptance, creator cancellation must not own the child run.
        signal?.removeEventListener("abort", cancelPreflight);
      } }));
      return realSessionId;
    } catch (error) {
      session?.refuseInitialPrompt(owner, error);
      throw error;
    } finally { signal?.removeEventListener("abort", cancelPreflight); }
  },
};
