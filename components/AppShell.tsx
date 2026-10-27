"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGlobalKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useSystemInfoState, useSystemInfoActions } from "@/hooks/useSessionSystemInfo";
import { SessionSystemInfoButtons } from "./SessionSystemInfoButtons";
import { useSessionFileBinding } from "@/hooks/useSessionFileBinding";
import { useSessionNavigationChatBinding } from "./session-navigation-chat";
import { sessionNavigationArchiveBinding } from "./session-navigation-archive";
import { SessionNavigationSidebar } from "./SessionNavigation";
import { useSessionAutoName } from "@/hooks/useSessionAutoName";
import { SessionAutoNameButton, OverviewNavigationButtons } from "./SessionNavigationControls";
import { useNavigationState, useSessionNavigation } from "@/hooks/useSessionNavigation";
import { ChatWindow } from "./ChatWindow";
import { isHistoryOnlySession } from "@/lib/session-directory";
import { MarkdownMediaScope } from "./MarkdownMedia";
import { WebVersionNotice } from "./WebVersionNotice";
import { ActivityViews } from "./ActivityViews";
import { useActivityController, useActivityOwner } from "@/hooks/useActivityController";
import { useHiddenProjects } from "@/hooks/useHiddenProjects";
import { getActivitySections } from "@/lib/activity";
import { prepareReviewDraft, type ReviewBatchDraft } from "@/lib/review-handoff";
import { FileWorkspace, type FileWorkspaceHandle, type FileWorkspaceStatus } from "./FileWorkspace";
import { FileLinkMenuContext } from "./LocalFileLink";
import type { FileDisposition } from "@/lib/file-workspace";
import type { FileRevealRequest } from "@/lib/explorer-reveal";
import { GitExplorerPanel } from "./GitExplorerPanel";
import { ReviewNavigationContext } from "./ReviewNotebookBlock";
import type { ReviewCommitReference, ReviewNavigation } from "@/lib/review-notebook";
import { TabBar, type Tab } from "./TabBar";
import { useQuotedChatBranch } from "@/hooks/useQuotedChatBranch";
import { SessionToolbarActions, SessionStatsButton, MainFileToggle, ToolbarActionsStrip, MobileSessionIdentity, shellExpansionState, toggleFileExpansion, SidebarToolbarToggle, GitToolbarToggle, MobileChatToolbar, useTopPanelState, SubagentToolbarMarker, mobileToolbarVisible } from "./AppShellToolbar";
import { SettingsPanel, SettingsSectionIcon } from "./SettingsPanel";
import { useSshAgent } from "@/hooks/useSshAgent";
import { SshSigningCards } from "./SshSigningCards";
import { SshSidebarButton } from "./SshSidebarButton";
import { AcceptancePanel } from "./AcceptancePanel";
import { ScratchpadPanel } from "./ScratchpadPanel";
import { ProjectTrustDialog, type TrustChoice } from "./ProjectTrustDialog";
import { respondToProjectTrust } from "./project-trust-transaction";
import { BranchNavigator, hasSessionBranches } from "./BranchNavigator";
import { SystemPromptPanel } from "./SystemPromptPanel";
import { ToolDefinitionsPanel } from "./ToolDefinitionsPanel";
import { AgentSessionPanel } from "./AgentSessionPanel";
import { TerminalPanel } from "./TerminalPanel";
import { newTerminalTab, restoreTerminalTabs, TERMINAL_TABS_KEY, type TerminalTab } from "./terminal-tab-state";
import { useTheme } from "@/hooks/useTheme";
import { useFontPreferences } from "@/hooks/useFontPreferences";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile, useIsSplitLayout } from "@/hooks/useIsMobile";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useAudio } from "@/hooks/useAudio";
import { copyText } from "@/lib/clipboard";
import { getFileName } from "@/lib/file-paths";
import { buildAtMentionText, buildFileAtMentionsText, buildFileLineMentionText } from "@/lib/file-fuzzy";
import { useShellNotifications } from "./useShellNotifications";
import { setupPushSubscription } from "@/lib/push-client";
import {
  getDefaultRightPanelWidth,
  getRightPanelMaxWidth,
  getSidebarMaxWidth,
  RIGHT_PANEL_FALLBACK_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@/lib/panel-layout";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ProjectTrustStatus } from "@/lib/api-types";
import type { ChatInputHandle } from "./ChatInput";
import type { SessionStatsInfo } from "@/lib/pi-types";
import { getAgentsBadge, getSessionFamily } from "@/lib/session-family";
import { getLastSettingsSection, type SettingsSection } from "@/lib/settings-navigation";

type SessionCopyField = "file" | "id" | "projectDir" | "gitBranch" | "gitWorktree";

const TOP_BAR_ICON_BUTTON_SIZE = 36;

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationState = useNavigationState(searchParams);
  const { initialNavigation, selectedSession, setSelectedSession, sessionCatalog, newSessionCwd, initialCwdStatus, initialCwdError, setRefreshKey, sessionKey, setSessionKey, sessionScrollPositionsRef, handleSessionScrollPositionChange, searchTarget, handleSearchTargetHandled, activeCwd } = navigationState;
  // Keep the system-theme subscription mounted for the lifetime of the app.
  useTheme();
  // Restore browser typography before opening Settings or a composer.
  useFontPreferences();
  const { locale, t: translate } = useI18n();
  const isMobile = useIsMobile();
  const isSplitLayout = useIsSplitLayout();
  useViewportHeight();

  // Once the user has granted notification permission, register a Web Push
  // subscription so the server can notify backgrounded PWAs (notably iOS,
  // which suspends page JS and never receives the SSE completion event).
  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;
    void setupPushSubscription(locale);
  }, [locale]);
  // Audio ownership lives here (not in ChatWindow) so the completion tone can
  // also fire for tasks finishing in a non-active workspace whose ChatWindow
  // is not mounted. ChatWindow receives the audio callbacks as props.
  const { soundEnabled, onSoundToggle, playDoneSound, unlockAudio, soundEnabledRef } = useAudio();
  const [quoteSelectionEnabled, setQuoteSelectionEnabled] = useState(false);
  useEffect(() => {
    try {
      setQuoteSelectionEnabled(localStorage.getItem("brabbler-quote-selection-enabled") === "true");
    } catch {
      // Browser storage is best-effort.
    }
  }, []);
  const handleQuoteSelectionChange = useCallback((enabled: boolean) => {
    setQuoteSelectionEnabled(enabled);
    try {
      localStorage.setItem("brabbler-quote-selection-enabled", String(enabled));
    } catch {
      // Keep the current page usable when storage is unavailable.
    }
  }, []);
  const notifiedAttentionRequestIdsRef = useRef(new Set<string>());
  const handleBackgroundTaskDone = useCallback(() => {
    if (soundEnabledRef.current) playDoneSound();
  }, [playDoneSound, soundEnabledRef]);
  const [scratchpadOpen, setScratchpadOpen] = useState(false);
  const [scratchpadMounted, setScratchpadMounted] = useState(false);
  const projectPrivacy = useHiddenProjects();
  const sessionsWithSelection = useMemo(() => {
    if (!selectedSession) return sessionCatalog;
    return [
      ...sessionCatalog.filter((session) => session.id !== selectedSession.id),
      selectedSession,
    ];
  }, [selectedSession, sessionCatalog]);
  const activeSessionFamily = useMemo(
    () => getSessionFamily(sessionsWithSelection, selectedSession?.id),
    [selectedSession?.id, sessionsWithSelection],
  );
  const hasSubagentSessions = Boolean(activeSessionFamily?.subagents.length);
  const activityController = useActivityOwner();
  const { snapshot: activity } = useActivityController(activityController);
  const { runningIds: runningSessionIds, queuedIds: queuedSessionIds,
    attention: activityAttention, reviewIds: reviewSessionIds } = activity;
  const agentsBadge = getAgentsBadge(activeSessionFamily?.subagents ?? [], runningSessionIds);
  const agentsButtonLabel = agentsBadge.running
    ? translate("agentSwitcher.titleRunning", { count: agentsBadge.count })
    : translate("agentSwitcher.titleIdle", { count: agentsBadge.count });
  const [recoveryRefreshKey, setRecoveryRefreshKey] = useState(0);
  const handleRecoveryDismissed = useCallback(() => setRecoveryRefreshKey((key) => key + 1), []);
  const activityNeedsCount = useMemo(() => getActivitySections(
    sessionsWithSelection, runningSessionIds, activityAttention, reviewSessionIds, null, queuedSessionIds,
  )["needs-you"].length, [sessionsWithSelection, runningSessionIds, queuedSessionIds, activityAttention, reviewSessionIds]);
  // The temporary id distinguishes consecutive fresh composers in one cwd.
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [fileRevealRequest, setFileRevealRequest] = useState<FileRevealRequest>();
  const fileRevealId = useRef(0);
  const [settingsSection, setSettingsSection] = useState<SettingsSection | null>(null);
  const sshController = useSshAgent();
  const [acceptanceOpen, setAcceptanceOpen] = useState(false);
  const [pluginSettingsSession, setPluginSettingsSession] = useState<{ id: string; cwd: string } | null>(null);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [projectTrust, setProjectTrust] = useState<ProjectTrustStatus | null>(null);
  const [projectTrustDialogOpen, setProjectTrustDialogOpen] = useState(false);
  const [projectTrustBusy, setProjectTrustBusy] = useState(false);
  const [projectTrustError, setProjectTrustError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(() => !initialNavigation.sidebarCollapsed);
  const [activeOverview, setActiveOverview] = useState<"activity" | "starred" | "git" | null>(null);
  const [overviewMobileList, setOverviewMobileList] = useState(true);
  const [gitExplorerExpanded, setGitExplorerExpanded] = useState(false);
  const gitExplorerTriggerRef = useRef<HTMLButtonElement>(null);
  const [reviewNavigation, setReviewNavigation] = useState<ReviewNavigation | null>(null);
  const reviewNavigationId = useRef(0);
  const closeOverview = useCallback(() => {
    ++reviewNavigationId.current;
    setGitExplorerExpanded(false);
    setActiveOverview(null);
    setReviewNavigation(null);
    setOverviewMobileList(true);
  }, []);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const [chatHidden, setChatHidden] = useState(false);
  const chatCollapsed = chatHidden && rightPanelOpen && isSplitLayout;
  const chatVisibilityRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!rightPanelOpen || !isSplitLayout) setChatHidden(false);
  }, [rightPanelOpen, isSplitLayout]);
  const { rightPanelFullWidth, gitExplorerFullWidth } = shellExpansionState({ rightPanelOpen, rightPanelExpanded, isMobile, activeOverview, gitExplorerExpanded });
  useEffect(() => {
    if (activeOverview !== "git" || isMobile || rightPanelFullWidth) setGitExplorerExpanded(false);
  }, [activeOverview, isMobile, rightPanelFullWidth]);
  useEffect(() => {
    if (!rightPanelOpen || isMobile) setRightPanelExpanded(false);
  }, [rightPanelOpen, isMobile]);
  const [mobileSidebarReady, setMobileSidebarReady] = useState(false);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const rightPanelWidthRef = useRef(RIGHT_PANEL_FALLBACK_WIDTH);
  const getResponsiveRightPanelWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_FALLBACK_WIDTH
      : getDefaultRightPanelWidth(window.innerWidth),
    [],
  );
  const getResponsiveSidebarMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? SIDEBAR_MAX_WIDTH
      : getSidebarMaxWidth({
        viewportWidth: window.innerWidth,
        rightPanelOpen,
        rightPanelWidth: rightPanelWidthRef.current,
      }),
    [rightPanelOpen],
  );
  const getResponsiveRightPanelMaxWidth = useCallback(
    () => typeof window === "undefined"
      ? RIGHT_PANEL_MAX_WIDTH
      : getRightPanelMaxWidth({
        viewportWidth: window.innerWidth,
        sidebarOpen,
        sidebarWidth: sidebarWidthRef.current,
      }),
    [sidebarOpen],
  );
  const sidebarResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeSidebar"),
    cssVariable: "--sidebar-width",
    defaultWidth: SIDEBAR_DEFAULT_WIDTH,
    getMaxWidth: getResponsiveSidebarMaxWidth,
    growthDirection: "right",
    maxWidth: SIDEBAR_MAX_WIDTH,
    minWidth: SIDEBAR_MIN_WIDTH,
    storageKey: "brabbler-sidebar-width",
    widthRef: sidebarWidthRef,
  });
  const rightPanelResizer = useResizablePanel({
    ariaLabel: translate("layout.resizeFilePanel"),
    cssVariable: "--right-panel-width",
    defaultWidth: RIGHT_PANEL_FALLBACK_WIDTH,
    getDefaultWidth: getResponsiveRightPanelWidth,
    getMaxWidth: getResponsiveRightPanelMaxWidth,
    growthDirection: "left",
    maxWidth: Number.MAX_SAFE_INTEGER,
    minWidth: RIGHT_PANEL_MIN_WIDTH,
    storageKey: "brabbler-right-panel-width",
    widthRef: rightPanelWidthRef,
  });
  const reclampSidebarWidth = sidebarResizer.reclampWidth;
  const reclampRightPanelWidth = rightPanelResizer.reclampWidth;
  // On mobile the sidebar is an overlay drawer; hide it by default so the chat
  // is visible on load. Runs once the breakpoint resolves after hydration.
  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  useEffect(() => {
    setMobileSidebarReady(true);
  }, []);
  useEffect(() => {
    if (!rightPanelOpen) return;
    reclampSidebarWidth();
    reclampRightPanelWidth();
  }, [reclampRightPanelWidth, reclampSidebarWidth, rightPanelOpen]);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);
  const sessionHasBranches = hasSessionBranches(branchTree);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const systemInfo = useSystemInfoState();
  const { systemPrompt, systemTools, systemInfoLoading, setSystemPrompt, setSystemTools, setSystemInfoLoading,
    handleSystemPromptChange, handleSystemToolsChange, handleSystemInfoLoaderChange } = systemInfo;
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const handleSessionStatsChange = useCallback((stats: SessionStatsInfo | null) => {
    setSessionStats(stats);
  }, []);
  const [copiedSessionField, setCopiedSessionField] = useState<SessionCopyField | null>(null);
  const sessionCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCopySessionField = useCallback((field: SessionCopyField, value: string) => {
    void copyText(value).then(() => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
      setCopiedSessionField(field);
      sessionCopyTimerRef.current = setTimeout(() => setCopiedSessionField(null), 1400);
    });
  }, []);

  useEffect(() => {
    return () => {
      if (sessionCopyTimerRef.current) clearTimeout(sessionCopyTimerRef.current);
    };
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  const { activeTopPanel, setActiveTopPanel, topPanelPos, toggleTopPanel } = useTopPanelState({
    sessionHasBranches, hasSubagentSessions, rightPanelFullWidth, isMobile, topBarRef, setSidebarOpen,
  });
  const handleSystemInfoToggle = useSystemInfoActions(systemInfo, activeTopPanel, toggleTopPanel);

  const openSessionStatsPanel = useCallback(() => {
    if (isMobile) setSidebarOpen(false);
    setActiveTopPanel("session");
  }, [isMobile, setActiveTopPanel]);

  const handleSidebarToggle = useCallback(() => {
    if (isMobile) setActiveTopPanel(null);
    setSidebarOpen((open) => !open);
  }, [isMobile, setActiveTopPanel]);

  const handleRightPanelToggle = useCallback(() => {
    if (isMobile) {
      setSidebarOpen(false);
      setActiveTopPanel(null);
    }
    setRightPanelOpen((open) => !open);
  }, [isMobile, setActiveTopPanel]);

  const handleGitExplorerExpandToggle = useCallback(() => {
    setActiveTopPanel(null);
    setRightPanelExpanded(false);
    setGitExplorerExpanded((expanded) => !expanded);
  }, [setActiveTopPanel]);
  const handleGitExplorerClose = useCallback(() => {
    closeOverview();
    requestAnimationFrame(() => gitExplorerTriggerRef.current?.focus());
  }, [closeOverview]);

  const handleRightPanelExpandToggle = useCallback(() => {
    toggleFileExpansion(setGitExplorerExpanded, setActiveTopPanel, setRightPanelExpanded);
  }, [setActiveTopPanel]);

  // File workspaces park independently; terminal runtime hosts never move.
  const fileWorkspaceRef = useRef<FileWorkspaceHandle>(null);
  const [fileStatus, setFileStatus] = useState<FileWorkspaceStatus>({ count: 0, groups: [], canSplit: false });
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>("files");
  const [terminalTabs, setTerminalTabs] = useState<TerminalTab[]>([]);
  const [terminalsRestored, setTerminalsRestored] = useState(false);
  const panelTabs: Tab[] = [{ id: "files", label: translate("workspace.files"), filePath: "" }, ...terminalTabs.map((tab) => ({
    id: tab.id,
    label: getFileName(tab.cwd) || tab.cwd,
    filePath: tab.cwd,
    kind: "terminal" as const,
    closing: Boolean(tab.closing),
  }))];

  useEffect(() => {
    try {
      const saved = restoreTerminalTabs(window.sessionStorage.getItem(TERMINAL_TABS_KEY));
      setTerminalTabs(saved.tabs);
      if (saved.activeId) {
        setActiveFileTabId(saved.activeId);
        setRightPanelOpen(saved.open);
      }
    } catch { /* storage is optional */ }
    setTerminalsRestored(true);
  }, []);

  useEffect(() => {
    if (!terminalsRestored) return;
    try {
      window.sessionStorage.setItem(TERMINAL_TABS_KEY, JSON.stringify({
        tabs: terminalTabs.map(({ id, cwd }) => ({ id, cwd })),
        activeId: activeFileTabId,
        open: rightPanelOpen,
      }));
    } catch { /* storage is optional */ }
  }, [terminalTabs, activeFileTabId, rightPanelOpen, terminalsRestored]);

  // Same @mention format as the chat input's @ autocomplete, so the agent's
  // read tool resolves it the same way (it strips the @ prefix).
  const handleAtMention = useCallback((relativePath: string, isDir: boolean) => {
    setChatHidden(false);
    chatInputRef.current?.insertText(buildAtMentionText(relativePath, isDir));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleAtMentions = useCallback((relativePaths: string[]) => {
    setChatHidden(false);
    const mentions = buildFileAtMentionsText(relativePaths);
    if (mentions) chatInputRef.current?.insertText(mentions);
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const handleFileLineMention = useCallback((relativePath: string, startLine: number, endLine: number) => {
    setChatHidden(false);
    chatInputRef.current?.insertText(buildFileLineMentionText(relativePath, startLine, endLine));
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const reviewDestination = selectedSession ? { id: selectedSession.id, label: selectedSession.name || selectedSession.id } : undefined;
  const reviewDestinationRef = useRef(reviewDestination);
  useLayoutEffect(() => { reviewDestinationRef.current = reviewDestination; });
  const handleReviewBatchDraft = useCallback<ReviewBatchDraft>((expected, text) => {
    prepareReviewDraft(expected, reviewDestinationRef.current, chatInputRef.current, text);
    setChatHidden(false);
    if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
  }, [isMobile]);

  const reviewNavigationScope = JSON.stringify([selectedSession?.id, selectedSession?.cwd, activeCwd]);
  useEffect(() => { ++reviewNavigationId.current; setReviewNavigation(null); }, [reviewNavigationScope]);
  const reviewNavigationScopeRef = useRef(reviewNavigationScope);
  useLayoutEffect(() => { reviewNavigationScopeRef.current = reviewNavigationScope; }, [reviewNavigationScope]);
  const handleReviewNavigation = useCallback(() => {
    const requestId = ++reviewNavigationId.current;
    return (reference: ReviewCommitReference, head: string) => {
      if (reviewNavigationScopeRef.current !== reviewNavigationScope || reviewNavigationId.current !== requestId) return;
      setReviewNavigation({ cwd: reference.cwd, branch: reference.branch, oid: reference.oid, head, requestId });
      setActiveTopPanel(null);
      setActiveOverview("git");
      setOverviewMobileList(true);
      setGitExplorerExpanded(false);
      setRightPanelExpanded(false);
      if (isMobile) { setRightPanelOpen(false); setSidebarOpen(false); }
    };
  }, [isMobile, reviewNavigationScope, setActiveTopPanel]);
  const returnToWorkspaceHistory = useCallback(() => {
    ++reviewNavigationId.current;
    setReviewNavigation(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("#git-explorer-panel section")?.focus());
  }, []);
  const navigation = useSessionNavigation(navigationState, { router, isMobile, closeOverview, activeFileTabId, chatInputRef, branchLeafChangeFnRef, setChatHidden, setBranchTree, setBranchActiveLeafId, setSystemPrompt, setSystemTools, setSystemInfoLoading, setActiveTopPanel, setSidebarOpen, setRightPanelOpen, setActiveFileTabId, setOverviewMobileList });
  const { handleSelectSession, handleNewSession, handleSessionSettled, handleActivitySelectSession, handleOpenSession, handleSessionForked, handleSessionRestored, effectiveNewSessionCwd, showChat, initialSessionRestored } = navigation;

  const chatBinding = useSessionNavigationChatBinding(navigationState, navigation, activityController);

  const { autoNameStatus, handleAutoName } = useSessionAutoName({ selectedSession, setSelectedSession, setSessionStats, setRefreshKey, setActiveTopPanel });

  // Global keyboard shortcuts (handles Esc, Ctrl+Alt+N etc.)
  useGlobalKeyboardShortcuts({
    onNewSession: (cwd: string) => handleNewSession(`kb-${Date.now()}`, cwd),
    activeCwd,
  });

  // Client-built transient SessionInfo (new session / fork) lacks the
  // server-computed projectKey, which the same-project check in
  // handleCwdChange relies on. Hydrate it from the session list so switching
  // worktrees right after creating a session doesn't close the chat.
  const { handleAgentEnd, handleAttentionNeeded } = useShellNotifications({
    selectedSession, handleSelectSession, locale, handleSessionSettled,
    setExplorerRefreshKey, translate, notifiedAttentionRequestIdsRef,
  });

  const handleExplorerRefresh = useCallback(() => {
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const { onAskInNewChat: handleAskInNewChat, initialPrompt: quoteInitialPrompt,
    onInitialPromptConsumed: consumeQuoteInitialPrompt } = useQuotedChatBranch(selectedSession?.id, handleSessionForked);

  const handleOpenFile = useCallback((
    filePath: string,
    fileName: string,
    options?: { sourceSessionId?: string | null; cwd?: string; disposition?: FileDisposition; modeHint?: "diff"; page?: number; lineTarget?: import("@/lib/file-links").FileLineTarget },
  ) => {
    const sourceSessionId = options?.sourceSessionId;
    const modeHint = options?.modeHint;
    const page = options?.page;
    fileWorkspaceRef.current?.open({
      label: fileName, filePath, cwd: options?.cwd ?? activeCwd ?? undefined,
      modeHint, page, lineTarget: options?.lineTarget, sourceSessionId,
    }, options?.disposition);
    setActiveFileTabId("files");
    setRightPanelOpen(true);
    // On mobile the file panel is full-screen; close the drawer so it shows.
    if (isMobile) setSidebarOpen(false);
  }, [isMobile, activeCwd]);

  const handleOpenLinkedFile = useCallback((filePath: string, page?: number, lineTarget?: import("@/lib/file-links").FileLineTarget, disposition?: FileDisposition) => {
    handleOpenFile(filePath, getFileName(filePath), { sourceSessionId: selectedSession?.id ?? null, cwd: selectedSession?.cwd, page, lineTarget, disposition });
  }, [handleOpenFile, selectedSession?.id, selectedSession?.cwd]);

  const handleOpenTerminal = useCallback((cwd: string) => {
    const existing = terminalTabs.find((tab) => tab.cwd === cwd);
    const tab = existing ?? newTerminalTab(cwd);
    if (!existing) setTerminalTabs((tabs) => [...tabs, tab]);
    setActiveFileTabId(tab.id);
    setRightPanelOpen(true);
    if (isMobile) setSidebarOpen(false);
  }, [terminalTabs, isMobile]);

  const handleTerminalClosed = (tab: TerminalTab) => {
    const replacement = tab.closing === "restart" ? newTerminalTab(tab.cwd) : null;
    const remaining = terminalTabs.filter((item) => item.id !== tab.id);
    setTerminalTabs((tabs) => tabs.flatMap((item) => item.id !== tab.id ? [item] : replacement ? [replacement] : []));
    setActiveFileTabId((current) => current !== tab.id ? current : replacement?.id ?? remaining.at(-1)?.id ?? "files");
    if (!replacement && !remaining.length && !fileStatus.count) setRightPanelOpen(false);
  };

  const handleCloseFileTab = useCallback((tabId: string) => {
    if (tabId === "files") { setRightPanelOpen(false); return; }
    setTerminalTabs((tabs) => tabs.map((tab) => tab.id === tabId && !tab.closing ? { ...tab, closing: "close" } : tab));
  }, []);

  const handleViewFullHistory = useCallback(() => {
    if (!selectedSession) return;
    window.open(
      `/api/sessions/${encodeURIComponent(selectedSession.id)}/export?inline=1`,
      "_blank",
      "noopener,noreferrer",
    );
  }, [selectedSession]);

  // A sidebar checkout selection must never retarget a chat action detail.
  const historyOnly = isHistoryOnlySession(selectedSession);
  const projectTrustCwd = historyOnly ? null : selectedSession?.cwd ?? effectiveNewSessionCwd;
  const projectTrustCwdRef = useRef(projectTrustCwd);
  projectTrustCwdRef.current = projectTrustCwd;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  useEffect(() => {
    setProjectTrust(null);
    setProjectTrustDialogOpen(false);
    setProjectTrustError(null);
    if (!projectTrustCwd) return;

    const controller = new AbortController();
    fetch(`/api/project-trust?cwd=${encodeURIComponent(projectTrustCwd)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as ProjectTrustStatus & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        setProjectTrust(data);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Failed to load project trust:", error);
      });
    return () => controller.abort();
  }, [projectTrustCwd]);

  const handleTrustProject = useCallback((choice: TrustChoice) => respondToProjectTrust(choice, {
    projectTrustCwd, projectTrustBusy, projectTrustCwdRef,
    setProjectTrustBusy, setProjectTrustError, setProjectTrust,
    setProjectTrustDialogOpen, setModelsRefreshKey, setSessionKey,
  }), [projectTrustBusy, projectTrustCwd, setSessionKey]);

  const { currentFileWorkspaceKey, fileWorkspaceKey, parkedFileWorkspaceKey, setParkedFileWorkspaceKey, parkedFileCwd } = useSessionFileBinding(selectedSession, activeCwd);
  const activeCwdName = activeCwd ? getFileName(activeCwd) || activeCwd : null;
  const windowTitle = activeCwdName ? `${activeCwdName} - Brabbler` : "Brabbler";

  useEffect(() => {
    const syncWindowTitle = () => {
      if (document.title !== windowTitle) document.title = windowTitle;
    };

    syncWindowTitle();
    const observer = new MutationObserver(syncWindowTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [windowTitle]);

  const sidebarContent = (
    <>
      <SessionNavigationSidebar state={navigationState} navigation={navigation}
        onOpenFile={handleOpenFile}
        onOpenTerminal={handleOpenTerminal}
        explorerRefreshKey={explorerRefreshKey}
        fileRevealRequest={fileRevealRequest}
        onExplorerRefresh={handleExplorerRefresh}
        onAtMention={handleAtMention}
        onAtMentions={handleAtMentions}
        onBackgroundTaskDone={handleBackgroundTaskDone}
        activityController={activityController}
      />
      <SshSidebarButton controller={sshController} onOpen={() => setSettingsSection("ssh")} />
      <div style={{ padding: "8px", flexShrink: 0, display: "flex", justifyContent: "space-between", gap: 4 }}>
        {([
          ["models", translate("common.models")],
          ["skills", translate("common.skills")],
        ] as const).map(([section, label]) => {
          const disabled = historyOnly || (section !== "models" && !projectTrustCwd);
          return (
            <button
              key={section}
              type="button"
              onClick={() => setSettingsSection(section)}
              disabled={disabled}
              title={disabled ? translate("settings.projectRequired") : label}
              aria-label={label}
              style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                height: 32, padding: 0, background: "none", border: "none",
                borderRadius: 9, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer",
                fontSize: 12, opacity: disabled ? 0.35 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(event) => { if (!disabled) { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; } }}
              onMouseLeave={(event) => { event.currentTarget.style.background = "none"; event.currentTarget.style.color = "var(--text-muted)"; }}
            >
              <SettingsSectionIcon section={section} size={14} strokeWidth={2} />
              <span>{label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSettingsSection(getLastSettingsSection(projectTrustCwd))}
          disabled={historyOnly}
          title={translate("common.settings")}
          aria-label={translate("common.settings")}
          style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            height: 32, padding: 0, background: "none", border: "none",
            borderRadius: 9, color: "var(--text-muted)", cursor: "pointer",
            fontSize: 12, transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "none"; event.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <SettingsSectionIcon section="general" size={14} strokeWidth={2} />
          <span>{translate("common.settings")}</span>
        </button>
      </div>
    </>
  );

  const renderProjectTrustWarning = (mobileBanner: boolean) => {
    if (!showChat || !projectTrust?.requiresTrust || projectTrust.trusted) return null;
    return (
      <button
        type="button"
        onClick={() => {
          setProjectTrustError(null);
          setProjectTrustDialogOpen(true);
        }}
        title={translate("trust.resourcesNotLoaded")}
        aria-label={translate("trust.resourcesNotLoaded")}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: mobileBanner ? "flex-start" : "center",
          gap: 6,
          width: mobileBanner ? "100%" : undefined,
          minHeight: mobileBanner ? 32 : undefined,
          height: mobileBanner ? undefined : "100%",
          padding: mobileBanner ? "6px 12px" : "0 12px",
          background: mobileBanner ? "color-mix(in srgb, #d97706 8%, var(--bg-panel))" : "none",
          border: "none",
          borderRight: mobileBanner ? "none" : "1px solid var(--border)",
          borderBottom: mobileBanner ? "1px solid var(--border)" : "none",
          color: "#d97706",
          cursor: "pointer",
          flexShrink: 0,
          fontSize: 11,
          lineHeight: 1.35,
          textAlign: "left",
        }}
        data-mobile-trust-banner={mobileBanner ? "true" : undefined}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{ flexShrink: 0 }}
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
          <path d="M12 8v4" />
          <path d="M12 16h.01" />
        </svg>
        <span>{translate("trust.resourcesNotLoaded")} · <strong>{translate("trust.manage")}</strong></span>
      </button>
    );
  };

  const renderChatToolbarActions = (mobile: boolean) => (
    <SessionToolbarActions mobile={mobile} showChat={showChat} selectedSession={selectedSession}
      setPluginSettingsSession={setPluginSettingsSession} setSettingsSection={setSettingsSection}
      handleViewFullHistory={handleViewFullHistory} sessionStats={sessionStats}
      autoNameStatus={autoNameStatus} handleAutoName={handleAutoName}
      hasSubagentSessions={hasSubagentSessions} agentsButtonLabel={agentsButtonLabel} agentsBadge={agentsBadge}
      activeTopPanel={activeTopPanel} toggleTopPanel={toggleTopPanel} sessionHasBranches={sessionHasBranches}
      branchTree={branchTree} branchActiveLeafId={branchActiveLeafId} handleBranchLeafChange={handleBranchLeafChange}
      topBarRef={topBarRef} systemBtnRef={systemBtnRef} handleSystemInfoToggle={handleSystemInfoToggle}
      systemPrompt={systemPrompt} systemTools={systemTools} translate={translate}
      autoNameControl={<SessionAutoNameButton selectedSession={selectedSession} sessionStats={sessionStats}
        autoNameStatus={autoNameStatus} handleAutoName={handleAutoName} mobile={mobile} />}
      systemInfoControls={<SessionSystemInfoButtons systemBtnRef={systemBtnRef} mobile={mobile} showChat={showChat}
        activeTopPanel={activeTopPanel} systemPrompt={systemPrompt} systemTools={systemTools}
        handleSystemInfoToggle={handleSystemInfoToggle} />}
    />
  );

  const renderSessionStatsButton = (mobile: boolean) => <SessionStatsButton mobile={mobile} showChat={showChat} sessionStats={sessionStats} contextUsage={contextUsage} locale={locale} toggleTopPanel={toggleTopPanel} activeTopPanel={activeTopPanel} translate={translate} />;
  const renderMainFileToggle = (mobile: boolean) => <MainFileToggle mobile={mobile} handleRightPanelToggle={handleRightPanelToggle} rightPanelOpen={rightPanelOpen} sessionStats={sessionStats} contextUsage={contextUsage} translate={translate} />;

  return (
    <ReviewNavigationContext.Provider value={handleReviewNavigation}>
    <FileLinkMenuContext.Provider value={{ ...fileStatus, contextKey: fileWorkspaceKey }}>
    <style>{`
      @keyframes session-info-pop {
        0% {
          opacity: 0;
          transform: translateY(-24px);
          filter: blur(6px);
          box-shadow: 0 2px 8px rgba(0,0,0,0);
        }
        55% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: color-mix(in srgb, var(--accent) 8%, var(--bg-panel));
          box-shadow: 0 18px 44px rgba(37,99,235,0.16);
        }
        100% {
          opacity: 1;
          transform: translateY(0);
          filter: blur(0);
          background: var(--bg-panel);
          box-shadow: 0 10px 28px rgba(0,0,0,0.10);
        }
      }
      @keyframes session-info-light-wash {
        0% {
          opacity: 0;
          transform: translateX(-110%) skewX(-16deg);
        }
        24% {
          opacity: 0.42;
        }
        100% {
          opacity: 0;
          transform: translateX(115%) skewX(-16deg);
        }
      }
      .session-info-popover {
        position: relative;
        overflow: hidden;
        transform-origin: top right;
        animation: session-info-pop 360ms ease-out both;
        will-change: transform, opacity, filter, background, box-shadow;
      }
      .session-info-popover::after {
        content: "";
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 44%;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 24%, transparent), transparent);
        animation: session-info-light-wash 620ms ease-out both;
      }
      @media (prefers-reduced-motion: reduce) {
        .session-info-popover,
        .session-info-popover::after {
          animation: none;
        }
      }
      .mobile-session-stats {
        container-type: inline-size;
      }
      @container (max-width: 158px) {
        .mobile-session-stat-io {
          display: none !important;
        }
      }
      @container (max-width: 88px) {
        .mobile-session-stat-cost {
          display: none !important;
        }
      }
      @media (max-width: 640px) {
        .sidebar-overlay-backdrop.sidebar-mobile-pending {
          opacity: 0 !important;
          pointer-events: none !important;
        }
        .sidebar-container.sidebar-mobile-pending.sidebar-open {
          transform: translateX(calc(-100% - env(safe-area-inset-left)));
          box-shadow: none;
        }
      }
    `}</style>
    <WebVersionNotice />
    <div style={{
      display: "flex",
      width: "100%",
      height: "var(--app-viewport-height, 100dvh)",
      paddingLeft: "env(safe-area-inset-left)",
      paddingRight: "env(safe-area-inset-right)",
      overflow: "hidden",
      background: "var(--bg)",
    }}>
      {/* Mobile overlay backdrop */}
      <div
        inert={gitExplorerFullWidth}
        className={`sidebar-overlay-backdrop${mobileSidebarReady ? "" : " sidebar-mobile-pending"}`}
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        ref={sidebarResizer.panelRef}
        id="session-sidebar"
        inert={rightPanelFullWidth || gitExplorerFullWidth}
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${mobileSidebarReady ? "" : " sidebar-mobile-pending"}${sidebarResizer.isResizing ? " sidebar-resizing" : ""}`}
        style={{
          "--sidebar-width": `${sidebarResizer.width}px`,
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          paddingTop: "env(safe-area-inset-top)",
          paddingBottom: "env(safe-area-inset-bottom)",
          zIndex: 200,
        } as React.CSSProperties}
      >
        {sidebarContent}
      </div>
      {sidebarOpen && (
        <div
          {...sidebarResizer.separatorProps}
          inert={rightPanelFullWidth || gitExplorerFullWidth}
          aria-controls="session-sidebar"
          className={`panel-resize-handle sidebar-resize-handle${sidebarResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar"
          title={`${translate("layout.resizeSidebar")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Center: chat */}
      <div inert={rightPanelFullWidth} className={`app-center${chatCollapsed ? " chat-collapsed" : ""}`} style={{ flex: chatCollapsed ? "0 0 36px" : 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar with sidebar toggle */}
        <div ref={topBarRef} inert={gitExplorerFullWidth} className="app-topbar" style={{ flexShrink: 0, background: "var(--bg-panel)" }}>
        <div className="app-toolbar-row" style={{ display: "flex", alignItems: "center", position: "relative", borderBottom: "1px solid var(--border)", height: "calc(36px + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }}>
          <SidebarToolbarToggle sidebarOpen={sidebarOpen} onToggle={handleSidebarToggle} translate={translate} />
          {isSplitLayout && rightPanelOpen && <button
            ref={chatVisibilityRef}
            type="button"
            className="chat-visibility-button"
            aria-controls="chat-content"
            aria-expanded={!chatCollapsed}
            aria-label={translate(chatCollapsed ? "layout.showChat" : "layout.hideChat")}
            title={translate(chatCollapsed ? "layout.showChat" : "layout.hideChat")}
            onClick={() => {
              setActiveTopPanel(null);
              setChatHidden(hidden => !hidden);
              chatVisibilityRef.current?.focus({ preventScroll: true });
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
              <path d={chatCollapsed ? "M9 12h6m-3-3v6" : "M9 12h6"} />
            </svg>
          </button>}
          <ToolbarActionsStrip isMobile={isMobile} showChat={showChat} selectedSessionId={selectedSession?.id} activeOverview={activeOverview}>
          <OverviewNavigationButtons activeOverview={activeOverview} isMobile={isMobile} overviewMobileList={overviewMobileList}
            activityNeedsCount={activityNeedsCount} closeOverview={closeOverview} reviewNavigationId={reviewNavigationId}
            setActiveTopPanel={setActiveTopPanel} setOverviewMobileList={setOverviewMobileList}
            setReviewNavigation={setReviewNavigation} setActiveOverview={setActiveOverview}
            setRightPanelOpen={setRightPanelOpen} setSidebarOpen={setSidebarOpen} />
          <button type="button" className="activity-top-button" aria-label={translate("scratchpad.title")} title={translate("scratchpad.title")}
            aria-haspopup="dialog" aria-expanded={scratchpadOpen}
            onClick={() => { setActiveTopPanel(null); setScratchpadMounted(true); setScratchpadOpen(true); }}
            style={{ width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, flexShrink: 0, border: 0, borderRight: "1px solid var(--border)", background: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M16 3l5 5-9 9-5 1 1-5Z" />
            </svg>
          </button>
          <GitToolbarToggle triggerRef={gitExplorerTriggerRef} active={activeOverview === "git"}
            onToggle={() => {
              setActiveTopPanel(null);
              if (activeOverview === "git") closeOverview();
              else {
                ++reviewNavigationId.current;
                setReviewNavigation(null);
                setOverviewMobileList(true);
                setActiveOverview("git");
                setRightPanelOpen(false);
                if (isMobile || window.innerWidth < 1000) setSidebarOpen(false);
              }
            }}
          />
          <button type="button" className="activity-top-button" aria-label={translate("acceptance.title")} title={translate("acceptance.title")} disabled={!activeCwd}
            onClick={() => { setActiveTopPanel(null); setAcceptanceOpen(true); }}
            style={{ width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, flexShrink: 0, border: 0, borderRight: "1px solid var(--border)", background: "none", color: "var(--text-muted)", cursor: activeCwd ? "pointer" : "default" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 12 3 3 7-7" /><rect x="3" y="3" width="18" height="18" rx="4" /></svg>
          </button>
          <SubagentToolbarMarker showChat={showChat} selectedSession={selectedSession} translate={translate} />
          {showChat && selectedSession?.spawnedBy && <a
            href={`/?session=${encodeURIComponent(selectedSession.spawnedBy)}`}
            title={`Started by session ${selectedSession.spawnedBy}`}
            className="shrink-0 border-r border-border px-2 text-xs text-accent underline"
            style={{ display: "flex", alignItems: "center" }}>Started by…</a>}
          <MobileChatToolbar isMobile={isMobile} overviewList={Boolean(activeOverview && overviewMobileList)} controls={renderChatToolbarActions(true)} stats={renderSessionStatsButton(true)} files={renderMainFileToggle(true)} />
          {!isMobile && (
            <>
              {renderProjectTrustWarning(false)}
              {renderChatToolbarActions(false)}
              {renderSessionStatsButton(false)}
            </>
          )}
          {!isMobile && renderMainFileToggle(false)}
          </ToolbarActionsStrip>
          {isMobile && sessionHasBranches && (
            <BranchNavigator
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={handleBranchLeafChange}
              inline
              compact
              containerRef={topBarRef}
              open={activeTopPanel === "branches"}
              onToggle={() => toggleTopPanel("branches")}
              hasSession={showChat}
              hideInlineButton
            />
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && !activeTopPanel.startsWith("git-") && topPanelPos && (
            <div style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              maxHeight: `calc(100dvh - ${topPanelPos.top}px)`,
              overflowY: "auto",
              zIndex: 500,
            }}>
              {activeTopPanel === "agents" && activeSessionFamily && selectedSession && (
                <AgentSessionPanel
                  rootSession={activeSessionFamily.root}
                  subagents={activeSessionFamily.subagents}
                  selectedSessionId={selectedSession.id}
                  runningSessionIds={runningSessionIds}
                  onSelectSession={handleSelectSession}
                />
              )}
              {activeTopPanel === "system" && (
                <SystemPromptPanel
                  loading={systemInfoLoading}
                  prompt={systemPrompt}
                  translate={translate}
                />
              )}
              {activeTopPanel === "tools" && (
                <ToolDefinitionsPanel
                  loading={systemInfoLoading}
                  tools={systemTools}
                  translate={translate}
                />
              )}
              {activeTopPanel === "session" && (
                <div className="session-info-popover" style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
                  padding: "12px 16px",
                }}>
                  {sessionStats ? (() => {
                    const formatDuration = (ms: number) => {
                      if (ms <= 0) return "0s";
                      const totalSec = Math.floor(ms / 1000);
                      const h = Math.floor(totalSec / 3600);
                      const m = Math.floor((totalSec % 3600) / 60);
                      const s = totalSec % 60;
                      if (h > 0) return `${h}h ${m}m`;
                      if (m > 0) return `${m}m ${s}s`;
                      return `${s}s`;
                    };
                    const totalActiveMs = sessionStats.totalActiveMs ?? 0;
                    const ws = selectedSession;
                    const sessionRows = [
                       ...(sessionStats.sessionName ? [{ label: translate("session.name"), value: sessionStats.sessionName, copyField: null }] : []),
                       { label: translate("session.file"), value: sessionStats.sessionFile ?? translate("session.inMemory"), copyField: "file" as const },
                       { label: translate("session.id"), value: sessionStats.sessionId, copyField: "id" as const },
                       ...(totalActiveMs > 0 ? [{ label: translate("session.totalActive"), value: formatDuration(totalActiveMs), copyField: null }] : []),
                    ];
                    const projectRows = [
                      ...(ws ? [{ label: translate("session.projectDir"), value: ws.projectRoot ?? ws.cwd, copyField: "projectDir" as const }] : []),
                      ...(ws?.branch ? [{ label: translate("session.gitBranch"), value: ws.branch, copyField: "gitBranch" as const }] : []),
                      ...(ws?.isWorktree ? [{ label: translate("session.gitWorktree"), value: ws.cwd, copyField: "gitWorktree" as const }] : []),
                    ];
                    const messageRows = [
                       [translate("session.user"), sessionStats.userMessages.toLocaleString(locale)],
                       [translate("session.assistant"), sessionStats.assistantMessages.toLocaleString(locale)],
                       [translate("session.toolCalls"), sessionStats.toolCalls.toLocaleString(locale)],
                       [translate("session.toolResults"), sessionStats.toolResults.toLocaleString(locale)],
                       [translate("session.total"), sessionStats.totalMessages.toLocaleString(locale)],
                    ];
                    const tokenRows = [
                       [translate("session.input"), sessionStats.tokens.input.toLocaleString(locale)],
                       [translate("session.output"), sessionStats.tokens.output.toLocaleString(locale)],
                       ...(sessionStats.tokens.cacheRead > 0 ? [[translate("session.cacheRead"), sessionStats.tokens.cacheRead.toLocaleString(locale)]] : []),
                       ...(sessionStats.tokens.cacheWrite > 0 ? [[translate("session.cacheWrite"), sessionStats.tokens.cacheWrite.toLocaleString(locale)]] : []),
                       [translate("session.total"), sessionStats.tokens.total.toLocaleString(locale)],
                    ];
                    const ctx = contextUsage ?? sessionStats.contextUsage;
                    const formatCompact = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
                    const extraTokenRows = [
                       ...(sessionStats.cost > 0 ? [[translate("session.cost"), `$${sessionStats.cost.toFixed(4)}`]] : []),
                       ...(ctx?.contextWindow ? [[translate("session.context"), `${ctx.percent !== null ? `${ctx.percent.toFixed(1)}%` : "?"} / ${formatCompact(ctx.contextWindow)}`]] : []),
                       // Cache hit rate = cache reads / (input + cache writes + cache reads) — the denominator covers all input-class tokens.
                       ...(sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite > 0 && sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite + sessionStats.tokens.input > 0
                         ? [[translate("session.cacheHitRate"), `${(sessionStats.tokens.cacheRead / (sessionStats.tokens.cacheRead + sessionStats.tokens.cacheWrite + sessionStats.tokens.input) * 100).toFixed(1)}%`]]
                         : []),
                    ];
                    const section = (
                      title: string,
                      sectionRows: string[][],
                      valueAlign: "left" | "right" = "left",
                      compact = false,
                    ) => (
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{title}</div>
                          <div style={{
                            display: "grid",
                            gridTemplateColumns: compact ? "max-content max-content" : "auto minmax(0, 1fr)",
                            columnGap: compact ? 14 : 12,
                            rowGap: 4,
                            justifyContent: compact ? "start" : undefined,
                          }}>
                            {sectionRows.map(([label, value]) => (
                              <div key={`${title}:${label}`} style={{ display: "contents" }}>
                                <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{label}</div>
                                <div style={{
                                  color: "var(--text-muted)",
                                  minWidth: 0,
                                  overflowWrap: compact ? "normal" : "anywhere",
                                  textAlign: valueAlign,
                                  whiteSpace: valueAlign === "right" ? "nowrap" : "normal",
                                }}>{value}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    const copyTitleKey: Record<SessionCopyField, string> = {
                      file: "session.copyFile",
                      id: "session.copyId",
                      projectDir: "session.copyProjectDir",
                      gitBranch: "session.copyGitBranch",
                      gitWorktree: "session.copyGitWorktree",
                    };
                    const copyButton = (field: SessionCopyField, value: string) => {
                      const copied = copiedSessionField === field;
                      return (
                        <button
                          type="button"
                          title={copied ? translate("session.copied") : translate(copyTitleKey[field])}
                          onClick={() => handleCopySessionField(field, value)}
                          style={{
                            alignSelf: "start",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 22,
                            height: 22,
                            marginTop: -2,
                            color: copied ? "var(--accent)" : "var(--text-dim)",
                            background: "transparent",
                            border: "1px solid var(--border)",
                            borderRadius: 4,
                            cursor: "pointer",
                            flex: "0 0 auto",
                            transition: "color 0.12s, border-color 0.12s, background 0.12s",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.color = "var(--accent)";
                            e.currentTarget.style.borderColor = "var(--accent)";
                            e.currentTarget.style.background = "var(--bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.color = copied ? "var(--accent)" : "var(--text-dim)";
                            e.currentTarget.style.borderColor = "var(--border)";
                            e.currentTarget.style.background = "transparent";
                          }}
                        >
                          {copied ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          ) : (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                          )}
                        </button>
                      );
                    };
                    const sessionInfoSection = (
                      <div style={{ minWidth: 0 }}>
                         <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("session.infoSection")}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {sessionRows.map((row) => (
                            <div key={`session-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                    const projectInfoSection = projectRows.length > 0 ? (
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", marginBottom: 6 }}>{translate("session.projectSection")}</div>
                        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr) auto", columnGap: 12, rowGap: 8, alignItems: "start" }}>
                          {projectRows.map((row) => (
                            <div key={`project-info:${row.label}`} style={{ display: "contents" }}>
                              <div style={{ color: "var(--text-dim)", whiteSpace: "nowrap" }}>{row.label}</div>
                              <div style={{
                                color: "var(--text-muted)",
                                minWidth: 0,
                                overflowWrap: "anywhere",
                                wordBreak: "break-word",
                                whiteSpace: "normal",
                              }}>{row.value}</div>
                              <div>{row.copyField ? copyButton(row.copyField, row.value) : null}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null;

                    return (
                      <div style={{
                        display: "grid",
                        gridTemplateColumns: isMobile
                          ? "1fr"
                          : "minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr)",
                        gap: isMobile ? 16 : 24,
                        fontSize: 12,
                        lineHeight: 1.5,
                        fontFamily: "var(--font-mono)",
                      }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: isMobile ? 16 : 20 }}>
                          {sessionInfoSection}
                          {projectInfoSection}
                        </div>
                         {section(translate("session.messages"), messageRows)}
                         {section(translate("session.tokens"), [...tokenRows, ...extraTokenRows], "right", true)}
                      </div>
                    );
                  })() : (
                    <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                       {translate("session.load")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
        <MobileSessionIdentity isMobile={isMobile} showChat={showChat} overviewList={Boolean(activeOverview && overviewMobileList)} session={selectedSession} newCwd={effectiveNewSessionCwd} translate={translate} />
        {mobileToolbarVisible(isMobile, Boolean(activeOverview && overviewMobileList)) && renderProjectTrustWarning(true)}
        </div>

        {/* Chat content */}
        <div id="chat-content" inert={chatCollapsed} hidden={chatCollapsed} style={{ flex: 1, overflow: "hidden", position: "relative", display: chatCollapsed ? "none" : "flex" }}>
          {(activeOverview === "activity" || activeOverview === "starred") && (
            <ActivityViews
              controller={activityController}
              view={activeOverview}
              sessions={sessionsWithSelection}
              selectedId={selectedSession?.id ?? null}
              onSelect={handleActivitySelectSession}
              onClose={closeOverview}
              hidden={isMobile && !overviewMobileList}
              recoveryRefreshKey={recoveryRefreshKey}
              privacy={projectPrivacy}
            />
          )}
          {activeOverview === "git" && <div id="git-explorer-panel" className={`git-explorer-host${gitExplorerFullWidth ? " git-explorer-full-width" : ""}`}>
            <GitExplorerPanel key={reviewNavigation ? `review:${reviewNavigation.cwd}:${reviewNavigation.requestId}` : activeCwd ?? "no-worktree"}
              cwd={reviewNavigation?.cwd ?? (historyOnly && activeCwd === selectedSession?.cwd ? null : activeCwd)} onClose={handleGitExplorerClose}
              initialSelection={reviewNavigation ?? undefined} onReturnToWorkspace={reviewNavigation ? returnToWorkspaceHistory : undefined}
              expanded={gitExplorerFullWidth} canExpand={!isMobile} onToggleExpanded={handleGitExplorerExpandToggle} />
          </div>}
          <div inert={gitExplorerFullWidth || Boolean(activeOverview && isMobile && overviewMobileList)} style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <MarkdownMediaScope key={sessionKey} active={!scratchpadOpen && !chatCollapsed && settingsSection === null && !projectTrustDialogOpen && !acceptanceOpen && !gitExplorerFullWidth && !rightPanelFullWidth && !(isMobile && (rightPanelOpen || sidebarOpen)) && !(activeOverview && isMobile && overviewMobileList)}>
            <ChatWindow
              key={sessionKey}
              {...chatBinding}
              covered={chatCollapsed || gitExplorerFullWidth || rightPanelFullWidth}
              searchTarget={searchTarget?.sessionId === selectedSession?.id ? searchTarget : null}
              onSearchTargetHandled={handleSearchTargetHandled}
              initialScrollPosition={selectedSession ? sessionScrollPositionsRef.current.get(selectedSession.id) ?? null : null}
              onScrollPositionChange={handleSessionScrollPositionChange}
              {...sessionNavigationArchiveBinding(activeSessionFamily, runningSessionIds, queuedSessionIds, handleSessionRestored)}
              onAgentEnd={handleAgentEnd}
              onRecoveryDismissed={handleRecoveryDismissed}
              onAttentionNeeded={handleAttentionNeeded}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSystemToolsChange={handleSystemToolsChange}
              onSystemInfoLoaderChange={handleSystemInfoLoaderChange}
              onSessionStatsChange={handleSessionStatsChange}
              onSessionStatsPanelOpen={openSessionStatsPanel}
              onContextUsageChange={handleContextUsageChange}
              onOpenFile={handleOpenLinkedFile}
              onOpenSession={handleOpenSession}
              onAskInNewChat={handleAskInNewChat}
              quoteSelectionEnabled={quoteSelectionEnabled}
              initialPrompt={quoteInitialPrompt}
              onInitialPromptConsumed={consumeQuoteInitialPrompt}
              soundEnabled={soundEnabled}
              onSoundToggle={onSoundToggle}
              playDoneSound={playDoneSound}
              unlockAudio={unlockAudio}
            />
            </MarkdownMediaScope>
          ) : initialCwdStatus === "validating" ? (
            <div
              role="status"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: 14, color: "var(--text)" }}>{translate("workspace.opening")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
            </div>
          ) : initialCwdStatus === "error" ? (
            <div
              role="alert"
              style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 24, color: "var(--text-muted)", textAlign: "center" }}
            >
               <div style={{ fontSize: 14, color: "#dc2626" }}>{translate("workspace.unable")}</div>
              <div style={{ maxWidth: "min(720px, 100%)", overflowWrap: "anywhere", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {initialNavigation.requestedCwd}
              </div>
              <div style={{ maxWidth: 720, fontSize: 12 }}>{initialCwdError}</div>
            </div>
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                 {translate("workspace.selectSession")}
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                   <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{translate("workspace.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                     <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{translate("workspace.selectProject")}<br />
                     <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{translate("workspace.addModels")}
                  </div>
                </div>
              </div>
            )
          ) : null}
          </div>
        </div>
      </div>

      <div
        aria-hidden="true"
        inert={gitExplorerFullWidth}
        className={`right-panel-overlay-backdrop${rightPanelOpen ? " is-open" : ""}`}
        onClick={() => setRightPanelOpen(false)}
      />
      {rightPanelOpen && !chatCollapsed && (
        <div
          {...rightPanelResizer.separatorProps}
          inert={rightPanelFullWidth || gitExplorerFullWidth}
          aria-controls="file-panel"
          className={`panel-resize-handle right-panel-resize-handle${rightPanelResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="right-panel"
          title={`${translate("layout.resizeFilePanel")}: ${translate("layout.resizeHint")}`}
        />
      )}

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        ref={rightPanelResizer.panelRef}
        id="file-panel"
        inert={gitExplorerFullWidth}
        onKeyDown={event => {
          if (event.key === "Escape" && rightPanelFullWidth) {
            event.preventDefault(); event.stopPropagation(); setRightPanelExpanded(false);
          }
        }}
        className={`right-panel-container${chatCollapsed ? " chat-is-hidden" : ""}${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${rightPanelFullWidth ? " right-panel-full-width" : ""}${rightPanelResizer.isResizing ? " right-panel-resizing" : ""}`}
        style={{
          "--right-panel-width": `${rightPanelResizer.width}px`,
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        } as React.CSSProperties}
      >
        {/* Right panel tab bar */}
        <div style={{
          display: "flex",
          alignItems: "center",
          flexShrink: 0,
          height: "calc(36px + env(safe-area-inset-top))",
          paddingTop: "env(safe-area-inset-top)",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={panelTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={setActiveFileTabId}
              onCloseTab={handleCloseFileTab}
            />
          </div>
          <button
            type="button"
            className="file-panel-expand-button"
            onClick={handleRightPanelExpandToggle}
            aria-controls="file-panel"
            aria-pressed={rightPanelFullWidth}
            title={translate(rightPanelFullWidth ? "files.restorePanelWidth" : "files.expandPanel")}
            aria-label={translate(rightPanelFullWidth ? "files.restorePanelWidth" : "files.expandPanel")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={rightPanelFullWidth
                ? "M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"
                : "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M3 3l6 6m12-6-6 6M3 21l6-6m12 6-6-6"} />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setRightPanelOpen(false)}
            aria-controls="file-panel"
            aria-expanded={rightPanelOpen}
            title={translate("files.hidePanel")}
            aria-label={translate("files.hidePanel")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
              background: "var(--bg-selected)", border: "none", borderLeft: "1px solid var(--border)",
              color: "var(--text)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(event) => { event.currentTarget.style.color = "var(--accent)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text)"; }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
        </div>

        {/* Only the active viewer is mounted. Lightweight per-tab state is restored on activation. */}
        <div style={{ flex: 1, minHeight: 0, overflow: "hidden", paddingBottom: "env(safe-area-inset-bottom)" }}>
          <div hidden={activeFileTabId !== "files"} style={{ height: "100%", display: activeFileTabId === "files" ? "flex" : "none", flexDirection: "column" }}>
            <div hidden={!parkedFileWorkspaceKey} role="status" style={{ display: parkedFileWorkspaceKey ? "flex" : "none", alignItems: "center", gap: 8, padding: "5px 8px", fontSize: 12, borderBottom: "1px solid var(--border)" }}>
              <span title={parkedFileCwd} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{translate("workspace.parked", { cwd: parkedFileCwd })}</span>
              <button type="button" className="file-workspace-return" onClick={() => { setParkedFileWorkspaceKey(null); fileWorkspaceRef.current?.focus(currentFileWorkspaceKey); }}>{translate("workspace.returnCurrent")}</button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
            <FileWorkspace ref={fileWorkspaceRef} workspaceKey={fileWorkspaceKey}
              reviewDestination={reviewDestination} onReviewBatchDraft={handleReviewBatchDraft}
              active={rightPanelOpen && activeFileTabId === "files"} presented={activeFileTabId === "files"} gitRefreshKey={explorerRefreshKey}
              onRevealFile={location => {
                setRightPanelExpanded(false);
                setGitExplorerExpanded(false);
                setSidebarOpen(true);
                if (!isSplitLayout) setRightPanelOpen(false);
                setFileRevealRequest({ ...location, id: ++fileRevealId.current });
              }}
              onStatus={setFileStatus} onShowFiles={() => { setActiveFileTabId("files"); setRightPanelOpen(true); }}
              onEmpty={() => {
                if (terminalTabs.length) setActiveFileTabId(terminalTabs.at(-1)!.id);
                else setRightPanelOpen(false);
              }}
              onFocusWorkspace={key => setParkedFileWorkspaceKey(key === currentFileWorkspaceKey ? null : key)}
              mentionCwd={selectedSession?.cwd ?? newSessionCwd ?? activeCwd ?? undefined}
              onMentionLines={handleFileLineMention} onAtMention={handleAtMention} />
            </div>
          </div>
          {terminalTabs.map((tab) => (
            <div key={tab.id} hidden={tab.id !== activeFileTabId} style={{ width: "100%", height: "100%" }}>
              <TerminalPanel
                tab={tab}
                active={rightPanelOpen && tab.id === activeFileTabId}
                onRestart={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: "restart" } : item))}
                onClosed={() => handleTerminalClosed(tab)}
                onCloseError={() => setTerminalTabs((tabs) => tabs.map((item) => item.id === tab.id ? { ...item, closing: undefined } : item))}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
    {settingsSection && (
      <SettingsPanel
        cwd={pluginSettingsSession?.cwd ?? projectTrustCwd}
        sessionId={pluginSettingsSession?.id ?? selectedSession?.id ?? null}
        initialSection={settingsSection}
        sshController={sshController}
        initialPluginScope={pluginSettingsSession ? "session" : undefined}
        sessions={sessionsWithSelection}
        privacy={projectPrivacy}
        quoteSelectionEnabled={quoteSelectionEnabled}
        onQuoteSelectionChange={handleQuoteSelectionChange}
        onClose={() => {
          sshController.cancelDiscovery();
          if (sshController.busy && !sshController.approvingId) sshController.cancel();
          setSettingsSection(null);
          setPluginSettingsSession(null);
          setModelsRefreshKey((key) => key + 1);
        }}
        onSessionReloaded={() => setSessionKey((key) => key + 1)}
        trustStatus={projectTrust}
        onManageTrust={() => { setProjectTrustError(null); setProjectTrustDialogOpen(true); }}
      />
    )}
    {acceptanceOpen && activeCwd && <AcceptancePanel key={activeCwd} cwd={activeCwd} onClose={() => setAcceptanceOpen(false)} />}
    {projectTrustDialogOpen && projectTrustCwd && (
      <ProjectTrustDialog
        cwd={projectTrustCwd}
        status={projectTrust}
        busy={projectTrustBusy}
        error={projectTrustError}
        onCancel={() => {
          if (!projectTrustBusy) setProjectTrustDialogOpen(false);
        }}
        onConfirm={(choice) => void handleTrustProject(choice)}
      />
    )}
    {scratchpadMounted && <ScratchpadPanel open={scratchpadOpen} projectCwd={activeCwd} onClose={() => setScratchpadOpen(false)} />}
    <SshSigningCards controller={sshController} />
    </FileLinkMenuContext.Provider>
    </ReviewNavigationContext.Provider>
  );
}
