import type { WorktreeManagementRow, WorktreeManagementStatus } from "./worktree-management-types";
import type { ProjectOperation } from "./plugins/project-operation-types";

export type ManagementSort = "integrated-first" | "name" | "tip" | "merge";
export type ManagementFilter = "all" | "integrated" | "not-integrated" | "unknown";
export type ManagementCheckoutFilter = "all" | "has" | "none" | "diagnostic";
export function managementRows(rows: readonly WorktreeManagementRow[], options: {
  search: string; integration: ManagementFilter; checkout: ManagementCheckoutFilter;
  sort: ManagementSort; descending: boolean;
}): WorktreeManagementRow[] {
  const search = options.search.trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    if (search && ![row.branch ?? "", ...row.worktrees.map((w) => w.path)].some((v) => v.toLocaleLowerCase().includes(search))) return false;
    if (options.integration !== "all" && row.integration !== options.integration) return false;
    if (options.checkout === "has" && !row.worktrees.length || options.checkout === "none" && row.worktrees.length) return false;
    if (options.checkout === "diagnostic" && !row.worktrees.some((w) => w.detached || w.missing || w.locked !== null || w.prunable !== null)) return false;
    return true;
  });
  const date = (row: WorktreeManagementRow) => options.sort === "merge"
    ? row.mergeDate.state === "available" ? Date.parse(row.mergeDate.date) : null
    : row.tipDate ? Date.parse(row.tipDate) : null;
  return filtered.sort((a, b) => {
    if (options.sort === "integrated-first") {
      const group = Number(b.integration === "integrated") - Number(a.integration === "integrated");
      if (group) return group;
    }
    if (options.sort !== "name") {
      const left = date(a), right = date(b);
      // Unavailable dates always follow known dates, in either direction.
      if (left === null && right !== null) return 1;
      if (right === null && left !== null) return -1;
      if (left !== null && right !== null && left !== right) return (left - right) * (options.descending ? -1 : 1);
    }
    return (a.branch ?? a.id).localeCompare(b.branch ?? b.id) * (options.sort === "name" && options.descending ? -1 : 1);
  });
}
/** Keep the last complete ordering during date preparation; new rows follow in fallback order. */
export function managementPendingOrder(rows: readonly WorktreeManagementRow[], previous: readonly string[]): WorktreeManagementRow[] {
  const rank = new Map(previous.map((id, index) => [id, index]));
  return [...rows].sort((a, b) => (rank.get(a.id) ?? previous.length) - (rank.get(b.id) ?? previous.length));
}
export function managementPage(page: number, count: number, size = 50): number {
  return Math.max(0, Math.min(page, Math.max(0, Math.ceil(count / size) - 1)));
}
export function managementDatesComplete(rows: readonly WorktreeManagementRow[]): boolean {
  return rows.every((row) => row.mergeDate.state !== "not-loaded");
}

/** Approval can release the card before the adapter publishes its next phase.
 * Keep revocation available and never call an approved wait "nothing deleted". */
export function managementOperationPresentation(operation: Pick<ProjectOperation, "state" | "card" | "cwd" | "decision">, cwd: string) {
  const review = operation.state === "review" && Boolean(operation.card) && operation.cwd === cwd;
  return {
    state: operation.state === "review" && !operation.card && operation.decision === "approve" ? "dispatched" : operation.state,
    review,
    stop: ["preparing", "review", "dispatched"].includes(operation.state) && !review,
  };
}

