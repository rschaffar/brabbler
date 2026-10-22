import { writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** Only native commit enters Node; preflight keeps its original argv/stdin/status.
 * Without an IPC owner (the forwarding fixture tests), commit runs immediately. */
export function writeCommitGate(directory, { gitPath, nodePath, shellPath, marker, socketPath }) {
  const gate = join(directory, "commit-gate.cjs");
  writeFileSync(gate, `const {spawn}=require('node:child_process'); const fs=require('node:fs');
fs.writeFileSync(${JSON.stringify(marker)},'started');
function run(socket) {
  const child=spawn(${JSON.stringify(gitPath)},process.argv.slice(2),{stdio:'inherit'});
  child.on('error',error=>{process.stderr.write(String(error)+'\\n');});
  child.on('close',(code,signal)=>{
    process.exitCode=code ?? 1;
    if(socket) socket.end(JSON.stringify({event:'closed',code,signal})+'\\n');
  });
}
const address=${JSON.stringify(socketPath ?? null)};
if(!address) run();
else {
  const socket=require('node:net').createConnection(address); let released=false, input='';
  socket.on('error',error=>{process.stderr.write(String(error)+'\\n');process.exitCode=1;socket.destroy();});
  socket.on('connect',()=>socket.write('ready\\n'));
  socket.on('data',chunk=>{
    input+=chunk.toString();
    if(!released && input.includes('release\\n')) { released=true;run(socket); }
  });
  socket.on('end',()=>{if(!released) {process.exitCode=1;socket.destroy();}});
}
`);
  const shim = join(directory, "git");
  writeFileSync(shim, `#!${shellPath}
for arg do
  if [ "$arg" = commit ]; then
    exec ${quote(nodePath)} ${quote(gate)} "$@"
  fi
done
exec ${quote(gitPath)} "$@"
`, { mode: 0o700 });
  return shim;
}

/** One owned native invocation: ready -> explicit release -> actual Git child close.
 * The executor's full promise must ALSO be joined: it observes shim close and reporting. */
export async function createCommitGate(directory, options) {
  const socketPath = join(directory, "control.sock");
  let resolveReady, rejectReady, resolveClosed, rejectClosed;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const closed = new Promise((resolve, reject) => { resolveClosed = resolve; rejectClosed = reject; });
  // Observe early failures even while the test is awaiting the other channel.
  ready.catch(() => {}); closed.catch(() => {});
  let released = false, entered = false, observedClose = false;
  const sockets = new Set();
  const timer = setTimeout(() => rejectReady(new Error("Native commit did not enter the IPC gate")), 10000);
  const server = createServer((socket) => {
    if (entered || sockets.size) { socket.destroy(); rejectReady(new Error("Unexpected second commit gate connection")); return; }
    sockets.add(socket); let input = "";
    socket.on("data", (chunk) => {
      input += chunk.toString();
      let end;
      while ((end = input.indexOf("\n")) !== -1) {
        const line = input.slice(0, end); input = input.slice(end + 1);
        if (line === "ready") {
          entered = true; clearTimeout(timer); resolveReady();
          if (released) socket.write("release\n");
        } else {
          try {
            const message = JSON.parse(line);
            if (message.event !== "closed" || !entered || !released) throw new Error("Out-of-order native close notification");
            observedClose = true; resolveClosed({ code: message.code, signal: message.signal }); socket.end();
          } catch (error) { rejectClosed(error); socket.destroy(); }
        }
      }
    });
    socket.on("error", (error) => { rejectReady(error); rejectClosed(error); });
    socket.on("close", () => {
      sockets.delete(socket);
      if (!observedClose) { const error = new Error("Commit gate disconnected without actual child close"); rejectReady(error); rejectClosed(error); }
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(socketPath, resolve); });
    writeCommitGate(directory, { ...options, socketPath });
  } catch (error) {
    clearTimeout(timer);
    if (server.listening) {
      const cleanupError = await new Promise((resolve) => server.close(resolve));
      if (cleanupError) throw new AggregateError([error, cleanupError], "Commit gate setup and close failed");
    }
    throw error;
  }
  return {
    ready, closed,
    release() {
      if (released) return;
      released = true;
      if (entered) for (const socket of sockets) socket.write("release\n");
    },
    async close() {
      // Call only after release + the executor join; never fabricate a close event.
      clearTimeout(timer);
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}
