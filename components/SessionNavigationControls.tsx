"use client";
import type { Dispatch, SetStateAction, RefObject } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { AutoNameStatus } from "@/hooks/useSessionAutoName";
import type { SessionInfo } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ReviewNavigation } from "@/lib/review-notebook";
import type { NavigationUi } from "@/hooks/useSessionNavigation";
const TOP_BAR_ICON_BUTTON_SIZE = 36;
export function SessionAutoNameButton({ selectedSession, sessionStats, autoNameStatus, handleAutoName, mobile }: {
  selectedSession: SessionInfo | null; sessionStats: SessionStatsInfo | null;
  autoNameStatus: AutoNameStatus; handleAutoName: () => Promise<void>; mobile: boolean;
}) {
  const { t: translate } = useI18n();
  // 上下文压缩后当前消息可能不再包含 user 消息，需同时参考会话文件的消息总数。
  const hasMessages = Boolean(
    selectedSession
    && ((sessionStats?.userMessages ?? 0) > 0 || selectedSession.messageCount > 0),
  );
  const disabled = !selectedSession || selectedSession.transient || !hasMessages || autoNameStatus.kind === "naming";
  const isSuccess = autoNameStatus.kind === "success";
  const isError = autoNameStatus.kind === "error";
  const label = autoNameStatus.kind === "naming"
    ? translate("title.generating")
    : isSuccess
      ? translate("title.updated")
      : isError
        ? translate("title.failed")
        : translate("title.generate");
  const title = !selectedSession || selectedSession.transient
    ? translate("title.unsaved")
    : !hasMessages
      ? translate("title.noMessages")
      : isError
        ? autoNameStatus.message
        : translate("title.generateSession");

  return (
    <button
      type="button"
      onClick={() => {
        void handleAutoName();
      }}
      disabled={disabled}
      title={title}
      aria-label={label}
      style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
        height: "100%", padding: mobile ? 0 : "0 12px",
        background: "none", border: "none",
        borderTop: "2px solid transparent",
        borderRight: "1px solid var(--border)",
        color: isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && autoNameStatus.kind !== "naming" ? 0.45 : 1,
        flexShrink: 0, fontSize: 11, whiteSpace: "nowrap",
        transition: "color 0.1s, background 0.1s, opacity 0.1s",
      }}
      onMouseEnter={(event) => {
        if (disabled) return;
        event.currentTarget.style.color = isError ? "#dc2626" : "var(--text)";
        event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = isError ? "#dc2626" : isSuccess ? "var(--accent)" : disabled ? "var(--text-dim)" : "var(--text-muted)";
        event.currentTarget.style.background = "none";
      }}
      data-mobile-toolbar-action={mobile ? "name" : undefined}
    >
      {autoNameStatus.kind === "naming" ? (
        <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : isSuccess ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 4 5 5L7 22l-5-5Z" />
          <path d="m14 5 5 5" />
          <path d="M6 4V2M5 3H3M19 19v3M17.5 20.5h3" />
        </svg>
      )}
      {!mobile && <span>{label}</span>}
    </button>
  );
}

export function OverviewNavigationButtons({ activeOverview, isMobile, overviewMobileList, activityNeedsCount, closeOverview,
  reviewNavigationId, setActiveTopPanel, setOverviewMobileList, setReviewNavigation, setActiveOverview, setRightPanelOpen, setSidebarOpen }: {
  activeOverview: "activity" | "starred" | "git" | null; isMobile: boolean; overviewMobileList: boolean; activityNeedsCount: number;
  closeOverview: () => void; reviewNavigationId: RefObject<number>;
  setActiveTopPanel: NavigationUi["setActiveTopPanel"];
  setOverviewMobileList: Dispatch<SetStateAction<boolean>>;
  setReviewNavigation: Dispatch<SetStateAction<ReviewNavigation | null>>;
  setActiveOverview: Dispatch<SetStateAction<"activity" | "starred" | "git" | null>>;
  setRightPanelOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
}) {
  const { t: translate } = useI18n();
  return <>
          <button
            type="button"
            onClick={() => {
              setActiveTopPanel(null);
              if (activeOverview === "activity" && isMobile && !overviewMobileList) {
                setOverviewMobileList(true);
              } else if (activeOverview === "activity") {
                closeOverview();
              } else {
                setOverviewMobileList(true);
                ++reviewNavigationId.current;
                setReviewNavigation(null);
                setActiveOverview("activity");
                if (isMobile) setRightPanelOpen(false);
                if (isMobile || window.innerWidth < 1000) setSidebarOpen(false);
              }
            }}
            aria-label={activeOverview === "activity" && isMobile && !overviewMobileList
              ? translate("activity.back")
              : activityNeedsCount ? `${translate("activity.title")} · ${translate("activity.needsCount", { count: activityNeedsCount })}` : translate("activity.title")}
            aria-pressed={activeOverview === "activity" && (!isMobile || overviewMobileList)}
            title={activeOverview === "activity" && isMobile && !overviewMobileList ? translate("activity.back") : translate("activity.title")}
            className="activity-top-button"
            style={{ position: "relative", width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, flexShrink: 0, border: 0, borderRight: "1px solid var(--border)", background: activeOverview === "activity" ? "var(--bg-selected)" : "none", color: "var(--text-muted)", cursor: "pointer" }}
          >
            {activeOverview === "activity" && isMobile && !overviewMobileList ? "←" : "◉"}
            {activityNeedsCount > 0 && !(activeOverview === "activity" && isMobile && !overviewMobileList) && <span className="activity-top-count" aria-hidden="true">{activityNeedsCount > 9 ? "9+" : activityNeedsCount}</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTopPanel(null);
              if (activeOverview === "starred" && isMobile && !overviewMobileList) {
                setOverviewMobileList(true);
              } else if (activeOverview === "starred") {
                closeOverview();
              } else {
                setOverviewMobileList(true);
                ++reviewNavigationId.current;
                setReviewNavigation(null);
                setActiveOverview("starred");
                if (isMobile) setRightPanelOpen(false);
                if (isMobile || window.innerWidth < 1000) setSidebarOpen(false);
              }
            }}
            aria-label={activeOverview === "starred" && isMobile && !overviewMobileList ? translate("starred.back") : translate("activity.starred")}
            aria-pressed={activeOverview === "starred" && (!isMobile || overviewMobileList)}
            title={activeOverview === "starred" && isMobile && !overviewMobileList ? translate("starred.back") : translate("activity.starred")}
            className="activity-top-button"
            style={{ width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, flexShrink: 0, border: 0, borderRight: "1px solid var(--border)", background: activeOverview === "starred" ? "var(--bg-selected)" : "none", color: "#eab308", cursor: "pointer" }}
          >
            {activeOverview === "starred" && isMobile && !overviewMobileList ? "←" : "★"}
          </button>
  </>;
}
