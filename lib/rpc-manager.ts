import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
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
import { inheritAgentGitPreferences, resolveAgentGitPreferenceChoice } from "./agent-git-preferences";
import { appendSessionGitWorkflow, inheritSessionGitWorkflow, readSessionGitWorkflow, validateGitWorkflowPolicy, type GitWorkflowPolicy } from "./git-workflow-policy";
import { loadGitWorkflowSettings } from "./git-workflow-settings-store";
import { snapshotManagedSessionGitWorkflow } from "./git-workflow-session";
import { assertManagedGitAction, hasManagedGitMutationTools } from "./git-workflow-access";
import { createGitWorkflowExtension } from "./git-workflow-extension";
import { readManagedSessionGitWorkflow } from "./git-workflow-session";
import { createGitWorkflowContextFilterExtension } from "./git-workflow-context";
import { createGitCommitExtension } from "./git-commit-extension";
import { createAgentGitWorkflowExtension, type AgentGitWorkflowUiContext } from "./agent-git-workflow-extension";
import { createGitWorkspaceStartExtension, appendCompletedGitWorkspaceTransition, type GitWorkspaceTransition } from "./git-workspace-start-extension";
import { claimGitWorkspaceTransition, failGitWorkspaceTransition, finishGitWorkspaceTransition, recordGitWorkspaceForkId, recordGitWorkspaceTransition } from "./git-workspace-transition";
import { acquireGitCheckoutGate, createGitCheckoutOperationGuard, isGitCheckoutGated, isReadOnlyCheckoutTool } from "./git-checkout-gate";
import { listLocalBranchTips, listWorktrees } from "./worktree";
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
  GitActionCandidate,
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
import { createSessionReferenceExtension } from "./session-reference-extension";
import { normalizeAskUserAnswer } from "./ask-user";
import { subscribeGitActionUpdates } from "./git-action-journal";
import { GitActionDecisionEndedError } from "./git-action-controller";
import { isBlockingExtensionUiRequest } from "./browser-notifications";
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
  if (request.method === "git_action" && request.candidate.kind === "preferences") return "Choose Git workflow preferences";
  if (request.method === "git_action") return request.candidate.kind === "commit" ? "Review exact Git commit" : request.candidate.kind === "checks" ? "Approve Git checks" : request.candidate.kind === "integration" ? "Approve exact Git merge" : "Review local Git comparison";
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
  checkoutGuardInstalled?: boolean;
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
  gitWorkflow?: GitWorkflowPolicy | null;
  initialModel?: { provider: string; modelId: string };
  allowInitialModelFallback?: boolean;
  thinkingLevel?: ThinkingLevel;
}

