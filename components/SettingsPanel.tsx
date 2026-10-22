"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useTheme } from "@/hooks/useTheme";
import { THEME_OPTIONS } from "@/lib/theme";
import { TITLE_LANGUAGES, type TitleLanguage } from "@/lib/title-language-options";
import type { TitleModelSelection } from "@/lib/title-language";
import { FontSettings } from "./FontSettings";
import { SshSettings } from "./SshSettings";
import type { SshAgentController } from "@/hooks/useSshAgent";
import {
  CHAT_CONTENT_WIDTH_DEFAULT,
  CHAT_CONTENT_WIDTH_MAX,
  CHAT_CONTENT_WIDTH_MIN,
  CHAT_CONTENT_FONT_SIZE_DEFAULT,
  CHAT_CONTENT_FONT_SIZE_MAX,
  CHAT_CONTENT_FONT_SIZE_MIN,
  useChatAppearance,
} from "@/hooks/useChatAppearance";
import { sendAgentCommand } from "@/lib/agent-client";
import type { ProjectTrustStatus, ShellToolSettingsResponse } from "@/lib/api-types";
import {
  setLastSettingsSection,
  type SettingsSection,
} from "@/lib/settings-navigation";
import {
  isThinkingExpandedByDefault,
  setThinkingExpandedByDefault,
} from "@/lib/thinking-expansion-preference";
import { ModelsConfig } from "./ModelsConfig";
import { setupPushSubscription } from "@/lib/push-client";
import { SkillsConfig } from "./SkillsConfig";
import { AgentsConfig } from "./AgentsConfig";
import { PluginsConfig } from "./PluginsConfig";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";
import { ProjectPrivacySettings } from "./ProjectPrivacySettings";
import type { ProjectPrivacy } from "@/hooks/useHiddenProjects";
import type { SessionInfo } from "@/lib/types";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  initialSection: SettingsSection;
  initialPluginScope?: "global" | "project" | "session";
  onClose: () => void;
  onSessionReloaded: () => void;
  trustStatus: ProjectTrustStatus | null;
  onManageTrust: () => void;
  quoteSelectionEnabled: boolean;
  onQuoteSelectionChange: (enabled: boolean) => void;
  sessions: readonly SessionInfo[];
  privacy: ProjectPrivacy;
  sshController: SshAgentController;
}

export function SettingsSectionIcon({ section, size = 16, strokeWidth = 1.8 }: { section: SettingsSection; size?: number; strokeWidth?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "settings-section-icon",
  };

  if (section === "general") return <svg {...common}><path d="M20 7h-9M14 17H5" /><circle cx="7" cy="7" r="3" /><circle cx="17" cy="17" r="3" /></svg>;
  if (section === "ssh") return <svg {...common}><circle cx="8" cy="9" r="5" /><path d="m12 13 9 9m-4-4 3-3m-6 0 3-3" /></svg>;
  if (section === "models") return <svg {...common}><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" /></svg>;
  if (section === "skills") return <svg {...common}><path d="m12 2-10 5 10 5 10-5-10-5Z" /><path d="m2 12 10 5 10-5M2 17l10 5 10-5" /></svg>;
  if (section === "agents") return <svg {...common} className="settings-section-icon is-agent"><rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" /></svg>;
  return <svg {...common}><path d="M9 7V2M15 7V2M6 13V8a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5a6 6 0 0 1-12 0ZM12 19v3" /></svg>;
}

