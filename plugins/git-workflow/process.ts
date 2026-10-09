import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
const preparationSignal = new AsyncLocalStorage<AbortSignal | undefined>();
export function withPreparationSignal<T>(signal: AbortSignal | undefined, read: () => Promise<T>): Promise<T> {
  return preparationSignal.run(signal, read);
}
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { gitExecEnv } from "../../lib/git-exec";

export function gitEnvironment(index?: string) {
  return { ...gitExecEnv(index), GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_LITERAL_PATHSPECS: "1",
    GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true" };
}
interface Options { index?: string; input?: string | AsyncIterable<Uint8Array>; signal?: AbortSignal; shell?: boolean; timeoutMs?: number }
/** Backpressured output; no size-triggered child termination. Only preparation and
 * checks pass signals/deadlines. Native writes are always allowed to settle. */
export async function* processOutput(command: string, args: string[], cwd: string, options: Options = {}): AsyncGenerator<Buffer> {
  options.signal?.throwIfAborted();
  const child = spawn(command, args, { cwd, env: gitEnvironment(options.index), shell: options.shell,
    detached: Boolean(options.shell && process.platform !== "win32"), stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  let stderr = "", stopped = false, spawnError: Error | undefined;
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code, signal) => resolve({ code, signal }));
  });
  let termination: Promise<string | undefined> | undefined;
  const stop = () => {
    if (termination) return;
    stopped = true;
    termination = (async () => {
      if (!child.pid) return;
      if (options.shell && process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        const code = await new Promise<number | null>((resolve) => { killer.on("error", () => resolve(null)); killer.on("close", resolve); });
        return code === 0 ? undefined : "Check process-tree termination could not be confirmed";
      }
      const pid = options.shell ? -child.pid : child.pid;
      const exists = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
      try { process.kill(pid, "SIGTERM"); } catch { return; }
      // Keep escalation alive even if the shell exits before its descendants.
      for (let i = 0; i < 10 && exists(); i++) await delay(100);
      if (exists()) try { process.kill(pid, "SIGKILL"); } catch { /* Settled concurrently. */ }
      for (let i = 0; i < 10 && exists(); i++) await delay(100);
      return exists() ? "Process-tree settlement could not be confirmed; inspect remaining processes" : undefined;
    })();
  };
  child.stderr!.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-65536); });
  options.signal?.addEventListener("abort", stop, { once: true });
  const timer = options.timeoutMs ? setTimeout(stop, options.timeoutMs) : undefined;
  let inputError: unknown;
  // Observe stdin errors even after the child exits before consuming input.
  child.stdin?.on("error", (error) => { inputError = error; });
  const feed = (async () => {
    if (!child.stdin) return;
    try {
      const source = typeof options.input === "string" ? [Buffer.from(options.input)] : options.input!;
      for await (const chunk of source) { if (!child.stdin.write(chunk)) await Promise.race([once(child.stdin, "drain"), done.then(() => { throw new Error("Process closed before consuming input"); })]); }
      child.stdin.end();
    } catch (error) { inputError = error; stop(); }
  })();
  let consumed = false;
  try {
    for await (const chunk of child.stdout!) yield chunk as Buffer;
    const result = await done; await feed;
    consumed = true;
    if (spawnError) throw spawnError;
    if (stopped) {
      const uncertainty = await termination;
      throw new Error(`${options.signal?.aborted ? "Cancelled" : "Required check exceeded its configured timeout"}${uncertainty ? `; ${uncertainty}` : "; process termination completed"}`);
    }
    if (result.code !== 0) throw Object.assign(new Error(`Command failed: ${command} exited ${result.code ?? result.signal}\n${stderr}`), { status: result.code });
    if (inputError) throw inputError;
    if (stderr && options.shell) yield Buffer.from(stderr);
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
    if (!consumed) { stop(); await done; await termination; }
  }
}
export function gitOutput(cwd: string, args: string[], options: Options = {}) {
  return processOutput("git", ["-C", cwd, "--no-optional-locks", "-c", "core.fsmonitor=false", ...args], cwd, { ...options, signal: options.signal ?? preparationSignal.getStore() });
}
export async function gitText(cwd: string, args: string[], index?: string, input?: string, signal?: AbortSignal): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of gitOutput(cwd, args, { index, input, signal })) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
export async function* records(source: AsyncIterable<Uint8Array>, delimiter = 0): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  for await (const raw of source) {
    const chunk = Buffer.from(raw); let start = 0;
    for (let end = chunk.indexOf(delimiter); end !== -1; end = chunk.indexOf(delimiter, start)) {
      yield Buffer.concat([pending, chunk.subarray(start, end)]).toString("utf8");
      pending = Buffer.alloc(0); start = end + 1;
    }
    if (start < chunk.length) pending = Buffer.concat([pending, chunk.subarray(start)]);
  }
  if (pending.length) yield pending.toString("utf8");
}
export async function outputDigest(source: AsyncIterable<Uint8Array>) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of source) { hash.update(chunk); bytes += chunk.byteLength; }
  return bytes ? hash.digest("hex") : "";
}
export async function run(command: string, args: string[], cwd: string, shell = false, index?: string, signal?: AbortSignal, timeoutMs?: number) {
  let tail = "", truncated = false;
  for await (const chunk of processOutput(command, args, cwd, { shell, index, signal, timeoutMs })) {
    tail += chunk.toString(); if (tail.length > 65536) { tail = tail.slice(-65536); truncated = true; }
  }
  return (truncated ? "[Output display limited to final 64 Ki characters; process output was fully drained.]\n" : "") + tail;
}
