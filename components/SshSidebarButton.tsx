"use client";

import { useI18n } from "@/hooks/useI18n";
import type { SshAgentController } from "@/hooks/useSshAgent";

/** Passive global status only; opening Settings is the sole action here. */
export function SshSidebarButton({ controller: c, onOpen }: { controller: SshAgentController; onOpen: () => void }) {
  const { t } = useI18n();
  const browser = c.status?.runtime.selected.type === "browser";
  const state = c.auth === "ready" ? c.effectiveLabel : t(c.auth === "checking" ? "sshAgent.checking" : "sshAgent.managementRequired");
  const signer = browser ? c.active ? `${c.active.device} · ${t(`sshAgent.state.${c.active.state}`)}` : t("sshAgent.noActive") : "";
  const label = [state, signer].filter(Boolean).join(" · ");
  const pending = t("sshAgent.pendingCount", { count: c.pendingCount });
  return <button type="button" className="ssh-sidebar-status" onClick={onOpen} aria-label={t("sshAgent.title")} title={`${label} · ${pending}`} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 12px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12 }}>
    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("sshAgent.sidebar", { agent: label })}</span>
    <span aria-label={pending} style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{c.pendingCount}</span>
  </button>;
}
