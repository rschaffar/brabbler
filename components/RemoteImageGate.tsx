"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useRemoteImages } from "@/hooks/useRemoteImages";

/** Check the rendered source AFTER local paths have become file-API URLs.
 * URL parsing strips tabs/newlines and accepts slash/backslash authority pairs.
 * Absolute HTTP(S) URLs are opt-in even when they point back to this app.
 */
export function isRemoteImageSource(src: unknown): boolean {
  return typeof src === "string" && /^(?:https?:|[\\/]{2})/i.test(src.replace(/[\t\r\n]/g, "").trim());
}

export function RemoteImageGate({ src, alt, insideLink = false, children }: {
  src: unknown; alt?: string; insideLink?: boolean; children: ReactNode;
}) {
  const { enabled } = useRemoteImages();
  if (enabled || !isRemoteImageSource(src)) return children;
  return <RemoteImageNotice alt={alt} insideLink={insideLink} />;
}

export function RemoteImageNotice({ alt, insideLink = false, label }: { alt?: string; insideLink?: boolean; label?: string }) {
  const { t } = useI18n();
  const { setEnabled } = useRemoteImages();
  return <span className="remote-image-blocked">
    <span>{label ?? (alt?.trim() ? t("chat.remoteImageBlockedAlt", { alt }) : t("chat.remoteImageBlocked"))}</span>{" "}
    {insideLink ? <span>{t("chat.remoteImageSettingsHint")}</span> : <button type="button"
      className="remote-image-enable" title={t("settings.remoteImagesDescription")}
      onClick={() => setEnabled(true)}>{t("chat.enableRemoteImages")}</button>}
  </span>;
}
