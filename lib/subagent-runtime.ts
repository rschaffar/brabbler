import type { Agent, ThinkingLevel } from "@earendil-works/pi-agent-core";
import {
  createAgentSessionFromServices,
  createAgentSessionServices,
  getAgentDir,
  initTheme,
  SessionManager,
  SettingsManager,
  type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike } from "./pi-types";
import {
  subagentNotificationText,
  subagentToolDetails,
  type ResumeSubagentRequest,
  type StartSubagentRequest,
  type SubagentExecution,
  type SubagentExtensionRuntime,
} from "./subagent-extension";
import {
  readSubagentRun,
  resolveSubagentProfile,
  SUBAGENT_CONTROL_TOOL_NAMES,
  SUBAGENT_META_TYPE,
  SUBAGENT_STATUS_TYPE,
  selectSubagentExtensionTools,
  withSubagentExtensionTools,
  type SubagentMetadata,
  type SubagentRunInfo,
} from "./subagents";
import type { SessionEntry } from "./types";
import { buildSubagentPromptPlan } from "./subagent-prompt";
import { appendSessionAccounts, readSessionAccounts } from "./session-accounts";
import { appendSessionModelSpeed, readSessionModelSpeed } from "./session-model-speed";
import { withSessionModelSpeed } from "./session-model-speed-runtime";
import { createExactSystemPromptExtension } from "./exact-system-prompt";
import { createLocalFileLinkGuidanceExtension } from "./local-file-link-guidance";
import { acceptancePlugin } from "../plugins/acceptance";
import { createAskUserExtension, preferPiWebAskUserExtension } from "./ask-user-extension";
import { appendSubagentInputFiles, loadSubagentInputFiles, assertSubagentInputBudget, subagentInputLimits } from "./subagent-input";
import { parseSubagentModel, SUBAGENT_THINKING_LEVELS } from "./subagent-model";
import { assertSubagentDirectory, persistChildSession, recordSubagentResult, settleOrphanedSubagent, subagentRunMetadata } from "./subagent-lifecycle";
import { installSubagentTurnLimit } from "./subagent-turn-limit";
import { existsSync } from "node:fs";
import { projectTrustReloadOptions } from "./project-trust";
import { resolveShellTools } from "./powershell-settings";
import { isBuiltInSubagentsEnabled, readSubagentSettings } from "./subagent-settings";
import { SubagentQueue } from "./subagent-queue";
import { addWorktree, currentLocalBranchTip, removeWorktree } from "./worktree";
import { randomUUID } from "node:crypto";
import { getSessionPause, removeSessionPause } from "./session-pause";
import { acquireModelRuntimeUse, withModelRuntimeAccess } from "./session-model-refresh";

interface HostSession {
  readonly inner: AgentSessionLike;
  readonly sessionFile: string;
  readonly cwd: string;
  isAlive(): boolean;
  isRunning(): boolean;
  waitUntilReady(): Promise<void>;
  beginCheckoutPromptAdmission(): () => void;
  isPauseRequested?(): boolean;
  requestPause?(parentSessionId?: string): unknown;
  finishPause?(childSettled?: boolean): void;
  clearPause?(): void;
  onSubagentSettled?(): void;
  pauseFailed?(error: unknown): void;
}

export interface SubagentRuntimeDependencies {
  getSession(sessionId: string): HostSession | undefined;
  registerSession(
    inner: AgentSessionLike,
    options?: { exactSystemPrompt?: string; chatOnly?: boolean },
  ): void;
  reopenSession(sessionId: string, sessionFile: string): Promise<HostSession>;
  resolveSessionPath(sessionId: string): Promise<string | null>;
  invalidateSessionList(): void;
  isBuiltInSubagentsEnabled?(): boolean;
}

export interface SubagentController {
  readonly extensionRuntime: SubagentExtensionRuntime;
  get(sessionId: string): Promise<SubagentRunInfo | null>;
  steer(sessionId: string, message: string): Promise<void>;
  abort(sessionId: string): Promise<void>;
}

