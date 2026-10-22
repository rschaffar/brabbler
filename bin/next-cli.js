"use strict";

// Supported npm serve commands must install the same guard as the packaged
// launcher, before loading Next. Its dev supervisor reconstructs worker
// NODE_OPTIONS from execArgv, so propagate an absolute preload path as well.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { requestGuardPath } = require("./pi-web-node-args");
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(requestGuardPath);
process.execArgv.push("--require", requestGuardPath);
// Keep ownership outside Next's replaceable workers, as in the installed launcher.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { launchManagedNext } = require("./ssh-agent-launch");
const args = process.argv.slice(2);
function option(short, long, fallback) {
  let value = fallback;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === short || args[i] === long) value = args[++i];
    else if (args[i].startsWith(long + "=")) value = args[i].slice(long.length + 1);
  }
  return value;
}
launchManagedNext({ nextBin: require.resolve("next/dist/bin/next"), args, cwd: process.cwd(),
  hostname: option("-H", "--hostname", "0.0.0.0"), port: option("-p", "--port", process.env.PORT || "3000"),
}).catch(error => {
  console.error(`[pi-web] startup failed: ${error.message}`);
  process.exit(error.exitCode || 1);
});
