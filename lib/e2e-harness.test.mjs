import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Script } from "node:vm";
import { createHarness, fixtureEnvironment, processServiceOwner, processServiceReceiptMatches, startOwnedServer } from "../e2e/harness.mjs";
import { waitForTrustAgent } from "../e2e/project-trust-scopes.mjs";
import { waitForMoveControl } from "../e2e/session-move.mjs";
import { historyPageResponse } from "../e2e/history-pagination.mjs";

function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), "pw-harness-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function setup(t, options) {
  const oldExit = process.exitCode;
  const oldMask = process.umask();
  const run = createHarness(scratch(t), "regression", { requireService: false, ...options });
  t.after(async () => {
    await run.finish();
    process.exitCode = oldExit; process.umask(oldMask);
    rmSync(run.fixtureRoot, { recursive: true, force: true });
  });
  return run;
}
function fakeBrowser({ stopError, hangStop = false, screenshotError } = {}) {
  return {
    close: async () => {},
    async newContext() {
      const context = new EventEmitter();
      context.started = false;
      const pages = [];
      context.pages = () => pages;
      context.tracing = {
        start: async () => { context.started = true; },
        stop: async ({ path }) => {
          assert.ok(context.started);
          if (hangStop) return new Promise(() => {});
          if (stopError) throw new Error(stopError);
          writeFileSync(path, "fixture trace");
        },
      };
      context.newPage = async () => {
        assert.ok(context.started, "Tracing starts before pages");
        const page = new EventEmitter();
        page.screenshot = async ({ path }) => {
          if (screenshotError) throw new Error(screenshotError);
          writeFileSync(path, "fixture screenshot");
        };
        pages.push(page); context.emit("page", page); return page;
      };
      context.close = async () => { context.closed = true; };
      return context;
    },
  };
}
const state = (run) => JSON.parse(readFileSync(join(run.artifacts, "run.json"), "utf8"));
const packageStore = `/nix/store/${"a".repeat(32)}-brabbler-harness-test`;
const packageRoot = `${packageStore}/lib/node_modules/brabbler`;
const linuxOnly = { skip: process.platform !== "linux" };
const processInputs = (overrides = {}) => ({ E2E_SERVICE_BACKEND: "process", E2E_PACKAGE_ROOT: packageRoot,
  E2E_BASE_URL: "http://127.0.0.1:30141", ...overrides });

function temporaryEnvironment(values) {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const assign = (entries) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  };
  assign(values);
  return () => assign(before);
}

function fakeProcessService({ env: overrides = {}, observation = {} } = {}) {
  const child = Object.assign(new EventEmitter(), { pid: 42, exitCode: null, signalCode: null });
  let error, stops = 0;
  const calls = [], events = [];
  // Simulate the low-level owner's permanent error listener as well as its getter.
  child.on("error", (cause) => { error = cause; });
  const env = processInputs({ HOME: "/private/home", ...overrides });
  const owner = processServiceOwner({ root: packageRoot, env, logPath: "/private/server.log",
    event: (type, detail) => events.push({ type, ...detail }) }, (command, args, options, lifecycle) => {
    calls.push({ command, args, options, lifecycle });
    return { child, get error() { return error; }, stop() {
      stops++;
      return Promise.resolve({ settled: true, processGroup: "absent", unexpectedExit: false, ...observation });
    } };
  });
  return { owner, child, env, calls, events, get stops() { return stops; },
    spawn: () => child.emit("spawn"),
    exit(code, signal = null) { child.exitCode = code; child.signalCode = signal; child.emit("exit", code, signal); } };
}

