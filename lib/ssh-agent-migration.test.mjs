import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { createJiti } from "jiti";
import { createSshAgentRouter } from "../bin/ssh-agent-router.js";
const jiti = createJiti(import.meta.url);
const { BrowserSshAgent } = await jiti.import("./browser-ssh-agent.ts");
const { createProjectCommandBashOperations } = await jiti.import("./project-command-env.ts");

test("managed No-agent bypasses orphaned markers without deletion, fallback or breaking ordinary Bash", async () => {
  const root = mkdtempSync(join(tmpdir(), "ssh-migrate-"));
  const environment = { ...process.env, PI_CODING_AGENT_DIR: join(root, "agent"), SSH_AUTH_SOCK: "/synthetic/startup-host-agent" };
  const router = await createSshAgentRouter({ environment, tempDir: root, instance: "migration:30141" });
  const markerRoot = join(root, "markers"); mkdirSync(markerRoot, { mode: 0o700 });
  const marker = join(markerRoot, "legacy-session"); writeFileSync(marker, "", { mode: 0o600 });
  const legacy = new BrowserSshAgent({ markerRoot }); const symbol = Symbol.for("pi-web:browser-ssh-agent");
  const previous = globalThis[symbol], oldSocket = process.env.SSH_AUTH_SOCK, oldRuntime = process.env.PI_DESK_SSH_RUNTIME;
  globalThis[symbol] = legacy;
  // Prove this is an actual orphan that the legacy runtime would have blocked.
  assert.throws(() => legacy.environment("legacy-session"), /disconnected/);
  process.env.PI_DESK_SSH_RUNTIME = router.root; process.env.SSH_AUTH_SOCK = router.socketPath;
  try {
    const baseEnvironment = { ...environment, SSH_AUTH_SOCK: router.socketPath, PI_DESK_SSH_RUNTIME: router.root };
    const operations = createProjectCommandBashOperations({ sessionId: "legacy-session", baseEnvironment, agentBinDir: join(root, "bin") });
    const chunks = [];
    const result = await operations.exec("printf 'ready:%s' \"$SSH_AUTH_SOCK\"", root, { onData(chunk) { chunks.push(chunk); } });
    assert.equal(result.exitCode, 0); assert.equal(Buffer.concat(chunks).toString(), "ready:" + router.socketPath);
    assert.equal(router.status().setupNeeded, true); assert.equal(readFileSync(marker, "utf8"), "");
    const response = await new Promise((resolve, reject) => {
      const socket = connect(router.socketPath); let bytes = Buffer.alloc(0);
      socket.on("error", reject); socket.on("connect", () => socket.write(Buffer.from([0, 0, 0, 1, 11])));
      socket.on("data", chunk => { bytes = Buffer.concat([bytes, chunk]); if (bytes.length >= 9) { resolve(bytes.subarray(4)); socket.destroy(); } });
    });
    assert.deepEqual(response, Buffer.from([12, 0, 0, 0, 0]));
    let captured;
    const injected = createProjectCommandBashOperations({ sessionId: "legacy-session", baseEnvironment,
      localOperations: { async exec(_command, _cwd, options) { captured = options.env; return { exitCode: 0 }; } },
    });
    await injected.exec("explicit override", root, { env: { SSH_AUTH_SOCK: "/explicit/agent", PI_DESK_SSH_RUNTIME: router.root }, onData() {} });
    assert.equal(captured.SSH_AUTH_SOCK, "/explicit/agent"); assert.equal(captured.PI_DESK_SSH_RUNTIME, undefined);
    await injected.exec("deliberately isolated", root, { env: {}, onData() {} });
    assert.equal(captured.SSH_AUTH_SOCK, undefined);
  } finally {
    if (oldSocket === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = oldSocket;
    if (oldRuntime === undefined) delete process.env.PI_DESK_SSH_RUNTIME; else process.env.PI_DESK_SSH_RUNTIME = oldRuntime;
    if (previous) globalThis[symbol] = previous; else delete globalThis[symbol];
    legacy.dispose(); await router.close(); rmSync(root, { recursive: true, force: true });
  }
});
