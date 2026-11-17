/** Actual construction/application receipts only. No saved intent, notifications,
 * waiting, retries or scheduling. The existing RPC owner performs explicit Apply. */
export type ResourceApplication = {
  revision: string;
  appliedRevision?: string;
  applying: boolean;
  applyingRevision?: string;
  ready: boolean;
  error?: string;
  available?: () => boolean;
  /** Actual public loader membership, not saved/profile management intent. */
  includedKeys?: () => readonly string[];
  apply?: () => Promise<void>;
};
export class ResourceApplyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
declare global { var __piResourceApplications: Map<string, ResourceApplication> | undefined; }
const key = (agentDir: string, id: string) => JSON.stringify([agentDir, id]);
export function resourceApplication(agentDir: string, id: string) {
  return globalThis.__piResourceApplications?.get(key(agentDir, id));
}
export function createResourceApplication(agentDir: string, id: string, revision: string) {
  const application: ResourceApplication = { revision, applying: false, ready: false };
  (globalThis.__piResourceApplications ??= new Map()).set(key(agentDir, id), application);
  return application;
}
export function resourceStatus(agentDir: string, id: string, savedRevision?: string) {
  const actual = resourceApplication(agentDir, id);
  const open = actual?.available?.() === true;
  return { sessionId: id, state: actual?.applying ? "applying" : actual?.error ? "error"
    : !open ? "on-open" : !actual.ready ? "starting"
    : savedRevision && savedRevision !== actual.appliedRevision ? "saved" : "applied",
    savedRevision: savedRevision ?? null,
    appliedRevision: open && actual?.ready ? actual.appliedRevision ?? null : null,
    includedKeys: open && actual?.ready ? actual.includedKeys?.() ?? [] : [],
    applyingRevision: actual?.applying ? actual.applyingRevision ?? null : null,
    ...(actual?.error ? { error: actual.error } : {}) };
}
