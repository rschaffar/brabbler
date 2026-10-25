"use client";

import { useNavigationWork } from "@/lib/navigation-work";
import { useState } from "react";
import { useI18n } from "@/hooks/useI18n";

export function ArchivedSessionNotice({ rootSessionId, busy, onRestored }: {
  rootSessionId: string | null;
  busy: boolean;
  onRestored: (id: string) => void;
}) {
  const work = useNavigationWork();
  const { t } = useI18n();
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState(false);

  if (!rootSessionId) return null;

  const restore = () => work.observe((async () => {
    if (busy || restoring) return;
    setRestoring(true);
    setError(false);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(rootSessionId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: false }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      onRestored(rootSessionId);
    } catch {
      setError(true);
    } finally {
      setRestoring(false);
    }
  })());

  return (
    <div role="status" className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-text">
      <span className="min-w-0 flex-1">{t("chat.sessionArchived")}</span>
      <button type="button" className="shrink-0 text-accent hover:underline disabled:opacity-50"
        disabled={busy || restoring} onClick={() => void restore()}>
        {restoring ? t("chat.restoringSession") : t("chat.restoreSession")}
      </button>
      {error && <span className="text-red-400">{t("chat.restoreSessionFailed")}</span>}
    </div>
  );
}
