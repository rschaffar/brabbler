import { spawn } from "node:child_process";
import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";

export interface ProcessIdentity { pid: number; start: string; ppid: number; group: number; session: number; state: string }
export function processIdentity(pid: number): ProcessIdentity | undefined {
  try {
    const raw = readFileSync(`/proc/${pid}/stat`, "utf8"), fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\s+/);
    return { pid, state: fields[0], ppid: Number(fields[1]), group: Number(fields[2]), session: Number(fields[3]), start: fields[19] };
  } catch (error) {
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
    throw error;
  }
}
export const processAlive = (identity: ProcessIdentity) => {
  const now = processIdentity(identity.pid);
  return Boolean(now && now.start === identity.start && now.state !== "Z");
};
export interface ExecutionResult { code: number | null; settled: boolean; interrupted: boolean; error?: string; scope: string }
export const executionScope = "Observed child generation, pipes, original process group and sampled descendants; escaped/unobserved descendants are not certified. Profile runner owns stronger sandbox evidence.";

/** Linux-only owned process supervision. Never finds/kills processes by port/name or saved PID alone. */
export async function executeAcceptance(argv: string[], options: {
  cwd: string; env: NodeJS.ProcessEnv; logPath: string; signal: AbortSignal;
  onSpawn?: (identity: ProcessIdentity) => void; graceMs?: number;
}): Promise<ExecutionResult> {
  if (process.platform !== "linux") throw new Error("Managed acceptance currently requires Linux");
  options.signal.throwIfAborted();
  const log = openSync(options.logPath, "wx", 0o600);
  const identities = new Map<number, ProcessIdentity>();
  let owner: ProcessIdentity | undefined, uncertain = false, failure: string | undefined;
  let code: number | null = null, closed = false, interrupted = false, bytesWritten = 0;
  let escalation: ReturnType<typeof setTimeout> | undefined, abandonTimer: ReturnType<typeof setTimeout> | undefined, pipeTimer: ReturnType<typeof setTimeout> | undefined;
  const child = spawn(argv[0], argv.slice(1), { cwd: options.cwd, env: options.env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let finish!: () => void;
  const done = new Promise<void>((resolve) => { finish = resolve; });
  const problem = (error: unknown) => { failure ??= error instanceof Error ? error.message : String(error); };
  function sample() {
    try {
      const queue = [...identities.values()];
      for (let i = 0; i < queue.length; i++) {
        const identity = queue[i];
        if (!processAlive(identity)) { identities.delete(identity.pid); continue; }
        let children: string;
        try { children = readFileSync(`/proc/${identity.pid}/task/${identity.pid}/children`, "utf8"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
        for (const text of children.trim().split(/\s+/).filter(Boolean)) {
          const current = processIdentity(Number(text));
          if (!current || current.ppid !== identity.pid || identities.has(current.pid)) continue;
          if (identities.size >= 4096) { uncertain = true; break; }
          identities.set(current.pid, current); queue.push(current);
        }
      }
    } catch (error) { uncertain = true; problem(error); }
  }
  function signalOwned(signal: NodeJS.Signals) {
    sample();
    try {
      for (const identity of [...identities.values()].reverse()) {
        if (identity.pid !== owner?.pid && processAlive(identity)) process.kill(identity.pid, signal);
      }
      if (owner && processAlive(owner)) {
        const current = processIdentity(owner.pid)!;
        if (current.ppid !== process.pid || current.group !== current.pid || current.session !== current.pid) throw new Error("Acceptance process ownership changed");
        process.kill(-current.pid, signal);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") { uncertain = true; problem(error); } }
  }
  const abandon = () => { uncertain = true; child.stdout.destroy(); child.stderr.destroy(); child.unref(); finish(); };
  function interrupt() {
    if (interrupted) return;
    interrupted = true; signalOwned("SIGTERM");
    escalation = setTimeout(() => { signalOwned("SIGKILL"); abandonTimer = setTimeout(abandon, 5000); }, options.graceMs ?? 10000);
  }
  child.once("spawn", () => {
    try {
      owner = processIdentity(child.pid!);
      if (!owner) throw new Error("Cannot authenticate acceptance process");
      identities.set(owner.pid, owner); options.onSpawn?.(owner); sample();
    } catch (error) { uncertain = true; problem(error); interrupt(); }
  });
  child.once("error", problem);
  child.once("exit", (status) => { code = status; pipeTimer = setTimeout(abandon, 1500); });
  child.once("close", (status) => { code = status; closed = true; clearTimeout(pipeTimer); finish(); });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("error", (error) => { uncertain = true; problem(error); interrupt(); });
    stream.on("data", (bytes: Buffer) => {
      try {
        if ((bytesWritten += bytes.length) > 16 * 1024 * 1024) throw new Error("Acceptance log exceeded 16 MiB; run stopped, original prefix retained");
        let offset = 0;
        while (offset < bytes.length) offset += writeSync(log, bytes, offset);
      } catch (error) { problem(error); interrupt(); }
    });
  }
  const sampler = setInterval(sample, 100);
  options.signal.addEventListener("abort", interrupt, { once: true });
  if (options.signal.aborted) interrupt();
  try {
    await done;
    sample();
    const deadline = Date.now() + (interrupted ? (options.graceMs ?? 10000) + 5000 : 1500);
    while (identities.size && Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 25)); sample(); }
    if (owner) {
      try { process.kill(-owner.pid, 0); uncertain = true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") uncertain = true; }
    }
    fsyncSync(log);
    return { code, interrupted, error: failure, settled: closed && !uncertain && identities.size === 0, scope: executionScope };
  } finally {
    clearInterval(sampler); clearTimeout(escalation); clearTimeout(abandonTimer); clearTimeout(pipeTimer);
    options.signal.removeEventListener("abort", interrupt); closeSync(log);
  }
}
