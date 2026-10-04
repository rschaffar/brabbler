import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { isAbsolute } from "node:path";
import { gitExecEnv } from "./git-exec";

/** Native primitive. The owner must retain the pinned directory FDs
 * through TRUE child lifetime (including after a bounded cleanup failure), and
 * supply its genuine original authority guard. Use getNativeRefTransactionReaped
 * before closing/reusing the ORIGINAL pinned parent FDs when childReaped is false.
 * This does not authorize an operation, pin paths, or protect checkout/index data.
 */
export interface NativeRefTransactionRequest {
  gitDir: string;
  commonDir: string;
  workTree: string;
  sourceBranch: string;
  expectedSourceOid: string;
  targetBranch: string;
  expectedTargetOid: string;
  updateOid: string;
  signal?: AbortSignal;
  /** Entire lifetime, including time the caller holds prepared locks; 1..30000ms. */
  timeoutMs?: number;
  assertAuthoritySync: () => void;
}

export interface NativeRefTransactionOutcome {
  readonly preparationAcknowledged: boolean;
  /** Submission was attempted; even a failed write is not proof of no effect. */
  readonly commitSent: boolean;
  readonly commitAcknowledged: boolean;
  readonly abortAcknowledged: boolean;
  readonly childReaped: boolean;
  /** Measurements taken while prepared; NOT post-commit state or success proof. */
  readonly observedSourceOid?: string;
  readonly observedTargetOid?: string;
}

export interface NativeRefTransaction {
  commit(): Promise<NativeRefTransactionOutcome>;
  abort(): Promise<NativeRefTransactionOutcome>;
}

type MutableOutcome = { -readonly [K in keyof NativeRefTransactionOutcome]: NativeRefTransactionOutcome[K] };
const diagnostics = new WeakMap<object, () => NativeRefTransactionOutcome>();
const reaping = new WeakMap<object, Promise<void>>();
const handles = new WeakMap<object, Transaction>();

/** Original handles/errors only. Copies and serialized diagnostics confer nothing. */
export function getNativeRefTransactionOutcome(value: unknown): NativeRefTransactionOutcome | undefined {
  return value !== null && (typeof value === "object" || typeof value === "function")
    ? diagnostics.get(value)?.() : undefined;
}

/** Authenticated lifecycle notification, NOT success/authority. Only original
 * handles/helper-issued errors are accepted; copies/JSON/booleans yield undefined.
 * Resolves once the transaction has ended AND every owned child has really closed.
 * Does not keep Node alive and may remain pending indefinitely. Retain ORIGINAL
 * directory FDs until it resolves: reopening/dup'ing paths may retarget delayed Git.
 */
export function getNativeRefTransactionReaped(value: unknown): Promise<void> | undefined {
  return value !== null && (typeof value === "object" || typeof value === "function")
    ? reaping.get(value) : undefined;
}

function validate(request: NativeRefTransactionRequest): NativeRefTransactionRequest {
  // Snapshot every supplied field before any asynchronous work. Never reread a
  // mutable request or replace the owner's original guard with a cached verdict.
  const r = { gitDir: request.gitDir, commonDir: request.commonDir, workTree: request.workTree,
    sourceBranch: request.sourceBranch, expectedSourceOid: request.expectedSourceOid,
    targetBranch: request.targetBranch, expectedTargetOid: request.expectedTargetOid,
    updateOid: request.updateOid, signal: request.signal, timeoutMs: request.timeoutMs ?? 15_000,
    assertAuthoritySync: request.assertAuthoritySync };
  for (const path of [r.gitDir, r.commonDir, r.workTree]) {
    if (typeof path !== "string" || !isAbsolute(path) || Buffer.byteLength(path) > 4096 || /[\x00-\x1f\x7f]/.test(path)) {
      throw new Error("Native ref transaction requires bounded absolute pinned directories");
    }
  }
  for (const ref of [r.sourceBranch, r.targetBranch]) {
    if (typeof ref !== "string" || Buffer.byteLength(ref) > 1024 || !ref.startsWith("refs/heads/") ||
      /[\x00-\x20\x7f~^:?*\[\\]/.test(ref) || ref.includes("..") || ref.includes("@{") ||
      ref.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) {
      throw new Error("Native ref transaction requires full local branch ref names");
    }
  }
  if (r.sourceBranch === r.targetBranch) throw new Error("Source and target refs must differ");
  const oids = [r.expectedSourceOid, r.expectedTargetOid, r.updateOid];
  if (oids.some((oid) => typeof oid !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid) || /^0+$/.test(oid)) ||
    oids.some((oid) => oid.length !== r.expectedSourceOid.length)) throw new Error("Expected full nonzero same-format OIDs");
  if (!Number.isInteger(r.timeoutMs) || r.timeoutMs < 1 || r.timeoutMs > 30_000) throw new Error("Invalid native transaction deadline");
  if (typeof r.assertAuthoritySync !== "function" || Object.prototype.toString.call(r.assertAuthoritySync) === "[object AsyncFunction]") {
    throw new Error("Authority guard must be an original synchronous void function");
  }
  if (r.signal !== undefined && !(r.signal instanceof AbortSignal)) throw new Error("Invalid cancellation signal");
  return Object.freeze(r);
}

