import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { wireChildProcessLifecycle } from "../bin/process-lifecycle.js";

function createProcesses() {
  const parent = new EventEmitter();
  const child = new EventEmitter();
  const forwardedSignals = [];
  const exitCodes = [];

  child.kill = (signal) => {
    forwardedSignals.push(signal);
    return true;
  };
  parent.exit = (code) => {
    exitCodes.push(code);
  };

  return { parent, child, forwardedSignals, exitCodes };
}

test("forwards the first shutdown signal and force-kills on repeated signals", () => {
  const { parent, child, forwardedSignals } = createProcesses();

  wireChildProcessLifecycle(child, parent);
  parent.emit("SIGTERM");
  parent.emit("SIGTERM");
  parent.emit("SIGINT");

  assert.deepEqual(forwardedSignals, ["SIGTERM", "SIGKILL", "SIGKILL"]);
  child.emit("exit", null, "SIGKILL");
});

test("propagates a child exit code and clears its shutdown wiring", async () => {
  const { parent, child, forwardedSignals, exitCodes } = createProcesses();
  const existingSigtermListener = () => {};
  parent.on("SIGTERM", existingSigtermListener);

  wireChildProcessLifecycle(child, parent, 10);
  assert.equal(parent.listenerCount("SIGINT"), 1);
  assert.equal(parent.listenerCount("SIGTERM"), 2);

  parent.emit("SIGTERM");
  child.emit("exit", 23, null);
  await delay(20);

  assert.deepEqual(exitCodes, [23]);
  assert.equal(parent.listenerCount("SIGINT"), 0);
  assert.deepEqual(parent.listeners("SIGTERM"), [existingSigtermListener]);

  parent.emit("SIGTERM");
  assert.deepEqual(forwardedSignals, ["SIGTERM"]);
});

test("force-kills the child when graceful shutdown times out", async () => {
  const { parent, child, forwardedSignals } = createProcesses();

  wireChildProcessLifecycle(child, parent, 10);
  parent.emit("SIGINT");
  assert.deepEqual(forwardedSignals, ["SIGINT"]);

  await delay(20);

  assert.deepEqual(forwardedSignals, ["SIGINT", "SIGKILL"]);
  child.emit("exit", null, "SIGKILL");
});

test("uses conventional exit statuses for known child signals", () => {
  for (const [signal, expectedExitCode] of [
    ["SIGTERM", 143],
    ["SIGKILL", 137],
  ]) {
    const { parent, child, exitCodes } = createProcesses();

    wireChildProcessLifecycle(child, parent, undefined, () => {});
    child.emit("exit", null, signal);

    assert.deepEqual(exitCodes, [expectedExitCode]);
  }
});

test("reports a spawn failure instead of crashing on an unhandled error event", () => {
  const { parent, child, exitCodes } = createProcesses();
  const logged = [];

  wireChildProcessLifecycle(child, parent, 10, (line) => logged.push(line));
  // Without a listener this event is fatal to the wrapper itself.
  child.emit("error", new Error("spawn node ENOENT"));

  assert.deepEqual(exitCodes, [1]);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /could not run the Next\.js process: spawn node ENOENT/);
  assert.equal(parent.listenerCount("SIGINT"), 0, "the signal wiring must be torn down");
});

test("names the reason when the child stops on its own", () => {
  for (const [code, signal, expectedReason, expectedExitCode] of [
    [null, "SIGKILL", "signal SIGKILL", 137],
    [1, null, "code 1", 1],
    [0, null, "code 0", 0],
  ]) {
    const { parent, child, exitCodes } = createProcesses();
    const logged = [];

    wireChildProcessLifecycle(child, parent, 10, (line) => logged.push(line));
    child.emit("exit", code, signal);

    assert.deepEqual(logged, [`[pi-web] Next.js exited unexpectedly (${expectedReason})`]);
    assert.deepEqual(exitCodes, [expectedExitCode]);
  }
});

test("keeps the shutdown fallback armed when signaling the child fails", async () => {
  const { parent, child, forwardedSignals, exitCodes } = createProcesses();
  const logged = [];

  child.pid = 123;
  child.kill = (signal) => {
    forwardedSignals.push(signal);
    if (signal === "SIGTERM") {
      child.emit("error", new Error("kill EPERM"));
      return false;
    }
    child.emit("exit", null, signal);
    return true;
  };

  wireChildProcessLifecycle(child, parent, 10, (line) => logged.push(line));
  parent.emit("SIGTERM");
  assert.deepEqual(exitCodes, []);

  await delay(20);

  assert.deepEqual(forwardedSignals, ["SIGTERM", "SIGKILL"]);
  assert.deepEqual(logged, ["[pi-web] Next.js process error: kill EPERM"]);
  assert.deepEqual(exitCodes, [137]);
});

test("awaits bounded owner cleanup exactly once before propagating exit", async () => {
  const { parent, child, exitCodes } = createProcesses(); let resolveCleanup, calls = 0, stopped = 0;
  wireChildProcessLifecycle(child, parent, 10, () => {}, {
    stopAdmission() { stopped++; }, settle() { calls++; return new Promise(resolve => { resolveCleanup = resolve; }); },
  });
  parent.emit("SIGTERM"); child.emit("exit", null, "SIGTERM"); child.emit("exit", 1);
  assert.equal(stopped, 1); assert.equal(calls, 1); assert.deepEqual(exitCodes, []);
  resolveCleanup(); await delay(0); assert.deepEqual(exitCodes, [143]);
});

test("owner cleanup failure and timeout are reported and cannot hang exit", async () => {
  for (const settle of [() => { throw new Error("synthetic cleanup failure"); }, () => new Promise(() => {})]) {
    const { parent, child, exitCodes } = createProcesses(); const logs = [];
    wireChildProcessLifecycle(child, parent, 10, line => logs.push(line), { settle, timeoutMs: 5 });
    child.emit("error", new Error("synthetic spawn failure")); await delay(15);
    assert.deepEqual(exitCodes, [1]); assert.ok(logs.some(line => line.includes("owner cleanup")));
  }
});

test("cleanup failure cannot turn a successful child exit into successful settlement", async () => {
  const { parent, child, exitCodes } = createProcesses();
  wireChildProcessLifecycle(child, parent, 10, () => {}, { settle: () => Promise.reject(new Error("cleanup failed")) });
  child.emit("exit", 0, null); await delay(0); assert.deepEqual(exitCodes, [1]);
});

test("stays quiet for a shutdown the user asked for", async () => {
  const { parent, child, exitCodes } = createProcesses();
  const logged = [];

  wireChildProcessLifecycle(child, parent, 10, (line) => logged.push(line));
  parent.emit("SIGINT");
  child.emit("exit", null, "SIGINT");
  await delay(20);

  assert.deepEqual(logged, [], "ctrl+c is not an incident");
  assert.deepEqual(exitCodes, [130]);
});
