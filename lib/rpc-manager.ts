import type { Agent, AgentMessage as SdkAgentMessage, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, SessionManager, SettingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, writeFileSync } from "fs";
import { recordRunStart, recordRunSettlement } from "./session-run-recovery";
import { readActivityReview, recordActivityCompletion } from "./activity-review-server";
import { resolve } from "path";
import { validateAgentImages } from "./image-attachments";
import { getProjectAccounts, validateAccountSelection, type AccountSelection } from "./provider-accounts";
import { createAccountModelRuntime } from "./account-model-runtime";
import { abortModelRuntimeRefresh, acquireModelRuntimeUse, applySessionModelDefinition, assertModelRuntimeSessionReady, modelRuntimeRefreshState, pendingModelRuntimeRefresh, registerModelRuntimeSession, withModelRuntimeAccess } from "./session-model-refresh";
import { appendSessionAccounts, readSessionAccounts } from "./session-accounts";
import { isModelSpeed, supportsModelSpeed, type ModelSpeed } from "./model-speed";
import { appendSessionModelSpeed, readSessionModelSpeed } from "./session-model-speed";
import { appendNativeResourceSelection, readNativeResourceSelection, validateNativeResourceSelection, effectiveNativeResourceSelection, NO_NATIVE_RESOURCES, type NativeResourceSelection } from "./session-native-resources";
import { createNativeSessionTools, type NativeSessionTools } from "./native-session-tools";
import { withSessionModelSpeed } from "./session-model-speed-runtime";
import { samePath } from "./paths";
import { readSessionHeader } from "./session-reader";
import { SESSION_SPAWN_TYPE, sessionSpawnFromEntries } from "./session-spawn";
import { sessionLaunchHost } from "./session-launch-runtime";
import { invalidateModelsCache } from "./models-cache";
import { invalidateSettingsListingRuntime } from "./settings-listing-runtime";
import { resolveVisibleModels, selectInitialModelScope } from "./model-scope";
import {
  createProjectCommandBashExtension,
  createProjectCommandBashOperations,
  preferUserBashExtension,
} from "./project-command-env";
import { cacheSessionPath, getLatestModelChange, invalidateSessionListCache, readLatestSessionEntryId, resolveSessionPath } from "./session-reader";
import { getProjectTrustStatus, projectTrustReloadOptions } from "./project-trust";
import { persistExplicitStartupPreferences } from "./startup-preferences";
import { notifySessionComplete } from "./web-push";
import { hasActiveSessionLivenessProvider } from "./session-liveness";
import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AgentSessionLike, ExtensionUiContextLike, ToolInfo } from "./pi-types";
import type {
  BlockingExtensionUiRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
  ExtensionWidgetItem,
  SessionAttention,
  SessionCompletion,
  SessionEntry,
  SessionInfo,
  SessionMessageEntry,
} from "./types";
import { createHeadlessCustomUiTui, DEFAULT_CUSTOM_UI_COLUMNS, type HeadlessCustomUiTui } from "./custom-ui-terminal";
import {
  createSubagentExtension,
  preferPiWebSubagentExtension,
} from "./subagent-extension";
import {
  listSubagentProfiles,
  readSubagentRun,
  readSubagentSessionResources,
  SUBAGENT_CONTROL_TOOL_NAMES,
} from "./subagents";
import { createSubagentController, hasUnsettledSubagentExecution } from "./subagent-runtime";
import { isBuiltInSubagentsEnabled } from "./subagent-settings";
import { getSessionPause, readSessionPauses, requestSessionPause, changeSessionPause, type SessionPause } from "./session-pause";
import { installSessionPauseBoundary } from "./session-pause-boundary";
import { installSessionPauseIngress } from "./session-pause-ingress";
import { resolveShellTools } from "./powershell-settings";
import { CHAT_ONLY_RESOURCE_LOADER_OPTIONS, contextFilesSystemPrompt } from "./chat-only";
import { haveContextFilesChanged } from "./context-file-changes";
import { createExactSystemPromptExtension } from "./exact-system-prompt";
import { createAskUserExtension, preferPiWebAskUserExtension, type AskUserUiContext } from "./ask-user-extension";
import { parseQuestionSet } from "./question-set";
import { createSessionReferenceExtension } from "./session-reference-extension";
import { createPiWebSourceExtension } from "./pi-web-source-extension";
import { createLocalFileLinkGuidanceExtension } from "./local-file-link-guidance";
import { bundledPluginExtensions } from "./plugins/registry";
import { validatePluginCard } from "./plugins/ui";
import { preparePluginReview } from "./plugins/review-store";
import type { PluginUiContext } from "./plugins/types";
import { OPERATION_RECEIPT_TYPE, nextOperationReceiptSequence, snapshotOperationReceipt } from "./operation-receipts";
import { hasActiveTerminalWithin } from "./terminal-manager";
import { isPathWithinRoots, physicalDirectoryPath } from "./path-security";
import { acquireDirectoryReservation, assertDirectoryAdmissionAllowed } from "./directory-reservations";
import { isBlockingExtensionUiRequest } from "./browser-notifications";
import {
  INTERACTION_RECEIPT_TYPE, normalizeInteractionResponse, responseForExtension, snapshotInteractionRequest,
  type InteractionOutcome, type InteractionReceipt, type InteractionRequest, type InteractionResponse,
} from "./interaction-receipts";
import {
  appendClearedSessionToolSelection,
  appendSessionToolSelection,
  readSessionToolSelection,
  validateSessionToolSelection,
} from "./session-tool-selection";

// ============================================================================
// Types
// ============================================================================

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

type EventListener = (event: AgentEvent) => void;
type AgentRunCompleteListener = (sessionId: string) => void;

function attentionSummary(request: BlockingExtensionUiRequest): string {
  if (request.method === "custom") return "";
  if (request.method === "ask_user") return request.question.trim().replace(/\s+/g, " ").slice(0, 160);
  return request.title.trim().replace(/\s+/g, " ").slice(0, 160);
}

type PendingUiResponse = {
  resolve: (response: ExtensionUiResponse) => void;
  cancel: () => void;
};

type CustomUiComponent = {
  render: (width: number) => string[];
  handleInput?: (data: string) => void;
  dispose?: () => void;
  invalidate?: () => void;
};

type ExtensionWidgetComponent = {
  render: (width: number) => unknown;
  dispose?: () => void;
};

type ExtensionWidgetFactory = (tui: HeadlessCustomUiTui, theme: Theme) => unknown;

type ActiveExtensionWidget = {
  key: string;
  component: ExtensionWidgetComponent;
  placement: "aboveEditor" | "belowEditor";
  generation: number;
  clearEmitted: boolean;
  rendered: boolean;
};

type ActiveCustomUi = {
  component: CustomUiComponent;
  width: number;
  resolve: (value: unknown) => void;
  settled: boolean;
};

type ExtensionUiRequestBody = Record<string, unknown> & {
  method: ExtensionUiRequest["method"];
  timeout?: number;
  expiresAt?: number;
};

type ExtensionCommandContextActionsLike = {
  waitForIdle: () => Promise<void>;
  newSession: () => Promise<{ cancelled: boolean }>;
  fork: () => Promise<{ cancelled: boolean }>;
  navigateTree: (targetId: string, options?: { summarize?: boolean }) => Promise<{ cancelled: boolean }>;
  switchSession: () => Promise<{ cancelled: boolean }>;
  reload: () => Promise<void>;
};

type AgentSessionWrapperOptions = {
  initialPromptOwner?: symbol;
  exactSystemPrompt?: () => string;
  chatOnly?: boolean;
  monitorContextFiles?: boolean;
  nativeSessionTools?: NativeSessionTools;
  onAgentRunComplete?: AgentRunCompleteListener;
  suppressCompletionNotifications?: boolean;
};

const IDLE_RESET_EVENT_TYPES = new Set([
  "agent_end",
  "agent_settled",
  "auto_compaction_end",
  "compaction_end",
]);

const DEFAULT_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Resolves the PI_WEB_IDLE_TIMEOUT_MS environment variable into a session idle
 * timeout in milliseconds. An unset/blank value returns the 10-minute default,
 * `0` disables idle shutdown, and positive values up to Node's timer limit
 * (2147483647 ms) are used as-is. Invalid or out-of-range values fall back to
 * the default with a console warning.
 * @param rawValue Value to parse; defaults to the environment variable.
 */
export function resolveSessionIdleTimeoutMs(
  rawValue: string | undefined = process.env.PI_WEB_IDLE_TIMEOUT_MS,
): number {
  if (rawValue !== undefined && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 2_147_483_647) return parsed;
    console.warn(`[pi-web] invalid PI_WEB_IDLE_TIMEOUT_MS "${rawValue}", falling back to 10 minutes`);
  }
  return DEFAULT_SESSION_IDLE_TIMEOUT_MS;
}

const SESSION_IDLE_TIMEOUT_MS = resolveSessionIdleTimeoutMs();

/** Only refused, fresh launch-owned wrappers use this bounded cleanup budget. */
export const INITIAL_PROMPT_SHUTDOWN_GRACE_MS = 1000;

const SESSION_REPLACEMENT_COMMAND_TYPES = new Set(["clone"]);
const COMMANDS_ALLOWED_DURING_SESSION_REPLACEMENT = new Set([
  "get_state",
  "get_session_stats",
  "get_last_assistant_text",
  "get_tools",
  "get_commands",
  "extension_ui_response",
  "extension_ui_input",
]);

export interface RpcSessionStartOptions {
  /** Host-only, single-use exclusive admission for a fresh destination. Never wire data. */
  initialPromptOwner?: symbol;
  toolNames?: string[];
  nativeResources?: NativeResourceSelection;
  accounts?: AccountSelection;
  initialModel?: { provider: string; modelId: string };
  allowInitialModelFallback?: boolean;
  thinkingLevel?: ThinkingLevel;
  modelSpeed?: ModelSpeed;
  /** Inherited agent-launch preferences are session-local, not new user defaults. */
  persistPreferences?: boolean;
  /** Host-only observer for exact initial launch prompt validation after input handlers. */
  observePrompt?: (prompt: string) => void;
}

const CODING_TOOL_NAMES = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];
const THINKING_LEVEL_NAMES = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

// Extensions require a complete Theme, while the web UI applies its own styling.
class PlainTextTheme extends Theme {
  constructor() {
    super(
      { muted: "", text: "", thinkingXhigh: "", searchMatchText: "" } as ConstructorParameters<typeof Theme>[0],
      { selectedBg: "" } as ConstructorParameters<typeof Theme>[1],
      "truecolor",
    );
  }

  override fg(...[, text]: Parameters<Theme["fg"]>): string { return text; }
  override bg(...[, text]: Parameters<Theme["bg"]>): string { return text; }
  override bold(text: string): string { return text; }
  override italic(text: string): string { return text; }
  override underline(text: string): string { return text; }
  override inverse(text: string): string { return text; }
  override strikethrough(text: string): string { return text; }
  override getFgAnsi(): string { return ""; }
  override getBgAnsi(): string { return ""; }
  override getThinkingBorderColor(): (text: string) => string {
    return (text) => text;
  }
  override getBashModeBorderColor(): (text: string) => string { return (text) => text; }
}

const PLAIN_TEXT_THEME = new PlainTextTheme();
const CUSTOM_UI_KEYBINDINGS = new TuiKeybindingsManager(TUI_KEYBINDINGS);

export function withExtensionTools(session: AgentSessionLike, toolNames: string[]): string[] {
  if (toolNames.length === 0) return [];

  const codingToolNames = new Set(CODING_TOOL_NAMES);
  const selectedToolNames = resolveShellTools(toolNames, session.settingsManager.getDefaultTools());
  const extensionToolNames = session.getAllTools().filter((t) => !["hidden", "deferred", "codemode"].includes(t.exposure ?? "")).map((t) => t.name)
    .filter((name) => !codingToolNames.has(name));
  return [...new Set([...selectedToolNames, ...extensionToolNames])];
}

// ============================================================================
// AgentSessionWrapper
// Wraps AgentSession with the same interface the rest of the app expects
// ============================================================================

export class AgentSessionWrapper {
  // A Set, not an array: an SSE stream unsubscribes from inside emit() when it
  // closes on session_shutdown, and splicing an array mid-iteration made the
  // next stream miss that same event.
  private listeners = new Set<EventListener>();
  private activeToolEvents = new Map<string, AgentEvent>();
  private pendingUiResponses = new Map<string, PendingUiResponse>();
  private pendingUiRequests = new Map<string, AgentEvent>();
  private pendingUiStartedAt = new Map<string, number>();
  private activeCustomUis = new Map<string, ActiveCustomUi>();
  private extensionUiAbortController = new AbortController();
  private extensionStatuses = new Map<string, string>();
  private extensionWidgets = new Map<string, ExtensionWidgetItem>();
  private activeExtensionWidgets = new Map<string, ActiveExtensionWidget>();
  private extensionWidgetGenerations = new Map<string, number>();
  private extensionWidgetsResetting = false;
  private initialPrompt?: {
    owner: symbol; state: "pending" | "accepted" | "refused"; submitted: boolean;
    error?: unknown; refusal: Promise<never>; reject: (error: unknown) => void;
    settlePrompt?: (error: unknown) => void;
  };
  private ownedRetirement?: {
    completion: Promise<void>; resolve: () => void; reject: (error: unknown) => void;
  };
  private pendingPromptCount = 0;
  private activeMutatingCommands = 0;
  private sessionReplacement: "clone" | null = null;
  private agentRunNeedsCompletion = false;
  private pendingCheckoutAdmissions = 0;
  private promptAdmissionTail: Promise<void> = Promise.resolve();
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private readonly exactSystemPrompt?: () => string;
  private readonly chatOnly: boolean;
  private readonly monitorContextFiles: boolean;
  private readonly nativeSessionTools?: NativeSessionTools;
  private readonly onAgentRunComplete?: AgentRunCompleteListener;
  private readonly suppressCompletionNotifications: boolean;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private extensionShutdown: Promise<unknown> | null = null;
  private extensionsEnded = false;
  private forceShutdownOnIdle = false;
  private _alive = true;
  private pause?: SessionPause;
  private disposePauseBoundary?: () => void;
  private disposePauseIngress?: () => void;
  private sdkPrompts = 0;
  private sdkQueueAdmissions = 0;
  private initialRequestPermits = new Set<object>();
  private queuedInputOwed = false;
  private queuedInputObjects = new Set<SdkAgentMessage>();
  private parkedQueueSave?: Promise<void>;
  private queuedInputIds = new WeakMap<object, string>();
  private pendingChildHandoffs = new Map<string, { anchor: string | null; id: string }>();
  private subagentSettlementComplete = false;
  private pauseFailure?: string;
  private queueAdmissionWaiters = new Set<() => void>();
  private resumePermit = false;
  private resumeRequestError?: Error;
  private pendingResume?: { message: string; resolve: () => void; reject: (error: unknown) => void; error?: Error; observed?: boolean };
  private readonly releaseModelRuntime: () => void;

  constructor(
    public readonly inner: AgentSessionLike,
    options: AgentSessionWrapperOptions = {},
  ) {
    if (options.initialPromptOwner !== undefined) {
      let reject!: (error: unknown) => void;
      const refusal = new Promise<never>((_resolve, fail) => { reject = fail; });
      void refusal.catch(() => {});
      this.initialPrompt = { owner: options.initialPromptOwner, state: "pending", submitted: false, refusal, reject };
    }
    this.pause = getSessionPause(inner.sessionId);
    this.exactSystemPrompt = options.exactSystemPrompt;
    this.chatOnly = options.chatOnly ?? false;
    this.nativeSessionTools = options.nativeSessionTools;
    this.nativeSessionTools?.bindToolRegistry(name => this.inner.extensionRunner.getToolDefinition?.(name)?.execute);
    if (this.nativeSessionTools?.enabled) {
      // Native resources are fixed for this wrapper. The agent route replaces
      // the selected idle wrapper; SDK/extension callbacks cannot hot-reload it.
      inner.reload = async () => { throw new Error("Native session tools require explicit idle session replacement"); };
    }
    this.monitorContextFiles = options.monitorContextFiles ?? false;
    this.onAgentRunComplete = options.onAgentRunComplete;
    this.suppressCompletionNotifications = options.suppressCompletionNotifications ?? false;
    this.releaseModelRuntime = registerModelRuntimeSession(inner,
      (requester) => this.isRunning() || this.activeMutatingCommands > (requester === inner ? 1 : 0)
        || Boolean(this.shutdownPromise) || (!this.chatOnly && !this.extensionsBound),
      () => this._alive && !this.shutdownPromise, () => this.persistSessionWithoutAssistant(), () => {
        try { this.finishPause(); }
        catch (error) { this.pauseFailed(error); }
      });
  }

