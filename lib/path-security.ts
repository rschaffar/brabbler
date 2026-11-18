import { lstatSync, realpathSync } from "fs";
import path from "path";
import { isWindowsAbsolutePath } from "./paths";

/**
 * Lexical containment check. Accepts either canonical form on both sides: it
 * re-resolves through path.win32/path.posix and case-folds on Windows, so
 * separator style and drive-letter case never decide the answer.
 */
export function isPathWithinRoots(target: string, roots: Set<string>): boolean {
  for (const root of roots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) return true;
  }
  return false;
}

// Nix base32 hash (no e, o, u, t), then a name; the object is one path segment.
const NIX_STORE_OBJECT = /^\/nix\/store\/[0-9a-df-np-sv-z]{32}-[^/]+(?=\/|$)/;

/**
 * True only for a physical path (as returned by physicalDirectoryPath) inside a
 * Nix store object (`/nix/store/<hash>-<name>`) this server cannot modify. Store
 * contents are immutable and world-readable by design, so reading them discloses
 * nothing new; a missing child of an immutable object stays absent. This is a
 * read-target predicate for callers that already admitted the lexical alias. It
 * is never a root by itself and never makes a lexical `/nix/store` path admissible.
 */
export function isImmutableNixStorePath(physical: string): boolean {
  if (process.platform === "win32" || physical !== path.posix.normalize(physical)) return false;
  const object = NIX_STORE_OBJECT.exec(physical)?.[0];
  if (!object) return false;
  // Immutable to this server: neither the store nor the object belongs to the
  // current user, and the object is not group/other writable. (Sandboxes may map
  // the real root owner to an overflow ID, so "not ours" is the portable check.)
  const uid = process.getuid?.();
  if (uid === undefined) return false;
  try {
    const store = lstatSync("/nix/store"), owned = lstatSync(object);
    return store.isDirectory() && store.uid !== uid && !owned.isSymbolicLink()
      && owned.uid !== uid && (owned.mode & 0o022) === 0 && realpathSync(object) === object;
  } catch {
    return false;
  }
}

/** Physical identity for managed live-use observations. Resolve existing ancestors of a
 * not-yet-created cwd too; permission/I/O failures throw rather than report it unused. */
export function physicalDirectoryPath(directory: string): string {
  let current = path.resolve(directory);
  const missing: string[] = [];
  for (;;) {
    try { return path.join(realpathSync(current), ...missing.reverse()); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

export function isExistingPathWithinRoots(target: string, roots: Set<string>): boolean {
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return false;
  }

  const realRoots = new Set<string>();
  for (const root of roots) {
    try {
      realRoots.add(realpathSync(root));
    } catch {
      // Ignore stale roots derived from removed sessions or worktrees.
    }
  }
  return isPathWithinRoots(realTarget, realRoots);
}
