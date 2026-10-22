import assert from "node:assert/strict";
import test from "node:test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createSshAgentRouter } from "../bin/ssh-agent-router.js";
const execute = promisify(execFile);

test("real OpenSSH agent mutations/signing and destination constraints survive the stable relay", { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "ssh-native-"));
  const systemSocket = join(root, "system.sock"), key = join(root, "key"), hostKey = join(root, "host");
  const environment = { ...process.env, HOME: root, PI_CODING_AGENT_DIR: join(root, "agent"), SSH_AUTH_SOCK: systemSocket, SSH_ASKPASS_REQUIRE: "never" };
  const router = await createSshAgentRouter({ environment, instance: "native:30141", tempDir: root });
  const agent = spawn("ssh-agent", ["-D", "-a", systemSocket], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  let errors = ""; agent.stdout.resume(); agent.stderr.on("data", chunk => { errors += chunk; }); agent.on("error", error => { errors += error.message; });
  const closed = new Promise(resolve => agent.once("close", resolve));
  t.after(async () => { await router.close(); if (agent.exitCode === null && agent.signalCode === null) agent.kill("SIGTERM"); await closed; rmSync(root, { recursive: true, force: true }); });
  for (let i = 0; !existsSync(systemSocket) && i < 100; i++) { if (agent.exitCode !== null) throw new Error(errors); await delay(10); }
  assert.equal(existsSync(systemSocket), true, errors);
  const throughFront = { ...environment, SSH_AUTH_SOCK: router.socketPath };
  const run = (command, args, options = {}) => execute(command, args, { env: throughFront, timeout: 5000, ...options });
  await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", key]);
  await run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", hostKey]);
  await router.rpc({ action: "use", revision: router.status().revision, backend: { type: "inherited" } });
  const stable = router.socketPath;
  await run("ssh-add", [key]);
  const listed = await run("ssh-add", ["-L"]); assert.equal(listed.stdout.trim(), readFileSync(key + ".pub", "utf8").trim());
  const message = join(root, "message"); writeFileSync(message, "synthetic native SSH relay\n");
  renameSync(key, key + ".retained"); // Public filename cannot fall back to this private key.
  await run("ssh-keygen", ["-Y", "sign", "-n", "git", "-f", key + ".pub", message]);
  writeFileSync(join(root, "allowed"), `fixture ${readFileSync(key + ".pub", "utf8")}`);
  const verifier = spawn("ssh-keygen", ["-Y", "verify", "-I", "fixture", "-f", join(root, "allowed"), "-n", "git", "-s", message + ".sig"], { env: throughFront, stdio: ["pipe", "pipe", "pipe"] });
  let verification = ""; verifier.stdout.on("data", chunk => { verification += chunk; }); verifier.stderr.on("data", chunk => { verification += chunk; });
  verifier.stdin.end(readFileSync(message)); const [verified] = await once(verifier, "close"); assert.equal(verified, 0, verification); assert.match(verification, /Good "git" signature/);
  assert.equal(router.socketPath, stable);
  await run("ssh-add", ["-D"]); renameSync(key + ".retained", key);
  const knownHosts = join(root, "known_hosts"); writeFileSync(knownHosts, `host.example ${readFileSync(hostKey + ".pub", "utf8")}`);
  await run("ssh-add", ["-H", knownHosts, "-h", "host.example", key]); renameSync(key, key + ".retained");
  writeFileSync(join(root, "denied"), "synthetic constrained operation\n");
  // No session-bind was established for SSHSIG. The real constrained agent,
  // not the proxy, must refuse. Use a public-key-only filename: no key fallback.
  await assert.rejects(run("ssh-keygen", ["-Y", "sign", "-n", "git", "-f", key + ".pub", join(root, "denied")]), error => /agent|sign|private key|identity/i.test(String(error.stderr)));
  assert.equal(existsSync(join(root, "denied.sig")), false);
});