export type ManagementResource = "both" | "worktree" | "branch";
export interface ManagementSelection { resource: ManagementResource; worktreePath: string }
export function managementRowKind(row: WorktreeManagementRow): "branch" | "detached" | "diagnostic" {
  if (row.kind) return row.kind;
  // Compatibility for pre-kind captures/fixtures; dangling branch registrations stay read-only.
  if (row.branch && !row.id.startsWith("registration:")) return "branch";
  if (!row.branch && row.tip && row.tipDate && row.worktrees.length === 1 && row.worktrees[0].detached) return "detached";
  return "diagnostic";
}
/** Normalize during render too: effects alone leave a stale choice usable for one render. */
export function managementSelection(row: WorktreeManagementRow, requested: ManagementSelection): ManagementSelection {
  const paths = row.worktrees.map((w) => w.path);
  const worktreePath = paths.includes(requested.worktreePath) ? requested.worktreePath : paths[0] ?? "";
  if (managementRowKind(row) !== "branch") return { resource: "worktree", worktreePath };
  if (!paths.length) return { resource: "branch", worktreePath: "" };
  // Deleting a branch cannot leave any checkout of it behind.
  return { resource: paths.length > 1 ? "worktree" : requested.resource === "branch" ? "both" : requested.resource, worktreePath };
}
const fullOid = (value: string | null) => Boolean(value && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value));
/** Display eligibility only; the plugin independently validates source, policy and live use. */
export function managementRemovalBlockers(row: WorktreeManagementRow, requested: ManagementSelection, statuses: readonly WorktreeManagementStatus[] = []): string[] {
  const selection = managementSelection(row, requested), kind = managementRowKind(row);
  // The retired containment-only flag in older captures is warning evidence, not a safety refusal.
  // Preserve every other blocker, including unknown server errors.
  const blockers = row.blockers.filter((blocker) => blocker !== "current-tip-not-proven-integrated");
  if (kind === "diagnostic" || kind === "detached" && row.worktrees.length !== 1) blockers.push("diagnostic-registration");
  if (row.symbolic) blockers.push("symbolic-ref");
  if (!fullOid(row.tip) || kind === "branch" && !row.branch) blockers.push("invalid-subject");
  if (selection.resource !== "worktree" && row.worktrees.some((w) => selection.resource === "branch" || w.path !== selection.worktreePath)) blockers.push("branch-still-checked-out");
  if (selection.resource !== "branch") {
    const w = row.worktrees.find((w) => w.path === selection.worktreePath);
    if (!w || w.missing || w.locked !== null || w.prunable !== null || w.head !== row.tip ||
      (kind === "detached" ? !w.detached || w.branch !== null || !row.tipDate : w.detached || w.branch !== row.branch)) blockers.push("diagnostic-registration");
    if (w?.main) blockers.push("main-checkout");
    if (w?.selected) blockers.push("selected-checkout");
    const status = statuses.find((status) => status.path === selection.worktreePath);
    if (!status) blockers.push("status-pending");
    else if (status.state !== "clean") blockers.push(status.state === "dirty" ? "dirty-checkout" : "status-unavailable");
  }
  return [...new Set(blockers)];
}
export interface ManagementRemovalPayload {
  subject: { kind: "branch"; branch: string; tip: string } | { kind: "detached"; head: string };
  worktreePath?: string; removeWorktree: boolean; deleteBranch: boolean;
  comparisonTarget?: { branch: string; tip: string };
}
export function managementRemovalPayload(row: WorktreeManagementRow, requested: ManagementSelection, comparison?: { branch: string | null; tip: string | null }): ManagementRemovalPayload | null {
  const selection = managementSelection(row, requested), kind = managementRowKind(row);
  if (kind === "diagnostic" || !fullOid(row.tip) || kind === "branch" && !row.branch) return null;
  return {
    subject: kind === "detached" ? { kind: "detached", head: row.tip! } : { kind: "branch", branch: row.branch!, tip: row.tip! },
    ...(selection.resource !== "branch" ? { worktreePath: selection.worktreePath } : {}),
    removeWorktree: selection.resource !== "branch", deleteBranch: selection.resource !== "worktree",
    ...(comparison?.branch && fullOid(comparison.tip) ? { comparisonTarget: { branch: comparison.branch, tip: comparison.tip! } } : {}),
  };
}
/** Generic server-descriptor scope, not a client-generated digest or preparation flag. */
export function managementAcknowledgmentKey(context: string, operation: {
  id: string; state: string; card?: { requiredAcknowledgment?: string };
  acknowledgment?: { cardDigest: string; label: string; accepted?: true };
} | null): string | null {
  const label = operation?.card?.requiredAcknowledgment, descriptor = operation?.acknowledgment;
  if (!operation || operation.state !== "review" || !label || !descriptor?.cardDigest || descriptor.label !== label) return null;
  return JSON.stringify([context, operation.id, descriptor.cardDigest, label]);
}
