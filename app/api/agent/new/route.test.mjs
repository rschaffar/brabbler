import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;

function fixture() {
  const calls = [];
  const mocks = {
    "next/server": { NextResponse: { json: (data, options) => Response.json(data, options) } },
    fs: { existsSync: (path) => { calls.push(["exists", path]); return true; } },
    crypto: { randomUUID: () => "fixture-request" },
    "@/lib/file-access": { allowFileRoot: (path) => calls.push(["allow", path]) },
    "@/lib/session-reader": { invalidateSessionListCache: () => calls.push(["invalidate"]) },
    "@/lib/model-speed": { isModelSpeed: (value) => value === "standard" || value === "fast" },
    "@/lib/rpc-manager": { startRpcSession: async (...args) => {
      calls.push(["start", ...args]);
      return { realSessionId: "fixture-session", session: { send: async (command) => {
        calls.push(["send", structuredClone(command)]);
        return command.type === "get_state" ? { thinkingLevel: "off", modelSpeed: args[3].modelSpeed ?? "standard" } : null;
      } } };
    } },
  };
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, require: (name) => {
    assert.ok(Object.hasOwn(mocks, name), `Unexpected runtime dependency: ${name}`);
    return mocks[name];
  } });
  const post = (body) => compiledModule.exports.POST(new Request("http://localhost/api/agent/new", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { calls, post };
}

test("ordinary creation forwards startup choices before sending the prompt", async () => {
  const { calls, post } = fixture();
  const response = await post({ cwd: "/fixture", type: "prompt", message: "fixture",
    provider: "fixture-provider", modelId: "fixture-model", toolNames: ["read"], thinkingLevel: "low" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).sessionId, "fixture-session");
  const start = calls.find(([name]) => name === "start");
  assert.deepEqual(JSON.parse(JSON.stringify(start.slice(1))), ["__new__fixture-request", "", "/fixture", {
    toolNames: ["read"], initialModel: { provider: "fixture-provider", modelId: "fixture-model" }, thinkingLevel: "low",
  }]);
  assert.deepEqual(calls.filter(([name]) => name === "send"), [
    ["send", { type: "get_state" }], ["send", { type: "prompt", message: "fixture" }],
  ]);
});

test("speed is a separate startup option, never leaked into the prompt command", async () => {
  const { calls, post } = fixture();
  const response = await post({ cwd: "/fixture", type: "prompt", message: "fixture", modelSpeed: "fast", thinkingLevel: "high" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).modelSpeed, "fast");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(([name]) => name === "start")[4])), { thinkingLevel: "high", modelSpeed: "fast" });
  assert.deepEqual(calls.filter(([name]) => name === "send").at(-1), ["send", { type: "prompt", message: "fixture" }]);
});

test("credential-free ensure_session returns speed without sending a prompt; invalid/Ultrafast modes reject before startup", async () => {
  const { calls, post } = fixture();
  const response = await post({ cwd: "/fixture", type: "ensure_session", modelSpeed: "standard" });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).modelSpeed, "standard");
  assert.deepEqual(calls.filter(([name]) => name === "send"), [["send", { type: "get_state" }]]);
  for (const modelSpeed of ["ultrafast", "priority", null, {}, 1]) {
    const rejected = fixture();
    const result = await rejected.post({ cwd: "/fixture", type: "prompt", message: "fixture", modelSpeed });
    assert.equal(result.status, 400);
    assert.equal((await result.json()).accepted, false);
    assert.equal(rejected.calls.some(([name]) => name === "start"), false);
  }
});
