/** The hook's observed client maintenance, not session/server/native closure. */
export type AgentSessionMaintenanceName =
  | "eager-creation"
  | "initial-models"
  | "creation-models"
  | "mount-session"
  | "mount-tools"
  | "mount-prompt-settlement"
  | "mount-bash-settlement"
  | "receipt-reconciliation"
  | "lease-renewal"
  | "event-maintenance"
  | "rejected-prompt-reconciliation"
  | "agent-state-recovery"
  | "speed-recovery"
  | "settled-history"
  | "compaction-history"
  | "agent-end-history"
  | "agent-end-state"
  | "grace-state"
  | "prompt-settlement";

export interface AgentSessionMaintenanceOptions {
  /** Unexpected complete-chain rejection, independent of anyone requesting a join. */
  reportUnexpected?(name: AgentSessionMaintenanceName, error: unknown): void | Promise<void>;
}

/**
 * Inert, instance-local observation of ALREADY STARTED promises. No scheduling,
 * admission, cancellation, timer, I/O or persistence policy belongs here.
 *
 * Observe complete catch/finally chains. Nested observed work launched while a
 * parent settles is included by whenSettled's next pass. Callers still own public
 * commands separately, and must stop their own effects/admission before teardown.
 * A successful join says nothing about future timers, unobserved work, React
 * cleanup, a remote accepted job, or SDK/native settlement.
 */
export function createAgentSessionMaintenanceScope(options: AgentSessionMaintenanceOptions = {}) {
  const pending = new Set<Promise<void>>();
  const failures: Array<{ name: AgentSessionMaintenanceName; error: unknown }> = [];

  const observe = <T>(name: AgentSessionMaintenanceName, started: Promise<T>): Promise<T> => {
    const settled = started.then(
      () => { pending.delete(settled); },
      async (error: unknown) => {
        failures.push({ name, error });
        try {
          // Invoke immediately, not when/if a caller joins. Existing operational
          // catches were already applied at the launch site and remain unchanged.
          await options.reportUnexpected?.(name, error);
        } catch (reportError) {
          failures.push({ name, error: new Error("Maintenance diagnostic reporter failed", { cause: reportError }) });
        } finally {
          // Even a throwing/rejecting diagnostic must not reject an ignored
          // observer or strand a pending peer. Retain both errors for every join.
          pending.delete(settled);
        }
      },
    );
    pending.add(settled);
    // Preserve original identity/result/rejection. The handler above observes
    // rejection immediately; it does not convert the caller's promise to success.
    return started;
  };

  const whenSettled = async (): Promise<void> => {
    // Do not freeze registration or cache a previous join: a parent's actual
    // continuation can synchronously observe children before its promise ends.
    while (pending.size > 0) await Promise.all([...pending]);
    if (failures.length > 0) {
      throw new AggregateError(failures.map(({ name, error }) =>
        new Error(`Agent session maintenance failed: ${name}`, { cause: error })),
      "Observed agent session maintenance failed");
    }
  };

  return { observe, whenSettled };
}
