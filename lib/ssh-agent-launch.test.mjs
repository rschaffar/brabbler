import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter, once } from "node:events";
import { mkdtempSync, rmSync, existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { launchManagedNext } from "../bin/ssh-agent-launch.js";
import { createSshAgentRouter } from "../bin/ssh-agent-router.js";
import { requestGuardPath } from "../bin/brabbler-node-args.js";

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "launch-")); const parent = new EventEmitter(); const exits = [];
  parent.exit = code => exits.push(code);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, parent, exits, options: { hostname: "127.0.0.1", port: "30141", cwd: root, nextBin: "/synthetic/next", args: ["dev", "-p", "30141"], environment: { PI_CODING_AGENT_DIR: join(root, "agent"), SSH_AUTH_SOCK: "/synthetic/startup.sock", PATH: "/nonexistent" } } };
}

test("explicit no-auth warns on every bind and conflicting policy refuses before runtime allocation", async () => {
  for (const hostname of ['127.0.0.1', '0.0.0.0']) {
    const warnings = [];
    const options = { hostname, environment: { BRABBLER_NO_AUTH: '1' } };
    let admitted = 0;
    const services = { checkSdkEnvironment() {}, warn: text => warnings.push(text),
      createRouter() { admitted++; throw new Error('synthetic allocation stop'); } };
    await assert.rejects(launchManagedNext(options, services), /synthetic allocation stop/);
    assert.equal(admitted, 1); assert.equal(warnings.length, 1);
    assert.match(warnings[0], /authentication is DISABLED/); assert.ok(warnings[0].includes(hostname));
    options.environment.BRABBLER_REQUIRE_AUTH = '1'; warnings.length = 0;
    await assert.rejects(launchManagedNext(options, services), /Invalid web authentication configuration/);
    assert.equal(admitted, 1, 'no runtime admitted on conflicting flags');
    assert.equal(warnings.length, 0);
  }
});

test("maintained npm wrapper removes its no-auth flag and propagates explicit child policy", async () => {
  const file = new URL('../bin/next-cli.js', import.meta.url);
  const source = readFileSync(file, 'utf8'), actualRequire = createRequire(file);
  for (const disabled of [false, true]) {
    const env = { HOME: '/synthetic/home' }, specs = [];
    const require = name => {
      if (name === './ssh-agent-launch') return { launchManagedNext: async spec => { specs.push(spec); } };
      if (name === requestGuardPath) return {};
      return actualRequire(name);
    };
    require.resolve = () => '/synthetic/next';
    const args = ['dev', '-H', '0.0.0.0', '-p', '31337', ...(disabled ? ['--no-auth'] : [])];
    await runInNewContext(source, { require, process: {
      argv: [process.execPath, file.pathname, ...args], env, execArgv: [], cwd: () => '/synthetic/workspace',
      exit: () => { throw new Error('Unexpected exit'); },
    }, console });
    assert.equal(specs.length, 1); assert.equal(specs[0].args.includes('--no-auth'), false);
    assert.equal(specs[0].environment.BRABBLER_NO_AUTH, disabled ? '1' : undefined);
    assert.equal(env.BRABBLER_NO_AUTH, undefined, 'wrapper does not mutate ambient state');
    assert.equal(specs[0].hostname, '0.0.0.0'); assert.equal(specs[0].port, '31337');
  }
});

test("owner readiness precedes child spawn, preserves the inherited alias and does not export tokens", async t => {
  const { root, parent, exits, options } = setup(t); let router, captured;
  const child = new EventEmitter(); child.pid = 123; child.kill = () => true;
  await launchManagedNext(options, { parentProcess: parent, log() {},
    async createRouter(value) { router = await createSshAgentRouter({ ...value, tempDir: root }); return router; },
    spawn(_node, args, spec) {
      captured = spec.env;
      assert.ok(statSync(spec.env.SSH_AUTH_SOCK).isSocket());
      assert.equal(spec.cwd, root); assert.deepEqual(args.slice(0, 3), ["--require", requestGuardPath, "/synthetic/next"]);
      assert.equal(Object.values(spec.env).some(value => /^[a-f0-9]{64}$/.test(value)), false);
      return child;
    },
  });
  assert.equal(router.status().inheritedSocket, options.environment.SSH_AUTH_SOCK);
  assert.equal(options.environment.BRABBLER_SSH_RUNTIME, undefined);
  assert.notEqual(captured.SSH_AUTH_SOCK, options.environment.SSH_AUTH_SOCK);
  parent.emit("SIGTERM"); child.emit("exit", null, "SIGTERM");
  await router.close(); await delay(0); assert.deepEqual(exits, [143]); assert.equal(existsSync(router.root), false);
});

