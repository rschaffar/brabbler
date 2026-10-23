import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { writePrivateFileAtomicSync } from "../atomic-file";
import { acceptanceProject, acceptanceRoot, digest, readProfiles, validateProfiles } from "./config";
import { captureSnapshot, verifySnapshot } from "./snapshot";
import { executeAcceptance, processIdentity, type ExecutionResult, type ProcessIdentity } from "./process";
import { acceptanceResources } from "./resources";
import { recoverAcceptanceState } from "./recovery-lock";
import { onPluginSettingsChange } from "../plugins/settings";
import { acceptanceEnabled, assertAcceptanceEnabled } from "../../plugins/acceptance/policy";
import { acceptanceManifest } from "../../plugins/acceptance/manifest";
import { acceptanceTerminal, type AcceptanceProject, type AcceptanceRun, type AcceptanceView } from "./types";

interface Ledger { version: 1; runs: AcceptanceRun[] }
interface Owner { token: string; process: ProcessIdentity }
const safeKey = (key: string) => typeof key === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(key);
const readJson = (file: string) => {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new Error("Invalid acceptance state file");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally { closeSync(fd); }
};

export class AcceptanceCoordinator {
  private readonly token = randomUUID();
  private claimed = false;
  private live = new Set<string>();
  private active?: { id: string; controller: AbortController };
  private tail: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private disposal?: Promise<void>;
  private pumps = new Set<Promise<void>>();
  private persistenceError?: string;
  private pendingCompletion?: { id: string; result: ExecutionResult; durationMs: number };
  private disableEpoch = 0;
  private disabledAdmissions = new Set<string>();
  private unsubscribeSettings: () => void;
  constructor(readonly root: string, private readonly dependencies: {
    resources: typeof acceptanceResources; execute: typeof executeAcceptance; verifySnapshot?: typeof verifySnapshot; captureSnapshot?: typeof captureSnapshot; syncDirectory?: () => void;
  } = { resources: acceptanceResources, execute: executeAcceptance }) {
    this.unsubscribeSettings = onPluginSettingsChange((id) => {
      if (this.stopping || id !== acceptanceManifest.id || this.enabled()) return;
      // Latch the transition synchronously. A rapid re-enable cannot revive prior admissions.
      this.disableEpoch++;
      for (const id of this.live) if (id !== this.active?.id) this.disabledAdmissions.add(id);
      void this.serial(() => this.cancelQueuedForDisable()).catch((error) => { this.persistenceError = String(error); });
    });
  }
  private get agentDir() { return path.resolve(this.root, "../.."); }
  private enabled() { return acceptanceEnabled(this.agentDir); }
  /** Observer detachment is not job cancellation or coordinator disposal. */
  disposeSettingsSubscription() { this.unsubscribeSettings(); }
  private assertOpen() {
    if (this.stopping) throw new Error("Acceptance coordinator is disposed; new work is refused");
  }
  /** Explicit disposable-instance ownership only; never called by session Stop,
   * Pause, observer unsubscribe, or singleton/HMR replacement. Close admission
   * and scheduling synchronously, join capture/verification/executor/completion,
   * then durably cancel locally owned never-dispatched work. Running executors
   * are NOT aborted. Their original settlement/result authority is unchanged.
   * Joining JS operations is not proof that an uncertain supervisor settled. */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.stopping = true;
    this.disposeSettingsSubscription();
    clearTimeout(this.timer); this.timer = undefined;
    this.disposal = (async () => {
      const failures = new Set<unknown>();
      let observed: Promise<unknown>;
      do {
        observed = this.tail;
        // pump() extends beyond the serial dispatch tail through execution and
        // durable completion. A held executor must keep this barrier pending.
        const results = await Promise.allSettled([observed, ...this.pumps]);
        for (const result of results) if (result.status === "rejected") failures.add(result.reason);
      } while (observed !== this.tail || this.pumps.size > 0);
      try {
        await this.serial(() => {
          if (!this.claimed) return;
          this.assertClaim();
          const ledger = this.read(), ids: string[] = [];
          for (const run of ledger.runs) if (run.state === "queued" && this.live.has(run.id)) {
            Object.assign(run, { state: "cancelled", settled: true, finishedAt: new Date().toISOString(),
              error: "Disposable coordinator stopped before dispatch; no process started. Request a new run from a live owner." });
            ids.push(run.id);
          }
          if (ids.length) {
            this.write(ledger);
            for (const id of ids) { this.live.delete(id); this.disabledAdmissions.delete(id); }
          }
        });
      } catch (error) { failures.add(error); }
      // A completed-but-unpersisted result remains retained, never retried or
      // reported as success merely because the disposable owner was drained.
      if (this.persistenceError) failures.add(new Error(this.persistenceError));
      if (failures.size) throw new AggregateError([...failures], "Acceptance coordinator disposal failed after draining owned work");
    })();
    return this.disposal;
  }
  private cancelQueuedForDisable() {
    if (!this.claimed) return; // Never adopt/certify another server's saved work.
    this.assertClaim();
    const ledger = this.read(), ids: string[] = [];
    for (const run of ledger.runs) if (run.state === "queued" && this.live.has(run.id) && (this.disabledAdmissions.has(run.id) || !this.enabled())) {
      this.disabledAdmissions.add(run.id);
      run.state = "cancelled"; run.settled = true; run.finishedAt = new Date().toISOString();
      run.error = "Acceptance plugin was disabled before dispatch; request a new run after enabling it."; ids.push(run.id);
    }
    if (ids.length) { this.write(ledger); for (const id of ids) { this.live.delete(id); this.disabledAdmissions.delete(id); } }
    if (!this.enabled()) { clearTimeout(this.timer); this.timer = undefined; }
  }
  private syncDirectory() {
    if (this.dependencies.syncDirectory) return this.dependencies.syncDirectory();
    const fd = openSync(this.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { fsyncSync(fd); } finally { closeSync(fd); }
  }
  private get ledgerFile() { return path.join(this.root, "runs.json"); }
  private get ownerFile() { return path.join(this.root, "controller.json"); }
  private serial<T>(action: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(action);
    this.tail = next.catch(() => undefined);
    return next;
  }
  private read(): Ledger {
    if (!existsSync(this.ledgerFile)) return { version: 1, runs: [] };
    const ledger = readJson(this.ledgerFile) as Ledger;
    if (ledger.version !== 1 || !Array.isArray(ledger.runs) || ledger.runs.length > 1000) throw new Error("Invalid acceptance ledger");
    for (const run of ledger.runs) {
      if (run.version !== 1 || !safeKey(run.id) || !/^[a-f0-9]{64}$/.test(run.project) || typeof run.cwd !== "string"
        || !Array.isArray(run.requests) || !Array.isArray(run.observers) || !["queued", "running", "cancelling", "passed", "failed", "cancelled", "outcome-unknown", "reconciled"].includes(run.state)
        || run.snapshot?.directory !== path.join(this.root, "runs", run.id, "source")
        || run.logPath !== path.join(this.root, "runs", run.id, "execution.log")
        || run.runtimeDirectory !== path.join(this.root, "runs", run.id, "runtime")) throw new Error("Invalid acceptance run record");
      validateProfiles([run.profile]);
      if (run.environment?.version !== 1 || typeof run.environment.PATH !== "string" || run.environment.LANG !== "C.UTF-8" || run.environment.NODE_ENV !== "test") throw new Error("Invalid acceptance execution environment");
    }
    return ledger;
  }
  private owner(): Owner | undefined { return existsSync(this.ownerFile) ? readJson(this.ownerFile) as Owner : undefined; }
  private assertClaim() {
    if (!this.claimed || this.owner()?.token !== this.token) throw new Error("Acceptance coordinator ownership unavailable; inspect recovery state");
  }
  private claim() {
    if (process.platform !== "linux") throw new Error("Managed acceptance currently requires Linux");
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (this.claimed) return this.assertClaim();
    if (this.owner()) throw new Error("Another acceptance coordinator owns this agent directory, or a previous server needs explicit recovery");
    const identity = processIdentity(process.pid);
    if (!identity) throw new Error("Cannot authenticate acceptance coordinator");
    writeFileSync(this.ownerFile, JSON.stringify({ token: this.token, process: identity }), { flag: "wx", mode: 0o600, flush: true });
    this.syncDirectory(); this.claimed = true;
  }
  private write(ledger: Ledger) {
    this.assertClaim();
    try {
      const encoded = JSON.stringify(ledger);
      if (Buffer.byteLength(encoded) > 16 * 1024 * 1024) throw new Error("Acceptance ledger exceeds its safe read budget");
      writePrivateFileAtomicSync(this.ledgerFile, encoded); this.syncDirectory();
    }
    catch (error) { this.persistenceError = "Acceptance persistence failed; inspect retained run resources before recovery"; throw error; }
  }
  private assertAdmissionCapacity(ledger: Ledger) {
    // Reserve 4 MiB for bounded completion/cancellation/recovery fields on at most 1,000 runs.
    if (Buffer.byteLength(JSON.stringify(ledger)) > 12 * 1024 * 1024) throw new Error("Acceptance history byte budget reached; no new work was admitted");
  }
  private projectRun(ledger: Ledger, project: AcceptanceProject, id: string) {
    const run = ledger.runs.find((item) => item.id === id && item.project === project.identity);
    if (!run) throw new Error("Acceptance run not found in this project");
    return run;
  }
  view(project: AcceptanceProject): Pick<AcceptanceView, "runs" | "blocked" | "activeRunId"> {
    const ledger = this.read(), owner = this.owner();
    const foreign = Boolean(owner && owner.token !== this.token);
    const unknown = ledger.runs.some((run) => run.state === "outcome-unknown" || (!acceptanceTerminal(run.state) && !this.live.has(run.id)));
    const runs = ledger.runs.filter((run) => run.project === project.identity).map((run) => !acceptanceTerminal(run.state) && !this.live.has(run.id)
      ? { ...run, state: "outcome-unknown" as const, error: "Server ownership was lost; saved intent is not execution or settlement evidence", settled: false }
      : this.pendingCompletion?.id === run.id ? { ...run, state: "outcome-unknown" as const, error: "Supervisor finished, but its result is not durable. Browser reconciliation retries the result write, never execution.", settled: this.pendingCompletion.result.settled }
      : run.state === "running" && !this.active && this.persistenceError ? { ...run, state: "outcome-unknown" as const, settled: true, error: "Dispatch persistence failed; this server did not start a process. Explicit recovery cancels the admission." } : run);
    return { runs: runs.reverse(), activeRunId: this.active?.id,
      blocked: this.persistenceError ?? (foreign ? "Another server owns acceptance coordination, or the previous server needs recovery" : unknown ? "An earlier run has unknown settlement; explicit browser recovery is required" : undefined) };
  }
  private request(ledger: Ledger, caller: string, key: string, project: AcceptanceProject, profile: string, expectedProfile: string) {
    for (const run of ledger.runs) {
      const request = run.requests.find((entry) => entry.caller === caller && entry.key === key);
      if (!request) continue;
      if (run.project !== project.identity || request.cwd !== project.cwd || request.profile !== profile || run.profileDigest !== expectedProfile) throw new Error("Acceptance request key already belongs to different inputs");
      return run;
    }
  }
  async submit(project: AcceptanceProject, profileName: string, caller: string, requestKey: string, expectedProfile: string, signal?: AbortSignal) {
    this.assertOpen();
    if (typeof caller !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(caller) || !safeKey(requestKey)) throw new Error("Invalid acceptance caller/request identity");
    return this.serial(async () => {
      this.assertOpen();
      assertAcceptanceEnabled(this.agentDir);
      const epoch = this.disableEpoch;
      const previous = this.request(this.read(), caller, requestKey, project, profileName, expectedProfile);
      if (previous) return { run: this.view(project).runs.find((run) => run.id === previous.id)!, joined: true };
      signal?.throwIfAborted();
      this.claim();
      if (this.view(project).blocked) throw new Error(this.view(project).blocked);
      const profile = readProfiles(project).find((item) => item.name === profileName);
      if (!profile || profile.permission === "deny" || digest(profile) !== expectedProfile) throw new Error("Acceptance profile changed or is unavailable; submit a new exact proposal");
      if (acceptanceProject(project.cwd).identity !== project.identity) throw new Error("Project identity changed");
      const ledger = this.read();
      if (ledger.runs.length >= 1000 || ledger.runs.filter((run) => !acceptanceTerminal(run.state)).length >= 32) throw new Error("Acceptance history/queue limit reached; retain existing evidence and resolve before submitting more work");
      const id = randomUUID(), directory = path.join(this.root, "runs", id), captureStart = Date.now();
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const snapshot = await (this.dependencies.captureSnapshot ?? captureSnapshot)(project.cwd, profile.inputs, path.join(directory, "source"), signal);
      signal?.throwIfAborted();
      this.assertOpen();
      assertAcceptanceEnabled(this.agentDir);
      if (epoch !== this.disableEpoch) throw new Error("Acceptance was disabled during capture; request a new run");
      if (acceptanceProject(project.cwd).identity !== project.identity || digest(readProfiles(project).find((p) => p.name === profileName)) !== expectedProfile) throw new Error("Project/profile changed during snapshot capture");
      const environment = { version: 1 as const, PATH: process.env.PATH ?? "", LANG: "C.UTF-8", NODE_ENV: "test" as const };
      const key = digest([project.identity, snapshot.digest, profile, process.platform, process.arch, environment]);
      const request = { caller, key: requestKey, profile: profileName, cwd: project.cwd };
      const shared = ledger.runs.find((run) => run.key === key && this.live.has(run.id) && ["queued", "running"].includes(run.state));
      if (shared) {
        shared.requests.push(request);
        if (!shared.observers.includes(caller)) shared.observers.push(caller);
        if (shared.requests.length > 256) throw new Error("Acceptance subscriber limit reached");
        this.assertAdmissionCapacity(ledger); this.write(ledger);
        // Captured duplicate stays private for diagnosis; there is no implicit snapshot GC.
        return { run: shared, joined: true };
      }
      const run: AcceptanceRun = { version: 1, id, project: project.identity, cwd: project.cwd, owner: caller, observers: [caller], requests: [request], profile,
        profileDigest: expectedProfile, environment, key, snapshot, state: "queued", settled: false, createdAt: new Date().toISOString(), captureMs: Date.now() - captureStart,
        logPath: path.join(directory, "execution.log"), runtimeDirectory: path.join(directory, "runtime") };
      mkdirSync(run.runtimeDirectory, { mode: 0o700 });
      ledger.runs.push(run); this.assertAdmissionCapacity(ledger); this.live.add(id); this.write(ledger);
      this.schedule();
      return { run, joined: false };
    });
  }
  private schedule(delay = 0) {
    if (this.stopping || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      const pump = this.pump(); this.pumps.add(pump);
      void pump.then(() => { this.pumps.delete(pump); }, (error) => {
        this.persistenceError = String(error); this.pumps.delete(pump);
      });
    }, delay);
    this.timer.unref();
  }
  private async pump() {
    const dispatch = await this.serial(async () => {
      if (this.stopping) return;
      this.cancelQueuedForDisable(); // Also retries a latched cancellation before dispatch after a rapid re-enable.
      if (!this.enabled()) return;
      if (this.active || this.persistenceError) return;
      const epoch = this.disableEpoch;
      this.assertClaim();
      const ledger = this.read();
      if (ledger.runs.some((run) => run.state === "outcome-unknown" || (!acceptanceTerminal(run.state) && !this.live.has(run.id)))) return;
      const run = ledger.runs.find((item) => item.state === "queued" && this.live.has(item.id));
      if (!run) return;
      // Source edits after capture are expected. Recipe edits/revocation are not silently accepted.
      try {
        const current = acceptanceProject(run.cwd);
        if (current.identity !== run.project || digest(readProfiles(current).find((p) => p.name === run.profile.name)) !== run.profileDigest) throw new Error("Project/profile changed before dispatch; request a new run");
        await (this.dependencies.verifySnapshot ?? verifySnapshot)(run.snapshot);
        if (this.stopping) return; // dispose() owns the durable never-dispatched transition.
        if (!this.enabled() || epoch !== this.disableEpoch) {
          Object.assign(run, { state: "cancelled", settled: true, finishedAt: new Date().toISOString(), error: "Acceptance disabled during pre-dispatch verification; no process started." });
          this.write(ledger); this.live.delete(run.id); this.schedule(); return;
        }
        // Browser configuration is independently serialized; an awaited verification must not leave revocation stale.
        const finalProject = acceptanceProject(run.cwd);
        if (finalProject.identity !== run.project || digest(readProfiles(finalProject).find((p) => p.name === run.profile.name)) !== run.profileDigest) throw new Error("Project/profile changed during verification; request a new run");
      } catch (error) {
        Object.assign(run, { state: "failed", settled: true, finishedAt: new Date().toISOString(), error: String(error).slice(0, 2048) });
        this.write(ledger); this.live.delete(run.id); this.schedule(); return;
      }
      const available = this.dependencies.resources();
      if (available.cpus < run.profile.cpus || available.memoryMiB < run.profile.memoryMiB + 1024) { this.schedule(5000); return; }
      const controller = new AbortController();
      run.state = "running"; run.startedAt = new Date().toISOString(); run.queueMs = Date.now() - Date.parse(run.createdAt);
      this.write(ledger); this.active = { id: run.id, controller };
      return { run, controller, epoch };
    });
    if (!dispatch) return;
    const { run, controller } = dispatch;
    const started = Date.now();
    let result: ExecutionResult;
    try {
      const home = path.join(run.runtimeDirectory, "home"); mkdirSync(home, { mode: 0o700 });
      const env: NodeJS.ProcessEnv = { NODE_ENV: run.environment.NODE_ENV, PATH: run.environment.PATH, LANG: run.environment.LANG, HOME: home, TMPDIR: run.runtimeDirectory,
        XDG_CONFIG_HOME: path.join(home, "config"), XDG_CACHE_HOME: path.join(home, "cache"), XDG_DATA_HOME: path.join(home, "data"),
        XDG_STATE_HOME: path.join(home, "state"), PI_CODING_AGENT_DIR: path.join(home, "agent"), PI_WEB_ACCEPTANCE_RUNTIME: run.runtimeDirectory };
      // The serial dispatch Promise is another async boundary; check before the supervisor's synchronous spawn.
      if (this.stopping || !this.enabled() || dispatch.epoch !== this.disableEpoch) {
        controller.abort();
        result = { code: null, settled: true, interrupted: true, error: "Acceptance stopped or disabled before executor dispatch; no process started.", scope: "No process dispatched" };
      } else result = await this.dependencies.execute(run.profile.argv, { cwd: run.snapshot.directory, env, logPath: run.logPath, signal: controller.signal });
      try { await verifySnapshot(run.snapshot); }
      catch (error) { result = { ...result, error: `Snapshot changed during execution: ${String(error).slice(0, 1800)}` }; }
    } catch (error) {
      // A thrown supervisor cannot establish that no effect started. Keep the slot blocked.
      result = { code: null, interrupted: controller.signal.aborted, settled: false, error: String(error), scope: "Supervisor failed before settlement was established" };
    }
    this.pendingCompletion = { id: run.id, result, durationMs: Date.now() - started };
    await this.serial(() => this.commitCompletion());
  }
  private commitCompletion() {
    const pending = this.pendingCompletion;
    if (!pending) return;
    const { id, result, durationMs } = pending;
    const ledger = this.read(), stored = ledger.runs.find((item) => item.id === id)!;
    Object.assign(stored, { state: !result.settled ? "outcome-unknown" : this.active?.controller.signal.aborted ? "cancelled" : result.code === 0 && !result.error ? "passed" : "failed",
      settled: result.settled, exitCode: result.code, error: result.error?.slice(0, 2048), finishedAt: new Date().toISOString(), executionMs: durationMs });
    this.write(ledger); // Retain the actual completed result separately if its durable write fails.
    this.pendingCompletion = undefined; this.active = undefined;
    // This successful checkpoint also makes earlier terminal transitions durable.
    for (const item of ledger.runs) if (acceptanceTerminal(item.state)) { this.live.delete(item.id); this.disabledAdmissions.delete(item.id); }
    this.persistenceError = undefined; this.schedule();
  }
  async cancel(project: AcceptanceProject, id: string, caller: string, browser = false) {
    this.assertOpen();
    return this.serial(() => {
      this.assertOpen();
      this.claim();
      const ledger = this.read(), run = this.projectRun(ledger, project, id);
      if (!browser && run.owner !== caller) throw new Error("Only the initiating session or explicit browser control may cancel this shared run");
      if (!this.live.has(id) || acceptanceTerminal(run.state)) throw new Error("Run is not controlled by this server; inspect status/recovery instead");
      if (run.state === "queued") {
        run.state = "cancelled"; run.settled = true; run.finishedAt = new Date().toISOString();
        this.write(ledger); this.live.delete(id); this.schedule();
      } else {
        run.state = "cancelling"; this.write(ledger); this.active?.controller.abort();
      }
      return run;
    });
  }
  /** User assertion of resource quiescence is recorded as reconciliation, never a successful test. */
  async recover(acknowledged: boolean) {
    this.assertOpen();
    return this.serial(async () => {
      this.assertOpen();
      if (!acknowledged) throw new Error("Confirm that previous acceptance processes and sandboxes have stopped");
      if (this.pendingCompletion) {
        const settled = this.pendingCompletion.result.settled;
        this.commitCompletion();
        if (settled) return; // Retry only the durable result write, not the process or its approval.
      }
      if (this.active) throw new Error("This server still owns running acceptance work; cancel and await it first");
      mkdirSync(this.root, { recursive: true, mode: 0o700 });
      const ledger = this.read();
      const expectedLedgerDigest = existsSync(this.ledgerFile) ? createHash("sha256").update(readFileSync(this.ledgerFile)).digest("hex") : null;
      for (const run of ledger.runs) if (!acceptanceTerminal(run.state) || run.state === "outcome-unknown") {
        const neverDispatched = this.live.has(run.id);
        run.state = neverDispatched ? "cancelled" : "reconciled"; run.settled = neverDispatched; run.finishedAt = new Date().toISOString();
        run.error = neverDispatched ? "Cancelled during explicit recovery; this server never dispatched a process for this admission."
          : "User confirmed resources quiescent after lost/uncertain ownership. Execution outcome and automatic settlement remain unknown; no replay.";
      }
      const identity = processIdentity(process.pid);
      if (!identity) throw new Error("Cannot authenticate recovery requester");
      // The flock owner performs every critical filesystem mutation itself. Parent/helper loss cannot leave an unlocked critical callback.
      await recoverAcceptanceState(this.root, { token: this.token, process: identity, expectedLedgerDigest, ledger: JSON.stringify(ledger) });
      this.claimed = true; this.assertClaim(); this.live.clear(); this.disabledAdmissions.clear(); this.persistenceError = undefined;
    });
  }
}
const symbol = Symbol.for("pi-web:acceptance-coordinators/v1");
const host = globalThis as typeof globalThis & { [symbol]?: Map<string, AcceptanceCoordinator> };
export function acceptanceCoordinator(): AcceptanceCoordinator {
  const root = acceptanceRoot(), coordinators = host[symbol] ??= new Map();
  let coordinator = coordinators.get(root);
  if (!coordinator) { coordinator = new AcceptanceCoordinator(root); coordinators.set(root, coordinator); }
  return coordinator;
}
