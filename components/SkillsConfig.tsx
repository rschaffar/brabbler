"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { getLastSettingsSelection, setLastSettingsSelection } from "@/lib/settings-navigation";
import type { SkillInfo } from "@/lib/api-types";
import type { CatalogRow, CatalogDiagnostic } from "@/lib/agent-resources/catalog";
import type { UnboundCatalogMetadata } from "@/lib/agent-resources/catalog-metadata";
import type { ResolvedSelection, SelectionChoice, SelectionScope } from "@/lib/agent-resources/selection";
import { SkillInstructions } from "./SkillInstructions";
import {
  ConfigButton, ConfigDetail, ConfigDetailHeader, ConfigDetailHeaderInfo, ConfigDetailStack,
  ConfigEmptyState, ConfigField, ConfigFooter, ConfigPanelShell,
  ConfigSidebar, ConfigSidebarGroupLabel, ConfigSidebarItem, ConfigSidebarList,
  ConfigSidebarText, ConfigSplitView, useSettingsWork,
} from "./SettingsUi";

// Wire-only projection. All catalog/selection imports above are erased types;
// browser code must never import the filesystem/SDK-backed API implementation.
type ResourceRow = Omit<CatalogRow, "identity" | "parent" | "selection" | "skill"> & {
  selectionKey: string | null;
  parentKey: string | null;
  desired: ResolvedSelection | null;
  skill?: Pick<SkillInfo, "name" | "description" | "disableModelInvocation">;
};
type RuntimeStatus = {
  sessionId: string;
  state: "saved" | "applied" | "starting" | "applying" | "error" | "on-open";
  savedRevision: string | null;
  appliedRevision: string | null;
  applyingRevision: string | null;
  includedKeys?: readonly string[];
  error?: string;
};
type Inventory = {
  version: 1;
  state: "desired";
  contextToken: string;
  context: { cwd: string | null; sessionId: string | null; scopes: Record<SelectionScope, boolean> };
  scopes: Record<SelectionScope, { revision: string; ownChoices: { selectionKey: string; choice: SelectionChoice }[] } | null>;
  runtime: RuntimeStatus | null;
  catalog: { rows: ResourceRow[]; presentation: UnboundCatalogMetadata | null; diagnostics: CatalogDiagnostic[]; coverage: string };
};
type Props = { cwd?: string | null; sessionId?: string | null; onClose: () => void; embedded?: boolean };
const scopes = ["global", "project", "session"] as const;
const choices = ["enabled", "disabled", "inherit"] as const;
const rowKey = (row: ResourceRow) => row.selectionKey ?? JSON.stringify([row.kind, row.scope, row.path, row.source]);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Context changes retire the entire receiving instance, including A -> B -> A.
 * A late response can finish its original handler, never publish into a new one. */
export function SkillsConfig(props: Props) {
  const cwd = props.cwd || null, sessionId = cwd ? props.sessionId ?? null : null;
  return <ResourceSettings key={JSON.stringify([cwd, sessionId])} {...props} cwd={cwd} sessionId={sessionId} />;
}

function Instructions({ row, cwd, sessionId }: { row: ResourceRow; cwd: string | null; sessionId: string | null }) {
  const { t } = useI18n();
  if (row.membership !== "confirmed" || !row.selectionKey) return <ConfigField label={t("skills.instructions")}>{t("resources.instructionsUnavailable")}</ConfigField>;
  // Display paths are not authority. The server independently admits the current
  // key, source, own Session profile and bounded document on every read.
  return <SkillInstructions selectionKey={row.selectionKey} cwd={cwd} sessionId={sessionId}
    skill={{ filePath: row.path, baseDir: row.path.replace(/[\\/][^\\/]+$/, "") }} />;
}