function GeneralSettings({ cwd, sessionId, onSessionReloaded, trustStatus, onManageTrust, quoteSelectionEnabled, onQuoteSelectionChange, sessions, privacy }: Pick<Props, "cwd" | "sessionId" | "onSessionReloaded" | "trustStatus" | "onManageTrust" | "quoteSelectionEnabled" | "onQuoteSelectionChange" | "sessions" | "privacy">) {
  const { locale, t } = useI18n();
  const { preference, setThemePreference } = useTheme();
  const { width: chatContentWidth, setWidth: setChatContentWidth, fullWidth, setFullWidth, fontSize, setFontSize } = useChatAppearance();
  const [shellSettings, setShellSettings] = useState<ShellToolSettingsResponse | null>(null);
  const [shellSaving, setShellSaving] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [titleLanguage, setTitleLanguage] = useState<TitleLanguage | null>(null);
  const [titleLanguageSaving, setTitleLanguageSaving] = useState(false);
  const [titleLanguageError, setTitleLanguageError] = useState<string | null>(null);
  const [titleModel, setTitleModel] = useState<TitleModelSelection | null | undefined>(undefined);
  const [titleModels, setTitleModels] = useState<Array<TitleModelSelection & { name: string }>>([]);
  const [titleModelSaving, setTitleModelSaving] = useState(false);
  const [titleModelError, setTitleModelError] = useState<string | null>(null);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const [pushRegistering, setPushRegistering] = useState(false);
  const [pushStatus, setPushStatus] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const [webAuthEnabled, setWebAuthEnabled] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    setThinkingExpanded(isThinkingExpandedByDefault());
    void fetch("/api/web-auth")
      .then((response) => response.ok ? response.json() : null)
      .then((data: { enabled?: boolean } | null) => setWebAuthEnabled(data?.enabled === true))
      .catch(() => {});
  }, []);

  const logOut = async () => {
    setLoggingOut(true);
    setLogoutError("");
    try {
      const response = await fetch("/api/web-auth", { method: "DELETE" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      window.location.replace("/login");
    } catch {
      setLogoutError(t("auth.logoutFailed"));
    } finally {
      setLoggingOut(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/tools/settings")
      .then(async (response) => {
        const data = await response.json() as ShellToolSettingsResponse & { error?: string };
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        if (!cancelled) setShellSettings(data);
      })
      .catch((cause) => {
        if (!cancelled) setShellError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/sessions/title-language")
      .then(async (response) => {
        const data = await response.json() as { language?: TitleLanguage; error?: string };
        if (!response.ok || !data.language || !TITLE_LANGUAGES.includes(data.language)) {
          throw new Error(data.error ?? `HTTP ${response.status}`);
        }
        if (!cancelled) setTitleLanguage(data.language);
      })
      .catch((cause) => {
        if (!cancelled) setTitleLanguageError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      fetch("/api/sessions/title-model").then(async (response) => {
        const data = await response.json() as { model?: TitleModelSelection | null; error?: string };
        if (!response.ok || data.model === undefined) throw new Error(data.error ?? `HTTP ${response.status}`);
        return data.model;
      }),
      cwd ? fetch(`/api/models?${new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) })}`)
        .then(async (response) => {
          const data = await response.json() as { modelList?: Array<TitleModelSelection & { id: string; name: string }>; error?: string };
          if (!response.ok || !data.modelList) throw new Error(data.error ?? `HTTP ${response.status}`);
          return data.modelList.map(({ provider, id, name }) => ({ provider, modelId: id, name }));
        }) : Promise.resolve([] as Array<TitleModelSelection & { name: string }>),
    ]).then(([setting, catalog]) => {
      if (cancelled) return;
      if (setting.status === "fulfilled") setTitleModel(setting.value);
      if (catalog.status === "fulfilled") setTitleModels(catalog.value);
      const cause = setting.status === "rejected" ? setting.reason : catalog.status === "rejected" ? catalog.reason : null;
      setTitleModelError(cause ? cause instanceof Error ? cause.message : String(cause) : null);
    });
    return () => { cancelled = true; };
  }, [cwd, sessionId]);

  const updateTitleModel = async (model: TitleModelSelection | null) => {
    if (titleModelSaving) return;
    setTitleModelSaving(true);
    setTitleModelError(null);
    try {
      const response = await fetch("/api/sessions/title-model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });
      const data = await response.json() as { model?: TitleModelSelection | null; error?: string };
      if (!response.ok || data.model === undefined) throw new Error(data.error ?? `HTTP ${response.status}`);
      setTitleModel(data.model);
    } catch (cause) {
      setTitleModelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTitleModelSaving(false);
    }
  };

  const updateTitleLanguage = async (language: TitleLanguage) => {
    if (titleLanguageSaving) return;
    setTitleLanguageSaving(true);
    setTitleLanguageError(null);
    try {
      const response = await fetch("/api/sessions/title-language", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      const data = await response.json() as { language?: TitleLanguage; error?: string };
      if (!response.ok || data.language !== language) throw new Error(data.error ?? `HTTP ${response.status}`);
      setTitleLanguage(language);
    } catch (cause) {
      setTitleLanguageError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setTitleLanguageSaving(false);
    }
  };

  const togglePowerShell = async (enabled: boolean) => {
    setShellSaving(true);
    setShellError(null);
    try {
      const response = await fetch("/api/tools/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await response.json() as ShellToolSettingsResponse & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setShellSettings(data);
      if (sessionId) {
        await sendAgentCommand(sessionId, { type: "reload" });
        onSessionReloaded();
      }
    } catch (cause) {
      setShellError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setShellSaving(false);
    }
  };

  const registerPush = async () => {
    if (pushRegistering) return;
    setPushRegistering(true);
    setPushStatus(null);
    try {
      if (typeof window === "undefined" || !("Notification" in window)) {
        throw new Error("unsupported or not permitted");
      }
      const permission = Notification.permission === "default"
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== "granted") throw new Error("unsupported or not permitted");
      const ok = await setupPushSubscription(locale);
      if (!ok) throw new Error("unsupported or not permitted");
      setPushStatus({ kind: "ok", message: t("settings.pushRegistered") });
    } catch (cause) {
      setPushStatus({ kind: "error", message: `${t("settings.pushRegisterFailed")} ${cause instanceof Error ? cause.message : String(cause)}` });
    } finally {
      setPushRegistering(false);
    }
  };

  return (
    <div className="settings-general">
      <h2 className="settings-general-title">{t("settings.general")}</h2>
      {cwd && <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("trust.dialogTitle")}</h3>
        <p className="settings-general-description">{trustStatus?.scope === "denied" ? t("trust.status.denied")
          : trustStatus?.repositoryTrusted && trustStatus.worktreeDecision === true ? t("trust.status.both")
          : trustStatus?.repositoryTrusted ? t("trust.status.repository")
          : trustStatus?.scope ? t(`trust.status.${trustStatus.scope}`) : t("trust.status.none")}</p>
        <ConfigButton onClick={onManageTrust} disabled={!trustStatus}>{t("trust.manage")}</ConfigButton>
      </section>}

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.appearance")}</h3>
        <div role="radiogroup" aria-label={t("settings.appearance")} className="settings-theme-options">
          {THEME_OPTIONS.map((option) => {
            const selected = preference === option.id;
            return (
              <label
                key={option.id}
                className="settings-theme-option"
                data-system={option.id === "auto" || undefined}
                data-wide={option.id === "contrast-light" || option.id === "contrast-dark" || option.id === "zenburn" || undefined}
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.id}
                  checked={selected}
                  onChange={() => setThemePreference(option.id)}
                  className="sr-only"
                />
                {option.id === "auto" ? (
                  <span className="settings-theme-swatch settings-theme-system" aria-hidden="true">
                    <span data-theme="light" className="settings-theme-chip" />
                    <span data-theme="dark" className="settings-theme-chip" />
                    <span className="settings-theme-system-name">{t(option.label)}</span>
                  </span>
                ) : (
                  <span className="settings-theme-swatch" aria-hidden="true">
                    <span data-theme={option.id} className="settings-theme-fill">
                      <span className="settings-theme-name">{t(option.label)}</span>
                    </span>
                  </span>
                )}
                <span className="sr-only">{t(option.label)}</span>
              </label>
            );
          })}
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.typography")}</h3>
        <p id="settings-typography-description" className="settings-general-description">{t("settings.fontDescription")}</p>
        <div className="settings-chat-options">
          <FontSettings />
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <span>{t("settings.chatFullWidth")}</span>
              <ConfigSwitch
                checked={fullWidth}
                label={t("settings.chatFullWidth")}
                onChange={setFullWidth}
              />
            </div>
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-width">{t("settings.chatContentWidth")}</label>
              <output htmlFor="settings-chat-content-width">{chatContentWidth}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentWidth")}
                aria-label={t("settings.resetChatContentWidth")}
                disabled={chatContentWidth === CHAT_CONTENT_WIDTH_DEFAULT}
                onClick={() => setChatContentWidth(CHAT_CONTENT_WIDTH_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-width"
              type="range"
              min={CHAT_CONTENT_WIDTH_MIN}
              max={CHAT_CONTENT_WIDTH_MAX}
              step={10}
              value={chatContentWidth}
              onChange={(event) => setChatContentWidth(Number(event.target.value))}
            />
          </div>
          <div className="settings-chat-option settings-chat-range-option">
            <div className="settings-chat-range-header">
              <label htmlFor="settings-chat-content-font-size">{t("settings.chatContentFontSize")}</label>
              <output htmlFor="settings-chat-content-font-size">{fontSize}px</output>
              <ConfigButton
                variant="ghost"
                size="small"
                className="settings-chat-reset"
                title={t("settings.resetChatContentFontSize")}
                aria-label={t("settings.resetChatContentFontSize")}
                disabled={fontSize === CHAT_CONTENT_FONT_SIZE_DEFAULT}
                onClick={() => setFontSize(CHAT_CONTENT_FONT_SIZE_DEFAULT)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5" />
                </svg>
              </ConfigButton>
            </div>
            <input
              id="settings-chat-content-font-size"
              type="range"
              min={CHAT_CONTENT_FONT_SIZE_MIN}
              max={CHAT_CONTENT_FONT_SIZE_MAX}
              step={1}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
            />
          </div>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.chat")}</h3>
        <div className="settings-chat-options">
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.thinkingExpandedDefault")}</span>
            <ConfigSwitch
              checked={thinkingExpanded}
              label={t("settings.thinkingExpandedDefault")}
              onChange={(enabled) => {
                setThinkingExpandedByDefault(enabled);
                setThinkingExpanded(enabled);
              }}
            />
          </div>
          <div className="settings-chat-option settings-chat-switch-option">
            <span>{t("settings.quoteSelection")}</span>
            <ConfigSwitch
              checked={quoteSelectionEnabled}
              label={t("settings.quoteSelection")}
              onChange={onQuoteSelectionChange}
            />
          </div>
        </div>
      </section>

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.titleLanguage")}</h3>
        <p className="settings-general-description">{t("settings.titleLanguageDescription")}</p>
        <div className="settings-shell-option">
          <label htmlFor="settings-title-language">{t("settings.titleLanguage")}</label>
          <select
            id="settings-title-language"
            className="settings-title-language-select"
            value={titleLanguage ?? "auto"}
            disabled={titleLanguage === null || titleLanguageSaving}
            onChange={(event) => void updateTitleLanguage(event.target.value as TitleLanguage)}
          >
            {TITLE_LANGUAGES.map((language) => (
              <option key={language} value={language}>{t(`settings.titleLanguage.${language}`)}</option>
            ))}
          </select>
        </div>
        {titleLanguageError && <p role="alert" className="settings-general-error">{titleLanguageError}</p>}
        <p className="settings-general-description">{t("settings.titleModelDescription")}</p>
        {!cwd && <p className="settings-general-description">{t("settings.projectRequired")}</p>}
        <div className="settings-shell-option">
          <label htmlFor="settings-title-model">{t("settings.titleModel")}</label>
          <select
            id="settings-title-model"
            className="settings-title-language-select"
            value={titleModel ? JSON.stringify([titleModel.provider, titleModel.modelId]) : ""}
            disabled={titleModel === undefined || titleModelSaving}
            onChange={(event) => {
              const selected = titleModels.find((entry) => JSON.stringify([entry.provider, entry.modelId]) === event.target.value);
              void updateTitleModel(selected ? { provider: selected.provider, modelId: selected.modelId } : null);
            }}
          >
            <option value="">{t("settings.titleModelSession")}</option>
            {titleModel && !titleModels.some((entry) => entry.provider === titleModel.provider && entry.modelId === titleModel.modelId) && (
              <option value={JSON.stringify([titleModel.provider, titleModel.modelId])} disabled>
                {titleModel.provider}/{titleModel.modelId} ({t("settings.titleModelUnavailable")})
              </option>
            )}
            {titleModels.map((entry) => (
              <option key={JSON.stringify([entry.provider, entry.modelId])} value={JSON.stringify([entry.provider, entry.modelId])}>
                {entry.provider} / {entry.name || entry.modelId}
              </option>
            ))}
          </select>
        </div>
        {titleModelError && <p role="alert" className="settings-general-error">{titleModelError}</p>}
      </section>

      {shellSettings?.isWindows && (
        <section className="settings-general-section">
          <h3 className="settings-general-heading">{t("settings.shellTool")}</h3>
          <p className="settings-general-description">{t("settings.shellToolDescription")}</p>
          <div className="settings-shell-option">
            <span>{t("settings.usePowerShell")}</span>
            <ConfigSwitch
              checked={shellSettings.powerShellEnabled}
              loading={shellSaving}
              label={t("settings.usePowerShell")}
              onChange={(enabled) => void togglePowerShell(enabled)}
            />
          </div>
          {shellError && <p role="alert" className="settings-general-error">{shellError}</p>}
        </section>
      )}

      <section className="settings-general-section">
        <h3 className="settings-general-heading">{t("settings.pushPermission")}</h3>
        <p className="settings-general-description">{t("settings.pushPermissionDescription")}</p>
        <div className="settings-shell-option">
          <span>{t("settings.pushPermission")}</span>
          <button
            type="button"
            className="config-button config-button-small config-button-secondary"
            disabled={pushRegistering}
            onClick={() => void registerPush()}
          >
            {pushRegistering ? t("settings.pushRegisterLoading") : t("settings.pushRegister")}
          </button>
        </div>
        {pushStatus && (
          <p
            role="status"
            className="settings-general-error"
            style={pushStatus.kind === "ok" ? { color: "var(--accent)" } : undefined}
          >
            {pushStatus.message}
          </p>
        )}
      </section>

      <ProjectPrivacySettings sessions={sessions} privacy={privacy} />

      {webAuthEnabled && (
        <section className="settings-general-section">
          <ConfigButton variant="secondary" disabled={loggingOut} onClick={() => void logOut()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 17l5-5-5-5M15 12H3M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            </svg>
            {loggingOut ? t("auth.loggingOut") : t("auth.logOut")}
          </ConfigButton>
          {logoutError && <p role="alert" className="settings-general-error">{logoutError}</p>}
        </section>
      )}
    </div>
  );
}

export function SettingsPanel({ cwd, sessionId, initialSection, initialPluginScope, onClose, onSessionReloaded, trustStatus, onManageTrust, quoteSelectionEnabled, onQuoteSelectionChange, sessions, privacy, sshController }: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [mountedSections, setMountedSections] = useState<ReadonlySet<SettingsSection>>(
    () => new Set([section]),
  );
  const sections: { id: SettingsSection; label: string; requiresProject: boolean }[] = [
    { id: "general", label: t("settings.general"), requiresProject: false },
    { id: "models", label: t("common.models"), requiresProject: false },
    { id: "ssh", label: t("sshAgent.title"), requiresProject: false },
    { id: "skills", label: t("common.skills"), requiresProject: true },
    { id: "agents", label: t("common.agents"), requiresProject: true },
    { id: "plugins", label: t("common.plugins"), requiresProject: true },
  ];

  useEffect(() => setLastSettingsSection(initialSection), [initialSection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (cwd || (section !== "skills" && section !== "agents" && section !== "plugins")) return;
    setSection("general");
    setMountedSections((current) => new Set(current).add("general"));
    setLastSettingsSection("general");
  }, [cwd, section]);

  const activateSection = (nextSection: SettingsSection) => {
    setMountedSections((current) => new Set(current).add(nextSection));
    setSection(nextSection);
    setLastSettingsSection(nextSection);
  };

  const sectionHost = (id: SettingsSection, content: ReactNode) => mountedSections.has(id) ? (
    <div
      key={id}
      hidden={section !== id}
      className="settings-section-host"
    >
      {content}
    </div>
  ) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="settings-dialog-backdrop"
    >
      <div className="settings-dialog-surface">
        <div className="settings-dialog-header">
          <strong className="settings-dialog-title">{t("settings.title")}</strong>
          <select
            aria-label={t("settings.title")}
            value={section}
            onChange={(event) => activateSection(event.target.value as SettingsSection)}
            className="settings-mobile-section-picker"
          >
            {sections.map((item) => (
              <option key={item.id} value={item.id} disabled={item.requiresProject && !cwd}>
                {item.label}
              </option>
            ))}
          </select>
          <nav aria-label={t("settings.title")} className="settings-section-tabs">
            {sections.map((item) => {
              const selected = section === item.id;
              const disabled = item.requiresProject && !cwd;
              return (
                <button
                  key={item.id}
                  type="button"
                  className="settings-section-tab"
                  disabled={disabled}
                  title={disabled ? t("settings.projectRequired") : item.label}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => activateSection(item.id)}
                >
                  <SettingsSectionIcon section={item.id} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <button type="button" onClick={onClose} title={t("i18n.close")} aria-label={t("i18n.close")} className="config-close-button settings-dialog-close">×</button>
        </div>

        <main className="settings-dialog-main">
          {sectionHost("general", <GeneralSettings cwd={cwd} sessionId={sessionId} onSessionReloaded={onSessionReloaded} trustStatus={trustStatus} onManageTrust={onManageTrust} quoteSelectionEnabled={quoteSelectionEnabled} onQuoteSelectionChange={onQuoteSelectionChange} sessions={sessions} privacy={privacy} />)}
          {sectionHost("models", <ModelsConfig embedded cwd={cwd} onClose={onClose} />)}
          {sectionHost("ssh", <SshSettings controller={sshController} active={section === "ssh"} />)}
          {cwd && sectionHost("skills", <SkillsConfig embedded key={cwd} cwd={cwd} onClose={onClose} />)}
          {cwd && sectionHost("agents", <AgentsConfig embedded key={cwd} cwd={cwd} sessionId={sessionId} onClose={onClose} onReloaded={onSessionReloaded} />)}
          {cwd && sectionHost("plugins", <PluginsConfig embedded key={`${cwd}:${sessionId ?? ""}`} cwd={cwd} sessionId={sessionId} initialPluginScope={initialPluginScope} onClose={onClose} onReloaded={onSessionReloaded} />)}
        </main>
      </div>
    </div>
  );
}
