import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");

// Execute the real route/helper with explicit mocks, never SDK or credential IO.
export function loadTsModule(url, mocks = {}, globals = {}) {
  const source = readFileSync(url, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText;
  const compiledModule = { exports: {} };
  const context = {
    module: compiledModule, exports: compiledModule.exports, Request, Response, ReadableStream,
    TextEncoder, AbortController, URL, Error,
    require(name) {
      assert.ok(Object.hasOwn(mocks, name), `Unexpected runtime dependency: ${name}`);
      return mocks[name];
    },
    ...globals,
  };
  vm.runInNewContext(compiled, context);
  return { exports: compiledModule.exports, context };
}

export function sseFixture(t) {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const intervals = new Set();
  const helper = loadTsModule(new URL("./sse-stream.ts", import.meta.url), {}, {
    setInterval(callback, ms) {
      assert.equal(ms, 15_000);
      const timer = globalThis.setInterval(callback, ms);
      intervals.add(timer);
      return timer;
    },
    clearInterval(timer) {
      globalThis.clearInterval(timer);
      intervals.delete(timer);
    },
  }).exports;
  return { ...helper, intervals, tick: () => t.mock.timers.tick(15_000) };
}

export async function readText(reader) {
  let timer;
  try {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out reading SSE fixture")), 1_000);
      }),
    ]);
    assert.equal(done, false);
    return new TextDecoder().decode(value);
  } finally {
    clearTimeout(timer);
  }
}

export async function readData(reader) {
  const text = await readText(reader);
  return JSON.parse(text.split("data: ")[1]);
}
