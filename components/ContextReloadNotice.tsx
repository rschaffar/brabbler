"use client";

import { useEffect, useState } from "react";
import { sendAgentCommand } from "@/lib/agent-client";
import { useI18n } from "@/hooks/useI18n";

const POLL_INTERVAL_MS = 20_000;

export function ContextReloadNotice({ sessionId, busy }: { sessionId: string | null; busy: boolean }) {
  const { t } = useI18n();
  const [changed, setChanged] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setChanged(false);
    setError(false);
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || reloading) return;
    const controller = new AbortController();
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/agent/${encodeURIComponent(sessionId)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = await response.json() as { running?: boolean; state?: { contextFilesChanged?: boolean } };
        if (!controller.signal.aborted) setChanged(Boolean(result.running && result.state?.contextFilesChanged));
      } catch {
        // Offline or temporarily unavailable: keep the last known status.
      }
    };
    void check();
    const timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [sessionId, reloading]);

  if (!sessionId || !changed) return null;
  return (
    <div role="status" className="mx-4 mt-3 flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-text">
      <span className="min-w-0 flex-1">{t("chat.contextFilesChanged")}</span>
      <button
        type="button"
        className="shrink-0 text-accent hover:underline disabled:opacity-50"
        disabled={busy || reloading}
        onClick={() => {
          setReloading(true);
          setError(false);
          void sendAgentCommand(sessionId, { type: "reload" })
            .then(() => setChanged(false))
            .catch(() => setError(true))
            .finally(() => setReloading(false));
        }}
      >
        {reloading ? t("agents.reloading") : t("agents.reloadSession")}
      </button>
      {error && <span className="text-red-400">{t("chat.contextReloadFailed")}</span>}
    </div>
  );
}