function ResourceSettings({ cwd = null, sessionId = null, onClose, embedded = false }: Props) {
  const { t } = useI18n();
  const observe = useSettingsWork();
  const mobile = useIsMobile();
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<"save" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyUnknown, setApplyUnknown] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => getLastSettingsSelection("skills", cwd));
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [mobileDetail, setMobileDetail] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const alive = useRef(false), generation = useRef(0), admitted = useRef(false);
  const loadController = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const listOrigin = useRef<string | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const focusDetail = useRef(false), returnFocus = useRef<string | null>(null);

  const context = { ...(cwd ? { cwd } : {}), ...(cwd && sessionId ? { sessionId } : {}) };
  const accept = useCallback((data: Inventory) => {
    setInventory(data);
    setApplyUnknown(false);
    setSelected(current => {
      const next = data.catalog.rows.find(row => rowKey(row) === current) ?? data.catalog.rows[0];
      if (next?.selectionKey) setLastSettingsSelection("skills", next.selectionKey, cwd);
      return next ? rowKey(next) : null;
    });
  }, [cwd]);
  const load = useCallback(() => {
    if (admitted.current) return;
    const ticket = ++generation.current;
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoading(true); setError(null);
    return observe("resources.load", (async () => {
      try {
        const params = new URLSearchParams({ ...(cwd ? { cwd } : {}), ...(cwd && sessionId ? { sessionId } : {}) });
        const response = await fetch(`/api/agent-resources${params.size ? `?${params}` : ""}`, { signal: controller.signal });
        const data = await response.json() as Inventory & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (alive.current && ticket === generation.current && !controller.signal.aborted) accept(data);
      } catch (cause) {
        if (alive.current && ticket === generation.current && !controller.signal.aborted) setError(message(cause));
      } finally {
        if (alive.current && ticket === generation.current && !controller.signal.aborted) setLoading(false);
      }
    })());
  }, [cwd, sessionId, observe, accept]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; loadController.current?.abort(); };
  }, [load]);

  const mutate = (kind: "save" | "apply", body: object) => {
    // Synchronous admission also protects repeated events before React commits.
    if (admitted.current || loading || !inventory) return;
    admitted.current = true;
    const ticket = ++generation.current;
    setPending(kind); setError(null);
    return observe(`resources.${kind}`, (async () => {
      let status: number | null = null;
      try {
        const response = await fetch("/api/agent-resources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        status = response.status;
        const data = await response.json() as Inventory & { error?: string };
        if (!response.ok || data.error) throw new Error(`${data.error ?? `HTTP ${response.status}`}${response.status === 409 ? ` ${t("resources.conflictHelp")}` : ""}`);
        if (alive.current && ticket === generation.current) accept(data);
      } catch (cause) {
        if (alive.current && ticket === generation.current) {
          setError(message(cause));
          // A refusal did not reconstruct anything. Other failures may occur
          // after retirement: the last receipt is no longer readiness evidence.
          if (kind === "apply" && status !== 409) setApplyUnknown(true);
        }
      } finally {
        if (alive.current && ticket === generation.current) { admitted.current = false; setPending(null); }
      }
    })());
  };

  const catalog = inventory?.catalog;
  const items = catalog?.rows ?? [];
  const byKey = new Map(items.map(row => [rowKey(row), row]));
  const label = (row: ResourceRow) => row.skill?.name
    ?? (row.kind === "group" ? catalog?.presentation?.groups.find(group => group.key === row.path)?.label ?? row.path
      : row.kind === "package" ? catalog?.presentation?.packages.find(pkg => pkg.source === row.path)?.label ?? row.path.split("/").at(-1) ?? row.path
        : row.path.split("/").at(-1) ?? row.path);
  const purpose = (row: ResourceRow) => row.skill?.description
    ?? (row.kind === "group" ? catalog?.presentation?.groups.find(group => group.key === row.path)?.purpose
      : row.kind === "package" ? catalog?.presentation?.packages.find(pkg => pkg.source === row.path)?.purpose : undefined);
  const membersByKey = new Map<string, ResourceRow[]>();
  for (const row of items) if (row.parentKey) {
    const members = membersByKey.get(row.parentKey) ?? [];
    members.push(row); membersByKey.set(row.parentKey, members);
  }
  const children = (row: ResourceRow) => row.selectionKey ? membersByKey.get(row.selectionKey) ?? [] : [];
  const selectedRow = items.find(row => rowKey(row) === selected);
  const runtime = inventory?.runtime?.sessionId === sessionId ? inventory.runtime : null;
  const applied = pending !== "apply" && !applyUnknown && runtime?.state === "applied" && Boolean(runtime.appliedRevision && runtime.appliedRevision === runtime.savedRevision);
  const canApply = Boolean(cwd && sessionId && runtime?.appliedRevision && ["saved", "applied", "error"].includes(runtime.state));
  const search = query.trim().toLowerCase();
  const matches = (row: ResourceRow) => `${label(row)} ${purpose(row) ?? ""} ${row.path}`.toLowerCase().includes(search);
  const subtreeMatches = (row: ResourceRow): boolean => matches(row) || children(row).some(subtreeMatches);
  const select = (row: ResourceRow) => {
    const key = rowKey(row);
    setSelected(key);
    if (row.selectionKey) setLastSettingsSelection("skills", row.selectionKey, cwd);
    focusDetail.current = true;
    setFocusRequest(value => value + 1);
    setMobileDetail(true);
  };
  useLayoutEffect(() => {
    if (focusDetail.current) { focusDetail.current = false; heading.current?.focus(); }
    if (returnFocus.current) {
      const origin = rows.current.get(returnFocus.current);
      const target = origin && !origin.closest("[hidden]") ? origin : searchInput.current;
      if (target && !target.closest("[hidden]")) { target.focus(); returnFocus.current = null; }
    }
  }, [selected, mobileDetail, focusRequest]);
  const renderRow = (row: ResourceRow, depth = 0, ancestorMatch = false) => {
    if (search && !ancestorMatch && !subtreeMatches(row)) return null;
    const key = rowKey(row), members = children(row), expanded = search ? true : !collapsed.has(key);
    return <div key={key} className="resource-branch">
      <div className="resource-tree-row" style={{ paddingInlineStart: depth * 14 }} ref={node => {
        const button = node?.querySelector<HTMLButtonElement>(".config-sidebar-item");
        if (button) rows.current.set(key, button); else rows.current.delete(key);
      }}>
        {members.length > 0 ? <button type="button" className="resource-disclosure" aria-label={t(expanded ? "resources.collapse" : "resources.expand", { name: label(row) })} aria-expanded={expanded} onClick={() => setCollapsed(current => {
          const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
        })}>{expanded ? "▾" : "▸"}</button> : <span className="resource-disclosure-space" />}
        <ConfigSidebarItem active={selected === key} onClick={() => { listOrigin.current = key; select(row); }} title={row.path}>
          <ConfigSidebarText>{label(row)}</ConfigSidebarText><span className="resource-kind">{t(`resources.kind.${row.kind}`)}</span>
        </ConfigSidebarItem>
      </div>
      {expanded && members.map(child => renderRow(child, depth + 1, ancestorMatch || matches(row)))}
    </div>;
  };
  const roots = items.filter(row => !row.parentKey || !byKey.has(row.parentKey));
  return <ConfigPanelShell embedded={embedded} title={t("resources.title")} subtitle={cwd ?? undefined} closeLabel={t("i18n.close")} onClose={onClose}>
    <div className="resource-settings">
      <div className="resource-context">
        <span>{cwd ?? t("resources.globalContext")}{sessionId ? ` · ${t("resources.conversation", { id: sessionId })}` : ""}</span>
        <div role="status" aria-live="polite">
          {pending === "apply" ? t("resources.applying") : pending === "save" ? t("resources.saving")
            : applyUnknown && runtime?.state === "applied" ? t("resources.actualUnconfirmed") : runtime ? t(`resources.runtime.${runtime.state}`) : t("resources.newRuntimes")}
        </div>
        {runtime?.savedRevision && <span className="resource-revisions">{t("resources.revisions", { saved: runtime.savedRevision.slice(0, 8), actual: !applyUnknown && runtime.appliedRevision ? runtime.appliedRevision.slice(0, 8) : t("resources.unconfirmed") })}</span>}
        {runtime?.applyingRevision && <span>{t("resources.applyingRevision", { revision: runtime.applyingRevision.slice(0, 8) })}</span>}
        {applyUnknown && runtime?.state !== "applied" && <span>{t("resources.actualUnconfirmed")}</span>}
        {runtime?.error && <span role="alert">{runtime.error}</span>}
        {error && <span role="alert">{error}</span>}
      </div>
      <ConfigSplitView>
        <div className="resource-list-pane" hidden={mobile && mobileDetail}>
          <ConfigSidebar>
            <label className="resource-search">{t("resources.search")}<input ref={searchInput} type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
            <ConfigSidebarList>
              <ConfigSidebarGroupLabel>{t("resources.hierarchy")}</ConfigSidebarGroupLabel>
              {roots.filter(row => row.kind === "group").map(row => renderRow(row))}
              {roots.some(row => row.kind !== "group") && <ConfigSidebarGroupLabel>{t("resources.ungrouped")}</ConfigSidebarGroupLabel>}
              {roots.filter(row => row.kind !== "group").map(row => renderRow(row))}
              {!loading && !roots.some(subtreeMatches) && <ConfigEmptyState>{t("resources.noResults")}</ConfigEmptyState>}
              {loading && <span role="status">{t("i18n.loading")}</span>}
            </ConfigSidebarList>
          </ConfigSidebar>
        </div>
        <div className="resource-detail-pane" hidden={mobile && !mobileDetail}>
          <ConfigDetail><ConfigDetailStack>
            {mobile && <ConfigButton className="resource-back" onClick={() => { returnFocus.current = listOrigin.current ?? selected; setMobileDetail(false); }}>{t("resources.back")}</ConfigButton>}
            {selectedRow ? <>
              <ConfigDetailHeader><ConfigDetailHeaderInfo>
                <h3 ref={heading} tabIndex={-1} className="resource-detail-heading config-detail-title">{label(selectedRow)}</h3>
                <span>{t(`resources.kind.${selectedRow.kind}`)}</span>
              </ConfigDetailHeaderInfo></ConfigDetailHeader>
              {purpose(selectedRow) && <p>{purpose(selectedRow)}</p>}
              {selectedRow.desired ? <>
                <div className="resource-effective">{applied && selectedRow.selectionKey && runtime?.includedKeys?.includes(selectedRow.selectionKey) && selectedRow.desired.enabled && !selectedRow.skill?.disableModelInvocation
                  ? t("resources.included") : t(selectedRow.desired.enabled ? "resources.savedEnabled" : "resources.savedDisabled")}</div>
                {selectedRow.desired.disabledReasons.map((reason, index) => <div key={index}>{reason.code === "parent-disabled"
                  ? t("resources.parentDisabled", { name: byKey.has(reason.key) ? label(byKey.get(reason.key)!) : reason.key })
                  : reason.code === "own-disabled" ? t("resources.ownDisabled", { scope: t(`resources.scope.${reason.scope}`) })
                    : t(`resources.reason.${reason.code}`)}</div>)}
                <div className="resource-scopes" aria-label={t("resources.savedChoices")}>
                  {scopes.filter(scope => !(scope === "global" && selectedRow.scope === "project")).map(scope => {
                    const state = selectedRow.desired!.scopes[scope];
                    const editable = state.editable && Boolean(inventory?.scopes[scope]) && selectedRow.membership === "confirmed";
                    return <fieldset key={scope} className="resource-scope" disabled={!editable || Boolean(pending) || loading}>
                      <legend>{t(`resources.scope.${scope}`)}</legend>
                      {editable ? choices.map(choice => <label key={choice}><input type="radio" name={`${selected}:${scope}`} value={choice} checked={state.choice === choice} onChange={() => {
                        const revision = inventory?.scopes[scope]?.revision;
                        if (!revision || !selectedRow.selectionKey) return;
                        void mutate("save", { ...context, selectionKey: selectedRow.selectionKey, scope, choice, revision, contextToken: inventory!.contextToken });
                      }} />{t(`resources.choice.${choice}`)}</label>) : <span>{t(`resources.unavailable.${scope}`)}</span>}
                    </fieldset>;
                  })}
                </div>
              </> : <ConfigEmptyState>{t(selectedRow.kind === "prompt" || selectedRow.kind === "theme" ? "resources.nativeSemantics" : "resources.unresolved")}</ConfigEmptyState>}
              {selectedRow.skill?.disableModelInvocation && <ConfigField label={t("resources.authoredMetadata")}>{t("resources.manualOnly")}</ConfigField>}
              <ConfigField label={t("resources.contributions")}>{t(`resources.contribution.${selectedRow.kind}`)}</ConfigField>
              {children(selectedRow).length > 0 && <ConfigField label={t("resources.members")}><ul>{children(selectedRow).map(child => <li key={rowKey(child)}><button type="button" className="resource-member" onClick={() => select(child)}>{label(child)}</button></li>)}</ul></ConfigField>}
              <ConfigField label={t("resources.source")}><code className="resource-path">{selectedRow.path}</code><span>{t("resources.nativeObservation", { value: selectedRow.nativeEnabled === null ? t("resources.unconfirmed") : t(selectedRow.nativeEnabled ? "resources.choice.enabled" : "resources.choice.disabled") })}</span></ConfigField>
              {selectedRow.managedBy === "nix" && <ConfigField label={t("resources.ownership")}>{t("resources.nixOwned")}</ConfigField>}
              {selectedRow.kind === "package" && <ConfigField label={t("resources.packageManagement")}>{t("resources.packageOwnership")}</ConfigField>}
              {selectedRow.kind === "skill" && <Instructions key={selectedRow.selectionKey ?? selectedRow.path} row={selectedRow} cwd={cwd} sessionId={sessionId} />}
            </> : <ConfigEmptyState>{t("resources.select")}</ConfigEmptyState>}
          </ConfigDetailStack></ConfigDetail>
        </div>
      </ConfigSplitView>
      {catalog && <div className="resource-diagnostics"><small>{catalog.coverage}</small>{catalog.diagnostics.length > 0 && <ConfigField label={t("resources.diagnostics")}><ul>{catalog.diagnostics.map((diagnostic, index) => <li key={index}>{diagnostic.code}: {diagnostic.message} <code>{diagnostic.path}</code></li>)}</ul></ConfigField>}</div>}
      <ConfigFooter status={!canApply ? t("resources.newRuntimes") : undefined}>
        <ConfigButton disabled={loading || Boolean(pending)} onClick={() => void load()}>{t("i18n.refresh")}</ConfigButton>
        {canApply && <ConfigButton variant="primary" disabled={loading || Boolean(pending) || applyUnknown} aria-busy={pending === "apply" || undefined} onClick={() => void mutate("apply", { cwd, sessionId, action: "apply" })}>{t("resources.apply")}</ConfigButton>}
        {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
      </ConfigFooter>
    </div>
  </ConfigPanelShell>;
}
