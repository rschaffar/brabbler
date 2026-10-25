"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTopPanelToggle } from "@/hooks/useSessionSystemInfo";
import { SessionAutoNameButton } from "./SessionNavigationControls";
import { SessionSystemInfoButtons } from "./SessionSystemInfoButtons";
import { SubagentIcon } from "./SubagentIcon";
import { BranchNavigator } from "./BranchNavigator";
import { SettingsSectionIcon } from "./SettingsPanel";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { SessionStatsInfo } from "@/lib/pi-types";
import type { ToolEntry } from "@/lib/tool-presets";
import { getFileName } from "@/lib/file-paths";
import { skillExpansionToCommand } from "@/lib/slash-display";
const TOP_BAR_ICON_BUTTON_SIZE = 36;
export type TopPanel = "agents" | "branches" | "system" | "tools" | "session" | null;
type Translate = (key: string, params?: Record<string, string | number>) => string;
type ContextUsage = { percent: number | null; contextWindow: number; tokens: number | null } | null;
type StatsProps = { mobile: boolean; showChat: boolean; sessionStats: SessionStatsInfo | null;
  contextUsage: ContextUsage; locale: string; activeTopPanel: TopPanel; toggleTopPanel: (panel: Exclude<TopPanel, null>) => void; translate: Translate };
