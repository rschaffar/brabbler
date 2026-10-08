"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ProjectPrivacy } from "@/hooks/useHiddenProjects";
import { getRecentProjects } from "@/lib/project-groups";
import { hasResolvedProjectIdentity } from "@/lib/hidden-projects";
import type { SessionInfo } from "@/lib/types";
import { ConfigButton, ConfigSwitch } from "./SettingsUi";

export function ProjectPrivacySettings({ sessions, privacy }: { sessions: readonly SessionInfo[]; privacy: ProjectPrivacy }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const projects = useMemo(() => {
    const known = new Map(getRecentProjects(sessions.filter(hasResolvedProjectIdentity)).map(({ key, root }) => [key, root]));
    // Keep saved entries editable even when their last session disappears.
    for (const key of privacy.keys ?? []) if (!known.has(key)) known.set(key, key);
    const query = search.trim().toLocaleLowerCase();
    return [...known].map(([key, root]) => ({ key, root, name: root.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) || root }))
      .filter(({ name, root }) => !query || `${name}\n${root}`.toLocaleLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name) || a.root.localeCompare(b.root));
  }, [sessions, privacy.keys, search]);

  return <section className="settings-general-section" aria-label={t("privacy.title")}>
    <h3 className="settings-general-heading">{t("privacy.title")}</h3>
    <h4 className="settings-general-heading">{t("privacy.hiddenProjects")}</h4>
    <p className="settings-general-description">{t("privacy.description")}</p>
    <p className="settings-general-description">{t("privacy.scope")}</p>
    {privacy.error && <p role="alert" className="settings-general-error">
      {t("privacy.unavailable")} <ConfigButton variant="secondary" size="small" onClick={privacy.refresh}>{t("privacy.retry")}</ConfigButton>
    </p>}
    {!privacy.keys && !privacy.error && <p role="status">{t("privacy.loading")}</p>}
    {privacy.keys && <>
      <input type="search" className="project-privacy-search" aria-label={t("privacy.search")} placeholder={t("privacy.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
      <div className="project-privacy-list">
        {projects.map(({ key, root, name }) => <div className="project-privacy-row" key={key}>
          <div className="project-privacy-info"><strong>{name}</strong><small title={root}>{root}</small></div>
          <ConfigSwitch checked={privacy.keys!.has(key)} disabled={privacy.pendingKey !== null} loading={privacy.pendingKey === key} label={t("privacy.hideProject", { name: `${name} · ${root}` })} onChange={(hidden) => privacy.setHidden(key, hidden)} />
        </div>)}
        {projects.length === 0 && <p className="settings-general-description">{t("privacy.noProjects")}</p>}
      </div>
    </>}
  </section>;
}
