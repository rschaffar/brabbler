"use client";
import { useI18n } from "@/hooks/useI18n";
import { nativeCallSnapshot } from "@/lib/native-call-display";

export function NativeCallDetails({ details }: { details: unknown }) {
  const { t } = useI18n(), snapshot = nativeCallSnapshot(details);
  if (!snapshot?.calls.length) return null;
  return <section aria-label={t("nativeCalls.title")} data-native-calls="true" className="border-t border-border p-3 text-xs">
    <h4 className="mb-2 font-medium">{t("nativeCalls.title")}</h4>
    <p className="mb-2 text-text-muted">{t("nativeCalls.preview")}</p>
    <ol className="space-y-2">
      {snapshot.calls.map((call, index) => <li key={index} data-native-call-status={call.status} className="min-w-0 rounded border border-border p-2">
        <div className="flex flex-wrap gap-x-2"><code className="break-all">{call.name}</code>
          <span>{t(`nativeCalls.status_${call.status}`)}</span>
          {call.durationMs !== undefined && <span className="text-text-muted">{t("nativeCalls.duration", { value: Math.round(call.durationMs) })}</span>}
          {call.cost !== undefined && <span className="text-text-muted">{t("nativeCalls.cost", { value: call.cost.toFixed(4) })}</span>}
        </div>
        <pre className="mt-1 whitespace-pre-wrap break-all text-text-muted">{call.preview}</pre>
        {call.error && <pre className="mt-1 whitespace-pre-wrap break-all text-red-500">{call.error}</pre>}
      </li>)}
    </ol>
    {snapshot.omitted > 0 && <p className="mt-2 text-text-muted">{t("nativeCalls.omitted", { count: snapshot.omitted })}</p>}
  </section>;
}
