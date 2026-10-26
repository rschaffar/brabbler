"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { copyText } from "@/lib/clipboard";
import { safeAuthorizationUrl } from "@/lib/oauth-url";
import { useSettingsWork } from "./SettingsUi";

/** Shared device-code instructions for Pi default and additional accounts. */
export function DeviceAuthorization({ verificationUri, userCode, expiresInSeconds }: {
  verificationUri: string;
  userCode: string;
  expiresInSeconds?: number | null;
}) {
  const { t } = useI18n();
  const observe = useSettingsWork();
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const url = safeAuthorizationUrl(verificationUri);

  useEffect(() => { setCopied(false); setCopyFailed(false); }, [userCode]);

  return (
    <div className="flex flex-col gap-2 text-xs">
      <span>{t("auth.deviceCodeInstruction")}</span>
      <div className="flex flex-wrap items-center gap-2">
        <code className="select-all rounded border border-border bg-bg-panel px-3 py-2 text-base font-bold text-text">{userCode}</code>
        <button type="button" className="rounded border border-border bg-bg-panel px-3 py-2 text-text" onClick={() => observe("accounts.copyCode", (async () => {
          try { await copyText(userCode); setCopied(true); setCopyFailed(false); }
          catch { setCopied(false); setCopyFailed(true); }
        })())} aria-label={t("auth.copyCode")}>{copied ? t("i18n.copied") : t("auth.copyCode")}</button>
      </div>
      {copyFailed && <span role="alert" className="text-red-400">{t("auth.copyFailed")}</span>}
      {url
        ? <a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline">{t("auth.openVerificationPage")} · {url}</a>
        : <span role="alert" className="text-red-400">{t("auth.invalidUrl")}</span>}
      {expiresInSeconds ? <span>{t("auth.expiresInMinutes", { minutes: Math.ceil(expiresInSeconds / 60) })}</span> : null}
    </div>
  );
}
