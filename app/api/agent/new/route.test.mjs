import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createJiti } from "jiti";

const nativeResourceSelection = await createJiti(import.meta.url).import("../../../../lib/session-native-resources.ts");

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;

function fixture(defaultSelection, defaultFailure, persistFailure) {
  const calls = [];
  const mocks = {
    "next/server": { NextResponse: { json: (data, options) => Response.json(data, options) } },
    fs: { existsSync: (path) => { calls.push(["exists", path]); return true; } },
    crypto: { randomUUID: () => "fixture-request" },
    "@/lib/file-access": { allowFileRoot: (path) => calls.push(["allow", path]) },
    "@/lib/session-reader": { invalidateSessionListCache: () => calls.push(["invalidate"]) },
    "@/lib/model-speed": { isModelSpeed: (value) => value === "standard" || value === "fast" },
    "@/lib/session-native-resources": nativeResourceSelection,
    "@earendil-works/pi-coding-agent": { getAgentDir: () => "/agent-fixture" },
    "@/lib/project-native-resources": { projectNativeResourceSelection: (cwd, agentDir) => {
      calls.push(["default", cwd, agentDir]);
      if (defaultFailure) throw defaultFailure;
      return defaultSelection;
    } },
    "@/lib/rpc-manager": { startRpcSession: async (...args) => {
      calls.push(["start", ...args]);
      return { realSessionId: "fixture-session", session: { persistInitialSession: () => { calls.push(["persist"]); if (persistFailure) throw persistFailure; }, send: async (command) => {
        calls.push(["send", structuredClone(command)]);
        return command.type === "get_state" ? { thinkingLevel: "off", modelSpeed: args[3].modelSpeed ?? "standard" } : null;
      } } };
    } },
  };
  const compiledModule = { exports: {} };
  vm.runInNewContext(compiled, { Error, module: compiledModule, exports: compiledModule.exports, require: (name) => {
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

test("empty ordinary creation persists before acknowledgement and refuses a failed write without sending", async () => {
  const f = fixture();
  assert.equal((await f.post({ cwd: "/fixture", type: "ensure_session" })).status, 200);
  assert.equal(f.calls.filter(([name]) => name === "persist").length, 1);
  assert.ok(f.calls.findIndex(([name]) => name === "persist") < f.calls.findIndex(([name]) => name === "invalidate"));
  assert.deepEqual(f.calls.filter(([name]) => name === "send"), [["send", { type: "get_state" }]]);
  const failed = fixture(undefined, undefined, new Error("synthetic disk failure"));
  const response = await failed.post({ cwd: "/fixture", type: "ensure_session" });
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error, "synthetic disk failure");
  assert.equal(failed.calls.some(([name]) => name === "send"), false);
});

test("native intent is validated before startup and is never a prompt field", async () => {
  const { calls, post } = fixture();
  const nativeResources = { version: 1, codeMode: true, mcpServers: [{ scope: "global", name: "fixture" }] };
  const response = await post({ cwd: "/fixture", type: "ensure_session", nativeResources });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find(([name]) => name === "start")[4])), { nativeResources });
  assert.deepEqual(calls.filter(([name]) => name === "send"), [["send", { type: "get_state" }]]);
  for (const nativeResources of [null, {}, { version: 1, codeMode: true, mcpServers: [{ scope: "invalid", name: "fixture" }] }]) {
    const rejected = fixture(); const response = await rejected.post({ cwd: "/fixture", type: "ensure_session", nativeResources });
    assert.equal(response.status, 400); assert.equal(rejected.calls.some(([name]) => name === "start"), false);
  }
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

test("fresh ordinary ensure/prompt creation snapshots project defaults before startup", async () => {
  const nativeResources = { version: 1, codeMode: false, mcpServers: [{ scope: "global", name: "paperless" }] };
  for (const type of ["ensure_session", "prompt"]) {
    const f = fixture(nativeResources);
    const response = await f.post({ cwd: "/fixture", type, ...(type === "prompt" ? { message: "synthetic" } : {}) });
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls.filter(([name]) => name === "default"), [["default", "/fixture", "/agent-fixture"]]);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(([name]) => name === "start")[4])), { nativeResources });
    assert.equal(f.calls.filter(([name]) => name === "persist").length, 1);
    if (type === "prompt") assert.deepEqual(f.calls.filter(([name]) => name === "send").at(-1), ["send", { type, message: "synthetic" }]);
  }
});

test("explicit native intent, especially off, bypasses project defaults and corrupt stores", async () => {
  for (const nativeResources of [{ version: 1, codeMode: false, mcpServers: [] }, { version: 1, codeMode: true, mcpServers: [] }]) {
    const f = fixture(undefined, new Error("SYNTHETIC_CORRUPT_DEFAULT"));
    assert.equal((await f.post({ cwd: "/fixture", type: "ensure_session", nativeResources })).status, 200);
    assert.equal(f.calls.some(([name]) => name === "default"), false);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(([name]) => name === "start")[4])), { nativeResources });
  }
  const refused = fixture(undefined, new Error("Project native-tool defaults are unavailable"));
  const response = await refused.post({ cwd: "/fixture", type: "prompt", message: "synthetic" });
  assert.equal(response.status, 500); assert.equal((await response.json()).accepted, false);
  assert.equal(refused.calls.some(([name]) => name === "start"), false);
});
