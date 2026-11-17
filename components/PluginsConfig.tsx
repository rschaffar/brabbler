"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { BundledPluginSettings, BundledPluginSidebar } from "./plugin-ui/BundledPluginSettings";
import {
  getLastSettingsSelection,
  setLastSettingsSelection,
} from "@/lib/settings-navigation";
import {
  ConfigButton,
  ConfigDetail,
  ConfigDetailStack,
  ConfigEmptyState,
  ConfigFooter,
  ConfigPanelShell,
  ConfigSidebar,
  ConfigSidebarList,
  ConfigSplitView,
} from "./SettingsUi";

export function PluginsConfig({
  cwd,
  sessionId,
  onClose,
  embedded = false,
  initialPluginScope,
}: {
  cwd: string;
  sessionId: string | null;
  initialPluginScope?: "global" | "project" | "session";
  onClose: () => void;
  embedded?: boolean;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<string | null>(() => {
    const remembered = getLastSettingsSelection("plugins", cwd);
    return remembered?.startsWith("bundled:") ? remembered : null;
  });

  useEffect(() => {
    if (selected) setLastSettingsSelection("plugins", selected, cwd);
  }, [cwd, selected]);

  return (
    <ConfigPanelShell embedded={embedded} title={t("common.plugins")} subtitle={cwd.replace(/^\/(?:Users|home)\/[^/]+/, "~")} closeLabel={t("i18n.close")} onClose={onClose}>
      <ConfigSplitView>
        <ConfigSidebar>
          <ConfigSidebarList>
            <BundledPluginSidebar cwd={cwd} sessionId={sessionId} selected={selected} onSelect={setSelected} />
          </ConfigSidebarList>
        </ConfigSidebar>
        <ConfigDetail>
          <ConfigDetailStack className="is-fill">
            {selected ? (
              <BundledPluginSettings key={selected} cwd={cwd} sessionId={sessionId} id={selected.slice(8)} initialScope={initialPluginScope} />
            ) : (
              <ConfigEmptyState>{t("plugins.selectBuiltin")}</ConfigEmptyState>
            )}
          </ConfigDetailStack>
        </ConfigDetail>
      </ConfigSplitView>
      <ConfigFooter>
        {!embedded && <ConfigButton onClick={onClose}>{t("i18n.close")}</ConfigButton>}
      </ConfigFooter>
    </ConfigPanelShell>
  );
}
