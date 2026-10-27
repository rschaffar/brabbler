import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import patcher from "../bin/patch-sdk-command-env.js";
const applicationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Actual installed SDK execution is isolated in a process with an explicit,
// synthetic server environment. No parent globals, Node builtins, account files,
// hardware, real SSH socket or application/provider server are touched.
const workerSource = String.raw`
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
const [root, sdkRoot] = process.argv.slice(2);
const load = relative => import(pathToFileURL(join(sdkRoot, relative)).href);
const sdk = await load("dist/index.js");
const { loadExtensionFromFactory } = await load("dist/core/extensions/loader.js");
const config = await load("dist/core/resolve-config-value.js");
const shared = await load("dist/core/tools/bash.js");
const { spawnProcess, spawnProcessSync } = await load("dist/utils/child-process.js");
const report = {};
const probe = join(root, "probe.cjs");
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const command = quote(process.execPath) + " " + quote(probe);
const parse = value => JSON.parse(value.trim());
const clean = (value, socket = "/synthetic/stable.sock", account = "account-a") => {
  assert.equal(value.password, false); assert.equal(value.control, false);
  assert.equal(value.socket, socket); assert.equal(value.account, account);
};
let execOutput;
await loadExtensionFromFactory(async pi => {
  execOutput = await pi.exec(process.execPath, [probe], { cwd: root, timeout: 3000 });
}, root, sdk.createEventBus(), sdk.createExtensionRuntime());
assert.equal(execOutput.code, 0); report.extension = parse(execOutput.stdout); clean(report.extension);
report.configCached = parse(config.resolveConfigValue("!" + command)); clean(report.configCached);
report.configUncached = parse(config.resolveConfigValueUncached("!" + command)); clean(report.configUncached);
assert.equal(config.resolveConfigValue("$ACCOUNT_CONFIG", { ACCOUNT_CONFIG: "account-b-config" }), "account-b-config");

const context = { cwd: root, model: { provider: "synthetic-provider", id: "synthetic-model" }, thinkingLevel: "high",
  sessionManager: { getSessionId: () => "session-a", getSessionFile: () => join(root, "synthetic-session.jsonl") } };
const definition = sdk.createBashToolDefinition(root);
const toolResult = await definition.execute("sdk-env", { command }, undefined, undefined, context);
report.bash = parse(toolResult.structuredContent.output); clean(report.bash);
assert.equal(report.bash.session, "session-a"); assert.equal(report.bash.sessionFile, join(root, "synthetic-session.jsonl")); assert.equal(report.bash.model, "synthetic-model");
assert.equal(report.bash.provider, "synthetic-provider"); assert.equal(report.bash.reasoning, "high");

const local = shared.createLocalShellOperations("synthetic-shared-executor", () => ({ shell: process.execPath, args: [probe] }));
async function runLocal(env) {
  const chunks = []; const output = await local.exec("synthetic-command", root, { onData: bytes => chunks.push(bytes), env });
  assert.equal(output.exitCode, 0); return parse(Buffer.concat(chunks).toString());
}
report.isolated = await runLocal({});
assert.equal(report.isolated.password, false); assert.equal(report.isolated.control, false);
assert.equal(report.isolated.socket, undefined); assert.equal(report.isolated.account, undefined);
const explicit = { BRABBLER_PASSWORD: "explicit-private", BRABBLER_SSH_RUNTIME: "explicit-private",
  SSH_AUTH_SOCK: "/synthetic/explicit.sock", AWS_PROFILE: "account-b", PI_SESSION_ID: "session-b" };
report.explicit = await runLocal(explicit); clean(report.explicit, explicit.SSH_AUTH_SOCK, "account-b");
assert.equal(report.explicit.session, "session-b"); assert.equal(explicit.BRABBLER_PASSWORD, "explicit-private");

// Execute the real, unchanged PowerShell factory, substituting ONLY its shell
// resolver in a private data-module. The real shared SDK executor starts Node as
// a harmless stand-in; no PowerShell installation or Windows hardware required.
// This proves prefix/metadata/environment transport, not native PowerShell syntax.
let powerSource = await readFile(join(sdkRoot, "dist/core/tools/powershell.js"), "utf8");
const resolver = "data:text/javascript;base64," + Buffer.from(
  "export const getPowerShellConfig = () => (" + JSON.stringify({ shell: process.execPath, args: [probe] }) + ");"
).toString("base64");
assert.equal(powerSource.split('from "../../utils/shell.js"').length, 2);
assert.equal(powerSource.split('from "./bash.js"').length, 2);
assert.equal(powerSource.split('from "./tool-definition-wrapper.js"').length, 2);
powerSource = powerSource.replace('from "../../utils/shell.js"', 'from ' + JSON.stringify(resolver))
  .replace('from "./bash.js"', 'from ' + JSON.stringify(pathToFileURL(join(sdkRoot, "dist/core/tools/bash.js")).href))
  .replace('from "./tool-definition-wrapper.js"', 'from ' + JSON.stringify(pathToFileURL(join(sdkRoot, "dist/core/tools/tool-definition-wrapper.js")).href));
const powershell = await import("data:text/javascript;base64," + Buffer.from(powerSource).toString("base64"));
const powerDefinition = powershell.createPowerShellToolDefinition(root);
const powerResult = await powerDefinition.execute("sdk-env-pwsh", { command: "synthetic-powershell-command" }, undefined, undefined, context);
report.powershell = parse(powerResult.structuredContent.output); clean(report.powershell);
assert.equal(report.powershell.session, "session-a");
assert.match(report.powershell.command, /^try \{ \[Console\]::OutputEncoding=\[System\.Text\.Encoding\]::UTF8 \} catch \{\}\nsynthetic-powershell-command$/);

const manager = new sdk.DefaultPackageManager({ cwd: root, agentDir: join(root, "agent"), settingsManager: sdk.SettingsManager.inMemory() });
report.packageCapture = parse(await manager.runCommandCapture(process.execPath, [probe], { cwd: root, env: explicit }));
clean(report.packageCapture, explicit.SSH_AUTH_SOCK, "account-b");
report.packageSync = parse(manager.runCommandSync(process.execPath, [probe])); clean(report.packageSync);
const isolatedChild = spawnProcess(process.execPath, [probe], { cwd: root, env: {}, stdio: ["ignore", "pipe", "pipe"] });
let isolatedText = ""; isolatedChild.stdout.on("data", bytes => { isolatedText += bytes; });
const [isolatedCode] = await once(isolatedChild, "close"); assert.equal(isolatedCode, 0);
assert.equal(parse(isolatedText).socket, undefined);
const sync = spawnProcessSync(process.execPath, [probe], { env: explicit, encoding: "utf8" });
assert.equal(sync.status, 0); clean(parse(sync.stdout), explicit.SSH_AUTH_SOCK, "account-b");

const grep = await sdk.createGrepToolDefinition(root).execute("sdk-env-grep", { pattern: "needle", path: root }, undefined, undefined, context);
assert.match(grep.content[0].text, /needle/);
const find = await sdk.createFindToolDefinition(root).execute("sdk-env-find", { pattern: "*.txt", path: root }, undefined, undefined, context);
assert.match(find.content[0].text, /note\.txt/);
const { FooterDataProvider } = await load("dist/core/footer-data-provider.js");
await mkdir(join(root, ".git")); await writeFile(join(root, ".git/HEAD"), "ref: refs/heads/.invalid\n");
const footer = new FooterDataProvider(root);
try { assert.equal(footer.getGitBranch(), "synthetic-branch"); assert.equal(await footer.resolveGitBranchAsync(), "synthetic-branch"); }
finally { footer.dispose(); }

async function readPublished(name) {
  const deadline = Date.now() + 3000;
  while (true) {
    try { return JSON.parse(await readFile(join(root, name), "utf8")); }
    catch (error) {
      if (error.code !== "ENOENT" || Date.now() >= deadline) throw error;
      await delay(5);
    }
  }
}
// Both reader and writer routes of the actual clipboard subprocess helper.
// copyToClipboard selects the private wl-copy executable on the Linux Nix target;
// no native clipboard, display server, device or terminal escape path is used.
const { runClipboardCommand } = await load("dist/utils/clipboard-command.js");
report.clipboardRead = parse((await runClipboardCommand(process.execPath, [probe])).toString());
clean(report.clipboardRead);
await sdk.copyToClipboard("synthetic clipboard text ✓");
report.clipboardWrite = await readPublished("clipboard-write.json"); clean(report.clipboardWrite);
assert.equal(report.clipboardWrite.input, "synthetic clipboard text ✓");

// openBrowser's actual command selection/spawn is exercised, but every possible
// platform opener name in this fixture points at a short-lived Node recorder.
const { openBrowser } = await load("dist/utils/open-browser.js");
openBrowser("synthetic-browser-target");
report.browser = await readPublished("browser-exit.json"); clean(report.browser);
assert.deepEqual(report.browser.args, ["synthetic-browser-target"]);
assert.ok(Number.isSafeInteger(report.browser.pid) && report.browser.pid > 0 && report.browser.pid !== process.pid);
const browserDeadline = Date.now() + 3000;
while (true) {
  try { process.kill(report.browser.pid, 0); }
  catch (error) { if (error.code === "ESRCH") break; throw error; }
  assert.ok(Date.now() < browserDeadline, "synthetic browser recorder must settle");
  await delay(5);
}

// RpcClient is the actual exported SDK class. Only its "node" executable is
// replaced by a private recorder that consumes no RPC and starts no RPC server.
// Install this shim late so unrelated SDK startup cannot select it accidentally.
await rename(join(root, "rpc-node-shim"), join(root, "shims/node"));
const rpcOptions = { cwd: root, cliPath: join(root, "nonexistent-rpc-server.cjs"), env: { ...explicit } };
const client = new sdk.RpcClient(rpcOptions);
try {
  await client.start();
  report.rpc = await readPublished("rpc-launch.json"); clean(report.rpc, explicit.SSH_AUTH_SOCK, "account-b");
  assert.equal(report.rpc.session, "session-b");
  assert.deepEqual(report.rpc.args, [rpcOptions.cliPath, "--mode", "rpc"]);
  assert.equal(rpcOptions.env.BRABBLER_PASSWORD, "explicit-private", "RPC filtering must not mutate supplied account/env objects");
} finally {
  const transport = client.process;
  const closed = transport && transport.exitCode === null && transport.signalCode === null ? once(transport, "close") : undefined;
  await client.stop();
  if (closed) await closed;
}
const records = (await readFile(join(root, "helper-records.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
for (const record of records) clean(record);
for (const name of ["rg", "fd", "git"]) assert.ok(records.some(record => record.name === name), name);
assert.ok(records.some(record => record.name === "rg" && record.version));
assert.ok(records.some(record => record.name === "fd" && record.version));
assert.equal(records.filter(record => record.name === "git").length, 2);
// Final parent still owns the synthetic server-only variables, unlike commands.
assert.equal(process.env.BRABBLER_PASSWORD, "synthetic-server-login");
assert.equal(process.env.BRABBLER_SSH_RUNTIME, "/synthetic/private-control");
assert.equal(process.env.AWS_PROFILE, "account-a");
report.helperNames = records.map(record => record.name);
process.stdout.write(JSON.stringify(report));
`;
const observation = `({password:Object.hasOwn(process.env,"BRABBLER_PASSWORD"),control:Object.hasOwn(process.env,"BRABBLER_SSH_RUNTIME"),socket:process.env.SSH_AUTH_SOCK,account:process.env.AWS_PROFILE,session:process.env.PI_SESSION_ID,sessionFile:process.env.PI_SESSION_FILE,model:process.env.PI_MODEL,provider:process.env.PI_PROVIDER,reasoning:process.env.PI_REASONING_LEVEL,command:process.argv.at(-1)})`;

