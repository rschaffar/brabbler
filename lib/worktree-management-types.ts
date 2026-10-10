export type IntegrationState = "target" | "integrated" | "not-integrated" | "unknown";
export type MergeDate = { state: "not-loaded" | "not-applicable" } | { state: "unavailable"; reason: string }
  | { state: "available"; date: string; commit: string; source: "first-parent-graph" };
export interface ManagedWorktree {
  path: string; head: string | null; branch: string | null; main: boolean; selected: boolean;
  detached: boolean; locked: string | null; prunable: string | null; missing: boolean;
}
export interface WorktreeManagementRow {
  id: string; branch: string | null; tip: string | null; symbolic: boolean;
  tipDate: string | null; authorDate: string | null; subject: string | null;
  worktrees: ManagedWorktree[]; integration: IntegrationState; integrationReason?: string;
  mergeDate: MergeDate; blockers: string[];
}
export interface WorktreeManagementInventory {
  captureId: string; capturedAt: string; project: string; mainCheckout: string; checkout: string;
  target: { branch: string | null; tip: string | null; configured: string | null;
    source: "builtin" | "global" | "project"; temporary: boolean; missingConfigured: boolean };
  targets: Array<{ branch: string; tip: string }>;
  rows: WorktreeManagementRow[];
  counts: { branches: number; worktrees: number; diagnostics: number; integrated: number; notIntegrated: number; unknown: number; target: number };
  /** Display captures are optimistic, not filesystem locks or cleanup authority. */
  complete: true;
  /** Supplied by HTTP inventory; read-only graph helpers do not depend on enablement. */
  cleanup?: { pluginId: string; enabled: boolean; permission: "deny" | "ask" | "allow"; targetSelection: "ask" | "configured" };
}
export interface WorktreeManagementStatus {
  path: string; state: "clean" | "dirty" | "unavailable"; trackedDirty: boolean;
  untracked: string[]; ignored: string[]; reason?: string; submodules: "ignored";
}
export interface WorktreeManagementDetails {
  captureId: string;
  rows: Array<{ id: string; mergeDate: MergeDate; statuses: WorktreeManagementStatus[] }>;
}
