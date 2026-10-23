"use client";

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { SessionInfo } from "@/lib/types";
import type { SessionPauseSnapshot } from "@/lib/session-pause";
import { sessionFamiliesForWorktree } from "@/lib/session-worktree-filter";
import { useSessionWorktrees } from "@/hooks/useSessionWorktrees";
import { SessionBulkMoveDialog, type BulkMoveRequest } from "./SessionBulkMoveDialog";
import { runBulkSessionAction, type BulkSessionAction } from "@/lib/bulk-session-actions";
import { readSessionMoveResponse, SessionMoveResponseError } from "@/lib/session-move-client";
import { loadExplorerOpen, saveExplorerOpen } from "@/lib/file-explorer-state";
import { dispatchSessionRowContextMenu } from "@/lib/session-row-context-menu";
import { sessionDeepLink } from "@/lib/session-reference";
import { copyText } from "@/lib/clipboard";
import { useStarredSessions } from "@/hooks/useStarredSessions";
import { skillExpansionToCommand } from "@/lib/slash-display";
import { getProjectActivity, getRecentProjects } from "@/lib/project-groups";
import { workspaceKeyOf } from "@/lib/workspace-memory";
import type { SessionAttention, SessionAttentionReceipt, SessionCompletion } from "@/lib/types";
import {
  activityRequestKey, deferredAttentionIds, isCurrentActivityRequest, loadReviewedRunTimes, mergeReviewedRunTimes, reconcileCompletedRuns,
  REVIEWED_RUN_TIMES_STORAGE_KEY,
} from "@/lib/activity-review";
import { formatRelativeTime } from "@/lib/i18n/format";
import { useI18n } from "@/hooks/useI18n";
import { useResizablePanel } from "@/hooks/useResizablePanel";
import { useScrollbarVisibility } from "@/hooks/useScrollbarVisibility";
import { DirectoryPicker } from "./DirectoryPicker";
import { SessionMoveDestinationPicker } from "./SessionMoveDestinationPicker";
import { SessionMoveStatus } from "./SessionMoveStatus";
import { FileExplorer, type FileExplorerHandle } from "./FileExplorer";
import type { FileRevealRequest } from "@/lib/explorer-reveal";
import { isHistoryOnlySession } from "@/lib/session-directory";
import { SessionSearch } from "./SessionSearch";
import dynamic from "next/dynamic";
import { SubagentIcon } from "./SubagentIcon";
import { SessionWorktreeBadge } from "./SessionWorktreeBadge";

// Housekeeping is optional; do not load its review UI/CSS into every sidebar.
const WorktreeManager = dynamic(() => import("./WorktreeManager").then((module) => module.WorktreeManager), { ssr: false });

// Fixed row height for the session list. SessionItem renders at exactly this
// height, so the list can be windowed (only the visible slice is mounted).
const SESSION_LIST_ITEM_HEIGHT = 54;
const BULK_BUTTON_CLASS = "rounded-md border border-border bg-bg-hover px-2 py-1 text-xs text-text-muted hover:bg-bg-selected disabled:cursor-not-allowed disabled:opacity-50";

export function updateSessionArchiveState(sessions: readonly SessionInfo[], id: string, archived: boolean): SessionInfo[] {
  return sessions.map((session) => session.id === id ? { ...session, archived } : session);
}

export function getSessionListIndices(count: number, scrollTop: number, viewportHeight: number, focusedIndex = -1): number[] {
  const overscan = 8;
  const visibleCount = Math.ceil((viewportHeight || 600) / SESSION_LIST_ITEM_HEIGHT) + overscan * 2;
  const start = Math.max(0, Math.min(Math.floor(scrollTop / SESSION_LIST_ITEM_HEIGHT) - overscan, count - visibleCount));
  const end = Math.min(count, start + visibleCount);
  const indices = Array.from({ length: end - start }, (_, offset) => start + offset);
  // Keep a focused row mounted so scrolling cannot discard an inline rename.
  if (focusedIndex >= 0 && focusedIndex < start) indices.unshift(focusedIndex);
  if (focusedIndex >= end && focusedIndex < count) indices.push(focusedIndex);
  return indices;
}

declare global {
  interface Window {
    piDesktop?: {
      selectDirectory: () => Promise<string | null>;
    };
  }
}

function ToolbarIconButton({
  onClick,
  title,
  disabled,
  skipHover,
  color,
  background = "none",
  marginRight,
  ariaPressed,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  skipHover?: boolean;
  color: string;
  background?: string;
  marginRight?: number;
  ariaPressed?: boolean;
  children: ReactNode;
}) {
  const enter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = "var(--text-muted)";
    e.currentTarget.style.background = "var(--bg-hover)";
  };
  const leave = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled || skipHover) return;
    e.currentTarget.style.color = color;
    e.currentTarget.style.background = background;
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={ariaPressed}
      style={{
        position: "relative",
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 26, height: 26, padding: 0, marginRight,
        background,
        border: "none",
        color,
        cursor: disabled ? "default" : "pointer",
        borderRadius: 5,
        flexShrink: 0,
        opacity: disabled ? 0.6 : 1,
        transition: "color 0.3s, background 0.3s",
      }}
      onMouseEnter={enter}
      onMouseLeave={leave}
    >
      {children}
    </button>
  );
}

function sessionListUrl(summary: boolean, force: boolean): string {
  if (summary) return "/api/sessions?summary=1";
  if (force) return "/api/sessions?force=1";
  return "/api/sessions";
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  skipInitialProjectSelection?: boolean;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string, replacementCwd?: string | null, refreshCatalogue?: boolean) => void;
  onSessionArchived?: (sessionId: string) => void;
  selectedCwd?: string | null;
  selectedCwdState?: SessionInfo["cwdState"];
  onCwdChange?: (
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => void;
  onOpenFile?: (filePath: string, fileName: string, options?: { sourceSessionId?: string | null; modeHint?: "diff" }) => void;
  onOpenTerminal?: (cwd: string) => void;
  explorerRefreshKey?: number;
  fileRevealRequest?: FileRevealRequest;
  onExplorerRefresh?: () => void;
  onAtMention?: (relativePath: string, isDir: boolean) => void;
  onAtMentions?: (relativePaths: string[]) => void;
  /** Fired when a session that is not currently selected finishes running.
   *  Lets the app play a cross-workspace completion tone. */
  onBackgroundTaskDone?: () => void;
  onRunningSessionIdsChange?: (ids: Set<string>) => void;
  onQueuedSessionIdsChange?: (ids: Set<string>) => void;
  onActivityChange?: (attention: SessionAttention[], reviewIds: Set<string>, available: boolean, laterIds: Set<string>, laterAttentionIds: Set<string>, pauses: SessionPauseSnapshot[]) => void;
  onReviewReadReady?: (markRead: ((id: string) => void) | null) => void;
  onReviewLaterReady?: (markLater: ((id: string, requestId?: string) => void) | null) => void;
  onSessionsChange?: (sessions: SessionInfo[]) => void;
}

interface WorktreeEntry {
  path: string;
  branch: string | null;
  isMain: boolean;
  isMerged?: boolean;
}

interface LocalBranchTip {
  branch: string;
  oid: string;
}

interface WorktreeState {
  /** The cwd this data was fetched for — guards against stale responses */
  forCwd: string;
  projectRoot: string;
  /** Stable server-computed identity; never derive OS path semantics here. */
  projectKey: string;
  isGit: boolean;
  /** False when forCwd is a repo subdirectory — the switcher is hidden there
   *  because subdir sessions keep their own project identity */
  isTopLevel: boolean;
  /** Canonical path of the checkout containing forCwd, resolved server-side. */
  currentWorktreePath: string | null;
  worktrees: WorktreeEntry[];
  localBranches: LocalBranchTip[];
}

interface ProjectSelection {
  root: string;
  key: string;
}

interface ValidatedProject {
  cwd: string;
  root: string;
  key: string;
}

const UNREAD_SESSIONS_STORAGE_KEY = "pi-web:unread-session-ids";
const SUBAGENT_REVIEW_STORAGE_KEY = "pi-web:subagent-review-ids";
const LAST_CUSTOM_CWD_STORAGE_KEY = "pi-web:last-custom-cwd";
const RUNNING_SESSIONS_POLL_MS = 2500;
const SESSION_DETAILS_HYDRATION_DELAY_MS = 750;
const SESSION_PANE_DEFAULT_HEIGHT = 320;
const SESSION_PANE_MIN_HEIGHT = 80;
const EXPLORER_PANE_MIN_HEIGHT = 120;
const SESSION_PANE_MAX_HEIGHT = 1600;

function loadLastCustomCwd(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(LAST_CUSTOM_CWD_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastCustomCwd(cwd: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_CUSTOM_CWD_STORAGE_KEY, cwd);
  } catch {
    // Persistence is best-effort.
  }
}

function sameIdSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((id) => b.has(id));
}

/** Substitute the home dir prefix with ~ (no path truncation — see PathLabel) */
function displayCwd(cwd: string, homeDir?: string): string {
  return (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
}

/**
 * Path label that ellipsizes on the LEFT, keeping the (most relevant) trailing
 * segments visible: "…orkspace/pi-web". Shows as much of the path as fits
 * instead of a fixed number of segments. The rtl container moves the ellipsis
 * to the left edge; the inner plaintext bidi isolation keeps the path itself
 * rendered strictly left-to-right (no punctuation reordering).
 */
function PathLabel({ text, style }: { text: string; style?: CSSProperties }) {
  return (
    <span
      style={{
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        display: "block",
        minWidth: 0,
        lineHeight: 1.35,
        direction: "rtl",
        textAlign: "left",
        ...style,
      }}
    >
      <span style={{ unicodeBidi: "plaintext" }}>{text}</span>
    </span>
  );
}

function MergedWorktreeIcon({ label }: { label: string }) {
  return (
    <span role="img" aria-label={label} title={label} style={{ display: "inline-flex", flexShrink: 0, color: "var(--accent)" }}>
      <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="3" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="6" cy="21" r="2" />
        <path d="M6 5v14M18 8a7 7 0 0 1-7 7H6" />
      </svg>
    </span>
  );
}

const DROPDOWN_ANIMATION_MS = 140;

function AnimatedDropdown({ open, children, style }: { open: boolean; children: ReactNode; style: CSSProperties }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    let frame: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (open) {
      setMounted(true);
      setVisible(false);
      frame = window.requestAnimationFrame(() => {
        frame = window.requestAnimationFrame(() => setVisible(true));
      });
    } else {
      setVisible(false);
      timeout = setTimeout(() => setMounted(false), DROPDOWN_ANIMATION_MS);
    }

    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      if (timeout) clearTimeout(timeout);
    };
  }, [open]);

  if (!mounted) return null;

  return (
    <div
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.96)",
        transformOrigin: "top center",
        transition: `opacity ${DROPDOWN_ANIMATION_MS}ms ease, transform ${DROPDOWN_ANIMATION_MS}ms ease`,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {children}
    </div>
  );
}



const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

