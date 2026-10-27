import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const jiti = createJiti(import.meta.url, { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } });
const { createTerminal, getTerminalCwd, hasTerminal, killTerminal, subscribeTerminal, TERMINAL_RECONNECT_MS } = await jiti.import("./terminal-manager.ts");
const { GET } = await jiti.import("../app/api/terminal/[id]/events/route.ts");
const currentRoute = await jiti.import("../app/api/terminal/[id]/route.ts");
const pathSecurity = await jiti.import("./path-security.ts");
const directoryReservations = await jiti.import("./directory-reservations.ts");
function createTerminalTestRequire() {
  const require = createRequire(import.meta.url);
  return (id) => id === "./path-security" ? pathSecurity
    : id === "./directory-reservations" ? directoryReservations : require(id);
}

function fixtureTerminal(t) {
  const cwd = mkdtempSync(join(tmpdir(), "brabbler-terminal-test-"));
  let id;
  try { id = createTerminal(cwd, 80, 24); }
  catch (error) { rmSync(cwd, { recursive: true, force: true }); throw error; }
  const record = globalThis.__brabblerTerminals.get(id);
  const cleanup = () => {
    if (globalThis.__brabblerTerminals.get(id) === record) killTerminal(id, true);
    else if (!record.exited) {
      // Expiry already removed the entry. Its escalation may still be on a
      // mocked timer that node:test will discard: retain ownership of this PTY.
      try { record.pty.kill("SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    rmSync(cwd, { recursive: true, force: true });
  };
  t.after(cleanup);
  return { id, cwd, cleanup };
}

test("native module load failures are deferred until creation and include repair instructions", async () => {
  const require = createTerminalTestRequire();
  const paths = await jiti.import("./paths.ts");
  const source = readFileSync(new URL("./terminal-manager.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const exports = {};
  runInNewContext(outputText, { exports, process, require(id) {
    if (id === "node-pty") throw new Error("Cannot find module pty.node");
    return id === "./paths" ? paths : require(id);
  } });
  assert.equal(exports.hasTerminal("missing"), false);
  assert.throws(() => exports.createTerminal(process.cwd(), 80, 24), (error) => {
    assert.match(error.message, /native terminal module/);
    assert.match(error.message, /npm rebuild node-pty --build-from-source --ignore-scripts=false --foreground-scripts/);
    assert.match(error.message, /Cannot find module pty.node/);
    return true;
  });
});

test("shell environment defaults to UTF-8 locale when the host has none", async () => {
  const require = createTerminalTestRequire();
  const paths = await jiti.import("./paths.ts");
  const source = readFileSync(new URL("./terminal-manager.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const spawnCalls = [];
  const fakePty = { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
  const fakeRequire = (id) => {
    if (id === "node-pty") return { spawn: (...args) => { spawnCalls.push(args); return fakePty; } };
    if (id === "./paths") return paths;
    return require(id);
  };
  const envWithoutLocale = Object.fromEntries(Object.entries(process.env).filter(([k]) => !["LANG", "LC_ALL", "LC_CTYPE"].includes(k)));
  const exports = {};
  runInNewContext(outputText, { exports, process: { ...process, env: envWithoutLocale, once() {}, platform: process.platform }, require: fakeRequire, setTimeout, clearTimeout, console });
  exports.createTerminal(process.cwd(), 80, 24);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0][2].env.LANG, "C.UTF-8");
});

test("shell environment preserves a case-insensitive Windows locale", async () => {
  const require = createTerminalTestRequire();
  const paths = await jiti.import("./paths.ts");
  const source = readFileSync(new URL("./terminal-manager.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const spawnCalls = [];
  const fakePty = { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
  const fakeRequire = (id) => {
    if (id === "node-pty") return { spawn: (...args) => { spawnCalls.push(args); return fakePty; } };
    if (id === "./paths") return paths;
    return require(id);
  };
  const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !["lang", "lc_all", "lc_ctype"].includes(key.toLowerCase())));
  rawEnv.lang = "zh_CN.UTF-8";
  const envWithLocale = new Proxy(rawEnv, {
    get(target, key) {
      if (typeof key !== "string") return Reflect.get(target, key);
      const match = Object.keys(target).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
      return match ? target[match] : undefined;
    },
  });
  const exports = {};
  runInNewContext(outputText, { exports, process: { ...process, env: envWithLocale, once() {}, platform: process.platform }, require: fakeRequire, setTimeout, clearTimeout, console });
  exports.createTerminal(process.cwd(), 80, 24);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0][2].env.lang, "zh_CN.UTF-8");
  assert.equal("LANG" in spawnCalls[0][2].env, false);
});

test("shell environment omits server login/control metadata but preserves the stable agent socket", async () => {
  const require = createTerminalTestRequire();
  const paths = await jiti.import("./paths.ts");
  const source = readFileSync(new URL("./terminal-manager.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const spawnCalls = [];
  const fakePty = { onData() {}, onExit() {}, write() {}, resize() {}, kill() {} };
  const fakeRequire = (id) => {
    if (id === "node-pty") return { spawn: (...args) => { spawnCalls.push(args); return fakePty; } };
    if (id === "./paths") return paths;
    return require(id);
  };
  const env = { ...process.env, BRABBLER_PASSWORD: "web-login-password", BRABBLER_SSH_RUNTIME: "/synthetic/private/control.json", SSH_AUTH_SOCK: "/synthetic/stable/agent.sock", PI_USER_SETTING: "preserved" };
  const exports = {};
  runInNewContext(outputText, { exports, process: { ...process, env, once() {}, platform: process.platform }, require: fakeRequire, setTimeout, clearTimeout, console });
  exports.createTerminal(process.cwd(), 80, 24);
  assert.equal(spawnCalls.length, 1);
  assert.equal("BRABBLER_PASSWORD" in spawnCalls[0][2].env, false);
  assert.equal("BRABBLER_SSH_RUNTIME" in spawnCalls[0][2].env, false);
  assert.equal(spawnCalls[0][2].env.SSH_AUTH_SOCK, "/synthetic/stable/agent.sock");
  assert.equal(spawnCalls[0][2].env.PI_USER_SETTING, "preserved");
});

test("native PTY starts after install and repeated creation reuses the same workspace process", (t) => {
  const { id, cwd } = fixtureTerminal(t);
  const record = globalThis.__brabblerTerminals.get(id);
  assert.ok(record.pty.pid > 0);
  assert.equal(getTerminalCwd(id), cwd);
  assert.equal(createTerminal(cwd, 100, 30, id), id);
  assert.strictEqual(globalThis.__brabblerTerminals.get(id), record);
  assert.throws(() => createTerminal(join(cwd, "other"), 80, 24, id), /different workspace/);
  assert.ok(record.cleanupTimer, "unclaimed creations have a lease");
});

test("connected terminals outlive the grace period; only the last disconnect starts expiry", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { id } = fixtureTerminal(t);
  const first = subscribeTerminal(id, () => {});
  const second = subscribeTerminal(id, () => {});
  first.unsubscribe();
  t.mock.timers.tick(TERMINAL_RECONNECT_MS * 2);
  assert.ok(hasTerminal(id));
  second.unsubscribe();
  t.mock.timers.tick(TERMINAL_RECONNECT_MS - 1);
  assert.ok(hasTerminal(id));
  const resumed = subscribeTerminal(id, () => {});
  t.mock.timers.tick(TERMINAL_RECONNECT_MS);
  assert.ok(hasTerminal(id));
  resumed.unsubscribe();
  t.mock.timers.tick(TERMINAL_RECONNECT_MS);
  assert.equal(hasTerminal(id), false);
});

test("unclaimed creations expire without requiring a browser cleanup request", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { id } = fixtureTerminal(t);
  t.mock.timers.tick(TERMINAL_RECONNECT_MS);
  assert.equal(hasTerminal(id), false);
});

test("fixture cleanup terminates an expired real PTY even when its initial signal was ignored", { timeout: 10_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { id, cleanup } = fixtureTerminal(t);
  const record = globalThis.__brabblerTerminals.get(id);
  const nativeKill = record.pty.kill.bind(record.pty);
  const signals = [];
  const exited = new Promise((resolve) => record.pty.onExit(resolve));
  // Model a shell surviving SIGHUP during startup, without relying on timing.
  record.pty.kill = (signal) => {
    signals.push(signal ?? "SIGHUP");
    if (signal === "SIGKILL") nativeKill(signal);
  };
  try {
    t.mock.timers.tick(TERMINAL_RECONNECT_MS);
    assert.equal(hasTerminal(id), false, "expiry removes the registry entry before escalation");
    assert.deepEqual(signals, ["SIGHUP"]);
    cleanup();
    assert.ok(signals.includes("SIGKILL"), "fixture teardown must not lose an expired shell with its registry entry");
  } finally {
    // Keep the red regression itself settled: its intentionally ignored HUP
    // must never leak a real shell if the cleanup assertion fails.
    t.mock.timers.reset();
    if (!record.exited) {
      try { nativeKill("SIGKILL"); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
    await exited;
  }
});

test("SSE resumes from Last-Event-ID and cancellation releases the connection lease", async (t) => {
  const { id } = fixtureTerminal(t);
  const record = globalThis.__brabblerTerminals.get(id);
  record.backlog = "old\r\nnew\r\n";
  record.offset = record.backlog.length;
  const request = new Request("http://localhost/events?after=0", { headers: { "Last-Event-ID": "5" } });
  const response = await GET(request, { params: Promise.resolve({ id }) });
  const reader = response.body.getReader();
  await reader.read();
  const replay = new TextDecoder().decode((await reader.read()).value);
  assert.match(replay, /id: 10\n/);
  assert.deepEqual(JSON.parse(replay.split("data: ")[1]), { type: "output", data: "new\r\n", offset: 10, reset: false });
  await reader.cancel();
  assert.equal(record.listeners.size, 0);
  assert.ok(record.cleanupTimer);
});

test("expired output cursors reset bounded history, while explicit close ends connected streams", async (t) => {
  const { id } = fixtureTerminal(t);
  const record = globalThis.__brabblerTerminals.get(id);
  record.backlog = "tail";
  record.offset = 100;
  const subscription = subscribeTerminal(id, () => {}, 10);
  assert.deepEqual(subscription.output, { type: "output", data: "tail", offset: 100, reset: true });
  subscription.unsubscribe();
  const response = await GET(new Request("http://localhost/events"), { params: Promise.resolve({ id }) });
  const reader = response.body.getReader();
  await reader.read();
  await reader.read();
  killTerminal(id);
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"closed"/);
  assert.equal((await reader.read()).done, true);
  assert.equal(record.listeners.size, 0);
  assert.equal(hasTerminal(id), false);
});


test("terminal current-id route rejects exact browser rows table without native resize and clamps one accepted row", { timeout: 15_000 }, async t => {
  const { id, cwd, cleanup } = fixtureTerminal(t);
  const record = globalThis.__brabblerTerminals.get(id), pty = record.pty;
  assert.ok(pty.pid > 0);
  assert.equal(getTerminalCwd(id), cwd);
  assert.ok(record.cleanupTimer, 'actual unclaimed lease');
  const nativeResize = pty.resize;
  const resizeDescriptor = Object.getOwnPropertyDescriptor(pty, 'resize');
  const calls = [];
  const exit = new Promise(resolve => pty.onExit(resolve));
  const subscription = subscribeTerminal(id, () => {});
  assert.ok(subscription);
  const listeners = [...record.listeners];
  assert.equal(record.cleanupTimer, null, 'actual current subscription owns lease');
  const params = () => ({ params: Promise.resolve({ id }) });
  const request = rows => new Request(`http://localhost/api/terminal/${id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'resize', cols: 80, rows }),
  });
  // Observe AND forward the real native method; invalid calls remain evidence
  // even if the route catches an exception. Never substitute a successful PTY.
  pty.resize = function(cols, rows) { calls.push([cols, rows]); return Reflect.apply(nativeResize, this, [cols, rows]); };
  const current = () => {
    assert.strictEqual(globalThis.__brabblerTerminals.get(id), record);
    assert.strictEqual(record.pty, pty);
    assert.equal(record.cwd, cwd);
    assert.equal(record.exited, false);
    assert.equal(record.cleanupTimer, null);
    assert.deepEqual([...record.listeners], listeners);
  };
  try {
    for (const rows of [0, -1, 1.5, 1001, '1']) {
      const response = await currentRoute.POST(request(rows), params());
      assert.equal(response.status, 400, `rows=${JSON.stringify(rows)} exact HTTP400`);
      assert.deepEqual(await response.json(), { error: 'Invalid terminal command' });
      assert.deepEqual(calls, [], 'NO native resize on invalid row');
      assert.equal(pty.cols, 80); assert.equal(pty.rows, 24); current();
    }
    const response = await currentRoute.POST(request(1), params());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(calls, [[80, 2]], 'route clamps accepted row1 to native row2');
    assert.equal(pty.cols, 80); assert.equal(pty.rows, 2); current();

    // Kernel/shell readback, not just node-pty's public cached dimensions.
    let output = '', timeout;
    let data;
    const dimensions = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('owned native stty readback missing 2 80')), 5000);
      data = pty.onData(chunk => {
        output += chunk;
        if (output.includes('__PARITY_DIM__2 80__END__')) resolve();
      });
    });
    try {
      pty.write("printf '__PARITY_%s__' DIM; stty size | tr -d '\\r\\n'; printf '__END__\\n'\r");
      await dimensions;
    } finally { clearTimeout(timeout); data?.dispose(); }
    const closed = await currentRoute.DELETE(new Request(`http://localhost/api/terminal/${id}`, { method: 'DELETE' }), params());
    assert.equal(closed.status, 200);
    assert.deepEqual(await closed.json(), { success: true });
    assert.equal(hasTerminal(id), false);
    assert.equal(record.listeners.size, 0);
    const gone = await currentRoute.GET(new Request(`http://localhost/api/terminal/${id}`), params());
    assert.equal(gone.status, 404);
  } finally {
    // Existing fixture cleanup retains this exact record even if route DELETE
    // removed it. Force only this owned shell and await actual exit before rm.
    try {
      if (resizeDescriptor) Object.defineProperty(pty, 'resize', resizeDescriptor);
      else delete pty.resize;
    } finally {
      try { subscription.unsubscribe(); }
      finally {
        try {
          if (record.cleanupTimer) clearTimeout(record.cleanupTimer);
          record.cleanupTimer = null;
          if (!record.exited) {
            try { pty.kill('SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
          }
        } finally {
          try { await exit; } finally { cleanup(); }
        }
      }
    }
  }
});
