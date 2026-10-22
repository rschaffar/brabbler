// Fixture-only support for browser-ssh-suite.mjs. No production hooks.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export const SSH_PROVIDER = "e2e-managed-ssh";
export const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";

// Same native faux-provider/real SDK tool pattern as native-tools.mjs and
// session-launch.mjs. Only provider responses are synthetic, never Bash or SSH.
export function seedSshRuntimeFixtures({ root, agentDir, project }) {
  const helper = join(project, "ssh-consumer.mjs");
  writeFileSync(helper, `import {spawn} from "node:child_process";
import {readFileSync,writeFileSync,renameSync,existsSync} from "node:fs";
const job=JSON.parse(readFileSync(process.argv[2],"utf8"));
const save=(path,value)=>{writeFileSync(path+".tmp",JSON.stringify(value));renameSync(path+".tmp",path)};
const run=(command,args,input)=>new Promise((resolve,reject)=>{
 const child=spawn(command,args,{stdio:["pipe","pipe","pipe"]});
 let stdout="",stderr="",cancelTimer;
 child.once("close",()=>clearInterval(cancelTimer));
 child.stdout.on("data",chunk=>stdout+=chunk);child.stderr.on("data",chunk=>stderr+=chunk);
 child.once("error",reject);child.once("close",(code,signal)=>resolve({code,signal,stdout,stderr}));
 child.stdin.on("error",error=>{if(error.code!=="EPIPE")reject(error)});child.stdin.end(input);
 if(command==="ssh-keygen"&&args[1]==="sign") {
  save(job.started,{pid:process.pid,signPid:child.pid,socket:process.env.SSH_AUTH_SOCK,passwordPresent:Object.hasOwn(process.env,"PI_WEB_PASSWORD"),controlPresent:Object.hasOwn(process.env,"PI_DESK_SSH_RUNTIME")});
  // The helper signals its own ChildProcess; the browser driver never acts on
  // a detached numeric PID that could have exited or been reused.
  cancelTimer=setInterval(()=>{if(existsSync(job.cancelFile)){clearInterval(cancelTimer);child.kill("SIGKILL")}},25);cancelTimer.unref();
 }
});
try {
 if(job.operation==="list") {
  const result=await run("ssh-add",["-L"]);
  save(job.report,{...result,socket:process.env.SSH_AUTH_SOCK});
 } else {
  const result=await run("ssh-keygen",["-Y","sign","-n","git","-f",job.publicFile,job.messageFile]);
  const verified=result.code===0?await run("ssh-keygen",["-Y","verify","-I","fixture","-f",job.allowedFile,"-n","git","-s",job.messageFile+".sig"],readFileSync(job.messageFile)):null;
  save(job.report,{...result,verified,socket:process.env.SSH_AUTH_SOCK});
 }
} catch(error) { save(job.report,{error:String(error.stack??error),socket:process.env.SSH_AUTH_SOCK});process.exitCode=1 }
`);
  const shell = join(project, "ssh-consumer.sh");
  // This variant deliberately starts another shell child, with no SSH_AUTH_SOCK
  // assignment anywhere. Node and OpenSSH inherit only what the launcher gave SDK/PTY.
  writeFileSync(shell, `#!/usr/bin/env bash\nset -eu\nexec ${shellQuote(process.execPath)} ${shellQuote(helper)} "$1"\n`);
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(join(agentDir, "extensions/e2e-managed-ssh.js"), `import {fauxProvider,fauxAssistantMessage,fauxToolCall} from ${JSON.stringify(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js"))};
export default function(pi) {
 const faux=fauxProvider({provider:${JSON.stringify(SSH_PROVIDER)},api:${JSON.stringify(SSH_PROVIDER)}});pi.registerProvider(faux.provider);
 pi.on("before_agent_start",(event,ctx)=>{
  if(ctx.model?.provider!==${JSON.stringify(SSH_PROVIDER)})return;
  const job=JSON.parse(event.prompt);
  faux.setResponses([fauxAssistantMessage([fauxToolCall("bash",{command:job.command},{id:job.id})],{stopReason:"toolUse"}),fauxAssistantMessage("SSH consumer completed "+job.id)]);
 });
}`);
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({
    defaultProvider: SSH_PROVIDER, defaultModel: "faux-1", defaultThinkingLevel: "off",
    enabledModels: [`${SSH_PROVIDER}/**`], defaultTools: ["bash"],
    cacheWarming: "off", retry: { enabled: false }, enableInstallTelemetry: false,
  }));
  let sequence = 0;
  return {
    job(label, key, operation = "sign") {
      const id = `${label}-${++sequence}`;
      const prefix = join(project, id), file = prefix + ".json";
      const data = { operation, report: prefix + ".result", started: prefix + ".started", cancelFile: prefix + ".cancel" };
      if (key) {
        Object.assign(data, { publicFile: prefix + ".pub", allowedFile: prefix + ".allowed", messageFile: prefix + ".message" });
        writeFileSync(data.publicFile, key.publicKey + "\n");
        writeFileSync(data.allowedFile, `fixture ${key.publicKey}\n`);
        writeFileSync(data.messageFile, `Managed SSH fixture ${id}\n`);
        // There is deliberately no private-key file beside the public key.
      }
      writeFileSync(file, JSON.stringify(data));
      return { ...data, id, command: `bash ${shellQuote(shell)} ${shellQuote(file)}` };
    },
  };
}

