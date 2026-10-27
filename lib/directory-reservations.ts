import { isPathWithinRoots, physicalDirectoryPath } from "./path-security";

// Shared across module copies and development reloads, like the managed session registries.
const registryKey = Symbol.for("brabbler:directory-reservations");
const host = globalThis as typeof globalThis & { [registryKey]?: Map<symbol, string> };
function reservations(): Map<symbol, string> {
  return host[registryKey] ??= new Map();
}

/** Admission checks are synchronous with publishing managed starting/running state.
 * Only this directory and descendants are blocked; an ancestor cwd is not an OS lock. */
export function assertDirectoryAdmissionAllowed(directory: string): string {
  const physical = physicalDirectoryPath(directory);
  for (const reserved of reservations().values()) {
    if (isPathWithinRoots(physical, new Set([reserved]))) {
      throw new Error(`Directory is reserved by another operation: ${physical}`);
    }
  }
  return physical;
}

/** Acquire after approval, retain across asynchronous effects, and release only after
 * native settlement. No timeout/abort auto-release: that could admit work mid-effect.
 * The host's busy observation and acquisition run in one synchronous turn. External
 * processes and other server processes are intentionally outside this in-process lease. */
export function acquireDirectoryReservation(
  directory: string,
  isDirectoryInUse: (physicalDirectory: string) => boolean,
): () => void {
  const physical = physicalDirectoryPath(directory);
  if (isDirectoryInUse(physical)) throw new Error(`Directory is in use: ${physical}`);
  const registry = reservations();
  for (const reserved of registry.values()) {
    if (isPathWithinRoots(physical, new Set([reserved])) || isPathWithinRoots(reserved, new Set([physical]))) {
      throw new Error(`Directory reservation overlaps another operation: ${physical}`);
    }
  }
  const token = Symbol();
  registry.set(token, physical);
  // Unique tokens make release idempotent, including after a later lease is acquired.
  return () => { registry.delete(token); };
}