type FileToggleProps = Pick<StatsProps, "mobile" | "sessionStats" | "contextUsage" | "translate"> & {
  handleRightPanelToggle: () => void; rightPanelOpen: boolean;
};
type ToolbarProps = Pick<StatsProps, "mobile" | "showChat" | "sessionStats" | "activeTopPanel" | "toggleTopPanel" | "translate"> & {
  selectedSession: SessionInfo | null;
  autoNameControl?: React.ReactNode;
  systemInfoControls?: React.ReactNode;
  setPluginSettingsSession: (session: { id: string; cwd: string }) => void;
  setSettingsSection: (section: "plugins") => void;
  handleViewFullHistory: () => void; handleAutoName: () => void | Promise<void>;
  autoNameStatus: { kind: "idle" | "naming" | "success" } | { kind: "error"; message: string };
  hasSubagentSessions: boolean; agentsButtonLabel: string; agentsBadge: { running: boolean; count: number };
  sessionHasBranches: boolean; branchTree: SessionTreeNode[]; branchActiveLeafId: string | null;
  handleBranchLeafChange: (leafId: string | null) => void;
  topBarRef: React.RefObject<HTMLDivElement | null>; systemBtnRef: React.RefObject<HTMLButtonElement | null>;
  handleSystemInfoToggle: (panel: "system" | "tools") => void;
  systemPrompt: string | null; systemTools: ToolEntry[] | null;
};
export function SessionToolbarActions({ autoNameControl, systemInfoControls, mobile, showChat, selectedSession, setPluginSettingsSession, setSettingsSection, handleViewFullHistory, sessionStats, autoNameStatus, handleAutoName, hasSubagentSessions, agentsButtonLabel, agentsBadge, activeTopPanel, toggleTopPanel, sessionHasBranches, branchTree, branchActiveLeafId, handleBranchLeafChange, topBarRef, systemBtnRef, handleSystemInfoToggle, systemPrompt, systemTools, translate }: ToolbarProps) {
    if (!mobile && !showChat) return null;
    return (
      <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
        <button type="button" aria-label="Session plugin settings" title="Session plugin settings"
          disabled={!selectedSession || selectedSession.transient}
          onClick={() => {
            if (!selectedSession || selectedSession.transient) return;
            setPluginSettingsSession({ id: selectedSession.id, cwd: selectedSession.cwd });
            setSettingsSection("plugins");
          }}
          className="flex shrink-0 items-center justify-center gap-1 border-r border-border px-2 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-40"
          style={{ width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined }}>
          <SettingsSectionIcon section="plugins" />
          {!mobile && <span>Policy</span>}
        </button>
        <button
          type="button"
          onClick={() => {
            handleViewFullHistory();
          }}
          disabled={!selectedSession}
          title={selectedSession ? translate("history.full") : translate("history.unsaved")}
          aria-label={translate("history.full")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
            height: "100%",
            padding: mobile ? 0 : "0 12px",
            background: "none",
            border: "none",
            borderTop: "2px solid transparent",
            borderRight: "1px solid var(--border)",
            color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
            cursor: selectedSession ? "pointer" : "not-allowed",
            opacity: selectedSession ? 1 : 0.45,
            flexShrink: 0,
            fontSize: 11,
            whiteSpace: "nowrap",
            transition: "color 0.1s, background 0.1s, opacity 0.1s",
          }}
          onMouseEnter={(event) => {
            if (!selectedSession) return;
            event.currentTarget.style.color = "var(--text)";
            event.currentTarget.style.background = "var(--bg-hover)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
            event.currentTarget.style.background = "none";
          }}
          data-mobile-toolbar-action={mobile ? "history" : undefined}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
              flexShrink: 0,
            }}
            aria-hidden="true"
          >
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M12 7v5l3 2" />
          </svg>
          {!mobile && <span>{translate("history.label")}</span>}
        </button>
        {autoNameControl ?? <SessionAutoNameButton selectedSession={selectedSession} sessionStats={sessionStats}
          autoNameStatus={autoNameStatus} handleAutoName={() => Promise.resolve(handleAutoName())} mobile={mobile} />}
        {hasSubagentSessions && (
          <button
            type="button"
            onClick={() => toggleTopPanel("agents")}
            title={agentsButtonLabel}
            aria-label={agentsButtonLabel}
            aria-pressed={activeTopPanel === "agents"}
            style={{
              position: "relative",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              width: mobile ? TOP_BAR_ICON_BUTTON_SIZE : undefined,
              height: "100%", padding: mobile ? 0 : "0 12px",
              background: activeTopPanel === "agents" ? "var(--bg-selected)" : "none",
              border: "none",
              borderTop: activeTopPanel === "agents" ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: "1px solid var(--border)",
              color: activeTopPanel === "agents" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0, fontSize: 11, whiteSpace: "nowrap",
              transition: "color 0.1s, background 0.1s",
            }}
            data-mobile-toolbar-action={mobile ? "agents" : undefined}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
            </svg>
            {!mobile && <span>{translate("agentSwitcher.title")}</span>}
            <span
              aria-hidden="true"
              style={{
                position: "relative",
                minWidth: 15, height: 15, padding: "0 4px", display: "grid", placeItems: "center",
                borderRadius: 7, background: agentsBadge.running ? "color-mix(in srgb, var(--accent) 22%, var(--bg-panel))" : "var(--bg-selected)", color: "var(--accent)",
                fontWeight: agentsBadge.running ? 600 : undefined,
                fontSize: 10, lineHeight: 1, fontVariantNumeric: "tabular-nums",
                ...(mobile ? { position: "absolute", top: 2, right: 2, minWidth: 13, height: 13, padding: "0 3px", fontSize: 9 } : {}),
              }}
            >
              {agentsBadge.running && (
                <svg className="animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true"
                  style={{ position: "absolute", top: -3, left: -3, width: "calc(100% + 6px)", height: "calc(100% + 6px)", pointerEvents: "none" }}>
                  <circle cx="12" cy="12" r="11" stroke="currentColor" strokeWidth="2" opacity="0.2" />
                  <path d="M23 12a11 11 0 0 0-11-11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
              {agentsBadge.count}
            </span>
          </button>
        )}
        {sessionHasBranches && (mobile ? (
          <button
            type="button"
            onClick={() => toggleTopPanel("branches")}
            title={translate("i18n.branches")}
            aria-label={translate("i18n.branches")}
            aria-pressed={activeTopPanel === "branches"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: "100%", padding: 0,
              background: activeTopPanel === "branches" ? "var(--bg-selected)" : "none",
              border: "none",
              borderTop: activeTopPanel === "branches" ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: "1px solid var(--border)",
              color: activeTopPanel === "branches" ? "var(--text)" : "var(--text-muted)",
              cursor: "pointer", flexShrink: 0,
            }}
            data-mobile-toolbar-action="branches"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: branchTree.length > 0 ? "var(--accent)" : "var(--text-dim)" }} aria-hidden="true">
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          </button>
        ) : (
          <BranchNavigator
            tree={branchTree}
            activeLeafId={branchActiveLeafId}
            onLeafChange={handleBranchLeafChange}
            inline
            containerRef={topBarRef}
            open={activeTopPanel === "branches"}
            onToggle={() => toggleTopPanel("branches")}
            hasSession
          />
        ))}
        {systemInfoControls ?? <SessionSystemInfoButtons systemBtnRef={systemBtnRef} mobile={mobile} showChat={showChat}
          activeTopPanel={activeTopPanel} systemPrompt={systemPrompt} systemTools={systemTools}
          handleSystemInfoToggle={handleSystemInfoToggle} />}
      </div>
    );
  }

