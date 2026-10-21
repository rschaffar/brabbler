import { normalizeFilePathSlashes } from "./file-paths";

export interface FileRevealRequest {
  id: number;
  filePath: string;
  cwd?: string;
  sourceSessionId?: string | null;
}

/** Lexical presentation identity only; directory reads still require server admission. */
export function explorerPathKey(path: string): string {
  const normalized = normalizeFilePathSlashes(path).replace(/\/+$/, "");
  return /^(?:[a-zA-Z]:(?:\/|$)|\/\/)/.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function explorerContains(root: string, file: string): boolean {
  const parent = explorerPathKey(root), child = explorerPathKey(file);
  return child.startsWith(`${parent}/`);
}

export function explorerRevealRoot(file: string, cwd: string, browseRoot = cwd): string {
  if (explorerContains(browseRoot, file)) return browseRoot;
  if (explorerContains(cwd, file)) return cwd;
  const normalized = normalizeFilePathSlashes(file);
  const slash = normalized.lastIndexOf("/");
  if (slash === 0) return "/";
  if (slash === 2 && /^[a-zA-Z]:\//.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, slash);
}
