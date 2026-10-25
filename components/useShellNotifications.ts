"use client";

import { useCallback, type Dispatch, type SetStateAction, type RefObject } from "react";
import type { BlockingExtensionUiRequest, SessionInfo } from "@/lib/types";
import { claimExtensionAttentionNotification, shouldShowBrowserNotification, showBrowserNotification } from "@/lib/browser-notifications";
import { setupPushSubscription } from "@/lib/push-client";

// AppShell calls this at the original three useCallback registration positions.
// The dedup ref and page-lived push subscription remain in AppShell.
export function useShellNotifications({ selectedSession, handleSelectSession, locale,
  handleSessionSettled, setExplorerRefreshKey, translate, notifiedAttentionRequestIdsRef,
}: {
  selectedSession: SessionInfo | null;
  handleSelectSession: (session: SessionInfo) => void;
  locale: string;
  handleSessionSettled: () => void;
  setExplorerRefreshKey: Dispatch<SetStateAction<number>>;
  translate: (key: string) => string;
  notifiedAttentionRequestIdsRef: RefObject<Set<string>>;
}) {
  const deliverSessionNotification = useCallback(({
    targetSession,
    title,
    body,
    tag,
  }: {
    targetSession: SessionInfo | null;
    title: string;
    body: string;
    tag?: string;
  }) => {
    if (!("Notification" in window)) return;

    const fire = () => {
      const sessionUrl = targetSession ? `/?session=${encodeURIComponent(targetSession.id)}` : "/";
      void showBrowserNotification({
        title,
        body,
        sessionUrl,
        tag,
        onClick: () => {
          window.focus();
          if (targetSession) handleSelectSession(targetSession);
        },
      });
    };

    if (Notification.permission === "granted") {
      fire();
      void setupPushSubscription(locale);
    } else if (Notification.permission === "default") {
      void Notification.requestPermission().then((p) => {
        if (p === "granted") {
          fire();
          void setupPushSubscription(locale);
        }
      });
    }
  }, [handleSelectSession, locale]);

  const handleAgentEnd = useCallback(() => {
    handleSessionSettled();
    setExplorerRefreshKey((k) => k + 1);

    if (selectedSession?.relation?.kind === "subagent") return;
    if (!shouldShowBrowserNotification()) return;
    const targetSession = selectedSession;
    deliverSessionNotification({
      targetSession,
      title: targetSession?.name ?? translate("i18n.sessionComplete"),
      body: translate("i18n.taskFinished"),
      tag: targetSession ? `pi-session-complete:${targetSession.id}` : "pi-session-complete",
    });
  }, [deliverSessionNotification, handleSessionSettled, selectedSession, translate]);

  const handleAttentionNeeded = useCallback((request: BlockingExtensionUiRequest) => {
    if (selectedSession?.relation?.kind === "subagent") return;
    if (!shouldShowBrowserNotification()) return;
    if (!claimExtensionAttentionNotification(request, notifiedAttentionRequestIdsRef.current)) return;

    deliverSessionNotification({
      targetSession: selectedSession,
      title: translate("i18n.attentionNeeded"),
      body: request.method === "custom"
        ? translate("i18n.extensionInputNeeded")
        : request.method === "ask_user" ? request.question
        : request.title,
      tag: `pi-extension-ui:${request.id}`,
    });
  }, [deliverSessionNotification, selectedSession, translate]);

  return { handleAgentEnd, handleAttentionNeeded };
}