export function SessionStatsButton({ mobile, showChat, sessionStats, contextUsage, locale, toggleTopPanel, activeTopPanel, translate }: StatsProps) {
    if (!mobile && (!showChat || (!sessionStats && !contextUsage))) return null;

    const tokens = sessionStats?.tokens;
    const cost = sessionStats?.cost ?? 0;
    const formatCompact = (value: number) => value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(1)}M`
      : value >= 1000
        ? `${(value / 1000).toFixed(0)}k`
        : String(value);
    const costText = cost > 0 ? (cost >= 0.01 ? `$${cost.toFixed(2)}` : `<$0.01`) : null;

    let contextColor = "var(--text-muted)";
    let desktopContextText: string | null = null;
    let mobileContextText: string | null = null;
    if (contextUsage?.contextWindow) {
      const percent = contextUsage.percent;
      if (percent !== null && percent > 90) contextColor = "#ef4444";
      else if (percent !== null && percent > 70) contextColor = "rgba(234,179,8,0.95)";
      desktopContextText = percent !== null
        ? `${percent.toFixed(0)}% / ${formatCompact(contextUsage.contextWindow)}`
        : `? / ${formatCompact(contextUsage.contextWindow)}`;
      mobileContextText = percent !== null ? `${percent.toFixed(0)}%` : null;
    }

    const tooltipParts: string[] = [];
    if (tokens) {
      tooltipParts.push(`in: ${tokens.input.toLocaleString(locale)}`);
      tooltipParts.push(`out: ${tokens.output.toLocaleString(locale)}`);
      tooltipParts.push(`cache read: ${tokens.cacheRead.toLocaleString(locale)}`);
      tooltipParts.push(`cache write: ${tokens.cacheWrite.toLocaleString(locale)}`);
      if (cost > 0) tooltipParts.push(`cost: $${cost.toFixed(4)}`);
    }
    if (contextUsage?.contextWindow) {
      const percent = contextUsage.percent;
      tooltipParts.push(`context: ${percent !== null ? percent.toFixed(1) + "%" : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
    }
    const tooltip = tooltipParts.join("  |  ");
    const hasMobileValues = Boolean(
      (tokens && (tokens.input > 0 || tokens.output > 0))
      || costText
      || mobileContextText,
    );

    return (
      <button
        type="button"
        onClick={() => toggleTopPanel("session")}
        disabled={!showChat}
        title={tooltip || translate("session.title")}
        aria-label={translate("session.title")}
        aria-pressed={activeTopPanel === "session"}
        className={mobile ? "mobile-session-stats" : undefined}
        data-mobile-toolbar-stats={mobile ? "true" : undefined}
        style={{
          marginLeft: mobile ? 0 : "auto",
          display: "flex", alignItems: "center", justifyContent: "flex-end",
          flex: mobile ? "0 0 110px" : undefined,
          minWidth: 0,
          gap: mobile ? 7 : 10,
          paddingLeft: mobile ? 6 : 12,
          paddingRight: mobile ? 6 : 12,
          height: "100%",
          overflow: "hidden",
          background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
          border: "none",
          borderTop: activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent",
          fontSize: 11, color: "var(--text-muted)",
          whiteSpace: "nowrap", cursor: showChat ? "pointer" : "default",
          fontVariantNumeric: "tabular-nums",
          transition: "color 0.1s, background 0.1s",
        }}
        onMouseEnter={(event) => {
          if (showChat) event.currentTarget.style.color = "var(--text)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)";
        }}
      >
        {mobile ? (
          <>
            {tokens && tokens.input > 0 && (
              <span className="mobile-session-stat-io" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                </svg>
                {formatCompact(tokens.input)}
              </span>
            )}
            {tokens && tokens.output > 0 && (
              <span className="mobile-session-stat-io" style={{ display: "flex", alignItems: "center", gap: 2, flexShrink: 0 }}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                </svg>
                {formatCompact(tokens.output)}
              </span>
            )}
            {costText && (
              <span className="mobile-session-stat-cost" style={{ color: "var(--text)", fontWeight: 500, flexShrink: 0 }}>
                {costText}
              </span>
            )}
            {mobileContextText && (
              <span style={{ color: contextColor, flexShrink: 0 }}>
                {mobileContextText}
              </span>
            )}
            {!hasMobileValues && showChat && (
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", color: "var(--text-dim)" }}>
                {translate("session.title")}
              </span>
            )}
          </>
        ) : (
          <>
            {tokens && tokens.input > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                </svg>
                {formatCompact(tokens.input)}
              </span>
            )}
            {tokens && tokens.output > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                </svg>
                {formatCompact(tokens.output)}
              </span>
            )}
            {tokens && tokens.cacheRead > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
                </svg>
                {formatCompact(tokens.cacheRead)}
              </span>
            )}
            {costText && (
              <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>
                {costText}
              </span>
            )}
            {desktopContextText && (
              <span style={{ display: "flex", alignItems: "center", gap: 4, color: contextColor }}>
                <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" />
                </svg>
                {desktopContextText}
              </span>
            )}
          </>
        )}
      </button>
    );
  }

