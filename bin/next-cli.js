"use strict";

// Supported npm serve commands must install the same guard as the packaged
// launcher, before loading Next. Its dev supervisor reconstructs worker
// NODE_OPTIONS from execArgv, so propagate an absolute preload path as well.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { requestGuardPath } = require("./pi-web-node-args");
// eslint-disable-next-line @typescript-eslint/no-require-imports
require(requestGuardPath);
process.execArgv.push("--require", requestGuardPath);
// Keep Next's CLI, readiness, dev supervision and signal ownership unchanged.
// eslint-disable-next-line @typescript-eslint/no-require-imports
require("next/dist/bin/next");
