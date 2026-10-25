import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useNavigationState, useSessionNavigation, type NavigationUi } from "@/hooks/useSessionNavigation";
import { useSystemInfoState, useSystemInfoActions, useTopPanelToggle } from "@/hooks/useSessionSystemInfo";
import { SessionSystemInfoButtons } from "./SessionSystemInfoButtons";
import { useSessionFileBinding } from "@/hooks/useSessionFileBinding";
import { useSessionNavigationChatBinding } from "./session-navigation-chat";
import type { ActivityClientController } from "@/lib/activity-client-controller";
import type { ReactNode } from "react";
import { useSessionAutoName } from "@/hooks/useSessionAutoName";
import { SessionNavigationSidebar } from "./SessionNavigation";
import { SessionAutoNameButton, OverviewNavigationButtons } from "./SessionNavigationControls";
import type { ReviewNavigation } from "@/lib/review-notebook";
import type { SessionTreeNode } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ComponentProps } from "react";
import { ProjectPrivacySettings } from "./ProjectPrivacySettings";
import { ArchivedSessionNotice } from "./ArchivedSessionNotice";
import { sessionNavigationArchiveBinding } from "./session-navigation-archive";
import { getSessionFamily } from "@/lib/session-family";
import { useHiddenProjects } from "@/hooks/useHiddenProjects";
import { useSessionWorktrees } from "@/hooks/useSessionWorktrees";
export { formatRelativeTime } from "@/lib/i18n/format";
export { I18nProvider } from "@/hooks/useI18n";
export { SessionSidebar, SessionItem, getSessionListIndices, sessionListUrl, updateSessionArchiveState } from "./SessionSidebar";
export { FileExplorer, SessionFileExplorer } from "./FileExplorer";
export { SessionSearch } from "./SessionSearch";
export { SessionBulkMoveDialog } from "./SessionBulkMoveDialog";
export { useSessionWorktrees } from "@/hooks/useSessionWorktrees";
export { createActivityClientController } from "@/lib/activity-client-controller";
export * as draftStore from "@/lib/draft-store";
export * as workspaceMemory from "@/lib/workspace-memory";
export * as tabMemory from "@/lib/tab-session";

export function NavigationFirstPaint({ search }: { search: string }) {
  const state = useNavigationState(new URLSearchParams(search));
  return <output data-session={state.initialSessionId ?? ""} />;
}

/** External lifecycle/statistics/viewport ports only. Production hooks, real
 * Sidebar default composition and actual toolbar buttons own all decisions. */
