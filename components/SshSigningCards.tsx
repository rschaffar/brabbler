"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { SshAgentController } from "@/hooks/useSshAgent";
import { ConfigButton } from "./SettingsUi";

/** Mount globally beside workspace content, not inside Settings or a modal/focus trap. */
export function SshSigningCards({ controller: c }: { controller: SshAgentController }) {
  const { t } = useI18n();
  if (!c.requests.length && !c.error && !c.notice) return null;
  return <aside aria-label={t("sshAgent.signingRequests")} style={{ position: "fixed", zIndex: 350, top: "calc(env(safe-area-inset-top) + 48px)", right: 8, width: "min(440px, calc(100vw - 16px))", maxHeight: "40dvh", overflowY: "auto", display: "grid", gap: 8, padding: 8, borderRadius: 8, background: "var(--bg)", boxShadow: "0 4px 20px #0003" }}>
    <span role="status" aria-live="polite">{t("sshAgent.pendingCount", { count: c.requests.length })}</span>
    {c.error && <p role="status" style={{ color: "#cf4a5d", fontSize: 12 }}>{c.error}</p>}
    {c.notice && <p role="status" style={{ color: "var(--text-muted)", fontSize: 12 }}>{c.notice}</p>}
    {(c.error || c.notice) && <ConfigButton onClick={c.clearMessages}>{t("sshAgent.dismiss")}</ConfigButton>}
    {c.requests.map(request => {
      const reviewed = c.reviewedId === request.id;
      const prompting = c.approvingId === request.id;
      const authorizingUnlock = prompting && c.approvalStage === "unlock";
      return <section key={request.id} aria-label={t("sshAgent.signingRequest")} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--bg)", display: "grid", gap: 8 }}>
        <strong>{t(request.unlock ? "sshAgent.unlockRequest" : "sshAgent.signingRequest")}</strong>
        {request.previousSigner && <p style={{ fontSize: 12 }}>{t("sshAgent.previousSigner")}</p>}
        {!reviewed ? <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <ConfigButton disabled={c.busy} onClick={() => c.reviewRequest(request.id)}>{t("sshAgent.review")}</ConfigButton>
          <ConfigButton onClick={() => c.deny(request.id)}>{t("sshAgent.deny")}</ConfigButton>
        </div> : <>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 90, overflowY: "auto", margin: 0 }}>{request.description}</p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0 }}>{t("sshAgent.untrustedRequest")}</p>
          <p style={{ fontSize: 12, margin: 0 }}>{t(request.unlock || authorizingUnlock ? "sshAgent.unlockApproveHelp" : request.userVerification === "required" ? "sshAgent.strictApproveHelp" : "sshAgent.touchApproveHelp")}</p>
          <details><summary>{t("sshAgent.requestDetails")}</summary>
            <p style={{ fontSize: 12 }}>{t("sshAgent.requestFingerprint")}</p>
            <code style={{ overflowWrap: "anywhere" }}>{request.fingerprint}</code>
            <RequestRemaining deadline={request.deadline} />
          </details>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <ConfigButton variant="primary" disabled={c.busy || !c.supported || c.auth !== "ready"} onClick={() => void c.approve(request.id)}>{t(request.unlock ? "sshAgent.unlockApprove" : "sshAgent.approve")}</ConfigButton>
            <ConfigButton onClick={() => c.deny(request.id)}>{t(prompting ? "sshAgent.cancelPrompt" : "sshAgent.deny")}</ConfigButton>
          </div>
          {prompting && <span role="status">{t(authorizingUnlock ? "sshAgent.unlockPrompting" : c.approvalStage === "sign" ? "sshAgent.signPrompting" : "sshAgent.prompting")}</span>}
        </>}
      </section>;
    })}
  </aside>;
}

function RequestRemaining({ deadline }: { deadline: number }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <p style={{ fontSize: 12 }}>{t("sshAgent.requestRemaining", { seconds: Math.ceil(Math.max(0, deadline - now) / 1000) })}</p>;
}
