import { spawn, execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, mkdtempSync, openSync, readSync, realpathSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_LOG = 8 * 1024 * 1024;
const MAX_TIME = 5 * 60_000;
const POLL_MS = 75;
const ADMIN_MS = 2_000;
const CLEANUP_MS = 5_000;
const PROPERTIES = ["Id", "LoadState", "ControlGroup", "MainPID", "ActiveState", "SubState", "Result", "ExecMainCode", "ExecMainStatus", "Delegate", "KillMode", "RemainAfterExit", "Restart", "InvocationID"] as const;

/** Process-tree accounting only: NOT filesystem/network/write isolation or a sandbox.
 * Hostile code can ask the user manager to start another service outside this cgroup;
 * external writers and intentional cgroup migration are outside this guarantee.
 */
export interface ContainedCheckOptions {
  cwd: string;
  argv: readonly string[];
  /** Unique, never reused service name supplied by the verification operation. */
  unit: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Bounded to 8 MiB; defaults to 8 MiB. */
  maxLogBytes?: number;
  env?: NodeJS.ProcessEnv;
}
export interface ContainedCheckResult {
  /** Only 0 together with containmentComplete (and no timeout/overflow) can pass a check. */
  status: number | null;
  log: Buffer;
  containmentComplete: boolean;
  timedOut: boolean;
  overflow: boolean;
  /** Keep this identity for manual inspection when cleanup/proof fails. */
  unit: string;
  /** Positive cleanup evidence, independent of check status or containmentComplete.
   * It covers only the original pinned cgroup, not writers outside that cgroup.
   */
  cleanupProof?: {
    unit: string;
    cgroupIdentity: string;
    invocation: string;
    empty: true;
    emptyEvidence: "pinned-populated-zero" | "verified-removed";
    terminal: true;
    payload: "release-attempted" | "prevented-before-write";
  };
  /** Private output survives uncertain cleanup; never expose its contents to untrusted clients. */
  evidenceDir?: string;
}

type Unit = Record<(typeof PROPERTIES)[number], string>;
export interface CgroupObservation {
  /** Cgroup device:inode, NOT a process ID. */
  identity: string;
  populated: boolean;
  /** True only when the live gated launcher is the sole process and no child cgroup exists. */
  launcherPlaced: boolean;
  unit: Unit;
}
export interface CheckTransport {
  /** Resolves when systemd-run starts; observe() must still prove manager acceptance. */
  started: Promise<void>;
  release(payload: string): void;
  ready?(): boolean;
  outputSize?(): number;
  output(onChunk: (chunk: Buffer) => void): void;
  closeInput(): void;
  /** OS backend reads its bounded private file after stopping the unit. */
  readOutput?(): { log: Buffer; overflow: boolean };
  evidenceDir?: string;
  /** May remove evidence only after verified terminal state and log capture. */
  dispose(terminal?: boolean): void;
}
/** Injection point for deterministic protocol tests; an injected backend is NOT OS containment evidence. */
export interface ContainmentBackend {
  absent(unit: string, ms: number): Promise<boolean>;
  start(options: ContainedCheckOptions): CheckTransport;
  /** null means systemd has not yet placed the gated launcher; only valid before release. */
  observe(unit: string, ms: number): Promise<CgroupObservation | null>;
  stop(unit: string, ms: number): Promise<void>;
  terminal(unit: string, invocation: string, ms: number): Promise<boolean>;
  /** Read ONLY the originally pinned cgroup after stop, never a path/PID discovered during cleanup.
   * A missing pin, changed identity or uncertain removal must return undefined/throw.
   */
  originalEmpty(unit: string, identity: string, invocation: string, ms: number): Promise<"pinned-populated-zero" | "verified-removed" | undefined>;
  forget?(unit: string): Promise<void>;
}

// The launcher receives no user command until AFTER systemd placed it and the
// caller has checked the live PID, cgroup identity and populated bit. The
// private socket is a one-shot gate, not a completion signal. Descendants may close stdio.
const LAUNCHER = `
const { spawn } = require('node:child_process');
const { connect } = require('node:net');
const socket = connect(process.argv[1]);
let input = Buffer.alloc(0), done = false;
socket.on('connect', () => socket.write(process.argv[2] + '\\n'));
socket.on('error', () => process.exit(125));
socket.on('data', part => {
  if (done) return;
  input = Buffer.concat([input, part]);
  if (input.length > 1048576) process.exit(125);
  const end = input.indexOf(10);
  if (end < 0) return;
  done = true;
  socket.end();
  try {
    const { argv, env } = JSON.parse(input.subarray(0, end).toString('utf8'));
    if (!Array.isArray(argv) || !argv.length || typeof argv[0] !== 'string') process.exit(125);
    const child = spawn(argv[0], argv.slice(1), { shell: false, stdio: ['ignore', 'inherit', 'inherit'], env });
    child.on('error', () => process.exit(125));
    child.on('exit', (code, signal) => process.exit(signal ? 128 : code ?? 125));
  } catch { process.exit(125); }
});
socket.on('end', () => { if (!done) process.exit(125); });
`;

function valid(options: ContainedCheckOptions): boolean {
  if (process.platform !== "linux" || !options || !path.isAbsolute(options.cwd)) return false;
  try {
    const cwd = lstatSync(options.cwd);
    if (!cwd.isDirectory() || cwd.isSymbolicLink() || realpathSync(options.cwd) !== options.cwd) return false;
  } catch { return false; }
  return /^pi-web-git-check-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.service$/.test(options.unit) &&
    Array.isArray(options.argv) && options.argv.length > 0 &&
    options.argv.every((arg) => typeof arg === "string" && !arg.includes("\0")) &&
    Number.isSafeInteger(options.timeoutMs ?? MAX_TIME) && (options.timeoutMs ?? MAX_TIME) > 0 && (options.timeoutMs ?? MAX_TIME) <= MAX_TIME &&
    Number.isSafeInteger(options.maxLogBytes ?? MAX_LOG) && (options.maxLogBytes ?? MAX_LOG) > 0 && (options.maxLogBytes ?? MAX_LOG) <= MAX_LOG;
}
/** Allocate a fresh identity; callers should persist it in their operation context until cleanup. */
export function newGitCheckUnit(): string { return `pi-web-git-check-${randomUUID()}.service`; }

function fields(text: string): Unit {
  const values: Record<string, string> = {};
  for (const line of text.trimEnd().split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const key = line.slice(0, i);
      if (key in values) throw new Error("duplicate unit property");
      values[key] = line.slice(i + 1);
    }
  }
  if (PROPERTIES.some((key) => !(key in values))) throw new Error("incomplete unit properties");
  return values as Unit;
}
async function show(unit: string, ms: number): Promise<Unit> {
  const { stdout } = await exec("systemctl", ["--user", "--no-pager", "show", ...PROPERTIES.map((p) => `--property=${p}`), "--", unit],
    { timeout: ms, maxBuffer: 16 * 1024, encoding: "utf8" });
  return fields(stdout);
}
async function control(unit: string, operation: "stop", ms: number): Promise<void> {
  await exec("systemctl", ["--user", "--no-pager", operation, "--", unit], { timeout: ms, maxBuffer: 16 * 1024 });
}
function groupPath(group: string): string {
  if (!group.startsWith("/") || group === "/" || group.slice(1).split("/").some((part) => !part || part === ".." || part === "."))
    throw new Error("invalid control group");
  return `/sys/fs/cgroup${group}`;
}
/** Refuse alternate cgroup mounts/namespaces: the manager path must address this host's v2 hierarchy. */
async function checkMount(): Promise<void> {
  const info = await fs.readFile("/proc/self/mountinfo", "utf8");
  const lines = info.split("\n").filter((line) => line.split(" ")[4] === "/sys/fs/cgroup");
  if (lines.length !== 1 || !lines[0].includes(" - cgroup2 ") || lines[0].split(" ")[3] !== "/" ||
      (await fs.realpath("/sys/fs/cgroup")) !== "/sys/fs/cgroup") throw new Error("cgroup v2 mount unavailable");
}
function privateDirectory(dir: string): boolean {
  const st = lstatSync(dir);
  return st.isDirectory() && !st.isSymbolicLink() && st.uid === process.getuid!() &&
    (st.mode & 0o077) === 0 && realpathSync(dir) === dir;
}
function privateRuntimeRoot(): string {
  const root = `/run/user/${process.getuid!()}`;
  if (!privateDirectory(root)) throw new Error("private user runtime directory unavailable");
  return root;
}
function eligible(u: Unit, name: string, group: string): boolean {
  return u.Id === name && u.LoadState === "loaded" && u.ControlGroup === group &&
    u.Delegate === "no" && u.KillMode === "control-group" && u.RemainAfterExit === "yes" && u.Restart === "no" &&
    /^[0-9a-fA-F]{32}$/.test(u.InvocationID);
}
/** Real backend: systemd starts a NON-delegated transient user service, not a scope. */
interface PinnedGroup { events: FileHandle; identity: string; invocation: string; group: string }
const pinned = new Map<string, PinnedGroup>();
async function readPinned(events: FileHandle): Promise<boolean> {
  const bytes = Buffer.alloc(4096);
  const { bytesRead } = await events.read(bytes, 0, bytes.length, 0);
  const matches = [...bytes.subarray(0, bytesRead).toString("utf8").matchAll(/^populated ([01])$/gm)];
  if (matches.length !== 1) throw new Error("missing pinned population evidence");
  return matches[0][1] === "1";
}
/** The open cgroup.events fd pins the ORIGINAL cgroup even if systemd later
 * removes its path when a short command exits. Never substitute a new path/PID.
 */
