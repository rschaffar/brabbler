"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { EnabledModelsView } from "@/lib/enabled-models";
import type { StartupPreferencesChanges } from "@/lib/startup-preferences";
import {
  enabledModelsBulkActions,
  enabledModelsProviderToggle,
  filterEnabledModels,
  findProviderView,
  isLastEnabledModel,
} from "./enabled-models-helpers";
import { ConfigButton, ConfigSwitch, useSettingsTask, useSettingsWork } from "./SettingsUi";
import { ModelContextWindow, type ModelContextSettings } from "./ModelContextWindow";

/**
 * Model switches backed by pi's `enabledModels` setting.
 *
 * Every switch writes through `/api/models/enabled` right away, like the login
 * controls in the same panel and unlike the models.json editor around them,
 * which buffers until Save. Requests are serialized: each one is a
 * read-modify-write of one settings key, so overlapping edits from the same
 * panel could otherwise lose one of them.
 */

/** Shape of `POST /api/models/refresh`, mirroring `CatalogRefreshResult`. */
interface CatalogRefreshResponse {
  completed?: boolean;
  changed?: boolean;
  reason?: "offline" | "runtime";
  error?: string;
}

interface Failure {
  /** Translation key for a known refusal. */
  messageKey?: string;
  /** Raw server text for everything else. */
  message?: string;
  /** The retained rows are not a current read; Retry must not replay the edit. */
  readback?: boolean;
  readbackMessage?: string;
}

function clearReadbackFailure(failure: Failure | null): Failure | null {
  if (!failure?.readback) return failure;
  const { messageKey, message } = failure;
  return messageKey !== undefined || message !== undefined ? { messageKey, message } : null;
}

export interface EnabledModelsController {
  /** null is unresolved; an explicit empty snapshot selects Pi default. */
  accounts?: Readonly<Record<string, string>> | null;
  view: EnabledModelsView | null;
  loading: boolean;
  /** Control currently waiting on the server, or null when idle. */
  pending: string | null;
  failure: Failure | null;
  setModels: (key: string, refs: string[], enabled: boolean) => void;
  setProvider: (providerId: string, enabled: boolean) => void;
  setModelThinking: (provider: string, modelId: string, level: ThinkingLevel | null) => void;
  clearScope: () => void;
  pruneStale: () => void;
  /** Re-read the current view after shared models.json changed under the panel. */
  refresh: () => void;
  /** Re-read only if this completed catalog pass still matches the inspected account. */
  catalogRefreshCompleted: () => void;
  /** Re-verify the stored patterns after models.json was saved. */
  resync: (
    renames: { from: string; to: string }[],
    modelRenames: { from: string; to: string }[],
  ) => void;
}

type MutationBody =
  | { op: "models"; refs: string[]; enabled: boolean }
  | { op: "provider"; provider: string; enabled: boolean }
  | { op: "clear" }
  | { op: "prune" }
  | { op: "thinking"; modelThinking: NonNullable<StartupPreferencesChanges["modelThinking"]> }
  | {
      op: "resync";
      renames: { from: string; to: string }[];
      modelRenames: { from: string; to: string }[];
      fullyEnabled: string[];
    };

const FAILURE_KEYS: Record<string, string> = {
  "last-model": "models.enabledLastModel",
  "project-scope": "models.enabledProjectScope",
};

