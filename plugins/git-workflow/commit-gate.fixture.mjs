import { writeFileSync } from "node:fs";
import { join } from "node:path";

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

/** Only the synthetic native commit gate needs Node; forward preflight Git directly. */
export function writeCommitGate(directory, { gitPath, nodePath, shellPath, marker }) {
  const gate = join(directory, "commit-gate.cjs");
  writeFileSync(gate, `const {spawnSync}=require('node:child_process'); const fs=require('node:fs');
fs.writeFileSync(${JSON.stringify(marker)},'started');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
const result=spawnSync(${JSON.stringify(gitPath)},process.argv.slice(2),{stdio:'inherit'});
process.exit(result.status ?? 1);\n`);
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
