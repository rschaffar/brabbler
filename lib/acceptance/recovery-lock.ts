import { spawn } from "node:child_process";
import type { ProcessIdentity } from "./process";

export interface RecoveryRequest {
  token: string;
  process: ProcessIdentity;
  expectedLedgerDigest: string | null;
  ledger: string;
}
/** The process holding the kernel lock performs ALL ownership/ledger mutations.
 * Losing it cannot leave an unlocked parent callback continuing the critical section.
 * This is literal host code; JSON stdin is data, never a user-supplied program. */
export const recoveryScript = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=process.argv[1], ownerFile=path.join(root,'controller.json'), ledgerFile=path.join(root,'runs.json');
function bytes(file){try{const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const s=fs.fstatSync(fd);if(!s.isFile()||s.size>16*1024*1024)throw Error('Invalid recovery state');return fs.readFileSync(fd,'utf8');}finally{fs.closeSync(fd);}}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function alive(p){if(!p||!Number.isSafeInteger(p.pid)||p.pid<1||typeof p.start!=='string')throw Error('Invalid recovery owner');try{const raw=fs.readFileSync('/proc/'+p.pid+'/stat','utf8');const fields=raw.slice(raw.lastIndexOf(')')+2).trim().split(/\s+/);return fields[19]===p.start&&fields[0]!=='Z';}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return false;throw e;}}
function hash(value){return value===null?null:crypto.createHash('sha256').update(value).digest('hex');}
function sync(){const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function atomic(file,value){const temp=path.join(root,'.recovery-'+crypto.randomUUID());try{fs.writeFileSync(temp,value,{flag:'wx',mode:0o600,flush:true});fs.renameSync(temp,file);sync();}finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}}
try{
 const input=fs.readFileSync(0,'utf8');if(Buffer.byteLength(input)>40*1024*1024)throw Error('Recovery input limit exceeded');
 const request=JSON.parse(input);if(typeof request.token!=='string'||!alive(request.process)||typeof request.ledger!=='string'||Buffer.byteLength(request.ledger)>16*1024*1024)throw Error('Invalid recovery request');
 const next=JSON.parse(request.ledger);if(next.version!==1||!Array.isArray(next.runs)||next.runs.length>1000)throw Error('Invalid recovery ledger');
 const currentBytes=bytes(ownerFile),current=currentBytes===null?null:JSON.parse(currentBytes);
 if(current&&current.token!==request.token&&alive(current.process))throw Error('Another coordinator process is still alive; recovery refused');
 if(hash(bytes(ledgerFile))!==request.expectedLedgerDigest)throw Error('Acceptance ledger changed during recovery; inspect and propose again');
 const owner=JSON.stringify({token:request.token,process:request.process});
 if(current===null){fs.writeFileSync(ownerFile,owner,{flag:'wx',mode:0o600,flush:true});sync();}
 else atomic(ownerFile,owner);
 // Recovery owner is durable. No process is dispatched, even after an interrupted recovery.
 atomic(ledgerFile,request.ledger);
 process.stdout.write(JSON.stringify({token:request.token}));
}catch(error){process.stderr.write(String(error));process.exitCode=1;}
`;

export async function recoverAcceptanceState(root: string, request: RecoveryRequest): Promise<void> {
  const child = spawn("flock", ["--exclusive", "--nonblock", "--no-fork", root + "/recovery.flock", process.execPath, "-e", recoveryScript, root],
    { stdio: ["pipe", "pipe", "pipe"], env: { PATH: process.env.PATH, NODE_ENV: "test", LANG: "C.UTF-8" } });
  let output = "", diagnostic = "";
  child.stdout.on("data", (data: Buffer) => { if (output.length < 4096) output += data.toString("utf8"); });
  child.stderr.on("data", (data: Buffer) => { if (diagnostic.length < 4096) diagnostic += data.toString("utf8"); });
  child.stdin.on("error", () => undefined); // EPIPE is reflected by the exit verdict.
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) { reject(new Error("Acceptance recovery refused/interrupted: " + diagnostic.slice(0, 4096))); return; }
      try {
        if (JSON.parse(output).token !== request.token) throw new Error("Recovery owner acknowledgement mismatch");
        resolve();
      } catch (error) { reject(error); }
    });
  });
  child.stdin.end(JSON.stringify(request));
  await closed;
}
