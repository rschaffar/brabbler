"use strict";

const requestGuardPath = require.resolve("./request-header-guard");

function getNextNodeArgs(nextBin, nextArgs, arch = process.arch) {
  return [
    ...(arch === "riscv64" ? ["--no-wasm-lazy-compilation"] : []),
    "--require", requestGuardPath,
    nextBin, ...nextArgs,
  ];
}

module.exports = { getNextNodeArgs, requestGuardPath };