  get sessionId(): string {
    return this.inner.sessionId;
  }

  get sessionFile(): string {
    return this.inner.sessionFile ?? "";
  }

  get cwd(): string {
    return this.inner.sessionManager.getCwd();
  }

  get streamingMessage() {
    return this.inner.agent.state?.streamingMessage;
  }

  get isStreaming(): boolean {
    return this.inner.isStreaming;
  }

  isAlive(): boolean {
    return this._alive;
  }

  isRunning(): boolean {
    return this._alive && (hasUnsettledSubagentExecution(this.sessionId) || this.initialPrompt?.state === "pending" || this.pendingPromptCount > 0 || this.pendingCheckoutAdmissions > 0 || this.sdkPrompts > 0 || this.sdkQueueAdmissions > 0 || this.parkedQueueSave !== undefined || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning
      || Boolean(this.inner.modelRuntime && modelRuntimeRefreshState(this.inner.modelRuntime).refreshing));
  }

  onSubagentSettled(): void { this.notifyAgentRunCompleteIfIdle(); }

  getPauseError(): string | undefined { return this.pauseFailure; }

  pauseFailed(error: unknown): void {
    this.pauseFailure = String(error).slice(0, 1000);
    if (this.pause) {
      try { this.pause = changeSessionPause(this.sessionId, this.pause.id, (row) => { row.error = this.pauseFailure; if (row.state === "paused") row.state = "pausing"; }); }
      catch (failure) { console.error("[pi-web] could not persist pause failure:", failure); }
    }
    this.emit({ type: "pause_error", errorMessage: this.pauseFailure });
  }

  clearPause(expectedId?: string): void {
    if (expectedId !== undefined && this.pause?.id !== expectedId) return;
    this.pause = undefined;
    this.subagentSettlementComplete = false;
    this.resumeRequestError = undefined;
    this.pauseFailure = undefined;
    if (this.extensionUiAbortController.signal.aborted) this.extensionUiAbortController = new AbortController();
  }

  isPauseRequested(): boolean {
    return Boolean(this.pause && (this.pause.state !== "resuming" || !this.pendingResume?.observed));
  }

  requestPause(parentSessionId?: string): SessionPause {
    this.assertInitialPromptAccess("pause");
    this.pause = requestSessionPause(this.sessionId, parentSessionId);
    this.pauseFailure = undefined;
    if (this.pause.error) this.pause = changeSessionPause(this.sessionId, this.pause.id, (row) => { delete row.error; });
    this.pendingResume?.reject(new Error("Resume superseded by a new Pause request"));
    // Save first: cancellation must never destroy the only copy of a waiting card.
    for (const request of this.pendingUiRequests.values()) this.capturePauseWaiting(request);
    this.extensionUiAbortController.abort(new DOMException("Waiting card cancelled by Pause; ask again after Resume", "AbortError"));
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.finishPause();
    return this.pause;
  }

  private capturePauseWaiting(request: unknown): void {
    if (!this.pause) return;
    const snapshot = JSON.stringify(request);
    this.pause = changeSessionPause(this.sessionId, this.pause.id, (row) => {
      if (!row.waiting.includes(snapshot)) row.waiting.push(snapshot);
    });
  }

  /** Children settle only after their partial result and retention record are saved. */
  finishPause(childSettled = false): void {
    if (childSettled) this.subagentSettlementComplete = true;
    childSettled ||= this.subagentSettlementComplete;
    if (!this.isPauseRequested() || this.pause?.state === "paused" || this.pauseFailure || this.pause?.error) return;
    const inputBusy = this.pendingPromptCount > 0 || this.pendingCheckoutAdmissions > 0 || this.sdkPrompts > 0 || this.sdkQueueAdmissions > 0
      || this.parkedQueueSave !== undefined || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning
      || Boolean(this.inner.modelRuntime && modelRuntimeRefreshState(this.inner.modelRuntime).refreshing);
    if (childSettled ? inputBusy : this.isRunning()) return;
    if (this.hasQueuedPauseInput()) {
      void this.settleIdlePauseInput().then(() => this.finishPause(childSettled), (error) => {
        console.error("[pi-web] could not save idle pause input:", error);
        this.pauseFailed(error);
      });
      return;
    }
    if (!childSettled && readSubagentRun(this.inner.sessionManager.getEntries() as unknown as SessionEntry[], this.sessionId, this.sessionFile)) return;
    try {
      this.pause = changeSessionPause(this.sessionId, this.pause!.id, (row) => {
        row.state = "paused"; row.pausedAt = Date.now(); row.leafId = this.inner.sessionManager.getLeafId() ?? undefined; delete row.error;
      });
    } catch (error) { this.pauseFailed(error); if (childSettled) throw error; return; }
    this.pauseFailure = undefined;
    this.agentRunNeedsCompletion = false;
    this.emit({ type: "session_paused" });
  }

  async resumeFromPause(message: string, pauseId: string): Promise<void> {
    const record = getSessionPause(this.sessionId);
    if (!record || record.id !== pauseId || record.state !== "resuming") throw new Error("Pause changed before Resume");
    if (this.activeMutatingCommands) throw new Error("Another session command is still pending; retry Resume after it settles");
    this.pause = record;
    let resolve!: () => void, reject!: (error: unknown) => void;
    const persisted = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    void persisted.catch(() => {});
    const attempt = { message, resolve, reject };
    this.pendingResume = attempt;
    this.resumeRequestError = undefined;
    this.resumePermit = true;
    const unsubscribe = this.onEvent((event) => {
      if (event.type === "prompt_error" || event.type === "prompt_done") {
        this.checkResumePersistence();
        reject(new Error(String(event.errorMessage ?? "Resume did not persist its literal continuation")));
      }
    });
    try {
      const sending = this.send({ type: "prompt", message }, { literal: true, pauseId, validate: (disposition) => {
        const current = getSessionPause(this.sessionId);
        if (!current || current.id !== pauseId || current.state !== "resuming") throw new Error("Pause changed before Resume admission");
        if (record.leafId && !this.inner.sessionManager.getBranch().some((entry) => entry.id === record.leafId)) throw new Error("The active branch changed before Resume dispatch");
        if (disposition !== undefined && disposition !== "started") throw new Error("Resume was intercepted or queued; pause information was retained");
      } });
      await Promise.all([sending, persisted]);
      this.clearPause(pauseId);
    } finally {
      unsubscribe(); this.resumePermit = false;
      if (this.pendingResume === attempt) this.pendingResume = undefined;
    }
  }

  private checkResumePersistence(): void {
    const attempt = this.pendingResume;
    if (!attempt?.observed || attempt.error) return;
    const manager = this.inner.sessionManager;
    if (this.sessionFile && readLatestSessionEntryId(this.sessionFile) === manager.getLeafId()) attempt.resolve();
  }

  /** Race host setup/binding against permanent owned refusal; observe late work. */
  waitForInitialPrompt<T>(owner: symbol, work: Promise<T>): Promise<T> {
    const initial = this.initialPrompt;
    if (!initial || initial.owner !== owner) throw new Error("Invalid initial prompt capability");
    return Promise.race([work, initial.refusal]);
  }

  /** Publish before callbacks can reenter startup on the same SDK identity. */
  private publishResourceRetirement(): void {
    if (this.ownedRetirement) return;
    let resolve!: () => void, reject!: (error: unknown) => void;
    const completion = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    this.ownedRetirement = { completion, resolve, reject };
    const retirements = getOwnedRetirements();
    const sdkId = this.sessionId;
    const previous = retirements.get(sdkId);
    const barrier = previous ? Promise.all([previous, completion]).then(() => {}) : completion;
    retirements.set(sdkId, barrier);
    void barrier.then(() => {
      if (retirements.get(sdkId) === barrier) retirements.delete(sdkId);
    }, () => { /* A failed public disposal permanently blocks same-ID reuse. */ });
  }

  /** Retire only an unaccepted destination owned by this launch, never an ordinary wrapper. */
  refuseInitialPrompt(owner: symbol, error: unknown): boolean {
    const initial = this.initialPrompt;
    if (!initial || initial.owner !== owner || initial.state !== "pending") return false;
    this.publishResourceRetirement();
    initial.state = "refused";
    initial.error = error;
    initial.reject(error);
    initial.settlePrompt?.(error);
    this.destroyInternal(true);
    invalidateSessionListCache();
    return true;
  }

  private assertInitialPromptAccess(type: string, owner?: symbol): void {
    const initial = this.initialPrompt;
    if (initial?.state === "refused") throw initial.error;
    if (!this._alive) throw new Error("Session is unavailable");
    if (this.shutdownPromise && !this.sessionReplacement && !COMMANDS_ALLOWED_DURING_SESSION_REPLACEMENT.has(type) && type !== "abort") {
      throw new Error("Session is shutting down");
    }
    if (owner !== undefined && (!initial || initial.owner !== owner || initial.state !== "pending")) {
      throw new Error("Invalid or consumed initial prompt capability");
    }
    if (initial?.state === "pending" && !COMMANDS_ALLOWED_DURING_SESSION_REPLACEMENT.has(type)
      && !(type === "prompt" && owner === initial.owner)) {
      throw new Error("Session initial prompt is exclusively owned by its launch");
    }
  }

