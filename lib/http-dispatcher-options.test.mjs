import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Script } from "node:vm";
import { EventEmitter } from "node:events";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
const script = new Script(ts.transpileModule(await readFile(new URL("./http-dispatcher.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText);
test("dispatcher preserves disabled idle timeout and the CLI family-attempt/CONNECT options", () => {
  const captured = [], installed = [];
  const exports = {};
  const undici = { EnvHttpProxyAgent: class extends EventEmitter { constructor(options) { super(); captured.push(options); } }, setGlobalDispatcher: d => installed.push(d), install() {} };
  script.runInNewContext({ exports, process, require(name) {
    if (name === "undici") return undici;
    if (name === "./regular-file") return { readRegularFileText: () => undefined };
    return require(name);
  } });
  exports.configureHttpDispatcher(0);
  exports.configureHttpDispatcher(1000);
  assert.equal(captured.length, 1);
  assert.equal(installed.length, 1);
  assert.equal(captured[0].bodyTimeout, 0);
  assert.equal(captured[0].headersTimeout, 0);
  assert.equal(captured[0].proxyTunnel, true);
  assert.equal(captured[0].connect.autoSelectFamilyAttemptTimeout, 2000);
});
