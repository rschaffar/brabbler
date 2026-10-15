// Shared by the script-style browser and terminal acceptance runners.
// Importing this file has no filesystem, environment or process side effects.
import { spawn } from "node:child_process";
import { appendFileSync, createWriteStream, lstatSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consumeExpectedBrowserConflict } from "./expected-browser-conflict.mjs";
import { serviceOwner } from "./service.mjs";

const inheritedKeys = [
  "PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "LANG", "LC_ALL", "TZ", "TERM", "SHELL", "PI_WEB_TEST_SHELL",
  "PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", "PI_WEB_TEST_CHROMIUM", "PLAYWRIGHT_BROWSERS_PATH",
  "FONTCONFIG_FILE", "FONTCONFIG_PATH", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH",
];

export function fixtureEnvironment(root, source = process.env) {
  const env = Object.fromEntries(inheritedKeys.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
  // Selection switches are runner inputs, not application configuration.
  for (const [key, value] of Object.entries(source)) if (/^E2E_[A-Z_]+$/.test(key)) env[key] = value;
  const home = join(root, "home");
  const temp = join(root, "tmp");
  Object.assign(env, {
    HOME: home, USERPROFILE: home, APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"),
    XDG_STATE_HOME: join(home, "state"), XDG_CACHE_HOME: join(home, "cache"),
    XDG_RUNTIME_DIR: join(root, "runtime"), XDG_CONFIG_DIRS: join(home, "config"), XDG_DATA_DIRS: join(home, "data"),
    TMPDIR: temp, TMP: temp, TEMP: temp, PI_CODING_AGENT_DIR: root,
    PI_OFFLINE: "1", PI_WEB_PASSWORD: "", NEXT_TELEMETRY_DISABLED: "1", JITI_FS_CACHE: "0",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"), GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0",
    HISTFILE: process.platform === "win32" ? "NUL" : "/dev/null", BASH_SILENCE_DEPRECATION_WARNING: "1",
  });
  for (const key of ["HOME", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "XDG_RUNTIME_DIR", "TMPDIR", "PI_CODING_AGENT_DIR"]) {
    mkdirSync(env[key], { recursive: true, mode: 0o700 });
  }
  writeFileSync(env.GIT_CONFIG_GLOBAL, "[user]\n\tname = E2E\n\temail = e2e@example.invalid\n[commit]\n\tgpgsign = false\n", { mode: 0o600 });
  return env;
}

export function applyFixtureEnvironment(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}

async function bounded(promise, ms) {
  let timer;
  try {
    return await Promise.race([promise.then(() => true), new Promise((resolve) => { timer = setTimeout(() => resolve(false), ms); })]);
  } finally { clearTimeout(timer); }
}

/** Own only this spawned child/group. Never discover or signal unrelated PIDs. */
export function startOwnedServer(command, args, options, { logPath, event, graceMs = 10_000, killMs = 5_000 }) {
  const log = createWriteStream(logPath, { flags: "wx", mode: 0o600 });
  const logFinished = finished(log).then(() => null, (error) => error);
  const grouped = process.platform !== "win32";
  const child = spawn(command, args, { ...options, detached: grouped, stdio: ["ignore", "pipe", "pipe"] });
  let error;
  let requestedStop = false;
  let closed = false;
  let unexpectedExit = false;
  let stopping;
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const exited = new Promise((resolve) => {
    child.once("spawn", () => event("server-spawn", { pid: child.pid }));
    child.once("error", (cause) => { error = cause; event("server-error", { message: cause.message }); });
    child.once("exit", (code, signal) => {
      unexpectedExit = !requestedStop;
      event("server-exit", { pid: child.pid, code, signal, requestedStop });
    });
    child.once("close", (code, signal) => { closed = true; event("server-close", { code, signal }); resolve(); });
  });
  function groupStatus() {
    if (!grouped || !child.pid) return "not-observed";
    try { process.kill(-child.pid, 0); return "present"; }
    catch (cause) { return cause.code === "ESRCH" ? "absent" : "unknown"; }
  }
  function signal(value) {
    // Once the original child has exited, do not reuse its numeric PID/group.
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    const groupSignal = grouped && value === "SIGKILL";
    event("server-signal-requested", { pid: child.pid, signal: value, grouped: groupSignal });
    try { if (groupSignal) process.kill(-child.pid, value); else child.kill(value); }
    catch (cause) { if (cause.code !== "ESRCH") { error ??= cause; event("server-signal-error", { message: cause.message }); } }
  }
  return {
    child,
    get error() { return error; },
    stop() {
      stopping ??= (async () => {
        requestedStop = true;
        if (!closed) signal("SIGTERM");
        let settled = closed || await bounded(exited, graceMs);
        if (!settled) { signal("SIGKILL"); settled = await bounded(exited, killMs); }
        if (!settled) {
          event("server-settlement-uncertain", { pid: child.pid });
          child.stdout.destroy(); child.stderr.destroy(); child.unref();
        }
        // A closed leader/pipe is not proof that its process group is gone.
        // Observe only; after leader exit we deliberately do not signal a PGID
        // that could have been recycled. Any surviving/unknown group fails closed.
        const groupDeadline = Date.now() + killMs;
        let processGroup = groupStatus();
        while (settled && processGroup === "present" && Date.now() < groupDeadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          processGroup = groupStatus();
        }
        if (processGroup === "present" || processGroup === "unknown") {
          settled = false;
          event("server-group-settlement-uncertain", { pid: child.pid, processGroup });
        }
        log.end();
        const flushed = await bounded(logFinished, killMs);
        if (!flushed) log.destroy();
        const logError = flushed ? await logFinished : new Error("Server log flush timed out");
        if (logError) event("server-log-error", { message: logError.message });
        return { settled, unexpectedExit, processGroup, error: error?.message, logError: logError?.message,
          scope: "Owned child/pipe closure and original POSIX group absence only; escaped descendants and Windows descendants are not certified" };
      })();
      return stopping;
    },
  };
}

export function createHarness(root, kind, { diagnosticTimeoutMs = 5000, traceTimeoutMs = 30_000, requireService = true } = {}) {
  process.umask(0o077);
  const parent = join(root, "test-results", "e2e");
  if (!process.env.PI_WEB_TEST_ARTIFACTS) mkdirSync(parent, { recursive: true });
  const artifacts = process.env.PI_WEB_TEST_ARTIFACTS ?? mkdtempSync(join(parent, `${kind}-`));
  const artifactStat = lstatSync(artifacts);
  if (!artifactStat.isDirectory() || (process.platform !== "win32" && (artifactStat.uid !== process.getuid() || (artifactStat.mode & 0o077)))) {
    throw new Error("Artifacts must be an owned private physical directory");
  }
  // Keep socket paths short and outside nix develop's auto-removed TMPDIR.
  // Host temp policies still apply; the manifest records the exact private root.
  const fixtureRoot = process.env.PI_WEB_TEST_FIXTURES ?? mkdtempSync(join(process.platform === "win32" ? tmpdir() : "/tmp", `pw-${kind}-`));
  const env = fixtureEnvironment(fixtureRoot);
  if (process.env.PI_WEB_TEST_TMP) {
    const temp = process.env.PI_WEB_TEST_TMP, st = lstatSync(temp);
    if (!st.isDirectory() || st.uid !== process.getuid() || (st.mode & 0o077)) throw new Error("Temporary storage must be owned and private");
    env.TMPDIR = env.TMP = env.TEMP = temp;
  }
  const state = { version: 1, kind, root, artifacts, fixtureRoot, startedAt: new Date().toISOString(), status: "running" };
  const save = () => writeFileSync(join(artifacts, "run.json"), JSON.stringify(state, null, 2) + "\n");
  let diagnosticFailure = false;
  let resourcesUncertain = false;
  const acquisitions = new Set();
  const event = (type, detail = {}) => {
    try { appendFileSync(join(artifacts, "events.jsonl"), JSON.stringify({ at: new Date().toISOString(), type, ...detail }) + "\n"); }
    catch (error) {
      if (!diagnosticFailure) console.error(`Cannot write harness diagnostics: ${error.message}`);
      diagnosticFailure = true; process.exitCode = 1;
    }
  };
  save(); event("run-start");
  console.log(`Artifacts: ${artifacts}\nFixture storage (retained): ${fixtureRoot}`);
  const contexts = new Map();
  const allErrors = [];
  const observations = [];
  let sequence = 0;
  let server;
  let browser;
  let launching;
  let startingService;
  let interrupted = false;
  let finishing;
  const recordError = (type, error, detail = {}) => { allErrors.push(`${type}: ${error.message ?? error}`); event(type, { ...detail, message: String(error.message ?? error) }); };
  async function diagnose(type, operation, timeoutMs = diagnosticTimeoutMs, detail = {}) {
    const done = await bounded(Promise.resolve().then(operation).catch((error) => { resourcesUncertain = true; recordError(type, error, detail); }), timeoutMs);
    if (!done) { resourcesUncertain = true; recordError(type, new Error(`Timed out after ${timeoutMs}ms; settlement unknown`), detail); }
  }
  async function captureFailure() {
    for (const [context, info] of contexts) {
      for (const [index, page] of context.pages().entries()) {
        await diagnose("screenshot-error", () => page.screenshot({ path: join(artifacts, `${info.id}-failure-${index}.png`), timeout: diagnosticTimeoutMs }));
      }
    }
  }
  function closeContext(context) {
    const info = contexts.get(context);
    if (!info) return Promise.resolve();
    info.closing ??= (async () => {
      // General acceptance can produce >100 MB traces: archive export is not a
      // five-second screenshot operation. Bound and measure it independently.
      const started = performance.now();
      event("trace-export-start", { context: info.id });
      await diagnose("trace-error", () => context.tracing.stop({ path: join(artifacts, `${info.id}.zip`) }), traceTimeoutMs, { context: info.id });
      event("trace-export-end", { context: info.id, elapsedMs: Math.round(performance.now() - started) });
      await diagnose("context-close-error", () => context.close());
      contexts.delete(context);
      event("context-close", { id: info.id });
    })();
    return info.closing;
  }
  const interrupt = (signal) => {
    interrupted = true; process.exitCode = 1; event("run-interrupted", { signal });
    // Stop is idempotent and starts its escalation deadline immediately, even if
    // a browser operation is stuck. Do not delay server shutdown for screenshots.
    void server?.stop();
    void (async () => {
      await captureFailure();
      await finish();
    })().catch((error) => recordError("interrupt-error", error));
  };
  const onInt = () => interrupt("SIGINT");
  const onTerm = () => interrupt("SIGTERM");
  process.on("SIGINT", onInt); process.on("SIGTERM", onTerm);
  function checkActive() {
    if (interrupted || finishing) throw new Error("Harness interrupted or finishing; no new resources may start");
  }
  function finish() {
    finishing ??= (async () => {
      const stoppingService = startingService ? server?.stop() : undefined;
      if (startingService) await diagnose("service-acquisition-settlement-error", () => startingService);
      if (launching) await diagnose("browser-launch-settlement-error", () => launching);
      for (const acquisition of acquisitions) await diagnose("context-acquisition-settlement-error", () => acquisition);
      for (const context of contexts.keys()) await closeContext(context);
      await diagnose("browser-close-error", () => browser?.close());
      const settlement = await (stoppingService ?? server?.stop());
      const errors = [...allErrors, ...observations.flatMap((info) => info.errors)];
      if (requireService && settlement?.scope !== "systemd-user-service") errors.push("No installed service settlement was established");
      const failed = interrupted || diagnosticFailure || errors.length > 0 || process.exitCode || settlement && (!settlement.settled || settlement.unexpectedExit || settlement.error || settlement.logError);
      state.status = failed ? "failed" : "passed";
      state.finishedAt = new Date().toISOString(); state.server = settlement ?? null;
      state.errors = errors; state.interrupted = interrupted;
      state.resourcesSettled = !resourcesUncertain && !launching && !startingService && acquisitions.size === 0 && !interrupted &&
        (!server ? !requireService : settlement?.settled && (settlement.scope === "systemd-user-service"
          ? ["absent", "empty"].includes(settlement.cgroup) : !requireService && settlement.processGroup === "absent"));
      event("run-end", { status: state.status });
      try { save(); } catch (error) { recordError("manifest-error", error); process.exitCode = 1; }
      process.off("SIGINT", onInt); process.off("SIGTERM", onTerm);
      if (failed) process.exitCode = 1;
      console.log(`${process.exitCode ? "FAILED" : "PASSED"}: ${artifacts}/run.json`);
    })();
    return finishing;
  }
  return {
    artifacts, fixtureRoot, env, event,
    get agentDir() { return env.PI_CODING_AGENT_DIR; },
    async startService() {
      checkActive();
      if (server) throw new Error("Harness already owns a service");
      server = serviceOwner({ command: env.E2E_SERVICE_CONTROL, envFile: env.E2E_SERVICE_ENV,
        env, logPath: join(artifacts, "server.log"), event });
      startingService = server.start();
      try { await startingService; } finally { startingService = undefined; }
      checkActive();
      return server;
    },
    // Low-level child lifecycle fixtures only; never accepted as service evidence.
    startServer(command, args, options) {
      checkActive();
      if (server) throw new Error("Harness already owns a server");
      server = startOwnedServer(command, args, options, { logPath: join(artifacts, "server.log"), event });
      return server;
    },
    async launchBrowser(launcher, options = {}) {
      checkActive();
      if (browser || launching) throw new Error("Harness already owns a browser launch");
      // Playwright owns launch-time process cleanup on its bounded timeout.
      // Register the acquisition before awaiting, and dispose any late arrival.
      launching = launcher.launch({ ...options, timeout: 30_000 }).then(async (owner) => {
        browser = owner;
        if (interrupted || finishing) {
          await diagnose("late-browser-close-error", () => owner.close());
          throw new Error("Browser launch completed after interruption/shutdown");
        }
        return owner;
      });
      try { return await launching; } finally { launching = undefined; }
    },
    async newContext(owner, options = {}, base) {
      checkActive();
      browser = owner;
      const acquisition = owner.newContext(options);
      acquisitions.add(acquisition);
      let context;
      try { context = await acquisition; } finally { acquisitions.delete(acquisition); }
      const info = { id: `context-${++sequence}`, errors: [] };
      contexts.set(context, info);
      observations.push(info);
      if (interrupted || finishing) { await closeContext(context); checkActive(); }
      const fail = (message) => { info.errors.push(message); };
      context.on("page", (page) => {
        page.on("pageerror", (error) => { fail(error.message); event("pageerror", { context: info.id, message: error.message }); });
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          const expected = consumeExpectedBrowserConflict(page, message);
          event("console-error", { context: info.id, message: message.text(), expected });
          if (!expected) fail(message.text());
        });
        page.on("requestfailed", (request) => event("request-failed", { context: info.id, method: request.method(), url: request.url(), error: request.failure()?.errorText }));
        page.on("response", (response) => {
          if (base && new URL(response.url()).origin === new URL(base).origin && response.status() >= 500) {
            const message = `${response.status()} ${response.url()}`; fail(message); event("local-5xx", { context: info.id, message });
          }
        });
      });
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      event("context-open", { id: info.id, viewport: options.viewport ?? null });
      return context;
    },
    errorsFor(context) { return contexts.get(context)?.errors ?? []; },
    closeContext,
    async fail(error) {
      recordError("run-error", error); process.exitCode = 1;
      void server?.stop();
      await captureFailure();
    },
    finish,
  };
}