  /** Direct subagent prompts bypass send(); keep their OWN session busy during preflight. */
  beginCheckoutPromptAdmission(): () => void {
    this.assertInitialPromptAccess("prompt");
    if (this.isPauseRequested()) throw new Error("Session is paused; continue through its main session");
    assertModelRuntimeSessionReady(this.inner);
    assertDirectoryAdmissionAllowed(this.cwd);
    this.pendingCheckoutAdmissions += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingCheckoutAdmissions = Math.max(0, this.pendingCheckoutAdmissions - 1);
      this.notifyAgentRunCompleteIfIdle();
    };
  }

  getPendingAttention(): SessionAttention | null {
    if (!this._alive) return null;
    const requests = [...this.pendingUiRequests.entries()]
      .filter(([, event]) => isBlockingExtensionUiRequest(event as ExtensionUiRequest));
    if (requests.length === 0) return null;
    const [id, event] = requests.sort(([a], [b]) =>
      (this.pendingUiStartedAt.get(a) ?? 0) - (this.pendingUiStartedAt.get(b) ?? 0))[0];
    const request = event as ExtensionUiRequest;
    if (!isBlockingExtensionUiRequest(request)) return null;
    return {
      sessionId: this.sessionId,
      requestId: id,
      method: request.method,
      summary: attentionSummary(request),
      since: this.pendingUiStartedAt.get(id) ?? Date.now(),
    };
  }

  /**
   * Drop this idle wrapper when the on-disk JSONL has an entry the in-memory
   * index never saw (another pi process appended). Rechecks isRunning() so a
   * prompt that started during the probe cannot be disposed.
   */
  evictIfDiskAhead(): boolean {
    if (!this.isAlive() || this.isRunning() || this.activeMutatingCommands > 0) return false;
    const diskLatestId = readLatestSessionEntryId(this.sessionFile);
    if (!diskLatestId || this.inner.sessionManager.getEntry(diskLatestId)) return false;
    if (this.isRunning() || this.activeMutatingCommands > 0) return false;
    this.destroy();
    invalidateSessionListCache();
    return true;
  }

  isChatOnly(): boolean {
    return this.chatOnly;
  }

  hasNativeSessionTools(): boolean { return this.nativeSessionTools?.enabled ?? false; }

  /** Persist setup-only intent without fabricating a message or changing SDK ID. */
  saveNativeResourceIntent(selection: NativeResourceSelection): void {
    this.assertInitialPromptAccess("set_native_resources");
    if (this.isRunning()) throw new Error("Cannot change native resources while this session is running");
    if (!this.inner.sessionManager.isPersisted() || !this.sessionFile) throw new Error("Native tools require a persistent session");
    appendNativeResourceSelection(this.inner.sessionManager, selection);
    this.persistSessionWithoutAssistant();
  }

  hasSuppressedCompletionNotifications(): boolean {
    return this.suppressCompletionNotifications;
  }

  /** Child pause records are a durable handoff even if an in-memory background
   * notification was lost at restart. Reconcile on explicit main-session input.
   */
  private async preparePausedChildContext(): Promise<void> {
    const manager = this.inner.sessionManager;
    if (readSubagentRun(manager.getEntries() as unknown as SessionEntry[], this.sessionId, this.sessionFile)) return;
    for (const pause of readSessionPauses().filter((row) => row.parentSessionId)) {
      if (hasUnsettledSubagentExecution(pause.sessionId)) continue;
      const child = await SUBAGENT_CONTROLLER.get(pause.sessionId);
      if (!child) continue;
      let parentId = child.parentSessionId;
      const visited = new Set<string>();
      while (parentId !== this.sessionId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = await SUBAGENT_CONTROLLER.get(parentId);
        if (!parent) break;
        parentId = parent.parentSessionId;
      }
      if (parentId !== this.sessionId) continue;
      const branch = manager.getBranch();
      if (branch.some((entry) => entry.type === "custom_message" && entry.customType === "pi-web:paused-subsession-context"
        && (entry.details as { pauseId?: unknown } | undefined)?.pauseId === pause.id)) { this.pendingChildHandoffs.delete(pause.id); continue; }
      const pending = this.pendingChildHandoffs.get(pause.id);
      if (pending && (pending.anchor === null || branch.some((entry) => entry.id === pending.anchor))) continue;
      const handoff = { anchor: manager.getLeafId(), id: randomUUID() };
      this.pendingChildHandoffs.set(pause.id, handoff);
      try { await this.inner.sendCustomMessage({ customType: "pi-web:paused-subsession-context", display: true,
        content: `The following is saved information about a paused subsession, not a new user goal or permission. Inspect recorded outcomes before deciding whether more delegated work is needed.\nSession: ${child.sessionId}\nDescription: ${child.description}\nOriginal task: ${child.task}\n${pause.state === "pausing" ? "Pause was not confirmed before restart; outcomes may be unknown.\n" : "The subsession was paused, not completed.\n"}${child.result ? `Partial output:\n${child.result}\n` : "Inspect the saved transcript/tool results for partial work.\n"}${pause.waiting.length ? `Cancelled waiting cards (ask again; never reuse an old approval):\n${pause.waiting.join("\n\n")}` : ""}`,
        details: { pauseId: pause.id, childSessionId: child.sessionId, handoffId: handoff.id },
      }, { triggerTurn: false }); }
      catch (error) { if (this.pendingChildHandoffs.get(pause.id)?.id === handoff.id) this.pendingChildHandoffs.delete(pause.id); throw error; }
    }
  }

  hasQueuedPauseInput(): boolean {
    return Boolean((this.inner.agent as Agent | undefined)?.hasQueuedMessages?.());
  }

  /** A steering admission can complete after its old SDK run became idle. Save
   * the real undelivered envelopes as context, never certify then lose images.
   * Snapshot/write/clear is synchronous; only the final SDK context refresh awaits.
   */
  private settleIdlePauseInput(): Promise<void> {
    if (this.parkedQueueSave) return this.parkedQueueSave;
    if (!this.isPauseRequested() || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning || !this.hasQueuedPauseInput()) return Promise.resolve();
    const work = (async () => {
      const agent = this.inner.agent as Agent;
      const manager = this.inner.sessionManager;
      while (this.isPauseRequested() && !this.inner.isStreaming && !this.inner.isCompacting && !this.inner.isBashRunning && agent.hasQueuedMessages()) {
        const save = (message: SdkAgentMessage) => {
          if (message.role !== "user" && message.role !== "custom") throw new Error("Unsupported idle queue envelope; pause remains unconfirmed");
          const content = typeof message.content === "string" ? [{ type: "text" as const, text: message.content }] : message.content;
          if (content.some((part) => part.type !== "text" && part.type !== "image")) throw new Error("Unsupported queued content; pause remains unconfirmed");
          let inputId = this.queuedInputIds.get(message);
          if (!inputId) { inputId = randomUUID(); this.queuedInputIds.set(message, inputId); }
          const exists = manager.getBranch().some((entry) => entry.type === "custom_message" && entry.customType === "pi-web:undelivered-input"
            && (entry.details as { inputId?: unknown } | undefined)?.inputId === inputId);
          if (!exists) manager.appendCustomMessageEntry("pi-web:undelivered-input", [
            { type: "text", text: `Accepted ${message.role} input was saved without processing it before Pause. Review it on explicit continuation; this is context, not permission to replay an operation.` },
            ...content,
          ], true, { inputId, originalRole: message.role });
          this.persistSessionWithoutAssistant();
          if (readLatestSessionEntryId(this.sessionFile) !== manager.getLeafId()) throw new Error("Queued input persistence was not confirmed");
          this.capturePauseWaiting({ method: "undelivered_input", inputId, sessionFile: this.sessionFile,
            text: content.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
            note: "Any image envelopes remain in the saved session context; inspect before continuing." });
        };
        const steeringMode = agent.steeringMode, followUpMode = agent.followUpMode;
        const seen = new Set<SdkAgentMessage>();
        try {
          agent.steeringMode = "all"; agent.followUpMode = "all";
          for (const message of agent.peekQueuedMessages()) { save(message); seen.add(message); }
          agent.clearSteeringQueue();
          for (const message of agent.peekQueuedMessages()) if (!seen.has(message)) save(message);
          agent.clearFollowUpQueue();
          this.inner.clearQueue();
        } finally { agent.steeringMode = steeringMode; agent.followUpMode = followUpMode; }
        await this.inner.sendCustomMessage({ customType: "pi-web:pause-input-saved", display: true,
          content: "Undelivered accepted input was saved in this conversation without executing it. Review it after Resume." }, { triggerTurn: false });
        invalidateSessionListCache();
      }
    })();
    const settled = work.catch((error) => { this.pauseFailed(error); throw error; })
      .finally(() => { if (this.parkedQueueSave === settled) this.parkedQueueSave = undefined; });
    this.parkedQueueSave = settled;
    return settled;
  }

  private hasAdmittedPauseInput(agent: Agent): boolean {
    return this.initialRequestPermits.size > 0 || this.sdkQueueAdmissions > 0 || agent.hasQueuedMessages() || this.queuedInputOwed;
  }

  private waitForQueueAdmissions(signal?: AbortSignal): Promise<void> {
    if (!this.sdkQueueAdmissions || signal?.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { signal?.removeEventListener("abort", done); this.queueAdmissionWaiters.delete(done); resolve(); };
      this.queueAdmissionWaiters.add(done); signal?.addEventListener("abort", done, { once: true });
      if (signal?.aborted) done();
    });
  }

  private installPauseHooks(): void {
    if (!this.inner.agent) return;
    this.disposePauseIngress = installSessionPauseIngress(this.inner, {
      blocked: () => Boolean(this.pause),
      takeResumePermit: (text) => {
        if (!this.resumePermit || text !== this.pendingResume?.message) return false;
        this.resumePermit = false; return true;
      },
      begin: (initiallyQueued) => {
        const permit = {};
        let queued = initiallyQueued;
        const add = () => { if (queued) this.sdkQueueAdmissions++; else { this.sdkPrompts++; this.initialRequestPermits.add(permit); } };
        const remove = () => { this.initialRequestPermits.delete(permit); if (queued) this.sdkQueueAdmissions--; else this.sdkPrompts--; };
        const wake = () => { if (!this.sdkQueueAdmissions) { for (const done of this.queueAdmissionWaiters) done(); this.queueAdmissionWaiters.clear(); } };
        add();
        return {
          setQueued: (next) => { if (next === queued) return; remove(); queued = next; add(); wake(); },
          release: () => { remove(); wake(); this.notifyAgentRunCompleteIfIdle(); },
        };
      },
      settle: () => this.settleIdlePauseInput(),
    });
    const agent = this.inner.agent as Agent;
    const previousSteer = agent.steer, previousFollowUp = agent.followUp, previousClear = agent.clearAllQueues;
    const steer: typeof agent.steer = (message) => { this.queuedInputObjects.add(message); previousSteer.call(agent, message); };
    const followUp: typeof agent.followUp = (message) => { this.queuedInputObjects.add(message); previousFollowUp.call(agent, message); };
    const clear: typeof agent.clearAllQueues = () => { this.queuedInputObjects.clear(); previousClear.call(agent); };
    agent.steer = steer; agent.followUp = followUp; agent.clearAllQueues = clear;
    const previousPrepareRequest = agent.prepareRequest;
    const previousContinue = agent.continue;
    const continueAgent: typeof agent.continue = async () => {
      if (this.isPauseRequested() && !this.hasAdmittedPauseInput(agent)) {
        void this.inner.abort().catch((error) => console.error("[pi-web] pause continuation stop failed:", error));
        return;
      }
      return previousContinue.call(agent);
    };
    agent.continue = continueAgent;
    const prepareRequest: NonNullable<typeof agent.prepareRequest> = async (context, signal) => {
      if (this.resumeRequestError) {
        // Reject before the provider, and suppress the session's outer recovery loop.
        void this.inner.abort().catch((error) => console.error("[pi-web] rejected Resume stop failed:", error));
        throw this.resumeRequestError;
      }
      const update = (await previousPrepareRequest?.(context, signal)) ?? undefined;
      if (this.isPauseRequested() && !this.initialRequestPermits.size) await this.waitForQueueAdmissions(signal);
      if (this.isPauseRequested() && !this.hasAdmittedPauseInput(agent)) {
        void this.inner.abort().catch((error) => console.error("[pi-web] pause request stop failed:", error));
        throw new Error("Paused before the next model request");
      }
      const permit = this.initialRequestPermits.values().next().value;
      if (permit) this.initialRequestPermits.delete(permit);
      this.queuedInputOwed = false;
      return update;
    };
    agent.prepareRequest = prepareRequest;
    const disposeIngress = this.disposePauseIngress;
    this.disposePauseIngress = () => {
      disposeIngress();
      if (agent.prepareRequest === prepareRequest) agent.prepareRequest = previousPrepareRequest;
      if (agent.continue === continueAgent) agent.continue = previousContinue;
      if (agent.steer === steer) agent.steer = previousSteer;
      if (agent.followUp === followUp) agent.followUp = previousFollowUp;
      if (agent.clearAllQueues === clear) agent.clearAllQueues = previousClear;
    };
    this.disposePauseBoundary = installSessionPauseBoundary(this.inner, () => this.isPauseRequested(), (error) => {
      console.error("[pi-web] pause stop failed:", error); this.pauseFailed(error);
    }, () => this.waitForQueueAdmissions());
  }

  start(): void {
    this.installPauseHooks();
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "message_start" && event.message && this.queuedInputObjects.delete(event.message as SdkAgentMessage)) this.queuedInputOwed = true;
      if (event.type === "message_end") {
        const message = event.message as { role?: string; customType?: string; details?: { pauseId?: string; handoffId?: string } } | undefined;
        const details = message?.details;
        if (message?.role === "custom" && message.customType === "pi-web:paused-subsession-context" && details?.pauseId && details.handoffId) {
          queueMicrotask(() => {
            if (this.pendingChildHandoffs.get(details.pauseId!)?.id !== details.handoffId) return;
            const saved = this.inner.sessionManager.getEntries().some((entry) => entry.type === "custom_message" && entry.customType === message.customType
              && (entry.details as { handoffId?: unknown } | undefined)?.handoffId === details.handoffId);
            if (saved) this.pendingChildHandoffs.delete(details.pauseId!);
          });
        }
      }
      if (event.type === "agent_start") this.agentRunNeedsCompletion = true;
      if (event.type === "agent_end") {
        invalidateSessionListCache();
      }
      const toolCallId = event.toolCallId;
      // Live tool events are UI replay state, never repository admission.
      if (typeof toolCallId === "string" && toolCallId) {
        if (event.type === "tool_execution_end") this.activeToolEvents.delete(toolCallId);
        else if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
          this.activeToolEvents.set(toolCallId, event);
        }
      }
      if (IDLE_RESET_EVENT_TYPES.has(event.type)) this.resetIdleTimer();
      const message = event.message as { role?: string } | undefined;
      if (event.type === "message_end" && message && ["user", "assistant", "toolResult", "system"].includes(message.role ?? "")) {
        // The SDK notifies public listeners immediately BEFORE appending this
        // message. Its synchronous append finishes before this microtask runs.
        // Bind by object identity, never by text or a possibly unrelated leaf.
        queueMicrotask(() => {
          if (!this.isAlive()) return;
          if (message.role === "user" && this.pendingResume) {
            const content = (event.message as { content?: unknown }).content;
            const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((part) => part?.type === "text").map((part) => part.text).join("\n") : "";
            if (text === this.pendingResume.message) this.pendingResume.observed = true;
            else {
              this.pendingResume.error = new Error("An extension changed the Resume message; pause information was retained");
              this.resumeRequestError = this.pendingResume.error;
              this.pendingResume.reject(this.pendingResume.error);
            }
          }
          this.checkResumePersistence();
          const leaf = this.inner.sessionManager.getLeafEntry();
          this.emit(leaf?.type === "message" && leaf.message === event.message
            ? { ...event, entryId: leaf.id }
            : event);
        });
      } else {
        this.emit(event);
      }
      if (event.type === "agent_settled") this.notifyAgentRunCompleteIfIdle();
    });
    this.resetIdleTimer();
  }

  private notifyAgentRunCompleteIfIdle(): void {
    if (this.isPauseRequested()) {
      this.finishPause();
      return;
    }
    if (!this.agentRunNeedsCompletion || this.isRunning()) return;
    this.agentRunNeedsCompletion = false;
    recordRpcSessionCompletion(this.sessionId);
    if (this.suppressCompletionNotifications) return;
    try {
      this.onAgentRunComplete?.(this.sessionId);
    } catch (error) {
      console.error("[pi-web] completion listener failed:", error instanceof Error ? error.message : error);
    }
  }

  beginExtensionBinding(): void {
    void this.ensureExtensionsBound().catch((err) => {
      console.error("[pi-web] failed to dispatch session_start to extensions:", err instanceof Error ? err.message : err);
    });
  }

  async waitUntilReady(): Promise<void> {
    await this.waitForExtensionsBound();
  }

  private ensureExtensionsBound(): Promise<void> {
    if (this.extensionsBound) return Promise.resolve();
    if (this.extensionBindingPromise) return this.extensionBindingPromise;

    this.extensionBindingError = null;
    const releaseRuntime = this.inner.modelRuntime ? acquireModelRuntimeUse(this.inner.modelRuntime) : () => {};
    this.extensionBindingPromise = (async () => {
      if (!this._alive) return;
      const uiContext = this.createExtensionUiContext();
      if (typeof this.inner.bindExtensions === "function") {
        const bindExtensions = this.inner.bindExtensions as (bindings: {
          uiContext?: ExtensionUiContextLike;
          mode?: "rpc";
          commandContextActions?: ExtensionCommandContextActionsLike;
          shutdownHandler?: () => void;
          onError?: (error: { extensionPath: string; event: string; error: string }) => void;
        }) => Promise<void>;
        await bindExtensions.call(this.inner, {
          uiContext,
          mode: "rpc",
          commandContextActions: this.createExtensionCommandContextActions(),
          shutdownHandler: () => this.emit({
            type: "extension_ui_request",
            id: randomUUID(),
            method: "notify",
            notifyType: "warning",
            message: "Extension requested shutdown, but shutdown is not supported in Pi Web.",
          } as ExtensionUiRequest as AgentEvent),
          onError: (error) => this.emit({
            type: "extension_error",
            extensionPath: error.extensionPath,
            event: error.event,
            error: error.error,
          }),
        });
      } else {
        this.inner.extensionRunner.setUIContext?.(uiContext, "rpc");
      }
      this.extensionsBound = true;
      console.log(`[pi-web] session_start dispatched to extensions for session ${this.inner.sessionId}`);
    })().catch((err) => {
      this.extensionBindingError = err;
      throw err;
    }).finally(releaseRuntime);

    return this.extensionBindingPromise;
  }

  private async waitForExtensionsBound(): Promise<void> {
    try {
      if (this.extensionBindingPromise) await this.extensionBindingPromise;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    if (this.extensionBindingError) {
      throw this.extensionBindingError instanceof Error
        ? this.extensionBindingError
        : new Error(String(this.extensionBindingError));
    }
  }

  private shouldWaitForExtensions(type: string): boolean {
    return type === "prompt"
      || type === "steer"
      || type === "follow_up"
      || type === "get_commands"
      || type === "get_state";
  }

  private async withFinalIdleReset<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } finally {
      this.resetIdleTimer();
      this.finishPause();
    }
  }

  setActiveToolSelection(toolNames: string[]): void {
    assertModelRuntimeSessionReady(this.inner);
    this.inner.setActiveToolsByName(withExtensionTools(this.inner, toolNames));
  }

  private emit(event: AgentEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(
          `[pi-web] failed to deliver ${event.type} event:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  private async acquirePromptAdmission(): Promise<() => void> {
    const previous = this.promptAdmissionTail;
    let release!: () => void;
    this.promptAdmissionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    return release;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!this._alive) return;
    // A resolved timeout of 0 disables idle shutdown entirely.
    if (SESSION_IDLE_TIMEOUT_MS === 0) return;
    if (!this.isRunning()) this.forceShutdownOnIdle = false;
    this.idleTimer = setTimeout(() => {
      if (!this.forceShutdownOnIdle && (this.isRunning() || hasActiveSessionLivenessProvider({
        sessionId: this.sessionId,
        sessionFile: this.sessionFile || undefined,
      }))) {
        this.resetIdleTimer();
        return;
      }
      void this.shutdown().catch((error) => {
        console.error("[pi-web] failed to shut down idle session:", error instanceof Error ? error.message : error);
      });
    }, SESSION_IDLE_TIMEOUT_MS);
  }

  recordSpawnOrigin(creatorSessionId: string, operationId: string): void {
    this.inner.sessionManager.appendCustomEntry(SESSION_SPAWN_TYPE, {
      version: 1, sessionId: this.sessionId, creatorSessionId, operationId,
    });
    this.persistSessionWithoutAssistant();
    invalidateSessionListCache();
  }

  private persistSessionWithoutAssistant(): void {
    const manager = this.inner.sessionManager;
    const sessionFile = manager.getSessionFile();
    if (!sessionFile || existsSync(sessionFile)) return;

    const header = manager.getHeader();
    if (!header) return;

    const content = [header, ...manager.getEntries()]
      .map((entry) => JSON.stringify(entry))
      .join("\n") + "\n";
    writeFileSync(sessionFile, content, { encoding: "utf8", flag: "wx" });

    // Pi normally delays the first flush until an assistant message exists.
    // A leading shell command or completed extension dialog has no assistant
    // message, so mark this SDK manager as flushed after writing its own entries.
    (manager as unknown as { flushed: boolean }).flushed = true;
    cacheSessionPath(this.inner.sessionId, sessionFile);
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    for (const event of this.pendingUiRequests.values()) listener(event);
    for (const event of this.activeToolEvents.values()) listener(event);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onDestroy(cb: () => void): void {
    this.onDestroyCallback = cb;
  }

  private async withSessionReplacement<T>(
    replacement: "clone",
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.sessionReplacement) throw new Error("Session is already being copied");
    this.sessionReplacement = replacement;
    try {
      return await operation();
    } finally {
      if (this._alive) this.sessionReplacement = null;
    }
  }

  private isSessionRunningForReplacement(): boolean {
    return this.inner.isBashRunning
      || this.inner.isStreaming
      || this.inner.isCompacting
      || this.pendingPromptCount > 0;
  }

  private async shutdownAfterSessionReplacement(replacement: "clone"): Promise<void> {
    try {
      await this.shutdown();
    } catch (error) {
      console.error(
        `[pi-web] ${replacement} succeeded, but source session shutdown failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  async send(command: Record<string, unknown>, promptGuard?: { validate: (disposition?: string) => void; literal?: boolean; owner?: symbol; pauseId?: string }): Promise<unknown> {
    const type = command.type as string;
    if (type === "navigate_tree" && (this.pendingResume || this.pause && this.isRunning())) throw new Error("Cannot change branches during Resume or Pause settlement");
    if (["prompt", "steer", "follow_up"].includes(type) && this.pause && promptGuard?.pauseId !== this.pause.id) {
      throw new Error("Session is paused or pausing; use Resume on the main session");
    }
    if (type === "abort" && this.initialPrompt?.state === "pending") {
      this.refuseInitialPrompt(this.initialPrompt.owner, new DOMException("Initial prompt cancelled by Stop", "AbortError"));
      return null;
    }
    this.assertInitialPromptAccess(type, promptGuard?.owner);
    const ownedSubmission = type === "prompt" && promptGuard?.owner !== undefined;
    if (ownedSubmission) {
      if (!promptGuard?.validate || this.initialPrompt!.submitted) throw new Error("Initial prompt capability already submitted");
      this.initialPrompt!.submitted = true;
    }
    const allowedDuringReplacement = COMMANDS_ALLOWED_DURING_SESSION_REPLACEMENT.has(type);
    if (this.sessionReplacement && !allowedDuringReplacement) {
      throw new Error("Session is being copied to a new session");
    }
    if (SESSION_REPLACEMENT_COMMAND_TYPES.has(type) && this.activeMutatingCommands > 0) {
      throw new Error(`Cannot ${type} while another session command is running`);
    }

    const tracksMutation = !allowedDuringReplacement;
    if (tracksMutation && !["set_model", "abort", "abort_compaction", "abort_bash"].includes(type)) assertModelRuntimeSessionReady(this.inner);
    if (tracksMutation) this.activeMutatingCommands += 1;

    try {
      // Status reconciliation must not postpone forced cleanup after Stop.
      if (type !== "get_state") this.resetIdleTimer();
      if (this.shouldWaitForExtensions(type)) {
        const binding = this.waitForExtensionsBound();
        await (this.initialPrompt?.state === "pending" ? Promise.race([binding, this.initialPrompt.refusal]) : binding);
      }
      this.assertInitialPromptAccess(type, promptGuard?.owner);
      if (tracksMutation && !["set_model", "abort", "abort_compaction", "abort_bash"].includes(type)) assertModelRuntimeSessionReady(this.inner);
      if (this.sessionReplacement && !allowedDuringReplacement) {
        throw new Error("Session is being copied to a new session");
      }

      if (type === "prompt" || type === "steer" || type === "follow_up") {
        if (this.pause && promptGuard?.pauseId !== this.pause.id) throw new Error("Session is paused or pausing; use Resume on the main session");
        const imageError = validateAgentImages(command.images);
        if (imageError) throw new Error(imageError);
      }

      switch (type) {
      case "prompt": {
        // Serialize only admission. Once the preceding prompt has either
        // passed or failed preflight, the SDK can atomically decide whether
        // this submission starts a run or joins its streaming queue.
        const admission = this.acquirePromptAdmission().then((release) => {
          if (ownedSubmission && this.initialPrompt!.state === "refused") { release(); throw this.initialPrompt!.error; }
          return release;
        });
        const releaseAdmission = await (ownedSubmission ? this.waitForInitialPrompt(promptGuard!.owner!, admission) : admission);
        try {
          // Recheck after extension binding and the serialized admission wait.
          // No await may separate this check from publishing pendingPromptCount.
          this.assertInitialPromptAccess(type, promptGuard?.owner);
          if (this.pause && promptGuard?.pauseId !== this.pause.id) throw new Error("Session is paused or pausing; use Resume on the main session");
          assertDirectoryAdmissionAllowed(this.cwd);
          if (!promptGuard?.pauseId) {
            await this.preparePausedChildContext();
            this.assertInitialPromptAccess(type, promptGuard?.owner);
            if (this.pause) throw new Error("Session is paused or pausing; use Resume on the main session");
            assertDirectoryAdmissionAllowed(this.cwd);
          }
          // Trusted host-only launch guard, after extension binding and admission awaits.
          // HTTP/tool arguments cannot supply a callable guard.
          promptGuard?.validate();
          this.assertInitialPromptAccess(type, promptGuard?.owner);
          if (this.inner.isBashRunning) {
            throw new Error("Cannot send a prompt while a shell command is running");
          }
          if (this.extensionUiAbortController.signal.aborted) {
            this.extensionUiAbortController = new AbortController();
          }
          const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
          const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
          let preflightAccepted = false;
          let guardedPreflightRefused = false;
          const journalSessionId = this.inner.sessionId;
          let journalRunId: string | null = null;
          let preflightSettled = false;
          let promptSettled = false;
          let acceptPreflight!: () => void;
          let rejectPreflight!: (error: unknown) => void;
          const preflight = new Promise<void>((resolve, reject) => {
            acceptPreflight = () => {
              if (preflightSettled) return;
              preflightAccepted = true;
              this.agentRunNeedsCompletion = true;
              // The SDK invokes this after successful preflight, before running
              // the agent (also for intercepted commands that settle immediately).
              // Never fail an accepted submission because the journal is unavailable.
              // Pi session IDs are UUIDs; test doubles and temporary wrapper
              // keys are not persisted sessions and must not pollute user state.
              if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(journalSessionId)) {
                try { journalRunId = recordRunStart(journalSessionId); }
                catch (error) { console.error("[pi-web] Could not record prompt acceptance:", error); }
              }
              preflightSettled = true;
              resolve();
            };
            rejectPreflight = (error) => {
              if (preflightSettled) return;
              preflightSettled = true;
              reject(error);
            };
          });
          // A reentrant refusal can reject this before inner.prompt throws synchronously.
          void preflight.catch(() => {});
          const finishPrompt = () => {
            if (promptSettled) return;
            promptSettled = true;
            if (journalRunId) {
              try { recordRunSettlement(journalSessionId, journalRunId); }
              catch (error) { console.error("[pi-web] Could not record prompt settlement:", error); }
            }
            this.pendingPromptCount = Math.max(0, this.pendingPromptCount - 1);
            this.resetIdleTimer();
            this.notifyAgentRunCompleteIfIdle();
          };

          this.pendingPromptCount += 1;
          if (ownedSubmission) this.initialPrompt!.settlePrompt = (error) => {
            guardedPreflightRefused = true;
            rejectPreflight(error);
            finishPrompt();
          };
          let prompt: Promise<void>;
          try {
            prompt = this.inner.prompt(command.message as string, {
              ...(promptImages?.length ? { images: promptImages } : {}),
              ...(streamingBehavior ? { streamingBehavior } : {}),
              source: "rpc",
              ...(promptGuard?.literal ? { expandPromptTemplates: false } : {}),
              // The SDK calls this with "started", "queued" or "handled" only
              // after accepting the submission; preflight failures reject instead.
              preflightResult: (disposition) => {
                // The SDK invokes this after awaited input/auth/before_agent_start hooks
                // and immediately before the agent loop. Throwing rejects preflight.
                if (ownedSubmission && this.initialPrompt!.state === "refused") throw this.initialPrompt!.error;
                if (guardedPreflightRefused) throw new Error("Deferred launch was already refused; propose again");
                try {
                  this.assertInitialPromptAccess(type, promptGuard?.owner);
                  assertModelRuntimeSessionReady(this.inner);
                  promptGuard?.validate(disposition);
                  this.assertInitialPromptAccess(type, promptGuard?.owner);
                } catch (error) {
                  if (ownedSubmission) this.refuseInitialPrompt(promptGuard!.owner!, error);
                  if (promptGuard?.pauseId && disposition === "started") {
                    // SDK 1.3 invokes this outside its cleanup try/finally. Do not
                    // poison its busy flag by throwing: enter a cancelled run whose
                    // prepareRequest gate refuses before any provider/tool dispatch.
                    this.resumeRequestError = error instanceof Error ? error : new Error(String(error));
                    this.pendingResume?.reject(error); rejectPreflight(error);
                    void this.inner.abort().catch((failure) => console.error("[pi-web] stale Resume stop failed:", failure));
                    return;
                  }
                  throw error;
                }
                // No await between final guarded admission and releasing exclusivity.
                if (ownedSubmission) {
                  this.initialPrompt!.state = "accepted";
                  this.initialPrompt!.settlePrompt = undefined;
                }
                acceptPreflight();
              },
            });
          } catch (error) {
            finishPrompt();
            throw error;
          }

          void prompt.then(() => {
            if (ownedSubmission && this.initialPrompt!.state === "refused") { finishPrompt(); return; }
            if (promptGuard && !preflightSettled) {
              // SDK agent_settled deferral can resolve before actual dispatch.
              // Never certify guarded launches from that early resolution, and
              // refuse any later deferred callback instead of launching unobserved.
              guardedPreflightRefused = true;
              const error = new Error("SDK did not confirm launch admission; deferred launch refused");
              if (ownedSubmission) this.refuseInitialPrompt(promptGuard!.owner!, error);
              rejectPreflight(error);
              finishPrompt();
              return;
            }
            // Compatibility fallback if a future SDK resolves without invoking
            // the internal callback. This waits for the run, but never acks early.
            acceptPreflight();
            finishPrompt();
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
          }, (error) => {
            if (ownedSubmission) this.refuseInitialPrompt(promptGuard!.owner!, error);
            rejectPreflight(error);
            finishPrompt();
            invalidateSessionListCache();
            // A preflight rejection is returned by the POST itself. Only an
            // unexpected failure after acceptance needs the asynchronous event.
            if (preflightAccepted) {
              this.emit({
                type: "prompt_error",
                errorMessage: error instanceof Error ? error.message : String(error),
              });
              if (!streamingBehavior) this.emit({ type: "prompt_done" });
            }
          }).catch((error) => {
            console.error(
              "[pi-web] prompt completion handler failed:",
              error instanceof Error ? error.message : error,
            );
          });

          await preflight;
          return null;
        } finally {
          releaseAdmission();
        }
      }

      case "abort":
        if (this.inner.modelRuntime) abortModelRuntimeRefresh(this.inner.modelRuntime);
        this.forceShutdownOnIdle = true;
        // Stop must unwind extension commands that have not started the agent yet.
        this.extensionUiAbortController.abort(new DOMException("Extension UI cancelled by Stop", "AbortError"));
        try {
          await this.withFinalIdleReset(() => this.inner.abort());
          return null;
        } finally {
          if (!this.isRunning()) this.forceShutdownOnIdle = false;
        }

      case "get_state": {
        const model = this.inner.model;
        const contextUsage = this.inner.getContextUsage();
        return {
          sessionId: this.inner.sessionId,
          sessionFile: this.inner.sessionFile ?? "",
          isStreaming: this.inner.isStreaming,
          isPromptRunning: this.pendingPromptCount > 0,
          isBashRunning: this.inner.isBashRunning,
          isCompacting: this.inner.isCompacting,
          autoCompactionEnabled: this.inner.autoCompactionEnabled,
          autoRetryEnabled: this.inner.autoRetryEnabled,
          model: model ? { id: model.id, provider: model.provider } : undefined,
          messageCount: 0,
          pendingMessageCount: this.inner.pendingMessageCount,
          queuedMessages: {
            steering: [...this.inner.getSteeringMessages()],
            followUp: [...this.inner.getFollowUpMessages()],
          },
          contextUsage: contextUsage
            ? { percent: contextUsage.percent, contextWindow: contextUsage.contextWindow, tokens: contextUsage.tokens }
            : null,
          // An exact prompt is projected onto each run by the inline extension;
          // the SDK state only shows Pi's structured sections.
          systemPrompt: this.exactSystemPrompt?.() ?? this.inner.agent.state?.systemPrompt ?? "",
          contextFilesChanged: this.monitorContextFiles
            ? haveContextFilesChanged(this.inner.resourceLoader.getAgentsFiles().agentsFiles, this.cwd, getAgentDir())
            : false,
          thinkingLevel: this.inner.agent.state?.thinkingLevel ?? "off",
          modelSpeed: readSessionModelSpeed(this.inner.sessionManager.getEntries() as unknown as SessionEntry[]),
          modelDefinitionRefresh: this.inner.modelRuntime ? modelRuntimeRefreshState(this.inner.modelRuntime, this.inner) : undefined,
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
          nativeResources: readNativeResourceSelection(this.inner.sessionManager.getEntries()),
          effectiveNativeResources: this.nativeSessionTools?.selection ?? NO_NATIVE_RESOURCES,
          mcpServers: this.nativeSessionTools?.status() ?? [],
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        if (typeof provider !== "string" || !provider.trim() || typeof modelId !== "string" || !modelId.trim()) throw new Error("Invalid model selection");
        // Chat-only has no user-extension UI lifecycle to initialize. In
        // particular an unbound child must still be able to repair its family.
        if (this.chatOnly) await this.waitForExtensionsBound();
        else await this.ensureExtensionsBound();
        const model = await applySessionModelDefinition(this.inner, provider, modelId);
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        // Copy with a separate manager: never replace or shut down the source,
        // whose prompt, tools, compaction, or extension UI may still be running.
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;

        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");

        const entry = sessionManager.getEntry(entryId);
        if (!entry) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        let newSessionFile: string;
        let forkedManager: SessionManager;

        if (!entry.parentId) {
          // Fork before the first message: create an empty session linked to this one
          forkedManager = SessionManager.create(sessionManager.getCwd(), sessionDir, {
            parentSession: currentSessionFile,
          });
          newSessionFile = forkedManager.getSessionFile() as string;
        } else {
          // Fork after some history: copy path up to (but not including) the fork point
          forkedManager = SessionManager.open(currentSessionFile, sessionDir);
          const forkedPath = forkedManager.createBranchedSession(entry.parentId);
          if (!forkedPath) throw new Error("Failed to create forked session");
          newSessionFile = forkedPath;
        }

        if (!existsSync(newSessionFile)) {
          const header = forkedManager.getHeader();
          if (!header) throw new Error("Forked session is missing a session header");
          const content = [header, ...forkedManager.getEntries()]
            .map((forkedEntry) => JSON.stringify(forkedEntry))
            .join("\n") + "\n";
          writeFileSync(newSessionFile, content, { encoding: "utf8", flag: "wx" });
        }

        const sourceEntries = sessionManager.getEntries() as unknown as SessionEntry[];
        const accountSelection = readSessionAccounts(sourceEntries);
        const destination = SessionManager.open(newSessionFile, sessionDir);
        if (accountSelection) appendSessionAccounts(destination, accountSelection);
        appendSessionModelSpeed(destination, readSessionModelSpeed(sourceEntries));
        appendNativeResourceSelection(destination, readNativeResourceSelection(sourceEntries));
        const newSessionId = forkedManager.getSessionId();
        cacheSessionPath(newSessionId, newSessionFile);
        invalidateSessionListCache();
        return { cancelled: false, newSessionId };
      }

      case "fork_branch": {
        const entryId = command.entryId as string;
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;
        if (!sessionManager.isPersisted()) return { cancelled: true };
        if (!currentSessionFile) throw new Error("Persisted session is missing a session file");
        if (!sessionManager.getEntry(entryId)) throw new Error("Invalid entry ID for forking");

        const sessionDir = sessionManager.getSessionDir();
        const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
        const forkedPath = sourceManager.createBranchedSession(entryId);
        if (!forkedPath) throw new Error("Failed to create forked session");

        const forkedManager = SessionManager.open(forkedPath, sessionDir);
        const sourceEntries = sessionManager.getEntries() as unknown as SessionEntry[];
        const accountSelection = readSessionAccounts(sourceEntries);
        if (accountSelection) appendSessionAccounts(forkedManager, accountSelection);
        appendSessionModelSpeed(forkedManager, readSessionModelSpeed(sourceEntries));
        appendNativeResourceSelection(forkedManager, readNativeResourceSelection(sourceEntries));
        const newSessionId = forkedManager.getSessionId();
        cacheSessionPath(newSessionId, forkedPath);
        invalidateSessionListCache();
        return { cancelled: false, newSessionId };
      }

      case "clone": {
        if (this.isSessionRunningForReplacement()) {
          throw new Error("Cannot clone while the session is running");
        }
        const sessionManager = this.inner.sessionManager;
        const currentSessionFile = this.inner.sessionFile;
        const leafId = typeof command.leafId === "string" ? command.leafId : sessionManager.getLeafId();
        const branchHasAssistant = leafId && sessionManager.getBranch(leafId).some(
          (entry) => entry.type === "message" && entry.message.role === "assistant",
        );

        if (!sessionManager.isPersisted() || !leafId || !branchHasAssistant) return { cancelled: true };
        if (!currentSessionFile || !existsSync(currentSessionFile)) return { cancelled: true };

        return this.withSessionReplacement("clone", async () => {
          const sessionDir = sessionManager.getSessionDir();
          const sourceManager = SessionManager.open(currentSessionFile, sessionDir);
          const clonedPath = sourceManager.createBranchedSession(leafId);
          if (!clonedPath || !existsSync(clonedPath)) throw new Error("Failed to clone current session branch");

          const clonedManager = SessionManager.open(clonedPath, sessionDir);
          const sourceEntries = sessionManager.getEntries() as unknown as SessionEntry[];
          const accountSelection = readSessionAccounts(sourceEntries);
          if (accountSelection) appendSessionAccounts(clonedManager, accountSelection);
          appendSessionModelSpeed(clonedManager, readSessionModelSpeed(sourceEntries));
          appendNativeResourceSelection(clonedManager, readNativeResourceSelection(sourceEntries));
          const newSessionId = clonedManager.getSessionId();
          cacheSessionPath(newSessionId, clonedPath);
          invalidateSessionListCache();
          await this.shutdownAfterSessionReplacement("clone");
          return { cancelled: false, newSessionId };
        });
      }

      case "navigate_tree": {
        if (this.inner.isBashRunning) {
          throw new Error("Cannot navigate while a shell command is running");
        }
        const result = await this.inner.navigateTree(command.targetId as string, {});
        return { cancelled: result.cancelled };
      }

      case "set_model_speed": {
        if (!isModelSpeed(command.modelSpeed)) throw new Error("Invalid model speed: expected standard or fast");
        if (this.shutdownPromise) throw new Error("Cannot change model speed while the session is shutting down");
        if (this.isRunning() || this.activeMutatingCommands > 1) {
          throw new Error("Cannot change model speed while the session is running or another command is pending");
        }
        if (command.modelSpeed === "fast" && !supportsModelSpeed(this.inner.model)) {
          throw new Error("Fast model speed is available only for ChatGPT subscription models");
        }
        if (readSessionModelSpeed(this.inner.sessionManager.getEntries() as unknown as SessionEntry[]) !== command.modelSpeed) {
          appendSessionModelSpeed(this.inner.sessionManager, command.modelSpeed);
          invalidateSessionListCache();
          this.emit({ type: "model_speed_change", modelSpeed: command.modelSpeed });
        }
        return { modelSpeed: command.modelSpeed };
      }

      case "set_thinking_level": {
        const level = command.level as string;
        this.inner.setThinkingLevel(level);
        // setThinkingLevel clamps xhigh→high for models where supportsXhigh()===false.
        // If the model has DeepSeek thinking compat (reasoningEffortMap maps xhigh→max),
        // force the state back so the compat layer can use it correctly.
        if (level === "xhigh" && (this.inner.model as { compat?: { thinkingFormat?: string } } | null)?.compat?.thinkingFormat === "deepseek" && this.inner.agent?.state) {
          this.inner.agent.state.thinkingLevel = "xhigh";
        }
        invalidateSessionListCache();
        return null;
      }

      case "compact": {
        const releaseAdmission = this.beginCheckoutPromptAdmission();
        try {
          return await this.withFinalIdleReset(() =>
            this.inner.compact(command.customInstructions as string | undefined)
          );
        } finally {
          releaseAdmission();
          invalidateSessionListCache();
        }
      }

      case "set_session_name": {
        const name = (command.name as string | undefined)?.trim();
        if (!name) throw new Error("Session name cannot be empty");
        this.inner.setSessionName(name);
        invalidateSessionListCache();
        return null;
      }

      case "get_session_stats": {
        return {
          ...this.inner.getSessionStats(),
          sessionName: this.inner.sessionManager.getSessionName(),
        };
      }

      case "get_last_assistant_text": {
        return { text: this.inner.getLastAssistantText() ?? "" };
      }

      case "set_auto_compaction": {
        this.inner.setAutoCompactionEnabled(command.enabled as boolean);
        return null;
      }

      case "clear_queue": {
        // Full clear only: pi has no single-item dequeue, and clear+requeue
        // races against the agent loop pulling messages mid-flight.
        return this.inner.clearQueue();
      }

      case "steer": {
        const steerImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const releaseAdmission = this.beginCheckoutPromptAdmission();
        try { await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined); }
        finally { releaseAdmission(); }
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        const releaseAdmission = this.beginCheckoutPromptAdmission();
        try { await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined); }
        finally { releaseAdmission(); }
        return null;
      }

      case "get_tools": {
        const all: ToolInfo[] = this.inner.getAllTools();
        const active = new Set<string>(this.inner.getActiveToolNames());
        return all.map((t) => ({
          ...t,
          active: active.has(t.name),
        }));
      }

      case "get_commands": {
        const commands: SlashCommandInfo[] = [];
        for (const registered of this.inner.extensionRunner.getRegisteredCommands()) {
          commands.push({
            name: registered.invocationName,
            description: registered.description,
            source: "extension",
            sourceInfo: registered.sourceInfo,
          });
        }
        for (const template of this.inner.promptTemplates) {
          commands.push({
            name: template.name,
            description: template.description,
            source: "prompt",
            sourceInfo: template.sourceInfo,
          });
        }
        for (const skill of this.inner.resourceLoader.getSkills().skills) {
          commands.push({
            name: `skill:${skill.name}`,
            description: skill.description,
            source: "skill",
            sourceInfo: skill.sourceInfo,
          });
        }
        return { commands };
      }

      case "set_tools": {
        const toolNames = command.toolNames as string[];
        this.setActiveToolSelection(toolNames);
        return null;
      }

      case "reload": {
        if (this.extensionUiAbortController.signal.aborted) {
          this.extensionUiAbortController = new AbortController();
        }
        const activeToolNames = this.inner.getActiveToolNames();
        await this.waitForExtensionsBound();
        this.extensionStatuses.clear();
        this.resetExtensionWidgetsForReload();
        this.syncProjectTrust();
        invalidateSettingsListingRuntime();
        try {
          await this.inner.reload();
        } finally {
          invalidateSettingsListingRuntime();
          invalidateModelsCache();
        }
        this.setActiveToolSelection(activeToolNames);
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        return { success: true };
      }

      case "abort_compaction": {
        this.inner.abortCompaction();
        return null;
      }

      case "extension_ui_response": {
        return { accepted: this.resolveExtensionUiResponse(command as ExtensionUiResponse) };
      }

      case "extension_ui_input": {
        this.handleExtensionUiInput(command.id as string, command.data as string);
        return null;
      }

      case "set_auto_retry": {
        this.inner.setAutoRetryEnabled(command.enabled as boolean);
        return null;
      }

      case "bash": {
        if (this.isRunning()) {
          throw new Error("Cannot run a shell command while the session is busy");
        }
        // SDK bash hooks can await before isBashRunning becomes true. Publish
        // admission now and retain it until actual execution settles.
        const releaseAdmission = this.beginCheckoutPromptAdmission();
        try {
          const result = await this.inner.executeBash(
            command.command as string,
            undefined,
            {
              excludeFromContext: command.excludeFromContext as boolean | undefined,
              operations: createProjectCommandBashOperations({
                shellPath: this.inner.settingsManager.getShellPath(),
                sessionId: this.sessionId,
              }),
            },
          );
          this.persistSessionWithoutAssistant();
          return result;
        } finally {
          releaseAdmission();
          this.resetIdleTimer();
          invalidateSessionListCache();
        }
      }

      case "abort_bash": {
        this.forceShutdownOnIdle = true;
        this.inner.abortBash();
        return null;
      }

        default:
          throw new Error(`Unsupported command: ${type}`);
      }
    } catch (error) {
      if (ownedSubmission) this.refuseInitialPrompt(promptGuard!.owner!, error);
      throw error;
    } finally {
      if (tracksMutation) this.activeMutatingCommands = Math.max(0, this.activeMutatingCommands - 1);
    }
  }

  destroy(): void {
    if (this.initialPrompt?.state === "pending") {
      this.refuseInitialPrompt(this.initialPrompt.owner, new DOMException("Initial prompt cancelled by session destruction", "AbortError"));
      return;
    }
    const refresh = this.inner.modelRuntime && pendingModelRuntimeRefresh(this.inner.modelRuntime);
    if (refresh) { void refresh.then(() => this.destroy()); return; }
    this.destroyInternal(false);
  }

  /** One shared completion, never an 'emitted means finished' flag. Native
   * direct eviction also waits for startup binding before shutting resources down. */
  private endExtensions(): Promise<unknown> {
    return this.extensionShutdown ??= Promise.resolve().then(async () => {
      if (this.nativeSessionTools?.enabled || this.shutdownPromise) {
        try { await this.waitForExtensionsBound(); }
        catch (error) { console.error("[pi-web] extension binding failed before session shutdown:", error); }
      }
      return this.inner.extensionRunner?.emit?.({ type: "session_shutdown", reason: "quit" });
    }).then(result => { this.extensionsEnded = true; return result; });
  }

  private destroyInternal(ownedRefusal: boolean): void {
    if (!this._alive) return;
    const nativeRetirement = !ownedRefusal && (this.nativeSessionTools?.enabled || this.shutdownPromise !== null);
    if (nativeRetirement) this.publishResourceRetirement();
    this.nativeSessionTools?.retire();
    this._alive = false;
    this.releaseModelRuntime();
    // Tell attached SSE listeners to drop this instance so the browser
    // EventSource errors and reconnects instead of staying OPEN on a dead wrapper.
    this.emit({ type: "session_shutdown" });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (!ownedRefusal && this.inner.isBashRunning) this.inner.abortBash();
    this.unsubscribe?.();
    this.disposePauseBoundary?.();
    this.disposePauseIngress?.();
    this.pendingResume?.reject(new Error("Session shut down during Resume; pause information was retained"));
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.pendingUiStartedAt.clear();
    this.activeToolEvents.clear();
    this.pendingCheckoutAdmissions = 0;
    this.clearExtensionWidgets(false);

    const finishDispose = () => {
      try {
        try { this.inner.dispose(); }
        finally { this.onDestroyCallback?.(); }
        if (nativeRetirement) this.ownedRetirement!.resolve();
      } catch (error) {
        if (nativeRetirement) this.ownedRetirement!.reject(error);
        throw error;
      }
    };

    if (ownedRefusal) {
      // Disposal invalidates the owned destination; it does not certify that arbitrary
      // extension JS/processes have settled. Never wait on poisoned SDK abort/idle.
      let disposed = false;
      const disposeOnce = () => {
        if (disposed) return;
        disposed = true;
        clearTimeout(timer);
        try {
          finishDispose();
          this.ownedRetirement!.resolve();
        } catch (error) {
          console.error("[pi-web] refused initial prompt disposal failed:", error);
          this.ownedRetirement!.reject(error);
        }
      };
      const timer = setTimeout(() => {
        console.error(`[pi-web] refused initial prompt extension shutdown timed out after ${INITIAL_PROMPT_SHUTDOWN_GRACE_MS}ms`);
        disposeOnce();
      }, INITIAL_PROMPT_SHUTDOWN_GRACE_MS);
      void this.endExtensions()
        .catch((error) => { console.error("[pi-web] refused initial prompt extension shutdown failed:", error); })
        .finally(disposeOnce);
      return;
    }

    // Always emit session_shutdown before dispose, even when callers skip
    // shutdown() (process exit, direct destroy). Await when possible so
    // extension MCP children can reap before the runner is invalidated.
    if (this.extensionsEnded) { finishDispose(); return; }
    const emit = this.inner.extensionRunner?.emit;
    if (typeof emit !== "function") {
      finishDispose();
      return;
    }

    void this.endExtensions()
      .catch((error) => {
        if (nativeRetirement) this.ownedRetirement!.reject(error);
        console.error(
          "[pi-web] session_shutdown before dispose failed:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(finishDispose)
      .catch((error) => { console.error("[pi-web] session disposal failed:", error); });
  }

  async shutdown(): Promise<void> {
    if (this.initialPrompt?.state === "pending") {
      this.refuseInitialPrompt(this.initialPrompt.owner, new DOMException("Initial prompt cancelled by session shutdown", "AbortError"));
    }
    if (this.ownedRetirement) return this.ownedRetirement.completion;
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!this._alive) return;
    this.nativeSessionTools?.retire();

    this.shutdownPromise = (async () => {
      try {
        const refresh = this.inner.modelRuntime && pendingModelRuntimeRefresh(this.inner.modelRuntime);
        if (refresh) await refresh;
        await this.endExtensions();
      } finally {
        this.destroy();
        if (this.ownedRetirement) await this.ownedRetirement.completion;
      }
    })();
    return this.shutdownPromise;
  }

  getPendingQuestionSetIds(): string[] {
    return [...this.pendingUiRequests.values()].filter((request) => request.method === "ask_user_batch").map((request) => request.id as string);
  }

  private resolveExtensionUiResponse(response: ExtensionUiResponse): boolean {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return false;
    const request = this.pendingUiRequests.get(response.id) as InteractionRequest | undefined;
    if (!request) return false;
    const normalized = normalizeInteractionResponse(request, response);
    if (!normalized) {
      if (request.method === "ask_user_batch") throw new Error("Invalid question-set response; answer every required question and explicitly skip optional questions.");
      return false;
    }
    pending.resolve(responseForExtension(response.id, normalized));
    return true;
  }

  private getExtensionStatuses(): Array<{ key: string; text: string }> {
    return Array.from(this.extensionStatuses, ([key, text]) => ({ key, text }));
  }

  private getExtensionWidgets(): ExtensionWidgetItem[] {
    return Array.from(this.extensionWidgets.values());
  }

  private nextExtensionWidgetGeneration(key: string): number {
    const generation = (this.extensionWidgetGenerations.get(key) ?? 0) + 1;
    this.extensionWidgetGenerations.set(key, generation);
    return generation;
  }

  private disposeExtensionWidgetComponent(component: unknown): void {
    if (!component || (typeof component !== "object" && typeof component !== "function")) return;
    const dispose = (component as { dispose?: unknown }).dispose;
    if (typeof dispose !== "function") return;
    try {
      dispose.call(component);
    } catch {
      // Ignore dispose errors from extension widgets.
    }
  }

  private emitExtensionWidgetClear(key: string): void {
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setWidget",
      widgetKey: key,
      widgetLines: undefined,
      widgetPlacement: undefined,
    } as ExtensionUiRequest as AgentEvent);
  }

  private clearExtensionWidget(key: string, emitClear = true): number {
    const generation = this.nextExtensionWidgetGeneration(key);

    const active = this.activeExtensionWidgets.get(key);
    this.activeExtensionWidgets.delete(key);
    this.extensionWidgets.delete(key);
    if (active) this.disposeExtensionWidgetComponent(active.component);
    if (this.extensionWidgetGenerations.get(key) !== generation) return generation;
    if (emitClear) this.emitExtensionWidgetClear(key);
    return generation;
  }

  private clearExtensionWidgets(emitClear: boolean): void {
    const keys = new Set([
      ...this.extensionWidgets.keys(),
      ...this.activeExtensionWidgets.keys(),
    ]);
    for (const key of keys) this.clearExtensionWidget(key, emitClear);
  }

  private resetExtensionWidgetsForReload(): void {
    this.extensionWidgetsResetting = true;
    try {
      const factoryKeys = [...this.activeExtensionWidgets.keys()];
      for (const key of factoryKeys) this.clearExtensionWidget(key);
      // Keep the existing array-widget reload behavior: snapshots are reset and
      // the next extension session_start repopulates them.
      this.extensionWidgets.clear();
    } finally {
      this.extensionWidgetsResetting = false;
    }
  }

  private emitExtensionWidgetError(key: string, error: unknown): void {
    this.emit({
      type: "extension_error",
      extensionPath: `extension-widget:${key}`,
      event: "setWidget",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private failExtensionWidget(
    key: string,
    generation: number,
    error: unknown,
    clearEmitted: boolean,
    component?: unknown,
  ): void {
    if (this.extensionWidgetGenerations.get(key) !== generation) {
      this.disposeExtensionWidgetComponent(component);
      return;
    }

    const active = this.activeExtensionWidgets.get(key);
    let shouldEmitClear = !clearEmitted;
    if (active?.generation === generation) {
      shouldEmitClear = active.rendered || !active.clearEmitted;
      this.activeExtensionWidgets.delete(key);
      this.disposeExtensionWidgetComponent(active.component);
    } else {
      this.disposeExtensionWidgetComponent(component);
    }
    if (this.extensionWidgetGenerations.get(key) !== generation) {
      this.emitExtensionWidgetError(key, error);
      return;
    }
    this.extensionWidgets.delete(key);
    if (shouldEmitClear) this.emitExtensionWidgetClear(key);
    this.emitExtensionWidgetError(key, error);
  }

  private renderExtensionWidget(active: ActiveExtensionWidget): void {
    if (
      this.activeExtensionWidgets.get(active.key) !== active
      || this.extensionWidgetGenerations.get(active.key) !== active.generation
    ) return;

    let lines: unknown;
    try {
      lines = active.component.render(DEFAULT_CUSTOM_UI_COLUMNS);
    } catch (error) {
      this.failExtensionWidget(active.key, active.generation, error, active.clearEmitted);
      return;
    }
    if (!Array.isArray(lines) || !lines.every((line) => typeof line === "string")) {
      this.failExtensionWidget(
        active.key,
        active.generation,
        new Error("Extension widget render must return string[]"),
        active.clearEmitted,
      );
      return;
    }
    if (
      this.activeExtensionWidgets.get(active.key) !== active
      || this.extensionWidgetGenerations.get(active.key) !== active.generation
    ) return;

    const widgetLines = lines as string[];
    this.extensionWidgets.set(active.key, {
      key: active.key,
      lines: widgetLines,
      placement: active.placement,
    });
    active.rendered = true;
    this.emit({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "setWidget",
      widgetKey: active.key,
      widgetLines,
      widgetPlacement: active.placement,
    } as ExtensionUiRequest as AgentEvent);
  }

  private setExtensionWidgetFactory(
    key: string,
    factory: ExtensionWidgetFactory,
    options?: { placement?: "aboveEditor" | "belowEditor" },
  ): void {
    const hadPrevious = this.extensionWidgets.has(key) || this.activeExtensionWidgets.has(key);
    const generation = this.clearExtensionWidget(key, hadPrevious);
    if (this.extensionWidgetGenerations.get(key) !== generation) return;
    const tui = createHeadlessCustomUiTui(() => {
      const active = this.activeExtensionWidgets.get(key);
      if (active?.generation === generation) this.renderExtensionWidget(active);
    }, DEFAULT_CUSTOM_UI_COLUMNS);

    let component: unknown;
    try {
      component = factory(tui, PLAIN_TEXT_THEME);
    } catch (error) {
      this.failExtensionWidget(key, generation, error, hadPrevious);
      return;
    }
    if (this.extensionWidgetGenerations.get(key) !== generation) {
      this.disposeExtensionWidgetComponent(component);
      return;
    }
    if (
      !component
      || (typeof component !== "object" && typeof component !== "function")
      || typeof (component as { render?: unknown }).render !== "function"
    ) {
      this.failExtensionWidget(
        key,
        generation,
        new Error("Extension widget factory must return a component with render(width)"),
        hadPrevious,
        component,
      );
      return;
    }

    const active: ActiveExtensionWidget = {
      key,
      component: component as ExtensionWidgetComponent,
      placement: options?.placement ?? "aboveEditor",
      generation,
      clearEmitted: hadPrevious,
      rendered: false,
    };
    this.activeExtensionWidgets.set(key, active);
    this.renderExtensionWidget(active);
  }

  private getCustomUiWidth(options: unknown): number {
    if (!options || typeof options !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const overlayOptions = (options as { overlayOptions?: unknown }).overlayOptions;
    const resolved = typeof overlayOptions === "function" ? overlayOptions() : overlayOptions;
    if (!resolved || typeof resolved !== "object") return DEFAULT_CUSTOM_UI_COLUMNS;
    const width = (resolved as { width?: unknown }).width;
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(40, Math.min(140, Math.round(width)))
      : 92;
  }

  private emitCustomUiRender(id: string, custom: ActiveCustomUi): void {
    let lines: string[];
    try {
      lines = custom.component.render(custom.width);
    } catch (error) {
      lines = [`Extension custom UI render failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const event = {
      type: "extension_ui_request",
      id,
      method: "custom",
      lines,
    } as ExtensionUiRequest as AgentEvent;
    this.pendingUiStartedAt.set(id, this.pendingUiStartedAt.get(id) ?? Date.now());
    this.pendingUiRequests.set(id, event);
    this.emit(event);
  }

  private closeCustomUi(id: string, value: unknown): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || custom.settled) return;
    custom.settled = true;
    this.activeCustomUis.delete(id);
    this.pendingUiRequests.delete(id);
    this.pendingUiStartedAt.delete(id);
    try {
      custom.component.dispose?.();
    } catch {
      // Ignore dispose errors from extension UI components.
    }
    this.emit({
      type: "extension_ui_request",
      id,
      method: "custom",
      lines: [],
      closed: true,
    } as ExtensionUiRequest as AgentEvent);
    custom.resolve(value);
  }

  private handleExtensionUiInput(id: string, data: string): void {
    const custom = this.activeCustomUis.get(id);
    if (!custom || typeof data !== "string") return;
    try {
      custom.component.handleInput?.(data);
      if (this.activeCustomUis.has(id)) this.emitCustomUiRender(id, custom);
    } catch (error) {
      this.closeCustomUi(id, undefined);
      this.emit({
        type: "extension_error",
        extensionPath: `custom-ui:${id}`,
        event: "custom_ui_input",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private requestExtensionCustomUi<T>(
    factory: unknown,
    options?: unknown,
  ): Promise<T> {
    if (typeof factory !== "function") return Promise.resolve(undefined as T);

    const stopSignal = this.extensionUiAbortController.signal;
    if (stopSignal.aborted) return Promise.reject(stopSignal.reason);

    const id = randomUUID();
    const width = this.getCustomUiWidth(options);

    return new Promise<T>((resolve, reject) => {
      let completed = false;
      const tui = createHeadlessCustomUiTui(
        () => {
          const custom = this.activeCustomUis.get(id);
          if (custom) this.emitCustomUiRender(id, custom);
        },
        width,
      );
      const finish = (value: T) => {
        if (completed) return;
        completed = true;
        stopSignal.removeEventListener("abort", onStop);
        if (stopSignal.aborted) reject(stopSignal.reason);
        else resolve(value);
      };
      const done = (value: T) => {
        if (this.activeCustomUis.has(id)) {
          this.closeCustomUi(id, value);
        } else {
          finish(value);
        }
      };
      const onStop = () => done(undefined as T);
      stopSignal.addEventListener("abort", onStop, { once: true });

      Promise.resolve()
        .then(() => completed ? undefined : factory(tui, PLAIN_TEXT_THEME, CUSTOM_UI_KEYBINDINGS, done))
        .then((component) => {
          if (completed) {
            try {
              (component as CustomUiComponent | undefined)?.dispose?.();
            } catch {
              // Ignore dispose errors from a component completed before mounting.
            }
            return;
          }
          if (!component || typeof component !== "object" || typeof (component as CustomUiComponent).render !== "function") {
            finish(undefined as T);
            return;
          }
          const custom: ActiveCustomUi = {
            component: component as CustomUiComponent,
            width,
            resolve: (value) => finish(value as T),
            settled: false,
          };
          this.activeCustomUis.set(id, custom);
          this.emitCustomUiRender(id, custom);
        })
        .catch((error) => {
          if (completed) return;
          this.emit({
            type: "extension_error",
            extensionPath: `custom-ui:${id}`,
            event: "custom_ui",
            error: error instanceof Error ? error.message : String(error),
          });
          finish(undefined as T);
        });
    });
  }

  private requestExtensionUi<T>(
    request: ExtensionUiRequestBody,
    defaultValue: T,
    parseResponse: (response: ExtensionUiResponse) => T,
    timeout?: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (this.isPauseRequested()) {
      this.capturePauseWaiting(request);
      return Promise.reject(new Error("Session is pausing; ask again after Resume"));
    }
    if (signal?.aborted) return Promise.resolve(defaultValue);
    const stopSignal = this.extensionUiAbortController.signal;
    if (stopSignal.aborted) return Promise.reject(stopSignal.reason);
    const abortSignal = signal ? AbortSignal.any([signal, stopSignal]) : stopSignal;

    const id = randomUUID();
    // Own the exact payload sent to the browser; a caller cannot later mutate
    // its arrays/fields and change the historical approval snapshot.
    const fullRequest = JSON.parse(JSON.stringify({
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    })) as InteractionRequest;

    return new Promise((resolve, reject) => {
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        abortSignal.removeEventListener("abort", onAbort);
        this.pendingUiRequests.delete(id);
        this.pendingUiStartedAt.delete(id);
        this.pendingUiResponses.delete(id);
        this.emit({ type: "extension_ui_closed", id });
      };
      const settle = (value: T, outcome: InteractionOutcome, response?: InteractionResponse) => {
        if (settled) return;
        settled = true;
        let settlementError: unknown;
        try {
          const receipt: InteractionReceipt = {
            version: 1, request: snapshotInteractionRequest(fullRequest), outcome,
            ...(response ? { response } : {}),
          };
          const manager = this.inner.sessionManager;
          const entryId = manager.appendCustomEntry(INTERACTION_RECEIPT_TYPE, receipt);
          this.persistSessionWithoutAssistant();
          invalidateSessionListCache();
          this.emit({ type: "interaction_receipt", entry: manager.getEntry(entryId) });
          if (stopSignal.aborted) reject(stopSignal.reason);
          else resolve(value);
        } catch (error) {
          // Never resume an approved operation if its receipt could not be saved.
          settlementError = error;
          reject(error);
        } finally {
          cleanup();
        }
        // A batch POST must not acknowledge acceptance when its tool promise failed.
        // Persistence failure is terminal, unlike an uncertain network acknowledgement:
        // retrying a partly appended SDK entry could fabricate duplicate receipts.
        if (settlementError && fullRequest.method === "ask_user_batch" && response) throw settlementError;
      };
      const onAbort = () => settle(defaultValue, "aborted");

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue, "timed_out"), timeout);
      abortSignal.addEventListener("abort", onAbort, { once: true });

      this.pendingUiStartedAt.set(id, Date.now());
      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      const pendingResponse: PendingUiResponse = {
        resolve: (response) => {
          const normalized = normalizeInteractionResponse(fullRequest, response);
          if (normalized) settle(parseResponse(response), "cancelled" in normalized ? "cancelled" : "answered", normalized);
        },
        cancel: () => settle(defaultValue, "aborted"),
      };
      this.pendingUiResponses.set(id, pendingResponse);
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike & AskUserUiContext & PluginUiContext {
    return {
      sessionLaunchHost,
      isDirectoryInUse: (directory) => hasBusyRpcSessionWithin(directory) || hasActiveTerminalWithin(directory),
      reserveDirectory: (directory) => acquireDirectoryReservation(directory,
        (physical) => hasBusyRpcSessionWithin(physical) || hasActiveTerminalWithin(physical)),
      prepareReview: async (pluginId, operationId, build) => {
        const manager = this.inner.sessionManager;
        if (!manager.isPersisted() || !manager.getSessionFile() || !manager.getHeader()) throw new Error("Review attachments require a persistent session");
        return preparePluginReview(pluginId, operationId, build);
      },
      operationReceipt: (pluginId, receipt) => {
        const manager = this.inner.sessionManager;
        // In-memory/non-persisting sessions cannot authorize durable operations.
        if (!manager.isPersisted() || !manager.getSessionFile() || !manager.getHeader()) throw new Error("Operation receipts require a persistent session");
        const snapshot = snapshotOperationReceipt(pluginId, receipt, nextOperationReceiptSequence(manager.getEntries()));
        const entryId = manager.appendCustomEntry(OPERATION_RECEIPT_TYPE, snapshot);
        this.persistSessionWithoutAssistant();
        invalidateSessionListCache();
        // No abort check here: effects that already started must record their outcome.
        this.emit({ type: "operation_receipt", entry: manager.getEntry(entryId) });
      },
      pluginCardWithDetails: (pluginId, card, signal) => {
        validatePluginCard(card);
        return this.requestExtensionUi(
          { method: "plugin_card", pluginId, ...card }, null,
          (response) => "action" in response ? { action: response.action, ...(response.details !== undefined ? { details: response.details } : {}) } : null,
          undefined, signal,
        );
      },
      pluginCard: (pluginId, card, signal) => {
        validatePluginCard(card);
        return this.requestExtensionUi(
          { method: "plugin_card", pluginId, ...card }, null,
          (response) => "action" in response ? response.action : null,
          undefined, signal,
        );
      },
      select: (title, options, opts) => this.requestExtensionUi(
        { method: "select", title, options, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      confirm: (title, message, opts) => this.requestExtensionUi(
        { method: "confirm", title, message, ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        false,
        (response) => "confirmed" in response ? response.confirmed : false,
        opts?.timeout,
        opts?.signal,
      ),
      input: (title, placeholder, opts) => this.requestExtensionUi(
        { method: "input", title, ...(placeholder !== undefined ? { placeholder } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      editor: (title, prefill, opts) => this.requestExtensionUi(
        { method: "editor", title, ...(prefill !== undefined ? { prefill } : {}), ...(opts?.timeout ? { timeout: opts.timeout } : {}) },
        undefined,
        (response) => "value" in response ? response.value : undefined,
        opts?.timeout,
        opts?.signal,
      ),
      askUserBatch: (set, timeout, signal) => {
        const normalized = parseQuestionSet(set);
        if (!normalized) throw new Error("Invalid question set");
        return this.requestExtensionUi(
          { method: "ask_user_batch", ...normalized }, null,
          (response) => "answers" in response ? response.answers : null,
          timeout, signal,
        );
      },
      askUser: (question, timeout, signal) => this.requestExtensionUi(
        { method: "ask_user", ...question },
        null,
        (response) => "answer" in response ? response.answer : null,
        timeout,
        signal,
      ),
      notify: (message, type) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "notify",
          message,
          notifyType: type,
        } as ExtensionUiRequest as AgentEvent);
      },
      onTerminalInput: () => () => {},
      setStatus: (key, text) => {
        if (text === undefined) this.extensionStatuses.delete(key);
        else this.extensionStatuses.set(key, text);
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setStatus",
          statusKey: key,
          statusText: text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setWorkingMessage: () => {},
      setWorkingVisible: () => {},
      setWorkingIndicator: () => {},
      setHiddenThinkingLabel: () => {},
      setWidget: (key, content, options) => {
        if (!this._alive || this.extensionWidgetsResetting) return;
        if (typeof content === "function") {
          this.setExtensionWidgetFactory(
            key,
            content as unknown as ExtensionWidgetFactory,
            options,
          );
          return;
        }
        if (content !== undefined && !Array.isArray(content)) return;
        if (content === undefined) {
          this.clearExtensionWidget(key);
          return;
        }
        const generation = this.activeExtensionWidgets.has(key)
          ? this.clearExtensionWidget(key)
          : this.nextExtensionWidgetGeneration(key);
        if (this.extensionWidgetGenerations.get(key) !== generation) return;
        this.extensionWidgets.set(key, {
          key,
          lines: content,
          placement: options?.placement ?? "aboveEditor",
        });
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setWidget",
          widgetKey: key,
          widgetLines: content,
          widgetPlacement: options?.placement,
        } as ExtensionUiRequest as AgentEvent);
      },
      setFooter: () => {},
      setHeader: () => {},
      setTitle: (title) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "setTitle",
          title,
        } as ExtensionUiRequest as AgentEvent);
      },
      custom: <T = unknown>(factory: unknown, options?: unknown) => this.requestExtensionCustomUi<T>(factory, options),
      pasteToEditor: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      setEditorText: (text) => {
        this.emit({
          type: "extension_ui_request",
          id: randomUUID(),
          method: "set_editor_text",
          text,
        } as ExtensionUiRequest as AgentEvent);
      },
      getEditorText: () => "",
      addAutocompleteProvider: () => {},
      setEditorComponent: () => {},
      getEditorComponent: () => undefined,
      get theme() { return PLAIN_TEXT_THEME; },
      getAllThemes: () => [],
      getTheme: () => undefined,
      setTheme: () => ({ success: false, error: "Theme switching is not supported in Pi Web extension UI yet" }),
      getToolsExpanded: () => false,
      setToolsExpanded: () => {},
    };
  }

  private createExtensionCommandContextActions(): ExtensionCommandContextActionsLike {
    return {
      waitForIdle: async () => {
        const agent = this.inner.agent as { waitForIdle?: () => Promise<void> };
        await agent.waitForIdle?.();
      },
      newSession: async () => ({ cancelled: true }),
      fork: async () => ({ cancelled: true }),
      navigateTree: async (targetId, options) => {
        const result = await this.inner.navigateTree(targetId, { summarize: options?.summarize });
        return { cancelled: result.cancelled };
      },
      switchSession: async () => ({ cancelled: true }),
      reload: async () => {
        this.extensionStatuses.clear();
        this.resetExtensionWidgetsForReload();
        this.syncProjectTrust();
        invalidateSettingsListingRuntime();
        try {
          await this.inner.reload({
            beforeSessionStart: () => {
              this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
            },
          });
        } finally {
          invalidateSettingsListingRuntime();
          invalidateModelsCache();
        }
      },
    };
  }

  private syncProjectTrust(): void {
    const status = getProjectTrustStatus(this.cwd, getAgentDir());
    this.inner.settingsManager.setProjectTrusted(status.trusted);
  }
}

// ============================================================================
// Session registry
// ============================================================================

declare global {
  var __piSessions: Map<string, AgentSessionWrapper> | undefined;
  var __piStartLocks: Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> | undefined;
  // Canonical persisted SDK IDs, not URL/start aliases. Survives module/HMR reload.
  var __piOwnedRetirements: Map<string, Promise<void>> | undefined;
  var __piAccountSwitchLocks: Map<string, Promise<void>> | undefined;
  var __piStartingSessionCwds: Map<string, number> | undefined;
  var __piActivityReviewPersistenceFailed: boolean | undefined;
}

function recordRpcSessionCompletion(sessionId: string): void {
  try {
    recordActivityCompletion(sessionId);
    globalThis.__piActivityReviewPersistenceFailed = false;
  } catch (error) {
    // A metadata failure must never turn a finished agent run into a failed one.
    globalThis.__piActivityReviewPersistenceFailed = true;
    console.error("[pi-web] failed to persist activity completion:", error instanceof Error ? error.message : error);
  }
}

export function activityReviewPersistenceFailed(): boolean {
  return globalThis.__piActivityReviewPersistenceFailed === true;
}

export function getRecentRpcSessionCompletions(): SessionCompletion[] {
  return readActivityReview().completedRuns;
}

function getRegistry(): Map<string, AgentSessionWrapper> {
  if (!globalThis.__piSessions) {
    globalThis.__piSessions = new Map();
    const destroy = () => globalThis.__piSessions?.forEach((session) => session.destroy());
    const shutdown = () => {
      const sessions = Array.from(globalThis.__piSessions?.values() ?? []);
      void Promise.allSettled(sessions.map((session) => session.shutdown()));
    };
    // Node cannot await work from an exit handler; direct destruction starts
    // extension cleanup synchronously as a final best effort.
    process.once("exit", destroy);
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
  return globalThis.__piSessions;
}

function registerRpcWrapper(wrapper: AgentSessionWrapper): void {
  const registry = getRegistry();
  const sessionId = wrapper.sessionId;
  if (wrapper.sessionFile) cacheSessionPath(sessionId, wrapper.sessionFile);
  wrapper.onDestroy(() => {
    // Extension shutdown can finish after a replacement was registered.
    if (registry.get(sessionId) === wrapper) registry.delete(sessionId);
  });
  registry.set(sessionId, wrapper);
  wrapper.start();
  if (!wrapper.isChatOnly()) wrapper.beginExtensionBinding();
}

const SUBAGENT_CONTROLLER = createSubagentController({
  getSession: (sessionId) => getRegistry().get(sessionId),
  registerSession: (inner, options) => {
    const wrapper = new AgentSessionWrapper(inner, {
      ...(options?.exactSystemPrompt !== undefined
        ? { exactSystemPrompt: () => options.exactSystemPrompt! }
        : {}),
      chatOnly: options?.chatOnly,
      suppressCompletionNotifications: true,
    });
    registerRpcWrapper(wrapper);
  },
  reopenSession: async (sessionId, sessionFile) =>
    (await startRpcSession(sessionId, sessionFile, undefined)).session,
  resolveSessionPath,
  invalidateSessionList: invalidateSessionListCache,
  isBuiltInSubagentsEnabled,
});

export function getSubagentRun(sessionId: string) {
  return SUBAGENT_CONTROLLER.get(sessionId);
}

export function steerSubagent(sessionId: string, message: string) {
  return SUBAGENT_CONTROLLER.steer(sessionId, message);
}

export function abortSubagent(sessionId: string) {
  return SUBAGENT_CONTROLLER.abort(sessionId);
}

function getOwnedRetirements(): Map<string, Promise<void>> {
  return globalThis.__piOwnedRetirements ??= new Map();
}

function getLocks(): Map<string, Promise<{ session: AgentSessionWrapper; realSessionId: string }>> {
  if (!globalThis.__piStartLocks) globalThis.__piStartLocks = new Map();
  return globalThis.__piStartLocks;
}

function normalizeRpcCwd(cwd: string): string {
  const resolvedCwd = resolve(cwd);
  try {
    return realpathSync(resolvedCwd);
  } catch {
    return resolvedCwd;
  }
}

function getStartingSessionCwds(): Map<string, number> {
  if (!globalThis.__piStartingSessionCwds) globalThis.__piStartingSessionCwds = new Map();
  return globalThis.__piStartingSessionCwds;
}

function trackStartingSession(cwd: string): () => void {
  const startingCwds = getStartingSessionCwds();
  const key = assertDirectoryAdmissionAllowed(cwd);
  startingCwds.set(key, (startingCwds.get(key) ?? 0) + 1);
  return () => {
    const remaining = (startingCwds.get(key) ?? 1) - 1;
    if (remaining > 0) startingCwds.set(key, remaining);
    else startingCwds.delete(key);
  };
}

export function getRpcSession(sessionId: string): AgentSessionWrapper | undefined {
  return getRegistry().get(sessionId);
}

export interface SetRpcSessionToolsResult {
  session: AgentSessionWrapper;
  sessionId: string;
  recreated: boolean;
}

/**
 * Persist a normal session's tool selection and rebuild when resource policy changes.
 * An undefined requestedToolNames returns the session to pi's configured defaults:
 * the pin is retracted and the session is rebuilt, because the loadout that
 * settings.json defaultTools resolves to is only known once pi builds the session.
 */
export async function setRpcSessionTools(
  sessionId: string,
  sessionFile: string | undefined,
  requestedToolNames: unknown,
): Promise<SetRpcSessionToolsResult> {
  const toolNames = requestedToolNames === undefined
    ? undefined
    : validateSessionToolSelection(requestedToolNames);
  const existing = getRpcSession(sessionId);

  if (!existing?.isAlive()) {
    if (!sessionFile) throw new Error("Session not found");
    const manager = SessionManager.open(sessionFile, undefined);
    if (readSubagentSessionResources(manager.getEntries() as unknown as SessionEntry[])) {
      throw new Error("Subagent tool selection is fixed by its profile");
    }
    if (toolNames === undefined) appendClearedSessionToolSelection(manager);
    else appendSessionToolSelection(manager, toolNames);
    invalidateSessionListCache();
    const started = await startRpcSession(sessionId, sessionFile, undefined);
    return { session: started.session, sessionId: started.realSessionId, recreated: false };
  }

  if (existing.isRunning()) throw new Error("Cannot change tools while the session is running");
  assertModelRuntimeSessionReady(existing.inner);
  if (readSubagentSessionResources(existing.inner.sessionManager.getEntries() as unknown as SessionEntry[])) {
    throw new Error("Subagent tool selection is fixed by its profile");
  }

  const hasCurrentResourcePolicy = typeof existing.isChatOnly === "function"
    && typeof existing.setActiveToolSelection === "function";
  const crossesChatOnlyBoundary = toolNames === undefined
    || !hasCurrentResourcePolicy
    || existing.isChatOnly() !== (toolNames.length === 0);
  if (toolNames === undefined) appendClearedSessionToolSelection(existing.inner.sessionManager);
  else appendSessionToolSelection(existing.inner.sessionManager, toolNames);
  invalidateSessionListCache();

  if (toolNames !== undefined && !crossesChatOnlyBoundary) {
    existing.setActiveToolSelection(toolNames);
    return { session: existing, sessionId, recreated: false };
  }

  const persistedFile = existing.sessionFile && existsSync(existing.sessionFile)
    ? existing.sessionFile
    : undefined;
  const sessionCwd = existing.cwd;
  const model = existing.inner.model;
  const currentThinkingLevel = existing.inner.agent.state?.thinkingLevel;
  const modelSpeed = readSessionModelSpeed(existing.inner.sessionManager.getEntries() as unknown as SessionEntry[]);
  const nativeResources = readNativeResourceSelection(existing.inner.sessionManager.getEntries());
  await existing.shutdown();

  if (persistedFile) {
    const started = await startRpcSession(sessionId, persistedFile, undefined);
    return { session: started.session, sessionId: started.realSessionId, recreated: true };
  }

  const started = await startRpcSessionInternal(`__recreate__${randomUUID()}`, "", sessionCwd, {
    modelSpeed, nativeResources,
    ...(toolNames !== undefined ? { toolNames } : {}),
    ...(model ? { initialModel: { provider: model.provider, modelId: model.id } } : {}),
    allowInitialModelFallback: true,
    ...(currentThinkingLevel && THINKING_LEVEL_NAMES.has(currentThinkingLevel as ThinkingLevel)
      ? { thinkingLevel: currentThinkingLevel as ThinkingLevel }
      : {}),
  });
  return { session: started.session, sessionId: started.realSessionId, recreated: true };
}

/** Explicit selected-session replacement, serialized with account changes. No
 * other wrapper's activity is awaited and no SDK session_start callback prepares
 * resources. Preflight is inert; shutdown precedes new connection ownership. */
export async function setRpcSessionNativeResources(sessionId: string, sessionFile: string | undefined, requested: unknown): Promise<SetRpcSessionToolsResult> {
  const nativeResources = validateNativeResourceSelection(requested);
  const locks = (globalThis.__piAccountSwitchLocks ??= new Map<string, Promise<void>>());
  const previous = locks.get(sessionId);
  let release!: () => void;
  const finished = new Promise<void>(resolve => { release = resolve; });
  locks.set(sessionId, finished);
  try {
    if (previous) await previous;
    // A persisted session may be restoring before registry publication. Wait
    // for this ID's startup, then replace that actual owner rather than adopting it.
    const starting = getLocks().get(sessionId);
    if (starting) await starting;
    const existing = getRpcSession(sessionId);
    if (existing?.isRunning()) throw new Error("Cannot change native resources while this session is running");
    if (existing?.isAlive()) assertModelRuntimeSessionReady(existing.inner);
    const manager = existing?.isAlive() ? existing.inner.sessionManager : sessionFile ? SessionManager.open(sessionFile, undefined) : undefined;
    if (!manager || manager.getSessionId() !== sessionId) throw new Error("Session not found");
    if (readSubagentSessionResources(manager.getEntries() as unknown as SessionEntry[])) throw new Error("Native resources are not available to child sessions");
    const toolNames = readSessionToolSelection(manager.getEntries() as unknown as SessionEntry[]);
    const persisted = manager.getSessionFile();
    if (!manager.isPersisted() || !persisted) throw new Error("Native tools require a persistent session");
    const agentDir = getAgentDir();
    const preflight = await createNativeSessionTools({ agentDir, cwd: manager.getCwd(), selection: effectiveNativeResourceSelection(nativeResources, {
      chatOnly: existing?.isAlive() ? existing.isChatOnly() : toolNames?.length === 0,
      projectTrusted: getProjectTrustStatus(manager.getCwd(), agentDir).trusted,
    }) });
    preflight.retire();
    if (getRpcSession(sessionId) !== existing || getLocks().has(sessionId)
      || existing && (!existing.isAlive() || existing.isRunning())) throw new Error("Session changed during native resource preflight");
    if (existing?.isAlive()) existing.saveNativeResourceIntent(nativeResources);
    else appendNativeResourceSelection(manager, nativeResources);
    if (!existsSync(persisted)) throw new Error("Native resource intent was not persisted");
    invalidateSessionListCache();
    if (existing?.isAlive()) await existing.shutdown();
    if (getRpcSession(sessionId)?.isAlive() || getLocks().has(sessionId)) throw new Error("Session changed during native resource replacement");
    const started = await startRpcSession(sessionId, persisted, undefined);
    return { session: started.session, sessionId: started.realSessionId, recreated: true };
  } finally { release(); if (locks.get(sessionId) === finished) locks.delete(sessionId); }
}

export function waitForSessionAccountSwitch(sessionId: string): Promise<void> | undefined {
  return globalThis.__piAccountSwitchLocks?.get(sessionId);
}

export async function setRpcSessionAccount(sessionId: string, sessionFile: string | undefined, provider: string, accountId: string | null): Promise<string> {
  const locks = (globalThis.__piAccountSwitchLocks ??= new Map<string, Promise<void>>());
  const previous = locks.get(sessionId);
  let release!: () => void;
  const finished = new Promise<void>((resolve) => { release = resolve; });
  locks.set(sessionId, finished);
  try {
    if (previous) await previous;
    const existing = getRpcSession(sessionId);
    if (existing?.isRunning()) throw new Error("Cannot switch accounts while the session is running");
    if (existing?.isAlive()) assertModelRuntimeSessionReady(existing.inner);
    const manager = existing?.isAlive() ? existing.inner.sessionManager
      : sessionFile ? SessionManager.open(sessionFile, undefined) : undefined;
    if (!manager) throw new Error("Session not found");
    if (readSubagentSessionResources(manager.getEntries() as unknown as SessionEntry[])) {
      throw new Error("Subagent accounts are inherited from the parent run");
    }
    const current = readSessionAccounts(manager.getEntries() as unknown as SessionEntry[]) ?? {};
    const next = { ...current };
    if (accountId === null) delete next[provider];
    else next[provider] = accountId;
    validateAccountSelection(next);
    const pinnedTools = readSessionToolSelection(manager.getEntries() as unknown as SessionEntry[]);
    const model = existing?.isAlive() ? existing.inner.model : null;
    const thinking = existing?.isAlive() ? existing.inner.agent.state?.thinkingLevel : undefined;
    if (existing?.isAlive()) await existing.shutdown();
    const persisted = manager.getSessionFile();
    if (persisted && existsSync(persisted)) {
      appendSessionAccounts(manager, next);
      invalidateSessionListCache();
      const started = await startRpcSession(sessionId, persisted, undefined);
      return started.realSessionId;
    }
    // An initialized composer has not written a session file yet: preserve its
    // model, thinking and tool choices.
    const started = await startRpcSessionInternal(`__recreate__${randomUUID()}`, "", manager.getCwd(), {
      accounts: next,
      modelSpeed: readSessionModelSpeed(manager.getEntries() as unknown as SessionEntry[]),
      nativeResources: readNativeResourceSelection(manager.getEntries()),
      ...(pinnedTools !== undefined ? { toolNames: pinnedTools } : {}),
      ...(model ? { initialModel: { provider: model.provider, modelId: model.id } } : {}),
      allowInitialModelFallback: true,
      ...(thinking && THINKING_LEVEL_NAMES.has(thinking as ThinkingLevel)
        ? { thinkingLevel: thinking as ThinkingLevel }
        : {}),
    });
    return started.realSessionId;
  } finally {
    release();
    if (locks.get(sessionId) === finished) locks.delete(sessionId);
  }
}

function runtimeMessageText(entry: SessionMessageEntry): string {
  if (entry.message.role === "bashExecution") return "";
  const content = entry.message.content;
  if (typeof content === "string") return content;
  return content
    .map((block) => block.type === "text" ? block.text : "")
    .filter(Boolean)
    .join(" ");
}

function runtimeMessageActivityMs(entry: SessionMessageEntry): number | undefined {
  if (entry.message.role !== "user" && entry.message.role !== "assistant") return undefined;
  if (typeof entry.message.timestamp === "number") return entry.message.timestamp;
  const timestamp = new Date(entry.timestamp).getTime();
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

/**
 * Return live sessions that should be visible in the session list. Pi delays
 * the first JSONL flush until an assistant message exists, so an accepted new
 * prompt must temporarily be described from its in-memory SessionManager.
 */
export function getRpcSessionInfos(options: { includeTransient?: boolean } = {}): SessionInfo[] {
  const sessions: SessionInfo[] = [];
  for (const session of getRegistry().values()) {
    if (typeof session.isAlive !== "function" || !session.isAlive()) continue;

    const manager = session.inner?.sessionManager;
    if (!manager) continue;
    const header = manager.getHeader();
    const entries = manager.getEntries() as unknown as Array<
      { type: string; timestamp: string } | SessionMessageEntry
    >;
    const messages = entries.filter((entry): entry is SessionMessageEntry => entry.type === "message");
    const firstUserMessage = messages.find((entry) => entry.message.role === "user");
    const sessionFile = manager.getSessionFile() ?? session.sessionFile;
    const persisted = Boolean(sessionFile && existsSync(sessionFile));
    const subagent = readSubagentRun(entries as unknown as SessionEntry[], header?.id ?? session.sessionId, sessionFile ?? "");
    const spawn = sessionSpawnFromEntries(entries as unknown as SessionEntry[], header?.id ?? session.sessionId);

    // An ensure_session call creates an idle, empty runtime while the composer
    // loads commands. Do not leak it into history before a prompt is accepted.
    if (!persisted && !options.includeTransient && (!session.isRunning() || !firstUserMessage)) continue;

    const created = header?.timestamp
      ?? entries[0]?.timestamp
      ?? new Date().toISOString();
    const headerTimestamp = new Date(created).getTime();
    let lastActivityMs = Number.isNaN(headerTimestamp) ? Date.now() : headerTimestamp;
    for (const message of messages) {
      const activityMs = runtimeMessageActivityMs(message);
      if (activityMs !== undefined) lastActivityMs = Math.max(lastActivityMs, activityMs);
    }

    sessions.push({
      path: sessionFile ?? "",
      id: header?.id ?? session.sessionId,
      cwd: header?.cwd ?? session.cwd,
      name: manager.getSessionName(),
      created,
      modified: new Date(lastActivityMs).toISOString(),
      messageCount: messages.length,
      firstMessage: firstUserMessage ? runtimeMessageText(firstUserMessage) || "(no messages)" : "(no messages)",
      ...(spawn ? { spawnedBy: spawn.creatorSessionId } : {}),
      ...(subagent ? {
        parentSessionId: subagent.parentSessionId,
        relation: {
          kind: "subagent" as const,
          parentSessionId: subagent.parentSessionId,
          profile: subagent.profile,
          description: subagent.description,
          status: session.isRunning() ? "running" as const : subagent.status,
        },
      } : {}),
      transient: !persisted,
    });
  }
  return sessions;
}

/** Includes descendants and starting sessions without altering exact-cwd lifecycle helpers. */
export function hasBusyRpcSessionWithin(directory: string): boolean {
  const roots = new Set([physicalDirectoryPath(directory)]);
  for (const [cwd, count] of getStartingSessionCwds()) {
    if (count > 0 && isPathWithinRoots(physicalDirectoryPath(cwd), roots)) return true;
  }
  for (const session of getRegistry().values()) {
    if (session.isRunning() && isPathWithinRoots(physicalDirectoryPath(session.cwd), roots)) return true;
  }
  return false;
}

export function hasBusyRpcSessionForCwd(cwd: string, exceptSessionId?: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => (!exceptSessionId || session.sessionId !== exceptSessionId) && normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export async function destroyRpcSessionsForCwd(cwd: string): Promise<number> {
  const targetCwd = normalizeRpcCwd(cwd);
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => normalizeRpcCwd(session.cwd) === targetCwd,
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

/** A repository trust change affects sessions in every registered worktree, including subdirectories. */
export async function destroyRpcSessionsInWorktrees(worktrees: readonly string[]): Promise<number> {
  const roots = new Set(worktrees.map(physicalDirectoryPath));
  const sessions = Array.from(getRegistry().values()).filter(
    (session) => isPathWithinRoots(physicalDirectoryPath(session.cwd), roots),
  );
  await Promise.all(sessions.map((session) => session.shutdown()));
  return sessions.length;
}

export function getRpcSessionAttention(): SessionAttention[] {
  return [...getRegistry().values()].flatMap((session) => {
    const attention = session.getPendingAttention?.();
    return attention ? [attention] : [];
  });
}

export function getRunningRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning()) ids.add(session.sessionId || sessionId);
  }
  return [...ids];
}

export function getCompletionNotificationSuppressedRpcSessionIds(): string[] {
  const ids = new Set<string>();
  for (const [sessionId, session] of getRegistry()) {
    if (session.isRunning() && session.hasSuppressedCompletionNotifications()) {
      ids.add(session.sessionId || sessionId);
    }
  }
  return [...ids];
}

/**
 * Get or create an AgentSession for the given session.
 * For new sessions (sessionFile === ""), pi generates its own id.
 * New sessions resolve enabledModels before construction so the initial model,
 * thinking pin, and SDK scopedModels share one settings snapshot.
 * Pass options.toolNames to pre-configure active tools (empty = all disabled).
 */
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string | undefined,
  options: RpcSessionStartOptions = {},
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  return startRpcSessionInternal(sessionId, sessionFile, cwd, options);
}

/** Recreation state is internal only, never a caller-controlled startup grant. */
async function startRpcSessionInternal(
  sessionId: string, sessionFile: string, cwd: string | undefined, options: RpcSessionStartOptions,
): Promise<{ session: AgentSessionWrapper; realSessionId: string }> {
  const { initialModel, allowInitialModelFallback, thinkingLevel, modelSpeed } = options;
  if (options.initialPromptOwner !== undefined && sessionFile) throw new Error("Initial prompt ownership requires a fresh session");
  if (modelSpeed !== undefined && !isModelSpeed(modelSpeed)) {
    throw new Error("Invalid model speed: expected standard or fast");
  }
  const requestedToolNames = options.toolNames === undefined
    ? undefined
    : validateSessionToolSelection(options.toolNames);
  const registry = getRegistry();
  const locks = getLocks();

  const header = sessionFile ? readSessionHeader(sessionFile) : undefined;
  const startupSessionId = sessionFile ? header?.id : sessionId;
  if (!startupSessionId) throw new Error("Cannot prove persisted SDK session ID");
  const existing = registry.get(startupSessionId);
  if (existing?.isAlive()) {
    if (options.initialPromptOwner !== undefined) throw new Error("Initial prompt ownership cannot adopt an existing session");
    assertDirectoryAdmissionAllowed(existing.cwd);
    return { session: existing, realSessionId: existing.sessionId };
  }

  const inflight = locks.get(startupSessionId);
  if (inflight) {
    if (options.initialPromptOwner !== undefined) throw new Error("Initial prompt ownership cannot adopt an in-flight session");
    return inflight;
  }

  const expectedCwd = sessionFile ? header?.cwd : cwd;
  if (!expectedCwd) throw new Error("Cannot prove session cwd");
  // Check and publish startup before any await (including account lookup), so
  // reservations cannot slip between admission and resource construction.
  const finishStartingSession = trackStartingSession(expectedCwd);
  const starting = (async () => {
    // Old public dispose cleans SDK resources by session ID. Do not construct
    // replacement resources until it succeeds, even if its wrapper is dead.
    const retirement = getOwnedRetirements().get(startupSessionId);
    if (retirement) await retirement;
    let sessionManager: SessionManager;
    if (sessionFile) {
      sessionManager = SessionManager.open(sessionFile, undefined);
    } else {
      if (!cwd) throw new Error("cwd is required for a new session");
      sessionManager = SessionManager.create(cwd, undefined);
    }
    if (sessionFile && sessionManager.getSessionId() !== startupSessionId) throw new Error("Persisted SDK session ID changed during startup");
    const sessionCwd = sessionManager.getCwd();
    if (!samePath(sessionCwd, expectedCwd)) throw new Error("Session cwd changed during startup");
    const subagentResources = sessionFile
      ? readSubagentSessionResources(
          sessionManager.getEntries() as unknown as SessionEntry[],
        )
      : null;
    const persistedToolNames = subagentResources
      ? undefined
      : readSessionToolSelection(sessionManager.getEntries() as unknown as SessionEntry[]);
    const selectedToolNames = subagentResources?.tools ?? persistedToolNames ?? requestedToolNames;
    const requestedNativeResources = subagentResources ? NO_NATIVE_RESOURCES
      : sessionFile ? readNativeResourceSelection(sessionManager.getEntries())
      : options.nativeResources === undefined ? NO_NATIVE_RESOURCES : validateNativeResourceSelection(options.nativeResources);
    if (options.initialPromptOwner !== undefined && (requestedNativeResources.codeMode || requestedNativeResources.mcpServers.length)) {
      // Launch-owned pre-acceptance refusal has a bounded disposal path. Native
      // resources are enabled only by the user after that independent launch.
      throw new Error("Launch-owned sessions cannot enable native tools before initial prompt acceptance");
    }
    if (!sessionFile && !subagentResources) appendNativeResourceSelection(sessionManager, requestedNativeResources);
    // Project defaults are snapshotted only at creation. Old sessions with no
    // entry remain bound to Pi's default auth.json, regardless of project changes.
    const accounts = readSessionAccounts(sessionManager.getEntries() as unknown as SessionEntry[])
      ?? (sessionFile ? {} : options.accounts ?? await getProjectAccounts(sessionCwd));
    validateAccountSelection(accounts);
    if (!sessionFile) {
      appendSessionAccounts(sessionManager, accounts);
      appendSessionModelSpeed(sessionManager, modelSpeed ?? "standard");
    }
    if (!subagentResources && persistedToolNames === undefined && requestedToolNames !== undefined) {
      appendSessionToolSelection(sessionManager, requestedToolNames);
    }
    const subagentLoadsResources = Boolean(
      subagentResources?.loadExtensions || subagentResources?.loadSkills,
    );
    const chatOnly = selectedToolNames?.length === 0 && !subagentLoadsResources;
    // Some extensions access the SDK's global theme even outside the terminal UI.
    if (!chatOnly) initTheme();
    const agentDir = getAgentDir();
    const nativeSelection = effectiveNativeResourceSelection(requestedNativeResources, {
      chatOnly, projectTrusted: getProjectTrustStatus(sessionCwd, agentDir).trusted,
    });
    const nativeSessionTools = await createNativeSessionTools({ agentDir, cwd: sessionCwd, selection: nativeSelection });

    // Determine which tools to pass based on requested toolNames.
    // Since v0.68.0, session creation expects string[] tool names instead of Tool[] instances.
    let toolsOption: string[] | undefined = subagentResources?.tools;
    if (!subagentResources && selectedToolNames !== undefined) {
      // toolNames === [] -> "all off" (an empty allow-list disables every tool).
      // Otherwise DO NOT pass a builtin-only allow-list: passing CODING_TOOL_NAMES
      // set allowedToolNames to coding builtins only, which filtered every
      // extension/package-provided tool (e.g. subagents, web access) out of the
      // tool registry — so they were unavailable in Pi Web sessions even though the
      // `pi` CLI keeps them. Leaving the allow-list unset lets the SDK register all
      // tools (and activate extension tools); we narrow the ACTIVE set below.
      toolsOption = selectedToolNames.length === 0 ? [] : undefined;
    }

    // Build services first so extension-registered providers are available
    // before the SDK restores the saved model from the session file.
    // Gate untrusted project extensions so opening a repository does not run
    // its .pi/extensions code automatically (see lib/project-trust.ts, #236).
    const trustReloadOptions = subagentResources
      ? subagentLoadsResources
        ? projectTrustReloadOptions(sessionCwd, agentDir)
        : undefined
      : chatOnly
        ? undefined
        : projectTrustReloadOptions(sessionCwd, agentDir);
    const settingsManager = SettingsManager.create(sessionCwd, agentDir);
    // Chat-only sessions and subagents that replace Pi's prompt send an exact
    // system prompt. The prompt is resolved at prompt time through this inline
    // extension: it may read the session's context files, which exist only
    // after the session is created, so the getter is filled in below.
    const exactSystemPromptRef: { current?: () => string } = {};
    const exactSystemPromptExtension = createExactSystemPromptExtension(() => exactSystemPromptRef.current?.());
    const usesExactSystemPrompt = chatOnly || subagentResources?.exactSystemPrompt !== undefined;
    const promptObserver = options.observePrompt ? [{ name: "pi-web-launch-prompt-observer", hidden: true,
      factory: (pi: import("@earendil-works/pi-coding-agent").ExtensionAPI) => {
        pi.on("before_agent_start", (event) => {
          if (event.messageType === "user") options.observePrompt?.(event.prompt);
        });
      },
    }] : [];
    const accountRuntime = Object.keys(accounts).length > 0
      ? await createAccountModelRuntime(accounts, { agentDir })
      : undefined;
    const services = await createAgentSessionServices({
      cwd: sessionCwd,
      ...(accountRuntime ? { modelRuntime: accountRuntime } : {}),
      agentDir,
      settingsManager,
      resourceLoaderOptions: subagentResources
        ? {
            noExtensions: !subagentResources.loadExtensions,
            noSkills: !subagentResources.loadSkills,
            noPromptTemplates: true,
            noThemes: true,
            noContextFiles: true,
            ...(chatOnly
              ? {
                  systemPrompt: " ",
                  systemPromptOverride: () => undefined,
                }
              : {}),
            appendSystemPrompt: subagentResources.appendSystemPrompt,
            extensionFactories: [
              ...nativeSessionTools.factories,
              ...(usesExactSystemPrompt ? [exactSystemPromptExtension] : [createLocalFileLinkGuidanceExtension()]),
              ...(subagentResources.loadExtensions ? [createAskUserExtension()] : []),
            ],
            ...(subagentResources.loadExtensions ? { extensionsOverride: preferPiWebAskUserExtension } : {}),
          }
        : chatOnly
          ? { ...CHAT_ONLY_RESOURCE_LOADER_OPTIONS, extensionFactories: [exactSystemPromptExtension, createSessionReferenceExtension(), ...promptObserver] }
        : {
            extensionFactories: [
              ...nativeSessionTools.factories,
              createSessionReferenceExtension(),
              createPiWebSourceExtension(),
              createLocalFileLinkGuidanceExtension(),
              createProjectCommandBashExtension({
                cwd: sessionCwd,
                settings: settingsManager,
              }),
              createSubagentExtension(
                SUBAGENT_CONTROLLER.extensionRuntime,
                () => listSubagentProfiles(sessionCwd),
                isBuiltInSubagentsEnabled,
              ),
              createAskUserExtension(),
              ...bundledPluginExtensions(sessionCwd),
              ...promptObserver,
            ],
            extensionsOverride: (base) => preferUserBashExtension(preferPiWebAskUserExtension(preferPiWebSubagentExtension(base))),
          },
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const speedAgent: { current?: Agent } = {};
    services.modelRuntime = withModelRuntimeAccess(services.modelRuntime,
      withSessionModelSpeed(services.modelRuntime, sessionManager, () => speedAgent.current));
    const scope = await resolveVisibleModels(
      services.modelRuntime,
      services.settingsManager.getEnabledModels(),
    );
    const effectiveInitialModel = initialModel && (
      !allowInitialModelFallback
      || scope.visible.some((model) => model.provider === initialModel.provider && model.id === initialModel.modelId)
    )
      ? initialModel
      : undefined;
    const defaultProvider = services.settingsManager.getDefaultProvider();
    const defaultModelId = services.settingsManager.getDefaultModel();
    const branch = sessionManager.getBranch();
    // System messages carry the prompt and tool loadout, not a conversation.
    const hasExistingMessages = branch.some((entry) => entry.type === "message" && entry.message.role !== "system");
    const savedModel = sessionFile
      ? getLatestModelChange(branch as unknown as SessionEntry[])
      : null;
    const restoredModel = savedModel
      ? services.modelRuntime.getModel(savedModel.provider, savedModel.modelId)
      : undefined;
    const initial = hasExistingMessages || savedModel ? null : selectInitialModelScope(scope, {
        ...(effectiveInitialModel ? { requestedModel: effectiveInitialModel } : {}),
        ...(defaultProvider && defaultModelId
          ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
          : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
    const startupModel = restoredModel && services.modelRuntime.hasConfiguredAuth(restoredModel.provider)
      ? restoredModel
      : initial?.model;
    // SDK restoration keys off message presence, but an explicit model/thinking
    // selection is durable even before the first conversation message.
    const savedThinking = sessionFile
      ? branch.findLast((entry) => entry.type === "thinking_level_change")?.thinkingLevel : undefined;
    const startupThinking = initial?.thinkingLevel ?? (savedThinking && THINKING_LEVEL_NAMES.has(savedThinking as ThinkingLevel)
      ? savedThinking as ThinkingLevel : undefined);
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(startupModel ? { model: startupModel } : {}),
      ...(startupThinking ? { thinkingLevel: startupThinking } : {}),
      ...(scope.scopedModels.length > 0 ? { scopedModels: [...scope.scopedModels] } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
      ...(subagentResources ? { excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES] } : {}),
    });
    speedAgent.current = inner.agent;

    const persistedPreferences = options.persistPreferences === false ? { modelDefaultChanged: false } : await persistExplicitStartupPreferences(
      services.settingsManager,
      {
        ...(effectiveInitialModel ? { model: effectiveInitialModel } : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      },
      {
        ...(inner.model
          ? { model: { provider: inner.model.provider, modelId: inner.model.id } }
          : {}),
        thinkingLevel: inner.thinkingLevel,
        supportsThinking: inner.supportsThinking(),
      },
    );
    if (persistedPreferences.modelDefaultChanged) invalidateModelsCache();

    // If specific tool names were requested (non-empty), set the active tools to the
    // requested builtin coding tools PLUS all extension/package tools, so installed
    // extensions stay usable in Pi Web just like in the `pi` CLI.
    if (!subagentResources && !chatOnly) {
      inner.setActiveToolsByName(withExtensionTools(inner, selectedToolNames ?? inner.getActiveToolNames()));
    }

    const exactSystemPrompt = subagentResources?.exactSystemPrompt !== undefined
      ? () => subagentResources.exactSystemPrompt!
      : chatOnly
        ? subagentResources
          ? () => subagentResources.appendSystemPrompt[0] ?? ""
          : () => contextFilesSystemPrompt(inner.resourceLoader.getAgentsFiles().agentsFiles)
        : undefined;
    exactSystemPromptRef.current = exactSystemPrompt;
    const wrapper = new AgentSessionWrapper(inner, {
      exactSystemPrompt,
      chatOnly,
      initialPromptOwner: options.initialPromptOwner,
      monitorContextFiles: !subagentResources,
      nativeSessionTools,
      onAgentRunComplete: (completedSessionId) => {
        void notifySessionComplete(completedSessionId).catch((error) => {
          console.error("[pi-web] failed to send completion push:", error instanceof Error ? error.message : error);
        });
      },
      suppressCompletionNotifications: Boolean(subagentResources),
    });
    const realSessionId = inner.sessionId as string;
    registerRpcWrapper(wrapper);

    return { session: wrapper, realSessionId };
  })().finally(() => {
    if (locks.get(startupSessionId) === starting) locks.delete(startupSessionId);
    finishStartingSession();
  });

  locks.set(startupSessionId, starting);
  return await starting;
}