export function MainFileToggle({ mobile, handleRightPanelToggle, rightPanelOpen, sessionStats, contextUsage, translate }: FileToggleProps) { return (
      <button
        type="button"
        onClick={handleRightPanelToggle}
        aria-controls="file-panel"
        aria-expanded={rightPanelOpen}
        title={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
        aria-label={rightPanelOpen ? translate("files.hidePanel") : translate("files.showPanel")}
        data-mobile-toolbar-file={mobile ? "true" : undefined}
        style={{
          marginLeft: !mobile && !sessionStats && !contextUsage ? "auto" : 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
          background: rightPanelOpen ? "var(--bg-selected)" : "none",
          border: "none", borderLeft: "1px solid var(--border)",
          color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer", flexShrink: 0, transition: "color 0.12s, background 0.12s",
        }}
        onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(event) => { event.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </button>
  );
}

export function ToolbarActionsStrip({ isMobile, showChat, selectedSessionId, activeOverview, children }: {
  isMobile: boolean; showChat: boolean; selectedSessionId?: string; activeOverview: string | null; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = useCallback(() => {
    const strip = ref.current;
    if (!strip) return;
    const left = strip.scrollLeft > 1;
    const right = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setEdges(previous => previous.left === left && previous.right === right ? previous : { left, right });
  }, []);
  useEffect(() => {
    if (!isMobile || !ref.current) return;
    const strip = ref.current, observer = new ResizeObserver(update);
    observer.observe(strip);
    const toolbar = strip.querySelector('[data-mobile-toolbar="true"]');
    if (toolbar) observer.observe(toolbar);
    update();
    return () => observer.disconnect();
  }, [isMobile, showChat, selectedSessionId, activeOverview, update]);
  return <div ref={ref} className={`top-bar-actions${edges.left ? " has-more-left" : ""}${edges.right ? " has-more-right" : ""}`} onScroll={update}>{children}</div>;
}
export function MobileSessionIdentity({ isMobile, showChat, overviewList, session, newCwd, translate }: {
  isMobile: boolean; showChat: boolean; overviewList: boolean; session: SessionInfo | null; newCwd: string | null; translate: Translate;
}) {
  if (!isMobile || !showChat || overviewList) return null;
  const title = session
    ? session.name || (skillExpansionToCommand(session.firstMessage) ?? session.firstMessage).slice(0, 50) || session.id.slice(0, 12)
    : translate("i18n.newSession");
  const path = session?.projectRoot ?? session?.cwd ?? newCwd;
  const name = path ? getFileName(path) || path : null;
  return <div className="mobile-session-identity" data-mobile-session-identity="true">
    <div className="mobile-session-title" title={title}>{title}</div>
    {name && <div className="mobile-session-project" title={path ?? undefined}>{name}</div>}
  </div>;
}
export function topPanelPosition(panel: TopPanel, rect: { bottom: number; left: number; width: number }) {
  return { top: rect.bottom, left: rect.left, width: panel === "agents" ? Math.min(420, rect.width) : rect.width };
}
export function shellExpansionState({ rightPanelOpen, rightPanelExpanded, isMobile, activeOverview, gitExplorerExpanded }: {
  rightPanelOpen: boolean; rightPanelExpanded: boolean; isMobile: boolean; activeOverview: string | null; gitExplorerExpanded: boolean;
}) {
  const rightPanelFullWidth = rightPanelOpen && rightPanelExpanded && !isMobile;
  const gitExplorerFullWidth = activeOverview === "git" && gitExplorerExpanded && !isMobile && !rightPanelFullWidth;
  return { rightPanelFullWidth, gitExplorerFullWidth };
}
export function toggleFileExpansion(setGitExplorerExpanded: (value: boolean) => void, setActiveTopPanel: (value: TopPanel) => void,
  setRightPanelExpanded: (update: (expanded: boolean) => boolean) => void) {
  setGitExplorerExpanded(false); setActiveTopPanel(null); setRightPanelExpanded(expanded => !expanded);
}

export function SidebarToolbarToggle({ sidebarOpen, onToggle, translate }: { sidebarOpen: boolean; onToggle: () => void; translate: Translate }) {
  return <button
            className="sidebar-toggle-button"
            onClick={onToggle}
             title={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
             aria-label={sidebarOpen ? translate("sidebar.hide") : translate("sidebar.show")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {sidebarOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>;
}
export function GitToolbarToggle({ active, onToggle, triggerRef }: { active: boolean; onToggle: () => void; triggerRef: React.RefObject<HTMLButtonElement | null> }) {
  return <button ref={triggerRef} type="button" className="activity-top-button" aria-label="Git Explorer" title="Git Explorer"
            aria-pressed={active} aria-controls="git-explorer-panel"
            onClick={onToggle}
            style={{ width: TOP_BAR_ICON_BUTTON_SIZE, height: TOP_BAR_ICON_BUTTON_SIZE, flexShrink: 0,
              border: 0, borderRight: "1px solid var(--border)", background: active ? "var(--bg-selected)" : "none",
              color: "var(--text-muted)", cursor: "pointer" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="4" r="2" /><circle cx="6" cy="20" r="2" /><circle cx="18" cy="7" r="2" />
              <path d="M6 6v12M6 15c0-4 3-8 10-8" />
            </svg>
          </button>;
}
export function mobileToolbarVisible(isMobile: boolean, overviewList: boolean): boolean { return isMobile && !overviewList; }
export function MobileChatToolbar({ isMobile, overviewList, controls, stats, files }: {
  isMobile: boolean; overviewList: boolean; controls: React.ReactNode; stats: React.ReactNode; files: React.ReactNode;
}) {
  return mobileToolbarVisible(isMobile, overviewList) ? <div data-mobile-toolbar="true" style={{ display: "flex", alignItems: "stretch", height: "100%", flexShrink: 0 }}>
    {controls}{stats}{files}
  </div> : null;
}

/** Owns reversible toolbar panel subscriptions, not session navigation or fetch. */
export function useTopPanelState({ sessionHasBranches, hasSubagentSessions, rightPanelFullWidth, isMobile, topBarRef, setSidebarOpen }: {
  sessionHasBranches: boolean; hasSubagentSessions: boolean; rightPanelFullWidth: boolean; isMobile: boolean;
  topBarRef: React.RefObject<HTMLDivElement | null>; setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<TopPanel>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    if (!sessionHasBranches) {
      setActiveTopPanel((panel) => panel === "branches" ? null : panel);
    }
  }, [sessionHasBranches]);

  useEffect(() => {
    if (!hasSubagentSessions) {
      setActiveTopPanel((panel) => panel === "agents" ? null : panel);
    }
  }, [hasSubagentSessions]);

  useEffect(() => {
    if (rightPanelFullWidth) setActiveTopPanel(null);
  }, [rightPanelFullWidth]);

  const toggleTopPanel = useTopPanelToggle(isMobile, setSidebarOpen, setActiveTopPanel);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const topBarRect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos(topPanelPosition(activeTopPanel, topBarRect));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel, isMobile, topBarRef]);
  return { activeTopPanel, setActiveTopPanel, topPanelPos, toggleTopPanel };
}

export function SubagentToolbarMarker({ showChat, selectedSession, translate }: {
  showChat: boolean; selectedSession: SessionInfo | null; translate: Translate;
}) {
  return showChat && selectedSession?.relation?.kind === "subagent" ? (
            <span role="img" aria-label={translate("activity.subagent")} title={translate("activity.subagent")}
              style={{ width: TOP_BAR_ICON_BUTTON_SIZE, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, borderRight: "1px solid var(--border)", color: "var(--accent)" }}>
              <SubagentIcon size={16} />
            </span>
          ) : null;
}