const systemdImplementation: ContainmentBackend = {
  async absent(unit, ms) {
    await checkMount();
    privateRuntimeRoot();
    // Conservatively require a known-modern manager AND client with append:
    // file stdio, resource limits and non-delegated transient user services.
    // Missing/old systemd fails before a verification ledger intent is made.
    const [client, manager] = await Promise.all([
      exec("systemd-run", ["--version"], { timeout: ms, maxBuffer: 2048, encoding: "utf8" }),
      exec("systemctl", ["--user", "show", "--property=Version"], { timeout: ms, maxBuffer: 2048, encoding: "utf8" }),
    ]);
    if (Number(client.stdout.match(/^systemd (\d+)/m)?.[1]) < 256 ||
        Number(manager.stdout.match(/^Version=(\d+)/m)?.[1]) < 256) return false;
    const u = await show(unit, ms);
    return u.LoadState === "not-found" && u.ActiveState === "inactive";
  },
  start(options) {
    const root = privateRuntimeRoot();
    const dir = mkdtempSync(path.join(root, "pi-web-git-check-"));
    let fd: number;
    try {
      if (!privateDirectory(dir)) throw new Error("unsafe check directory");
      fd = openSync(path.join(dir, "output"), constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR, 0o600);
    } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error; }
    const output = path.join(dir, "output");
    const original = lstatSync(output);
    const opened = fstatSync(fd);
    if (!original.isFile() || original.isSymbolicLink() || original.uid !== process.getuid!() ||
        original.nlink !== 1 || (original.mode & 0o077) !== 0 ||
        original.dev !== opened.dev || original.ino !== opened.ino) {
      closeSync(fd);
      rmSync(dir, { recursive: true, force: true });
      throw new Error("unsafe private output");
    }
    const socketPath = path.join(dir, "gate.sock");
    const nonce = randomUUID();
    const max = options.maxLogBytes ?? MAX_LOG;
    const server = createServer();
    server.on("error", () => {});
    let peer: Socket | undefined;
    let ready = false;
    server.on("connection", (socket) => {
      if (peer) { socket.destroy(); return; }
      peer = socket;
      socket.on("error", () => { ready = false; });
      let handshake = "";
      socket.on("data", (data: Buffer) => {
        if (ready) return;
        handshake += data.toString("utf8");
        if (handshake.length > 64) { socket.destroy(); return; }
        if (handshake.includes("\n")) {
          if (handshake !== `${nonce}\n`) { socket.destroy(); return; }
          ready = true;
        }
      });
      socket.on("close", () => { ready = false; });
    });
    let child: ReturnType<typeof spawn> | undefined;
    const started = new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        const args = ["--user", "--quiet", "--remain-after-exit", "--service-type=exec", "--expand-environment=no",
          `--unit=${options.unit}`, `--working-directory=${options.cwd}`,
          "--property=Delegate=no", "--property=KillMode=control-group", "--property=Restart=no",
          "--property=TimeoutStopSec=2s", "--property=SendSIGKILL=yes",
          // The manager, not Pi Web, owns this deadline after a server crash.
          // The durable Git intent remains quarantined until inspection.
          `--property=RuntimeMaxSec=${(options.timeoutMs ?? MAX_TIME) + 10_000}ms`,
          // RLIMIT_FSIZE applies to other regular-file writes too; a conservative
          // tradeoff to give the private append log a kernel-enforced hard cap.
          `--property=LimitFSIZE=${max}`, `--property=StandardOutput=append:${output}`, `--property=StandardError=append:${output}`,
          "--", process.execPath, "-e", LAUNCHER, socketPath, nonce];
        // No check argv/env goes on the unit command line or to the journal.
        child = spawn("systemd-run", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
        child.on("error", () => {});
        child.stdout?.on("data", () => {}); // discard manager diagnostics, never count as check output
        child.stderr?.on("data", () => {});
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    });
    return {
      started, evidenceDir: dir,
      ready() { return ready; },
      outputSize() { return fstatSync(fd).size; },
      release(payload) { if (!ready || !peer || peer.destroyed) throw new Error("launcher socket unavailable"); peer.write(payload); },
      closeInput() { /* socket gate remains until manager reports terminal */ },
      output() { /* check output is in the private capped file */ },
      readOutput() {
        const now = lstatSync(output);
        if (!now.isFile() || now.isSymbolicLink() || now.dev !== original.dev || now.ino !== original.ino ||
            now.nlink !== 1 || (now.mode & 0o077) !== 0) throw new Error("check output replaced");
        const count = Math.min(now.size, max);
        const bytes = Buffer.alloc(count);
        let offset = 0;
        while (offset < count) {
          const n = readSync(fd, bytes, offset, count - offset, offset);
          if (!n) throw new Error("check output truncated");
          offset += n;
        }
        return { log: bytes, overflow: now.size >= max };
      },
      dispose(terminal) {
        peer?.destroy();
        try { server.close(); } catch { /* may have failed before listen */ }
        child?.stdout?.destroy(); child?.stderr?.destroy();
        if (child && child.exitCode === null) child.kill("SIGKILL"); // systemd-run relay only
        closeSync(fd);
        if (terminal) rmSync(dir, { recursive: true, force: true });
      },
    };
  },
  async observe(name, ms) {
    const u = await show(name, ms);
    const group = u.ControlGroup;
    const known = pinned.get(name);
    // Nonzero exit marks a transient service failed and can remove its cgroup
    // before the next poll. The pinned ORIGINAL cgroup still provides the only
    // acceptable population/removal evidence; never infer it from the exit code.
    const exited = (unit: Unit) => unit.ActiveState === "active" && unit.SubState === "exited" && unit.Result === "success" ||
      unit.ActiveState === "failed" && unit.SubState === "failed" && unit.Result === "exit-code";
    if (!group && known && u.Id === name && u.LoadState === "loaded" && exited(u) &&
        u.MainPID === "0" && u.InvocationID === known.invocation &&
        u.Delegate === "no" && u.KillMode === "control-group" && u.RemainAfterExit === "yes" && u.Restart === "no") {
      let populated: boolean;
      try { populated = await readPinned(known.events); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENODEV") throw error;
        // A removed v2 cgroup's open events fd returns ENODEV. The kernel
        // refuses rmdir of a populated cgroup; require the ORIGINAL pathname
        // to be gone AND this exact non-restarting manager invocation to have
        // released it. A new directory/PID never substitutes for the old one.
        if (await fs.lstat(groupPath(known.group)).then(() => true, (e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return false;
          throw e;
        })) throw new Error("cgroup path unexpectedly exists");
        populated = false;
      }
      const after = await show(name, ms);
      if (after.ControlGroup || after.InvocationID !== known.invocation || !exited(after) ||
          after.ActiveState !== u.ActiveState || after.SubState !== u.SubState || after.MainPID !== "0")
        throw new Error("unit changed after cgroup path disappeared");
      return { identity: known.identity, populated, launcherPlaced: false, unit: after };
    }
    if ((u.LoadState === "not-found" && u.ActiveState === "inactive") ||
        (u.LoadState === "loaded" && !group && (u.ActiveState === "activating" || u.ActiveState === "inactive"))) return null;
    if (!eligible(u, name, group)) throw new Error("unit changed or lacks required policy");
    let dir: FileHandle;
    try { dir = await fs.open(groupPath(group), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW); }
    catch (error) {
      if (known && (error as NodeJS.ErrnoException).code === "ENOENT") {
        const latest = await show(name, ms);
        if (!latest.ControlGroup) return this.observe(name, ms);
      }
      throw error;
    }
    try {
      const stat = await dir.stat();
      const events = await fs.readFile(`/proc/self/fd/${dir.fd}/cgroup.events`, "utf8");
      const matches = [...events.matchAll(/^populated ([01])$/gm)];
      if (matches.length !== 1) throw new Error("missing population evidence");
      const pid = Number(u.MainPID);
      let launcherPlaced = false;
      if (Number.isSafeInteger(pid) && pid > 1) {
        try {
          const [membership, procs, entries] = await Promise.all([
            fs.readFile(`/proc/${pid}/cgroup`, "utf8"), fs.readFile(`/proc/self/fd/${dir.fd}/cgroup.procs`, "utf8"),
            fs.readdir(`/proc/self/fd/${dir.fd}`, { withFileTypes: true }),
          ]);
          // The private cgroup starts with exactly the inert launcher, not
          // another pre-existing command hidden in a nested cgroup.
          launcherPlaced = membership.trim() === `0::${group}` && procs.trim() === String(pid) &&
            !entries.some((entry) => entry.isDirectory());
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          // Launcher exited between property read and /proc read. No pre-start proof.
        }
      }
      const after = await show(name, ms);
      if (!eligible(after, name, group) || after.InvocationID !== u.InvocationID ||
          (await dir.stat()).ino !== stat.ino) throw new Error("unit/cgroup identity changed");
      const identity = `${stat.dev}:${stat.ino}:${u.InvocationID}:${group}`;
      if (launcherPlaced && !pinned.has(name)) {
        const eventsFile = await fs.open(`/proc/self/fd/${dir.fd}/cgroup.events`, "r");
        try {
          if (await readPinned(eventsFile) !== (matches[0][1] === "1"))
            throw new Error("population changed during pre-start proof");
        } catch (error) { await eventsFile.close(); throw error; }
        pinned.set(name, { events: eventsFile, identity, invocation: u.InvocationID, group });
      }
      if (pinned.has(name) && pinned.get(name)?.identity !== identity) throw new Error("cgroup replaced");
      return { identity, populated: matches[0][1] === "1", launcherPlaced, unit: after };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENODEV" && known) {
        const latest = await show(name, ms);
        if (!latest.ControlGroup) return this.observe(name, ms);
      }
      throw error;
    } finally { await dir.close(); }
  },
  stop(name, ms) { return control(name, "stop", ms); },
  async originalEmpty(name, identity, invocation, ms) {
    const original = pinned.get(name);
    if (!original || !identity || !invocation || original.identity !== identity || original.invocation !== invocation) return;
    let emptyEvidence: "pinned-populated-zero" | "verified-removed";
    try {
      if (await readPinned(original.events)) return;
      emptyEvidence = "pinned-populated-zero";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENODEV") return;
      // ENODEV on the pinned events fd means the original group was removed.
      // Refuse a path now occupied by a replacement (or an indeterminate stat).
      const gone = await fs.lstat(groupPath(original.group)).then(() => false, (e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return true;
        throw e;
      });
      if (!gone) return;
      emptyEvidence = "verified-removed"; // the kernel cannot remove a populated cgroup
    }
    // Recheck manager termination after reading the pin; stop alone, or an
    // empty cgroup belonging to a restarted service, is insufficient.
    if (await this.terminal(name, invocation, ms)) return emptyEvidence;
  },
  async forget(name) {
    const record = pinned.get(name);
    pinned.delete(name);
    await record?.events.close();
  },
  async terminal(name, invocation, ms) {
    const u = await show(name, ms);
    if (u.Id !== name) return false;
    // A transient unit may be collected immediately after stop. With a fresh,
    // never-reused name and the original pin, absence is terminal for that
    // invocation; absence without the pin cannot identify which run stopped.
    if (u.LoadState === "not-found" && u.ActiveState === "inactive")
      return !!invocation && pinned.get(name)?.invocation === invocation;
    // systemd may retain a failed transient unit after `stop`. With Restart=no,
    // no main PID/group and the same invocation it cannot restart; the separate
    // pinned-group read still has to prove that *all* descendants drained.
    return u.LoadState === "loaded" && !u.ControlGroup && u.MainPID === "0" &&
      u.Restart === "no" && u.InvocationID === invocation &&
      (u.ActiveState === "inactive" && u.SubState === "dead" ||
        u.ActiveState === "failed" && u.SubState === "failed" && u.Result === "exit-code");
  },
};
export const linuxSystemdBackend: ContainmentBackend = Object.freeze(systemdImplementation);

