import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { launchManagedNext } from "../bin/next-launch.js";
import { requestGuardPath } from "../bin/brabbler-node-args.js";

function fakeProcesses() {
  const parent = new EventEmitter(), child = new EventEmitter(), exits = [], signals = [];
  parent.exit = code => exits.push(code);
  child.pid = 123; child.kill = signal => { signals.push(signal); return true; };
  return { parent, child, exits, signals };
}

test("explicit no-auth warns on every bind and conflicting policy refuses before spawn", async () => {
  for (const hostname of ["127.0.0.1", "0.0.0.0"]) {
    const warnings = [], { parent, child } = fakeProcesses(); let spawned = 0;
    const options = { hostname, environment: { BRABBLER_NO_AUTH: "1" }, nextBin: "/synthetic/next", args: [] };
    const services = { checkSdkEnvironment() {}, parentProcess: parent, log() {}, warn: text => warnings.push(text),
      spawn() { spawned++; return child; } };
    await launchManagedNext(options, services);
    child.emit("exit", 0, null);
    assert.equal(spawned, 1); assert.equal(warnings.length, 1);
    assert.match(warnings[0], /authentication is DISABLED/); assert.ok(warnings[0].includes(hostname));
    options.environment.BRABBLER_REQUIRE_AUTH = "1"; warnings.length = 0;
    await assert.rejects(launchManagedNext(options, services), /Invalid web authentication configuration/);
    assert.equal(spawned, 1); assert.equal(warnings.length, 0);
    assert.equal(parent.listenerCount("SIGTERM"), 0);
  }
});

test("maintained npm wrapper removes its no-auth flag and propagates explicit child policy", async () => {
  const file = new URL("../bin/next-cli.js", import.meta.url);
  const source = readFileSync(file, "utf8"), actualRequire = createRequire(file);
  for (const disabled of [false, true]) {
    const env = { HOME: "/synthetic/home" }, specs = [];
    const require = name => {
      if (name === "./next-launch") return { launchManagedNext: async spec => { specs.push(spec); } };
      if (name === requestGuardPath) return {};
      return actualRequire(name);
    };
    require.resolve = () => "/synthetic/next";
    const args = ["dev", "-H", "0.0.0.0", "-p", "31337", ...(disabled ? ["--no-auth"] : [])];
    await runInNewContext(source, { require, process: {
      argv: [process.execPath, file.pathname, ...args], env, execArgv: [], cwd: () => "/synthetic/workspace",
      exit: () => { throw new Error("Unexpected exit"); },
    }, console });
    assert.equal(specs.length, 1); assert.equal(specs[0].args.includes("--no-auth"), false);
    assert.equal(specs[0].environment.BRABBLER_NO_AUTH, disabled ? "1" : undefined);
    assert.equal(env.BRABBLER_NO_AUTH, undefined);
    assert.equal(specs[0].hostname, "0.0.0.0"); assert.equal(specs[0].port, "31337");
  }
});

test("launcher preserves native agent inheritance without allocating or selecting an agent", async t => {
  const root = mkdtempSync(join(tmpdir(), "next-launch-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const socket of [undefined, "/synthetic/forwarded-agent.sock"]) {
    const { parent, child, exits, signals } = fakeProcesses();
    const environment = Object.freeze({ HOME: root, ...(socket ? { SSH_AUTH_SOCK: socket } : {}), BRABBLER_PASSWORD: "synthetic-login" });
    let captured;
    await launchManagedNext({ hostname: "127.0.0.1", cwd: root, nextBin: "/synthetic/next", args: ["start"], environment }, {
      parentProcess: parent, checkSdkEnvironment() {}, log() {},
      spawn(_node, args, spec) {
        captured = spec.env;
        assert.deepEqual(args.slice(0, 3), ["--require", requestGuardPath, "/synthetic/next"]);
        assert.equal(spec.cwd, root); return child;
      },
    });
    assert.equal(captured.SSH_AUTH_SOCK, socket);
    assert.equal(Object.hasOwn(captured, "SSH_AUTH_SOCK"), socket !== undefined);
    assert.equal(captured.BRABBLER_PASSWORD, environment.BRABBLER_PASSWORD);
    assert.equal(captured.BRABBLER_SSH_RUNTIME, undefined);
    assert.notEqual(captured, environment); assert.deepEqual(readdirSync(root), []);
    parent.emit("SIGTERM"); child.emit("exit", null, "SIGTERM");
    assert.deepEqual(signals, ["SIGTERM"]); assert.deepEqual(exits, [143]);
    assert.equal(parent.listenerCount("SIGTERM"), 0);
  }
});

test("synchronous spawn failure leaves no signal handlers", async () => {
  const { parent } = fakeProcesses();
  await assert.rejects(launchManagedNext({ hostname: "127.0.0.1", nextBin: "/synthetic/next", args: [] }, {
    parentProcess: parent, checkSdkEnvironment() {}, spawn() { throw new Error("synthetic spawn refused"); },
  }), /synthetic spawn refused/);
  assert.equal(parent.listenerCount("SIGTERM"), 0); assert.equal(parent.listenerCount("SIGINT"), 0);
});

test("a real child reaches the explicitly inherited native agent socket", { timeout: 10_000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "native-agent-")), socketPath = join(root, "agent.sock");
  const server = createServer(socket => socket.end("synthetic-agent-response"));
  const { parent } = fakeProcesses(); let child;
  t.after(async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close"); child.kill("SIGKILL"); await closed;
    }
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    rmSync(root, { recursive: true, force: true });
  });
  server.listen(socketPath); await once(server, "listening");
  child = await launchManagedNext({ hostname: "127.0.0.1", cwd: root, nextBin: "/synthetic/next", args: [],
    environment: { SSH_AUTH_SOCK: socketPath } }, {
    parentProcess: parent, checkSdkEnvironment() {}, log() {},
    spawn(_node, _args, spec) { return spawn(process.execPath, ["-e", `
      const socket = require('node:net').connect(process.env.SSH_AUTH_SOCK);
      socket.on('data', bytes => process.stdout.write(bytes));
      socket.on('error', () => process.exit(1));
    `], { ...spec, stdio: ["ignore", "pipe", "pipe"] }); },
  });
  let output = "", errors = "";
  child.stdout.on("data", bytes => { output += bytes; }); child.stderr.on("data", bytes => { errors += bytes; });
  const [code] = await once(child, "close");
  assert.equal(code, 0, errors); assert.equal(output, "synthetic-agent-response");
});
