// Some node-pty macOS archives lack spawn-helper executable bits.
// Keep this idempotent repair scoped to the owned installed helper files.
/* eslint-disable @typescript-eslint/no-require-imports */
const { chmodSync, statSync } = require("node:fs");
const { dirname, join } = require("node:path");

if (process.platform === "darwin") {
  const root = dirname(require.resolve("node-pty/package.json"));
  for (const directory of ["build/Release", "build/Debug", `prebuilds/darwin-${process.arch}`]) {
    const helper = join(root, directory, "spawn-helper");
    const stat = statSync(helper, { throwIfNoEntry: false });
    if (stat?.isFile() && (stat.mode & 0o111) !== 0o111) chmodSync(helper, stat.mode | 0o111);
  }
}
