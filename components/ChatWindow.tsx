"use client";

import { createComposerWork, type ComposerWork } from "@/lib/client-completion";
import { SessionToolsControl } from "./SessionToolsControl";
import { registerAbortHandler } from "@/hooks/useKeyboardShortcuts";
import Image from "next/image";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { selectHasStreamingContent, selectIsStreaming, selectStreamingMessage, useStreamingSelector } from "@/hooks/useStreamingSelector";
import type { StreamingStore } from "@/lib/streaming-message";
import { createPortal } from "react-dom";
import type { AgentMessage, AssistantContentBlock, AssistantMessage, BashExecutionMessage, BlockingExtensionUiRequest, SessionInfo, SessionTreeNode, ToolResultMessage, UserMessage } from "@/lib/types";
import { countToolCallBlocks, getAssistantErrorMessage, getDisplayableAssistantBlocks, isAssistantTruncated, isMessageGroupAnchor as isOrdinaryMessageGroupAnchor, splitFinalAssistantBlocks } from "@/lib/message-display";
import { extractTurnWrittenFiles, type WrittenFile } from "@/lib/turn-written-files";
import { buildQuotedSelection } from "@/lib/quoted-selection";
import { MessageView } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ProviderAccounts } from "./ProviderAccounts";
import { isHistoryOnlySession } from "@/lib/session-directory";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { ExtensionStatusBar } from "./ExtensionStatusBar";
import { BlockingRequestCard } from "./BlockingRequestCard";
import { ExtensionCustomPanel } from "./ExtensionCustomPanel";
import { useBlockingQuestionFollow } from "./useBlockingQuestionFollow";
import { ContextReloadNotice } from "./ContextReloadNotice";
import { ArchivedSessionNotice } from "./ArchivedSessionNotice";
import { useI18n } from "@/hooks/useI18n";
import { useAgentSession, type AgentPhase, type NoticeItem } from "@/hooks/useAgentSession";
import { useDragDrop } from "@/hooks/useDragDrop";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useScrollbarVisibility } from "@/hooks/useScrollbarVisibility";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { AppUpdateResponse } from "@/lib/api-types";
import type { ToolEntry } from "@/lib/tool-presets";
import { findChatScrollAnchor, type ChatScrollPosition } from "@/lib/chat-scroll-position";
import {
  captureScrollDistance,
  getVisibleRenderWindow,
  isScrollAtTail,
  restoreScrollTop,
  VISIBLE_PAGE_SIZE,
} from "@/lib/chat-lazy-load";

export interface ChatWindowWorkOwners {
  /** The actual hook return and existing composer owner, not cloned ledgers. */
  whenMaintenanceSettled: () => Promise<void>;
  work: ComposerWork;
}

export interface ChatWindowWorkObserver {
  owners: (owners: ChatWindowWorkOwners) => void;
  started: (name: "saved-locate" | "search-locate" | "history-prepend", started: Promise<unknown>) => void;
  /** Passive original-work observation; must not throw or alter admission. */
  thinking?: (observation: import("./MessageView").ThinkingWorkObservation) => void;
  /** Passive original Copy handler/error observation; callback must not throw. */
  copy?: (observation: import("./ToolArguments").ToolCopyWorkObservation) => void;
}

export interface ChatWindowProps {
  /** Optional passive observation. Install before mount; callbacks must not throw.
   * No observer means no additional promise handlers or rejection policy. */
  workObserver?: ChatWindowWorkObserver;
  /** Passive grace handle observation, forwarded unchanged by the hook props spread.
   * Observer must not throw; absent adds no callback or rejection handling. */
  onGraceTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  session: SessionInfo | null;
  /** A fullscreen sibling covers this chat, including its body-portaled composer. */
  covered?: boolean;
  searchTarget?: { sessionId: string; entryId: string; blockIndex?: number } | null;
  onSearchTargetHandled?: (target: { sessionId: string; entryId: string }) => void;
  initialScrollPosition?: ChatScrollPosition | null;
  onScrollPositionChange?: (sessionId: string, position: ChatScrollPosition) => void;
  sessionRunning?: boolean;
  archivedRootSessionId: string | null;
  archiveActionBusy: boolean;
  onSessionRestored: (id: string) => void;
  newSessionCwd: string | null;
  newSessionDraftKey: string | null;
  persistNewSession?: boolean;
  onAgentEnd?: () => void;
  onRecoveryDismissed?: () => void;
  onAttentionNeeded?: (request: BlockingExtensionUiRequest) => void;
  onSessionCreated?: (session: SessionInfo, sourceDraftKey: string) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSystemToolsChange?: (tools: ToolEntry[] | null) => void;
  onSystemInfoLoaderChange?: (loader: (() => Promise<void>) | null) => void;
  onSessionStatsChange?: (stats: SessionStatsInfo | null) => void;
  onSessionStatsPanelOpen?: () => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onOpenFile?: import("@/lib/file-links").OpenFileLink;
  onOpenSession?: (sessionId: string) => void;
  onAskInNewChat?: (prompt: string, sourceSessionId: string, sourceEntryId: string) => Promise<void>;
  quoteSelectionEnabled?: boolean;
  initialPrompt?: string;
  onInitialPromptConsumed?: () => void;
  /** Completion sound state + controls, owned by AppShell so tasks finishing in
   *  a non-active workspace can still ring. */
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  playDoneSound?: () => void;
  unlockAudio?: () => void;
}

function phaseLabel(phase: AgentPhase, t: (key: string, params?: Record<string, string | number>) => string): string | null {
  if (phase?.kind === "running_tools") {
    const latest = phase.tools[phase.tools.length - 1];
    if (latest?.progress) {
      return `${t("chat.runningNamedTool", { name: latest.name })} ${latest.progress}`;
    }
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return t("chat.runningTool");
    if (names.length === 1) return t("chat.runningNamedTool", { name: names[0] });
    if (names.length <= 3) return t("chat.runningTools", { names: names.join(", ") });
    return t("chat.runningToolsMore", { names: names.slice(0, 2).join(", "), count: names.length - 2 });
  }
  if (phase?.kind === "waiting_model") return t("chat.waitingModel");
  if (phase?.kind === "running_command") return t("chat.runningCommand");
  return null;
}

const CHAT_MINIMAP_WIDTH = 36;
const CHAT_COLUMN_PADDING = 16;

function NewSessionUpdateLink({
  label,
}: {
  label: (version: string) => string;
}) {
  const [update, setUpdate] = useState<AppUpdateResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/app-update", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<AppUpdateResponse>;
      })
      .then((result) => {
        if (result?.updateAvailable && result.latestVersion && result.releaseUrl) {
          setUpdate(result);
        }
      })
      .catch(() => {
        // Update checks are best-effort and must not interrupt a new session.
      });
    return () => controller.abort();
  }, []);

  if (!update) return null;
  const accessibleLabel = label(update.latestVersion);

  return (
    <a
      href={update.releaseUrl}
      target="_blank"
      rel="noopener noreferrer"
      title={accessibleLabel}
      aria-label={accessibleLabel}
      onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        alignSelf: "center",
        gap: 3,
        minHeight: 32,
        minWidth: 0,
        padding: "0 4px",
        background: "transparent",
        borderRadius: 5,
        color: "var(--accent)",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: 1.2,
        textDecoration: "none",
        transition: "background 0.12s",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>v{update.latestVersion}</span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M7 17 17 7" />
        <path d="M7 7h10v10" />
      </svg>
    </a>
  );
}