export function NavigationHarness({ search = "", router, isMobile = false, sidebar, onCommit, onFocus = () => {}, renderWorkspace, chatController, onChatCommit }: {
  search?: string; router: NavigationUi["router"]; isMobile?: boolean;
  sidebar?: Omit<ComponentProps<typeof SessionNavigationSidebar>, "state" | "navigation">;
  onCommit: (value: Record<string, unknown>) => void; onFocus?: () => void;
  renderWorkspace?: (binding: ReturnType<typeof useSessionFileBinding>, panel: { rightPanelOpen: boolean; activeFileTabId: string | null; showFiles: () => void }) => ReactNode;
  chatController?: ActivityClientController;
  onChatCommit?: (props: ReturnType<typeof useSessionNavigationChatBinding>) => void;
}) {
  const state = useNavigationState(new URLSearchParams(search));
  const [chatHidden, setChatHidden] = useState(false);
  const [, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [, setBranchActiveLeafId] = useState<string | null>(null);
  const systemInfo = useSystemInfoState();
  const { setSystemPrompt, setSystemTools, setSystemInfoLoading } = systemInfo;
  const [activeTopPanel, setActiveTopPanel] = useState<"agents" | "branches" | "system" | "tools" | "session" | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>("files");
  const [activeOverview, setActiveOverview] = useState<"activity" | "starred" | "git" | null>(null);
  const [overviewMobileList, setOverviewMobileList] = useState(true);
  const [reviewNavigation, setReviewNavigation] = useState<ReviewNavigation | null>(null);
  const reviewNavigationId = useRef(0);
  const closeOverview = useCallback(() => {
    ++reviewNavigationId.current; setActiveOverview(null); setReviewNavigation(null); setOverviewMobileList(true);
  }, []);
  const chatInputRef = useRef({ focus: onFocus, insertText() {} });
  chatInputRef.current.focus = onFocus;
  const branchLeafChangeFnRef = useRef<((id: string | null) => void) | null>(null);
  const navigation = useSessionNavigation(state, { router, isMobile, closeOverview, activeFileTabId,
    chatInputRef, branchLeafChangeFnRef, setChatHidden, setBranchTree, setBranchActiveLeafId,
    setSystemPrompt, setSystemTools, setSystemInfoLoading, setActiveTopPanel, setSidebarOpen,
    setRightPanelOpen, setActiveFileTabId, setOverviewMobileList });
  const fileBinding = useSessionFileBinding(state.selectedSession, state.activeCwd);
  const toggleTopPanel = useTopPanelToggle(isMobile, setSidebarOpen, setActiveTopPanel);
  const handleSystemInfoToggle = useSystemInfoActions(systemInfo, activeTopPanel, toggleTopPanel);
  const systemBtnRef = useRef<HTMLButtonElement>(null);
  const [stats, setSessionStats] = useState<SessionStatsInfo | null>(null);
  const naming = useSessionAutoName({ selectedSession: state.selectedSession, setSelectedSession: state.setSelectedSession,
    setSessionStats, setRefreshKey: state.setRefreshKey, setActiveTopPanel });
  useLayoutEffect(() => { onCommit({ state, navigation, systemInfo, activeTopPanel, fileBinding, naming, stats, setSessionStats, activeOverview, setActiveOverview,
    overviewMobileList, setOverviewMobileList, reviewNavigation, setReviewNavigation, reviewNavigationId,
    chatHidden, sidebarOpen, rightPanelOpen, setRightPanelOpen, setActiveFileTabId }); },
  [onCommit, state, navigation, systemInfo, activeTopPanel, fileBinding, naming, stats, activeOverview,
    overviewMobileList, reviewNavigation, reviewNavigationId, chatHidden, sidebarOpen, rightPanelOpen]);
  const archive = sessionNavigationArchiveBinding(getSessionFamily(state.sessionCatalog, state.selectedSession?.id), new Set(), new Set(), navigation.handleSessionRestored);
  return <>
    <SessionSystemInfoButtons systemBtnRef={systemBtnRef} mobile={isMobile} showChat={navigation.showChat} activeTopPanel={activeTopPanel}
      systemPrompt={systemInfo.systemPrompt} systemTools={systemInfo.systemTools} handleSystemInfoToggle={handleSystemInfoToggle} />
    {chatController && onChatCommit && <ChatPublication state={state} navigation={navigation} controller={chatController} onCommit={onChatCommit} />}
    {renderWorkspace?.(fileBinding, { rightPanelOpen, activeFileTabId, showFiles: () => { setActiveFileTabId("files"); setRightPanelOpen(true); } })}
    <ArchivedSessionNotice rootSessionId={archive.archivedRootSessionId} busy={archive.archiveActionBusy} onRestored={archive.onSessionRestored} />
    <OverviewNavigationButtons activeOverview={activeOverview} isMobile={isMobile} overviewMobileList={overviewMobileList}
      activityNeedsCount={0} closeOverview={closeOverview} reviewNavigationId={reviewNavigationId}
      setActiveTopPanel={setActiveTopPanel} setOverviewMobileList={setOverviewMobileList}
      setReviewNavigation={setReviewNavigation} setActiveOverview={setActiveOverview}
      setRightPanelOpen={setRightPanelOpen} setSidebarOpen={setSidebarOpen} />
    <SessionAutoNameButton selectedSession={state.selectedSession} sessionStats={stats} {...naming} mobile={isMobile} />
    {sidebar && <SessionNavigationSidebar {...sidebar} state={state} navigation={navigation} />}
  </>;
}

export function InventoryHarness({ project, refreshKey, onCommit }: { project: string | null; refreshKey: string; onCommit: (value: ReturnType<typeof useSessionWorktrees>) => void }) {
  const value = useSessionWorktrees(project, refreshKey);
  useLayoutEffect(() => { onCommit(value); });
  return <output>{value.inventory?.projectRoot ?? ""}</output>;
}

export function PrivacyHarness({ sessions, onCommit }: Omit<ComponentProps<typeof ProjectPrivacySettings>, "privacy"> & {
  onCommit: (privacy: ReturnType<typeof useHiddenProjects>) => void;
}) {
  const privacy = useHiddenProjects();
  useLayoutEffect(() => { onCommit(privacy); });
  return <ProjectPrivacySettings sessions={sessions} privacy={privacy} />;
}

function ChatPublication({ state, navigation, controller, onCommit }: {
  state: ReturnType<typeof useNavigationState>; navigation: ReturnType<typeof useSessionNavigation>;
  controller: ActivityClientController; onCommit: (props: ReturnType<typeof useSessionNavigationChatBinding>) => void;
}) {
  const props = useSessionNavigationChatBinding(state, navigation, controller);
  useLayoutEffect(() => { onCommit(props); });
  return <output data-chat-session={props.session?.id ?? ""} data-chat-running={String(props.sessionRunning)} />;
}
