import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { devNull } from "node:os";
// @ts-expect-error Native Node tests require the .ts suffix.
import { gitExecEnv } from "./git-exec.ts";

export const GIT_READ_LIMITS = { processes: 2048, bytes: 32 * 1024 * 1024, milliseconds: 60_000 } as const;
interface Scope {
  signal: AbortSignal; check: () => void; processes: number; bytes: number; closed: boolean;
  pending: Set<Promise<Buffer>>;
}
const scopes = new AsyncLocalStorage<Scope>();
export const hasGitReadScope = () => scopes.getStore() !== undefined;
export class GitReadLimitError extends Error { readonly code = "GIT_READ_LIMIT"; }

/** Opt-in aggregate ownership for notebook analysis. No scope grants path/Git
 * access; check() is the caller's live permission/cancellation guard. Narrower
 * host-supplied limits support deterministic fixtures, never wider model budgets. */
export async function withGitReadScope<T>(signal: AbortSignal | undefined, check: () => void, work: (ownedSignal: AbortSignal) => Promise<T>, limits: Partial<Record<keyof typeof GIT_READ_LIMITS, number>> = {}): Promise<T> {
  if (scopes.getStore()) throw new Error("Nested Git read scopes are not supported");
  const bounded = (key: keyof typeof GIT_READ_LIMITS) => {
    const value = limits[key] ?? GIT_READ_LIMITS[key];
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid Git read budget");
    return Math.min(value, GIT_READ_LIMITS[key]);
  };
  const owner = new AbortController(), owned = signal ? AbortSignal.any([signal, owner.signal]) : owner.signal;
  const scope: Scope = { signal: owned, check, processes: bounded("processes"), bytes: bounded("bytes"), closed: false, pending: new Set() };
  const deadline = setTimeout(() => owner.abort(new GitReadLimitError("Git analysis exceeded its deadline")), bounded("milliseconds"));
  try { owned.throwIfAborted(); check(); return await scopes.run(scope, () => work(owned)); }
  finally {
    scope.closed = true; clearTimeout(deadline); owner.abort();
    // An accidental unjoined caller cannot let an owned subprocess outlive scope.
    await Promise.allSettled([...scope.pending]);
  }
}

/** Fixed read-only callers only. stdin is bounded object-probe input, not shell.
 * Helpers, replacement objects, lazy fetch and optional/index writes stay off. */
export function scopedGitRead(cwd: string, args: string[], limit = 256 * 1024, signal?: AbortSignal, input?: string): Promise<Buffer> {
  const scope = scopes.getStore();
  if (!scope || scope.closed) throw new Error("A live Git read scope is required");
  scope.signal.throwIfAborted(); signal?.throwIfAborted(); scope.check();
  if (--scope.processes < 0 || scope.bytes <= 0) throw new GitReadLimitError("Git analysis exceeded its aggregate work budget");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2 * 1024 * 1024 || input && Buffer.byteLength(input) > 4096) throw new Error("Invalid Git read size");
  const owned = signal ? AbortSignal.any([signal, scope.signal]) : scope.signal;
  const safeArgs = ["diff", "diff-tree", "show", "log"].includes(args[0])
    ? [args[0], "--no-ext-diff", "--no-textconv", "--no-color", ...(["show", "log"].includes(args[0]) ? ["--no-show-signature"] : []), ...args.slice(1)] : args;
  const operation = new Promise<Buffer>((resolve, reject) => {
    let closed = false, inputClosed = false, result: { error: Error | null; stdout: Buffer; stderr: Buffer } | undefined, failure: unknown;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (!closed || !inputClosed || !result) return;
      clearTimeout(deadline); if (escalation) clearTimeout(escalation); owned.removeEventListener("abort", abort);
      if (failure) reject(failure);
      else if (owned.aborted) reject(owned.reason);
      else if (result.error) reject(Object.assign(new Error("Local Git read failed"), { code: (result.error as NodeJS.ErrnoException).code, stdout: result.stdout.toString("utf8"), stderr: result.stderr.toString("utf8") }));
      else { try { scope.check(); resolve(result.stdout); } catch (error) { reject(error); } }
    };
    const child = execFile("git", ["-C", cwd, "--no-pager", "-c", "core.fsmonitor=false", "-c", "log.showSignature=false", "-c", `diff.orderFile=${devNull}`, "-c", "diff.relative=false", "-c", "diff.submodule=short", "-c", "diff.ignoreSubmodules=none", ...safeArgs], {
      env: { ...gitExecEnv(), GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1", GIT_NO_LAZY_FETCH: "1", GIT_ALLOW_PROTOCOL: "", GIT_PAGER: "cat" },
      encoding: "buffer", maxBuffer: limit,
    }, (error, stdout, stderr) => { result = { error, stdout, stderr }; finish(); });
    const stop = (error: unknown) => {
      failure ??= error;
      if (closed) return;
      child.kill("SIGTERM"); escalation ??= setTimeout(() => { if (!closed) child.kill("SIGKILL"); }, 1000);
    };
    const abort = () => stop(owned.reason);
    const deadline = setTimeout(() => stop(new GitReadLimitError("Git read exceeded its deadline")), 15_000);
    let stdoutBytes = 0, stderrBytes = 0;
    const count = (chunk: Buffer, stderr: boolean) => {
      scope.bytes -= chunk.length;
      if (stderr) stderrBytes += chunk.length; else stdoutBytes += chunk.length;
      if (scope.bytes < 0 || stdoutBytes > limit || stderrBytes > limit) stop(new GitReadLimitError("Git read exceeded its output budget"));
    };
    child.stdout?.on("data", chunk => count(chunk, false)); child.stderr?.on("data", chunk => count(chunk, true));
    child.stdin?.on("error", error => stop(error));
    child.stdin?.once("close", () => { inputClosed = true; finish(); });
    if (!child.stdin) inputClosed = true;
    child.once("close", () => { closed = true; finish(); });
    owned.addEventListener("abort", abort, { once: true });
    // Non-consuming short-lived Git commands need no zero-byte write/shutdown
    // race. Close their unused pipe; probes with input must join its close too.
    if (input) child.stdin?.end(input); else child.stdin?.destroy();
    if (owned.aborted) abort();
  });
  scope.pending.add(operation);
  void operation.then(() => scope.pending.delete(operation), () => scope.pending.delete(operation));
  return operation;
}
