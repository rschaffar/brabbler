import childProcess from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** One transparent native query gate. Caller releases, joins its original work,
 * then restores these process-local adapters before deleting the private root. */
export function createIdentityGate(t, directory, { interceptSync = false, inputFailure, shouldHold = () => true } = {}) {
  const ready = join(directory, "identity-ready"), release = join(directory, "identity-release"), outcome = join(directory, "identity-outcome");
  const script = join(directory, "identity-gate.cjs");
  writeFileSync(script, `const fs=require('node:fs'); const {spawnSync}=require('node:child_process');
const result=spawnSync('git',process.argv.slice(2),{stdio:['ignore','pipe','pipe']});
if(result.stdout) fs.writeSync(1,result.stdout); if(result.stderr) fs.writeSync(2,result.stderr);
fs.writeFileSync(${JSON.stringify(ready)},'ready');
let ended=false;
function finish(reason) { if(ended)return; ended=true;clearInterval(poll);clearTimeout(deadline);
  fs.writeFileSync(${JSON.stringify(outcome)},reason);process.exitCode=reason==='released'?(result.status??1):75; }
const poll=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))finish('released');},5);
const deadline=setTimeout(()=>finish('deadline'),5000);
`);
  const originalAsync = childProcess.execFile, originalSync = childProcess.execFileSync;
  let entered = false, child, nativeClosed, closed = false, asyncMock, syncMock;
  const hold = (file, args) => {
    if (entered || file !== "git" || !Array.isArray(args) || !args.includes("--git-common-dir") || !shouldHold()) return false;
    entered = true; return true;
  };
  const restore = () => { asyncMock?.mock.restore(); syncMock?.mock.restore(); syncBuiltinESMExports(); };
  try {
    asyncMock = t.mock.method(childProcess, "execFile", function(file, args, ...options) {
      if (!hold(file, args)) return originalAsync.call(this, file, args, ...options);
      child = originalAsync.call(this, process.execPath, [script, ...args], ...options);
      nativeClosed = new Promise(resolve => { child.once("close", () => { closed = true; resolve(); }); });
      if (inputFailure) child.stdin.end = () => { throw inputFailure; };
      return child;
    });
    if (interceptSync) syncMock = t.mock.method(childProcess, "execFileSync", function(file, args, ...options) {
      return hold(file, args) ? originalSync.call(this, process.execPath, [script, ...args], ...options)
        : originalSync.call(this, file, args, ...options);
    });
    syncBuiltinESMExports();
  } catch (error) { restore(); throw error; }
  return {
    get child() { return child; },
    async ready() {
      const until = Date.now() + 10000;
      while (!existsSync(ready)) {
        if (Date.now() >= until) throw new Error("Native identity child did not reach its named gate");
        await delay(10);
      }
    },
    outcome: () => existsSync(outcome) ? readFileSync(outcome, "utf8") : undefined,
    release: () => writeFileSync(release, "release"),
    join: () => nativeClosed,
    restore() {
      if (child && !closed) throw new Error("Join the native identity child before restoring its adapter");
      restore();
    },
  };
}