test("synchronous spawn failure and startup cancellation settle owned sockets", async t => {
  for (const cancel of [false, true]) {
    const { root, parent, options } = setup(t); let router; let spawned = false;
    const promise = launchManagedNext(options, { parentProcess: parent,
      async createRouter(value) { router = await createSshAgentRouter({ ...value, tempDir: root }); if (cancel) parent.emit("SIGINT"); return router; },
      spawn() { spawned = true; throw new Error("synthetic spawn refused"); },
    });
    await assert.rejects(promise, cancel ? error => error.exitCode === 130 : /synthetic spawn refused/);
    assert.equal(spawned, !cancel); assert.equal(existsSync(router.root), false); assert.equal(parent.listenerCount("SIGTERM"), 0);
  }
});

test("a retained real child inherits the same front path across explicit choices", async t => {
  const { root, parent, options } = setup(t); let router;
  const child = await launchManagedNext(options, { parentProcess: parent, log() {},
    async createRouter(value) { router = await createSshAgentRouter({ ...value, tempDir: root }); return router; },
    spawn(_node, _args, spec) { return spawn(process.execPath, ["-e", `
      const net = require('node:net');
      process.stdin.on('data', () => {
        const socket = net.connect(process.env.SSH_AUTH_SOCK); let bytes = Buffer.alloc(0);
        socket.on('connect', () => socket.write(Buffer.from([0,0,0,1,11])));
        socket.on('data', chunk => { bytes = Buffer.concat([bytes, chunk]); if (bytes.length >= 4 && bytes.length >= bytes.readUInt32BE()+4) {
          process.stdout.write(JSON.stringify({path:process.env.SSH_AUTH_SOCK,response:bytes.subarray(4).toString('hex')})+'\\n'); socket.destroy();
        }});
      });
    `], { ...spec, stdio: ["pipe", "pipe", "inherit"] }); },
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const closed = once(child, "close"); child.kill("SIGKILL"); await closed; } await router.close(); });
  const read = () => new Promise(resolve => child.stdout.once("data", bytes => resolve(JSON.parse(bytes.toString()))));
  let next = read(); child.stdin.write("go\n"); const first = await next; assert.equal(first.response, "0c00000000");
  await router.rpc({ action: "use", revision: router.status().revision, backend: { type: "browser" } });
  next = read(); child.stdin.write("go\n"); const second = await next;
  assert.equal(second.path, first.path); assert.equal(second.response, "05");
  await router.rpc({ action: "use", revision: router.status().revision, backend: { type: "none" } });
  next = read(); child.stdin.write("go\n"); const third = await next;
  assert.equal(third.path, first.path); assert.equal(third.response, "0c00000000");
  const closed = once(child, "close"); child.stdin.end(); await closed; await router.close();
});

test("importing bootstrap/control modules alone creates no runtime or settings", async t => {
  const { root, options } = setup(t);
  const modules = ["ssh-agent-router", "ssh-agent-client", "ssh-agent-launch"].map(name => new URL(`../bin/${name}.js`, import.meta.url).pathname);
  const child = spawn(process.execPath, ["-e", modules.map(name => `require(${JSON.stringify(name)})`).join(";")], {
    env: { ...options.environment, TMPDIR: root }, stdio: "pipe",
  });
  let errors = ""; child.stderr.on("data", chunk => { errors += chunk; });
  const [code] = await once(child, "close"); assert.equal(code, 0, errors); assert.deepEqual(readdirSync(root), []);
});
