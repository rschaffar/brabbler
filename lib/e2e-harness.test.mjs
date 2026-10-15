import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, readFileSync, existsSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHarness, fixtureEnvironment, startOwnedServer } from "../e2e/harness.mjs";

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

test("fixture environment isolates terminal and browser state without ambient credentials/options", (t) => {
  const root = scratch(t);
  const env = fixtureEnvironment(root, {
    PATH: "/tools", HOME: "/host", XDG_CONFIG_HOME: "/host-config", TMPDIR: "/host-tmp",
    OPENAI_API_KEY: "test-only", CUSTOM_TOKEN: "test-only", AWS_PROFILE: "test-only",
    NODE_OPTIONS: "--require=/host.js", NODE_PATH: "/host/modules", HTTPS_PROXY: "http://host",
    PI_CODING_AGENT_SESSION_DIR: "/host-sessions", PI_WEB_ALLOWED_HOSTS: "host",
    GIT_CONFIG_COUNT: "1", BASH_ENV: "/host-init", ENV: "/host-init", LD_PRELOAD: "/host.so",
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: "/browser", E2E_GIT_WORKFLOW_PLUGIN_ONLY: "1",
  });
  assert.equal(env.PATH, "/tools");
  assert.equal(env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, "/browser");
  assert.equal(env.E2E_GIT_WORKFLOW_PLUGIN_ONLY, "1");
  for (const key of ["OPENAI_API_KEY", "CUSTOM_TOKEN", "AWS_PROFILE", "NODE_OPTIONS", "NODE_PATH", "HTTPS_PROXY", "PI_CODING_AGENT_SESSION_DIR", "PI_WEB_ALLOWED_HOSTS", "GIT_CONFIG_COUNT", "BASH_ENV", "ENV", "LD_PRELOAD"]) assert.equal(env[key], undefined, key);
  for (const key of ["HOME", "USERPROFILE", "APPDATA", "XDG_CONFIG_HOME", "XDG_RUNTIME_DIR", "TMPDIR", "PI_CODING_AGENT_DIR"]) {
    assert.ok(env[key].startsWith(root)); assert.ok(existsSync(env[key]));
  }
  assert.equal(env.PI_OFFLINE, "1"); assert.equal(env.PI_WEB_PASSWORD, "");
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
