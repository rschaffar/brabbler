export interface HiddenProjectsData { keys: string[] }

/** Fresh client-only session rows have only cwd, which is not a canonical worktree identity. */
export function hasResolvedProjectIdentity(session: { projectKey?: string | null; projectRoot?: string | null }): boolean {
  return Boolean(session.projectKey || session.projectRoot);
}

export function validHiddenProjectKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && key.length <= 16_384 && !key.includes("\0");
}

export function validHiddenProjectsData(value: unknown): value is HiddenProjectsData {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = (value as HiddenProjectsData).keys;
  return Array.isArray(keys) && keys.length <= 10_000 && keys.every(validHiddenProjectKey);
}