/** Fail closed: never infer completion from exit, pipe EOF, a process group, or a recycled PID.
 * A replacement backend is accepted only under node:test, never by a production caller.
 */
export async function runContainedGitCheck(options: ContainedCheckOptions, backend: ContainmentBackend = linuxSystemdBackend): Promise<ContainedCheckResult> {
  if (backend !== linuxSystemdBackend && !process.env.NODE_TEST_CONTEXT) throw new Error("test-only containment backend");
  return runProtocol(options, backend);
}

/** Availability is advisory: the gated launch must still re-prove placement. No user command is started here. */
export async function assertGitCheckContainmentAvailable(unit: string): Promise<void> {
  if (process.platform !== "linux" || !/^pi-web-git-check-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.service$/.test(unit))
    throw new Error("Linux check containment unavailable");
  try {
    if (await linuxSystemdBackend.absent(unit, ADMIN_MS)) return;
  } catch { /* never include systemctl output (may contain private paths) */ }
  throw new Error("Linux check containment unavailable");
}

/** Protocol-only injection; never exported to production clients. */
function pause(signal: AbortSignal | undefined, deadline: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, Math.min(POLL_MS, Math.max(1, deadline - Date.now())));
    function finish() { signal?.removeEventListener("abort", finish); clearTimeout(timer); resolve(); }
    signal?.addEventListener("abort", finish, { once: true });
    if (signal?.aborted) finish();
  });
}

