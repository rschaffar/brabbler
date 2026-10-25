"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

const CLIENT_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const POLL_INTERVAL_MS = 60_000;

export function WebVersionNotice({ onCheckWork }: { onCheckWork?: (work: Promise<void>) => void } = {}) {
  const onCheckWorkRef = useRef(onCheckWork);
  onCheckWorkRef.current = onCheckWork;
  const { t } = useI18n();
  const [serverVersion, setServerVersion] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const check = async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/app-version", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const result = await response.json() as { version?: unknown };
        if (!controller.signal.aborted && typeof result.version === "string") {
          setServerVersion(result.version);
        }
      } catch {
        // A restarting or offline server should not interrupt the current tab.
      }
    };
    const startCheck = () => {
      const originalPromise = check();
      onCheckWorkRef.current?.(originalPromise);
      return originalPromise;
    };
    void startCheck();
    const timer = setInterval(() => void startCheck(), POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", startCheck);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", startCheck);
    };
  }, []);

  if (!serverVersion || serverVersion === CLIENT_VERSION) return null;
  return (
    <div role="status" className="fixed left-1/2 top-[calc(48px+env(safe-area-inset-top))] z-[300] flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 items-center gap-3 rounded-md border border-amber-500/40 bg-[var(--bg-panel)] px-4 py-3 text-sm text-text shadow-lg">
      <span className="min-w-0 flex-1">{t("appUpdate.runningVersionChanged", { version: serverVersion })}</span>
      <button
        type="button"
        className="shrink-0 text-accent hover:underline"
        onClick={() => {
          if (window.confirm(t("appUpdate.reloadWarning"))) window.location.reload();
        }}
      >
        {t("appUpdate.reloadWeb")}
      </button>
    </div>
  );
}
