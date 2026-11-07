"use strict";

const requestGuardPath = require.resolve("./request-header-guard");
const compressionPreloadPath = require.resolve("./next-compression-preload");

function getNextNodeArgs(nextBin, nextArgs, arch = process.arch) {
  return [
    ...(arch === "riscv64" ? ["--no-wasm-lazy-compilation"] : []),
    "--require", requestGuardPath,
    ...(["dev", "start"].includes(nextArgs[0]) ? ["--require", compressionPreloadPath] : []),
    nextBin, ...nextArgs,
  ];
}

module.exports = { getNextNodeArgs, requestGuardPath, compressionPreloadPath };