/** Test-only protocol seam. It cannot change the production entry point's OS backend. */
export function __testRunContainedGitCheck(options: ContainedCheckOptions, fake: ContainmentBackend): Promise<ContainedCheckResult> {
  if (process.env.NODE_ENV !== "test") throw new Error("test-only containment seam");
  return runProtocol(options, fake);
}

async function runProtocol(options: ContainedCheckOptions, backend: ContainmentBackend): Promise<ContainedCheckResult> {
  const result: ContainedCheckResult = { unit: options?.unit ?? "", status: null, log: Buffer.alloc(0),
    containmentComplete: false, timedOut: false, overflow: false };
  if (!valid(options)) return result;
  const deadline = Date.now() + (options.timeoutMs ?? MAX_TIME);
  const remaining = () => Math.max(1, Math.min(ADMIN_MS, deadline - Date.now()));
  const expired = () => Date.now() >= deadline || !!options.signal?.aborted;
  let started = false;
  let identity = "";
  let invocation = "";
  let released = false;
  let releaseAttempted = false;
  let complete = false;
  let transport: CheckTransport | undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  const onChunk = (chunk: Buffer) => {
    const take = Math.max(0, Math.min(chunk.length, (options.maxLogBytes ?? MAX_LOG) - size));
    if (take) { chunks.push(chunk.subarray(0, take)); size += take; }
    if (take < chunk.length) result.overflow = true;
  };
  try {
    if (expired() || !await backend.absent(options.unit, remaining()) || expired()) return result;
    // The only unit command at this point is the inert, gated launcher.
    started = true; // even a failed start may have reached the manager: try stop
    transport = backend.start(options);
    result.evidenceDir = transport.evidenceDir;
    transport.output(onChunk);
    await transport.started;
    while (!expired() && !result.overflow) {
      if (transport.outputSize && transport.outputSize() >= (options.maxLogBytes ?? MAX_LOG)) { result.overflow = true; break; }
      let observation: CgroupObservation | null;
      try { observation = await backend.observe(options.unit, remaining()); }
      catch { break; } // missing evidence
      if (observation === null) {
        if (released) break;
        await pause(options.signal, deadline);
        continue; // systemd-run may still be submitting the gated service
      }
      const u = observation.unit;
      if (!released) {
        if (u.ActiveState === "activating" || (u.ActiveState === "active" && transport.ready && !transport.ready())) {
          await pause(options.signal, deadline); continue;
        }
        if (u.ActiveState !== "active" || !observation.populated || !observation.launcherPlaced) break;
        identity = observation.identity;
        invocation = u.InvocationID;
        const payload = JSON.stringify({ argv: options.argv, env: options.env ?? process.env }) + "\n";
        if (Buffer.byteLength(payload) > 1048576 || expired()) break;
        // A throwing release may already have written bytes to the gate.
        // Never call it "prevented before write" after an attempt.
        releaseAttempted = true;
        transport.release(payload);
        released = true;
      } else {
        if (identity !== observation.identity || invocation !== u.InvocationID) break;
        // RemainAfterExit holds the unit and its cgroup after ExecMain exits.
        // Read the *same* cgroup's recursive populated bit, not child/stdio state.
        if (!observation.populated && u.MainPID === "0" && u.ExecMainCode === "1" &&
            /^\d+$/.test(u.ExecMainStatus) &&
            (u.ActiveState === "active" && u.SubState === "exited" && u.Result === "success" ||
              u.ActiveState === "failed" && u.SubState === "failed" && u.Result === "exit-code")) {
          result.status = Number(u.ExecMainStatus);
          complete = true;
          break;
        }
        if (u.ActiveState !== "active" || (u.SubState !== "running" && u.SubState !== "exited")) break;
      }
      await pause(options.signal, deadline);
    }
    result.timedOut = expired();
  } catch { result.timedOut = expired(); }
  finally {
    try { transport?.closeInput(); } catch { /* cleanup still required */ }
    let terminal = false;
    if (started) {
      try {
        await backend.stop(options.unit, CLEANUP_MS);
        // A successful check also requires manager confirmation that this invocation
        // cannot restart. Stopping alone does not prove the service is terminal.
        terminal = await backend.terminal(options.unit, invocation, ADMIN_MS);
        if (complete && terminal && !result.timedOut && !result.overflow && !expired()) result.containmentComplete = true;
        // This is separate from check completion: on abort/failure the group may
        // drain only AFTER stop. Never use a fresh observe() or a replacement PID.
        if (terminal && identity && invocation) {
          const emptyEvidence = await backend.originalEmpty(options.unit, identity, invocation, ADMIN_MS);
          if (emptyEvidence) result.cleanupProof = { unit: options.unit, cgroupIdentity: identity, invocation,
            empty: true, emptyEvidence, terminal: true,
            payload: releaseAttempted ? "release-attempted" : "prevented-before-write" };
        }
      } catch { /* retain unit identity and private output for manual investigation */ }
    }
    try {
      if (transport?.readOutput) {
        const output = transport.readOutput();
        onChunk(output.log);
        if (output.overflow) result.overflow = true;
      }
    } catch { terminal = false; result.containmentComplete = false; result.cleanupProof = undefined; }
    result.log = Buffer.concat(chunks);
    if (expired()) result.timedOut = true;
    if (result.overflow || result.timedOut) result.containmentComplete = false;
    // Preserve private output when containment was not proven, even if stop
    // later made the unit terminal. Only confirmed passing evidence is removed.
    const discard = terminal && result.containmentComplete;
    try {
      transport?.dispose(discard);
      if (discard) result.evidenceDir = undefined;
    } catch { result.containmentComplete = false; result.cleanupProof = undefined; }
    try { await backend.forget?.(options.unit); } catch { result.containmentComplete = false; result.cleanupProof = undefined; }
  }
  return result;
}