type StoredSubagentExecution = {
  run: SubagentRunInfo;
  completion: Promise<SubagentRunInfo>;
  abortRequested: boolean;
  turnLimitReached?: boolean;
  cancelQueued?: () => boolean;
};

declare global {
  var __piSubagentRuns: Map<string, StoredSubagentExecution> | undefined;
  var __piSubagentQueue: SubagentQueue<SubagentRunInfo> | undefined;
  var __piSubagentNotifications: Map<string, boolean> | undefined;
}
const SUBAGENT_CONTEXT_LIMIT = 50_000;
const PARENT_IDLE_POLL_MS = 200;
/** Provider errors and child-chat Stop can resolve prompt() normally. */
function lastAssistantStop(sessionManager: { getEntries?: () => unknown }): { aborted?: true; error?: string } | undefined {
  const entries = sessionManager.getEntries?.();
  if (!Array.isArray(entries)) return undefined;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i] as { type?: unknown; message?: { role?: unknown; stopReason?: unknown; errorMessage?: unknown } };
    if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
    if (entry.message.stopReason === "aborted") return { aborted: true };
    if (entry.message.stopReason !== "error") return undefined;
    return { error: typeof entry.message.errorMessage === "string" && entry.message.errorMessage ? entry.message.errorMessage : "Provider returned an error" };
  }
  return undefined;
}

function getSubagentRuns(): Map<string, StoredSubagentExecution> {
  if (!globalThis.__piSubagentRuns) globalThis.__piSubagentRuns = new Map();
  return globalThis.__piSubagentRuns;
}

/** Include settlement/cleanup and failed durable-result writes in live ownership. */
export function hasUnsettledSubagentExecution(sessionId: string): boolean {
  const stored = getSubagentRuns().get(sessionId);
  return Boolean(stored && stored.run.status !== "queued");
}

/** A stale queue snapshot must never turn cooperative Pause into running Stop. */
export async function cancelQueuedSubagentForPause(sessionId: string): Promise<void> {
  const stored = getSubagentRuns().get(sessionId);
  if (stored?.run.status !== "queued" || !stored.cancelQueued?.()) return;
  stored.abortRequested = true;
  await stored.completion;
}

/** Only live queue entries, not an on-disk `queued` status left by a server restart. */
export function getQueuedSubagentSessionIds(): string[] {
  return [...getSubagentRuns()].filter(([, stored]) => stored.run.status === "queued").map(([id]) => id);
}

function getSubagentQueue(): SubagentQueue<SubagentRunInfo> {
  if (!globalThis.__piSubagentQueue) globalThis.__piSubagentQueue = new SubagentQueue();
  return globalThis.__piSubagentQueue;
}

/** Only scheduled notifications own marks. Collecting an already delivered result
 * cannot accumulate a new mark on every resume. Multiple held runs remain distinct. */
function getSubagentNotifications(): Map<string, boolean> {
  return globalThis.__piSubagentNotifications ??= new Map();
}

type RunIdentity = Pick<SubagentRunInfo, "sessionId" | "runId" | "completedAt">;
function resultKey(run: RunIdentity): string | undefined {
  return run.runId ? JSON.stringify([run.sessionId, "run", run.runId])
    : run.completedAt ? JSON.stringify([run.sessionId, "legacy", run.completedAt]) : undefined;
}
function expectNotification(run: RunIdentity): void {
  const key = resultKey(run);
  if (key && !getSubagentNotifications().has(key)) getSubagentNotifications().set(key, false);
}
function markResultConsumed(run: RunIdentity): void {
  const key = resultKey(run);
  if (key && getSubagentNotifications().has(key)) getSubagentNotifications().set(key, true);
}
function takeResultConsumed(run: RunIdentity): boolean {
  const key = resultKey(run);
  if (!key || !getSubagentNotifications().get(key)) return false;
  getSubagentNotifications().delete(key);
  return true;
}