test("real modular SDK commands filter private server env but preserve socket, explicit isolation, accounts and session metadata", { timeout: 20000 }, async t => {
  // Refuse unpatched dependencies; this regression is for the integrated Nix
  // modules output, never a reason to modify live node_modules from a test.
  patcher.checkSdkCommandEnvironment(applicationRoot);
  const sdkRoot = patcher.resolveInstalledSdkRoot(applicationRoot);
  const root = await mkdtemp(join(tmpdir(), "sdk-env-runtime-"));
  let child, done, exited = false;
  t.after(async () => {
    if (child && !exited) child.kill("SIGKILL");
    if (done) await done;
    await rm(root, { recursive: true, force: true });
  });
  for (const folder of ["home", "agent", "shims", "tmp", "xdg"]) await mkdir(join(root, folder));
  await writeFile(join(root, "note.txt"), "needle\n");
  await writeFile(join(root, "probe.cjs"), `process.stdout.write(JSON.stringify(${observation}));\n`);
  for (const name of ["rg", "fd", "git"]) {
    const shim = `#!${process.execPath}\nconst fs=require("node:fs");const record={...${observation},name:${JSON.stringify(name)},version:process.argv.includes("--version")};fs.appendFileSync(${JSON.stringify(join(root, "helper-records.jsonl"))},JSON.stringify(record)+"\\n");\n`
      + `if(record.version) console.log(${JSON.stringify(name + " synthetic 1.0")});\n`
      + (name === "rg" ? `else console.log(JSON.stringify({type:"match",data:{path:{text:${JSON.stringify(join(root, "note.txt"))}},line_number:1,lines:{text:"needle\\n"}}}));\n`
        : name === "fd" ? `else console.log("note.txt");\n` : `else console.log("synthetic-branch");\n`);
    await writeFile(join(root, "shims", name), shim, { mode: 0o755 });
  }
  const recorder = (name, body) => `#!${process.execPath}\nconst fs=require("node:fs");const file=${JSON.stringify(join(root, name))};const record=${observation};const publish=value=>{fs.writeFileSync(file+".tmp",JSON.stringify(value));fs.renameSync(file+".tmp",file);};\n${body}\n`;
  const browserRecorder = recorder("browser-exit.json", 'process.on("exit",()=>publish({...record,pid:process.pid,args:process.argv.slice(2)}));');
  for (const opener of ["xdg-open", "open", "rundll32"]) await writeFile(join(root, "shims", opener), browserRecorder, { mode: 0o755 });
  await writeFile(join(root, "shims/wl-copy"), recorder("clipboard-write.json", 'let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",chunk=>{input+=chunk;});process.stdin.on("end",()=>publish({...record,input}));'), { mode: 0o755 });
  await writeFile(join(root, "rpc-node-shim"), recorder("rpc-launch.json", 'publish({...record,args:process.argv.slice(2)});process.stdin.resume();'), { mode: 0o755 });
  const worker = join(root, "worker.mjs"); await writeFile(worker, workerSource);
  child = spawn(process.execPath, [worker, root, sdkRoot], {
    cwd: root, stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: join(root, "shims") + ":" + process.env.PATH, HOME: join(root, "home"), TMPDIR: join(root, "tmp"), XDG_CONFIG_HOME: join(root, "xdg"),
      PI_CODING_AGENT_DIR: join(root, "agent"), PI_OFFLINE: "1", PI_TELEMETRY: "0", LANG: "C.UTF-8", WAYLAND_DISPLAY: "synthetic-no-display-connection",
      BRABBLER_PASSWORD: "synthetic-server-login", BRABBLER_SSH_RUNTIME: "/synthetic/private-control",
      SSH_AUTH_SOCK: "/synthetic/stable.sock", AWS_PROFILE: "account-a", ACCOUNT_CONFIG: "ambient-account-config" },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
  done = once(child, "close").then(result => { exited = true; return result; });
  const [code] = await done;
  assert.equal(code, 0, stderr);
  const report = JSON.parse(stdout);
  assert.equal(report.extension.password, false); assert.equal(report.configUncached.control, false);
  assert.equal(report.bash.session, "session-a"); assert.equal(report.explicit.account, "account-b");
  assert.ok(report.helperNames.includes("git"));
  assert.equal(report.clipboardWrite.input, "synthetic clipboard text ✓");
  assert.equal(report.browser.socket, "/synthetic/stable.sock");
  assert.equal(report.rpc.account, "account-b");
});

test("each configured/default shell, extraction fallback, cleanup and exported-helper spawn has a final SDK filter", async () => {
  const sdkRoot = patcher.resolveInstalledSdkRoot(applicationRoot);
  patcher.checkSdkRoot(sdkRoot);
  // Exact fingerprints plus explicit branch markers protect unexercisable native
  // Windows/extraction fallbacks without downloading tools or invoking taskkill.
  const shell = await readFile(join(sdkRoot, "dist/utils/shell.js"), "utf8");
  assert.equal((shell.match(/env: sdkCommandEnvironment\(\)/g) || []).length, 3);
  const resolver = await readFile(join(sdkRoot, "dist/core/resolve-config-value.js"), "utf8");
  assert.equal((resolver.match(/env: sdkCommandEnvironment\(\)/g) || []).length, 2);
  const tools = await readFile(join(sdkRoot, "dist/utils/tools-manager.js"), "utf8");
  assert.match(tools, /function runExtractionCommand[\s\S]*?spawnSync\(command, args, \{ env: sdkCommandEnvironment\(\)/);
  const clipboard = await readFile(join(sdkRoot, "dist/utils/clipboard-command.js"), "utf8");
  assert.match(clipboard, /spawn\(command, args, \{\s*env: sdkCommandEnvironment\(\)/);
  const browser = await readFile(join(sdkRoot, "dist/utils/open-browser.js"), "utf8");
  assert.match(browser, /spawn\(cmd, args, \{ env: sdkCommandEnvironment\(\), stdio: "ignore", detached: true \}/);
  assert.match(browser, /\.on\("error", \(\) => \{ \}\)\s*\.unref\(\)/);
  const rpc = await readFile(join(sdkRoot, "dist/modes/rpc/rpc-client.js"), "utf8");
  assert.match(rpc, /env: sdkCommandEnvironment\(\{ \.\.\.process\.env, \.\.\.this\.options\.env \}\)/);
});