const CODING_TOOL_NAMES = ["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"];
const THINKING_LEVEL_NAMES = new Set<ThinkingLevel>(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
// Unrecognized loaded extensions can write from hooks without a tool event.
const HOST_CHECKOUT_EXTENSIONS = new Set([
  "pi-web-checkout-operation-guard", "pi-web-exact-system-prompt", "pi-web-session-references",
  "pi-web-git-workflow-context-filter", "pi-web-project-command-environment",
  "pi-web-subagents", "pi-web-ask-user", "pi-web-git-workflow", "pi-web-git-commit",
  "pi-web-agent-git-workflow", "pi-web-git-workspace-start",
]);

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
  const canMutate = hasManagedGitMutationTools(selectedToolNames);
  const allowed = (name: string) => canMutate || !["git_commit", "git_workspace_start", "git_workflow"].includes(name);
  const extensionToolNames = session.getAllTools().map((t) => t.name)
    .filter((name) => !codingToolNames.has(name) && allowed(name));
  // The SDK may already have appended extension tools to its initial active
  // selection. Filter incoming names too, including unpinned defaultTools.
  return [...new Set([...selectedToolNames.filter(allowed), ...extensionToolNames])];
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
  private readonly pendingCheckoutTools = new Map<string, unknown>();
  private readonly seenCheckoutToolIds = new Set<string>();
  private checkoutToolTrackingUncertain = false;
  private partialCheckoutToolRisk = false;
  private userBashUncertain = false;
  private pendingCheckoutAdmissions = 0;
  private readonly checkoutGuardInstalled: boolean;
  private scheduledGitWorkspace: GitWorkspaceTransition | null = null;
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
  private unsubscribeGitActions: (() => void) | null = null;
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
    this.checkoutGuardInstalled = options.checkoutGuardInstalled ?? false;
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
    return this._alive && (this.pendingPromptCount > 0 || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning);
  }

  /** Names alone are not safe: extensions can override the SDK read tools. */
  isBuiltinReadOnlyCheckoutTool(name: unknown): boolean {
    if (!isReadOnlyCheckoutTool(name)) return false;
    try {
      const matches = this.inner.getAllTools().filter((tool) => tool.name === name);
      const origin = matches[0]?.sourceInfo as { source?: unknown; path?: unknown } | undefined;
      return matches.length === 1 && origin?.source === "builtin" && origin.path === `<builtin:${name}>`;
    } catch { return false; }
  }

  /** Unrecognized extensions may mutate via hooks or extension commands. */
  private hasUnknownCheckoutExtensions(): boolean {
    try {
      const loader = this.inner.resourceLoader as unknown as { getExtensions?: () => {
        extensions?: Array<{ path?: unknown }>; errors?: unknown[];
      } };
      const loaded = loader.getExtensions?.();
      const extensions = loaded?.extensions;
      return !Array.isArray(extensions) || !extensions.some((extension) => extension.path === "<inline:pi-web-checkout-operation-guard>")
        || !Array.isArray(loaded?.errors) || loaded.errors.length > 0
        || extensions.some((extension) =>
          typeof extension.path !== "string" || !/^<inline:pi-web-[a-z-]+>$/.test(extension.path)
          || !HOST_CHECKOUT_EXTENSIONS.has(extension.path.slice(8, -1)));
    } catch { return true; }
  }

  /** There is no SDK user_bash completion event; uncertainty lasts until teardown. */
  noteUserBashAdmission(): void { this.userBashUncertain = true; }

  /** Direct subagent prompts bypass send(); reserve their async preflight too. */
  beginCheckoutPromptAdmission(): () => void {
    if (isGitCheckoutGated(this.cwd)) throw new Error("Git checkout is busy with a local transaction");
    this.pendingCheckoutAdmissions += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.pendingCheckoutAdmissions = Math.max(0, this.pendingCheckoutAdmissions - 1);
    };
  }

  /** Tool starts precede SDK tool_call; parallel and queued calls stay tracked.
   * A tool ID only exempts that *executing* Git action, not its siblings, RPC
   * commands, ambiguous events, or an uninstrumented/stale wrapper.
   */
  hasConflictingCheckoutOperation(exceptToolCallId?: string): boolean {
    if (this.inner.isBashRunning || this.sessionReplacement || this.activeMutatingCommands > 0 || this.pendingCheckoutAdmissions > 0
      || this.userBashUncertain || this.partialCheckoutToolRisk || this.checkoutToolTrackingUncertain) return true;
    if (exceptToolCallId !== undefined) {
      if (!exceptToolCallId.trim() || !this.isRunning() || !this.unsubscribe || !this.checkoutGuardInstalled
        || this.hasUnknownCheckoutExtensions()) return true;
      const activeName = this.activeToolEvents.get(exceptToolCallId)?.toolName;
      const pendingName = this.pendingCheckoutTools.get(exceptToolCallId);
      // The current action must have passed message_end AND tool_execution_start.
      // A missing/mismatched ID, or a read/bash masquerading as the caller, is not proof.
      if ((activeName !== "git_workflow" && activeName !== "git_commit") || pendingName !== activeName) return true;
    }
    for (const [id, name] of this.pendingCheckoutTools) {
      if (id !== exceptToolCallId && !this.isBuiltinReadOnlyCheckoutTool(name)) return true;
    }
    for (const [id, event] of this.activeToolEvents) {
      if (id !== exceptToolCallId && !this.isBuiltinReadOnlyCheckoutTool(event.toolName)) return true;
    }
    if (!this.isRunning()) return false;
    return !this.unsubscribe || !this.checkoutGuardInstalled || this.hasUnknownCheckoutExtensions();
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
    this.unsubscribeGitActions?.();
    this.unsubscribeGitActions = subscribeGitActionUpdates(this.sessionId, (event) => this.emit({ ...event }));
    this.unsubscribe = this.inner.subscribe((event: AgentEvent) => {
      if (event.type === "agent_start") this.agentRunNeedsCompletion = true;
      if (event.type === "agent_end") {
        invalidateSessionListCache();
      }
      if (event.type === "message_start" && (event.message as { role?: string } | undefined)?.role === "assistant") {
        this.partialCheckoutToolRisk = false;
      }
      if (event.type === "message_update" && (event.message as { role?: string; content?: unknown[] } | undefined)?.role === "assistant") {
        const content = (event.message as { content?: unknown[] }).content;
        this.partialCheckoutToolRisk = !Array.isArray(content) || content.some((item) =>
          !!item && typeof item === "object" && (item as { type?: string }).type === "toolCall"
          && !isReadOnlyCheckoutTool((item as { name?: unknown }).name));
      }
      if (event.type === "message_end" && (event.message as { role?: string } | undefined)?.role === "assistant") {
        this.partialCheckoutToolRisk = false;
        const content = (event.message as { content?: unknown[] }).content;
        if (!Array.isArray(content)) this.partialCheckoutToolRisk = true;
        else for (const item of content) {
          if (item && typeof item === "object" && (item as { type?: string }).type === "toolCall") {
            const call = item as { id?: unknown; name?: unknown };
            if (typeof call.id !== "string" || !call.id.trim() || this.seenCheckoutToolIds.has(call.id)) {
              this.checkoutToolTrackingUncertain = true; // Duplicate/malformed IDs cannot identify one sibling.
            } else {
              this.seenCheckoutToolIds.add(call.id);
              this.pendingCheckoutTools.set(call.id, call.name);
            }
          }
        }
      }
      const toolCallId = event.toolCallId;
      if (event.type === "tool_execution_start" || event.type === "tool_execution_update" || event.type === "tool_execution_end") {
        if (typeof toolCallId !== "string" || !toolCallId.trim()) this.checkoutToolTrackingUncertain = true;
        else if (event.type === "tool_execution_end") {
          if (!this.activeToolEvents.has(toolCallId)) this.checkoutToolTrackingUncertain = true;
          this.activeToolEvents.delete(toolCallId);
          this.pendingCheckoutTools.delete(toolCallId);
        } else {
          if (event.type === "tool_execution_start" ? this.activeToolEvents.has(toolCallId) : !this.activeToolEvents.has(toolCallId)) this.checkoutToolTrackingUncertain = true;
          if (event.type === "tool_execution_update" && this.activeToolEvents.get(toolCallId)?.toolName !== event.toolName) this.checkoutToolTrackingUncertain = true;
          if (this.pendingCheckoutTools.has(toolCallId) && this.pendingCheckoutTools.get(toolCallId) !== event.toolName) this.checkoutToolTrackingUncertain = true;
          this.activeToolEvents.set(toolCallId, event);
        }
      }
      if (event.type === "agent_settled") {
        this.pendingCheckoutTools.clear();
        this.seenCheckoutToolIds.clear();
        this.checkoutToolTrackingUncertain = false;
        this.partialCheckoutToolRisk = false;
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
    const transition = this.scheduledGitWorkspace;
    this.scheduledGitWorkspace = null;
    // This in-memory handoff is intentionally never reconstructed from disk.
    if (transition) this.beginGitWorkspaceTransition(transition);
    if (this.suppressCompletionNotifications) return;
    try {
      this.onAgentRunComplete?.(this.sessionId);
    } catch (error) {
      console.error("[pi-web] completion listener failed:", error instanceof Error ? error.message : error);
    }
  }

  /** Called by the tool, after it has created the worktree and appended the start entry. */
  async scheduleGitWorkspaceTransition(transition: GitWorkspaceTransition): Promise<void> {
    if (!this._alive || !this.agentRunNeedsCompletion || this.scheduledGitWorkspace
      || !this.sessionFile || !existsSync(this.sessionFile)) throw new Error("No active persisted run");
    recordGitWorkspaceTransition(this.sessionId, transition);
    this.scheduledGitWorkspace = transition;
  }

  private beginGitWorkspaceTransition(transition: GitWorkspaceTransition): void {
    // Claim and gate are synchronous: no prompt can slip between settlement and admission.
    try {
      if (!claimGitWorkspaceTransition(this.sessionId, transition.nonce)) return;
    } catch { return; } // An unclaimed receipt is manual-only; never replay it at startup.
    let release: (() => void) | undefined;
    try {
      release = acquireGitCheckoutGate([transition.originCwd, transition.destinationPath]);
    } catch {
      try { failGitWorkspaceTransition(this.sessionId, transition.nonce); } catch { /* claimed is still non-replayable */ }
      return;
    }
    void this.performGitWorkspaceTransition(transition).catch(() => {
      try { failGitWorkspaceTransition(this.sessionId, transition.nonce); } catch { /* claimed is still non-replayable */ }
    }).finally(() => release?.());
  }

  private async performGitWorkspaceTransition(transition: GitWorkspaceTransition): Promise<void> {
    const sourceFile = this.sessionFile;
    const manager = this.inner.sessionManager;
    if (!this._alive || this.isRunning() || !manager.isPersisted() || !sourceFile || !existsSync(sourceFile)
      || !samePath(realpathSync(this.cwd), realpathSync(transition.originCwd))
      || !samePath(realpathSync(manager.getHeader()?.cwd ?? ""), realpathSync(transition.originCwd))
      || !samePath(realpathSync(manager.getCwd()), realpathSync(transition.originCwd))
      || (await resolveSessionPath(this.sessionId)) !== sourceFile
      || readSessionHeader(sourceFile)?.id !== this.sessionId
      || !samePath(realpathSync(readSessionHeader(sourceFile)?.cwd ?? ""), realpathSync(transition.originCwd))
      || readSessionGitWorkflow(manager.getEntries() as SessionEntry[])?.mode !== "worktree"
      || readSessionGitWorkflow(manager.getEntries() as SessionEntry[])?.onCreate !== transition.onCreate
      || !manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === "pi-web:git-workspace-start"
        && (entry.data as { nonce?: string } | undefined)?.nonce === transition.nonce)) throw new Error("Source changed");
    const worktrees = await listWorktrees(transition.originCwd);
    if (!worktrees.some((tree) => samePath(tree.path, transition.originCwd))
      || !worktrees.some((tree) => samePath(tree.path, transition.destinationPath) && tree.branch === transition.branch)
      || !(await listLocalBranchTips(transition.originCwd)).some((tip) => tip.branch === transition.branch && tip.oid === transition.featureTip)
      || hasBusyRpcSessionForCwd(transition.destinationPath)
      || hasBusyRpcSessionForCwd(transition.originCwd)) throw new Error("Checkout changed");
    // Recheck after async git probes. The source wrapper is idle; a fresh prompt is gated.
    if (this.isRunning() || !this._alive || hasBusyRpcSessionForCwd(transition.originCwd)
      || hasBusyRpcSessionForCwd(transition.destinationPath)) throw new Error("Checkout is running");
    await assertManagedGitAction(transition.originCwd, manager.getEntries() as SessionEntry[], "workspace", "agent", undefined, this.inner.getActiveToolNames());
    const { moveSessionFamily } = await import("./session-move");
    let movedId = this.sessionId;
    if (transition.onCreate === "fork") {
      const leafId = manager.getLeafId();
      if (!leafId || !manager.getBranch(leafId).some((entry) => entry.type === "message" && entry.message.role === "assistant")) {
        throw new Error("No assistant leaf");
      }
      const clone = SessionManager.open(sourceFile, manager.getSessionDir());
      const clonedPath = clone.createBranchedSession(leafId);
      if (!clonedPath || !existsSync(clonedPath)) throw new Error("Clone failed");
      const newSessionId = readSessionHeader(clonedPath)?.id;
      if (!newSessionId) throw new Error("Clone header missing");
      // Retain the ID even if subsequent inheritance or the move fails.
      recordGitWorkspaceForkId(this.sessionId, transition.nonce, newSessionId);
      const clonedManager = SessionManager.open(clonedPath, manager.getSessionDir());
      const entries = manager.getEntries() as SessionEntry[];
      const accounts = readSessionAccounts(entries);
      if (accounts) appendSessionAccounts(clonedManager, accounts);
      inheritSessionGitWorkflow(entries, clonedManager);
      inheritAgentGitPreferences(entries, clonedManager);
      cacheSessionPath(newSessionId, clonedPath);
      invalidateSessionListCache();
      movedId = newSessionId;
    }
    if (!(await listWorktrees(transition.originCwd)).some((tree) => samePath(tree.path, transition.destinationPath) && tree.branch === transition.branch)
      || !(await listLocalBranchTips(transition.originCwd)).some((tip) => tip.branch === transition.branch && tip.oid === transition.featureTip)
      || hasBusyRpcSessionForCwd(transition.originCwd) || hasBusyRpcSessionForCwd(transition.destinationPath)) {
      throw new Error("Checkout changed before session move");
    }
    await assertManagedGitAction(transition.originCwd, manager.getEntries() as SessionEntry[], "workspace", "agent", undefined, this.inner.getActiveToolNames());
    await moveSessionFamily(movedId, transition.destinationPath);
    // Success is durable before optional transcript decoration. Resolve the real moved cwd.
    const movedFile = await resolveSessionPath(movedId);
    if (!movedFile || !samePath(realpathSync(readSessionHeader(movedFile)?.cwd ?? ""), realpathSync(transition.destinationPath))) {
      throw new Error("Moved session needs manual recovery");
    }
    finishGitWorkspaceTransition(this.sessionId, transition.nonce, readSessionHeader(movedFile)!.cwd);
    try {
      const source = await resolveSessionPath(this.sessionId);
      if (source) appendCompletedGitWorkspaceTransition(SessionManager.open(source, manager.getSessionDir()), transition,
        movedId === this.sessionId ? undefined : SessionManager.open(movedFile, manager.getSessionDir()));
    } catch { /* Receipt is authoritative even if transcript decoration fails. */ }
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

  private persistBashOnlySession(): void {
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
    // A leading shell command has no assistant message, so mark this SDK
    // manager as flushed after writing its own generated entries.
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
      if (type !== "get_state" && type !== "abort" && isGitCheckoutGated(this.cwd)) {
        throw new Error("Git checkout is busy with a local integration");
      }
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
          // Admission may have waited behind another prompt after the first gate check.
          if (isGitCheckoutGated(this.cwd)) throw new Error("Git checkout is busy with a local integration");
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
          inheritSessionGitWorkflow(sourceEntries, destination);
          inheritAgentGitPreferences(sourceEntries, destination);
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
        inheritSessionGitWorkflow(sourceEntries, forkedManager);
        inheritAgentGitPreferences(sourceEntries, forkedManager);
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
          inheritSessionGitWorkflow(sourceEntries, clonedManager);
          inheritAgentGitPreferences(sourceEntries, clonedManager);
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
        this.resolveExtensionUiResponse(command as ExtensionUiResponse);
        return null;
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
        if (this.pendingPromptCount > 0 || this.inner.isStreaming || this.inner.isCompacting || this.inner.isBashRunning) {
          throw new Error("Cannot run a shell command while the session is busy");
        }
        const execution = this.inner.executeBash(
          command.command as string,
          undefined,
          {
            excludeFromContext: command.excludeFromContext as boolean | undefined,
            operations: createProjectCommandBashOperations({
              shellPath: this.inner.settingsManager.getShellPath(),
            }),
          },
        );
        try {
          const result = await execution;
          this.persistBashOnlySession();
          return result;
        } finally {
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
    this.unsubscribeGitActions?.();
    for (const pending of this.pendingUiResponses.values()) pending.cancel();
    for (const id of Array.from(this.activeCustomUis.keys())) this.closeCustomUi(id, undefined);
    this.pendingUiResponses.clear();
    this.pendingUiRequests.clear();
    this.pendingUiStartedAt.clear();
    this.activeToolEvents.clear();
    this.pendingCheckoutTools.clear();
    this.seenCheckoutToolIds.clear();
    this.checkoutToolTrackingUncertain = false;
    this.partialCheckoutToolRisk = false;
    this.userBashUncertain = false;
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

  private resolveExtensionUiResponse(response: ExtensionUiResponse): void {
    const pending = this.pendingUiResponses.get(response.id);
    if (!pending) return;
    const request = this.pendingUiRequests.get(response.id) as ExtensionUiRequest | undefined;
    if (request?.method === "ask_user" && !("cancelled" in response)
      && (!("answer" in response) || !normalizeAskUserAnswer(response.answer, request))) return;
    if (request?.method === "git_action" && request.candidate.kind === "preferences") {
      if ("cancelled" in response) {
        if (response.cancelled !== true || Object.keys(response).length !== 3) return;
      } else if (!("preferences" in response) || Object.keys(response).length !== 3
        || !resolveAgentGitPreferenceChoice(response.preferences, request.candidate.targets, request.candidate.checks)) return;
    } else if (request?.method === "git_action" && !("cancelled" in response)) {
      if (request.candidate.kind === "integration") {
        if (!("approvePlanId" in response) || response.approvePlanId !== request.candidate.plan.planId) return;
      } else if (!("confirmed" in response) || typeof response.confirmed !== "boolean") return;
    }
    pending.resolve(response);
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
    const fullRequest = {
      type: "extension_ui_request",
      id,
      ...request,
      ...(timeout ? { timeout, expiresAt: Date.now() + timeout } : {}),
    };

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
      const settle = (value: T, ended?: "cancelled" | "expired") => {
        if (settled) return;
        settled = true;
        cleanup();
        // Dialog closure is never transaction success. Preserve the distinction
        // between an explicit decline, timeout, and Stop/teardown in history.
        if (ended && request.method === "git_action" && (request.candidate as GitActionCandidate | undefined)?.actionId) reject(new GitActionDecisionEndedError(ended));
        else if (stopSignal.aborted) reject(stopSignal.reason);
        else resolve(value);
      };
      const onAbort = () => settle(defaultValue, "cancelled");

      if (timeout) timeoutId = setTimeout(() => settle(defaultValue, "expired"), timeout);
      abortSignal.addEventListener("abort", onAbort, { once: true });

      this.pendingUiStartedAt.set(id, Date.now());
      this.pendingUiRequests.set(id, fullRequest as AgentEvent);
      this.pendingUiResponses.set(id, {
        resolve: (response) => settle(parseResponse(response)),
        cancel: () => settle(defaultValue, "cancelled"),
      });
      this.emit(fullRequest as AgentEvent);
    });
  }

  private createExtensionUiContext(): ExtensionUiContextLike & AskUserUiContext & AgentGitWorkflowUiContext {
    return {
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
      askUser: (question, timeout, signal) => this.requestExtensionUi(
        { method: "ask_user", ...question },
        null,
        (response) => "answer" in response ? normalizeAskUserAnswer(response.answer, question) : null,
        timeout,
        signal,
      ),
      // Human Git decisions have no response deadline. Stop/teardown still
      // settle them; approval still goes through the native freshness checks.
      gitPreferences: (candidate: Extract<GitActionCandidate, { kind: "preferences" }>, signal?: AbortSignal) => this.requestExtensionUi(
        { method: "git_action", candidate },
        null,
        (response) => "preferences" in response
          ? resolveAgentGitPreferenceChoice(response.preferences, candidate.targets, candidate.checks) : null,
        undefined,
        signal,
      ),
      gitAction: (candidate: GitActionCandidate, signal?: AbortSignal) => this.requestExtensionUi(
        { method: "git_action", candidate },
        false,
        (response) => candidate.kind === "integration"
          ? "approvePlanId" in response && response.approvePlanId === candidate.plan.planId
          : "confirmed" in response && response.confirmed === true,
        undefined,
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
      checkoutGuardInstalled: true,
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
  const key = normalizeRpcCwd(cwd);
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
  await existing.shutdown();

  if (persistedFile) {
    const started = await startRpcSession(sessionId, persistedFile, undefined);
    return { session: started.session, sessionId: started.realSessionId, recreated: true };
  }

  const started = await startRpcSession(`__recreate__${randomUUID()}`, "", sessionCwd, {
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
    // model, thinking and tool choices when creating the replacement wrapper.
    const started = await startRpcSession(`__recreate__${randomUUID()}`, "", manager.getCwd(), {
      accounts: next,
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

export function hasBusyRpcSessionForCwd(cwd: string, exceptSessionId?: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  if (getStartingSessionCwds().has(targetCwd)) return true;
  return Array.from(getRegistry().values()).some(
    (session) => (!exceptSessionId || session.sessionId !== exceptSessionId) && normalizeRpcCwd(session.cwd) === targetCwd && session.isRunning(),
  );
}

export function hasConflictingRpcCheckoutOperation(cwd: string, exceptSessionId?: string, exceptToolCallId?: string): boolean {
  const targetCwd = normalizeRpcCwd(cwd);
  // Startup has not installed the SDK hooks or event subscriber yet.
  if (getStartingSessionCwds().has(targetCwd)) return true;
  const sessions = [...getRegistry().values()];
  if (exceptSessionId !== undefined || exceptToolCallId !== undefined) {
    // Never fall back to excluding a whole session if the caller has no proven
    // in-flight tool identity. A forged/legacy wrapper or duplicate ID is uncertain.
    if (!exceptSessionId || !exceptToolCallId || !exceptToolCallId.trim()) return true;
    const owners = [...new Set(sessions.filter((session) => session.sessionId === exceptSessionId))];
    if (owners.length !== 1 || !(owners[0] instanceof AgentSessionWrapper)
      || owners[0].hasConflictingCheckoutOperation(exceptToolCallId)) return true;
  }
  return sessions.some((session) => {
    if (normalizeRpcCwd(session.cwd) !== targetCwd) return false;
    if (exceptSessionId && session.sessionId === exceptSessionId) return false; // Validated exact tool above.
    // Unknown/older wrappers cannot prove their running tools are read-only.
    if (typeof session.hasConflictingCheckoutOperation !== "function") return session.isRunning();
    return session.hasConflictingCheckoutOperation();
  });
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
  const { initialModel, allowInitialModelFallback, thinkingLevel } = options;
  const requestedToolNames = options.toolNames === undefined
    ? undefined
    : validateSessionToolSelection(options.toolNames);
  const registry = getRegistry();
  const locks = getLocks();

  const existing = registry.get(sessionId);
  if (existing?.isAlive()) return { session: existing, realSessionId: sessionId };

  const inflight = locks.get(sessionId);
  if (inflight) return inflight;

  let sessionManager: SessionManager;
  if (sessionFile) {
    sessionManager = SessionManager.open(sessionFile, undefined);
  } else {
    if (!cwd) throw new Error("cwd is required for a new session");
    sessionManager = SessionManager.create(cwd, undefined);
  }
  const sessionCwd = sessionManager.getCwd();
  // Existing sessions use only their saved entry; project defaults never retrofit them.
  // Explicit null on a new session is a persisted opt-out, not a missing option.
  if (!sessionFile) {
    if (options.gitWorkflow === undefined) {
      const defaults = await loadGitWorkflowSettings(sessionCwd);
      snapshotManagedSessionGitWorkflow(sessionManager, defaults.resolved.project.values);
    } else {
      // Compatibility for explicitly queued old-browser choices. Never adopt a
      // new global default into an already initialized or persisted session.
      appendSessionGitWorkflow(sessionManager, options.gitWorkflow === null ? null : validateGitWorkflowPolicy(options.gitWorkflow));
    }
  }
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
  if (!sessionFile) appendSessionAccounts(sessionManager, accounts);
  if (!subagentResources && persistedToolNames === undefined && requestedToolNames !== undefined) {
    appendSessionToolSelection(sessionManager, requestedToolNames);
  }
  const subagentLoadsResources = Boolean(
    subagentResources?.loadExtensions || subagentResources?.loadSkills,
  );
  const chatOnly = selectedToolNames?.length === 0 && !subagentLoadsResources;
  const finishStartingSession = trackStartingSession(sessionCwd);
  const starting = (async () => {
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
    // A persisted chat opt-out is applied when the wrapper starts; changing it
    // evicts an idle wrapper so the model no longer sees these tool schemas.
    const gitWorkflowActive = readManagedSessionGitWorkflow(sessionManager.getEntries() as unknown as SessionEntry[])?.optedOut !== true;
    const workspaceStartOwner: { current?: AgentSessionWrapper } = {};
    const checkoutOwner: { current?: AgentSessionWrapper } = {};
    const checkoutGuard = createGitCheckoutOperationGuard({
      isBuiltinReadOnlyTool: (name) => checkoutOwner.current?.isBuiltinReadOnlyCheckoutTool(name) ?? false,
      onUserBash: () => {
        if (!checkoutOwner.current) throw new Error("Checkout guard unavailable");
        checkoutOwner.current.noteUserBashAdmission();
      },
    });
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
              checkoutGuard,
              ...(usesExactSystemPrompt ? [exactSystemPromptExtension] : []),
              ...(subagentResources.loadExtensions ? [createAskUserExtension()] : []),
            ],
            ...(subagentResources.loadExtensions ? { extensionsOverride: preferPiWebAskUserExtension } : {}),
          }
        : chatOnly
          ? { ...CHAT_ONLY_RESOURCE_LOADER_OPTIONS, extensionFactories: [checkoutGuard, exactSystemPromptExtension, createSessionReferenceExtension(), createGitWorkflowContextFilterExtension()] }
        : {
            extensionFactories: [
              checkoutGuard,
              createSessionReferenceExtension(),
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
              ...(gitWorkflowActive ? [createGitWorkflowExtension(() => readSessionGitWorkflow(sessionManager.getEntries() as unknown as SessionEntry[]),
                () => loadGitWorkflowSettings(sessionCwd, sessionManager.getEntries() as unknown as SessionEntry[], undefined, sessionManager.getSessionId())),
              createGitCommitExtension(sessionCwd, () => readSessionGitWorkflow(sessionManager.getEntries() as unknown as SessionEntry[])),
              createAgentGitWorkflowExtension(sessionCwd, undefined, sessionManager),
              createGitWorkspaceStartExtension(sessionCwd, () => readSessionGitWorkflow(sessionManager.getEntries() as unknown as SessionEntry[]),
                (transition) => {
                  if (!workspaceStartOwner.current) throw new Error("Session not ready");
                  return workspaceStartOwner.current.scheduleGitWorkspaceTransition(transition);
                })] : []),
            ],
            extensionsOverride: (base) => preferUserBashExtension(preferPiWebAskUserExtension(preferPiWebSubagentExtension(base))),
          },
      ...(trustReloadOptions ? { resourceLoaderReloadOptions: trustReloadOptions } : {}),
    });
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
      checkoutGuardInstalled: true,
    });
    workspaceStartOwner.current = wrapper;
    checkoutOwner.current = wrapper;
    const realSessionId = inner.sessionId as string;
    registerRpcWrapper(wrapper);

    return { session: wrapper, realSessionId };
  })().finally(() => {
    locks.delete(sessionId);
    finishStartingSession();
  });

  locks.set(sessionId, starting);
  return starting;
}