/** Early lookup must not load resources or reject a model only child services can discover. */
function expectedSubagentModel(runtime: ModelRuntime, reference: string | undefined, parent: AgentSessionLike["model"]) {
  try { return reference?.trim() ? parseSubagentModel(runtime, reference)?.model : parent; }
  catch { return undefined; }
}

/** Filter legacy synthetic reminders before flattening/truncating inherited context. */
export function parentContextText(parent: Pick<HostSession, "inner">): string {
  const messages = parent.inner.sessionManager.buildSessionContext().messages;
  const serialized = JSON.stringify(messages);
  if (serialized.length <= SUBAGENT_CONTEXT_LIMIT) return serialized;
  return `${serialized.slice(0, SUBAGENT_CONTEXT_LIMIT)}\n[Parent context truncated]`;
}

async function cleanupWorktree(
  parentCwd: string,
  worktree: { path: string; branch: string } | undefined,
): Promise<string | undefined> {
  if (!worktree) return undefined;
  try {
    await removeWorktree(parentCwd, worktree.path);
    return undefined;
  } catch (error) {
    return `Worktree retained at ${worktree.path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export function createSubagentController(
  dependencies: SubagentRuntimeDependencies,
): SubagentController {
  function enqueueRun(initialRun: SubagentRunInfo, wrapper: HostSession, task: string, signal: AbortSignal | undefined,
    onUpdate: ((run: SubagentRunInfo) => void) | undefined, cleanup: () => Promise<string | undefined>): SubagentExecution {
    const active = getSubagentRuns().get(initialRun.sessionId)?.run.status;
    if (active === "queued" || active === "running") throw new Error("Subagent is already running");
    const manager = wrapper.inner.sessionManager;
    let queueError: unknown;
    let resolveCompletion!: (run: SubagentRunInfo) => void;
    const completion = new Promise<SubagentRunInfo>((resolve) => { resolveCompletion = resolve; });
    const stored: StoredSubagentExecution = { run: initialRun, completion, abortRequested: !initialRun.runInBackground && signal?.aborted === true };
    getSubagentRuns().set(initialRun.sessionId, stored);
    const update = () => {
      try { onUpdate?.(stored.run); }
      catch (error) { console.error("[pi-web] subagent update listener failed:", error instanceof Error ? error.message : String(error)); }
      dependencies.invalidateSessionList();
    };
    const handleParentAbort = () => {
      stored.abortRequested = true;
      if (stored.run.status === "queued") stored.cancelQueued?.();
      else void wrapper.inner.abort();
    };
    if (!initialRun.runInBackground) signal?.addEventListener("abort", handleParentAbort, { once: true });
    update();
    let settled = false;
    const finish = async (run: SubagentRunInfo): Promise<SubagentRunInfo> => {
      if (settled) return stored.run;
      settled = true;
      signal?.removeEventListener("abort", handleParentAbort);
      const pauseBeforeCleanup = wrapper.isPauseRequested?.() === true;
      const cleanupError = pauseBeforeCleanup ? undefined : await cleanup();
      const paused = wrapper.isPauseRequested?.() === true;
      if (paused) run = { ...run, status: "paused", ...(!pauseBeforeCleanup ? { worktreeCleanupError: "Pause arrived after cleanup started; inspect the recorded worktree observation." } : {}) };
      const result = { ...run, ...(cleanupError ? { worktreeCleanupError: cleanupError } : {}) };
      try {
        stored.run = recordSubagentResult(manager, result);
        // Never release live ownership before the terminal record is durable.
        if (paused) wrapper.finishPause?.(true);
        getSubagentRuns().delete(initialRun.sessionId);
        try { wrapper.onSubagentSettled?.(); }
        catch (error) { console.error("[pi-web] child settlement listener failed:", error); }
      } catch (error) {
        // Retain the failed live record for inspection; do not claim durable success.
        stored.run = { ...result, status: "failed", error: `${result.error ? `${result.error}. ` : ""}Could not persist subagent result: ${error instanceof Error ? error.message : String(error)}` };
        if (wrapper.isPauseRequested?.()) wrapper.pauseFailed?.(error);
      }
      update();
      resolveCompletion(stored.run);
      return stored.run;
    };
    const stopped = () => finish({ ...initialRun, status: queueError ? "failed" : "aborted", completedAt: new Date().toISOString(),
      ...(queueError ? { error: String(queueError) } : {}) });
    const execute = async () => {
      if (dependencies.getSession(initialRun.parentSessionId)?.isPauseRequested?.()) wrapper.requestPause?.(initialRun.parentSessionId);
      if (stored.abortRequested || wrapper.isPauseRequested?.()) return stopped();
      let limiter: ReturnType<typeof installSubagentTurnLimit> | undefined;
      let result: SubagentRunInfo;
      try {
        if (queueError) throw queueError;
        assertSubagentDirectory(wrapper.cwd);
        manager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, ...subagentRunMetadata(initialRun), status: "running" });
        stored.run = { ...initialRun, status: "running" };
        update();
        limiter = installSubagentTurnLimit(wrapper.inner, initialRun.turnLimit, () => { stored.turnLimitReached = true; });
        const releaseAdmission = wrapper.beginCheckoutPromptAdmission();
        try {
          await wrapper.inner.prompt(task, { source: "rpc", preflightResult: () => releaseAdmission() });
        } finally { releaseAdmission(); }
        const text = wrapper.inner.getLastAssistantText()?.trim();
        const stop = stored.abortRequested ? undefined : lastAssistantStop(manager);
        const aborted = stored.abortRequested || stop?.aborted === true;
        const error = aborted ? undefined : stop?.error ?? limiter.error();
        result = { ...initialRun, status: aborted ? "aborted" : error ? "failed" : "completed", completedAt: new Date().toISOString(),
          ...(text ? { result: text } : {}), ...(error ? { error } : {}) };
      } catch (error) {
        const text = wrapper.inner.getLastAssistantText()?.trim();
        const aborted = stored.abortRequested;
        result = { ...initialRun, status: aborted ? "aborted" : "failed", completedAt: new Date().toISOString(),
          ...(text ? { result: text } : {}), ...(!aborted ? { error: error instanceof Error ? error.message : String(error) } : {}) };
      } finally { limiter?.dispose(); }
      return finish(result);
    };
    const queued = getSubagentQueue().enqueue(initialRun.parentSessionId, readSubagentSettings().maxConcurrent, execute, (status) => {
      if (status === "queued") {
        try { manager.appendCustomEntry(SUBAGENT_STATUS_TYPE, { version: 1, ...subagentRunMetadata(initialRun), status }); }
        catch (error) { queueError = error; }
      }
      stored.run = { ...stored.run, status };
      update();
    }, async () => { await stopped(); });
    stored.cancelQueued = queued.cancel;
    if (stored.run.status === "queued" && dependencies.getSession(initialRun.parentSessionId)?.isPauseRequested?.()) {
      try { wrapper.requestPause?.(initialRun.parentSessionId); }
      catch (error) { queueError = error; }
      queued.cancel();
    }
    void queued.promise.catch((error) => finish({ ...initialRun, status: "failed", completedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }));
    return { run: stored.run, completion };
  }

  async function start(request: StartSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("Pi Web built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    const parent = dependencies.getSession(parentSessionId);
    if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
    if (parent.isPauseRequested?.()) throw new Error("Parent session is paused or pausing");
    if (!parent.sessionFile) throw new Error("Parent session must be persisted before starting a subagent");

    let isolatedWorktree: { path: string; branch: string } | undefined;
    let unregisteredInner: AgentSessionLike | undefined;
    const releaseRuntime = parent.inner.modelRuntime ? acquireModelRuntimeUse(parent.inner.modelRuntime) : () => {};
    try {
      const profile = resolveSubagentProfile(parent.cwd, request.profile);
      if (!profile) throw new Error(`Unknown or disabled subagent profile: ${request.profile}`);

      const runInBackground = request.runInBackground ?? profile.runInBackground;
      const isolation = profile.isolation === "off" ? undefined : request.isolation ?? profile.isolation;
      const parentModelRuntime = (parent.inner as unknown as { modelRuntime: ModelRuntime }).modelRuntime;
      const modelReference = request.model?.trim() || profile.model;
      // Containment and expected-model budget checks precede worktree/session effects.
      const inputFiles = loadSubagentInputFiles(parent.cwd, request.inputFiles ?? [],
        subagentInputLimits(expectedSubagentModel(parentModelRuntime, modelReference, parent.inner.model)));
      if (isolation === "worktree") {
        const { branch: baseBranch, oid: expectedBaseOid } = await currentLocalBranchTip(parent.cwd);
        const branch = `pi-web-agent-${randomUUID()}`;
        isolatedWorktree = await addWorktree(parent.cwd, {
          branch,
          baseBranch,
          expectedBaseOid,
          mode: "create",
        });
      }
      const childCwd = isolatedWorktree?.path ?? parent.cwd;
      const inheritContext = request.inheritContext ?? profile.inheritContext;
      const maxTurns = request.maxTurns ?? profile.maxTurns;
      if (maxTurns !== undefined && (!Number.isSafeInteger(Math.floor(maxTurns)) || maxTurns < 0)) {
        throw new Error("max_turns must be a non-negative number");
      }
      const turnLimit = maxTurns && maxTurns > 0 ? Math.floor(maxTurns) : undefined;
      const agentDir = getAgentDir();
      const settingsManager = SettingsManager.create(childCwd, agentDir);
      const inheritedParentContext = inheritContext
        ? `The following is the active conversation context from the parent session. Use it only as background for the delegated task:\n${parentContextText(parent)}`
        : undefined;
      const promptPlan = buildSubagentPromptPlan({
        profileSystemPrompt: profile.systemPrompt,
        tools: profile.tools,
        loadSkills: profile.loadSkills,
        loadExtensions: profile.loadExtensions,
        promptMode: profile.promptMode,
        task: appendSubagentInputFiles(request.task, inputFiles),
        inheritedParentContext,
      });
      const { chatOnly, appendSystemPrompt, delegatedTask } = promptPlan;
      if (!chatOnly) initTheme();
      const services = await createAgentSessionServices({
        cwd: childCwd,
        agentDir,
        modelRuntime: parentModelRuntime,
        settingsManager,
        resourceLoaderOptions: {
          noExtensions: !profile.loadExtensions,
          noSkills: !profile.loadSkills,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
          ...(chatOnly || promptPlan.exactSystemPrompt !== undefined
            ? {
                systemPrompt: " ",
                systemPromptOverride: () => undefined,
              }
            : {}),
          appendSystemPrompt,
          extensionFactories: [
            ...(promptPlan.exactSystemPrompt !== undefined
              ? [createExactSystemPromptExtension(() => promptPlan.exactSystemPrompt)] : []),
            ...(!chatOnly && promptPlan.exactSystemPrompt === undefined ? [createLocalFileLinkGuidanceExtension()] : []),
            ...(profile.loadExtensions ? [createAskUserExtension(), acceptancePlugin.extension(childCwd)] : []),
          ],
          ...(profile.loadExtensions ? { extensionsOverride: preferPiWebAskUserExtension } : {}),
        },
        ...((profile.loadExtensions || profile.loadSkills)
          ? { resourceLoaderReloadOptions: projectTrustReloadOptions(childCwd, agentDir) }
          : {}),
      });

      const extensionToolNames = profile.loadExtensions
        ? selectSubagentExtensionTools(
          services.resourceLoader.getExtensions().extensions,
          profile.extensionTools?.length ? profile.extensionTools : ["ext:*"],
          profile.disallowedExtensionTools,
        )
        : [];
      const activeTools = resolveShellTools(
        withSubagentExtensionTools(profile.tools, extensionToolNames),
        settingsManager.getDefaultTools(),
      );

      // Services may discover a new model/provider. Recheck the same bytes before making a child manager.
      const callModel = parseSubagentModel(parentModelRuntime, request.model);
      const profileModel = callModel ? undefined : parseSubagentModel(parentModelRuntime, profile.model);
      const model = (callModel ?? profileModel)?.model ?? parent.inner.model as ReturnType<ModelRuntime["getModel"]>;
      assertSubagentInputBudget(inputFiles, subagentInputLimits(model));
      const thinking = request.thinking ?? callModel?.thinkingLevel ?? profile.thinking
        ?? profileModel?.thinkingLevel ?? parent.inner.agent.state?.thinkingLevel;
      if (thinking && !SUBAGENT_THINKING_LEVELS.has(thinking as ThinkingLevel)) throw new Error(`Invalid subagent thinking level: ${thinking}`);
      const sessionManager = isolatedWorktree
        ? SessionManager.create(childCwd, undefined, { parentSession: parent.sessionFile })
        : SessionManager.create(parent.cwd, undefined, { parentSession: parent.sessionFile });
      const createdAt = new Date().toISOString();
      const metadata: SubagentMetadata = {
        version: 1,
        parentSessionId,
        parentSessionPath: parent.sessionFile,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: request.description.trim() || profile.displayName,
        task: request.task,
        runInBackground,
        createdAt,
        turnLimit: turnLimit ?? 0,
        resourceSnapshot: {
          version: 1,
          appendSystemPrompt: [...appendSystemPrompt],
          tools: [...activeTools],
          loadSkills: profile.loadSkills,
        loadExtensions: profile.loadExtensions,
        ...(promptPlan.exactSystemPrompt !== undefined ? { exactSystemPrompt: promptPlan.exactSystemPrompt } : {}),
        },
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };
      sessionManager.appendCustomEntry(SUBAGENT_META_TYPE, metadata);
      const inheritedAccounts = readSessionAccounts(parent.inner.sessionManager.getEntries() as SessionEntry[]);
      if (inheritedAccounts) appendSessionAccounts(sessionManager, inheritedAccounts);
      appendSessionModelSpeed(sessionManager, readSessionModelSpeed(parent.inner.sessionManager.getEntries() as SessionEntry[]));
      const speedAgent: { current?: Agent } = {};
      services.modelRuntime = withModelRuntimeAccess(services.modelRuntime,
        withSessionModelSpeed(services.modelRuntime, sessionManager, () => speedAgent.current));
      sessionManager.appendSessionInfo(metadata.description);

      const { session: inner } = await createAgentSessionFromServices({
        services,
        sessionManager,
        model,
        ...(thinking ? { thinkingLevel: thinking as ThinkingLevel } : {}),
        tools: activeTools,
        excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES],
      });
      unregisteredInner = inner;
      persistChildSession(sessionManager);
      speedAgent.current = inner.agent;
      dependencies.registerSession(inner, {
        ...(promptPlan.exactSystemPrompt !== undefined
          ? { exactSystemPrompt: promptPlan.exactSystemPrompt }
          : {}),
        chatOnly,
      });
      unregisteredInner = undefined;
      const wrapper = dependencies.getSession(inner.sessionId);
      if (!wrapper) throw new Error("Subagent session unavailable");

      const initialRun: SubagentRunInfo = {
        sessionId: inner.sessionId,
        runId: randomUUID(),
        turnLimit: turnLimit ?? 0,
        sessionPath: inner.sessionFile ?? sessionManager.getSessionFile() ?? "",
        parentSessionId,
        parentToolCallId: request.parentToolCallId,
        profile: profile.name,
        description: metadata.description,
        task: request.task,
        runInBackground,
        status: "queued",
        createdAt,
        ...(isolatedWorktree ? { worktreePath: isolatedWorktree.path, worktreeBranch: isolatedWorktree.branch } : {}),
      };

      return enqueueRun(initialRun, wrapper, delegatedTask, request.signal, request.onUpdate,
        () => cleanupWorktree(parent.cwd, isolatedWorktree));
    } catch (error) {
      try { unregisteredInner?.dispose(); } catch { /* Preserve the setup error. */ }
      if (isolatedWorktree) {
        try { await removeWorktree(parent.cwd, isolatedWorktree.path); } catch { /* preserve setup failure and avoid force deletion */ }
      }
      throw error;
    } finally { releaseRuntime(); }
  }

  async function resume(request: ResumeSubagentRequest): Promise<SubagentExecution> {
    const enabled = dependencies.isBuiltInSubagentsEnabled ?? isBuiltInSubagentsEnabled;
    if (!enabled()) throw new Error("Pi Web built-in sub-agents are disabled");
    const parentSessionId = request.parentContext.sessionManager.getSessionId();
    if (dependencies.getSession(parentSessionId)?.isPauseRequested?.()) throw new Error("Parent session is paused or pausing");
    const existing = await get(request.sessionId);
    if (!existing) throw new Error(`Subagent not found: ${request.sessionId}`);
    if (existing.parentSessionId !== parentSessionId) throw new Error("Subagent does not belong to this parent session");
    if (existing.status === "running" || existing.status === "queued") throw new Error("Subagent is already running");
    const parent = dependencies.getSession(parentSessionId);
    if (!parent?.isAlive()) throw new Error("Parent session is no longer available");
    const sessionPath = existing.sessionPath || await dependencies.resolveSessionPath(request.sessionId);
    if (!sessionPath || !existsSync(sessionPath)) throw new Error(`Subagent session file not found: ${request.sessionId}`);
    // Do not load child resources in a missing working folder on a cold reopen.
    assertSubagentDirectory(SessionManager.open(sessionPath).getCwd());
    let wrapper = dependencies.getSession(request.sessionId);
    if (!wrapper?.isAlive()) wrapper = await dependencies.reopenSession(request.sessionId, sessionPath);
    if (!wrapper.isAlive()) throw new Error("Subagent session is no longer available");
    if (wrapper.isRunning()) throw new Error("Subagent is already running");
    const pause = getSessionPause(request.sessionId);
    if (pause) removeSessionPause(request.sessionId, pause.id);
    wrapper.clearPause?.();
    if (wrapper.inner.sessionId !== request.sessionId) throw new Error("Subagent session ID changed during reopen");
    assertSubagentDirectory(wrapper.cwd);

    const runInBackground = request.runInBackground ?? existing.runInBackground;
    const initialRun: SubagentRunInfo = {
      ...existing,
      runId: randomUUID(),
      resumed: true,
      createdAt: new Date().toISOString(),
      parentToolCallId: request.parentToolCallId,
      task: request.task,
      description: request.description.trim() || existing.description,
      runInBackground,
      status: "queued",
      completedAt: undefined,
      result: undefined,
      error: undefined,
      worktreeCleanupError: undefined,
      worktreeExists: undefined,
    };
    // Resume never removes a retained checkout; it gets a fresh saved turn budget.
    return enqueueRun(initialRun, wrapper, request.task, request.signal, request.onUpdate, async () => undefined);
  }

  async function get(sessionId: string): Promise<SubagentRunInfo | null> {
    const stored = getSubagentRuns().get(sessionId);
    if (stored && (stored.run.status === "running" || stored.run.status === "queued")) return stored.run;
    // A write-failure record remains inspectable only while its wrapper/file still exist.
    if (stored && dependencies.getSession(sessionId)?.isAlive() && existsSync(stored.run.sessionPath)) return stored.run;
    if (stored) getSubagentRuns().delete(sessionId);
    const wrapper = dependencies.getSession(sessionId);
    if (wrapper?.isAlive()) {
      const run = readSubagentRun(
        wrapper.inner.sessionManager.getEntries() as unknown as SessionEntry[],
        sessionId,
        wrapper.sessionFile,
      );
      if (run && wrapper.isRunning()) return { ...run, status: "running" };
      if (run) return settleOrphanedSubagent(run);
    }
    const sessionPath = await dependencies.resolveSessionPath(sessionId);
    if (!sessionPath || !existsSync(sessionPath)) return null;
    const manager = SessionManager.open(sessionPath);
    if (manager.getSessionId() !== sessionId) return null;
    const run = readSubagentRun(manager.getEntries() as unknown as SessionEntry[], sessionId, sessionPath);
    return run && settleOrphanedSubagent(run);
  }

  async function steer(sessionId: string, message: string): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
    if (getSubagentRuns().get(sessionId)?.turnLimitReached) throw new Error("Subagent reached its turn limit and is stopping; resume it to continue");
    if (!message.trim()) throw new Error("Steering message is required");
    const releaseAdmission = wrapper.beginCheckoutPromptAdmission();
    try { await wrapper.inner.steer(message.trim()); }
    finally { releaseAdmission(); }
  }

  async function notifyParent(run: SubagentRunInfo): Promise<void> {
    expectNotification(run);
    try {
      if (takeResultConsumed(run)) return;
      const pauseIntent = run.status === "paused" || getSessionPause(run.sessionId) !== undefined || dependencies.getSession(run.sessionId)?.isPauseRequested?.() === true;
      let parent = dependencies.getSession(run.parentSessionId);
      // A cold paused parent receives this saved child result in its Resume prompt.
      if (!parent?.isAlive() && (pauseIntent || getSessionPause(run.parentSessionId))) return;
      if (!parent?.isAlive()) {
        const sessionFile = await dependencies.resolveSessionPath(run.parentSessionId);
        if (!sessionFile) throw new Error(`Parent session not found: ${run.parentSessionId}`);
        parent = await dependencies.reopenSession(run.parentSessionId, sessionFile);
      }
      await parent.waitUntilReady();
      // The parent may still be inside the `get_subagent_result` call that collects this result,
      // and `deliverAs: "followUp"` would only queue the message until that turn ends anyway.
      // Hold the notification until the parent is idle and re-check the mark, so a result the
      // parent already consumed never triggers a duplicate turn.
      while (parent.isAlive() && parent.isRunning() && !parent.isPauseRequested?.() && !pauseIntent) {
        if (takeResultConsumed(run)) return;
        await new Promise<void>((resolve) => { setTimeout(resolve, PARENT_IDLE_POLL_MS); });
      }
      if (takeResultConsumed(run)) return;
      if (!parent.isAlive()) throw new Error(`Parent session is no longer available: ${run.parentSessionId}`);
      await parent.inner.sendCustomMessage({
        customType: "pi-web:subagent-notification",
        content: subagentNotificationText(run),
        display: true,
        details: subagentToolDetails(run),
      }, parent.isPauseRequested?.() || pauseIntent ? { triggerTurn: false } : { deliverAs: "followUp", triggerTurn: true });
    } finally {
      const key = resultKey(run);
      if (key) getSubagentNotifications().delete(key);
    }
  }

  async function abort(sessionId: string): Promise<void> {
    const wrapper = dependencies.getSession(sessionId);
    const stored = getSubagentRuns().get(sessionId);
    if (stored?.run.status === "queued") {
      stored.abortRequested = true;
      if (!stored.cancelQueued?.()) throw new Error("Subagent is no longer queued");
      await stored.completion;
      return;
    }
    if (!wrapper?.isAlive() || !wrapper.isRunning()) throw new Error("Subagent is not running");
    if (stored) stored.abortRequested = true;
    await wrapper.inner.abort();
  }

  return {
    extensionRuntime: { start, resume, get, steer, notifyParent, markResultConsumed, expectNotification },
    get,
    steer,
    abort,
  };
}