function assertAuthority(guard: () => void): void {
  const result: unknown = guard();
  if (result !== undefined) {
    // Assimilate thenables too, including rejected promises, without awaiting or
    // treating their eventual value as authority. No unhandled rejection leaks.
    void Promise.resolve(result).catch(() => {});
    throw new Error("Authority guard must return synchronous void, not a value or thenable");
  }
}

interface ProcessRecord {
  child: ChildProcessWithoutNullStreams;
  closed: boolean;
  code: number | null;
  output: string;
  bytes: number;
}

class Transaction {
  readonly outcome: MutableOutcome = { preparationAcknowledged: false, commitSent: false,
    commitAcknowledged: false, abortAcknowledged: false, childReaped: true };
  private readonly processes: ProcessRecord[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly request: NativeRefTransactionRequest;
  private resolveReaped!: () => void;
  private readonly reaped = new Promise<void>((resolve) => { this.resolveReaped = resolve; });
  private main?: ProcessRecord;
  private failure?: Error;
  private cleanup?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private expiresAt = Infinity;
  private consumed = false;
  private held = false;
  private finished = false;
  private expected: string[] = [];
  private protocolBuffer = "";
  private readonly cancelled = () => { this.fail(new Error("Native ref transaction cancelled")); };

  constructor(request: NativeRefTransactionRequest) { this.request = request; }

  snapshot = (): NativeRefTransactionOutcome => Object.freeze({ ...this.outcome });

  error(message: string): Error {
    const error = new Error(message);
    diagnostics.set(error, this.snapshot);
    reaping.set(error, this.reaped);
    return error;
  }

  private pulse(): void { for (const listener of [...this.listeners]) listener(); }

  private fail(reason: unknown): void {
    if (this.finished) return;
    this.failure ??= this.error(reason instanceof Error ? reason.message.slice(0, 1024) : "Native ref transaction failed");
    this.pulse();
    void this.stop();
  }

  private check(): void {
    if (this.request.signal?.aborted) this.fail(new Error("Native ref transaction cancelled"));
    if (!this.finished && performance.now() >= this.expiresAt) this.fail(new Error("Native ref transaction deadline exceeded"));
    if (this.failure) throw this.failure;
    if (this.finished) throw this.error("Native ref transaction has ended");
  }

  private async wait(predicate: () => boolean, process: ProcessRecord): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (this.failure) { this.listeners.delete(check); reject(this.failure); }
        else if (predicate()) { this.listeners.delete(check); resolve(); }
        else if (process.closed) { this.listeners.delete(check); reject(this.error("Git exited before native acknowledgement")); }
      };
      this.listeners.add(check);
      check();
    });
  }

  private spawnGit(args: string[], protocol = false): ProcessRecord {
    const r = this.request;
    const env = { ...gitExecEnv(), GIT_DIR: r.gitDir, GIT_COMMON_DIR: r.commonDir, GIT_WORK_TREE: r.workTree,
      GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1" };
    const argv = ["--git-dir", r.gitDir, "--work-tree", r.workTree,
      "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false",
      "-c", "tag.gpgSign=false", "-c", "gc.auto=0", "-c", "maintenance.auto=false", ...args];
    this.check();
    assertAuthority(r.assertAuthoritySync);
    this.check(); // A synchronous guard may itself cancel the operation.
    const child = spawn("git", argv, { cwd: r.workTree, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const p: ProcessRecord = { child, closed: false, code: null, output: "", bytes: 0 };
    this.processes.push(p);
    this.outcome.childReaped = false;
    child.on("error", (error) => this.fail(error));
    child.stdin.on("error", (error) => this.fail(error));
    child.stdout.on("error", (error) => this.fail(error));
    child.stderr.on("error", (error) => this.fail(error));
    child.stdout.setEncoding("utf8");
    const receive = (chunk: string | Buffer, stdout: boolean) => {
      p.bytes += Buffer.byteLength(chunk);
      if (p.bytes > 16 * 1024) { this.fail(new Error("Native Git output limit exceeded")); return; }
      if (stdout) {
        if (protocol) this.receiveProtocol(String(chunk));
        else p.output += String(chunk);
      }
      this.pulse();
    };
    child.stdout.on("data", (chunk: string) => receive(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => receive(chunk, false));
    child.on("close", (code) => {
      p.closed = true; p.code = code;
      this.outcome.childReaped = this.processes.every((process) => process.closed);
      if (this.finished && this.outcome.childReaped) this.resolveReaped();
      if (protocol && this.held && !this.consumed) this.fail(new Error("Prepared Git transaction exited unexpectedly"));
      this.pulse();
    });
    return p;
  }

  private receiveProtocol(chunk: string): void {
    this.protocolBuffer += chunk;
    let newline: number;
    while ((newline = this.protocolBuffer.indexOf("\n")) >= 0) {
      const line = this.protocolBuffer.slice(0, newline);
      this.protocolBuffer = this.protocolBuffer.slice(newline + 1);
      if (line !== this.expected.shift()) { this.fail(new Error("Unexpected native Git acknowledgement")); return; }
      if (line === "prepare: ok") this.outcome.preparationAcknowledged = true;
      if (line === "commit: ok") this.outcome.commitAcknowledged = true;
      if (line === "abort: ok") this.outcome.abortAcknowledged = true;
    }
  }

  private finish(): void {
    this.finished = true;
    clearTimeout(this.timer);
    this.request.signal?.removeEventListener("abort", this.cancelled);
    if (this.outcome.childReaped) this.resolveReaped();
  }

  private detachResidualReferences(): void {
    for (const { child, closed } of this.processes) {
      if (closed) continue;
      child.unref();
      for (const stream of [child.stdin, child.stdout, child.stderr]) {
        // Node's subprocess pipes are sockets with unref(). Keep listeners and
        // continue draining for truthful late acknowledgements/close diagnostics.
        if ("unref" in stream && typeof stream.unref === "function") stream.unref();
        else stream.destroy(); // Defensive fallback for non-socket pipe handles.
      }
    }
  }

  /** Only signal owned children. Git owns/removes its locks; never unlink them. */
  private stop(): Promise<void> {
    if (this.cleanup) return this.cleanup;
    this.cleanup = (async () => {
      for (const p of this.processes) if (!p.closed) p.child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const check = () => {
          if (!this.processes.every((p) => p.closed)) return;
          done();
        };
        const done = () => {
          clearTimeout(killTimer); clearTimeout(reapTimer);
          this.listeners.delete(check); resolve();
        };
        this.listeners.add(check);
        const killTimer = setTimeout(() => { for (const p of this.processes) if (!p.closed) p.child.kill("SIGKILL"); }, 100);
        // Bound event-loop ownership too, not just this promise. Retain close
        // listeners and report childReaped:false until actual close. Callers must
        // keep ORIGINAL pin FDs until the authenticated reaped promise resolves.
        const reapTimer = setTimeout(() => { this.detachResidualReferences(); done(); }, 1100);
        check();
      });
      this.finish();
    })();
    return this.cleanup;
  }

  async prepare(): Promise<NativeRefTransaction> {
    try {
      this.expiresAt = performance.now() + this.request.timeoutMs!;
      this.request.signal?.addEventListener("abort", this.cancelled, { once: true });
      this.timer = setTimeout(() => this.fail(new Error("Native ref transaction deadline exceeded")), this.request.timeoutMs);
      this.expected = ["start: ok", "prepare: ok"];
      this.main = this.spawnGit(["update-ref", "--stdin"], true);
      const r = this.request;
      const preparation = `start\noption no-deref\nverify ${r.sourceBranch} ${r.expectedSourceOid}\noption no-deref\nupdate ${r.targetBranch} ${r.updateOid} ${r.expectedTargetOid}\nprepare\n`;
      this.check();
      assertAuthority(r.assertAuthoritySync);
      this.check();
      this.main.child.stdin.write(preparation);
      await this.wait(() => this.outcome.preparationAcknowledged, this.main);
      this.check();
      // no-deref alone can accept a symref with the same resolved OID! Inspect
      // BOTH original bindings after preparation, while Git holds their locks.
      // for-each-ref supports files/packed refs/reftable without filesystem parsing.
      const inspect = this.spawnGit(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "--", r.sourceBranch, r.targetBranch]);
      inspect.child.stdin.end();
      await this.wait(() => inspect.closed, inspect);
      if (inspect.code !== 0) throw this.error("Cannot inspect prepared ref bindings");
      const bindings = new Map<string, string>();
      for (const line of inspect.output.trimEnd().split("\n")) {
        const parts = line.split("\0");
        if (parts.length !== 3 || parts[2] || bindings.has(parts[0]) ||
          (parts[0] !== r.sourceBranch && parts[0] !== r.targetBranch)) throw this.error("Prepared branches must have direct ref bindings");
        bindings.set(parts[0], parts[1]);
      }
      if (bindings.get(r.sourceBranch) !== r.expectedSourceOid || bindings.get(r.targetBranch) !== r.expectedTargetOid) {
        throw this.error("Prepared direct ref bindings do not match expected OIDs");
      }
      this.outcome.observedSourceOid = r.expectedSourceOid;
      this.outcome.observedTargetOid = r.expectedTargetOid;
      this.check();
      if (this.main.closed) throw this.error("Prepared Git transaction exited unexpectedly");
      this.held = true;
      const handle: NativeRefTransaction = Object.freeze({
        commit(this: NativeRefTransaction) { return consume(this, true); },
        abort(this: NativeRefTransaction) { return consume(this, false); },
      });
      handles.set(handle, this);
      diagnostics.set(handle, this.snapshot);
      reaping.set(handle, this.reaped);
      return handle;
    } catch (error) {
      this.fail(error); await this.stop(); throw this.failure ?? error;
    }
  }

  async consume(commit: boolean): Promise<NativeRefTransactionOutcome> {
    if (this.consumed) throw this.error("Native ref transaction already consumed");
    this.consumed = true; // Before guard callbacks/awaits: blocks reentrancy too.
    try {
      this.check();
      const main = this.main!;
      const command = commit ? "commit" : "abort";
      this.expected = [`${command}: ok`];
      if (commit) {
        assertAuthority(this.request.assertAuthoritySync);
        this.check();
        this.outcome.commitSent = true;
        main.child.stdin.write("commit\n");
      } else main.child.stdin.write("abort\n");
      main.child.stdin.end();
      await this.wait(() => commit ? this.outcome.commitAcknowledged : this.outcome.abortAcknowledged, main);
      await this.wait(() => main.closed, main);
      if (main.code !== 0) throw this.error("Git failed after native acknowledgement");
      this.finish();
      return this.snapshot();
    } catch (error) {
      this.fail(error); await this.stop(); throw this.failure ?? error;
    }
  }
}

async function consume(handle: NativeRefTransaction, commit: boolean): Promise<NativeRefTransactionOutcome> {
  const transaction = handles.get(handle);
  if (!transaction) throw new Error("Original native ref transaction handle required");
  return transaction.consume(commit);
}

export async function prepareNativeRefTransaction(request: NativeRefTransactionRequest): Promise<NativeRefTransaction> {
  return new Transaction(validate(request)).prepare();
}