// Existing browser deadline, monotonic; reads only fixture-owned output. Errors
// propagate; malformed/partial JSON cannot be silently retried (writers rename).
export async function waitForSshReport(path) {
  const deadline = performance.now() + 30_000;
  while (!existsSync(path)) {
    assert.ok(performance.now() < deadline, `Timed out waiting for ${path}`);
    await delay(100);
  }
  const report = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(report.error, undefined, report.error);
  return report;
}

// Observes real WebAuthn calls and always delegates to Chromium. One optional
// fixture-only gate delays a real status JSON read after native parsing (same
// response/data/errors), without changing any production hook or server TTL.
// Never synthesize assertions, change policy, fulfill failures, skip UV or retry.
export function observeSshCeremonies() {
  window.__sshCeremonies = [];
  window.__sshFetches = [];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    let entry;
    if (typeof input === "string" && new URL(input, location.href).pathname === "/api/ssh-agent" && options?.method === "POST") {
      const body = JSON.parse(options.body);
      entry = { action: body.action, settings: Boolean(document.querySelector('[role="dialog"][aria-label="Settings"]')), aborted: false, reason: null, settled: false };
      window.__sshFetches.push(entry);
      const aborted = () => { entry.aborted = true; entry.reason = String(options.signal.reason); };
      if (options.signal?.aborted) aborted();
      else options.signal?.addEventListener("abort", aborted, { once: true });
    }
    try {
      const response = await nativeFetch(input, options);
      if (entry?.action === "status" && entry.settings && response.ok && window.__sshHoldNextStatusRead) {
        window.__sshHoldNextStatusRead = false;
        const nativeJson = response.json.bind(response);
        response.json = async () => {
          const value = await nativeJson();
          window.__sshStatusHeld = true;
          await new Promise(resolve => { window.__sshReleaseStatusRead = resolve; });
          window.__sshStatusReadReleased = true;
          return value;
        };
      }
      return response;
    } finally { if (entry) entry.settled = true; }
  };
  const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  // Init scripts also run in the initial opaque about:blank document. It has
  // no CredentialsContainer; the real secure navigation reruns this observer.
  if (!navigator.credentials) return;
  for (const method of ["create", "get"]) {
    const native = navigator.credentials[method].bind(navigator.credentials);
    navigator.credentials[method] = async options => {
      const entry = { method, challenge: encode(options.publicKey.challenge), uv: options.publicKey.userVerification ?? options.publicKey.authenticatorSelection?.userVerification, aborted: false, completed: false };
      window.__sshCeremonies.push(entry);
      options.signal?.addEventListener("abort", () => { entry.aborted = true; }, { once: true });
      const result = await native(options);
      entry.completed = true;
      return result;
    };
  }
}