function useScramble(target: string, running: boolean): string {
  const [display, setDisplay] = useState(target);
  const frameRef = useRef<number | null>(null);
  const iterRef = useRef(0);

  useEffect(() => {
    if (!running) {
      setDisplay(target);
      return;
    }
    iterRef.current = 0;
    const totalFrames = target.length * 4;

    const step = () => {
      iterRef.current += 1;
      const progress = iterRef.current / totalFrames;
      const resolved = Math.floor(progress * target.length);

      setDisplay(
        target
          .split("")
          .map((char, i) => {
            if (char === " ") return " ";
            if (i < resolved) return char;
            return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
          })
          .join("")
      );

      if (iterRef.current < totalFrames) {
        frameRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [target, running]);

  return display;
}

function PiWebTitle() {
  const [showVersion, setShowVersion] = useState(false);
  const [scrambling, setScrambling] = useState(false);
  const revertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const target = showVersion ? `${process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}p${process.env.NEXT_PUBLIC_PI_VERSION ?? "0.0.0"}` : "Pi Web";
  const display = useScramble(target, scrambling);

  const triggerScramble = useCallback((toVersion: boolean) => {
    setShowVersion(toVersion);
    setScrambling(true);
    setTimeout(() => setScrambling(false), (toVersion ? 6 : 8) * 4 * (1000 / 60) + 100);
  }, []);

  const handleClick = useCallback(() => {
    if (revertTimerRef.current) clearTimeout(revertTimerRef.current);

    const next = !showVersion;
    triggerScramble(next);

    if (next) {
      revertTimerRef.current = setTimeout(() => triggerScramble(false), 3000);
    }
  }, [showVersion, triggerScramble]);

  useEffect(() => () => { if (revertTimerRef.current) clearTimeout(revertTimerRef.current); }, []);

  return (
    <button
      onClick={handleClick}
      style={{
        background: "none", border: "none", padding: 0, cursor: "default",
        fontWeight: 700, fontSize: 15, letterSpacing: "-0.01em",
        color: showVersion ? "var(--accent)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        minWidth: "6ch",
      }}
    >
      {display}
    </button>
  );
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, skipInitialProjectSelection, onInitialRestoreDone, refreshKey, onSessionDeleted, onSessionArchived, selectedCwd: selectedCwdProp, selectedCwdState: selectedCwdStateProp, onCwdChange, onOpenFile, onOpenTerminal, explorerRefreshKey, fileRevealRequest, onExplorerRefresh, onAtMention, onAtMentions, onBackgroundTaskDone, onRunningSessionIdsChange, onQueuedSessionIdsChange, onActivityChange, onReviewReadReady, onReviewLaterReady, onSessionsChange }: Props) {
  const { t } = useI18n();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const { starredIds, starredProjectKeys, toggleStarred, toggleStarredProject } = useStarredSessions();
  const allSessionsRef = useRef(allSessions);
  const selectedSessionIdRef = useRef(selectedSessionId);
  allSessionsRef.current = allSessions;
  selectedSessionIdRef.current = selectedSessionId;
  const completedRunTimesRef = useRef(new Map<string, number>());
  const reviewedRunTimesRef = useRef(new Map<string, number>());
  const pendingReviewAcksRef = useRef(new Map<string, number>());
  const laterRunTimesRef = useRef(new Map<string, number>());
  const pendingLaterRef = useRef(new Map<string, number>());
  const laterRequestsRef = useRef(new Set<string>());
  const pendingLaterRequestsRef = useRef(new Map<string, SessionAttentionReceipt>());
  const [laterAttentionSessionIds, setLaterAttentionSessionIds] = useState<Set<string>>(() => new Set());
  const [laterSessionIds, setLaterSessionIds] = useState<Set<string>>(() => new Set());
  const reviewAckInFlightRef = useRef(false);
  const reviewAckFailedRef = useRef(false);
  const [showArchived, setShowArchived] = useState(false);
  const [sessionFilter, setSessionFilter] = useState<{ project: string; cwd: string } | null>(null);
  const [bulkMoveRequest, setBulkMoveRequest] = useState<BulkMoveRequest | null>(null);
  const [bulkModeScope, setBulkModeScope] = useState<string | null>(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkConfirmDelete, setBulkConfirmDelete] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkCompleted, setBulkCompleted] = useState(0);
  const [bulkError, setBulkError] = useState<string | null>(null);
  // Tracked in a ref only: the version is compared against the polled value to
  // decide whether the list needs reloading, and no render reads it.
  const sessionListVersionRef = useRef<number | null>(null);
  const sessionLoadIdRef = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const lastSyncedCwdPropRef = useRef<string | null>(null);
  // Canonical metadata can relocate the selected chat before the sync effect
  // updates the sidebar cwd. Do not issue working reads for the outgoing path
  // in that render. A manual switch with an unchanged prop remains independent.
  const cwdPropPending = Boolean(selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current && selectedCwd !== selectedCwdProp);
  const directoryUnavailable = cwdPropPending || isHistoryOnlySession({ cwdState: (selectedCwd === selectedCwdProp
    ? selectedCwdStateProp : undefined) ?? allSessions.find((session) => session.cwd === selectedCwd)?.cwdState });
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [projectFilter, setProjectFilter] = useState("");
  const [wtFilter, setWtFilter] = useState("");
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState(loadLastCustomCwd);
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [validatedProject, setValidatedProject] = useState<ValidatedProject | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Worktree switcher state
  const [worktreeState, setWorktreeState] = useState<WorktreeState | null>(null);
  const [wtDropdownOpen, setWtDropdownOpen] = useState(false);
  const [wtNewOpen, setWtNewOpen] = useState(false);
  const [managerProject, setManagerProject] = useState<string | null>(null);
  const [wtNewBranch, setWtNewBranch] = useState("");
  const [wtMode, setWtMode] = useState<"create" | "attach">("create");
  // Capture the selected OIDs rather than following a later GET response silently.
  const [wtBase, setWtBase] = useState<(LocalBranchTip & { projectRoot: string }) | null>(null);
  const [wtAttach, setWtAttach] = useState<(LocalBranchTip & { projectRoot: string }) | null>(null);
  const [wtError, setWtError] = useState<string | null>(null);
  const [wtBusy, setWtBusy] = useState(false);
  const [wtConfirmRemove, setWtConfirmRemove] = useState<string | null>(null);
  const [wtPendingRemove, setWtPendingRemove] = useState<string | null>(null);
  const [worktreeLoadingCwd, setWorktreeLoadingCwd] = useState<string | null>(null);
  const wtDropdownRef = useRef<HTMLDivElement>(null);
  const wtNewInputRef = useRef<HTMLInputElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerUploadBusy, setExplorerUploadBusy] = useState(false);
  const [fileSearchOpen, setFileSearchOpen] = useState(false);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [searchAllProjects, setSearchAllProjects] = useState(false);
  const [searchBothStatuses, setSearchBothStatuses] = useState(false);
  const [searchTitlesOnly, setSearchTitlesOnly] = useState(false);
  const sessionSearchActive = sessionSearchOpen && Boolean(sessionSearchQuery.trim());
  const [changesCount, setChangesCount] = useState(0);
  const [changesCollapsed, setChangesCollapsed] = useState(true);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const revealContext = JSON.stringify([selectedCwd ?? selectedCwdProp, selectedSessionId]);
  const consumedReveal = useRef<number | undefined>(undefined);
  const [pendingReveal, setPendingReveal] = useState<{ context: string; request: FileRevealRequest }>();
  useEffect(() => {
    if (!fileRevealRequest || consumedReveal.current === fileRevealRequest.id) return;
    consumedReveal.current = fileRevealRequest.id;
    setPendingReveal({ context: revealContext, request: fileRevealRequest });
    setExplorerOpen(true);
    setFileSearchOpen(false);
    setChangesCollapsed(true);
  }, [fileRevealRequest, revealContext]);
  const handleRevealSettled = useCallback((id: number) => {
    setPendingReveal(previous => previous?.request.id === id ? undefined : previous);
  }, []);
  useEffect(() => {
    setPendingReveal(previous => previous && previous.context !== revealContext ? undefined : previous);
  }, [revealContext]);
  const [runningSessionIds, setRunningSessionIds] = useState<Set<string>>(() => new Set());
  const [queuedSessionIds, setQueuedSessionIds] = useState<Set<string>>(() => new Set());
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(new Set());
  const [subagentReviewIds, setSubagentReviewIds] = useState<Set<string>>(new Set());
  const [storageReady, setStorageReady] = useState(false);
  const [attention, setAttention] = useState<SessionAttention[]>([]);
  const [pauses, setPauses] = useState<SessionPauseSnapshot[]>([]);
  const [activityAvailable, setActivityAvailable] = useState(true);
  const previousRunningSessionIdsRef = useRef<Set<string>>(new Set());
  const currentSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  const previousSuppressedCompletionSessionIdsRef = useRef<Set<string>>(new Set());
  // Once polling has delivered a snapshot it is the source of truth for
  // running state; late /api/sessions responses must not overwrite it.
  const runningPollAuthoritativeRef = useRef(false);
  const detailsHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileExplorerRef = useRef<FileExplorerHandle>(null);

  // Virtualized session list: only the visible window of rows is mounted.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const explorerScrollRef = useRef<HTMLDivElement>(null);
  useScrollbarVisibility(listScrollRef);
  useScrollbarVisibility(explorerScrollRef, explorerOpen && Boolean(selectedCwdProp || selectedCwd));
  const sessionPaneRef = useRef<HTMLDivElement>(null);
  const explorerSectionRef = useRef<HTMLDivElement>(null);
  const sessionPaneHeightRef = useRef(SESSION_PANE_DEFAULT_HEIGHT);
  const getDefaultSessionPaneHeight = useCallback(() => {
    if (!explorerOpen) return SESSION_PANE_DEFAULT_HEIGHT;
    const paneHeight = sessionPaneRef.current?.getBoundingClientRect().height;
    const explorerHeight = explorerSectionRef.current?.getBoundingClientRect().height;
    return paneHeight && explorerHeight
      ? Math.round((paneHeight + explorerHeight) / 2)
      : SESSION_PANE_DEFAULT_HEIGHT;
  }, [explorerOpen]);
  const getMaxSessionPaneHeight = useCallback(() => {
    if (!explorerOpen || !(selectedCwdProp || selectedCwd)) return SESSION_PANE_MAX_HEIGHT;
    const paneHeight = sessionPaneRef.current?.getBoundingClientRect().height ?? SESSION_PANE_DEFAULT_HEIGHT;
    const explorerHeight = explorerSectionRef.current?.getBoundingClientRect().height ?? EXPLORER_PANE_MIN_HEIGHT;
    return Math.max(
      SESSION_PANE_MIN_HEIGHT,
      paneHeight + explorerHeight - EXPLORER_PANE_MIN_HEIGHT,
    );
  }, [explorerOpen, selectedCwd, selectedCwdProp]);
  const sessionPaneResizer = useResizablePanel({
    ariaLabel: t("layout.resizeSidebarSections"),
    axis: "vertical",
    cssVariable: "--sidebar-session-pane-height",
    defaultWidth: SESSION_PANE_DEFAULT_HEIGHT,
    getDefaultWidth: getDefaultSessionPaneHeight,
    getMaxWidth: getMaxSessionPaneHeight,
    growthDirection: "down",
    maxWidth: SESSION_PANE_MAX_HEIGHT,
    minWidth: SESSION_PANE_MIN_HEIGHT,
    storageKey: "pi-web:sidebar-session-pane-height",
    widthRef: sessionPaneHeightRef,
  });
  const [listViewportH, setListViewportH] = useState(0);
  const [listScrollTop, setListScrollTop] = useState(0);
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const listScrollRafRef = useRef<number | null>(null);
  const listScrollTopRef = useRef(0);
  const renderedListScrollTopRef = useRef(0);
  const handleListScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    listScrollTopRef.current = e.currentTarget.scrollTop;
    if (listScrollRafRef.current != null) return;
    listScrollRafRef.current = requestAnimationFrame(() => {
      listScrollRafRef.current = null;
      const nextTop = Math.floor(listScrollTopRef.current / SESSION_LIST_ITEM_HEIGHT) * SESSION_LIST_ITEM_HEIGHT;
      if (renderedListScrollTopRef.current === nextTop) return;
      renderedListScrollTopRef.current = nextTop;
      setListScrollTop(nextTop);
    });
  }, []);
  useLayoutEffect(() => {
    const el = listScrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setListViewportH(entry.contentRect.height);
    });
    ro.observe(el);
    setListViewportH(el.clientHeight);
    listScrollTopRef.current = el.scrollTop;
    renderedListScrollTopRef.current = Math.floor(el.scrollTop / SESSION_LIST_ITEM_HEIGHT) * SESSION_LIST_ITEM_HEIGHT;
    setListScrollTop(renderedListScrollTopRef.current);
    return () => ro.disconnect();
  }, [sessionSearchActive]);

  const loadSessions = useCallback(async (showLoading = false, force = false, summary = false) => {
    const loadId = ++sessionLoadIdRef.current;
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(sessionListUrl(summary, force), {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as {
        sessions: SessionInfo[];
        sessionListVersion: number;
        runningSessionIds?: string[];
        completionNotificationSuppressedSessionIds?: string[];
      };
      if (loadId !== sessionLoadIdRef.current) return;
      sessionListVersionRef.current = data.sessionListVersion;
      setAllSessions(data.sessions);
      // Treat the fetched running set as an initial fallback only. Once the
      // lightweight poll is live, a slow session-list fetch cannot overwrite it.
      if (!runningPollAuthoritativeRef.current) {
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
      }
      // Drop markers for deleted sessions and for subagents, whose completion
      // is intentionally silent even if an older client marked them unread.
      const unreadEligibleIds = new Set(
        data.sessions
          .filter((session) => session.relation?.kind !== "subagent")
          .map((session) => session.id),
      );
      setUnreadSessionIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set([...prev].filter((id) => unreadEligibleIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      const subagentIds = new Set(data.sessions.filter((session) =>
        session.relation?.kind === "subagent",
      ).map((session) => session.id));
      setSubagentReviewIds((prev) => {
        const next = new Set([...prev].filter((id) => subagentIds.has(id)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
      return true;
    } catch (e) {
      if (loadId === sessionLoadIdRef.current) setError(String(e));
      return false;
    } finally {
      if (loadId === sessionLoadIdRef.current) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    let active = true;

    if (isFirst) {
      // Header/stat metadata is enough to select the URL session and paint the
      // sidebar. Hydrate exact counts, names, and first messages once the
      // selected chat has had a chance to start loading.
      void loadSessions(true, false, true).then(() => {
        if (!active) return;
        detailsHydrationTimerRef.current = setTimeout(() => {
          detailsHydrationTimerRef.current = null;
          if (active) void loadSessions(false, true);
        }, SESSION_DETAILS_HYDRATION_DELAY_MS);
      });
    } else {
      void loadSessions(false, true);
    }

    return () => {
      active = false;
      if (detailsHydrationTimerRef.current) {
        clearTimeout(detailsHydrationTimerRef.current);
        detailsHydrationTimerRef.current = null;
      }
    };
  }, [loadSessions, refreshKey]);

  // Browser storage is unavailable during server rendering. Restore the panel
  // preference after hydration so a collapsed explorer stays collapsed on reload.
  useEffect(() => {
    setExplorerOpen(loadExplorerOpen());
  }, []);

  const flushReviewAcks = useCallback(async function flushReviewAcks() {
    if (reviewAckInFlightRef.current || (pendingReviewAcksRef.current.size === 0 && pendingLaterRef.current.size === 0 && pendingLaterRequestsRef.current.size === 0)) return;
    reviewAckInFlightRef.current = true;
    try {
      for (const op of ["ack", "later"] as const) {
        const pending = op === "ack" ? pendingReviewAcksRef.current : pendingLaterRef.current;
        const entries = [...pending].map(([sessionId, at]) => ({ sessionId, at }));
        if (entries.length === 0) continue;
        const response = await fetch("/api/activity/review", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, entries }),
        });
        if (!response.ok) throw new Error(`Review acknowledgement failed: HTTP ${response.status}`);
        const data = await response.json() as { reviewedRuns: SessionCompletion[]; laterRuns: SessionCompletion[] };
        const confirmed = new Map((op === "ack" ? data.reviewedRuns : data.laterRuns).map(({ sessionId, at }) => [sessionId, at]));
        for (const { sessionId, at } of entries) {
          if ((confirmed.get(sessionId) ?? 0) >= at && (pending.get(sessionId) ?? 0) <= at) pending.delete(sessionId);
        }
        const times = op === "ack" ? reviewedRunTimesRef : laterRunTimesRef;
        times.current = mergeReviewedRunTimes(times.current, confirmed);
      }
      if (pendingLaterRequestsRef.current.size > 0) {
        const entries = [...pendingLaterRequestsRef.current.values()];
        const response = await fetch("/api/activity/review", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "later-request", entries }),
        });
        if (!response.ok) throw new Error(`Request deferral failed: HTTP ${response.status}`);
        const data = await response.json() as { laterRequests: SessionAttentionReceipt[] };
        const confirmed = new Set(data.laterRequests.map(activityRequestKey));
        for (const entry of entries) {
          const key = activityRequestKey(entry);
          if (confirmed.has(key)) pendingLaterRequestsRef.current.delete(key);
        }
        for (const key of confirmed) laterRequestsRef.current.add(key);
      }
      reviewAckFailedRef.current = false;
    } catch {
      // Retain the pending receipt and retry on the next visible-tab poll.
      reviewAckFailedRef.current = true;
      setActivityAvailable(false);
    } finally {
      reviewAckInFlightRef.current = false;
      // Bulk reads may enqueue more receipts while the first POST is in flight.
      // Drain them promptly instead of relying on another visible-tab poll.
      if (!reviewAckFailedRef.current && (pendingReviewAcksRef.current.size > 0 || pendingLaterRef.current.size > 0 || pendingLaterRequestsRef.current.size > 0)) void flushReviewAcks();
    }
  }, []);

  const markReviewRead = useCallback((id: string) => {
    const at = completedRunTimesRef.current.get(id);
    if (!at || at <= (reviewedRunTimesRef.current.get(id) ?? 0) || runningSessionIds.has(id)) return;
    reviewedRunTimesRef.current.set(id, at);
    pendingReviewAcksRef.current.set(id, Math.max(at, pendingReviewAcksRef.current.get(id) ?? 0));
    setUnreadSessionIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setSubagentReviewIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    void flushReviewAcks();
  }, [flushReviewAcks, runningSessionIds]);

  useEffect(() => {
    onReviewReadReady?.(markReviewRead);
    return () => onReviewReadReady?.(null);
  }, [markReviewRead, onReviewReadReady]);

  const markReviewLater = useCallback((id: string, requestId?: string) => {
    if (requestId) {
      const receipt = { sessionId: id, requestId };
      if (!isCurrentActivityRequest(attention, receipt)) return;
      const key = activityRequestKey(receipt);
      laterRequestsRef.current.add(key);
      pendingLaterRequestsRef.current.set(key, receipt);
      setLaterAttentionSessionIds((previous) => new Set([...previous, id]));
      void flushReviewAcks();
      return;
    }
    const at = completedRunTimesRef.current.get(id);
    if (!at || at <= (reviewedRunTimesRef.current.get(id) ?? 0) || runningSessionIds.has(id)) return;
    laterRunTimesRef.current.set(id, at);
    pendingLaterRef.current.set(id, at);
    setLaterSessionIds((previous) => new Set([...previous, id]));
    void flushReviewAcks();
  }, [attention, flushReviewAcks, runningSessionIds]);

  useEffect(() => {
    onReviewLaterReady?.(markReviewLater);
    return () => onReviewLaterReady?.(null);
  }, [markReviewLater, onReviewLaterReady]);

  // Import only timestamped legacy receipts. ID-only unread flags cannot prove
  // that a run actually settled; the server is authoritative after this point.
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const legacy = [...loadReviewedRunTimes()]
        .filter(([sessionId, at]) => sessionId.length > 0 && sessionId.length <= 256 && Number.isSafeInteger(at) && at > 0)
        .map(([sessionId, at]) => ({ sessionId, at }));
      try {
        for (let offset = 0; offset < legacy.length || offset === 0; offset += 1000) {
          const response = await fetch("/api/activity/review", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ op: "import", entries: legacy.slice(offset, offset + 1000) }),
          });
          if (!response.ok) throw new Error(`Review import failed: HTTP ${response.status}`);
        }
        window.localStorage.removeItem(REVIEWED_RUN_TIMES_STORAGE_KEY);
        window.localStorage.removeItem(UNREAD_SESSIONS_STORAGE_KEY);
        window.localStorage.removeItem(SUBAGENT_REVIEW_STORAGE_KEY);
      } catch {
        // Keep legacy state for another attempt on reload; no browser-only
        // marker is presented as authoritative in the meantime.
      } finally {
        if (mounted) setStorageReady(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const clearTimer = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const schedule = () => {
      clearTimer();
      if (stopped || document.visibilityState !== "visible") return;
      timer = setTimeout(() => void poll(), RUNNING_SESSIONS_POLL_MS);
    };

    const poll = async () => {
      if (stopped || document.visibilityState !== "visible") return;
      const current = new AbortController();
      controller?.abort();
      controller = current;
      try {
        const res = await fetch("/api/agent/running", {
          cache: "no-store",
          signal: current.signal,
        });
        if (!res.ok) {
          if (!stopped && controller === current) setActivityAvailable(false);
          return;
        }
        const data = await res.json() as {
          sessionListVersion: number;
          runningSessionIds?: string[];
          queuedSessionIds?: string[];
          completionNotificationSuppressedSessionIds?: string[];
          attention?: SessionAttention[];
          pauses?: SessionPauseSnapshot[];
          completedRuns?: SessionCompletion[];
          reviewedRuns?: SessionCompletion[];
          laterRuns?: SessionCompletion[];
          laterRequests?: SessionAttentionReceipt[];
          activityReviewPersistenceFailed?: boolean;
        };
        if (stopped || controller !== current) return;
        runningPollAuthoritativeRef.current = true;
        setAttention(data.attention ?? []);
        setPauses(data.pauses ?? []);
        const running = new Set(data.runningSessionIds ?? []);
        completedRunTimesRef.current = new Map((data.completedRuns ?? []).map(({ sessionId, at }) => [sessionId, at]));
        const serverReviewed = new Map((data.reviewedRuns ?? []).map(({ sessionId, at }) => [sessionId, at]));
        for (const [id, at] of pendingReviewAcksRef.current) {
          if ((serverReviewed.get(id) ?? 0) >= at || !completedRunTimesRef.current.has(id)) {
            pendingReviewAcksRef.current.delete(id);
          }
        }
        const retainedReviewed = new Map([...reviewedRunTimesRef.current]
          .filter(([id]) => completedRunTimesRef.current.has(id)));
        reviewedRunTimesRef.current = mergeReviewedRunTimes(
          mergeReviewedRunTimes(retainedReviewed, serverReviewed), pendingReviewAcksRef.current,
        );
        const serverLater = new Map((data.laterRuns ?? []).map(({ sessionId, at }) => [sessionId, at]));
        for (const [id, at] of pendingLaterRef.current) {
          if ((serverLater.get(id) ?? 0) >= at || !completedRunTimesRef.current.has(id)) pendingLaterRef.current.delete(id);
        }
        laterRunTimesRef.current = mergeReviewedRunTimes(
          mergeReviewedRunTimes(new Map([...laterRunTimesRef.current].filter(([id]) => completedRunTimesRef.current.has(id))), serverLater),
          pendingLaterRef.current,
        );
        const activeRequests = new Set((data.attention ?? []).flatMap((request) => request.requestId
          ? [activityRequestKey({ sessionId: request.sessionId, requestId: request.requestId })] : []));
        const serverRequests = new Set((data.laterRequests ?? []).map(activityRequestKey));
        for (const key of pendingLaterRequestsRef.current.keys()) {
          if (serverRequests.has(key) || !activeRequests.has(key)) pendingLaterRequestsRef.current.delete(key);
        }
        laterRequestsRef.current = new Set([...laterRequestsRef.current, ...serverRequests, ...pendingLaterRequestsRef.current.keys()]
          .filter((key) => activeRequests.has(key)));
        const deferredIds = deferredAttentionIds(data.attention ?? [], laterRequestsRef.current);
        setLaterAttentionSessionIds((previous) => sameIdSet(previous, deferredIds) ? previous : deferredIds);
        // A write may have persisted even when its response was lost. A poll
        // confirming all receipts must recover availability without another POST.
        if (!reviewAckInFlightRef.current && pendingReviewAcksRef.current.size === 0 && pendingLaterRef.current.size === 0 && pendingLaterRequestsRef.current.size === 0) {
          reviewAckFailedRef.current = false;
        }
        setActivityAvailable(!data.activityReviewPersistenceFailed && !reviewAckFailedRef.current);
        const laterIds = new Set([...laterRunTimesRef.current].filter(([id, at]) =>
          at === completedRunTimesRef.current.get(id) && at > (reviewedRunTimesRef.current.get(id) ?? 0)).map(([id]) => id));
        setLaterSessionIds((previous) => sameIdSet(previous, laterIds) ? previous : laterIds);
        const reviewed = reconcileCompletedRuns(
          data.completedRuns ?? [], reviewedRunTimesRef.current, running, allSessionsRef.current,
        );
        void flushReviewAcks();
        setUnreadSessionIds((prev) => sameIdSet(prev, reviewed.rootReady) ? prev : reviewed.rootReady);
        setSubagentReviewIds((prev) => sameIdSet(prev, reviewed.subagentReady) ? prev : reviewed.subagentReady);
        currentSuppressedCompletionSessionIdsRef.current = new Set(
          data.completionNotificationSuppressedSessionIds ?? [],
        );
        setRunningSessionIds(new Set(data.runningSessionIds ?? []));
        setQueuedSessionIds(new Set(data.queuedSessionIds ?? []));
        if (data.sessionListVersion !== sessionListVersionRef.current) {
          // Reuse the invalidated cache; forcing a scan would change the version again.
          await loadSessions();
        }
      } catch {
        // Keep the last known state, but do not present it as live.
        if (!stopped && document.visibilityState === "visible") setActivityAvailable(false);
      } finally {
        if (controller === current) controller = null;
        schedule();
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void poll();
        return;
      }
      clearTimer();
      controller?.abort();
      controller = null;
    };

    void poll();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pi-web:activity-refresh", onVisibilityChange);
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pi-web:activity-refresh", onVisibilityChange);
    };
  }, [flushReviewAcks, loadSessions, storageReady]);

  useEffect(() => {
    onRunningSessionIdsChange?.(runningSessionIds);
  }, [onRunningSessionIdsChange, runningSessionIds]);

  useEffect(() => {
    onQueuedSessionIdsChange?.(queuedSessionIds);
  }, [onQueuedSessionIdsChange, queuedSessionIds]);

  useEffect(() => {
    onActivityChange?.(attention, new Set([...unreadSessionIds, ...subagentReviewIds]), activityAvailable, laterSessionIds, laterAttentionSessionIds, pauses);
  }, [onActivityChange, attention, unreadSessionIds, subagentReviewIds, activityAvailable, laterSessionIds, laterAttentionSessionIds, pauses]);

  useEffect(() => {
    onSessionsChange?.(allSessions);
  }, [allSessions, onSessionsChange]);

  useEffect(() => {
    const previous = previousRunningSessionIdsRef.current;
    const completedInBackground = [...previous].filter((id) => !runningSessionIds.has(id) && id !== selectedSessionId);
    const knownSubagentIds = new Set(
      allSessions
        .filter((session) => session.relation?.kind === "subagent")
        .map((session) => session.id),
    );
    const unreviewedCompletion = (id: string) => {
      const completedAt = completedRunTimesRef.current.get(id);
      return Boolean(completedAt && completedAt > (reviewedRunTimesRef.current.get(id) ?? 0));
    };
    const pausedSessionIds = new Set(pauses.map((row) => row.sessionId));
    const completedWithNotifications = completedInBackground.filter(
      (id) => !previousSuppressedCompletionSessionIdsRef.current.has(id)
        && !knownSubagentIds.has(id) && !pausedSessionIds.has(id) && unreviewedCompletion(id),
    );
    const newlyRunning = [...runningSessionIds].filter((id) => !previous.has(id));

    const hasUnlistedRunningSession = newlyRunning.some(
      (id) => !allSessions.some((session) => session.id === id),
    );
    if (completedInBackground.length > 0 || hasUnlistedRunningSession) {
      loadSessions(false, true);
    }
    if (completedWithNotifications.length > 0) {
      onBackgroundTaskDone?.();
    }

    previousRunningSessionIdsRef.current = runningSessionIds;
    previousSuppressedCompletionSessionIdsRef.current = new Set(
      [...runningSessionIds].filter(
        (id) => currentSuppressedCompletionSessionIdsRef.current.has(id) || knownSubagentIds.has(id),
      ),
    );
  }, [runningSessionIds, selectedSessionId, allSessions, loadSessions, onBackgroundTaskDone, pauses]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  const projectSelection = useCallback((root: string, key: string): ProjectSelection => ({
    root,
    key,
  }), []);

  /** Resolve both display root and stable identity from server-provided data. */
  const projectFor = useCallback((cwd: string | null): ProjectSelection | null => {
    if (!cwd) return null;
    // /api/cwd/validate resolves identity before a custom path becomes active,
    // preventing one render with a raw path key from looking like a switch.
    if (validatedProject?.cwd === cwd) {
      return projectSelection(validatedProject.root, validatedProject.key);
    }
    if (worktreeState && worktreeState.forCwd === cwd) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    // Any path in the loaded worktree list belongs to that project — covers
    // worktrees without sessions, so switching to them keeps the row mounted.
    if (worktreeState?.worktrees.some((w) => w.path === cwd)) {
      return projectSelection(worktreeState.projectRoot, worktreeState.projectKey);
    }
    const match = allSessions.find((session) => (
      session.cwd === cwd || (session.projectRoot ?? session.cwd) === cwd
    ));
    return match
      ? projectSelection(match.projectRoot ?? match.cwd, workspaceKeyOf(match))
      : projectSelection(cwd, cwd);
  }, [validatedProject, worktreeState, allSessions, projectSelection]);

  // A worktree/session refresh can hydrate the stable key without changing
  // cwd, so notify when either changes. The parent treats same-cwd key changes
  // as identity hydration rather than a workspace switch.
  const lastNotifiedProjectRef = useRef<{ cwd: string | null; key: string | null } | null>(null);
  useEffect(() => {
    const project = projectFor(selectedCwd);
    const previous = lastNotifiedProjectRef.current;
    if (previous?.cwd === selectedCwd && previous.key === (project?.key ?? null)) return;
    lastNotifiedProjectRef.current = { cwd: selectedCwd, key: project?.key ?? null };
    onCwdChange?.(
      selectedCwd,
      project?.root ?? null,
      project?.key ?? null,
    );
  }, [selectedCwd, onCwdChange, projectFor]);

  // Sync the worktree switcher to the selected session's cwd. Sessions of all
  // worktrees in a project share one list, so clicking a session from another
  // worktree should move the effective cwd there. Only fires when the prop
  // value changes, so a manual switcher change is not snapped back.
  useEffect(() => {
    if (selectedCwdProp && selectedCwdProp !== lastSyncedCwdPropRef.current) {
      lastSyncedCwdPropRef.current = selectedCwdProp;
      setSelectedCwd(selectedCwdProp);
    }
  }, [selectedCwdProp]);

  // Load worktrees for the current effective cwd
  const [wtRefreshKey, setWtRefreshKey] = useState(0);
  useLayoutEffect(() => {
    if (!selectedCwd || directoryUnavailable) {
      setWorktreeState(null);
      setWorktreeLoadingCwd(null);
      return;
    }
    let cancelled = false;
    setWorktreeLoadingCwd(selectedCwd);
    fetch(`/api/worktrees?cwd=${encodeURIComponent(selectedCwd)}`)
      .then((r) => r.json())
      .then((d: { projectRoot?: string; projectKey?: string; isGit?: boolean; isTopLevel?: boolean; currentWorktreePath?: string | null; worktrees?: WorktreeEntry[]; localBranches?: LocalBranchTip[]; error?: string }) => {
        if (cancelled) return;
        setWorktreeLoadingCwd(null);
        if (d.error || !d.projectRoot) {
          setWorktreeState(null);
          return;
        }
        setWorktreeState({
          forCwd: selectedCwd,
          projectRoot: d.projectRoot,
          projectKey: d.projectKey ?? d.projectRoot,
          isGit: d.isGit ?? false,
          isTopLevel: d.isTopLevel ?? false,
          currentWorktreePath: d.currentWorktreePath ?? null,
          worktrees: d.worktrees ?? [],
          localBranches: d.localBranches ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorktreeLoadingCwd(null);
          setWorktreeState(null);
        }
      });
    return () => { cancelled = true; };
  }, [directoryUnavailable, selectedCwd, wtRefreshKey, refreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0 || skipInitialProjectSelection) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const projects = getRecentProjects(allSessions);
      if (projects.length > 0) setSelectedCwd(projects[0].root);
    }
  }, [allSessions, selectedCwd, initialSessionId, skipInitialProjectSelection, onSelectSession, onInitialRestoreDone]);

  // Prefer an exact UI selection while a refetch is in flight. Once the
  // response catches up, the server-resolved path handles Windows case and
  // separator differences without teaching the browser OS path semantics.
  const currentWorktree = useMemo(() => worktreeState
    ? worktreeState.worktrees.find((worktree) => worktree.path === selectedCwd)
      ?? (worktreeState.forCwd === selectedCwd && worktreeState.currentWorktreePath
        ? worktreeState.worktrees.find((worktree) => worktree.path === worktreeState.currentWorktreePath)
        : undefined)
      ?? worktreeState.worktrees.find((worktree) => worktree.isMain)
    : undefined, [worktreeState, selectedCwd]);
  const currentWorktreePath = currentWorktree?.path ?? null;

  const commitCustomPath = useCallback(async (candidate?: string) => {
    const path = (candidate ?? customPathValue).trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as {
        cwd?: string;
        projectRoot?: string;
        projectKey?: string;
        error?: string;
      };
      if (!res.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setValidatedProject({
        cwd: data.cwd,
        root: data.projectRoot,
        key: data.projectKey,
      });
      saveLastCustomCwd(data.cwd);
      setCustomPathValue(data.cwd);
      setSelectedCwd(data.cwd);
      setCustomPathOpen(false);
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleCustomPathClick = useCallback(() => {
    setCustomPathOpen(true);
    setCustomPathError(null);
    setDropdownOpen(false);
  }, []);
  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleCreateWorktree = useCallback(async () => {
    const branch = wtMode === "attach" ? wtAttach?.branch : wtNewBranch.trim();
    if (!branch || wtBusy || !worktreeState || !wtBase || wtBase.projectRoot !== worktreeState.projectRoot
      || (wtMode === "attach" && (!wtAttach || wtAttach.projectRoot !== worktreeState.projectRoot))) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cwd: worktreeState.projectRoot, branch, mode: wtMode,
          baseBranch: wtBase.branch, expectedBaseOid: wtBase.oid,
          ...(wtMode === "attach" ? { expectedTipOid: wtAttach?.oid } : {}),
        }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; error?: string };
      if (!res.ok || data.error || !data.path) {
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtNewOpen(false);
      setWtNewBranch("");
      setWtBase(null);
      setWtAttach(null);
      setWtDropdownOpen(false);
      // Optimistically register the new worktree so projectFor() resolves
      // it to the main repo before the refetch lands (keeps AppShell from
      // treating the new cwd as a different project).
      setWorktreeState((prev) => prev ? {
        ...prev,
        forCwd: data.path!,
        currentWorktreePath: data.path!,
        worktrees: [...prev.worktrees, { path: data.path!, branch, isMain: false }],
      } : prev);
      setSelectedCwd(data.path);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [wtNewBranch, wtMode, wtAttach, wtBase, wtBusy, worktreeState]);

  const handleRemoveWorktree = useCallback(async (path: string, force: boolean) => {
    if (!worktreeState || wtBusy) return;
    setWtBusy(true);
    setWtError(null);
    try {
      const res = await fetch("/api/worktrees", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: worktreeState.projectRoot, path, force }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; dirty?: boolean };
      if (!res.ok) {
        if (data.dirty && !force) {
          // Dirty worktree — ask the user to confirm a force removal
          setWtConfirmRemove(path);
          setWtPendingRemove(null);
          return;
        }
        setWtError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setWtConfirmRemove(null);
      setWtPendingRemove(null);
      if (currentWorktreePath === path) setSelectedCwd(worktreeState.projectRoot);
      setWtRefreshKey((k) => k + 1);
    } catch (e) {
      setWtError(e instanceof Error ? e.message : String(e));
    } finally {
      setWtBusy(false);
    }
  }, [worktreeState, wtBusy, currentWorktreePath]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setProjectFilter("");
      }
      if (wtDropdownRef.current && !wtDropdownRef.current.contains(e.target as Node)) {
        setWtDropdownOpen(false);
        setWtNewOpen(false);
        setWtNewBranch("");
        setWtBase(null);
        setWtAttach(null);
        setWtError(null);
        setWtConfirmRemove(null);
        setWtFilter("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Clicking a session moves the effective cwd to that session's worktree.
  // Done on the click path (not via the selectedCwd prop sync) so it also
  // works when the prop value won't change — e.g. re-clicking the already
  // open session after manually switching worktrees.
  const handleSelectSessionFromList = useCallback((s: SessionInfo, entryId?: string, blockIndex?: number) => {
    setAllSessions((current) => current.some((session) => session.id === s.id) ? current : [s, ...current]);
    if (s.cwd) setSelectedCwd(s.cwd);
    onSelectSession(s, false, entryId, blockIndex);
  }, [onSelectSession]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd || directoryUnavailable) return;
    // Give the fresh composer a stable draft identity while AppShell's explicit
    // New lifecycle saves its empty session without sending a model prompt.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [directoryUnavailable, selectedCwd, onNewSession]);

  const [movingSession, setMovingSession] = useState<SessionInfo | null>(null);
  const [moveDestination, setMoveDestination] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const proposeMoveDestination = useCallback((path: string) => {
    setMoveDestination(path);
    setMoveError(null);
  }, [setMoveDestination, setMoveError]);

  const confirmMove = useCallback(async () => {
    if (!movingSession || !moveDestination || moveBusy) return;
    setMoveBusy(true);
    setMoveError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(movingSession.id)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: moveDestination }),
      });
      const data = await readSessionMoveResponse<{ movedIds?: string[] }>(response);
      // An open chat's cwd and wrapper no longer match the relocated file.
      // Close it rather than letting it send a prompt against the old project.
      if (selectedSessionId && data.movedIds?.includes(selectedSessionId)) {
        setSelectedCwd(moveDestination);
        onSessionDeleted?.(selectedSessionId, moveDestination, false);
      }
      setMovingSession(null);
      void loadSessions(false, true);
    } catch (error) {
      setMoveError(`${error instanceof SessionMoveResponseError ? t("sessionWorktrees.invalidResponse", { status: error.status }) : String(error)} ${t("sessionWorktrees.unknownOutcome")}`);
      void loadSessions(false, true);
    } finally {
      setMoveBusy(false);
    }
  }, [movingSession, moveDestination, moveBusy, selectedSessionId, onSessionDeleted, loadSessions, setMovingSession, setMoveError, t]);

  const recentProjects = useMemo(() => {
    const projects = getRecentProjects(allSessions);
    return projects.sort((a, b) => Number(starredProjectKeys.has(b.key)) - Number(starredProjectKeys.has(a.key)));
  }, [allSessions, starredProjectKeys]);
  const showProjectFilter = recentProjects.length > 8;
  const visibleProjects = useMemo(() => {
    const query = projectFilter.trim().toLowerCase();
    return query
      ? recentProjects.filter((project) => project.root.toLowerCase().includes(query))
      : recentProjects;
  }, [projectFilter, recentProjects]);

  // Sessions of every worktree in the selected project are shown together
  const selectedProject = useMemo(() => projectFor(selectedCwd), [projectFor, selectedCwd]);

  // Per-project activity counts (running / unread) for the workspace selector.
  // Uses the same stable server key as the project list and filtering.
  const projectActivity = useMemo(
    () => getProjectActivity(allSessions.filter((session) => !session.archived), runningSessionIds, unreadSessionIds),
    [allSessions, runningSessionIds, unreadSessionIds],
  );

  // Any activity in a project other than the one currently selected — shown as
  // a dot on the (collapsed) selector button so it is visible without opening
  // the dropdown.
  const hasOtherWorkspaceActivity = useMemo(
    () => [...projectActivity.entries()].some(
      ([key, { running, unread }]) => key !== selectedProject?.key && (running > 0 || unread > 0),
    ),
    [projectActivity, selectedProject],
  );

  const sessionWorktreeCwd = sessionFilter && sessionFilter.project === selectedProject?.key ? sessionFilter.cwd : null;
  const sessionWorktreeCatalogKey = useMemo(() => JSON.stringify(allSessions.map(session =>
    [session.id, session.cwd, session.projectKey, session.archived])), [allSessions]);
  const sessionWorktrees = useSessionWorktrees(selectedProject?.root ?? null, `${sessionWorktreeCatalogKey}:${wtRefreshKey}`);
  const chooseSessionWorktree = (cwd: string) => {
    setSessionFilter(cwd && selectedProject ? { project: selectedProject.key, cwd } : null);
    setBulkModeScope(null); setBulkSelectedIds(new Set()); setBulkError(null);
  };
  const showWorktreeSwitcher = Boolean(
    worktreeState?.isGit
    && worktreeState.isTopLevel
    && selectedCwd
    && selectedProject?.key === worktreeState.projectKey
  );
  const worktreeGuide = selectedCwd
    && worktreeState
    && selectedProject?.key === worktreeState.projectKey
    && !showWorktreeSwitcher
    ? (worktreeState.isGit
        ? {
             label: t("sidebar.openRepoRoot"),
             title: t("sidebar.openRepoRootTitle"),
          }
        : {
             label: t("sidebar.gitRepoRootOnly"),
             title: t("sidebar.gitRepoRootOnlyTitle"),
          })
    : null;
  const worktreeLoading = Boolean(selectedCwd && worktreeLoadingCwd === selectedCwd);
  const inactiveWorktreeSelector = worktreeGuide
    ?? (worktreeLoading && !showWorktreeSwitcher
      ? {
           label: t("sidebar.worktrees"),
           title: t("sidebar.checkingWorktrees"),
        }
      : null);

  const sessionFamilies = useMemo(
    () => sessionFamiliesForWorktree(allSessions, selectedProject?.key ?? null, sessionWorktreeCwd, showArchived ? "archived" : "active"),
    [allSessions, selectedProject?.key, sessionWorktreeCwd, showArchived],
  );

  const bulkScope = JSON.stringify([selectedProject?.key ?? "", showArchived, sessionWorktreeCwd]);
  const bulkSelecting = selectedProject !== null && bulkModeScope === bulkScope && !sessionSearchActive;
  const selectedFamilyIds = useMemo(() => new Set(
    sessionFamilies.filter((family) => !family.root.transient && bulkSelectedIds.has(family.root.id))
      .map((family) => family.root.id),
  ), [sessionFamilies, bulkSelectedIds]);
  const bulkArchiveBlocked = sessionFamilies.some(family => selectedFamilyIds.has(family.root.id) && family.archiveOwnerId !== family.root.id);
  const selectableFamilyIds = useMemo(() => sessionFamilies.filter((family) => !family.root.transient)
    .map((family) => family.root.id), [sessionFamilies]);

  // A selection belongs to one project and one archive view, never to search
  // results. The mode itself is opt-in and resets when that scope changes.
  useEffect(() => {
    if (bulkModeScope === null || (bulkModeScope === bulkScope && !sessionSearchActive)) return;
    setBulkModeScope(null);
    setBulkSelectedIds(new Set());
    setBulkConfirmDelete(false);
    setBulkError(null);
  }, [bulkModeScope, bulkScope, sessionSearchActive]);

  const exitBulkMode = () => {
    setBulkModeScope(null);
    setBulkSelectedIds(new Set());
    setBulkConfirmDelete(false);
    setBulkError(null);
  };

  const performBulkAction = async (action: BulkSessionAction) => {
    if (bulkBusy || !bulkSelecting || selectedFamilyIds.size === 0 || (action !== "delete" && bulkArchiveBlocked)) return;
    const ids = [...selectedFamilyIds];
    const selectedFamilies = sessionFamilies.filter((family) => selectedFamilyIds.has(family.root.id));
    setBulkConfirmDelete(false);
    setBulkError(null);
    setBulkCompleted(0);
    setBulkBusy(true);
    try {
      const result = await runBulkSessionAction(ids, action, fetch, setBulkCompleted);
      if (result.succeeded.length > 0) {
        // Discard older list fetches so an in-flight response cannot undo the update.
        sessionLoadIdRef.current += 1;
        if (action !== "delete") {
          const succeeded = new Set(result.succeeded);
          setAllSessions((current) => current.map((session) => succeeded.has(session.id)
            ? { ...session, archived: action === "archive" } : session));
        }
        for (const family of selectedFamilies.filter((item) => result.succeeded.includes(item.root.id))) {
          const affected = [family.root, ...family.subagents].some((item) => item.id === selectedSessionIdRef.current);
          if (affected) {
            if (action === "delete") onSessionDeleted?.(selectedSessionIdRef.current!);
            else onSessionArchived?.(selectedSessionIdRef.current!);
          }
        }
      }
      setBulkSelectedIds(new Set(result.failed.map((item) => item.id)));
      if (result.failed.length === 0) exitBulkMode();
      else setBulkError(t("sidebar.bulkFailed", { count: result.failed.length, succeeded: result.succeeded.length })
        + ` (${result.failed.slice(0, 3).map((item) => `${item.id}: ${item.status}`).join(", ")})`);
      if (result.succeeded.length > 0) await loadSessions(false, true);
    } finally {
      setBulkBusy(false);
    }
  };

  const virtualIndices = useMemo(() => getSessionListIndices(
    sessionFamilies.length,
    listScrollTop,
    listViewportH,
    sessionFamilies.findIndex((family) => family.root.id === focusedSessionId),
  ), [focusedSessionId, listScrollTop, listViewportH, sessionFamilies]);

  return (
    <div
      ref={sessionPaneResizer.panelRef}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        "--sidebar-session-pane-height": `${sessionPaneResizer.width}px`,
      } as CSSProperties}
    >
      {managerProject && worktreeState?.projectKey === managerProject && currentWorktreePath && (
        <WorktreeManager key={managerProject} cwd={currentWorktreePath}
          onClose={() => setManagerProject(null)}
          onChanged={() => { setWtRefreshKey((key) => key + 1); setExplorerKey((key) => key + 1); }}
          onSelectCheckout={(path) => setSelectedCwd(path)}
          onReturnFocus={() => wtDropdownRef.current?.querySelector("button")?.focus({ preventScroll: true })} />
      )}
      {bulkMoveRequest && <SessionBulkMoveDialog request={bulkMoveRequest} projects={recentProjects}
        currentCwd={sessionFilter?.cwd ?? selectedCwd ?? bulkMoveRequest.project}
        sourceUnavailable={isHistoryOnlySession({ cwdState: sessionWorktrees.inventory?.worktrees.find(entry => entry.path === (sessionFilter?.cwd ?? selectedCwd))?.state
          ?? allSessions.find(session => session.cwd === (sessionFilter?.cwd ?? selectedCwd))?.cwdState })}
        onClose={() => setBulkMoveRequest(null)} onSettled={async (movedIds, failedIds, invalidatedIds, destinationCwd) => {
          // Unknown effects must invalidate a possibly stale chat, separately
          // from acknowledged/observed moved-result accounting.
          if (selectedSessionIdRef.current && [...movedIds, ...invalidatedIds].includes(selectedSessionIdRef.current)) {
            const confirmedDestination = movedIds.includes(selectedSessionIdRef.current) ? destinationCwd : undefined;
            if (confirmedDestination) setSelectedCwd(confirmedDestination);
            // This settlement owns the awaited refresh below; avoid racing it
            // against a parent-triggered catalogue refresh.
            onSessionDeleted?.(selectedSessionIdRef.current, confirmedDestination ?? null, false);
          }
          if (failedIds === null) setBulkError(t("sessionWorktrees.unknownOutcome"));
          else if (failedIds.length) {
            setBulkSelectedIds(new Set(failedIds));
            setBulkError(t("sidebar.bulkFailed", { count: failedIds.length, succeeded: movedIds.length }));
          } else exitBulkMode();
          const refreshed = await loadSessions(false, true);
          sessionWorktrees.refresh();
          if (!refreshed) throw new Error("Session list refresh failed");
        }} />}
      {movingSession && (
        <div role="presentation" onClick={() => { if (!moveBusy) setMovingSession(null); }} style={{ position: "fixed", inset: 0, zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)" }}>
          <div role="dialog" aria-modal="true" aria-label={t("sidebar.moveSession")} onClick={(event) => event.stopPropagation()} style={{ width: 440, maxWidth: "calc(100vw - 24px)", background: "var(--bg)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 10, padding: 20, display: "grid", gap: 12 }}>
            <strong>{t("sidebar.moveSession")}</strong>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{t("sidebar.moveSessionHint")}</div>
            <SessionMoveDestinationPicker projects={recentProjects} currentProject={movingSession.projectRoot ?? movingSession.cwd} currentCwd={movingSession.cwd} sourceUnavailable={isHistoryOnlySession(movingSession)} destination={moveDestination} onChange={proposeMoveDestination} disabled={moveBusy} />
            {moveDestination && <div style={{ fontSize: 11, overflowWrap: "anywhere" }}>{moveDestination}</div>}
            {moveBusy && <SessionMoveStatus>{t("sidebar.moving")}</SessionMoveStatus>}
            {moveError && <div role="alert" style={{ color: "#ef4444", fontSize: 12 }}>{moveError}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" disabled={moveBusy} onClick={() => setMovingSession(null)}>{t("sidebar.cancel")}</button>
              <button type="button" disabled={moveBusy || !moveDestination} onClick={() => void confirmMove()}>{t("sidebar.move")}</button>
            </div>
          </div>
        </div>
      )}
      {customPathOpen && (
        <DirectoryPicker
          initialPath={customPathValue}
          busy={customPathValidating}
          error={customPathError}
          onCancel={() => {
            setCustomPathOpen(false);
            setCustomPathError(null);
          }}
          onSelect={(path) => void commitCustomPath(path)}
        />
      )}
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <PiWebTitle />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleNewSession}
              disabled={!selectedCwd || directoryUnavailable}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: selectedCwd ? "var(--text-muted)" : "var(--text-dim)",
                cursor: selectedCwd ? "pointer" : "not-allowed",
                height: 32,
                paddingLeft: 10,
                paddingRight: 12,
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
             title={selectedCwd ? t("sidebar.newSessionTitle", { path: selectedCwd }) : t("sidebar.selectProject")}
              onMouseEnter={(e) => {
                if (!selectedCwd) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
              {t("sidebar.new")}
            </button>
            <button
              type="button"
              onClick={() => {
                setSessionSearchOpen((open) => !open);
                setSearchAllProjects(false);
                setSearchBothStatuses(false);
                setSearchTitlesOnly(false);
                setWtDropdownOpen(false);
              }}
              title={t("sidebar.toggleSessionSearch")}
              aria-label={t("sidebar.toggleSessionSearch")}
              aria-expanded={sessionSearchOpen}
              aria-controls="session-search-input"
              className={`flex h-[32px] w-[32px] shrink-0 cursor-pointer items-center justify-center rounded-[7px] border border-border hover:bg-bg-selected focus-visible:outline-2 focus-visible:outline-accent ${sessionSearchOpen ? "bg-bg-selected text-accent" : "bg-bg-hover text-text-muted"}`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* CWD picker */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            title={selectedProject?.root ?? selectedCwd ?? ""}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
              border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            {selectedCwd ? (
              <PathLabel
                text={displayCwd(selectedProject?.root ?? selectedCwd, homeDir)}
                style={{
                  flex: 1,
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text)",
                }}
              />
            ) : (
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--text-dim)",
                }}
              >
                 {initialSessionId && !restoredRef.current ? "" : t("sidebar.selectProject")}
              </span>
            )}
            {hasOtherWorkspaceActivity && (
              <span
                title={t("sidebar.newActivity")}
                aria-label={t("sidebar.newActivity")}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  flexShrink: 0,
                  marginLeft: 6,
                  background: "var(--accent)",
                }}
              />
            )}
          </button>

          <AnimatedDropdown
            open={dropdownOpen}
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              right: 0,
              zIndex: 100,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
              overflow: "hidden",
            }}
          >
              {showProjectFilter && (
                <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <input
                    value={projectFilter}
                    onChange={(e) => setProjectFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setProjectFilter("");
                        setDropdownOpen(false);
                      }
                    }}
                     placeholder={t("sidebar.filterProjects")}
                    autoFocus
                    style={{
                      width: "100%",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      padding: "5px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      outline: "none",
                      background: "var(--bg)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                </div>
              )}
              <div style={{ maxHeight: "min(50vh, 380px)", overflowY: "auto" }}>
                {visibleProjects.map((project) => {
                  const isStarred = starredProjectKeys.has(project.key);
                  const starLabel = t(isStarred ? "sidebar.unstarProject" : "sidebar.starProject");
                  return (
                    <div key={project.key} style={{ display: "flex", alignItems: "stretch", borderBottom: "1px solid var(--border)" }}>
                      <button
                        onClick={() => {
                          setSelectedCwd(project.root);
                          setProjectFilter("");
                          setCustomPathOpen(false);
                          setCustomPathError(null);
                          setDropdownOpen(false);
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 7, flex: 1, minWidth: 0,
                          padding: "8px 6px 8px 10px", background: "var(--bg)", border: "none",
                          color: project.key === selectedProject?.key ? "var(--text)" : "var(--text-muted)",
                          cursor: "pointer", textAlign: "left", fontSize: 11, fontFamily: "var(--font-mono)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}
                        title={project.root}
                      >
                        {project.key === selectedProject?.key ? (
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                            <polyline points="1.5 5 4 7.5 8.5 2.5" />
                          </svg>
                        ) : <span style={{ width: 10, flexShrink: 0 }} />}
                        <PathLabel text={displayCwd(project.root, homeDir)} style={{ flex: 1 }} />
                        {showProjectActivity(projectActivity.get(project.key), t)}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleStarredProject(project.key)}
                        title={starLabel}
                        aria-label={starLabel}
                        aria-pressed={isStarred}
                        style={{ display: "grid", placeItems: "center", width: 32, flexShrink: 0, border: "none", background: "var(--bg)", color: isStarred ? "var(--accent)" : "var(--text-dim)", cursor: "pointer" }}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill={isStarred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
                          <path d="m8 1.7 1.9 4 4.4.6-3.2 3.1.8 4.4L8 11.7l-3.9 2.1.8-4.4L1.7 6.3l4.4-.6L8 1.7Z" />
                        </svg>
                      </button>
                    </div>
                  );
                })}
                {visibleProjects.length === 0 && projectFilter.trim() && (
                   <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingProjects")}</div>
                )}
              </div>

              {/* Default cwd shortcut */}
              {!customPathOpen && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderTop: visibleProjects.length > 0 ? "1px solid var(--border)" : "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                  </svg>
                   <span>{t("sidebar.useDefaultDirectory")}</span>
                </button>
              )}

              {/* Custom path directory picker */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCustomPathClick();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  width: "100%",
                  padding: "8px 10px",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: 11,
                }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                  <line x1="5" y1="1" x2="5" y2="9" />
                  <line x1="1" y1="5" x2="9" y2="5" />
                </svg>
                <span>{t("sidebar.customPath")}</span>
              </button>
          </AnimatedDropdown>
        </div>

        {sessionSearchOpen && (
          <div className="mt-[6px] flex flex-col gap-1">
            <input
              id="session-search-input"
              type="search"
              autoFocus
              value={sessionSearchQuery}
              maxLength={200}
              aria-label={t("sidebar.searchSessions")}
              placeholder={t("sidebar.searchSessions")}
              onChange={(event) => setSessionSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setSessionSearchQuery("");
                }
              }}
              className="block h-[29px] w-full min-w-0 rounded-[7px] border border-border bg-bg px-[10px] text-xs text-text focus:outline-2 focus:outline-accent"
            />
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                <input type="checkbox" checked={searchTitlesOnly} onChange={(event) => setSearchTitlesOnly(event.target.checked)} className="accent-accent" />
                {t("sidebar.searchTitlesOnly")}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                <input type="checkbox" checked={searchAllProjects} onChange={(event) => setSearchAllProjects(event.target.checked)} className="accent-accent" />
                {t("sidebar.searchAllProjects")}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted">
                <input type="checkbox" checked={searchBothStatuses} onChange={(event) => setSearchBothStatuses(event.target.checked)} className="accent-accent" />
                {t("sidebar.searchBothStatuses")}
              </label>
            </div>
          </div>
        )}

        {/* Worktree switcher — shown only for git projects at a checkout top
            level (repo subdirs keep their own project identity, so switching
            from them would jump projects). Rendered whenever the selected cwd
            belongs to the loaded project (not just when forCwd matches), so
            switching between worktrees of one project keeps the row mounted
            instead of flickering while data refetches: all worktrees of a
            project share the same list anyway. */}
        {!sessionSearchOpen && showWorktreeSwitcher && (() => {
          if (!worktreeState) return null;
          const showWtFilter = worktreeState.worktrees.length >= 8;
          const visibleWorktrees = showWtFilter && wtFilter.trim()
            ? worktreeState.worktrees.filter((w) =>
                (w.branch ?? displayCwd(w.path, homeDir)).toLowerCase().includes(wtFilter.trim().toLowerCase()))
            : worktreeState.worktrees;
          return (
            <div ref={wtDropdownRef} style={{ position: "relative", marginTop: 6 }}>
              <button
                onClick={() => setWtDropdownOpen((v) => !v)}
                 title={currentWorktree ? t("sidebar.switchWorktreeTitle", { path: currentWorktree.path }) : t("sidebar.switchWorktree")}
                style={{
                  width: "100%",
                  height: 29,
                  boxSizing: "border-box",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "0 10px",
                  background: "var(--bg-hover)",
                  border: "1px solid var(--border)",
                  borderRadius: 7,
                  cursor: "pointer",
                  fontSize: 11,
                  lineHeight: 1.35,
                  color: "var(--text-muted)",
                  textAlign: "left",
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, color: currentWorktree && !currentWorktree.isMain ? "var(--accent)" : "var(--text-dim)" }}>
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                <PathLabel
                  text={currentWorktree ? (currentWorktree.branch ?? displayCwd(currentWorktree.path, homeDir)) : "…"}
                  style={{ flex: 1, fontFamily: "var(--font-mono)", color: "var(--text)" }}
                />
                {currentWorktree?.isMerged && <MergedWorktreeIcon label={t("sidebar.mergedIntoMain")} />}
                {currentWorktree?.isMain && (
                   <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>
                )}
                {worktreeState.worktrees.length > 1 && (
                  <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>
                    {worktreeState.worktrees.length}
                  </span>
                )}
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <polyline points="2 3.5 5 6.5 8 3.5" />
                </svg>
              </button>

              <AnimatedDropdown
                open={wtDropdownOpen}
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  zIndex: 100,
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                  overflow: "hidden",
                }}
              >
                  {showWtFilter && (
                    <div style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                      <input
                        value={wtFilter}
                        onChange={(e) => setWtFilter(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            setWtFilter("");
                            setWtDropdownOpen(false);
                          }
                        }}
                        placeholder={t("sidebar.filterWorktrees")}
                        autoFocus
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--border)",
                          borderRadius: 5,
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />
                    </div>
                  )}
                  <div style={{ maxHeight: "min(40vh, 300px)", overflowY: "auto" }}>
                    {visibleWorktrees.map((wt) => {
                      const isCurrent = wt.path === currentWorktreePath;
                      if (wtPendingRemove === wt.path) {
                        return <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}>
                          <span style={{ flex: 1, fontSize: 11, color: "var(--text)" }}>{t("sidebar.confirmRemoveCheckout")}</span>
                          <button type="button" disabled={wtBusy} onClick={() => void handleRemoveWorktree(wt.path, false)}
                            style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>
                            {t("sidebar.removeCheckout")}
                          </button>
                          <button type="button" onClick={() => setWtPendingRemove(null)}
                            style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>
                            {t("sidebar.cancel")}
                          </button>
                        </div>;
                      }
                      if (wtConfirmRemove === wt.path) {
                        return (
                          <div key={wt.path} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid var(--border)", background: "rgba(239,68,68,0.06)" }}>
                            <span style={{ flex: 1, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {t("sidebar.forceRemoveCheckout")}
                            </span>
                            <button
                              onClick={() => void handleRemoveWorktree(wt.path, true)}
                              disabled={wtBusy}
                              style={{ padding: "3px 9px", background: "#ef4444", border: "none", borderRadius: 5, color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("sidebar.force")}
                            </button>
                            <button
                              onClick={() => setWtConfirmRemove(null)}
                              style={{ padding: "3px 9px", background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
                            >
                              {t("sidebar.cancel")}
                            </button>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={wt.path}
                          className="wt-row"
                          style={{ display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)" }}
                        >
                          <button
                            onClick={() => {
                              setSelectedCwd(wt.path);
                              setWtDropdownOpen(false);
                              setWtError(null);
                              setWtFilter("");
                            }}
                            title={wt.path}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 7,
                              padding: "8px 10px",
                              background: "var(--bg)",
                              border: "none",
                              color: isCurrent ? "var(--text)" : "var(--text-muted)",
                              cursor: "pointer",
                              textAlign: "left",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                            }}
                          >
                            {isCurrent ? (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                                <polyline points="1.5 5 4 7.5 8.5 2.5" />
                              </svg>
                            ) : (
                              <span style={{ width: 10, flexShrink: 0 }} />
                            )}
                            <PathLabel text={wt.branch ?? displayCwd(wt.path, homeDir)} style={{ flex: 1 }} />
                            {wt.isMerged && <MergedWorktreeIcon label={t("sidebar.mergedIntoMain")} />}
                            {wt.isMain && <span style={{ flexShrink: 0, color: "var(--text-dim)", fontSize: 10 }}>{t("sidebar.main")}</span>}
                          </button>
                          {!wt.isMain && (
                            <button
                              onClick={() => { setWtConfirmRemove(null); setWtPendingRemove(wt.path); }}
                              disabled={wtBusy}
                               title={t("sidebar.removeWorktreeTitle", { path: wt.path })}
                              style={{
                                display: "flex", alignItems: "center", justifyContent: "center",
                                width: 34, height: 28, padding: 0, marginRight: 4,
                                background: "none", border: "none",
                                color: "var(--text-dim)", cursor: "pointer",
                                borderRadius: 5, flexShrink: 0,
                                transition: "color 0.12s, background 0.12s",
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                                <path d="M10 11v6M14 11v6" />
                                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {showWtFilter && visibleWorktrees.length === 0 && wtFilter.trim() && (
                      <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)" }}>{t("sidebar.noMatchingWorktrees")}</div>
                    )}
                  </div>

                  {sessionWorktrees.inventory?.worktrees.filter(entry => entry.state !== "present").map(entry => (
                    <button type="button" key={`history:${entry.path}`} title={entry.path}
                      onClick={() => { chooseSessionWorktree(entry.path); setWtDropdownOpen(false); }}
                      className="block w-full border-t border-border px-3 py-2 text-left text-xs text-text-muted">
                      <span aria-hidden="true">⚠ </span>{entry.branch ?? displayCwd(entry.path, homeDir)} · {t(entry.state === "missing" ? "sessionWorktrees.missing" : "sessionWorktrees.unavailable")}
                    </button>
                  ))}
                  <button type="button" onClick={() => { setManagerProject(worktreeState.projectKey); setWtDropdownOpen(false); }}
                    style={{ width: "100%", padding: "9px 10px", textAlign: "left", fontSize: 11, color: "var(--text-muted)", background: "none", border: "none", borderTop: "1px solid var(--border)", cursor: "pointer" }}>
                    {t("manager.open")}
                  </button>
                  {!wtNewOpen ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setWtNewOpen(true);
                        setWtError(null);
                        setTimeout(() => wtNewInputRef.current?.focus(), 0);
                      }}
                      title={t("sidebar.createWorktreeTitle")}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        width: "100%",
                        padding: "8px 10px",
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 11,
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                        <line x1="5" y1="1" x2="5" y2="9" />
                        <line x1="1" y1="5" x2="9" y2="5" />
                      </svg>
                       <span>{t("sidebar.newWorktree")}</span>
                    </button>
                  ) : (
                    <div style={{ padding: "6px 8px" }}>
                      <button type="button" disabled={wtBusy} onClick={() => {
                        setWtBase(null);
                        setWtAttach(null);
                        setWtError(null);
                        setWtRefreshKey((key) => key + 1);
                      }} style={{ float: "right", fontSize: 10, color: "var(--text-muted)", background: "none", border: "none", cursor: "pointer" }}>
                        Refresh local branches
                      </button>
                      <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                        Local base branch (required)
                        <select
                          aria-label="Local base branch"
                          value={wtBase?.projectRoot === worktreeState?.projectRoot ? wtBase.branch : ""}
                          onChange={(e) => {
                            const tip = worktreeState?.localBranches.find((item) => item.branch === e.target.value);
                            setWtBase(tip && worktreeState ? { ...tip, projectRoot: worktreeState.projectRoot } : null);
                            setWtError(null);
                          }}
                          style={{ display: "block", width: "100%", marginTop: 4, fontSize: 11, fontFamily: "var(--font-mono)" }}
                        >
                          <option value="">Select a local base…</option>
                          {worktreeState?.localBranches.map((tip) => <option key={tip.branch} value={tip.branch}>{tip.branch} · {tip.oid}</option>)}
                        </select>
                      </label>
                      <div style={{ fontSize: 10, color: "var(--text-dim)", overflowWrap: "anywhere", margin: "5px 0" }}>
                        Expected base HEAD: {wtBase?.projectRoot === worktreeState?.projectRoot ? wtBase.oid : "Select a local base branch"}
                      </div>
                      <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                        Action
                        <select aria-label="Worktree action" value={wtMode} onChange={(e) => {
                          setWtMode(e.target.value as "create" | "attach");
                          setWtError(null);
                        }} style={{ display: "block", width: "100%", margin: "4px 0", fontSize: 11 }}>
                          <option value="create">Create new branch</option>
                          <option value="attach">Attach existing local branch</option>
                        </select>
                      </label>
                      {wtMode === "attach" ? (
                        <label style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                          Existing local branch
                          <select aria-label="Branch to attach" value={wtAttach?.projectRoot === worktreeState?.projectRoot ? wtAttach.branch : ""}
                            onChange={(e) => {
                              const tip = worktreeState?.localBranches.find((item) => item.branch === e.target.value);
                              setWtAttach(tip && worktreeState ? { ...tip, projectRoot: worktreeState.projectRoot } : null);
                              setWtError(null);
                            }} style={{ display: "block", width: "100%", marginTop: 4, fontSize: 11, fontFamily: "var(--font-mono)" }}>
                            <option value="">Select an existing branch…</option>
                            {worktreeState?.localBranches.map((tip) => (
                              <option key={tip.branch} value={tip.branch} disabled={worktreeState.worktrees.some((wt) => wt.branch === tip.branch)}>
                                {tip.branch} · {tip.oid}{worktreeState.worktrees.some((wt) => wt.branch === tip.branch) ? " (already checked out)" : ""}
                              </option>
                            ))}
                          </select>
                          <span style={{ display: "block", fontSize: 10, overflowWrap: "anywhere", marginTop: 5 }}>
                            Expected branch tip: {wtAttach?.projectRoot === worktreeState?.projectRoot ? wtAttach.oid : "Select a local branch"}
                          </span>
                        </label>
                      ) : <input
                        ref={wtNewInputRef}
                        value={wtNewBranch}
                        onChange={(e) => {
                          setWtNewBranch(e.target.value);
                          setWtError(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleCreateWorktree();
                          }
                          if (e.key === "Escape") {
                            setWtNewOpen(false);
                            setWtNewBranch("");
                            setWtError(null);
                          }
                        }}
                         placeholder={t("sidebar.branchName")}
                        style={{
                          width: "100%",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                          padding: "5px 8px",
                          border: "1px solid var(--accent)",
                          borderRadius: 5,
                          outline: "none",
                          background: "var(--bg)",
                          color: "var(--text)",
                          boxSizing: "border-box",
                        }}
                      />}
                      <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                        <button
                          onClick={() => void handleCreateWorktree()}
                          disabled={wtBusy || !wtBase || wtBase.projectRoot !== worktreeState?.projectRoot || (wtMode === "create" ? !wtNewBranch.trim() : !wtAttach || wtAttach.projectRoot !== worktreeState?.projectRoot)}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--accent)",
                            border: "none",
                            borderRadius: 5,
                            color: "var(--accent-contrast)",
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: wtBusy || !wtBase || (wtMode === "create" ? !wtNewBranch.trim() : !wtAttach) ? "not-allowed" : "pointer",
                            opacity: wtBusy || !wtBase || (wtMode === "create" ? !wtNewBranch.trim() : !wtAttach) ? 0.65 : 1,
                          }}
                        >
                           {wtBusy ? t("sidebar.creating") : t("sidebar.create")}
                        </button>
                        <button
                          onClick={() => { setWtNewOpen(false); setWtNewBranch(""); setWtBase(null); setWtAttach(null); setWtError(null); }}
                          style={{
                            flex: 1,
                            padding: "4px 0",
                            background: "var(--bg-hover)",
                            border: "1px solid var(--border)",
                            borderRadius: 5,
                            color: "var(--text-muted)",
                            fontSize: 11,
                            cursor: "pointer",
                          }}
                        >
                           {t("sidebar.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  {wtError && (
                    <div style={{
                      padding: "5px 10px 8px",
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {wtError}
                    </div>
                  )}
              </AnimatedDropdown>
            </div>
          );
        })()}
        {!sessionSearchOpen && inactiveWorktreeSelector && (
          <button
            type="button"
            aria-disabled="true"
            tabIndex={-1}
            title={inactiveWorktreeSelector.title}
            style={{
              width: "100%",
              height: 29,
              boxSizing: "border-box",
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 10px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-hover)",
              color: "var(--text-dim)",
              fontSize: 11,
              lineHeight: 1.35,
              whiteSpace: "nowrap",
              textAlign: "left",
              cursor: "default",
              opacity: 0.82,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{inactiveWorktreeSelector.label}</span>
          </button>
        )}
      </div>

      {/* Session list */}
      <div
        ref={sessionPaneRef}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: explorerOpen && (selectedCwdProp || selectedCwd)
            ? "0 1 var(--sidebar-session-pane-height, 320px)"
            : "1 1 auto",
          minHeight: SESSION_PANE_MIN_HEIGHT,
          overflow: "hidden",
        }}
      >
        {selectedProject && <div className="flex items-center gap-1 border-b border-border px-3 py-1.5 text-xs">
          <label htmlFor="session-worktree-filter" className="sr-only">{t("sessionWorktrees.filterLabel")}</label>
          <select id="session-worktree-filter" aria-label={t("sessionWorktrees.filterLabel")} value={sessionWorktreeCwd ?? ""}
            disabled={bulkBusy} onChange={event => chooseSessionWorktree(event.target.value)}
            className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-text" title={sessionWorktreeCwd ?? t("sessionWorktrees.all")}>
            <option value="">{t("sessionWorktrees.all")}</option>
            {sessionWorktreeCwd && !sessionWorktrees.inventory?.worktrees.some(entry => entry.path === sessionWorktreeCwd)
              && <option value={sessionWorktreeCwd}>{sessionWorktreeCwd}</option>}
            {sessionWorktrees.inventory?.worktrees.map(entry => <option key={entry.path} value={entry.path}>
              {entry.state !== "present" ? "⚠ " : ""}{entry.branch ?? displayCwd(entry.path, homeDir)}{entry.isMain ? ` · ${t("sidebar.main")}` : ""}
              {entry.state !== "present" ? ` · ${t(entry.state === "missing" ? "sessionWorktrees.missing" : "sessionWorktrees.unavailable")}` : ""} ({entry.sessionCount})
            </option>)}
          </select>
          <button type="button" title={sessionWorktrees.error ?? t("sessionWorktrees.refresh")} aria-label={t("sessionWorktrees.refresh")}
            onClick={sessionWorktrees.refresh} className="rounded px-2 py-1 text-text-muted">↻</button>
          <details className="relative shrink-0">
            <summary aria-label={t("sessionWorktrees.actions")} className="cursor-pointer list-none rounded px-2 py-1">⋯</summary>
            <div className="absolute right-0 z-30 w-64 rounded border border-border bg-bg p-2 shadow-lg">
              <button type="button" disabled={bulkBusy || !sessionWorktrees.inventory?.mainCwd
                || !sessionWorktrees.inventory.worktrees.some(entry => entry.state === "missing" && entry.sessionCount > 0)}
                onClick={event => { event.currentTarget.closest("details")?.removeAttribute("open"); setBulkMoveRequest({ project: selectedProject.root, missingOnly: true }); }}
                className="w-full rounded px-2 py-2 text-left disabled:opacity-50">{t("sessionWorktrees.recoverAction")}</button>
            </div>
          </details>
        </div>}
        {sessionWorktrees.error && <p role="alert" className="px-3 text-xs text-red-500">{sessionWorktrees.error}</p>}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "4px 10px", gap: 8 }}>
          {!sessionSearchActive && selectedProject && (
            <button type="button" disabled={bulkBusy} onClick={() => {
              if (bulkSelecting) exitBulkMode();
              else { setBulkSelectedIds(new Set()); setBulkError(null); setBulkModeScope(bulkScope); }
            }} style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, padding: "4px 6px" }}>
              {t(bulkSelecting ? "sidebar.bulkDone" : "sidebar.bulkSelect")}
            </button>
          )}
          <button
            type="button"
            disabled={bulkBusy}
            onClick={() => setShowArchived((value) => !value)}
            aria-pressed={showArchived}
            style={{ border: "none", background: "transparent", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, padding: "4px 6px" }}
          >
            {showArchived ? t("sidebar.activeSessions") : t("sidebar.archivedSessions")}
          </button>
        </div>
        {bulkSelecting && (
          <div style={{ padding: "4px 12px 8px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--text-muted)" }}>
            <button type="button" className={BULK_BUTTON_CLASS} disabled={bulkBusy || selectableFamilyIds.length === 0} onClick={() => {
              setBulkSelectedIds(selectedFamilyIds.size === selectableFamilyIds.length
                ? new Set() : new Set(selectableFamilyIds));
              setBulkConfirmDelete(false);
              setBulkError(null);
            }}>{t(selectedFamilyIds.size === selectableFamilyIds.length && selectableFamilyIds.length > 0 ? "sidebar.bulkClear" : "sidebar.bulkSelectAll")}</button>
            <span role="status">{bulkBusy
              ? t("sidebar.bulkProgress", { done: bulkCompleted, count: selectedFamilyIds.size })
              : t("sidebar.bulkSelected", { count: selectedFamilyIds.size })}</span>
            {!bulkConfirmDelete && (
              <>
                <button type="button" className={BULK_BUTTON_CLASS} disabled={bulkBusy || selectedFamilyIds.size === 0 || bulkArchiveBlocked}
                  title={bulkArchiveBlocked ? t("sessionWorktrees.archiveParent") : undefined} onClick={() => void performBulkAction(showArchived ? "restore" : "archive")}>
                  {t(showArchived ? "sidebar.restore" : "sidebar.archive")}
                </button>
                <button type="button" className={BULK_BUTTON_CLASS} disabled={bulkBusy || selectedFamilyIds.size === 0}
                  onClick={() => setBulkMoveRequest({ project: selectedProject!.root, ids: [...selectedFamilyIds], missingOnly: false })}>{t("sessionWorktrees.moveAction")}</button>
                <button type="button" className={BULK_BUTTON_CLASS} disabled={bulkBusy || selectedFamilyIds.size === 0} onClick={() => setBulkConfirmDelete(true)}>{t("sidebar.delete")}</button>
              </>
            )}
            {bulkConfirmDelete && (
              <>
                <span>{t("sidebar.bulkDeleteConfirm", { count: selectedFamilyIds.size })}</span>
                <button type="button" className={BULK_BUTTON_CLASS} disabled={bulkBusy} onClick={() => void performBulkAction("delete")} style={{ color: "#ef4444" }}>{t("sidebar.delete")}</button>
                <button type="button" className={BULK_BUTTON_CLASS} onClick={() => setBulkConfirmDelete(false)}>{t("sidebar.cancel")}</button>
              </>
            )}
            {bulkError && <div role="alert" style={{ width: "100%", color: "#ef4444" }}>{bulkError}</div>}
          </div>
        )}
      <SessionSearch open={sessionSearchOpen} query={sessionSearchQuery} worktreeCwd={sessionWorktreeCwd} projectKey={searchAllProjects ? null : selectedProject?.key ?? null} allProjects={searchAllProjects} titlesOnly={searchTitlesOnly} status={searchBothStatuses ? "both" : showArchived ? "archived" : "active"} selectedSessionId={selectedSessionId} onSelectSession={handleSelectSessionFromList}>
        <div
          ref={listScrollRef}
          onScroll={handleListScroll}
          className="scrollbar-subtle"
          style={{
            flex: "1 1 auto",
            minHeight: 0,
            overflowY: "auto",
            padding: "0",
          }}
        >
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.loading")}
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && sessionFamilies.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            {t("sidebar.noSessions")}
          </div>
        )}
        {sessionFamilies.length > 0 && (
          <div
            style={{
              position: "relative",
              height: sessionFamilies.length * SESSION_LIST_ITEM_HEIGHT,
            }}
          >
            {virtualIndices.map((index) => {
              const family = sessionFamilies[index];
              const familySessions = [family.root, ...family.subagents];
              const displaySession = family.latestModified === family.root.modified
                ? family.root
                : { ...family.root, modified: family.latestModified };
              // Bubble blur after the input's save handler before unpinning the row.
              return (
                <div
                  key={family.root.id}
                  onFocus={() => setFocusedSessionId(family.root.id)}
                  onBlur={() => setFocusedSessionId(null)}
                  style={{ position: "absolute", top: index * SESSION_LIST_ITEM_HEIGHT, left: 0, right: 0 }}
                >
                  <SessionItem
                    session={displaySession}
                    isSelected={bulkSelecting ? selectedFamilyIds.has(family.root.id) : familySessions.some((session) => session.id === selectedSessionId)}
                    bulkSelecting={bulkSelecting}
                    bulkSelected={selectedFamilyIds.has(family.root.id)}
                    bulkBusy={bulkBusy}
                    onToggleBulk={() => {
                      setBulkSelectedIds((current) => {
                        const next = new Set(current);
                        if (next.has(family.root.id)) next.delete(family.root.id);
                        else next.add(family.root.id);
                        return next;
                      });
                      setBulkConfirmDelete(false);
                      setBulkError(null);
                    }}
                    isRunning={familySessions.some((session) => runningSessionIds.has(session.id) || queuedSessionIds.has(session.id))}
                    isUnread={familySessions.some((session) => unreadSessionIds.has(session.id))}
                    isStarred={starredIds.has(family.root.id)}
                    onToggleStar={() => toggleStarred(family.root.id)}
                    onClick={() => handleSelectSessionFromList(family.root)}
                    onRenamed={loadSessions}
                    onMove={() => { setMovingSession(family.root); setMoveDestination(""); setMoveError(null); }}
                    archivedView={showArchived}
                    archiveDisabled={family.archiveOwnerId !== family.root.id}
                    onArchived={(id, archived) => {
                      // An older in-flight list response must not undo this action.
                      sessionLoadIdRef.current += 1;
                      setAllSessions((current) => updateSessionArchiveState(current, id, archived));
                      onSessionArchived?.(familySessions.some((item) => item.id === selectedSessionId) ? selectedSessionId! : id);
                      void loadSessions(false, true);
                    }}
                    onDeleted={(id) => {
                      onSessionDeleted?.(id);
                      loadSessions();
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
        </div>
        </SessionSearch>
      </div>

      {explorerOpen && (selectedCwdProp || selectedCwd) && (
        <div
          className={`sidebar-section-resize-handle${sessionPaneResizer.isResizing ? " is-resizing" : ""}`}
          data-resize-handle="sidebar-sections"
          title={`${t("layout.resizeSidebarSections")}: ${t("layout.resizeHeightHint")}`}
          style={{
            position: "relative",
            zIndex: 20,
            width: "100%",
            height: 12,
            margin: "-6px 0",
            flex: "0 0 12px",
            cursor: "row-resize",
            touchAction: "none",
          }}
          {...sessionPaneResizer.separatorProps}
        />
      )}

      {/* File Explorer section */}
      {directoryUnavailable && pendingReveal?.context === revealContext && <div role="status">{t("files.revealUnavailable")}</div>}
      {!directoryUnavailable && (selectedCwdProp || selectedCwd) && (
        <div
          ref={explorerSectionRef}
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: explorerOpen ? EXPLORER_PANE_MIN_HEIGHT : 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => {
                const next = !explorerOpen;
                if (!next) setPendingReveal(undefined);
                saveExplorerOpen(next);
                setExplorerOpen(next);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              {t("files.explorer")}
            </button>
            {onOpenTerminal && (
              <ToolbarIconButton
                onClick={() => onOpenTerminal(selectedCwd ?? selectedCwdProp!)}
                title={t("terminal.open")}
                color="var(--text-dim)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && changesCount > 0 && (
              <ToolbarIconButton
                onClick={() => setChangesCollapsed((v) => !v)}
                title={t("sidebar.changedFiles", { count: changesCount })}
                ariaPressed={!changesCollapsed}
                color={changesCollapsed ? "var(--text-dim)" : "var(--accent)"}
                background={changesCollapsed ? "none" : "var(--bg-selected)"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M3 12h6" />
                  <path d="M15 12h6" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => {
                  setFileSearchOpen((open) => !open);
                }}
                title={t("sidebar.searchFiles")}
                ariaPressed={fileSearchOpen}
                color={fileSearchOpen ? "var(--accent)" : "var(--text-dim)"}
                background={fileSearchOpen ? "var(--bg-selected)" : "none"}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
                </svg>
              </ToolbarIconButton>
            )}
            {explorerOpen && (
              <ToolbarIconButton
                onClick={() => fileExplorerRef.current?.openUploadPicker()}
                disabled={explorerUploadBusy}
                title={t("sidebar.uploadFilesTitle")}
                color="var(--text-dim)"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <path d="m17 8-5-5-5 5" />
                  <path d="M12 3v12" />
                </svg>
              </ToolbarIconButton>
            )}
            <ToolbarIconButton
              onClick={() => {
                if (onExplorerRefresh) onExplorerRefresh();
                else setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title={t("sidebar.refreshExplorer")}
              skipHover={explorerRefreshDone}
              color={explorerRefreshDone ? "#4ade80" : "var(--text-dim)"}
              background={explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none"}
              marginRight={6}
            >
              {explorerRefreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </ToolbarIconButton>
          </div>
          {explorerOpen && (
            <div ref={explorerScrollRef} data-explorer-scroll className="scrollbar-subtle" style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                key={JSON.stringify([selectedCwd ?? selectedCwdProp, selectedSessionId])}
                ref={fileExplorerRef}
                revealRequest={pendingReveal?.context === revealContext ? pendingReveal.request : undefined}
                onRevealSettled={handleRevealSettled}
                cwd={selectedCwd ?? selectedCwdProp!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
                onAtMentions={onAtMentions}
                onUploadBusyChange={setExplorerUploadBusy}
                changesCollapsed={changesCollapsed}
                onChangesCountChange={setChangesCount}
                fileSearchOpen={fileSearchOpen}
                onFileSearchOpenChange={setFileSearchOpen}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunningSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.agentRunning")}
      aria-label={t("sidebar.agentRunning")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "var(--accent)",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin" style={{ display: "block" }}>
        <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function UnreadSessionIndicator() {
  const { t } = useI18n();
  return (
    <span
      title={t("sidebar.newActivity")}
      aria-label={t("sidebar.newSessionActivity")}
      style={{
        width: 14,
        height: 14,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: "#0891b2",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" style={{ display: "block" }}>
        <circle cx="7" cy="7" r="2.5" fill="currentColor" />
        <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" opacity="0.16" className="unread-ping" />
      </svg>
    </span>
  );
}

/**
 * Compact per-project activity badges for the workspace selector dropdown items:
 * a spinning running icon + count and an unread dot + count. Renders nothing
 * when the project has no activity. Counts share the accent / unread colors of
 * the per-session indicators so the two stay visually consistent.
 */
function showProjectActivity(
  activity: { running: number; unread: number } | undefined,
  t: (key: string) => string,
): ReactNode {
  if (!activity || (activity.running === 0 && activity.unread === 0)) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, marginLeft: 6 }}>
      {activity.running > 0 && (
        <span
          title={t("sidebar.agentRunning")}
          aria-label={`${t("sidebar.agentRunning")} (${activity.running})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "var(--accent)", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="animate-spin" style={{ display: "block" }}>
            <path d="M21 12a9 9 0 1 1-3.8-7.4" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
          </svg>
          {activity.running}
        </span>
      )}
      {activity.unread > 0 && (
        <span
          title={t("sidebar.newSessionActivity")}
          aria-label={`${t("sidebar.newSessionActivity")} (${activity.unread})`}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#0891b2", fontSize: 10, fontFamily: "var(--font-mono)" }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
          {activity.unread}
        </span>
      )}
    </span>
  );
}

function SessionItem({
  session,
  isSelected,
  bulkSelecting = false,
  bulkSelected = false,
  bulkBusy = false,
  onToggleBulk,
  isRunning,
  isUnread,
  isStarred = false,
  onToggleStar,
  onClick,
  onRenamed,
  onMove,
  onDeleted,
  onArchived,
  archivedView = false,
  archiveDisabled = false,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  bulkSelecting?: boolean;
  bulkSelected?: boolean;
  bulkBusy?: boolean;
  onToggleBulk?: () => void;
  isRunning?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  onToggleStar?: () => void;
  onClick: () => void;
  onRenamed?: () => void;
  onMove?: () => void;
  onDeleted?: (id: string) => void;
  onArchived?: (id: string, archived: boolean) => void;
  archivedView?: boolean;
  archiveDisabled?: boolean;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { locale, t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const actionsToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionsOpen(false);
        actionsToggleRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsOpen]);

  // Select the whole name once the rename input is mounted (startRename's
  // immediate setTimeout can fire before the input exists).
  useEffect(() => {
    if (renaming) {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [renaming]);

  // A stored first message may be an SDK-expanded <skill> block; collapse it
  // back to the compact /skill:name args command the user typed before using
  // it as the auto-name fallback, mirroring MessageView's rendering.
  const displayFirstMessage = skillExpansionToCommand(session.firstMessage) ?? session.firstMessage;
  const title = session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.transient) return;
    setRenameValue(session.name || displayFirstMessage.slice(0, 50) || session.id.slice(0, 12));
    setActionsOpen(false);
    setRenaming(true);
  }, [session.name, session.transient, displayFirstMessage, session.id]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    // No-op when unchanged: the fallback title (first message / id) isn't a
    // real stored name, so don't persist it as one. (The rename input seeds
    // from the same collapsed displayFirstMessage, so an untouched rename of
    // a skill-invoked session stays a no-op instead of persisting raw XML.)
    if (renameValue === title || name === (session.name ?? "")) return;
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onRenamed?.();
    } catch (error) {
      setActionError(String(error));
    }
  }, [renameValue, session.id, session.name, onRenamed, title]);

  const performDelete = useCallback(async () => {
    if (session.transient) return;
    setConfirmDelete(false);
    setDeleting(true);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onDeleted?.(session.id);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setDeleting(false);
    }
  }, [session.id, session.transient, onDeleted]);

  const handleArchive = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (session.transient || archiveBusy || isRunning || archiveDisabled) return;
    setArchiveBusy(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archivedView }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onArchived?.(session.id, !archivedView);
    } catch (error) {
      setActionError(String(error));
    } finally {
      setArchiveBusy(false);
    }
  }, [session.id, session.transient, archiveBusy, isRunning, archiveDisabled, archivedView, onArchived]);

  const handleCopyLink = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setActionsOpen(false);
    try {
      await copyText(sessionDeepLink(window.location.origin, session.id));
      setActionError(null);
    } catch (error) {
      setActionError(String(error));
    }
  }, [session.id]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.shiftKey) {
      void performDelete();
    } else {
      setActionsOpen(false);
      setConfirmDelete(true);
    }
  }, [performDelete]);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    void performDelete();
  }, [performDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const handled = dispatchSessionRowContextMenu({
      id: session.id,
      path: session.path,
      cwd: session.cwd,
      name: session.name,
      clientX: e.clientX,
      clientY: e.clientY,
      refresh: () => { onRenamed?.(); },
    });
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
  }, [onRenamed, session.cwd, session.id, session.name, session.path]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  return (
    <div
      className="session-row"
      data-session-id={session.id}
      onClick={bulkSelecting ? (bulkBusy || session.transient ? undefined : onToggleBulk) : confirmDelete || renaming ? undefined : onClick}
      onContextMenu={bulkSelecting || confirmDelete || renaming ? undefined : handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      title={actionError ?? undefined}
      style={{
        height: SESSION_LIST_ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: bulkBusy || (bulkSelecting && session.transient) || confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteSession", { title: title.slice(0, 22) + (title.length > 22 ? "…" : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {t("sidebar.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("sidebar.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {bulkSelecting && (
            <input type="checkbox" checked={bulkSelected} disabled={bulkBusy || session.transient}
              aria-label={t("sidebar.bulkSelectSession", { title })}
              onClick={(event) => event.stopPropagation()}
              onChange={() => onToggleBulk?.()}
              style={{ flexShrink: 0, width: 16, height: 16, accentColor: "var(--accent)" }} />
          )}
          {/* Subagent indicator for child sessions */}
          {depth > 0 && <span style={{ display: "flex", color: "var(--accent)" }}><SubagentIcon size={11} /></span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                minWidth: 0,
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: 1.4,
                color: "var(--text)",
              }}
              title={title}
            >
              {isStarred && <span className="activity-star" aria-hidden="true">★</span>}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {title}
              </span>
            </div>
            <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 8, color: "var(--text-dim)", fontSize: 11, minWidth: 0 }}>
              {isRunning ? (
                <RunningSessionIndicator />
              ) : isUnread ? (
                <UnreadSessionIndicator />
              ) : (
                <span title={session.modified}>{formatRelativeTime(session.modified, locale)}</span>
              )}
              <span>
                {session.detailsPending ? "…" : t("sidebar.messagesCount", { count: session.messageCount })}
              </span>
              <SessionWorktreeBadge session={session} />
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={t(collapsed ? "sidebar.expandSubagents" : "sidebar.collapseSubagents")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Touch rows show one compact control; desktop rows reveal actions on hover. */}
          {!session.transient && !bulkSelecting && (
            <div ref={actionsRef} className="session-row-action-controls">
              <button
                ref={actionsToggleRef}
                className="session-row-actions-toggle"
                type="button"
                onClick={(e) => { e.stopPropagation(); setActionsOpen((open) => !open); }}
                aria-label={t("sidebar.sessionActions")}
                aria-expanded={actionsOpen}
                style={{ alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="19" cy="12" r="1.7" />
                </svg>
              </button>
              <div className="session-row-actions" data-open={actionsOpen}>
                <button
                  onClick={handleCopyLink}
                  title={t("sidebar.copySessionLink")}
                  aria-label={t("sidebar.copySessionLink")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-2 2" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l2-2" /></svg>
                </button>
                <button
                  onClick={(event) => { event.stopPropagation(); onToggleStar?.(); }}
                  title={t(isStarred ? "sidebar.unstarSession" : "sidebar.starSession")}
                  aria-label={t(isStarred ? "sidebar.unstarSession" : "sidebar.starSession")}
                  aria-pressed={isStarred}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, color: isStarred ? "#eab308" : "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={isStarred ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2" />
                  </svg>
                </button>
                <button
                  onClick={handleArchive}
                  disabled={archiveBusy || isRunning || archiveDisabled}
                  title={archiveDisabled ? t("sessionWorktrees.archiveParent") : isRunning ? t("sidebar.archiveRunning") : t(archivedView ? "sidebar.restore" : "sidebar.archive")}
                  aria-label={t(archivedView ? "sidebar.restore" : "sidebar.archive")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: isRunning ? "not-allowed" : "pointer", flexShrink: 0 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v12h14V8M10 12h4" />
                  </svg>
                </button>
                <button
                  onClick={startRename}
                  title={t("sidebar.rename")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, padding: 0,
                    background: "var(--bg-hover)", border: "1px solid var(--border)",
                    borderRadius: 7, color: "var(--text-muted)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "background 0.12s, color 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-selected)";
                    e.currentTarget.style.color = "var(--accent)";
                    e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-muted)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
                <button
                  onClick={(event) => { event.stopPropagation(); setActionsOpen(false); onMove?.(); }}
                  disabled={isRunning}
                  title={isRunning ? t("sidebar.moveRunning") : t("sidebar.moveSession")}
                  aria-label={t("sidebar.moveSession")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, background: "var(--bg-hover)", border: "1px solid var(--border)", borderRadius: 7, color: "var(--text-muted)", cursor: isRunning ? "not-allowed" : "pointer", flexShrink: 0 }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h14m-5-5 5 5-5 5M4 4v16" /></svg>
                </button>
                <button
                  onClick={handleDeleteClick}
                  title={t("sidebar.deleteWithShiftClick")}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, padding: 0,
                    background: "var(--bg-hover)", border: "1px solid var(--border)",
                    borderRadius: 7, color: "var(--text-muted)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "background 0.12s, color 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                    e.currentTarget.style.color = "#ef4444";
                    e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-muted)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
