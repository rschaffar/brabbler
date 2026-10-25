"use client";
import { useActivityController } from "@/hooks/useActivityController";
import type { ActivityClientController } from "@/lib/activity-client-controller";
import type { useNavigationState, useSessionNavigation } from "@/hooks/useSessionNavigation";
/** Default shell inputs for the independently owned actual ChatWindow/hook. */
export function sessionNavigationChatBinding(state: ReturnType<typeof useNavigationState>, navigation: ReturnType<typeof useSessionNavigation>, runningIds: ReadonlySet<string>) {
  return {
    session: state.selectedSession,
    sessionRunning: Boolean(state.selectedSession && runningIds.has(state.selectedSession.id)),
    newSessionCwd: navigation.effectiveNewSessionCwd,
    newSessionDraftKey: navigation.newSessionDraftKey,
    persistNewSession: state.persistNewSession,
    onSessionCreated: navigation.handleSessionCreated,
    onSessionForked: navigation.handleSessionForked,
  };
}

/** Real default React bridge: controller publication, not a caller-fabricated
 * running boolean. ChatWindow retains all hook/SSE/native command ownership. */
export function useSessionNavigationChatBinding(state: Parameters<typeof sessionNavigationChatBinding>[0], navigation: Parameters<typeof sessionNavigationChatBinding>[1], controller: ActivityClientController) {
  const { snapshot } = useActivityController(controller);
  return sessionNavigationChatBinding(state, navigation, snapshot.runningIds);
}
