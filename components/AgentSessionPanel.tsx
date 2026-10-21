"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useAgentUsage } from "@/hooks/useAgentUsage";
import { countRunningSubagents } from "@/lib/session-family";
import { formatAgentCost, formatAgentDuration, formatAgentTokens, sumAgentUsage, type AgentUsageEntry, type AgentUsageSnapshot } from "@/lib/agent-usage";
import type { SessionUsageSummary } from "@/lib/session-stats";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
}

function UsageLine({ entry }: { entry?: AgentUsageEntry }) {
  const { t } = useI18n();
  if (!entry || entry.status === "loading") return <span>{t("agentSwitcher.usageLoading")}</span>;
  if (!("summary" in entry)) return <span>{t("agentSwitcher.usageUnavailable")}</span>;
  const usage = entry.summary;
  return <span>{t("agentSwitcher.compactUsage", {
    time: formatAgentDuration(usage.totalActiveMs), tokens: formatAgentTokens(usage.tokens.total), cost: formatAgentCost(usage.cost),
  })}{entry.status === "stale" ? ` · ${t("agentSwitcher.usageStale")}` : ""}</span>;
}

function UsageBreakdown({ summary }: { summary: SessionUsageSummary }) {
  const { t, locale } = useI18n();
  const rows = [
    [t("agentSwitcher.estimatedActive"), formatAgentDuration(summary.totalActiveMs)],
    [t("session.input"), summary.tokens.input.toLocaleString(locale)],
    [t("session.output"), summary.tokens.output.toLocaleString(locale)],
    [t("session.cacheRead"), summary.tokens.cacheRead.toLocaleString(locale)],
    [t("session.cacheWrite"), summary.tokens.cacheWrite.toLocaleString(locale)],
    [t("session.total"), summary.tokens.total.toLocaleString(locale)],
    [t("session.toolCalls"), summary.toolCalls.toLocaleString(locale)],
    [t("agentSwitcher.recordedCost"), `$${summary.cost.toFixed(4)}`],
  ];
  return <dl style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "4px 12px", margin: "8px 0", fontVariantNumeric: "tabular-nums" }}>
    {rows.map(([label, value]) => <div key={label} style={{ display: "contents" }}><dt>{label}</dt><dd style={{ margin: 0 }}>{value}</dd></div>)}
  </dl>;
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

function statusColor(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "completed") return "#16a34a";
  if (status === "failed") return "#dc2626";
  if (status === "aborted") return "#d97706";
  return "var(--text-dim)";
}

function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  if (status === "running" || status === "starting") {
    return (
      <svg className="animate-spin motion-reduce:animate-none" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (status === "aborted" || status === "interrupted" || status === "paused") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function AgentRow({
  session,
  main,
  selected,
  running,
  usage,
  onSelect,
}: {
  session: SessionInfo;
  main?: boolean;
  selected: boolean;
  running: boolean;
  usage?: AgentUsageEntry;
  onSelect: () => void;
}) {
  const { locale, t } = useI18n();
  const relation = session.relation?.kind === "subagent" ? session.relation : null;
  const status: SubagentSessionStatus = running ? "running" : relation?.status ?? "completed";
  const primary = main ? t("agentSwitcher.main") : relation?.description || sessionTitle(session);
  const secondary = main
    ? sessionTitle(session)
    : `${relation?.profile ?? t("agentSwitcher.subagent")} · ${formatRelativeTime(session.modified, locale)}`;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-agent-usage-id={session.id}
      onClick={onSelect}
      style={{
        width: "100%",
        minHeight: 56,
        display: "grid",
        gridTemplateColumns: "28px minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 9,
        padding: "7px 12px",
        border: "none",
        borderBottom: "1px solid var(--border)",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        background: selected ? "var(--bg-selected)" : "transparent",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(event) => {
        if (!selected) event.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(event) => {
        if (!selected) event.currentTarget.style.background = "transparent";
      }}
    >
      <span style={{ width: 28, height: 28, display: "grid", placeItems: "center", color: main ? "var(--text-muted)" : "var(--accent)" }}>
        {main ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" />
          </svg>
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: selected ? 600 : 500 }} title={primary}>
          {primary}
        </span>
        <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }} title={secondary}>
          {secondary}
        </span>
        <span style={{ display: "block", marginTop: 3, color: "var(--text-dim)", fontSize: 11 }}><UsageLine entry={usage} /></span>
      </span>
      <span style={{ display: "flex", alignItems: "center", gap: 6, color: main && !running ? "var(--text-dim)" : statusColor(status), fontSize: 11, whiteSpace: "nowrap" }}>
        {main && !running ? (
          selected ? t("agentSwitcher.current") : null
        ) : (
          <>
            <StatusIcon status={status} />
            <span>{t(`agentSwitcher.status.${status}`)}</span>
          </>
        )}
      </span>
    </button>
  );
}

export function AgentSessionPanel(props: Props) {
  const ids = [props.rootSession.id, ...props.subagents.map((session) => session.id)];
  const usage = useAgentUsage(ids, props.runningSessionIds);
  return <AgentSessionPanelContent {...props} usage={usage} />;
}

