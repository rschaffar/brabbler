import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { getNextNodeArgs, requestGuardPath, compressionPreloadPath } = require("../bin/brabbler-node-args.js");

test("passes the no-wasm-lazy-compilation flag to Node on RISC-V", () => {
  assert.deepEqual(getNextNodeArgs("next-bin", ["start", "-p", "30141"], "riscv64"), [
    "--no-wasm-lazy-compilation",
    "--require", requestGuardPath,
    "--require", compressionPreloadPath,
    "next-bin",
    "start",
    "-p",
    "30141",
  ]);
});

test("preloads the guard before Next on every architecture", () => {
  for (const arch of ["x64", "arm64"]) {
    assert.deepEqual(getNextNodeArgs("next-bin", ["start"], arch), ["--require", requestGuardPath, "--require", compressionPreloadPath, "next-bin", "start"]);
  }
  assert.equal(requestGuardPath, require.resolve("../bin/request-header-guard.js"));
  assert.equal(compressionPreloadPath, require.resolve("../bin/next-compression-preload.js"));
});

test("limits compression preloading to managed serving commands", () => {
  assert.ok(getNextNodeArgs("next-bin", ["dev"]).includes(compressionPreloadPath));
  for (const command of ["build", "typegen", "info"]) {
    assert.equal(getNextNodeArgs("next-bin", [command]).includes(compressionPreloadPath), false);
  }
});

test("does not mutate the caller's Next.js arguments", () => {
  const nextArgs = ["start", "-H", "127.0.0.1"];

  getNextNodeArgs("next-bin", nextArgs, "riscv64");

  assert.deepEqual(nextArgs, ["start", "-H", "127.0.0.1"]);
});
