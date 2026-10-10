import type { WorktreeManagementRow } from "./worktree-management-types";

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
