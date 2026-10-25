"use client";
import type { ComponentProps } from "react";
import { SessionSidebar } from "./SessionSidebar";
import type { useNavigationState, useSessionNavigation } from "@/hooks/useSessionNavigation";
type State = ReturnType<typeof useNavigationState>;
type Navigation = ReturnType<typeof useSessionNavigation>;
type Owned = "selectedSessionId" | "onSelectSession" | "onNewSession" | "initialSessionId" | "skipInitialProjectSelection" | "onInitialRestoreDone" | "refreshKey" | "onSessionDeleted" | "onSessionArchived" | "selectedCwd" | "selectedCwdState" | "onCwdChange" | "onSessionsChange";
/** The shell's default catalogue/navigation connection. No alternative state machine. */
export function SessionNavigationSidebar({ state, navigation, ...ports }: Omit<ComponentProps<typeof SessionSidebar>, Owned> & { state: State; navigation: Navigation }) {
  return <SessionSidebar {...ports}
    selectedSessionId={state.selectedSession?.id ?? null}
    onSelectSession={navigation.handleSidebarSelectSession}
    onNewSession={navigation.handleNewSession}
    initialSessionId={state.initialSessionId}
    skipInitialProjectSelection={state.initialNavigation.requestedCwd !== null}
    onInitialRestoreDone={navigation.handleInitialRestoreDone}
    refreshKey={state.refreshKey}
    onSessionDeleted={navigation.handleSessionDeleted}
    onSessionArchived={navigation.handleSessionDeleted}
    selectedCwd={state.selectedSession?.cwd ?? state.newSessionCwd ?? null}
    selectedCwdState={state.selectedSession?.cwdState}
    onCwdChange={navigation.handleCwdChange}
    onSessionsChange={navigation.handleSessionsChange} />;
}
