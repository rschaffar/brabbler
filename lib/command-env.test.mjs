import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { commandEnvironment } from "../bin/command-env.js";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { gitExecEnv } = await jiti.import("./git-exec.ts");
const { run } = await jiti.import("../plugins/git-workflow/process.ts");

test("command hygiene removes only server metadata without changing scoped credentials or socket overrides", () => {
  const original = Object.freeze({ BRABBLER_PASSWORD: "synthetic-server-login", BRABBLER_SSH_RUNTIME: "/synthetic/private/control.json", SSH_AUTH_SOCK: "/synthetic/front.sock", PROVIDER_API_KEY: "synthetic-account-binding", NODE_ENV: "production", PORT: "1234" });
  const env = commandEnvironment(original, "linux");
  assert.deepEqual(env, { SSH_AUTH_SOCK: original.SSH_AUTH_SOCK, PROVIDER_API_KEY: original.PROVIDER_API_KEY, NODE_ENV: "production", PORT: "1234" });
  assert.ok(original.BRABBLER_PASSWORD); assert.ok(original.BRABBLER_SSH_RUNTIME);
  assert.deepEqual(commandEnvironment({}, "linux"), {}, "explicit isolation must never acquire ambient variables");
  assert.equal(commandEnvironment({ SSH_AUTH_SOCK: "/explicit/override" }).SSH_AUTH_SOCK, "/explicit/override");
});

test("Git and plugin checks retain stable SSH while excluding private server fields", async t => {
  const keys = ["BRABBLER_PASSWORD", "BRABBLER_SSH_RUNTIME", "SSH_AUTH_SOCK", "PROVIDER_API_KEY"];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { BRABBLER_PASSWORD: "synthetic-server-login", BRABBLER_SSH_RUNTIME: "/synthetic/private/control.json", SSH_AUTH_SOCK: "/synthetic/front.sock", PROVIDER_API_KEY: "synthetic-account-binding" });
  t.after(() => { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
  const env = gitExecEnv(undefined, { ...process.env, GIT_DIR: "/wrong/repository" });
  assert.equal(env.BRABBLER_PASSWORD, undefined); assert.equal(env.BRABBLER_SSH_RUNTIME, undefined); assert.equal(env.GIT_DIR, undefined); assert.equal(env.SSH_AUTH_SOCK, "/synthetic/front.sock");
  const output = await run(process.execPath, ["-e", 'console.log(JSON.stringify({password:Object.hasOwn(process.env,"BRABBLER_PASSWORD"),control:Object.hasOwn(process.env,"BRABBLER_SSH_RUNTIME"),socket:process.env.SSH_AUTH_SOCK,account:process.env.PROVIDER_API_KEY}))'], process.cwd());
  assert.deepEqual(JSON.parse(output), { password: false, control: false, socket: "/synthetic/front.sock", account: "synthetic-account-binding" });
});

test("Windows private names are case-insensitive without rewriting public socket identity", () => {
  assert.deepEqual(commandEnvironment({ Brabbler_Password: "synthetic", BrAbBlEr_Ssh_Runtime: "private", sSh_Auth_Sock: "public", Path: "preserved" }, "win32"), { sSh_Auth_Sock: "public", Path: "preserved" });
});

test("a real inheriting helper sees the public socket and scoped account, not server fields", () => {
  const env = commandEnvironment({ BRABBLER_PASSWORD: "synthetic-server-login", BRABBLER_SSH_RUNTIME: "/synthetic/private/control.json", SSH_AUTH_SOCK: "/synthetic/front.sock", PROVIDER_API_KEY: "synthetic-account-binding" });
  const output = execFileSync(process.execPath, ["-e", 'console.log(JSON.stringify({password:Object.hasOwn(process.env,"BRABBLER_PASSWORD"),control:Object.hasOwn(process.env,"BRABBLER_SSH_RUNTIME"),socket:process.env.SSH_AUTH_SOCK,account:process.env.PROVIDER_API_KEY}))'], { env, encoding: "utf8" });
  assert.deepEqual(JSON.parse(output), { password: false, control: false, socket: "/synthetic/front.sock", account: "synthetic-account-binding" });
});
