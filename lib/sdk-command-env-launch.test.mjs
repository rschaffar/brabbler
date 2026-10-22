import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { launchManagedNext } from "../bin/ssh-agent-launch.js";

test("SDK verification refuses before runtime allocation, handlers or trusted-worker spawn", async () => {
  const parent = new EventEmitter(); let allocated = false, spawned = false;
  await assert.rejects(launchManagedNext({ hostname: "127.0.0.1", port: "30141", cwd: "/synthetic-project" }, {
    parentProcess: parent,
    checkSdkEnvironment() { throw new Error("synthetic unpatched SDK refusal"); },
    createRouter() { allocated = true; throw new Error("must not allocate"); },
    spawn() { spawned = true; throw new Error("must not spawn"); },
  }), /synthetic unpatched SDK refusal/);
  assert.equal(allocated, false); assert.equal(spawned, false);
  assert.equal(parent.listenerCount("SIGTERM"), 0); assert.equal(parent.listenerCount("SIGINT"), 0);
});

test("SDK checking never sanitizes the trusted Next worker's private env or normal public socket", async () => {
  const parent = new EventEmitter(), child = new EventEmitter(), order = [];
  child.pid = 123; child.kill = () => true; parent.exit = () => {};
  const environment = { PATH: "/synthetic/path", PI_WEB_PASSWORD: "synthetic-login", PI_DESK_SSH_RUNTIME: "/synthetic/stale",
    SSH_AUTH_SOCK: "/synthetic/system.sock", AWS_PROFILE: "synthetic-account" };
  let captured;
  const router = { root: "/synthetic/private-control", socketPath: "/synthetic/stable.sock", stopAdmission() {}, async close() {} };
  await launchManagedNext({ hostname: "127.0.0.1", port: "30141", cwd: "/synthetic-untrusted-project", nextBin: "/synthetic/next", args: [], environment }, {
    parentProcess: parent, log() {},
    checkSdkEnvironment() { order.push("check"); },
    async createRouter() { order.push("router"); return router; },
    spawn(_node, _args, spec) { order.push("spawn"); captured = spec.env; return child; },
  });
  assert.deepEqual(order, ["check", "router", "spawn"]);
  assert.equal(captured.PI_WEB_PASSWORD, environment.PI_WEB_PASSWORD);
  assert.equal(captured.PI_DESK_SSH_RUNTIME, router.root);
  assert.equal(captured.SSH_AUTH_SOCK, router.socketPath);
  assert.equal(captured.AWS_PROFILE, environment.AWS_PROFILE);
  assert.equal(environment.PI_DESK_SSH_RUNTIME, "/synthetic/stale");
  // Settle the fake lifecycle and remove its listeners without real processes.
  child.emit("exit", 0, null);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(parent.listenerCount("SIGTERM"), 0);
});