export function useEnabledModels(cwd?: string | null, accounts?: Readonly<Record<string, string>> | null): EnabledModelsController {
  const observe = useSettingsWork();
  const task = useSettingsTask();
  const [view, setView] = useState<EnabledModelsView | null>(null);
  const viewGeneration = useRef<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const pendingRef = useRef<string | null>(null);
  type Mutation = { key: string; body: MutationBody; cwd?: string | null; accounts?: Readonly<Record<string, string>>; generation: number };
  const queuedRef = useRef<Mutation | null>(null);
  const identity = JSON.stringify([cwd, accounts]);
  const context = useRef({ identity, generation: 0 });
  if (context.current.identity !== identity) context.current = { identity, generation: context.current.generation + 1 };
  const generation = context.current.generation;
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++requestVersion.current;
    const generation = context.current.generation;
    const current = () => mounted.current && !controller.signal.aborted
      && version === requestVersion.current && generation === context.current.generation;
    // Keep matching rows/list position during readback, never a different account's view.
    if (viewGeneration.current !== generation) { setView(null); setFailure(null); }
    else setFailure(clearReadbackFailure);
    setLoading(true);
    if (accounts === null) return () => controller.abort();
    const query = new URLSearchParams({ ...(cwd ? { cwd } : {}),
      ...(accounts === undefined ? {} : { accounts: JSON.stringify(accounts) }) });
    void observe("enabled.read", fetch(`/api/models/enabled${query.size ? `?${query}` : ""}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json() as EnabledModelsView & { error?: string };
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (!current()) return;
        viewGeneration.current = generation;
        setView(data);
        setFailure(clearReadbackFailure);
      })
      .catch((error: unknown) => {
        if (!current()) return;
        setFailure((previous) => ({ ...previous, readback: true,
          readbackMessage: error instanceof Error ? error.message : String(error) }));
      })
      .finally(() => {
        if (current()) setLoading(false);
      }));
    return () => controller.abort();
  }, [accounts, cwd, identity, reloadKey, observe]);

  const runMutation = useCallback(function run(request: Mutation) {
    const { key, body, cwd, accounts, generation } = request;
    const current = () => mounted.current && generation === context.current.generation;
    pendingRef.current = key;
    const version = ++requestVersion.current; // an older read cannot undo this write's readback
    if (mounted.current) { setPending(key); setFailure(null); }
    void task("enabled.mutate", async () => {
      try {
        const thinking = body.op === "thinking" ? body.modelThinking : null;
        const res = await fetch(thinking ? "/api/models/defaults" : "/api/models/enabled", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(thinking ? { modelThinking: thinking }
            : { ...body, ...(cwd ? { cwd } : {}), ...(accounts === undefined ? {} : { accounts }) }),
        });
        const data = await res.json() as EnabledModelsView & { error?: string; reason?: string };
        if (!res.ok || data.error) {
          const messageKey = data.reason ? FAILURE_KEYS[data.reason] : undefined;
          if (current()) setFailure(messageKey ? { messageKey } : { message: data.error ?? `HTTP ${res.status}` });
          return;
        }
        if (current()) {
          if (thinking) setReloadKey((key) => key + 1);
          else { viewGeneration.current = generation; setView(data); }
          setLoading(false);
        }
      } catch (error) {
        if (current()) setFailure({ message: error instanceof Error ? error.message : String(error) });
      } finally {
        pendingRef.current = null;
        if (mounted.current) {
          const readIntervened = requestVersion.current !== version;
          ++requestVersion.current; // A read started during this write cannot overwrite its result/error.
          setPending(null);
          if (current()) setLoading(false);
          // An intervening catalog refresh may contain newer models than the PUT's captured catalog.
          if (!current() || readIntervened) setReloadKey((key) => key + 1);
        }
        const queued = queuedRef.current;
        queuedRef.current = null;
        if (queued) run(queued);
      }
    })();
  }, [task]);

  const mutate = useCallback((key: string, body: MutationBody) => {
    if (accounts === null) return;
    const request = { key, body, cwd, accounts: accounts === undefined ? undefined : Object.freeze({ ...accounts }), generation };
    // Keep the original destination even if account navigation occurs before
    // this one-slot save-resync continuation runs. Never replay invalidations.
    if (pendingRef.current) queuedRef.current = request;
    else runMutation(request);
  }, [cwd, accounts, generation, runMutation]);

  const setModels = useCallback((key: string, refs: string[], enabled: boolean) => {
    mutate(key, { op: "models", refs, enabled });
  }, [mutate]);

  const setProvider = useCallback((providerId: string, enabled: boolean) => {
    mutate(`provider:${providerId}`, { op: "provider", provider: providerId, enabled });
  }, [mutate]);

  const setModelThinking = useCallback((provider: string, modelId: string, level: ThinkingLevel | null) => {
    mutate(`thinking:${provider}/${modelId}`, { op: "thinking", modelThinking: { provider, modelId, level } });
  }, [mutate]);
  const clearScope = useCallback(() => mutate("clear", { op: "clear" }), [mutate]);
  const pruneStale = useCallback(() => mutate("prune", { op: "prune" }), [mutate]);
  const refresh = useCallback(() => {
    if (mounted.current) { setFailure(null); setReloadKey((key) => key + 1); }
  }, []);
  const catalogRefreshCompleted = useCallback(() => {
    if (context.current.identity === identity) refresh();
  }, [identity, refresh]);
  // Resync writes and returns the fresh view, so it doubles as the reload
  // models.json needs after a save. The providers that are fully enabled right
  // now are the intent to preserve across whatever the save changed.
  const resync = useCallback((
    renames: { from: string; to: string }[],
    modelRenames: { from: string; to: string }[],
  ) => {
    const fullyEnabled = (view?.providers ?? [])
      .filter((provider) => provider.models.length > 0 && provider.enabledCount === provider.models.length)
      .map((provider) => provider.id);
    mutate("resync", { op: "resync", renames, modelRenames, fullyEnabled });
  }, [mutate, view]);

  return {
    accounts,
    view: viewGeneration.current === generation ? view : null,
    loading,
    pending,
    failure,
    setModels,
    setProvider,
    setModelThinking,
    clearScope,
    pruneStale,
    refresh,
    catalogRefreshCompleted,
    resync,
  };
}

/** Panel-wide note shown while `enabledModels` narrows the selector. */
export function EnabledModelsBanner({ controller }: { controller: EnabledModelsController }) {
  const { t } = useI18n();
  const { view, pending, loading, failure } = controller;
  // This owner survives managed/custom/model-detail navigation, even with no runtime provider.
  if (failure?.readback) return <div role="alert" className="enabled-models-error">
    <div>{t(view ? "models.readbackStale" : "models.readbackUnavailable")}</div>
    {(failure.messageKey || failure.message) && <div>{failure.messageKey ? t(failure.messageKey) : failure.message}</div>}
    <div>{failure.readbackMessage}</div>
    <ConfigButton size="small" onClick={controller.refresh} title={t("models.retryReadback")}>{t("models.enabledRetry")}</ConfigButton>
  </div>;
  if (!view) return null;
  const scoped = !view.allEnabled;
  const stale = view.stalePatterns.length;
  if (!scoped && stale === 0) return null;

  return (
    <div className="enabled-models-banner">
      <span
        className="enabled-models-banner-text"
        {...(stale > 0 ? { title: t("models.enabledStaleHint") } : {})}
      >
        {/* Name the setting and the file that holds it: the count alone left
            the user guessing where the panel wrote, and both read the same in
            every language. A long path is what gets cut, never the numbers. */}
        <code className="enabled-models-banner-key" title={view.settingsPath}>
          {view.settingsPath}
        </code>
        <code className="enabled-models-banner-facts">
          {`· enabledModels ${view.enabledTotal}/${view.availableTotal}`}
          {stale > 0 && ` · ${t("models.enabledStale", { count: stale })}`}
        </code>
      </span>
      {view.editable && stale > 0 && (
        <ConfigButton
          size="small"
          onClick={controller.pruneStale}
          disabled={pending !== null || loading || failure?.readback}
          title={t("models.enabledPruneHint")}
        >
          {t("models.enabledPrune")}
        </ConfigButton>
      )}
      {view.editable && scoped && (
        <ConfigButton
          size="small"
          onClick={controller.clearScope}
          disabled={pending !== null || loading || failure?.readback}
          title={t("models.enabledClearHint")}
        >
          {t("models.enabledClear")}
        </ConfigButton>
      )}
    </div>
  );
}

/**
 * The single switch a models.json provider gets, for its detail header next to
 * the provider's own buttons.
 *
 * Such a provider has no rows of its own — the panel edits its models directly
 * — so this switch is the whole control, and it is checked only while every one
 * of those models is enabled. Why it cannot move is a tooltip, not a paragraph.
 */
export function EnabledModelsProviderSwitch({
  providerId,
  controller,
}: {
  providerId: string;
  controller: EnabledModelsController;
}) {
  const { t } = useI18n();
  const { view, loading, pending, failure } = controller;
  const provider = findProviderView(view, providerId);
  const message = failure && !failure.readback ? (failure.messageKey ? t(failure.messageKey) : failure.message) : null;

  if (loading && !view) return null;
  // Missing from the runtime: edits not saved yet, no models, or a key that
  // does not work — never a sign-in, so do not send the user looking for one.
  if (!provider) {
    return (
      <ConfigSwitch
        checked={false}
        disabled
        label={t("models.enabledCustomEmpty")}
        onChange={() => {}}
      />
    );
  }

  const toggle = enabledModelsProviderToggle(view, provider);
  return (
    <>
      {message && <span className="enabled-models-switch-error">{message}</span>}
      <ConfigSwitch
        checked={toggle.checked}
        loading={pending === `provider:${provider.id}`}
        disabled={pending !== null || loading || failure?.readback || toggle.blocked}
        label={toggle.reason
          ? t(FAILURE_KEYS[toggle.reason])
          : t("models.enabledProviderToggle", { provider: provider.name })}
        onChange={(checked) => controller.setProvider(provider.id, checked)}
      />
    </>
  );
}

/** Per-model switches for a provider that owns its own model list. */
/**
 * State for the "refresh catalog" button.
 *
 * pi's built-in model lists are frozen at the SDK version brabbler pins, so a
 * model a provider shipped after that release only appears once the pi.dev
 * catalog overlay has been fetched — see `lib/model-catalog-refresh.ts` (#914).
 * The button is the whole feature: nothing refreshes catalogs on its own.
 */
function useCatalogRefresh(providerId: string, accounts: EnabledModelsController["accounts"], onChanged: () => void) {
  const task = useSettingsTask();
  const [refreshing, setRefreshing] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const identity = JSON.stringify([providerId, accounts]);
  const generation = useRef(0);
  const identityRef = useRef(identity);
  if (identityRef.current !== identity) { identityRef.current = identity; generation.current++; }
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; generation.current++; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setNote(null); setRefreshing(false); }, [identity]);

  const refresh = useCallback(() => {
    if (accounts === null) return;
    const version = ++generation.current;
    const current = () => mounted.current && version === generation.current;
    setRefreshing(true);
    setNote(null);
    void task("enabled.catalog", async () => {
      try {
        const res = await fetch("/api/models/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerId, accounts: accounts ?? {} }),
        });
        const data = await res.json() as CatalogRefreshResponse;
        if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
        // The Settings controller survives detail remounts and checks its own
        // current account context. Only this detail's feedback needs its mount.
        if (!data.reason) onChanged();
        if (!current()) return;
        if (data.reason === "offline") setNote("models.catalogOffline");
        else if (!data.completed) setNote("models.catalogUnreachable");
        else setNote(data.changed ? "models.catalogUpdated" : "models.catalogUnchanged");
      } catch {
        if (current()) setNote("models.catalogUnreachable");
      } finally {
        if (current()) setRefreshing(false);
      }
    })();
  }, [providerId, accounts, identity, onChanged, task]);

  return { refreshing, note, refresh };
}

export function EnabledModelsSection({
  providerId,
  controller,
  contextSettings,
}: {
  providerId: string;
  controller: EnabledModelsController;
  contextSettings?: ModelContextSettings;
}) {
  const { t } = useI18n();
  const contextNoteId = useId();
  const thinkingNoteId = useId();
  const [query, setQuery] = useState("");
  const { view, loading, pending, failure } = controller;
  const provider = findProviderView(view, providerId);
  const catalog = useCatalogRefresh(providerId, controller.accounts, controller.catalogRefreshCompleted);

  useEffect(() => setQuery(""), [providerId]);

  if (loading && !view) {
    return <div className="enabled-models-empty">{t("agents.modelsLoading")}</div>;
  }
  if (!provider) {
    if (failure?.readback) return null; // The persistent banner owns read recovery.
    return failure ? <div>
      <div role="alert" className="enabled-models-error">{failure.messageKey ? t(failure.messageKey) : failure.message}</div>
      <ConfigButton size="small" onClick={controller.refresh}>{t("models.enabledRetry")}</ConfigButton>
    </div> : <div className="enabled-models-empty">{t("models.enabledUnavailable")}</div>;
  }

  const shown = filterEnabledModels(provider.models, query);
  const bulk = enabledModelsBulkActions(view, shown);
  const filtered = shown.length !== provider.models.length;
  const busy = pending !== null || loading || failure?.readback === true;
  const bulkKey = `provider:${provider.id}`;
  // A provider-wide action is resolved server-side so models the browser has
  // not seen yet follow it too; a filtered action names its rows explicitly.
  const runBulk = (enabled: boolean, refs: string[]) => {
    if (filtered) controller.setModels(bulkKey, refs, enabled);
    else controller.setProvider(provider.id, enabled);
  };

  return (
    <div className="enabled-models-section">
      <div className="enabled-models-header">
        <span className="enabled-models-title">{t("models.enabledSection")}</span>
        <span className="enabled-models-count">
          {t("models.enabledCount", { enabled: provider.enabledCount, total: provider.models.length })}
        </span>
        <ConfigButton
          size="small"
          disabled={busy || !bulk.canEnable}
          onClick={() => runBulk(true, bulk.enableRefs)}
        >
          {filtered ? t("models.enableShown") : t("models.enableAll")}
        </ConfigButton>
        <ConfigButton
          size="small"
          disabled={busy || !bulk.canDisable}
          title={!bulk.canDisable && bulk.disableRefs.length > 0 ? t("models.enabledLastModel") : undefined}
          onClick={() => runBulk(false, bulk.disableRefs)}
        >
          {filtered ? t("models.disableShown") : t("models.disableAll")}
        </ConfigButton>
        <ConfigButton
          size="small"
          disabled={busy || catalog.refreshing}
          title={t("models.refreshCatalogHint")}
          onClick={catalog.refresh}
        >
          {catalog.refreshing ? t("models.refreshingCatalog") : t("models.refreshCatalog")}
        </ConfigButton>
      </div>

      {catalog.note && <div role="status" className="enabled-models-note enabled-models-catalog-note">{t(catalog.note)}</div>}

      {!view?.editable && <div className="enabled-models-note">{t("models.enabledProjectScope")}</div>}
      {failure && !failure.readback && (
        <div role="alert" className="enabled-models-error">
          {failure.messageKey ? t(failure.messageKey) : failure.message}
        </div>
      )}

      {provider.models.length > 8 && (
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("models.enabledFilterPlaceholder", { count: provider.models.length })}
          aria-label={t("models.enabledFilter")}
          className="enabled-models-filter"
        />
      )}
      {contextSettings && <div id={contextNoteId} className="enabled-models-note">{t("models.contextOverrideHelp")}</div>}
      <div id={thinkingNoteId} className="enabled-models-note">{t("models.rowSaveHelp")}</div>
      <div className={`enabled-models-list${contextSettings ? " has-context" : ""}`}>
        <div className="enabled-models-columns" aria-hidden="true">
          <span>{t("models.rowModel")}</span>
          {contextSettings && <span>{t("models.rowContext")}</span>}
          <span>{t("models.rowThinking")}</span>
          <span>{t("models.rowEnabled")}</span>
        </div>
        {shown.length === 0 ? (
          <div className="enabled-models-empty">{t("models.enabledNoMatches")}</div>
        ) : shown.map((model) => {
          const lastOne = isLastEnabledModel(view, model);
          const override = contextSettings?.overrides?.[model.id];
          const contextValue = override && typeof override === "object" && !Array.isArray(override)
            ? (override as Record<string, unknown>).contextWindow : undefined;
          return (
            <div key={model.ref} className="enabled-models-row">
              <span className="enabled-models-row-text">
                <span className="enabled-models-row-name">{model.name}</span>
                <code className="enabled-models-row-id">{model.id}</code>
              </span>
              {contextSettings && <label className="enabled-models-context">
                <span className="enabled-models-mobile-label">{t("models.rowContext")}</span>
                <ModelContextWindow
                  modelName={model.name}
                  effective={model.contextWindow}
                  value={contextValue}
                  disabled={contextSettings.disabled}
                  describedBy={contextNoteId}
                  onChange={(value) => contextSettings.onChange(model.id, value)}
                />
              </label>}
              <label className="model-thinking-control">
                <span className="enabled-models-mobile-label">{t("models.rowThinking")}</span>
                <select className="model-thinking-select" aria-label={t("models.thinkingForModel", { model: model.name })}
                  aria-describedby={thinkingNoteId} aria-busy={pending === `thinking:${model.ref}` || undefined}
                  value={model.thinking?.sharedLevel ?? ""} disabled={busy || loading || !model.thinking}
                  onChange={(event) => controller.setModelThinking(provider.id, model.id, (event.target.value || null) as ThinkingLevel | null)}>
                  <option value="">{t("models.thinkingInherit", { level: model.thinking?.inheritedLevel ?? "medium" })}</option>
                  {model.thinking?.sharedLevel && !model.thinking.supportedLevels.includes(model.thinking.sharedLevel) && (
                    <option value={model.thinking.sharedLevel} disabled>{t("models.thinkingUnsupported", { level: model.thinking.sharedLevel })}</option>
                  )}
                  {model.thinking?.supportedLevels.map((level) => <option key={level} value={level}>{level}</option>)}
                </select>
                {model.thinkingPin ? <span className="model-thinking-source" title={t("models.enabledPinHint")}>
                  {t("models.thinkingPinned")} <span className="enabled-models-pin">{model.thinkingPin}</span>
                </span> : model.thinking?.projectLevel && <span className="model-thinking-source">
                  {t("models.thinkingProject", { level: model.thinking.projectLevel })}
                </span>}
              </label>
              <ConfigSwitch
                checked={model.enabled}
                loading={pending === model.ref}
                disabled={busy || !view?.editable || lastOne}
                label={lastOne
                  ? t("models.enabledLastModel")
                  : t("models.enabledToggle", { model: model.name })}
                onChange={(checked) => controller.setModels(model.ref, [model.ref], checked)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
