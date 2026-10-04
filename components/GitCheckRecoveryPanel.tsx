"use client";

/** Compatibility name only: static diagnostics, not a recovery or admission UI.
 * Captured history remains in the existing authorized read-only action cards.
 */
export function GitCheckRecoveryPanel() {
  return <section className="min-w-0 space-y-2 rounded border border-border p-3" aria-label="Check outcome information">
    <strong>Check outcomes</strong>
    <p className="text-xs text-text-muted">Failed or uncertain checks produce no passing receipt. Their history does not block other invocations; no recovery approval is needed.</p>
    <p className="text-xs text-text-muted">Inspect recorded effects in action cards and current checkout files and processes as needed, including ignored files and effects outside the checkout. History does not prove that descendants stopped or that changes are safe.</p>
  </section>;
}