/** The view is separate from IO so recorded/zero/partial states can be rendered in core tests. */
export function AgentSessionPanelContent({ rootSession, subagents, selectedSessionId, runningSessionIds, onSelectSession, usage }: Props & { usage: AgentUsageSnapshot }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const sortedSubagents = useMemo(() => [...subagents].sort((a, b) => {
    const aRunning = runningSessionIds.has(a.id);
    const bRunning = runningSessionIds.has(b.id);
    if (aRunning !== bRunning) return aRunning ? -1 : 1;
    return b.modified.localeCompare(a.modified);
  }), [runningSessionIds, subagents]);
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSubagents = normalizedQuery
    ? sortedSubagents.filter((session) => {
        const relation = session.relation?.kind === "subagent" ? session.relation : null;
        return [relation?.description, relation?.profile, session.name, session.firstMessage]
          .some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
    : sortedSubagents;
  const runningCount = countRunningSubagents(subagents, runningSessionIds);
  const family = sumAgentUsage([rootSession.id, ...subagents.map((session) => session.id)], usage);
  const selected = [rootSession, ...subagents].find((session) => session.id === selectedSessionId);
  const selectedUsage = usage.get(selectedSessionId);

  return (
    <div
      role="region"
      aria-label={t("agentSwitcher.title")}
      style={{
        background: "var(--bg-panel)",
        borderLeft: "1px solid var(--border)",
        borderRight: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        borderRadius: "0 0 6px 6px",
        boxShadow: "0 10px 28px rgba(0,0,0,0.10)",
        maxHeight: "min(78dvh, 720px)",
        overflowY: "auto",
      }}
    >
      <div>
        <div style={{ minHeight: 44, display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)" }}>
          <strong style={{ fontSize: 12, fontWeight: 600 }}>{t("agentSwitcher.title")}</strong>
          <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
            {t("agentSwitcher.count", { count: subagents.length })}
          </span>
          {runningCount > 0 && (
            <span style={{ marginLeft: "auto", color: "var(--accent)", fontSize: 11 }}>
              {t("agentSwitcher.runningCount", { count: runningCount })}
            </span>
          )}
        </div>
        <section data-testid="agent-family-usage" aria-label={t("agentSwitcher.familyUsage")} style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
          <strong>{t("agentSwitcher.familyUsage")}</strong>
          <div>{family.available > 0
            ? t("agentSwitcher.familyCompact", { time: formatAgentDuration(family.summary.totalActiveMs), tokens: formatAgentTokens(family.summary.tokens.total), cost: formatAgentCost(family.summary.cost) })
            : t(family.loading > 0 ? "agentSwitcher.usageLoading" : "agentSwitcher.usageUnavailable")}</div>
          <div>{t(family.available < family.total ? "agentSwitcher.usagePartial" : "agentSwitcher.usageComplete", { available: family.available, total: family.total })}
            {family.stale > 0 && ` · ${t("agentSwitcher.staleCount", { count: family.stale })}`}</div>
          <div style={{ marginTop: 4 }}>{t("agentSwitcher.familyMeaning")}</div>
          <details>
            <summary style={{ cursor: "pointer", padding: "6px 0" }}>{t("agentSwitcher.familyBreakdown")}</summary>
            {family.available > 0 && <UsageBreakdown summary={family.summary} />}
            <p>{t("agentSwitcher.familyHint")}</p>
          </details>
        </section>
        {subagents.length > 8 && (
          <div style={{ padding: 8, borderBottom: "1px solid var(--border)" }}>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("agentSwitcher.search")}
              aria-label={t("agentSwitcher.search")}
              style={{
                width: "100%", height: 32, padding: "0 10px",
                border: "1px solid var(--border)", borderRadius: 6,
                background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none",
              }}
            />
          </div>
        )}
        <div role="listbox" aria-label={t("agentSwitcher.title")} style={{ maxHeight: "min(58dvh, 480px)", overflowY: "auto" }}>
          <AgentRow
            session={rootSession}
            main
            selected={rootSession.id === selectedSessionId}
            running={runningSessionIds.has(rootSession.id)}
            usage={usage.get(rootSession.id)}
            onSelect={() => onSelectSession(rootSession)}
          />
          {visibleSubagents.map((session) => (
            <AgentRow
              key={session.id}
              session={session}
              selected={session.id === selectedSessionId}
              running={runningSessionIds.has(session.id)}
              usage={usage.get(session.id)}
              onSelect={() => onSelectSession(session)}
            />
          ))}
          {visibleSubagents.length === 0 && (
            <div style={{ padding: "22px 12px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
              {t("agentSwitcher.noMatches")}
            </div>
          )}
        </div>
        <details style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
          <summary style={{ cursor: "pointer", padding: "4px 0" }}>{t("agentSwitcher.selectedBreakdown")}</summary>
          <section aria-label={t("agentSwitcher.selectedUsage")}>
            <strong>{selected ? sessionTitle(selected) : selectedSessionId}</strong>
            <div><UsageLine entry={selectedUsage} /></div>
            {selectedUsage && "summary" in selectedUsage && <UsageBreakdown summary={selectedUsage.summary} />}
            <p>{t("agentSwitcher.recordedHint")}</p>
          </section>
        </details>
      </div>
    </div>
  );
}
