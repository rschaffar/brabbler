import { realpathSync } from "node:fs";
import { samePath } from "./paths";

/** In-process admission gate for Pi Web agent runs during a local checkout transaction.
 * It cannot coordinate Git CLI or other processes; exact-state Git guards still apply.
 */
const gateKey = Symbol.for("pi-web:git-checkout-gate");
type CheckoutGateState = { paths: Set<string> };
function state(): CheckoutGateState {
  const global = globalThis as unknown as Record<symbol, CheckoutGateState | undefined>;
  return (global[gateKey] ??= { paths: new Set() });
}

function physical(cwd: string): string {
  try { return realpathSync(cwd); }
  catch { return cwd; } // A removed checkout must still match its reserved spelling.
}

export function isGitCheckoutGated(cwd: string): boolean {
  return [...state().paths].some((path) => samePath(path, cwd) || samePath(physical(path), physical(cwd)));
}

export class GitCheckoutBusyError extends Error {
  constructor() { super("Git checkout is busy with another local transaction"); }
}

/** Atomically reserve both source and target before checking for already-running sessions. */
export function acquireGitCheckoutGate(cwds: readonly string[]): () => void {
  const paths = state().paths;
  if (cwds.some((cwd) => isGitCheckoutGated(cwd))) {
    throw new GitCheckoutBusyError();
  }
  const reserved = [...cwds];
  for (const cwd of reserved) paths.add(cwd);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const cwd of reserved) paths.delete(cwd);
  };
}

/** Never use around a human wait. Recheck existing writers inside the reservation. */
export async function withGitCheckoutGate<T>(cwds: readonly string[], action: () => Promise<T>): Promise<T> {
  const release = acquireGitCheckoutGate(cwds);
  try { return await action(); }
  finally { release(); }
}
