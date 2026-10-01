import { realpathSync } from "node:fs";
import type { InlineExtension } from "@earendil-works/pi-coding-agent";
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

/** Atomically reserve both source and target against other in-process checkout transactions and new tool calls. */
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

/** Only these SDK tools are known to be read-only. Shell commands and every
 * unrecognized/extension tool are uncertain, even when their text looks safe.
 */
export function isReadOnlyCheckoutTool(name: unknown): boolean {
  return name === "read" || name === "grep" || name === "find" || name === "ls";
}

/** Installed on every Pi Web session (including subagents). SDK tool_call runs
 * before execution; tool_execution_start is observed separately by the wrapper
 * so an already-admitted in-flight tool also conflicts with gate acquisition.
 */
export function createGitCheckoutOperationGuard(options: {
  isBuiltinReadOnlyTool: (name: string) => boolean;
  onUserBash: () => void;
}): InlineExtension {
  return {
    name: "pi-web-checkout-operation-guard",
    hidden: true,
    factory: (pi) => {
      pi.on("tool_call", (event, ctx) => {
        if (isGitCheckoutGated(ctx.cwd) && !options.isBuiltinReadOnlyTool(event.toolName)) {
          return { block: true, reason: "Git checkout is busy with a local transaction" };
        }
        return undefined;
      });
      pi.on("user_bash", (_event, ctx) => {
        if (isGitCheckoutGated(ctx.cwd)) throw new GitCheckoutBusyError();
        // The next handler can await before the SDK marks isBashRunning.
        options.onUserBash();
        return undefined;
      });
    },
  };
}

/** Never use around a human wait. Native preflight and durable admission still recheck the candidate under this reservation. */
export async function withGitCheckoutGate<T>(cwds: readonly string[], action: () => Promise<T>): Promise<T> {
  const release = acquireGitCheckoutGate(cwds);
  try { return await action(); }
  finally { release(); }
}
