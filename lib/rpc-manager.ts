import type { Agent, ThinkingLevel } from "@earendil-works/pi-agent-core";
import { createAgentSessionFromServices, createAgentSessionServices, getAgentDir, initTheme, ModelRuntime, SessionManager, SettingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { KeybindingsManager as TuiKeybindingsManager, TUI_KEYBINDINGS } from "@earendil-works/pi-tui";
import { randomUUID } from "crypto";
import { existsSync, realpathSync, writeFileSync } from "fs";
import { recordRunStart, recordRunSettlement } from "./session-run-recovery";
import { readActivityReview, recordActivityCompletion } from "./activity-review-server";
import { resolve } from "path";
import { validateAgentImages } from "./image-attachments";
import { accountCredentialStore, getProjectAccounts, validateAccountSelection, type AccountSelection } from "./provider-accounts";
import { appendSessionAccounts, readSessionAccounts } from "./session-accounts";
import { isModelSpeed, supportsModelSpeed, type ModelSpeed } from "./model-speed";
import { appendSessionModelSpeed, readSessionModelSpeed } from "./session-model-speed";
import { withSessionModelSpeed } from "./session-model-speed-runtime";
import { samePath } from "./paths";
import { readSessionHeader } from "./session-reader";
import { invalidateModelsCache } from "./models-cache";
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
import { createSubagentController } from "./subagent-runtime";
import { isBuiltInSubagentsEnabled } from "./subagent-settings";
import { resolveShellTools } from "./powershell-settings";
import { CHAT_ONLY_RESOURCE_LOADER_OPTIONS, contextFilesSystemPrompt } from "./chat-only";
import { haveContextFilesChanged } from "./context-file-changes";
import { createExactSystemPromptExtension } from "./exact-system-prompt";
import { createAskUserExtension, preferPiWebAskUserExtension, type AskUserUiContext } from "./ask-user-extension";
import { parseQuestionSet } from "./question-set";
import { createSessionReferenceExtension } from "./session-reference-extension";
import { createPiWebSourceExtension } from "./pi-web-source-extension";
import { bundledPluginExtensions } from "./plugins/registry";
import { validatePluginCard } from "./plugins/ui";
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
  exactSystemPrompt?: () => string;
  chatOnly?: boolean;
  monitorContextFiles?: boolean;
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

const SESSION_REPLACEMENT_COMMAND_TYPES = new Set(["fork", "clone"]);
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
  toolNames?: string[];
  accounts?: AccountSelection;
  initialModel?: { provider: string; modelId: string };
  allowInitialModelFallback?: boolean;
  thinkingLevel?: ThinkingLevel;
  modelSpeed?: ModelSpeed;
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
  const extensionToolNames = session.getAllTools().filter((t) => t.exposure !== "hidden").map((t) => t.name)
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
  private pendingPromptCount = 0;
  private activeMutatingCommands = 0;
  private sessionReplacement: "fork" | "clone" | null = null;
  private agentRunNeedsCompletion = false;
  private pendingCheckoutAdmissions = 0;
  private promptAdmissionTail: Promise<void> = Promise.resolve();
  private extensionsBound = false;
  private extensionBindingPromise: Promise<void> | null = null;
  private extensionBindingError: unknown = null;
  private readonly exactSystemPrompt?: () => string;
  private readonly chatOnly: boolean;
  private readonly monitorContextFiles: boolean;
  private readonly onAgentRunComplete?: AgentRunCompleteListener;
  private readonly suppressCompletionNotifications: boolean;
  private unsubscribe: (() => void) | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private onDestroyCallback: (() => void) | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private sessionShutdownEmitted = false;
  private forceShutdownOnIdle = false;
  private _alive = true;

  constructor(
    public readonly inner: AgentSessionLike,
    options: AgentSessionWrapperOptions = {},
  ) {
    this.exactSystemPrompt = options.exactSystemPrompt;
    this.chatOnly = options.chatOnly ?? false;
    this.monitorContextFiles = options.monitorContextFiles ?? false;
    this.onAgentRunComplete = options.onAgentRunComplete;
    this.suppressCompletionNotifications = options.suppressCompletionNotifications ?? false;
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
    return this._alive && (this.pendingPromptCount > 0 || this.pendingCheckoutAdmissions > 0 || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  /** Direct subagent prompts bypass send(); keep their OWN session busy during preflight. */
  beginCheckoutPromptAdmission(): () => void {
    assertDirectoryAdmissionAllowed(this.cwd);
    this.pendingCheckoutAdmissions += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingCheckoutAdmissions = Math.max(0, this.pendingCheckoutAdmissions - 1);
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
    if (!this.isAlive() || this.isRunning()) return false;
    const diskLatestId = readLatestSessionEntryId(this.sessionFile);
    if (!diskLatestId || this.inner.sessionManager.getEntry(diskLatestId)) return false;
    if (this.isRunning()) return false;
    this.destroy();
    invalidateSessionListCache();
    return true;
  }

  isChatOnly(): boolean {
    return this.chatOnly;
  }

  hasSuppressedCompletionNotifications(): boolean {
    return this.suppressCompletionNotifications;
  }

  start(): void {
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
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
      this.emit(event);
      if (event.type === "agent_settled") this.notifyAgentRunCompleteIfIdle();
    });
    this.resetIdleTimer();
  }

  private notifyAgentRunCompleteIfIdle(): void {
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
    });

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
    }
  }

  setActiveToolSelection(toolNames: string[]): void {
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
    replacement: "fork" | "clone",
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

  private async shutdownAfterSessionReplacement(replacement: "fork" | "clone"): Promise<void> {
    try {
      await this.shutdown();
    } catch (error) {
      console.error(
        `[pi-web] ${replacement} succeeded, but source session shutdown failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  async send(command: Record<string, unknown>): Promise<unknown> {
    const type = command.type as string;
    const allowedDuringReplacement = COMMANDS_ALLOWED_DURING_SESSION_REPLACEMENT.has(type);
    if (this.sessionReplacement && !allowedDuringReplacement) {
      throw new Error("Session is being copied to a new session");
    }
    if (SESSION_REPLACEMENT_COMMAND_TYPES.has(type) && this.activeMutatingCommands > 0) {
      throw new Error(`Cannot ${type} while another session command is running`);
    }

    const tracksMutation = !allowedDuringReplacement;
    if (tracksMutation) this.activeMutatingCommands += 1;

    try {
      // Status reconciliation must not postpone forced cleanup after Stop.
      if (type !== "get_state") this.resetIdleTimer();
      if (this.shouldWaitForExtensions(type)) await this.waitForExtensionsBound();
      if (this.sessionReplacement && !allowedDuringReplacement) {
        throw new Error("Session is being copied to a new session");
      }

      if (type === "prompt" || type === "steer" || type === "follow_up") {
        const imageError = validateAgentImages(command.images);
        if (imageError) throw new Error(imageError);
      }

      switch (type) {
      case "prompt": {
        // Serialize only admission. Once the preceding prompt has either
        // passed or failed preflight, the SDK can atomically decide whether
        // this submission starts a run or joins its streaming queue.
        const releaseAdmission = await this.acquirePromptAdmission();
        try {
          // Recheck after extension binding and the serialized admission wait.
          // No await may separate this check from publishing pendingPromptCount.
          assertDirectoryAdmissionAllowed(this.cwd);
          if (this.inner.isBashRunning) {
            throw new Error("Cannot send a prompt while a shell command is running");
          }
          if (this.extensionUiAbortController.signal.aborted) {
            this.extensionUiAbortController = new AbortController();
          }
          const promptImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
          const streamingBehavior = command.streamingBehavior as "steer" | "followUp" | undefined;
          let preflightAccepted = false;
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
          let prompt: Promise<void>;
          try {
            prompt = this.inner.prompt(command.message as string, {
              ...(promptImages?.length ? { images: promptImages } : {}),
              ...(streamingBehavior ? { streamingBehavior } : {}),
              source: "rpc",
              // The SDK calls this with "started", "queued" or "handled" only
              // after accepting the submission; preflight failures reject instead.
              preflightResult: () => acceptPreflight(),
            });
          } catch (error) {
            finishPrompt();
            throw error;
          }

          void prompt.then(() => {
            // Compatibility fallback if a future SDK resolves without invoking
            // the internal callback. This waits for the run, but never acks early.
            acceptPreflight();
            finishPrompt();
            if (!streamingBehavior) this.emit({ type: "prompt_done" });
          }, (error) => {
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
          extensionStatuses: this.getExtensionStatuses(),
          extensionWidgets: this.getExtensionWidgets(),
        };
      }

      case "set_model": {
        const { provider, modelId } = command as { provider: string; modelId: string };
        let model = this.inner.modelRuntime.getModel(provider, modelId);
        if (!model) {
          await this.inner.modelRuntime.refresh({ allowNetwork: false });
          model = this.inner.modelRuntime.getModel(provider, modelId);
        }
        if (!model) throw new Error(`Model not found: ${provider}/${modelId}`);
        await this.inner.setModel(model);
        invalidateModelsCache();
        invalidateSessionListCache();
        return { id: model.id, provider: model.provider };
      }

      case "fork": {
        if (this.isSessionRunningForReplacement()) {
          throw new Error("Cannot fork while the session is running");
        }
        return this.withSessionReplacement("fork", async () => {
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
          const newSessionId = forkedManager.getSessionId();
          cacheSessionPath(newSessionId, newSessionFile);
          invalidateSessionListCache();
          await this.shutdownAfterSessionReplacement("fork");
          return { cancelled: false, newSessionId };
        });
      }

      case "fork_branch": {
        if (this.isSessionRunningForReplacement()) {
          throw new Error("Cannot fork while the session is running");
        }
        return this.withSessionReplacement("fork", async () => {
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
          const newSessionId = forkedManager.getSessionId();
          cacheSessionPath(newSessionId, forkedPath);
          invalidateSessionListCache();
          return { cancelled: false, newSessionId };
        });
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
        try {
          return await this.withFinalIdleReset(() =>
            this.inner.compact(command.customInstructions as string | undefined)
          );
        } finally {
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
        await this.inner.steer(command.message as string, steerImages?.length ? steerImages : undefined);
        return null;
      }

      case "follow_up": {
        const followImages = command.images as Array<{ type: "image"; data: string; mimeType: string }> | undefined;
        await this.inner.followUp(command.message as string, followImages?.length ? followImages : undefined);
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
        await this.inner.reload();
        this.setActiveToolSelection(activeToolNames);
        if (typeof this.inner.bindExtensions !== "function") {
          this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
        }
        invalidateModelsCache();
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
    } finally {
      if (tracksMutation) this.activeMutatingCommands = Math.max(0, this.activeMutatingCommands - 1);
    }
  }

  destroy(): void {
    if (!this._alive) return;
    this._alive = false;
    // Tell attached SSE listeners to drop this instance so the browser
    // EventSource errors and reconnects instead of staying OPEN on a dead wrapper.
    this.emit({ type: "session_shutdown" });
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.inner.isBashRunning) this.inner.abortBash();
    this.unsubscribe?.();
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
        this.inner.dispose();
      } finally {
        this.onDestroyCallback?.();
      }
    };

    // Always emit session_shutdown before dispose, even when callers skip
    // shutdown() (process exit, direct destroy). Await when possible so
    // extension MCP children can reap before the runner is invalidated.
    if (this.sessionShutdownEmitted) {
      finishDispose();
      return;
    }

    this.sessionShutdownEmitted = true;
    const emit = this.inner.extensionRunner?.emit;
    if (typeof emit !== "function") {
      finishDispose();
      return;
    }

    void (async () => emit.call(
      this.inner.extensionRunner,
      { type: "session_shutdown", reason: "quit" },
    ))()
      .catch((error) => {
        console.error(
          "[pi-web] session_shutdown before dispose failed:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(finishDispose);
  }

  async shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    if (!this._alive) return;

    this.shutdownPromise = (async () => {
      try {
        try {
          await this.waitForExtensionsBound();
        } catch (error) {
          console.error(
            "[pi-web] extension binding failed before session shutdown:",
            error instanceof Error ? error.message : error,
          );
        }
        if (!this.sessionShutdownEmitted) {
          this.sessionShutdownEmitted = true;
          await this.inner.extensionRunner.emit?.({ type: "session_shutdown", reason: "quit" });
        }
      } finally {
        this.destroy();
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
      isDirectoryInUse: (directory) => hasBusyRpcSessionWithin(directory) || hasActiveTerminalWithin(directory),
      reserveDirectory: (directory) => acquireDirectoryReservation(directory,
        (physical) => hasBusyRpcSessionWithin(physical) || hasActiveTerminalWithin(physical)),
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
        await this.inner.reload({
          beforeSessionStart: () => {
            this.inner.extensionRunner.setUIContext?.(this.createExtensionUiContext(), "rpc");
          },
        });
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
  wrapper.onDestroy(() => registry.delete(sessionId));
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
  await existing.shutdown();

  if (persistedFile) {
    const started = await startRpcSession(sessionId, persistedFile, undefined);
    return { session: started.session, sessionId: started.realSessionId, recreated: true };
  }

  const started = await startRpcSessionInternal(`__recreate__${randomUUID()}`, "", sessionCwd, {
    modelSpeed,
    ...(toolNames !== undefined ? { toolNames } : {}),
    ...(model ? { initialModel: { provider: model.provider, modelId: model.id } } : {}),
    allowInitialModelFallback: true,
    ...(currentThinkingLevel && THINKING_LEVEL_NAMES.has(currentThinkingLevel as ThinkingLevel)
      ? { thinkingLevel: currentThinkingLevel as ThinkingLevel }
      : {}),
  });
  return { session: started.session, sessionId: started.realSessionId, recreated: true };
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
  if (modelSpeed !== undefined && !isModelSpeed(modelSpeed)) {
    throw new Error("Invalid model speed: expected standard or fast");
  }
  const requestedToolNames = options.toolNames === undefined
    ? undefined
    : validateSessionToolSelection(options.toolNames);
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) {
    assertDirectoryAdmissionAllowed(existing.cwd);
    return { session: existing, realSessionId: sessionId };
  }

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  const expectedCwd = sessionFile ? readSessionHeader(sessionFile)?.cwd : cwd;
  if (!expectedCwd) throw new Error("Cannot prove session cwd");
  // Check and publish startup before any await (including account lookup), so
  // reservations cannot slip between admission and resource construction.
  const finishStartingSession = trackStartingSession(expectedCwd);
  const starting = (async () => {
    let sessionManager: SessionManager;
    if (sessionFile) {
      sessionManager = SessionManager.open(sessionFile, undefined);
    } else {
      if (!cwd) throw new Error("cwd is required for a new session");
      sessionManager = SessionManager.create(cwd, undefined);
    }
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
    const accountRuntime = Object.keys(accounts).length > 0
      ? await ModelRuntime.create({
          credentials: accountCredentialStore(accounts),
          modelsPath: resolve(agentDir, "models.json"),
          modelsStorePath: resolve(agentDir, "models-store.json"),
        })
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
              ...(usesExactSystemPrompt ? [exactSystemPromptExtension] : []),
              ...(subagentResources.loadExtensions ? [createAskUserExtension()] : []),
            ],
            ...(subagentResources.loadExtensions ? { extensionsOverride: preferPiWebAskUserExtension } : {}),
          }
        : chatOnly
          ? { ...CHAT_ONLY_RESOURCE_LOADER_OPTIONS, extensionFactories: [exactSystemPromptExtension, createSessionReferenceExtension()] }
        : {
            extensionFactories: [
              createSessionReferenceExtension(),
              createPiWebSourceExtension(),
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
            ],
            extensionsOverride: (base) => preferUserBashExtension(preferPiWebAskUserExtension(preferPiWebSubagentExtension(base))),
          },
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
    const speedAgent: { current?: Agent } = {};
    services.modelRuntime = withSessionModelSpeed(services.modelRuntime, sessionManager, () => speedAgent.current);
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
    const savedModel = hasExistingMessages
      ? getLatestModelChange(branch as unknown as SessionEntry[])
      : null;
    const restoredModel = savedModel
      ? services.modelRuntime.getModel(savedModel.provider, savedModel.modelId)
      : undefined;
    const initial = hasExistingMessages ? null : selectInitialModelScope(scope, {
        ...(effectiveInitialModel ? { requestedModel: effectiveInitialModel } : {}),
        ...(defaultProvider && defaultModelId
          ? { defaultModel: { provider: defaultProvider, modelId: defaultModelId } }
          : {}),
        ...(thinkingLevel ? { thinkingLevel } : {}),
      });
    const startupModel = restoredModel && services.modelRuntime.hasConfiguredAuth(restoredModel.provider)
      ? restoredModel
      : initial?.model;
    const { session: inner } = await createAgentSessionFromServices({
      services,
      sessionManager,
      ...(startupModel ? { model: startupModel } : {}),
      ...(initial?.thinkingLevel ? { thinkingLevel: initial.thinkingLevel } : {}),
      ...(scope.scopedModels.length > 0 ? { scopedModels: [...scope.scopedModels] } : {}),
      ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
      ...(subagentResources ? { excludeTools: [...SUBAGENT_CONTROL_TOOL_NAMES] } : {}),
    });
    speedAgent.current = inner.agent;

    const persistedPreferences = await persistExplicitStartupPreferences(
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
      monitorContextFiles: !subagentResources,
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
    locks.delete(sessionId);
    finishStartingSession();
  });

  locks.set(sessionId, starting);
  return await starting;
}
