"use client";

import { useEffect, useRef, useState } from "react";
import type { ProjectTrustStatus } from "@/lib/api-types";
import { useI18n } from "@/hooks/useI18n";

export type TrustChoice = { scope: "worktree" | "repository"; action: "trust" | "revoke" | "clear" };

export function ProjectTrustDialog({ cwd, status, busy, error, onCancel, onConfirm }: {
  cwd: string;
  status: ProjectTrustStatus | null;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (choice: TrustChoice) => void;
}) {
  const { t } = useI18n();
  const [choice, setChoice] = useState<TrustChoice | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    return () => previous?.focus();
  }, []);
  const available = status?.checkoutRoot !== null && status?.checkoutRoot !== undefined;
  const actions: Array<{ choice: TrustChoice; title: string; detail: string }> = [
    ...(!status?.repositoryTrusted && (available || status?.requiresTrust) ? [{ choice: { scope: "worktree" as const, action: "trust" as const }, title: t(available ? "trust.thisWorktree" : "trust.thisDirectory"), detail: t("trust.thisWorktreeDescription") }] : []),
    ...(available ? [{ choice: { scope: "repository" as const, action: "trust" as const }, title: t("trust.allWorktrees"), detail: t("trust.allWorktreesDescription") }] : []),
    ...(status?.worktreeDecision === true || status?.repositoryTrusted && status.worktreeDecision !== false ? [
      { choice: { scope: "worktree" as const, action: "revoke" as const }, title: t("trust.restrictWorktree"), detail: t("trust.restrictWorktreeDescription") },
    ] : []),
    ...(status?.worktreeDecision === false ? [
      { choice: { scope: "worktree" as const, action: "clear" as const }, title: t("trust.clearOverride"), detail: t("trust.clearOverrideDescription") },
    ] : []),
    ...(status?.repositoryTrusted ? [
      { choice: { scope: "repository" as const, action: "revoke" as const }, title: t("trust.revokeProject"), detail: t("trust.revokeProjectDescription") },
    ] : []),
  ];
  const selected = actions.find((item) => choice && item.choice.action === choice.action && item.choice.scope === choice.scope);
  return (
    <div role="presentation" style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.4)" }}
      onClick={(event) => { if (!busy && event.target === event.currentTarget) onCancel(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="project-trust-title" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.stopPropagation(); onCancel(); }
        if (event.key !== "Tab") return;
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} style={{ width: 520, maxWidth: "100%", maxHeight: "calc(100vh - 32px)", overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-panel)", boxShadow: "0 12px 36px rgba(0,0,0,0.24)" }}>
        <div style={{ padding: 18 }}>
          <h2 id="project-trust-title" style={{ margin: 0, fontSize: 15 }}>{t("trust.dialogTitle")}</h2>
          <p style={{ fontSize: 12, lineHeight: 1.6, color: "var(--text-muted)" }}>{t("trust.dialogBody")}</p>
          <code style={{ display: "block", overflowWrap: "anywhere", fontSize: 11 }}>{cwd}</code>
          {available && <p style={{ fontSize: 11, overflowWrap: "anywhere", color: "var(--text-muted)" }}>{t("trust.projectRoot")}: {status?.repositoryRoot}</p>}
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("trust.piCliBoundary")}</p>
          {!available && status?.requiresTrust === false && <p role="status" style={{ fontSize: 11 }}>{t("trust.noResources")}</p>}
          {choice?.scope === "repository" && choice.action === "trust" && status?.worktreeDecision === false &&
            <p role="status" style={{ fontSize: 11, color: "var(--text-muted)" }}>{t("trust.overrideRemains")}</p>}
          <div role="radiogroup" aria-label={t("trust.dialogTitle")} style={{ display: "grid", gap: 8, marginTop: 12 }}>
            {actions.map((item) => {
              const active = selected === item;
              return <label key={`${item.choice.scope}-${item.choice.action}`} style={{ display: "flex", gap: 8, padding: 10, border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`, borderRadius: 6, cursor: busy ? "wait" : "pointer" }}>
                <input type="radio" name="trust-choice" checked={active} disabled={busy} onChange={() => setChoice(item.choice)} />
                <span><strong style={{ display: "block", fontSize: 12 }}>{item.title}</strong><small style={{ display: "block", marginTop: 4, lineHeight: 1.5, color: "var(--text-muted)" }}>{item.detail}</small></span>
              </label>;
            })}
          </div>
          {error && <p role="alert" style={{ color: "#ef4444", fontSize: 12 }}>{error}</p>}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, padding: 10, borderTop: "1px solid var(--border)" }}>
          <button ref={cancelRef} type="button" disabled={busy} onClick={onCancel}>{t("trust.cancel")}</button>
          <button type="button" disabled={busy || !selected} onClick={() => { if (choice) onConfirm(choice); }}>{busy ? t("trust.trusting") : t("trust.confirmChoice")}</button>
        </div>
      </div>
    </div>
  );
}
