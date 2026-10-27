"use client";

import { useState, useCallback, useRef, useEffect, useLayoutEffect, type Dispatch, type SetStateAction, type RefObject } from "react";
import { getInitialNavigation, withTabOpen } from "@/lib/initial-navigation";
import { clearTabOpenSession, getTabOpen, setTabOpenNewSession, setTabOpenSession } from "@/lib/tab-session";
import { rekeyDraft } from "@/lib/draft-store";
import { clearLastOpen, getLastOpenSession, setLastOpenSession, workspaceKeyOf } from "@/lib/workspace-memory";
import { requestFreshComposerFocus } from "@/lib/composer-focus";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ActivityStatus } from "@/lib/activity";
import type { ChatScrollPosition } from "@/lib/chat-scroll-position";
import type { ToolEntry } from "@/lib/tool-presets";
import { mergeCatalogRow } from "@/components/session-catalog-helpers";
import { useNavigationWork } from "@/lib/navigation-work";
import { readSessionCatalogueReply } from "@/lib/session-catalogue-wire";
import { sessionListUrl } from "@/lib/session-catalogue-loader";

function parkedNewSessionDraftKey(cwd: string): string { return `parked-new:${cwd}`; }

/** URL-only initial state; tab memory is adopted in the coordinator's layout effect. */
export function useNavigationState(searchParams: Parameters<typeof getInitialNavigation>[0]) {
  const [initialNavigation, setInitialNavigation] = useState(() => getInitialNavigation(searchParams));
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  const [sessionCatalog, setSessionCatalog] = useState<SessionInfo[]>([]);
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [newSessionDraftId, setNewSessionDraftId] = useState("initial");
  const [persistentNewSessionDraftId, setPersistentNewSessionDraftId] = useState<string | null>(null);
  const persistNewSession = newSessionCwd !== null && persistentNewSessionDraftId === newSessionDraftId;
  const activeNewSessionDraftKeyRef = useRef<string | null>(null);
  const [initialCwdStatus, setInitialCwdStatus] = useState<"idle" | "validating" | "ready" | "error">(
    () => initialNavigation.requestedCwd ? "validating" : "idle",
  );
  const [initialCwdError, setInitialCwdError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const sessionScrollPositionsRef = useRef(new Map<string, ChatScrollPosition>());
  const handleSessionScrollPositionChange = useCallback((sessionId: string, position: ChatScrollPosition) => {
    sessionScrollPositionsRef.current.set(sessionId, position);
  }, []);
  const [searchTarget, setSearchTarget] = useState<{ sessionId: string; entryId: string; blockIndex?: number } | null>(null);
  const handleSearchTargetHandled = useCallback((target: { sessionId: string; entryId: string }) => {
    setSearchTarget((current) => current === target ? null : current);
  }, [setSearchTarget]);
  const initialSessionId = initialNavigation.sessionId;
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const activeProjectKeyRef = useRef<string | null>(null);
  return { initialNavigation, setInitialNavigation, selectedSession, setSelectedSession, sessionCatalog, setSessionCatalog, newSessionCwd, setNewSessionCwd, newSessionDraftId, setNewSessionDraftId, persistentNewSessionDraftId, setPersistentNewSessionDraftId, persistNewSession, activeNewSessionDraftKeyRef, initialCwdStatus, setInitialCwdStatus, initialCwdError, setInitialCwdError, refreshKey, setRefreshKey, sessionKey, setSessionKey, sessionScrollPositionsRef, handleSessionScrollPositionChange, searchTarget, setSearchTarget, handleSearchTargetHandled, initialSessionId, activeCwd, setActiveCwd, activeProjectKeyRef };
}

export interface NavigationUi {
  router: { replace: (href: string, options: { scroll: boolean }) => void };
  isMobile: boolean;
  closeOverview: () => void;
  activeFileTabId: string | null;
  chatInputRef: RefObject<{ focus(): void } | null>;
  branchLeafChangeFnRef: RefObject<((leafId: string | null) => void) | null>;
  setChatHidden: Dispatch<SetStateAction<boolean>>;
  setBranchTree: Dispatch<SetStateAction<SessionTreeNode[]>>;
  setBranchActiveLeafId: Dispatch<SetStateAction<string | null>>;
  setSystemPrompt: Dispatch<SetStateAction<string | null>>;
  setSystemTools: Dispatch<SetStateAction<ToolEntry[] | null>>;
  setSystemInfoLoading: Dispatch<SetStateAction<boolean>>;
  setActiveTopPanel: Dispatch<SetStateAction<"agents" | "branches" | "system" | "tools" | "session" | null>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  setActiveFileTabId: Dispatch<SetStateAction<string | null>>;
  setOverviewMobileList: Dispatch<SetStateAction<boolean>>;
}

/** Per-shell navigation, not Activity observation or native cwd authority. */
export function useSessionNavigation(state: ReturnType<typeof useNavigationState>, ui: NavigationUi) {
  const { initialNavigation, setInitialNavigation, selectedSession, setSelectedSession, sessionCatalog, setSessionCatalog, newSessionCwd, setNewSessionCwd, newSessionDraftId, setNewSessionDraftId, setPersistentNewSessionDraftId, persistNewSession, activeNewSessionDraftKeyRef, setInitialCwdStatus, setInitialCwdError, setRefreshKey, setSessionKey, setSearchTarget, initialSessionId, activeCwd, setActiveCwd, activeProjectKeyRef } = state;
  const { router, isMobile, closeOverview, activeFileTabId, chatInputRef, branchLeafChangeFnRef, setChatHidden, setBranchTree, setBranchActiveLeafId, setSystemPrompt, setSystemTools, setSystemInfoLoading, setActiveTopPanel, setSidebarOpen, setRightPanelOpen, setActiveFileTabId, setOverviewMobileList } = ui;
  const work = useNavigationWork();
  const selectedSessionRef = useRef(selectedSession);
  selectedSessionRef.current = selectedSession;
  const handleSessionsChange = useCallback((sessions: SessionInfo[]) => {
    setSessionCatalog(sessions);
    // The sidebar hydrates metadata after the selected session has already
    // mounted. Merge that update into the active session without changing the
    // ChatWindow key or restarting its history load.
    setSelectedSession((current) => {
      if (!current) return current;
      const refreshed = sessions.find((session) => session.id === current.id);
      if (!refreshed) return current;
      return mergeCatalogRow(current, refreshed);
    });
  }, [setSelectedSession, setSessionCatalog]);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !initialSessionId);
  // sessionStorage is empty during SSR. Applying the tab's remembered session
  // in the useState initializer made the first client tree differ from the
  // server HTML (sidebar "select project" vs ""). Restore after mount instead.
  useLayoutEffect(() => {
    const next = withTabOpen(initialNavigation, getTabOpen());
    if (next === initialNavigation) return;
    setInitialNavigation(next);
    if (next.sessionId) setInitialSessionRestored(false);
  }, [initialNavigation, setInitialNavigation]);
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);
  // Guards the async workspace restore so a slow response from an earlier
  // switch cannot resurrect a session into a project the user already left.
  const workspaceRestoreTokenRef = useRef(0);

  const invalidateWorkspaceRestore = useCallback(() => {
    workspaceRestoreTokenRef.current += 1;
  }, []);

  // Persist every active-session transition, including new and forked sessions
  // that bypass the sidebar selection handler. Transient sessions do not yet
  // carry projectKey, so use the active project identity until hydration.
  // The workspace memory is shared by every tab; the tab memory keeps this
  // tab's own session so a reload does not follow another tab's last pick.
  // New session is a selection too: remember the composer cwd so reload stays
  // on that UI instead of resurrecting the previous chat.
  useEffect(() => {
    if (selectedSession) {
      const projectKey = selectedSession.projectKey
        ?? activeProjectKeyRef.current
        ?? workspaceKeyOf(selectedSession);
      setLastOpenSession(projectKey, selectedSession.id);
      setTabOpenSession(selectedSession.id);
      return;
    }
    if (newSessionCwd) setTabOpenNewSession(newSessionCwd, undefined, newSessionDraftId);
  }, [newSessionCwd, newSessionDraftId, selectedSession, activeProjectKeyRef]);

  useEffect(() => {
    const requestedCwd = initialNavigation.requestedCwd;
    if (!requestedCwd) return;

    const controller = new AbortController();
    setInitialCwdStatus("validating");
    setInitialCwdError(null);

    work.observe(fetch("/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: requestedCwd }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { cwd?: string; error?: string };
        if (!response.ok || !data.cwd) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }

        // The sidebar will notify us when it adopts this cwd. Avoid remounting
        // the just-created empty chat during that initial synchronization.
        suppressCwdBumpRef.current = true;
        // A reload can interrupt creation before its real ID reaches this tab.
        // Recover the same text key, but do not automatically replay creation.
        const tabOpen = getTabOpen();
        const draftId = tabOpen?.kind === "new" && tabOpen.cwd === data.cwd && tabOpen.draftId
          ? tabOpen.draftId : `initial:${requestedCwd}`;
        setNewSessionDraftId(draftId);
        activeNewSessionDraftKeyRef.current = `new:${draftId}:${data.cwd}`;
        setNewSessionCwd(data.cwd);
        setInitialCwdStatus("ready");
        if (!new URLSearchParams(window.location.search).get("cwd")) {
          router.replace(`?cwd=${encodeURIComponent(data.cwd)}`, { scroll: false });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialCwdError(error instanceof Error ? error.message : String(error));
        setInitialCwdStatus("error");
      }));

    return () => controller.abort();
  }, [initialNavigation, router, work, setNewSessionCwd, setNewSessionDraftId, setInitialCwdStatus, setInitialCwdError, activeNewSessionDraftKeyRef]);

  // Restore the workspace's last open session after switching to it. Called
  // from handleCwdChange once the outgoing context has been reset. The session
  // is looked up against the live list so a deleted or drifted session falls
  // back to the default welcome page instead of erroring.
  const restoreWorkspaceContext = useCallback((projectKey: string, cwd: string) => {
    const token = ++workspaceRestoreTokenRef.current;
    const lastOpenSessionId = getLastOpenSession(projectKey);
    if (!lastOpenSessionId) return;
    const adopt = (d: { sessions: SessionInfo[] } | null) => {
      if (token !== workspaceRestoreTokenRef.current) return; // stale switch
      const s = d?.sessions.find((x) => x.id === lastOpenSessionId);
      if (!s) {
        // The list loaded but the remembered session is gone — forget it.
        // When the list itself failed (d === null) keep the memory so a
        // later switch retries the restore.
        if (d) clearLastOpen(projectKey);
        return;
      }
      if (workspaceKeyOf(s) !== projectKey) {
        // Defensive: the remembered session drifted out of this workspace.
        clearLastOpen(projectKey);
        return;
      }
      // Keep the temporary composer's draft in its cwd, even when the
      // remembered session belongs to another worktree of this project.
      const activeDraftKey = activeNewSessionDraftKeyRef.current;
      if (activeDraftKey) {
        rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(cwd));
      }
      activeNewSessionDraftKeyRef.current = null;
      // Selecting the session must remount the chat with the session
      // present: useAgentSession loads content in a mount-only effect, so
      // the null-session welcome mount from the switch would never load
      // the restored session's messages.
      setSelectedSession(s);
      setSessionKey((k) => k + 1);
      if (new URLSearchParams(window.location.search).get("session") !== s.id) {
        router.replace(`?session=${encodeURIComponent(s.id)}`, { scroll: false });
      }
    };
    // Fast path: the sidebar already delivered the catalogue — restore
    // without waiting on a fresh /api/sessions round trip.
    if (sessionCatalog.length > 0) {
      adopt({ sessions: sessionCatalog });
      return;
    }
    work.observe(fetch(sessionListUrl(false, false))
      .then((r) => (r.ok ? readSessionCatalogueReply<{ sessions: SessionInfo[] }>(r) : null))
      .then(adopt)
      .catch(() => {
        // Network hiccup: keep the remembered session for a later retry.
      }));
  }, [router, sessionCatalog, work, setSelectedSession, setSessionKey, activeNewSessionDraftKeyRef]);

  const handleCwdChange = useCallback((
    cwd: string | null,
    projectRoot?: string | null,
    projectKey?: string | null,
  ) => {
    invalidateWorkspaceRestore();
    const currentFreshCwd = newSessionCwd ?? activeCwd;
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount).
    if (!cwd) return;
    const newProject = projectKey ?? projectRoot ?? cwd;
    const currentProject = activeProjectKeyRef.current
      ?? (selectedSession ? workspaceKeyOf(selectedSession) : null);
    activeProjectKeyRef.current = newProject;

    // Keep the project identity in sync during the initial URL restore without
    // remounting the just-created or restored chat.
    if (suppressCwdBumpRef.current) {
      suppressCwdBumpRef.current = false;
      return;
    }
    // The server may hydrate a normalized key after a custom cwd is already
    // active. Updating identity for the exact same cwd is not a user switch.
    if (currentFreshCwd === cwd && currentProject !== newProject) return;
    // Existing sessions stay open when the worktree selector moves within the
    // same project. A fresh composer must remount when its effective cwd moves,
    // otherwise its already-created runtime would keep sending to the old cwd.
    if (
      currentProject === newProject
      && (selectedSession !== null || currentFreshCwd === cwd)
    ) {
      return;
    }
    // Close any session that belongs to a different project — it no longer
    // matches the selected project directory.
    const previousDraftKey = activeNewSessionDraftKeyRef.current;
    // Explicit New owns a saved (or in-flight) session: keep its draft identity
    // for the creation response rather than moving it to a project placeholder.
    if (previousDraftKey && currentFreshCwd && !persistNewSession) {
      rekeyDraft(previousDraftKey, parkedNewSessionDraftKey(currentFreshCwd));
    }
    const draftId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const draftKey = `new:${draftId}:${cwd}`;
    rekeyDraft(parkedNewSessionDraftKey(cwd), draftKey);
    setNewSessionDraftId(draftId);
    activeNewSessionDraftKeyRef.current = draftKey;
    setSelectedSession(null);
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setActiveTopPanel(null);
    if (currentProject !== newProject) {
      // Park the previous file workspace without discarding its drafts.
      if (!activeFileTabId || activeFileTabId === "files") {
        setActiveFileTabId("files");
        setRightPanelOpen(false);
      }
      // Restore the workspace we switched to: its last open session, or keep
      // the default welcome page when none is remembered.
      restoreWorkspaceContext(newProject, cwd);
    }
    router.replace(typeof window !== "undefined" ? window.location.pathname : "/", { scroll: false });
  }, [activeCwd, activeFileTabId, invalidateWorkspaceRestore, newSessionCwd, persistNewSession, router, selectedSession, restoreWorkspaceContext, setSelectedSession, setNewSessionCwd, setNewSessionDraftId, setSessionKey, setBranchTree, setBranchActiveLeafId, setSystemPrompt, setSystemTools, setSystemInfoLoading, setActiveTopPanel, setRightPanelOpen, setActiveFileTabId, activeNewSessionDraftKeyRef, setActiveCwd, activeProjectKeyRef]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false, entryId?: string, blockIndex?: number) => {
    if (!isRestore) setChatHidden(false);
    setSearchTarget(entryId ? { sessionId: session.id, entryId, blockIndex } : null);
    // Ignore an older sidebar row for a just-moved session, even on re-click.
    invalidateWorkspaceRestore();
    const activeDraftKey = activeNewSessionDraftKeyRef.current;
    const activeDraftCwd = newSessionCwd ?? (selectedSession === null ? activeCwd : null);
    if (activeDraftKey && activeDraftCwd && !persistNewSession) {
      rekeyDraft(activeDraftKey, parkedNewSessionDraftKey(activeDraftCwd));
    }
    activeNewSessionDraftKeyRef.current = null;
    // Adopt an explicitly selected session before the sidebar reports its cwd.
    const projectKey = workspaceKeyOf(session);
    // Initial URL restoration is not a project switch. A terminal restored
    // from sessionStorage may not have reached this callback's render yet.
    if (activeProjectKeyRef.current !== projectKey && !(isRestore && activeProjectKeyRef.current === null)) {
      if (!activeFileTabId || activeFileTabId === "files") {
        setActiveFileTabId("files");
        setRightPanelOpen(false);
      }
      setActiveTopPanel(null);
    }
    activeProjectKeyRef.current = projectKey;
    // Re-clicking the already-open session must not remount the chat and
    // re-run the full load/positioning cycle. Only skip when the effective
    // cwd context already matches — otherwise a pending cwd move still needs
    // the full re-select flow.
    if (!isRestore && selectedSession) {
      const sameProject =
        workspaceKeyOf(selectedSession) === workspaceKeyOf(session);
      if (selectedSession.id === session.id && sameProject && selectedSession.cwd === session.cwd && selectedSession.cwdState === session.cwdState) {
        if (isMobile) setSidebarOpen(false);
        return;
      }
    }
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    branchLeafChangeFnRef.current = null;
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setInitialSessionRestored(true);
    // On mobile, collapse the overlay drawer so the chat is revealed after pick.
    if (isMobile && !isRestore) setSidebarOpen(false);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
    }
    // Skip router.replace when the URL already has this session — calling
    // replace in production Next.js triggers a Suspense remount loop.
    // Tab-memory restore lands on `/` and must write `?session=` so reload
    // and copy-link keep this session.
    if (!isRestore || new URLSearchParams(window.location.search).get("session") !== session.id) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [activeCwd, activeFileTabId, invalidateWorkspaceRestore, router, isMobile, newSessionCwd, persistNewSession, selectedSession, setSelectedSession, setNewSessionCwd, setSessionKey, setBranchTree, setBranchActiveLeafId, setSystemPrompt, setSystemTools, setSystemInfoLoading, setSidebarOpen, branchLeafChangeFnRef, activeNewSessionDraftKeyRef, setSearchTarget, activeProjectKeyRef, setChatHidden, setActiveTopPanel, setRightPanelOpen, setActiveFileTabId]);

  const handleNewSession = useCallback((sessionId: string, cwd: string) => {
    if (isMobile) closeOverview();
    setChatHidden(false);
    invalidateWorkspaceRestore();
    const draftKey = `new:${sessionId}:${cwd}`;
    setTabOpenNewSession(cwd, undefined, sessionId);
    rekeyDraft(parkedNewSessionDraftKey(cwd), draftKey);
    activeNewSessionDraftKeyRef.current = draftKey;
    setNewSessionDraftId(sessionId);
    setPersistentNewSessionDraftId(sessionId);
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setSystemTools(null);
    setSystemInfoLoading(false);
    setActiveTopPanel(null);
    if (isMobile) setSidebarOpen(false);
    router.replace(`?cwd=${encodeURIComponent(cwd)}`, { scroll: false });
    const focusRevision = workspaceRestoreTokenRef.current;
    requestFreshComposerFocus(chatInputRef, isMobile, () => (
      workspaceRestoreTokenRef.current === focusRevision
      && activeNewSessionDraftKeyRef.current === draftKey
    ));
  }, [closeOverview, invalidateWorkspaceRestore, router, isMobile, activeNewSessionDraftKeyRef, chatInputRef, setSelectedSession, setNewSessionCwd, setNewSessionDraftId, setPersistentNewSessionDraftId, setSessionKey, setChatHidden, setBranchTree, setBranchActiveLeafId, setSystemPrompt, setSystemTools, setSystemInfoLoading, setActiveTopPanel, setSidebarOpen]);

  const hydrateSelectedSession = useCallback((sessionId: string) => {
    work.observe(fetch(sessionListUrl(false, false), { cache: "no-store" })
      .then((r) => (r.ok ? readSessionCatalogueReply<{ sessions: SessionInfo[] }>(r) : null))
      .then((d) => {
        const full = d?.sessions.find((s) => s.id === sessionId);
        if (!full) return;
        setSelectedSession((prev) => (
          prev?.id === sessionId
            ? { ...prev, ...full, transient: full.transient ?? false }
            : prev
        ));
      })
      .catch(() => {}));
  }, [work, setSelectedSession]);

  const handleSessionSettled = useCallback(() => {
    setRefreshKey((key) => key + 1);
    if (selectedSession) hydrateSelectedSession(selectedSession.id);
  }, [hydrateSelectedSession, selectedSession, setRefreshKey]);

  const handleActivitySelectSession = useCallback((session: SessionInfo, status?: ActivityStatus) => {
    // Activity can discover a journal entry after this chat's initial load.
    // Re-selecting the same interrupted row must refresh its warning instead
    // of taking handleSelectSession's usual no-remount fast path.
    if (status === "interrupted" && selectedSession?.id === session.id) {
      setSessionKey((key) => key + 1);
    } else {
      handleSelectSession(session);
    }
    if (isMobile) setOverviewMobileList(false);
  }, [handleSelectSession, isMobile, selectedSession?.id, setSessionKey, setOverviewMobileList]);
  const handleSidebarSelectSession = useCallback((session: SessionInfo, isRestore?: boolean, entryId?: string, blockIndex?: number) => {
    // Background URL adoption may finish after the user opens an overview.
    // Only explicit sidebar navigation should close that newer reading surface.
    if (!isRestore) closeOverview();
    handleSelectSession(session, isRestore, entryId, blockIndex);
  }, [closeOverview, handleSelectSession]);

  const handleOpenSession = useCallback((sessionId: string) => work.observe((async () => {
    // Prefer the catalogue the sidebar already delivered: selecting from it
    // avoids a full detail round trip just to obtain the SessionInfo.
    const catalogued = sessionCatalog.find((s) => s.id === sessionId);
    // A completed isolated child may have lost its checkout since this catalogue row.
    if (catalogued && !catalogued.transient && catalogued.relation?.kind !== "subagent") {
      handleSelectSession(catalogued);
      return;
    }
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const data = await response.json() as { info?: SessionInfo; error?: string };
      if (!response.ok || !data.info) throw new Error(data.error ?? `HTTP ${response.status}`);
      handleSelectSession(data.info);
    } catch (error) {
      console.error("[brabbler] failed to open session:", error instanceof Error ? error.message : error);
    }
  })()), [handleSelectSession, sessionCatalog, work]);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo, sourceDraftKey: string) => {
    setRefreshKey((k) => k + 1);
    if (activeNewSessionDraftKeyRef.current !== sourceDraftKey) return;
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setNewSessionCwd(null);
    setSelectedSession(session);
    hydrateSelectedSession(session.id);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [invalidateWorkspaceRestore, router, hydrateSelectedSession, setSelectedSession, setNewSessionCwd, setRefreshKey, activeNewSessionDraftKeyRef]);

  const handleSessionForked = useCallback((newSessionId: string) => {
    invalidateWorkspaceRestore();
    activeNewSessionDraftKeyRef.current = null;
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
      transient: false,
    }));
    hydrateSelectedSession(newSessionId);
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [invalidateWorkspaceRestore, router, hydrateSelectedSession, setSelectedSession, setNewSessionCwd, setRefreshKey, setSessionKey, activeNewSessionDraftKeyRef]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionRestored = useCallback((rootId: string) => {
    setSessionCatalog((current) => current.map((session) => session.id === rootId ? { ...session, archived: false } : session));
    setSelectedSession((current) => current?.id === rootId ? { ...current, archived: false } : current);
    setRefreshKey((key) => key + 1);
  }, [setSelectedSession, setSessionCatalog, setRefreshKey]);

  const handleSessionDeleted = useCallback((sessionId: string, replacementCwd?: string | null, refreshCatalogue = true) => {
    invalidateWorkspaceRestore();
    if (refreshCatalogue) setRefreshKey((k) => k + 1);
    // Move/delete settlement can outlive the render that dispatched it. Canonical
    // metadata (or explicit navigation) may already have replaced that selection;
    // never restore the callback's captured source row or clear a newer session.
    const currentSession = selectedSessionRef.current;
    if (currentSession?.id === sessionId && replacementCwd === null) {
      // An uncertain move is not a deletion or a confirmed destination. Keep
      // history mounted read-only until canonical metadata/reselection rebinds
      // it; never create a working composer in a possibly vanished source.
      setSelectedSession((current) => current?.id === sessionId ? { ...current, cwdState: "unavailable" } : current);
      setSessionKey((k) => k + 1);
      return;
    }
    if (currentSession?.id === sessionId) {
      clearTabOpenSession(sessionId);
      const cwd = replacementCwd ?? currentSession.cwd;
      // A confirmed relocation must not create the replacement composer or
      // Files view in a vanished source directory.
      if (replacementCwd) {
        setActiveCwd(replacementCwd);
        activeProjectKeyRef.current = replacementCwd;
      }
      const draftId = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      setNewSessionDraftId(draftId);
      activeNewSessionDraftKeyRef.current = cwd ? `new:${draftId}:${cwd}` : null;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setSystemTools(null);
      setSystemInfoLoading(false);
      setActiveTopPanel(null);
      router.replace(cwd ? `?cwd=${encodeURIComponent(cwd)}` : (typeof window !== "undefined" ? window.location.pathname : "/"), { scroll: false });
    }
  }, [invalidateWorkspaceRestore, selectedSessionRef, router, setSelectedSession, setNewSessionCwd, setNewSessionDraftId, setSessionKey, setBranchTree, setBranchActiveLeafId, setSystemPrompt, setSystemTools, setSystemInfoLoading, setActiveTopPanel, activeNewSessionDraftKeyRef, setRefreshKey, setActiveCwd, activeProjectKeyRef]);

  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const newSessionDraftKey = selectedSession === null && effectiveNewSessionCwd
    ? `new:${newSessionDraftId}:${effectiveNewSessionCwd}`
    : null;
  useLayoutEffect(() => {
    activeNewSessionDraftKeyRef.current = newSessionDraftKey;
  }, [newSessionDraftKey, activeNewSessionDraftKeyRef]);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  return { handleSessionsChange, handleCwdChange, handleSelectSession, handleNewSession, hydrateSelectedSession, handleSessionSettled, handleActivitySelectSession, handleSidebarSelectSession, handleOpenSession, handleSessionCreated, handleSessionForked, handleInitialRestoreDone, handleSessionRestored, handleSessionDeleted, effectiveNewSessionCwd, newSessionDraftKey, showChat, initialSessionRestored };
}