function hasFinalAssistantAnswer(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  return splitFinalAssistantBlocks(message as AssistantMessage).answerBlocks.some((block) => (
    block.type === "image" || (block.type === "text" && block.text.trim().length > 0)
  ));
}

// Durable cards are standalone anchors, never hidden in collapsed process details.
function isMessageGroupAnchor(message: AgentMessage): boolean {
  return isOrdinaryMessageGroupAnchor(message);
}

function findFinalAssistantIndex(messages: AgentMessage[], userIdx: number, endIdx: number): number {
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (hasFinalAssistantAnswer(messages[candidateIdx])) return candidateIdx;
  }
  for (let candidateIdx = endIdx - 1; candidateIdx > userIdx; candidateIdx--) {
    if (messages[candidateIdx]?.role === "assistant") return candidateIdx;
  }
  return -1;
}

function getUserInputText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") {
    const text = message.content.trim();
    return text.length > 0 ? text : null;
  }
  const text = message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

function withAssistantBlocks(
  message: AssistantMessage,
  content: AssistantContentBlock[],
  options: { omitUsage?: boolean } = {},
): AssistantMessage {
  const next = { ...message, content };
  if (options.omitUsage) next.usage = undefined;
  return next;
}

export function ProcessDetailsGroup({ messageCount, toolCallCount, defaultExpanded = false, reveal = false, children, t }: { messageCount: number; toolCallCount: number; defaultExpanded?: boolean; reveal?: boolean; children: ReactNode; t: (key: string, params?: Record<string, string | number>) => string }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  useLayoutEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal]);
  const parts = [t("chat.processDetails"), `${messageCount} ${t(messageCount === 1 ? "chat.message" : "chat.messages")}`];
  if (toolCallCount > 0) parts.push(`${toolCallCount} ${t(toolCallCount === 1 ? "chat.toolCall" : "chat.toolCalls")}`);

  return (
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        aria-expanded={expanded || reveal}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "auto",
          minHeight: 24,
          padding: "2px 0",
          border: "none",
          background: "transparent",
          color: "var(--text-muted)",
          cursor: "pointer",
          fontSize: 12,
          textAlign: "left",
        }}
        title={expanded ? t("chat.collapseProcess") : t("chat.expandProcess")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>
          <polyline points="4 2.5 7.5 6 4 9.5" />
        </svg>
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {parts.join(" · ")}
        </span>
      </button>
      {(expanded || reveal) && (
        <div style={{ marginTop: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function useChatCompletionNotification(session: SessionInfo | null, soundEnabled: boolean,
  playDoneSound: () => void, onAgentEnd?: () => void) {
  const soundRef = useRef(playDoneSound);
  const enabledRef = useRef(soundEnabled);
  soundRef.current = playDoneSound;
  enabledRef.current = soundEnabled;
  const notify = session?.relation?.kind !== "subagent";
  return useCallback(() => {
    if (notify && enabledRef.current) soundRef.current();
    onAgentEnd?.();
  }, [notify, onAgentEnd]);
}

export function ChatWindow(props: ChatWindowProps) {
  const { session, soundEnabled = true, playDoneSound = () => {}, onAgentEnd } = props;
  const wrappedOnAgentEnd = useChatCompletionNotification(session, soundEnabled, playDoneSound, onAgentEnd);
  const work = useMemo(() => createComposerWork(), []);
  const restore = useState(initialChatScrollRestore(props));
  const state = useAgentSession({ ...props, onAgentEnd: wrappedOnAgentEnd,
    deferInitialScroll: Boolean(restore[0]),
  });
  const observationRef = useRef(props.workObserver);
  observationRef.current = props.workObserver;
  const owners = useMemo<ChatWindowWorkOwners>(() => ({
    whenMaintenanceSettled: state.whenMaintenanceSettled, work,
  }), [state.whenMaintenanceSettled, work]);
  // Braces deliberately discard the callback result: never an effect cleanup.
  // This notification precedes view layouts, including a failed view setup.
  useLayoutEffect(() => {
    observationRef.current?.owners(owners);
  }, [owners]);
  // Keep agent-session layouts before view restoration layouts in this same
  // component, as in the original default owner (not a child-layout boundary).
  return useChatWindowView({ ...props, state, work, restore,
    contextReloadNotice: <ContextReloadNotice sessionId={props.session?.id ?? null} busy={state.agentRunning || state.bashRunning || state.isCompacting} />,
  });
}

type PendingRestore = Extract<ChatScrollPosition, { atBottom: false }> | null;
export function initialChatScrollRestore(props: Pick<ChatWindowProps, "searchTarget" | "initialScrollPosition">): PendingRestore {
  const position = props.searchTarget ? null : props.initialScrollPosition;
  return position && !position.atBottom ? position : null;
}

type ChatWindowViewProps = ChatWindowProps & { state: ReturnType<typeof useAgentSession>; work: ComposerWork; contextReloadNotice?: ReactNode; restore: [PendingRestore, React.Dispatch<React.SetStateAction<PendingRestore>>] };

// Controlled component and ordinary default share this actual view hook.
export function ChatWindowView(props: ChatWindowViewProps) {
  return useChatWindowView(props);
}

function useChatWindowView({ workObserver, session, sessionRunning, contextReloadNotice, covered = false, searchTarget, onSearchTargetHandled, onScrollPositionChange, archivedRootSessionId, archiveActionBusy, onSessionRestored, newSessionCwd, newSessionDraftKey, chatInputRef, onSessionStatsChange, onContextUsageChange, onOpenFile, onOpenSession, onAskInNewChat, quoteSelectionEnabled = false, initialPrompt, onInitialPromptConsumed, soundEnabled = true, onSoundToggle, playDoneSound = () => {}, unlockAudio, state, work, restore }: ChatWindowViewProps) {
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const completionNotificationsEnabled = session?.relation?.kind !== "subagent";
  const historyOnly = isHistoryOnlySession(session);
  const workObservationRef = useRef(workObserver);
  workObservationRef.current = workObserver;

  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundedExtensionDialogIdRef = useRef<string | null>(null);

  // 稳定化 onEditContent 引用，配合 React.memo 防止历史消息重渲染
  const handleEditContent = useCallback((message: UserMessage) => {
    chatInputRef?.current?.replaceMessage(message);
  }, [chatInputRef]);

  const [pendingScrollRestore, setPendingScrollRestore] = restore;
  const [restoreAnchorReady, setRestoreAnchorReady] = useState(false);

  const {
    data, loading, error, possibleInterruptedRun, dismissPossibleInterruption, messages, activeToolResults, entryIds, historyCursor, hasEarlierMessages, streamingStore,
    agentRunning, bashRunning, pendingBash, modelNames, modelList, modelError, modelScopeWarnings, modelThinkingLevels, modelThinkingLevelMaps, toolPreset, thinkingLevel, modelSpeed, modelSpeedChanging,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, compactResult, displayModel: displayModelValue, modelSwitching, sessionStats,
    slashCommands, slashCommandsLoading, queuedMessages,
    notices, extensionDialog, extensionCustomUi, extensionStatuses, extensionWidgets, respondToExtensionUi, sendExtensionCustomInput, setNoticePaused,
    isAutoModelSelection,
    isAutoThinkingSelection,
    agentPhase,
    isNew,
    showScrollToBottom,
    sessionIdRef, scrollContainerRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange, handleSessionAccountChange, loadModels,
    handleCompact, handleSteer, handleFollowUp, handlePromptWithStreamingBehavior, handleAbortCompaction,
    handleRecallQueue,
    handleBuiltinSlashCommand,
    handleToolPresetChange, handleNativeResourcesChange, handleThinkingLevelChange, handleModelSpeedChange, loadSlashCommands, followLiveOutput,
    loadContext, activeLeafId, scrollToBottom, scrollToMessage,
  } = state;
  const isStreaming = useStreamingSelector(streamingStore, selectIsStreaming);
  const hasStreamingContent = useStreamingSelector(streamingStore, selectHasStreamingContent);
  const getStreamingMessage = useCallback(() => streamingStore.getState().streamingMessage, [streamingStore]);
  const sessionBusy = agentRunning || bashRunning;
  const [quotedSelection, setQuotedSelection] = useState<{
    text: string;
    top: number;
    left: number;
    sourceEntryId?: string;
  } | null>(null);
  const [quoteInputOpen, setQuoteInputOpen] = useState(false);
  const [quoteSubmitting, setQuoteSubmitting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quotePopoverRef = useRef<HTMLDivElement | null>(null);
  const quoteChatInputRef = useRef<ChatInputHandle | null>(null);
  const closeQuotedSelection = useCallback(() => {
    setQuotedSelection(null);
    setQuoteInputOpen(false);
    setQuoteError(null);
  }, []);

  useEffect(() => {
    if (!quoteSelectionEnabled) closeQuotedSelection();
  }, [quoteSelectionEnabled, closeQuotedSelection]);

  const captureQuotedSelection = useCallback(() => {
    if (!quoteSelectionEnabled || quoteInputOpen) return;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const root = messageContentRef.current;
    if (!selection || selection.isCollapsed || !range || !root || !root.contains(range.commonAncestorContainer)) {
      setQuotedSelection(null);
      return;
    }
    const text = selection.toString().trim();
    if (!text) {
      setQuotedSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    const start = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer as Element
      : range.startContainer.parentElement;
    const end = range.endContainer.nodeType === Node.ELEMENT_NODE
      ? range.endContainer as Element
      : range.endContainer.parentElement;
    const sourceEntryId = [ancestor, start, end]
      .map((element) => element?.closest<HTMLElement>("[data-message-role=\"assistant\"]")?.dataset.entryId)
      .find((entryId): entryId is string => Boolean(entryId));
    setQuotedSelection({
      text,
      top: Math.min(window.innerHeight - 44, rect.bottom + 8),
      left: Math.max(64, Math.min(window.innerWidth - 64, rect.left + rect.width / 2)),
      sourceEntryId,
    });
  }, [quoteSelectionEnabled, quoteInputOpen]);

  useEffect(() => {
    if (!quoteInputOpen || !quotedSelection) return;
    quoteChatInputRef.current?.insertIfEmpty(buildQuotedSelection(
      quotedSelection.text,
      t("chat.quoteIntro"),
      t("chat.quoteQuestion"),
    ));
  }, [quoteInputOpen, quotedSelection, t]);

  useLayoutEffect(() => {
    const popover = quotePopoverRef.current;
    if (!popover || !quotedSelection || covered) return;
    const viewport = window.visualViewport;
    const position = () => {
      const rect = popover.getBoundingClientRect();
      const top = viewport?.offsetTop ?? 0;
      const left = viewport?.offsetLeft ?? 0;
      popover.style.top = `${Math.max(top + 8, Math.min(quotedSelection.top, top + (viewport?.height ?? window.innerHeight) - rect.height - 8))}px`;
      popover.style.left = `${Math.max(left + 8, Math.min(quotedSelection.left - rect.width / 2, left + (viewport?.width ?? window.innerWidth) - rect.width - 8))}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(popover);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [quotedSelection, quoteInputOpen, quoteError, covered]);

  useEffect(() => {
    if (!quotedSelection || covered) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!quoteInputOpen && !quotePopoverRef.current?.contains(event.target as Node)) closeQuotedSelection();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      if (!quoteSubmitting) closeQuotedSelection();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [quotedSelection, quoteInputOpen, quoteSubmitting, closeQuotedSelection, covered]);

  const askSelectionHere = useCallback(() => {
    if (!quotedSelection) return;
    chatInputRef?.current?.insertText(buildQuotedSelection(
      quotedSelection.text,
      t("chat.quoteIntro"),
      t("chat.quoteQuestion"),
    ));
    // Insertion owns selection/focus. Clearing document ranges afterwards can
    // reset the composer's caret instead of leaving it after the quote (#1319).
    closeQuotedSelection();
  }, [chatInputRef, quotedSelection, closeQuotedSelection, t]);

  const askSelectionInNewChat = useCallback((prompt: string) => work.run(async () => {
    const sourceSessionId = sessionIdRef.current ?? session?.id;
    if (quoteSubmitting || !prompt.trim() || !quotedSelection?.sourceEntryId || !sourceSessionId || !onAskInNewChat) return;
    setQuoteSubmitting(true);
    setQuoteError(null);
    unlockAudio?.();
    try {
      await onAskInNewChat(
        prompt,
        sourceSessionId,
        quotedSelection.sourceEntryId,
      );
      closeQuotedSelection();
    } catch (error) {
      quoteChatInputRef.current?.restoreSubmission(prompt);
      setQuoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setQuoteSubmitting(false);
    }
  }), [work, onAskInNewChat, quotedSelection, quoteSubmitting, session?.id, sessionIdRef, closeQuotedSelection, unlockAudio]);

  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (loading || error || !initialPrompt || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    onInitialPromptConsumed?.();
    void work.run(() => handleSend(initialPrompt));
  }, [work, initialPrompt, loading, error, handleSend, onInitialPromptConsumed]);

  useEffect(() => {
    if (
      !completionNotificationsEnabled
      || !extensionDialog
      || soundedExtensionDialogIdRef.current === extensionDialog.id
    ) return;
    soundedExtensionDialogIdRef.current = extensionDialog.id;
    playDoneSoundRef.current();
  }, [completionNotificationsEnabled, extensionDialog]);

  // Register the abort handler for the global Esc shortcut
  useEffect(() => {
    registerAbortHandler(sessionBusy ? handleAbort : null);
  }, [sessionBusy, handleAbort]);

  // --- Lazy-load historical messages ---
  // Only render the last N messages initially. When the user scrolls to the
  // top, load another page while keeping the scroll position stable.
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const messageContentRef = useRef<HTMLDivElement | null>(null);
  const questionCardRef = useRef<HTMLDivElement | null>(null);
  // The packet hook owns the one live-request follow lifetime. Both minimap
  // paths below relinquish that same lifetime, never a parallel follow owner.
  const stopQuestionFollow = useBlockingQuestionFollow(extensionDialog?.id, loading, covered, scrollContainerRef, questionCardRef);
  const prevScrollDistanceRef = useRef<number | null>(null);
  const loadingOlderRef = useRef(false);
  const restoreStartedRef = useRef(false);
  const pendingScrollRestoreRef = useRef(pendingScrollRestore);
  pendingScrollRestoreRef.current = pendingScrollRestore;
  const [pendingSearchScroll, setPendingSearchScroll] = useState<ChatWindowProps["searchTarget"]>(null);
  const searchMessage = messages[entryIds.indexOf(pendingSearchScroll?.entryId ?? "")];
  const searchBlock = searchMessage?.role === "assistant"
    ? (pendingSearchScroll?.blockIndex === undefined
      ? searchMessage.content.find((block) => block.type === "text")
      : searchMessage.content[pendingSearchScroll.blockIndex])
    : undefined;
  const searchHistoryRef = useRef({ entryIds, historyCursor, hasEarlierMessages });
  searchHistoryRef.current = { entryIds, historyCursor, hasEarlierMessages };

  useLayoutEffect(() => {
    const sessionId = session?.id;
    const container = scrollContainerRef.current;
    const content = messageContentRef.current;
    if (!sessionId || !onScrollPositionChange || !container || !content) return;
    return () => {
      if (pendingScrollRestoreRef.current) return;
      if (isScrollAtTail(container.scrollTop, container.clientHeight, container.scrollHeight)) {
        onScrollPositionChange(sessionId, { atBottom: true });
        return;
      }
      const viewportTop = container.getBoundingClientRect().top;
      const candidates = Array.from(content.children).flatMap((element) => {
        if (!(element instanceof HTMLElement) || !element.dataset.entryId) return [];
        const rect = element.getBoundingClientRect();
        return [{ entryId: element.dataset.entryId, top: rect.top, bottom: rect.bottom }];
      });
      const anchor = findChatScrollAnchor(candidates, viewportTop);
      if (!anchor) return;
      onScrollPositionChange(sessionId, {
        atBottom: false,
        ...anchor,
        oldestEntryId: searchHistoryRef.current.historyCursor,
      });
    };
  }, [loading, onScrollPositionChange, scrollContainerRef, session?.id]);

  useEffect(() => {
    if (searchTarget) setPendingScrollRestore(null);
  }, [searchTarget, setPendingScrollRestore]);

  useEffect(() => {
    const position = pendingScrollRestore;
    const sessionId = session?.id;
    if (!position || !sessionId || loading || searchTarget || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    const controller = new AbortController();

    const locate = async () => {
      const initialHistory = searchHistoryRef.current;
      if (initialHistory.entryIds.includes(position.anchorEntryId)) {
        setVisibleCount((current) => Math.max(current, initialHistory.entryIds.length * 2));
        setRestoreAnchorReady(true);
        return;
      }

      loadingOlderRef.current = true;
      let before = initialHistory.historyCursor;
      let hasMore = initialHistory.hasEarlierMessages;
      try {
        while (hasMore && before && !controller.signal.aborted) {
          const context = await loadContext(sessionId, activeLeafId, before, { signal: controller.signal });
          if (controller.signal.aborted) return;
          if (!context) {
            scrollToBottom("instant");
            setPendingScrollRestore(null);
            return;
          }
          setVisibleCount((current) => current + Math.max(VISIBLE_PAGE_SIZE, context.messages.length * 2));
          if (context.entryIds.includes(position.anchorEntryId)) {
            setRestoreAnchorReady(true);
            return;
          }
          if (context.oldestEntryId === position.oldestEntryId) break;
          before = context.oldestEntryId;
          hasMore = context.hasMore;
        }
        if (!controller.signal.aborted) {
          scrollToBottom("instant");
          setPendingScrollRestore(null);
        }
      } finally {
        loadingOlderRef.current = false;
      }
    };

    const started = work.run(locate);
    workObservationRef.current?.started("saved-locate", started);
    return () => {
      controller.abort();
      // A branch change cancels restoration and must reveal the new context.
      setPendingScrollRestore(null);
    };
  }, [work, activeLeafId, loadContext, loading, pendingScrollRestore, scrollToBottom, searchTarget, session?.id, setPendingScrollRestore]);

  useLayoutEffect(() => {
    const position = pendingScrollRestore;
    const content = messageContentRef.current;
    if (!position || !content || searchTarget) return;
    const element = Array.from(content.children).find((candidate) => (
      candidate instanceof HTMLElement && candidate.dataset.entryId === position.anchorEntryId
    ));
    if (element instanceof HTMLElement) {
      scrollToMessage(element, position.anchorOffset);
      setPendingScrollRestore(null);
      return;
    }
    if (restoreAnchorReady) {
      scrollToBottom("instant");
      setPendingScrollRestore(null);
    }
  }, [entryIds, pendingScrollRestore, restoreAnchorReady, scrollToBottom, scrollToMessage, searchTarget, visibleCount, setPendingScrollRestore]);

  useEffect(() => {
    if (!searchTarget || loading) return;
    const controller = new AbortController();
    const locate = async () => {
      const history = searchHistoryRef.current;
      let found = history.entryIds.includes(searchTarget.entryId);
      if (!found && !sessionBusy && history.hasEarlierMessages && history.historyCursor && !loadingOlderRef.current) {
        loadingOlderRef.current = true;
        const container = scrollContainerRef.current;
        if (container) prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
        // ponytail: one extra page of 200 entries; deeper or other-branch hits just open the session.
        const context = await loadContext(searchTarget.sessionId, activeLeafId, history.historyCursor, { tail: 200, signal: controller.signal });
        loadingOlderRef.current = false;
        found = Boolean(context?.entryIds.includes(searchTarget.entryId));
      }
      if (controller.signal.aborted) return;
      if (found) {
        prevScrollDistanceRef.current = null;
        setVisibleCount((current) => Math.max(current, (searchHistoryRef.current.entryIds.length + 200) * 2));
        setPendingSearchScroll(searchTarget);
      } else {
        onSearchTargetHandled?.(searchTarget);
      }
    };
    const started = work.run(locate);
    workObservationRef.current?.started("search-locate", started);
    return () => controller.abort();
  }, [work, searchTarget, loading, activeLeafId, sessionBusy, loadContext, onSearchTargetHandled, scrollContainerRef]);

  useLayoutEffect(() => {
    if (!pendingSearchScroll || pendingSearchScroll !== searchTarget) return;
    const selector = `[data-entry-id="${CSS.escape(pendingSearchScroll.entryId)}"]`;
    const element = scrollContainerRef.current?.querySelector<HTMLElement>(searchMessage?.role === "user" ? selector : `${selector} [data-search-target]`);
    if (element) {
      scrollToMessage(element);
      element.animate([
        { backgroundColor: "var(--bg-selected)" },
        { backgroundColor: "transparent" },
      ], { duration: 2500 });
    }
    setPendingSearchScroll(null);
    onSearchTargetHandled?.(pendingSearchScroll);
  }, [pendingSearchScroll, searchTarget, searchMessage, scrollContainerRef, scrollToMessage, onSearchTargetHandled]);

  // IntersectionObserver on the sentinel div at the top of the message list.
  // When it becomes visible, load the next page of older messages.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        // No older history loaded yet: fetch the previous page from the server
        // and prepend it (loadContext handles prepend + scroll anchoring).
        // Skip while a page is already loading or nothing older exists.
        // Restoring a saved anchor owns pagination until its layout is settled.
        // A sentinel observed at the initial top must not overwrite that anchor.
        if (loadingOlderRef.current || pendingScrollRestoreRef.current || prevScrollDistanceRef.current !== null) return;
        // Observer entries describe an earlier layout. A restored viewport can
        // already be away from the top when a queued intersecting entry arrives.
        if (!sentinel.isConnected) return;
        const sentinelBounds = sentinel.getBoundingClientRect();
        const viewportBounds = container.getBoundingClientRect();
        if (sentinelBounds.bottom < viewportBounds.top || sentinelBounds.top > viewportBounds.bottom) return;
        if (!hasEarlierMessages) return;
        const oldestId = historyCursor;
        if (!oldestId) return;
        const sid = session?.id ?? sessionIdRef.current;
        if (!sid) return;
        loadingOlderRef.current = true;
        prevScrollDistanceRef.current = captureScrollDistance(container.scrollHeight, container.scrollTop);
        const started = work.run(() => loadContext(sid, activeLeafId, oldestId).then((context) => {
          if (!context) prevScrollDistanceRef.current = null;
        }).finally(() => {
          loadingOlderRef.current = false;
        }));
        workObservationRef.current?.started("history-prepend", started);
      },
      { root: container, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [work, historyCursor, hasEarlierMessages, session, activeLeafId, loadContext, sessionIdRef, scrollContainerRef]);

  // Keep the rendered window at least as large as what's loaded, so prepended
  // (older) pages stay visible instead of being sliced off the top.
  useEffect(() => {
    setVisibleCount((current) => Math.max(current, messages.length));
  }, [messages.length]);

  // Anchor only after the prepend is rendered, including prepends within an
  // already-expanded budget. Until then its distance also blocks pagination.
  useLayoutEffect(() => {
    if (prevScrollDistanceRef.current == null || visibleCount < messages.length) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = restoreScrollTop(container.scrollHeight, prevScrollDistanceRef.current);
    prevScrollDistanceRef.current = null;
  }, [visibleCount, messages.length, scrollContainerRef]);
  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? [
      sessionStats.sessionId,
      sessionStats.sessionFile ?? "",
      sessionStats.sessionName ?? "",
      sessionStats.userMessages,
      sessionStats.assistantMessages,
      sessionStats.toolCalls,
      sessionStats.toolResults,
      sessionStats.totalMessages,
      sessionStats.tokens.input,
      sessionStats.tokens.output,
      sessionStats.tokens.cacheRead,
      sessionStats.tokens.cacheWrite,
      sessionStats.tokens.total,
      sessionStats.cost ?? 0,
      sessionStats.totalActiveMs ?? 0,
    ].join("|")
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  // Match ChatMinimap's reference budget; UI-only cards are standalone below,
  // but must not shift the minimap's ordinary conversation message indexes.
  const visibleMessages = messages.filter((m) => isMessageGroupAnchor(m) || m.role === "assistant");
  // Stable Map identity: `messages` doesn't change during streaming updates
  // (the streaming message lives in streamingStore), so memoized MessageViews
  // skip re-rendering on every message_update event. An inline `new Map()`
  // here used to defeat MessageView's memo() on each streamed chunk.
  const toolResultsMap = useMemo(() => {
    const map = new Map(activeToolResults);
    for (const msg of messages) {
      if (msg.role === "toolResult") {
        map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
      }
    }
    return map;
  }, [activeToolResults, messages]);
  const inputHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const text = getUserInputText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history.reverse();
  }, [messages]);
  const messageRefs = useMessageRefs(visibleMessages.length);
  const revealHistoryForMinimap = useCallback(() => {
    stopQuestionFollow();
    setVisibleCount((current) => Math.max(current, messages.length * 2));
  }, [messages.length, stopQuestionFollow]);

  const isEmptyNew = isNew && messages.length === 0 && !isStreaming && !sessionBusy;
  useScrollbarVisibility(scrollContainerRef, Boolean(session?.id) || !isEmptyNew);
  const messageCwd = session?.cwd ?? newSessionCwd ?? undefined;
  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const chatInputElement = historyOnly ? (
    <div role="status" className="px-4 py-3 text-sm text-text-muted" data-history-only="true">
      {t(session?.cwdState === "missing" ? "chat.folderMissing" : "chat.folderUnavailable")}
      {" "}{t("chat.historyOnly")}
      {sessionRunning && <button type="button" onClick={handleAbort} className="ml-3 underline">{t("chat.stop")}</button>}
    </div>
  ) : (
    <ChatInput
      work={work}
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      onPromptWithStreamingBehavior={agentRunning ? handlePromptWithStreamingBehavior : undefined}
      isStreaming={sessionBusy}
      model={displayModelValue}
      isAutoModelSelection={isAutoModelSelection}
      modelNames={modelNames}
      modelList={modelList}
      modelError={modelError}
      modelScopeWarnings={modelScopeWarnings}
      onModelChange={handleModelChange}
      modelSwitching={modelSwitching}
      accountControl={(session?.cwd ?? newSessionCwd) && <ProviderAccounts
        key={`provider-accounts:${session?.id ?? newSessionCwd}`}
        cwd={(session?.cwd ?? newSessionCwd)!}
        sessionId={session?.id ?? sessionIdRef.current}
        provider={displayModelValue?.provider ?? ""}
        busy={sessionBusy || modelSwitching}
        onSessionChange={async (provider, id, selection) => {
          await handleSessionAccountChange(provider, id, selection);
          await loadModels();
        }}
        onAccountsChanged={async () => { await loadModels(); }}
      />}
      nativeToolsControl={session?.relation?.kind !== "subagent" && (session?.cwd ?? newSessionCwd) && <SessionToolsControl
        key={`session-tools:${session?.id ?? newSessionDraftKey ?? newSessionCwd}`}
        cwd={(session?.cwd ?? newSessionCwd)!}
        sessionId={session?.id ?? sessionIdRef.current}
        selection={data?.nativeResources}
        busy={sessionBusy || isCompacting || modelSwitching || modelSpeedChanging}
        chatOnly={toolPreset === "none"}
        onApply={handleNativeResourcesChange}
      />}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      compactResult={compactResult}
      toolPreset={toolPreset}
      onToolPresetChange={session || isNew ? handleToolPresetChange : undefined}
      thinkingLevel={thinkingLevel}
      modelSpeed={modelSpeed}
      modelSpeedChanging={modelSpeedChanging}
      onModelSpeedChange={session || isNew ? handleModelSpeedChange : undefined}
      isAutoThinkingSelection={isAutoThinkingSelection}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      queuedMessages={queuedMessages}
      inputHistory={inputHistory}
      onRecallQueue={handleRecallQueue}
      slashCommands={slashCommands}
      slashCommandsLoading={slashCommandsLoading}
      onLoadSlashCommands={loadSlashCommands}
      onBuiltinCommand={handleBuiltinSlashCommand}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      onAudioUnlock={unlockAudio}
      draftKey={session?.id ?? newSessionDraftKey ?? undefined}
      cwd={session?.cwd ?? newSessionCwd}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
         {t("chat.loadingSession")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="chat-content relative flex h-full min-w-0 flex-col overflow-hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      <div
        style={{
          position: "absolute",
          top: 12,
          left: 0,
          right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
          zIndex: 40,
          display: "flex",
          // Toasts live in the top-right corner
          justifyContent: "flex-end",
          padding: `0 ${CHAT_COLUMN_PADDING}px`,
          pointerEvents: "none",
        }}
      >
        <NoticeShelf notices={notices} floating onPauseChange={setNoticePaused} />
      </div>

      <ArchivedSessionNotice key={archivedRootSessionId ?? "none"} rootSessionId={archivedRootSessionId}
        busy={sessionBusy || isCompacting || archiveActionBusy} onRestored={onSessionRestored} />
      {contextReloadNotice}
      {possibleInterruptedRun && (
        <div role="status" className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-text">
          <span className="min-w-0 flex-1">{t("chat.possibleInterruptedRun")}</span>
          <button type="button" onClick={() => void dismissPossibleInterruption()} className="shrink-0 text-accent hover:underline" aria-label={t("chat.dismissInterruption")}>{t("chat.dismissInterruption")}</button>
        </div>
      )}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {extensionCustomUi && (
          <ExtensionCustomPanel key={extensionCustomUi.id} request={extensionCustomUi} onInput={sendExtensionCustomInput} />
        )}
        {!isEmptyNew && <>
        <div
          ref={scrollContainerRef}
          // The message list is the one place long output has to be dragged through,
          // so it shows its scrollbar instead of hiding it behind the minimap (#788).
          // A stable gutter keeps the centred column from shifting when a short
          // session grows past one screen.
          className="scrollbar-subtle min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-4 [scrollbar-gutter:stable]"
          style={{ visibility: pendingScrollRestore ? "hidden" : undefined }}
        >
          <div style={{ minWidth: 0, padding: `0 ${CHAT_COLUMN_PADDING}px` }}>
            <div ref={messageContentRef} data-chat-message-column onPointerUp={captureQuotedSelection} style={{ width: "100%", minWidth: 0, maxWidth: "var(--chat-content-max-width, none)", margin: "0 auto" }}>
            {(() => {
              // Anchor for live-tail detection. A compaction summary or subagent
              // completion can sit after the last user message and own the
              // still-streaming segment.
              let lastAnchorIdx = -1;
              for (let i = messages.length - 1; i >= 0; i--) {
                if (isMessageGroupAnchor(messages[i])) { lastAnchorIdx = i; break; }
              }

              const visibleRefIndexByMessage = new Map<number, number>();
              let refIdx = 0;
              messages.forEach((msg, idx) => {
                if (isMessageGroupAnchor(msg) || msg.role === "assistant") {
                  visibleRefIndexByMessage.set(idx, refIdx++);
                }
              });

              const attachVisibleRef = (refIndex: number) => (el: HTMLDivElement | null) => {
                messageRefs.current[refIndex] = el;
              };

              const renderMessage = (idx: number, options: { attachRef?: boolean; keyPrefix?: string; messageOverride?: AgentMessage; showTimestamp?: boolean; writtenFiles?: WrittenFile[] } = {}): ReactNode => {
                const msg = options.messageOverride ?? messages[idx];
                const isVisible = isMessageGroupAnchor(msg) || msg.role === "assistant";
                const currentRefIdx = visibleRefIndexByMessage.get(idx);
                const keyPrefix = options.keyPrefix ?? "message";
                const messageKey = entryIds[idx] || idx;
                const view = (
                  <MessageView
                    key={`${keyPrefix}-view-${messageKey}`}
                    message={msg}
                    onThinkingWork={workObserver?.thinking}
                    onCopyWork={workObserver?.copy}
                    toolResults={toolResultsMap}
                    modelNames={modelNames}
                    cwd={messageCwd}
                    onOpenFile={onOpenFile}
                    onOpenSession={onOpenSession}
                    entryId={entryIds[idx]}
                    searchBlock={entryIds[idx] === pendingSearchScroll?.entryId ? searchBlock : undefined}
                    onFork={isNew ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={sessionBusy ? undefined : handleNavigate}
                    onEditContent={handleEditContent}
                    showTimestamp={options.showTimestamp}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as AgentMessage & { timestamp?: number }).timestamp : undefined}
                    sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                    writtenFiles={options.writtenFiles}
                  />
                );
                if (!isVisible) return view;
                return (
                  <div key={`${keyPrefix}-${messageKey}`} data-entry-id={entryIds[idx]} ref={options.attachRef === false || currentRefIdx === undefined ? undefined : attachVisibleRef(currentRefIdx)}>
                    {view}
                  </div>
                );
              };

              const rendered: ReactNode[] = [];
              for (let idx = 0; idx < messages.length;) {
                const msg = messages[idx];
                if (!isMessageGroupAnchor(msg)) {
                  rendered.push(renderMessage(idx));
                  idx += 1;
                  continue;
                }

                const userIdx = idx;
                let endIdx = userIdx + 1;
                while (endIdx < messages.length && !isMessageGroupAnchor(messages[endIdx])) endIdx += 1;

                const finalAssistantIdx = findFinalAssistantIndex(messages, userIdx, endIdx);

                if (finalAssistantIdx === -1) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                const isLiveTail = (sessionBusy || isStreaming) && endIdx === messages.length && userIdx === lastAnchorIdx;
                if (isLiveTail) {
                  for (let renderIdx = userIdx; renderIdx < endIdx; renderIdx++) {
                    rendered.push(renderMessage(renderIdx));
                  }
                  idx = endIdx;
                  continue;
                }

                rendered.push(renderMessage(userIdx));

                const finalAssistant = messages[finalAssistantIdx] as AssistantMessage;
                const finalSplit = splitFinalAssistantBlocks(finalAssistant);
                const finalAnswerMessage = finalSplit.answerBlocks.length > 0 || getAssistantErrorMessage(finalAssistant) || isAssistantTruncated(finalAssistant)
                  ? withAssistantBlocks(finalAssistant, finalSplit.answerBlocks)
                  : null;

                const finalProcessEnd = finalAssistant.content.indexOf(finalSplit.answerBlocks[0]);
                // Keep the original prefix so deferred thinking retains its stored block indices.
                const finalProcessBlocks = finalAssistant.content.slice(0, finalProcessEnd < 0 ? undefined : finalProcessEnd);

                const processViews: ReactNode[] = [];
                let processToolCount = 0;
                let processRefIdx: number | undefined;
                let revealProcess = false;

                for (let processIdx = userIdx + 1; processIdx <= finalAssistantIdx; processIdx++) {
                  const processMessage = messages[processIdx];
                  if (processMessage.role === "custom") {
                    revealProcess ||= Boolean(pendingSearchScroll && pendingSearchScroll.entryId === entryIds[processIdx]);
                    processViews.push(renderMessage(processIdx, { attachRef: false, keyPrefix: "process" }));
                    continue;
                  }
                  if (processMessage.role !== "assistant") continue;
                  const message = processIdx === finalAssistantIdx
                    ? withAssistantBlocks(processMessage, finalProcessBlocks, { omitUsage: Boolean(finalAnswerMessage) })
                    : processMessage;
                  const blocks = getDisplayableAssistantBlocks(message);
                  if (blocks.length === 0) continue;
                  processRefIdx ??= visibleRefIndexByMessage.get(processIdx);
                  processToolCount += countToolCallBlocks(blocks);
                  revealProcess ||= Boolean(pendingSearchScroll && entryIds[processIdx] === pendingSearchScroll.entryId && (!searchBlock || blocks.includes(searchBlock)));
                  processViews.push(renderMessage(processIdx, {
                    attachRef: false,
                    keyPrefix: "process",
                    messageOverride: message,
                    // The split final entry shows its timestamp beside its answer's usage.
                    showTimestamp: processIdx !== finalAssistantIdx || !finalAnswerMessage,
                  }));
                }

                if (processViews.length > 0) {
                  rendered.push(
                    <div
                      key={`process-group-${entryIds[userIdx] || userIdx}`}
                      ref={processRefIdx === undefined ? undefined : (el) => { messageRefs.current[processRefIdx] = el; }}
                    >
                      <ProcessDetailsGroup messageCount={processViews.length} toolCallCount={processToolCount} defaultExpanded={!finalAnswerMessage} reveal={revealProcess} t={t}>
                        {processViews}
                      </ProcessDetailsGroup>
                    </div>,
                  );
                }

                if (finalAnswerMessage) {
                  // Each tool call is stored as its own assistant entry, so the
                  // final answer alone carries no record of what the turn wrote.
                  // Gather the turn's assistant blocks and derive the file list
                  // from the write/edit calls among them.
                  const turnContent: AssistantContentBlock[] = [];
                  for (let i = userIdx + 1; i <= finalAssistantIdx; i++) {
                    const m = messages[i];
                    if (m?.role === "assistant") {
                      for (const b of (m as AssistantMessage).content ?? []) turnContent.push(b);
                    }
                  }
                  const writtenFiles = extractTurnWrittenFiles(turnContent, toolResultsMap, messageCwd);
                  rendered.push(renderMessage(finalAssistantIdx, {
                    messageOverride: finalAnswerMessage,
                    writtenFiles,
                  }));
                }
                for (let renderIdx = finalAssistantIdx + 1; renderIdx < endIdx; renderIdx++) {
                  rendered.push(renderMessage(renderIdx));
                }
                idx = endIdx;
              }
              const { startIndex } = getVisibleRenderWindow(rendered.length, visibleCount);
              const hasMore = startIndex > 0 || hasEarlierMessages;
              return (
                <>
                  {hasMore && (
                     <div ref={sentinelRef} className="py-3 text-center text-xs text-text-muted">
                       {t("chat.loadEarlier")}
                    </div>
                  )}
                  {rendered.slice(startIndex)}
                </>
              );
            })()}
            {isStreaming && hasStreamingContent && (
              <StreamingReply store={streamingStore} onCommit={followLiveOutput} toolResults={toolResultsMap} modelNames={modelNames} cwd={messageCwd} onOpenFile={onOpenFile} onOpenSession={onOpenSession} onThinkingWork={workObserver?.thinking} onCopyWork={workObserver?.copy} />
            )}

            {agentRunning && !hasStreamingContent && agentPhase && (
              <div className="break-words py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase, t)}</span>
              </div>
            )}

            {bashRunning && !pendingBash && (
              <div className="py-2 text-[13px] text-text-muted">
                 <span className="animate-[pulse_1.5s_infinite]">{t("chat.runningCommand")}</span>
              </div>
            )}

            {pendingBash && (
              <MessageView
                message={{
                  role: "bashExecution",
                  command: pendingBash.command,
                  output: "",
                  excludeFromContext: pendingBash.excludeFromContext,
                } as BashExecutionMessage}
                sessionId={session?.id ?? sessionIdRef.current ?? undefined}
                onOpenSession={onOpenSession}
              />
            )}

            {extensionDialog && (
              <div ref={questionCardRef} className="my-4 min-w-0 scroll-mt-4">
                <BlockingRequestCard request={extensionDialog} sessionId={session?.id ?? sessionIdRef.current ?? undefined} onRespond={respondToExtensionUi} />
              </div>
            )}
            </div>
          </div>
        </div>
        {isMobile || pendingScrollRestore ? null : (
          <ChatMinimap
            messages={messages}
            getStreamingMessage={getStreamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
            onRevealHistory={revealHistoryForMinimap}
            onNavigate={stopQuestionFollow}
          />
        )}
        </>}
      </div>

      {quoteSelectionEnabled && quotedSelection && createPortal(
        <div
          ref={quotePopoverRef}
          inert={covered}
          role={quoteInputOpen ? "dialog" : "toolbar"}
          aria-label={t(quoteInputOpen ? "chat.newQuoteChat" : "chat.askSelection")}
          style={{
            position: "fixed",
            top: quotedSelection.top,
            left: quotedSelection.left,
            zIndex: 260,
            display: covered ? "none" : "flex",
            flexWrap: "wrap",
            gap: 3,
            width: quoteInputOpen ? "min(420px, calc(100vw - 16px))" : undefined,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(var(--app-viewport-height, 100dvh) - 16px)",
            overflowY: "auto",
            padding: quoteInputOpen ? 12 : 3,
            border: "1px solid var(--border)",
            borderRadius: 6,
            background: "var(--bg)",
            boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
          }}
        >
          {quoteInputOpen ? (
            <fieldset
              disabled={quoteSubmitting}
              aria-busy={quoteSubmitting}
              style={{ width: "100%", minWidth: 0, margin: 0, padding: 0, border: "none", display: "flex", flexDirection: "column", gap: 10 }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 600 }}>{t("chat.askInNewChat")}</span>
                <button type="button" className="file-viewer-icon-button" title={t("i18n.close")} aria-label={t("i18n.close")} disabled={quoteSubmitting} onClick={closeQuotedSelection} style={{ border: "none" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
              </div>
              <ChatInput
                work={work}
                ref={quoteChatInputRef}
                compact
                onSend={askSelectionInNewChat}
                onAbort={closeQuotedSelection}
                isStreaming={false}
              />
              {quoteError && <div role="alert" style={{ color: "#dc2626", fontSize: 12, overflowWrap: "anywhere" }}>{quoteError}</div>}
            </fieldset>
          ) : <>
          <button
            type="button"
            className="file-viewer-icon-button"
            title={t("chat.askInCurrent")}
            aria-label={t("chat.askInCurrent")}
            onPointerDown={(event) => event.preventDefault()}
            onClick={askSelectionHere}
            style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: 12, fontWeight: 500 }}
          >
            <span aria-hidden="true" style={{ fontSize: 15 }}>@</span>
            <span>{t("chat.askInCurrent")}</span>
          </button>
          {onAskInNewChat && quotedSelection.sourceEntryId && (
            <button
              type="button"
              className="file-viewer-icon-button"
              title={t("chat.askInNewChat")}
              aria-label={t("chat.askInNewChat")}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => { setQuoteInputOpen(true); window.getSelection()?.removeAllRanges(); }}
              style={{ width: "auto", height: 35, flex: "0 0 auto", gap: 5, padding: "0 10px", border: "none", fontSize: 12, fontWeight: 500 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M6 3v12M18 9a9 9 0 0 1-9 9" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" />
              </svg>
              <span>{t("chat.askInNewChat")}</span>
            </button>
          )}
          </>}
        </div>,
        document.body,
      )}

      <div className="relative shrink-0">
        {!isEmptyNew && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              left: 0,
              right: isMobile ? 0 : CHAT_MINIMAP_WIDTH,
              display: "flex",
              justifyContent: "center",
              paddingBottom: 10,
              pointerEvents: "none",
              zIndex: 20,
            }}
          >
            <button
              type="button"
              className={`chat-scroll-to-bottom${showScrollToBottom && !pendingScrollRestore ? " is-visible" : ""}`}
              title={t("chat.scrollToLatest")}
              aria-label={t("chat.scrollToLatest")}
              onClick={() => scrollToBottom("smooth")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </button>
          </div>
        )}
        {isEmptyNew && (
          <div className="mb-3 w-full" style={{ paddingLeft: 16, paddingRight: isMobile ? 16 : 52 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, maxWidth: "var(--chat-content-max-width, none)", margin: "0 auto", fontFamily: "var(--font-mono)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 7 : 10, minWidth: 0, flex: 1, lineHeight: 1.4, overflow: "hidden" }}>
                <Image src="/icons/apple-touch-icon.png" width={32} height={32} alt="" priority style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 22, color: "var(--text)", fontWeight: 700, flexShrink: 0, whiteSpace: "nowrap" }}>Pi Web</span>
                <NewSessionUpdateLink label={(version) => t("appUpdate.releaseNotes", { version })} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  web <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  pi <span style={{ color: "var(--text)" }}>v{process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}</span>
                </span>
              </div>
            </div>
          </div>
        )}
        {chatInputElement}
        <ExtensionStatusBar statuses={extensionStatuses} widgets={extensionWidgets} />
      </div>
      {isEmptyNew && <div className="min-h-0 flex-1" />}
    </div>
  );
}

// Toast 整体高度上限；文本区高度上限 = 整体上限 - 上下 padding(14*2) - 上下边框(1*2)
const NOTICE_MAX_HEIGHT_PX = 500;
const NOTICE_TEXT_MAX_HEIGHT_PX = NOTICE_MAX_HEIGHT_PX - 30;

const StreamingReply = memo(function StreamingReply({ store, onCommit, ...props }: {
  store: StreamingStore;
  onCommit: () => void;
  toolResults: Map<string, ToolResultMessage>;
  modelNames: Record<string, string>;
  cwd?: string;
  onOpenFile?: import("@/lib/file-links").OpenFileLink;
  onOpenSession?: (sessionId: string) => void;
  onThinkingWork?: ChatWindowWorkObserver["thinking"];
  onCopyWork?: ChatWindowWorkObserver["copy"];
}) {
  const message = useStreamingSelector(store, selectStreamingMessage);
  useLayoutEffect(onCommit, [message, onCommit]);
  return message ? <MessageView message={message} isStreaming {...props} /> : null;
});

export function NoticeShelf({ notices, floating = false, onPauseChange }: { notices: NoticeItem[]; floating?: boolean; onPauseChange?: (id: string | null) => void }) {
  if (notices.length === 0) return null;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        // Right-anchored: every toast's right edge aligns here, widths extend leftward
        alignItems: "flex-end",
        marginBottom: floating ? 0 : 10,
      }}
    >
      {notices.map((notice, index) => {
        const color = notice.type === "error"
          ? "#ef4444"
          : notice.type === "warning"
            ? "#d97706"
            : notice.type === "success"
              ? "#10b981"
              : "var(--accent)";
        return (
          <div
            key={notice.id}
            className="notice-shelf-item"
            onMouseEnter={() => onPauseChange?.(notice.id)}
            onMouseLeave={(event) => {
              if (!event.currentTarget.contains(document.activeElement)) onPauseChange?.(null);
            }}
            onFocus={() => onPauseChange?.(notice.id)}
            onBlur={(event) => {
              if (!event.currentTarget.matches(":hover")) onPauseChange?.(null);
            }}
            style={{
              display: "flex",
              // Top-align children so the type dot sits by the first line on multi-line toasts
              alignItems: "flex-start",
              gap: 10,
              minHeight: 60,
              height: "auto",
              // 整体高度上限：超出后由文本区内部滚动承担（见下方 span 的 overflowY），
              // 容器自身保持 hidden，小圆点固定在顶部不随文本滚动
              maxHeight: NOTICE_MAX_HEIGHT_PX,
              // The floating wrapper is pointerEvents:"none" (click-through by design),
              // so the toast itself must opt back into interactivity or hover events never reach it
              pointerEvents: "auto",
              marginBottom: index === notices.length - 1 ? 0 : 6,
              overflow: "hidden",
              borderRadius: 14,
              border: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
              background: "var(--bg)",
              color: "var(--text-muted)",
              width: "fit-content",
              maxWidth: "min(100%, 620px)",
              boxShadow: floating
                ? "0 1px 2px rgba(15,23,42,0.05), 0 10px 28px -14px rgba(15,23,42,0.24)"
                : "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
              fontSize: 14,
              lineHeight: 1.5,
              transformOrigin: "top right",
              // Use backwards fill for the entrance animation so height styles return to
              // inline styles once it finishes; otherwise the keyframe's fixed 60px would
              // stick around in fill mode and permanently clamp the expanded toast
              animation: notice.exiting
                ? "notice-shelf-out 0.18s ease-in forwards"
                : "notice-shelf-in 0.18s ease-out backwards",
              padding: "0 12px",
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: color,
                flexShrink: 0,
                // Align with the optical center of the first text line: 14px vertical
                // padding + (21px line box - 7px dot) / 2
                marginTop: 21,
              }}
            />
            {/* Full text by default: pre-line preserves \n (nowrap/normal collapse
                newlines into spaces) and long lines wrap instead of truncating;
                content taller than the cap scrolls inside the text area */}
            <span
              tabIndex={0}
              style={{ padding: "14px 0", minWidth: 0, maxWidth: "100%", maxHeight: NOTICE_TEXT_MAX_HEIGHT_PX, overflowY: "auto", scrollbarWidth: "thin", whiteSpace: "pre-line", wordBreak: "break-word" }}
            >
              {notice.message}
            </span>
          </div>
        );
      })}
    </div>
  );
}