function realProcessFixture(t, { missing = false, existingLog = false, code = "console.error('owned-stderr'); console.log('owned-ready'); setInterval(()=>{},1000)" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pw-process-service-test-")), calls = [], events = [];
  const env = { ...fixtureEnvironment(root), ...processInputs() };
  const logPath = join(root, "server.log");
  if (existingLog) writeFileSync(logPath, "existing evidence\n");
  let owned;
  const owner = processServiceOwner({ root: packageRoot, env, logPath,
    event: (type, detail) => events.push({ type, ...detail }) }, (command, args, options, lifecycle) => {
    calls.push({ command, args, options });
    // Exercise real lifecycle/logging without needing to manufacture store files.
    owned = startOwnedServer(missing ? join(root, "missing-command") : process.execPath,
      missing ? [] : ["-e", code], options, { ...lifecycle, graceMs: 50, killMs: 2000 });
    return owned;
  });
  t.after(async () => {
    try { await owner.stop(); }
    finally { rmSync(root, { recursive: true, force: true }); }
  });
  return { owner, env, calls, events, logPath, get child() { return owned.child; } };
}

function capsuleHarness(t) {
  const root = mkdtempSync(join(tmpdir(), "pw-capsule-harness-"));
  const artifacts = join(root, "evidence"), fixtures = join(root, "f");
  mkdirSync(artifacts, { mode: 0o700 }); mkdirSync(fixtures, { mode: 0o700 });
  const oldExit = process.exitCode, oldMask = process.umask();
  const restore = temporaryEnvironment({ ...processInputs(), BRABBLER_TEST_ARTIFACTS: artifacts,
    BRABBLER_TEST_FIXTURES: fixtures, BRABBLER_TEST_TMP: undefined });
  let run;
  t.after(async () => {
    try { await run?.finish(); }
    finally { restore(); process.exitCode = oldExit; process.umask(oldMask); rmSync(root, { recursive: true, force: true }); }
  });
  run = createHarness(packageRoot, "regression");
  return run;
}

test("history pagination ignores a late initial context response", () => {
  const response = { url: () => "http://127.0.0.1:30141/api/sessions/long/context?ancestorId=e4999" };
  assert.equal(historyPageResponse(response, "long", "e4950"), false);
});

test("history pagination matches the exact cursor and session, not just the context route", () => {
  const response = (session, before) => ({ url: () => `http://127.0.0.1:30141/api/sessions/${session}/context?before=${before}` });
  assert.equal(historyPageResponse(response("long", "e4900"), "long", "e4950"), false);
  assert.equal(historyPageResponse(response("other", "e4950"), "long", "e4950"), false);
});

test("history pagination accepts the requested cursor independently of parameter order", () => {
  for (const query of ["before=e4950&leafId=e4999", "deferThinking=1&leafId=e4999&before=e4950"]) {
    assert.equal(historyPageResponse({ url: () => `http://127.0.0.1:30141/api/sessions/long/context?${query}` }, "long", "e4950"), true);
  }
});

test("history pagination does not hide a failed matching HTTP response", () => {
  const response = { url: () => "http://127.0.0.1:30141/api/sessions/long/context?before=e4950", status: () => 500 };
  assert.equal(historyPageResponse(response, "long", "e4950"), true, "the existing status assertions must see the failure");
});

test("trust readiness awaits one bounded non-prompt construction acknowledgement", async () => {
  const idle = { sessionId: "trust/selected", isStreaming: false, isPromptRunning: false, isBashRunning: false, isCompacting: false };
  let release, calls = 0, completed = false;
  const command = new Promise((resolve) => { release = resolve; });
  const page = { request: { post(url, options) {
    calls++;
    assert.equal(url, "http://127.0.0.1:30141/api/agent/trust%2Fselected");
    assert.deepEqual(options, { data: { type: "get_state" }, timeout: 30_000, maxRetries: 0 });
    return command;
  } } };
  const waiting = waitForTrustAgent(page, idle.sessionId, "http://127.0.0.1:30141").then(() => { completed = true; });
  await Promise.resolve(); assert.equal(completed, false, "a pending Promise must not count as readiness");
  release({ ok: () => true, status: () => 200, json: async () => ({ success: true, data: idle }) });
  await waiting;
  assert.equal(calls, 1); assert.equal(completed, true);
});

test("trust readiness rejects early GET shapes, wrong identity, missing state and every busy flag", async () => {
  const idle = { sessionId: "selected", isStreaming: false, isPromptRunning: false, isBashRunning: false, isCompacting: false };
  const replies = [{ running: false }, { success: false }, { success: true },
    { success: true, data: { ...idle, sessionId: "other" } }, { success: true, data: { sessionId: "selected" } },
    ...["isStreaming", "isPromptRunning", "isBashRunning", "isCompacting"]
      .map((key) => ({ success: true, data: { ...idle, [key]: true } }))];
  for (const reply of replies) {
    let calls = 0;
    const page = { request: { async post() { calls++; return { ok: () => true, status: () => 200, json: async () => reply }; } } };
    await assert.rejects(waitForTrustAgent(page, "selected", "http://127.0.0.1:30141"));
    assert.equal(calls, 1, "readiness failures must not retry trust decisions or commands");
  }
});

test("trust readiness propagates HTTP and transport failures without suppressing or retrying them", async () => {
  let calls = 0;
  const page = { request: { async post() { calls++; return { ok: () => false, status: () => 503 }; } } };
  await assert.rejects(waitForTrustAgent(page, "selected", "http://127.0.0.1:30141"), /Trust readiness HTTP 503/);
  assert.equal(calls, 1);
  const original = new Error("original transport failure");
  page.request.post = async () => { calls++; throw original; };
  await assert.rejects(waitForTrustAgent(page, "selected", "http://127.0.0.1:30141"), (error) => error === original);
  assert.equal(calls, 2);
});

test("move-control readiness waits through absent or disabled elements in a serialized browser callback", async () => {
  const controls = [null, undefined, {}, { disabled: true }, { disabled: false }];
  const observed = [];
  await waitForMoveControl({ async waitForFunction(predicate, selector, options) {
    assert.equal(options, undefined, "preserve the existing browser deadline");
    let control;
    const check = new Script(`(${predicate.toString()})`).runInNewContext({ document: {
      querySelector(target) { assert.equal(target, ".fixture-control"); return control; },
    } });
    for (control of controls) observed.push(check(selector));
  } }, ".fixture-control");
  assert.deepEqual(observed, [false, false, false, false, true]);
});

// These are lifecycle contracts, not substitutes for browser execution in Nix.
test("unknown service backends reject before allocating resources or changing umask", () => {
  for (const backend of ["", "auto", "PROCESS", "other"]) {
    const restore = temporaryEnvironment({ E2E_SERVICE_BACKEND: backend });
    const mask = process.umask();
    try {
      assert.throws(() => createHarness("/unused", "regression", { requireService: false }), /Unknown E2E_SERVICE_BACKEND/);
      assert.equal(process.umask(), mask);
    } finally { restore(); process.umask(mask); }
  }
});

test("absent or explicit systemd backend still requires the guest instead of falling back", () => {
  for (const backend of [undefined, "systemd"]) {
    const restore = temporaryEnvironment(processInputs({ E2E_SERVICE_BACKEND: backend, E2E_SERVICE_CONTROL: "/not-a-guest-controller" }));
    const mask = process.umask();
    try {
      assert.throws(() => createHarness(packageRoot, "regression"),
        /brabbler-acceptance-guest|Disposable acceptance guest required|guest lane registry|this guest user's immutable lane/);
    } finally { restore(); process.umask(mask); }
  }
});

test("process acceptance requires the same exact canonical installed package and explicit backend", linuxOnly, () => {
  const invalid = ["/checkout/brabbler", packageStore, `${packageRoot}/`, `${packageRoot}/../brabbler`,
    packageRoot.replace("/lib/", "//lib/"), packageRoot.replace("/node_modules/brabbler", "/node_modules/other"),
    packageRoot.replace("a".repeat(32), "a".repeat(31)), packageRoot.replace("a".repeat(32), "e".repeat(32))];
  for (const root of invalid) assert.throws(() => processServiceOwner({ root, env: processInputs({ E2E_PACKAGE_ROOT: root }) }), /same canonical Nix-store/, root);
  for (const declared of [undefined, "/checkout/brabbler", packageRoot.replace("-brabbler-harness-test", "-foreign")]) {
    assert.throws(() => processServiceOwner({ root: packageRoot, env: processInputs({ E2E_PACKAGE_ROOT: declared }) }), /same canonical Nix-store/);
  }
  for (const backend of [undefined, "systemd", "other"]) {
    assert.throws(() => processServiceOwner({ root: packageRoot, env: processInputs({ E2E_SERVICE_BACKEND: backend }) }), /Explicit process service backend/);
  }
});

test("process acceptance URL is only the exact fixed IPv4 loopback origin", linuxOnly, () => {
  for (const url of [undefined, "", "https://127.0.0.1:30141", "http://localhost:30141", "http://[::1]:30141",
    "http://127.0.0.1:30142", "http://127.0.0.1:30141/", "http://user@127.0.0.1:30141",
    "http://127.0.0.1:30141/path", "http://127.0.0.1:30141?x=1", "http://127.0.0.1:30141#fragment"]) {
    assert.throws(() => processServiceOwner({ root: packageRoot, env: processInputs({ E2E_BASE_URL: url }) }), /exact loopback URL/);
  }
});

test("process harness validates package, URL and explicit storage before allocating fixtures", linuxOnly, () => {
  for (const [patch, expected] of [
    [{ E2E_PACKAGE_ROOT: "/checkout" }, /same canonical Nix-store/],
    [{ E2E_BASE_URL: "http://localhost:30141" }, /exact loopback URL/],
    [{}, /explicit private fixture and artifact/],
  ]) {
    const restore = temporaryEnvironment({ ...processInputs(), BRABBLER_TEST_ARTIFACTS: undefined, BRABBLER_TEST_FIXTURES: undefined, ...patch });
    const mask = process.umask();
    try { assert.throws(() => createHarness(packageRoot, "regression"), expected); assert.equal(process.umask(), mask); }
    finally { restore(); process.umask(mask); }
  }
});

test("process service registers once, awaits spawn, fixes launcher/argv and suppresses version checks", linuxOnly, async () => {
  const f = fakeProcessService({ env: { BRABBLER_SKIP_VERSION_CHECK: "0", E2E_SERVICE_CONTROL: "/foreign/controller", E2E_SERVICE_COMMAND: "/foreign/command" } });
  assert.deepEqual(f.calls, [], "Construction has no process side effects");
  await assert.rejects(f.owner.check(), /not been acquired/);
  const starting = f.owner.start();
  assert.equal(f.calls.length, 1, "Ownership is registered before awaiting spawn");
  assert.equal(f.calls[0].command, `${packageStore}/bin/brabbler`);
  assert.deepEqual(f.calls[0].args, ["--hostname", "127.0.0.1", "--port", "30141", "--no-open"]);
  assert.equal(f.calls[0].options.cwd, "/private/home");
  assert.equal(f.calls[0].options.env.BRABBLER_SKIP_VERSION_CHECK, "1");
  assert.equal(f.calls[0].options.env.NODE_ENV, "production");
  assert.equal(f.env.BRABBLER_SKIP_VERSION_CHECK, "0", "The caller's environment is not mutated");
  assert.throws(() => f.owner.start(), /already started/);
  let acquired = false; starting.then(() => { acquired = true; });
  await Promise.resolve(); assert.equal(acquired, false);
  f.spawn(); await starting;
  const generation = await f.owner.check();
  assert.strictEqual(await f.owner.check(), generation, "Repeated checks observe the same child generation");
  assert.deepEqual(generation, { packageRoot, launcher: `${packageStore}/bin/brabbler`, pid: 42 });
  assert.equal(Object.isFrozen(generation), true);
  const a = f.owner.stop(), b = f.owner.stop();
  assert.strictEqual(a, b); await a;
  assert.equal(f.stops, 1);
  await assert.rejects(f.owner.check(), /stopping or stopped/);
  assert.throws(() => f.owner.start(), /stopping/);
});

test("process stop immediately owns pending acquisition but cannot certify it before spawn settles", linuxOnly, async () => {
  const f = fakeProcessService();
  const starting = f.owner.start();
  const rejected = assert.rejects(starting, /stopped during acquisition/);
  const stopping = f.owner.stop();
  assert.equal(f.stops, 1, "Escalation starts without waiting for spawn acknowledgement");
  assert.strictEqual(f.owner.stop(), stopping);
  let settled = false; stopping.then(() => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  f.spawn(); await rejected;
  const result = await stopping;
  assert.match(result.error, /acquisition/); assert.equal(result.unexpectedExit, true);
  assert.equal(result.generation.pid, 42);
  assert.equal(f.events.some(({ type }) => type === "service-started"), false);
  assert.throws(() => f.owner.start(), /stopping/);
});

test("stopping before process acquisition refuses all later acquisition", linuxOnly, async () => {
  const f = fakeProcessService();
  const result = await f.owner.stop();
  assert.equal(result.settled, false); assert.equal(result.processGroup, "not-observed");
  assert.match(result.error, /No installed package process/);
  assert.throws(() => f.owner.start(), /stopping/); assert.equal(f.calls.length, 0);
  await assert.rejects(f.owner.check(), /stopping or stopped/);
});

test("process spawn errors and later child errors remain failures", linuxOnly, async () => {
  const failed = fakeProcessService();
  const starting = failed.owner.start();
  const rejected = assert.rejects(starting, /spawn refused/);
  failed.child.emit("error", new Error("spawn refused"));
  await rejected;
  assert.match((await failed.owner.stop()).error, /spawn refused/);
  const live = fakeProcessService();
  const acquired = live.owner.start(); live.spawn(); await acquired;
  live.child.emit("error", new Error("owned child error"));
  await assert.rejects(live.owner.check(), /owned child error/);
  await assert.rejects(live.owner.check(), /owned child error/);
  assert.match((await live.owner.stop()).error, /owned child error/);
});

test("unexpected process exit is sticky without a check, while requested launcher exit 143 is ordinary shutdown", linuxOnly, async () => {
  const crashed = fakeProcessService();
  const starting = crashed.owner.start(); crashed.spawn(); await starting;
  crashed.exit(0);
  const result = await crashed.owner.stop();
  assert.equal(result.settled, true); assert.equal(result.unexpectedExit, true);
  assert.match(result.error, /exited unexpectedly.*code 0/);
  await assert.rejects(crashed.owner.check(), /exited unexpectedly/);
  const requested = fakeProcessService();
  const acquired = requested.owner.start(); requested.spawn(); await acquired;
  const stopping = requested.owner.stop(); requested.exit(143);
  assert.equal((await stopping).unexpectedExit, false);
});

test("process checks never accept a changed child generation even if its PID is later restored", linuxOnly, async () => {
  const f = fakeProcessService();
  const starting = f.owner.start(); f.spawn(); await starting;
  f.child.pid++;
  await assert.rejects(f.owner.check(), /changed generation/);
  f.child.pid--;
  await assert.rejects(f.owner.check(), /changed generation/);
  assert.equal((await f.owner.stop()).unexpectedExit, true);
});

test("process receipts certify only bounded observations, not VM evidence or final Nix containment", linuxOnly, async () => {
  const f = fakeProcessService();
  const starting = f.owner.start(); f.spawn(); await starting;
  const result = await f.owner.stop();
  assert.equal(processServiceReceiptMatches(result, packageRoot, f.env), true);
  assert.equal(result.scope, "installed-package-process");
  assert.match(result.settlementScope, /child\/pipe closure.*POSIX group absence only.*escaped descendants.*not certified/);
  assert.equal(result.descendants, "not-certified"); assert.equal(result.containmentOwner, "nix-build");
  for (const field of ["cgroup", "lane", "sandboxCompleted"]) assert.equal(Object.hasOwn(result, field), false);
  for (const patch of [{ scope: "systemd-user-service", cgroup: "absent" }, { scope: result.settlementScope },
    { settled: false }, { processGroup: "present" }, { processGroup: "unknown" }, { containmentOwner: "self" },
    { descendants: "empty" }, { settlementScope: "all descendants" }, { generation: undefined },
    { generation: { ...result.generation, pid: 0 } }, { generation: { ...result.generation, launcher: "/foreign/bin/brabbler" } },
    { generation: { ...result.generation, packageRoot: "/foreign/package" } }]) {
    assert.equal(processServiceReceiptMatches({ ...result, ...patch }, packageRoot, f.env), false);
  }
  assert.equal(processServiceReceiptMatches(undefined, packageRoot, f.env), false);
});

test("process adapter retains real owned stdout/stderr and requested shutdown observations", linuxOnly, async (t) => {
  const f = realProcessFixture(t);
  const starting = f.owner.start();
  const ready = once(f.child.stdout, "data");
  await starting; await ready;
  const result = await f.owner.stop();
  assert.equal(result.settled, true); assert.equal(result.unexpectedExit, false);
  assert.equal(processServiceReceiptMatches(result, packageRoot, f.env), true);
  assert.match(readFileSync(f.logPath, "utf8"), /owned-ready/);
  assert.match(readFileSync(f.logPath, "utf8"), /owned-stderr/);
  assert.ok(f.events.some(({ type }) => type === "server-signal-requested"));
  assert.ok(f.events.some(({ type }) => type === "server-close"));
  assert.strictEqual(await f.owner.stop(), result);
});

test("process adapter preserves real spawn failure and log-write failure evidence", linuxOnly, async (t) => {
  const missing = realProcessFixture(t, { missing: true });
  await assert.rejects(missing.owner.start(), /ENOENT/);
  assert.match((await missing.owner.stop()).error, /ENOENT/);
  assert.ok(missing.events.some(({ type }) => type === "server-error"));
  const logged = realProcessFixture(t, { existingLog: true });
  // EEXIST unpipes/pauses stdout: waiting for output would deadlock this negative
  // fixture. Acquisition plus stop still awaits the actual log failure/flush.
  await logged.owner.start();
  const result = await logged.owner.stop();
  assert.match(result.logError, /EEXIST/);
  assert.equal(readFileSync(logged.logPath, "utf8"), "existing evidence\n", "Existing diagnostics are never overwritten");
  assert.ok(logged.events.some(({ type }) => type === "server-log-error"));
});

test("process adapter records real natural launcher exits as unexpected", linuxOnly, async (t) => {
  for (const code of [0, 7]) {
    const f = realProcessFixture(t, { code: `process.exit(${code})` });
    const starting = f.owner.start(); const closed = once(f.child, "close");
    await starting; await closed;
    await assert.rejects(f.owner.check(), /exited unexpectedly/);
    const result = await f.owner.stop();
    assert.equal(result.settled, true); assert.equal(result.unexpectedExit, true);
  }
});

for (const logError of [undefined, "server log flush failed"]) test(`process harness separates bounded settlement from ${logError ? "log failure" : "successful execution"}`, linuxOnly, async (t) => {
  const run = capsuleHarness(t);
  const owned = run.startServer(process.execPath, ["-e", "console.log('ready'); setInterval(()=>{},1000)"], { env: run.env });
  await once(owned.child.stdout, "data");
  const observed = await owned.stop();
  // Inject only the adapter receipt after the real low-level fixture has settled;
  // this exercises harness verdict handling without pretending to run the package.
  const f = fakeProcessService({ observation: { ...observed, logError } });
  f.child.pid = owned.child.pid;
  const starting = f.owner.start(); f.spawn(); await starting;
  const receipt = await f.owner.stop();
  owned.stop = async () => receipt;
  await run.finish();
  const result = state(run);
  assert.equal(result.status, logError ? "failed" : "passed");
  assert.equal(result.resourcesSettled, true, "Only owned-child/pipe/group observations are established");
  assert.equal(result.server.descendants, "not-certified");
  assert.equal(Object.hasOwn(result.server, "sandboxCompleted"), false);
  assert.equal(result.server.logError, logError);
});

test("process harness uses fixed loopback and retains failed acquisition evidence without reacquisition", linuxOnly, async (t) => {
  const run = capsuleHarness(t);
  assert.equal(run.baseURL, "http://127.0.0.1:30141");
  assert.ok(run.env.HOME.startsWith(run.fixtureRoot + "/"));
  await assert.rejects(run.startService(), /ENOENT/);
  await assert.rejects(run.startService(), /already owns a service/);
  await run.finish();
  const result = state(run);
  assert.equal(result.status, "failed"); assert.equal(result.resourcesSettled, false);
  assert.equal(result.server.scope, "installed-package-process");
  assert.match(result.server.error, /ENOENT/);
  assert.equal(result.server.containmentOwner, "nix-build");
  await assert.rejects(run.startService(), /interrupted or finishing/);
});

for (const evidence of ["low-level", "systemd"]) test(`process harness cannot accept ${evidence} settlement as capsule service evidence`, linuxOnly, async (t) => {
  const run = capsuleHarness(t);
  const owned = run.startServer(process.execPath, ["-e", "console.log('ready'); setInterval(()=>{},1000)"], { env: run.env });
  await once(owned.child.stdout, "data");
  const result = await owned.stop();
  if (evidence === "systemd") owned.stop = async () => ({ ...result, scope: "systemd-user-service", cgroup: "absent" });
  await run.finish();
  assert.equal(state(run).status, "failed"); assert.equal(state(run).resourcesSettled, false);
  assert.ok(state(run).errors.includes("No installed package process settlement was established"));
});

test("fixture environment isolates terminal and browser state without ambient credentials/options", (t) => {
  const root = scratch(t);
  const env = fixtureEnvironment(root, {
    PATH: "/tools", HOME: "/host", XDG_CONFIG_HOME: "/host-config", TMPDIR: "/host-tmp",
    OPENAI_API_KEY: "test-only", CUSTOM_TOKEN: "test-only", AWS_PROFILE: "test-only",
    NODE_OPTIONS: "--require=/host.js", NODE_PATH: "/host/modules", HTTPS_PROXY: "http://host",
    PI_CODING_AGENT_SESSION_DIR: "/host-sessions", BRABBLER_ALLOWED_HOSTS: "host",
    GIT_CONFIG_COUNT: "1", BASH_ENV: "/host-init", ENV: "/host-init", LD_PRELOAD: "/host.so",
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/browser", E2E_GIT_WORKFLOW_PLUGIN_ONLY: "1",
  });
  assert.equal(env.PATH, "/tools");
  assert.equal(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, "/browser");
  assert.equal(env.E2E_GIT_WORKFLOW_PLUGIN_ONLY, "1");
  for (const key of ["OPENAI_API_KEY", "CUSTOM_TOKEN", "AWS_PROFILE", "NODE_OPTIONS", "NODE_PATH", "HTTPS_PROXY", "PI_CODING_AGENT_SESSION_DIR", "BRABBLER_ALLOWED_HOSTS", "GIT_CONFIG_COUNT", "BASH_ENV", "ENV", "LD_PRELOAD"]) assert.equal(env[key], undefined, key);
  for (const key of ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "TMPDIR", "PI_CODING_AGENT_DIR"]) {
    assert.ok(env[key].startsWith(root)); assert.ok(existsSync(env[key]));
  }
  assert.equal(env.PI_OFFLINE, "1"); assert.equal(env.BRABBLER_PASSWORD, "");
  assert.match(readFileSync(env.GIT_CONFIG_GLOBAL, "utf8"), /e2e@example.invalid/);
});

test("each run has unique private artifacts and traces every context, including peers", async (t) => {
  const root = scratch(t);
  const mask = process.umask();
  const first = createHarness(root, "browser", { requireService: false });
  const second = createHarness(root, "browser", { requireService: false });
  t.after(async () => {
    await first.finish(); await second.finish(); process.umask(mask);
    for (const run of [first, second]) rmSync(run.fixtureRoot, { recursive: true, force: true });
  });
  assert.notEqual(first.artifacts, second.artifacts);
  if (process.platform !== "win32") assert.equal(statSync(first.artifacts).mode & 0o777, 0o700);
  const owner = fakeBrowser();
  for (let i = 0; i < 2; i++) {
    const context = await first.newContext(owner, { viewport: { width: 390, height: 800 } }, "http://127.0.0.1:1234");
    await context.newPage(); await first.closeContext(context);
    assert.ok(existsSync(join(first.artifacts, `context-${i + 1}.zip`)));
  }
  await first.finish(); await second.finish();
  assert.equal(state(first).status, "passed"); assert.equal(state(second).status, "passed");
  assert.ok(existsSync(first.fixtureRoot), "Fixture retention is explicit even on success");
});

test("console errors and local 5xx fail acceptance; aborted requests remain diagnostics", async (t) => {
  const run = setup(t);
  const context = await run.newContext(fakeBrowser(), {}, "http://127.0.0.1:1234");
  const page = await context.newPage();
  page.emit("requestfailed", { method: () => "GET", url: () => "http://127.0.0.1:1234/events", failure: () => ({ errorText: "net::ERR_ABORTED" }) });
  assert.deepEqual(run.errorsFor(context), []);
  page.emit("console", { type: () => "error", text: () => "unexpected error" });
  page.emit("response", { url: () => "http://127.0.0.1:1234/api/example", status: () => 500 });
  assert.equal(run.errorsFor(context).length, 2);
  await run.finish();
  assert.equal(state(run).status, "failed");
  assert.match(readFileSync(join(run.artifacts, "events.jsonl"), "utf8"), /request-failed/);
});

test("failure preserves primary error, failed capture diagnostics and bounded teardown", async (t) => {
  const run = setup(t, { diagnosticTimeoutMs: 20, traceTimeoutMs: 20 });
  const context = await run.newContext(fakeBrowser({ hangStop: true, screenshotError: "capture unavailable" }));
  await context.newPage();
  await run.fail(new Error("original assertion"));
  await run.finish();
  const result = state(run);
  assert.equal(result.status, "failed");
  assert.ok(result.errors.some((message) => message.includes("original assertion")));
  assert.ok(result.errors.some((message) => message.includes("capture unavailable")));
  assert.ok(result.errors.some((message) => message.includes("settlement unknown")));
  assert.equal(context.closed, true);
  assert.ok(existsSync(result.fixtureRoot));
});

test("owned server records spawn, requested signals and exit, escalating an unresponsive child", { skip: process.platform === "win32" }, async (t) => {
  const root = scratch(t); const events = [];
  const owned = startOwnedServer(process.execPath, ["-e", "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"], { cwd: root }, {
    logPath: join(root, "server.log"), event: (type, detail) => events.push({ type, ...detail }), graceMs: 50, killMs: 2000,
  });
  t.after(() => owned.stop());
  await once(owned.child.stdout, "data");
  const result = await owned.stop();
  assert.equal(result.settled, true); assert.equal(result.unexpectedExit, false);
  assert.deepEqual(events.filter((event) => event.type === "server-signal-requested").map((event) => event.signal), ["SIGTERM", "SIGKILL"]);
  assert.ok(events.some((event) => event.type === "server-exit" && event.signal === "SIGKILL" && event.requestedStop));
  assert.match(readFileSync(join(root, "server.log"), "utf8"), /ready/);
  assert.deepEqual(await owned.stop(), result, "Stop is idempotent");
});

test("spawn failure and unexpected natural exit are not successful settlement", async (t) => {
  const root = scratch(t); const events = [];
  const missing = startOwnedServer(join(root, "missing-command"), [], { cwd: root }, {
    logPath: join(root, "missing.log"), event: (type) => events.push(type), graceMs: 100, killMs: 1000,
  });
  const failed = await missing.stop();
  assert.match(failed.error, /ENOENT/); assert.ok(events.includes("server-error"));
  const exited = startOwnedServer(process.execPath, ["-e", "process.exit(7)"], { cwd: root }, {
    logPath: join(root, "exit.log"), event: () => {}, graceMs: 100, killMs: 1000,
  });
  await once(exited.child, "close");
  assert.equal((await exited.stop()).unexpectedExit, true);
});

test("interruption finalizes a failed run and refuses later resource acquisition", { skip: process.platform === "win32" }, async (t) => {
  const root = scratch(t);
  const helper = new URL("../e2e/harness.mjs", import.meta.url).href;
  const code = `import { createHarness } from ${JSON.stringify(helper)};
    import { once } from 'node:events';
    const run = createHarness(${JSON.stringify(root)}, 'interrupt', { requireService: false });
    const server = run.startServer(process.execPath, ['-e', "console.log('READY'); setInterval(()=>{},1000)"], {});
    server.child.stdout.once('data', () => console.log('TEST_READY'));
    await once(server.child, 'close');
    await run.finish();
    try { run.startServer(process.execPath, ['-e', ''], {}); throw new Error('unexpected acquisition'); }
    catch (error) { if (!error.message.includes('interrupted or finishing')) throw error; }
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  const done = once(child, "close");
  const ready = new Promise((resolve) => child.stdout.on("data", (data) => { output += data; if (output.includes("TEST_READY")) resolve(); }));
  const stderr = []; child.stderr.on("data", (data) => stderr.push(String(data)));
  await ready;
  child.kill("SIGTERM");
  const [status] = await done;
  assert.equal(status, 1, stderr.join(""));
  const path = output.match(/Artifacts: (.+)/)[1];
  const result = JSON.parse(readFileSync(join(path, "run.json"), "utf8"));
  t.after(() => rmSync(result.fixtureRoot, { recursive: true, force: true }));
  assert.equal(result.status, "failed"); assert.equal(result.interrupted, true);
  assert.equal(result.server.settled, true);
  assert.match(readFileSync(join(path, "events.jsonl"), "utf8"), /run-interrupted/);
});

test("concurrent close and finish await the same trace export", async (t) => {
  const run = setup(t);
  const owner = fakeBrowser();
  const context = await run.newContext(owner);
  let release; const pending = new Promise((resolve) => { release = resolve; });
  const original = context.tracing.stop;
  context.tracing.stop = async (options) => { await pending; await original(options); };
  let browserClosed = false;
  owner.close = async () => { assert.ok(existsSync(join(run.artifacts, "context-1.zip"))); browserClosed = true; };
  const closing = run.closeContext(context);
  const ending = run.finish();
  assert.equal(browserClosed, false);
  release(); await closing; await ending;
  assert.equal(state(run).status, "passed");
});

test("an explicitly corroborated fixture error removed from its list is not duplicated globally", async (t) => {
  const run = setup(t);
  const context = await run.newContext(fakeBrowser());
  const page = await context.newPage();
  page.emit("console", { type: () => "error", text: () => "fixture conflict" });
  // Existing bulk fixture corroborates its negative response before this removal.
  assert.deepEqual(run.errorsFor(context).splice(0), ["fixture conflict"]);
  await run.closeContext(context); await run.finish();
  assert.equal(state(run).status, "passed");
});

test("shutdown owns an in-flight browser launch and closes its late result", async (t) => {
  const run = setup(t);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  let closes = 0;
  const pending = run.launchBrowser({ launch: async (options) => {
    assert.equal(options.timeout, 30_000);
    await gate;
    return { close: async () => { closes++; } };
  } });
  const rejected = assert.rejects(pending, /after interruption\/shutdown/);
  const finishing = run.finish();
  release(); await rejected; await finishing;
  assert.ok(closes > 0);
  assert.equal(state(run).status, "failed");
});

test("browser-close timeouts forbid bulk cleanup even without a live server", async (t) => {
  const run = setup(t, { diagnosticTimeoutMs: 10 });
  await run.launchBrowser({ launch: async () => ({ close: () => new Promise(() => {}) }) });
  await run.finish();
  assert.equal(state(run).resourcesSettled, false);
  assert.equal(state(run).status, "failed");
});

test("pending context acquisition keeps settlement uncertain and closes a late context", async (t) => {
  const run = setup(t, { diagnosticTimeoutMs: 10 });
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const owner = fakeBrowser();
  const late = await owner.newContext();
  late.started = true;
  owner.newContext = () => gate;
  const pending = run.newContext(owner, {});
  const rejected = assert.rejects(pending, /interrupted or finishing/);
  await run.finish();
  assert.equal(state(run).resourcesSettled, false);
  release(late); await rejected;
  assert.equal(late.closed, true);
});

test("runner source routes all general/terminal/peer contexts through shared tracing", () => {
  for (const file of ["browser-suite", "terminal-suite", "activity", "project-privacy"]) {
    const source = readFileSync(new URL(`../e2e/${file}.mjs`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /(?:browser\(\)|browser)\.newContext\(/, file);
    assert.doesNotMatch(source, /tracing\.(?:start|stop)\(/, file);
    assert.doesNotMatch(source, /chromium\.launch\(/, file);
    assert.match(source, /harness\.newContext\(/, file);
  }
});
