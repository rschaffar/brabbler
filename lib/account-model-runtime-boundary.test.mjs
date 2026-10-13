import assert from "node:assert/strict";
import test from "node:test";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { loadTsModule, sseFixture, readText, readData } from "./sse-stream.fixture.mjs";

function fixture() {
  let initializations = 0;
  const sdk = {
    getAgentDir() { initializations++; return "/synthetic-agent"; },
    ModelRuntime: { async create(options) { initializations++; assert.ok(options); return { options, getError: () => undefined }; } },
    async createAgentSessionServices(options) { initializations++; return { modelRuntime: options.modelRuntime ?? { default: true } }; },
  };
  const store = { async read() {}, async list() { return []; }, async modify() {}, async delete() {} };
  const helper = loadTsModule(new URL("./account-model-runtime.ts", import.meta.url), {
    "node:crypto": crypto, "node:path": path,
    "node:fs": { mkdirSync() {}, chmodSync() {}, lstatSync(_path, options) { return options ? undefined : { isDirectory: () => true }; } },
    "@earendil-works/pi-coding-agent": sdk,
    "./provider-accounts": { validateAccountSelection() {}, accountCredentialStore: () => store },
  }).exports;
  const runtime = loadTsModule(new URL("./model-runtime.ts", import.meta.url), {
    "@earendil-works/pi-coding-agent": sdk, "./account-model-runtime": helper,
  }).exports;
  return { helper, runtime, store, get initializations() { return initializations; } };
}

test("supplied malformed bindings reject before any SDK initialization", async () => {
  const f = fixture();
  const binding = f.helper.prepareAccountModelRuntime({ openrouter: "synthetic-id" }, { agentDir: "/synthetic-agent" });
  for (const invalid of [null, {}, f.store, [], false, { runtimeOptions: undefined },
    { ...binding, runtimeOptions: undefined }, { ...binding, accounts: {} }]) {
    await assert.rejects(f.runtime.createModelRuntimeWithExtensions(invalid), /Invalid account model runtime binding/);
    assert.equal(f.initializations, 0);
  }
});

test("only omitted/undefined bindings use Pi default; prepared bindings retain exact options", async () => {
  const f = fixture();
  assert.equal((await f.runtime.createModelRuntimeWithExtensions()).default, true);
  assert.equal((await f.runtime.createModelRuntimeWithExtensions(undefined)).default, true);
  const binding = f.helper.prepareAccountModelRuntime({ openrouter: "synthetic-id" }, { agentDir: "/synthetic-agent" });
  const runtime = await f.runtime.createModelRuntimeWithExtensions(binding);
  assert.equal(runtime.options, binding.runtimeOptions);
  assert.equal(runtime.options.credentials, f.store);
  assert.match(runtime.options.modelsStorePath, /model-stores\/v1\/[a-f0-9]{64}/);
});

test("refresh route rejects every invalid present provider without invoking refresh", async () => {
  let calls = 0;
  const route = loadTsModule(new URL("../app/api/models/refresh/route.ts", import.meta.url), {
    "@/lib/model-catalog-refresh": { async shareModelCatalogRefresh() { calls++; return {}; } },
  }).exports;
  for (const provider of [42, null, "", " \t\n", false, [], {}]) {
    const response = await route.POST(new Request("http://localhost/api/models/refresh", { method: "POST", body: JSON.stringify({ provider }) }));
    assert.equal(response.status, 400);
    assert.equal(calls, 0);
  }
});

test("refresh route retains all-provider omission and trims valid explicit filters", async () => {
  const calls = [];
  const route = loadTsModule(new URL("../app/api/models/refresh/route.ts", import.meta.url), {
    "@/lib/model-catalog-refresh": { async shareModelCatalogRefresh(options) { calls.push(options); return {}; } },
  }).exports;
  for (const body of [{}, { provider: " openrouter ", accounts: { openrouter: "synthetic-id" } }]) {
    assert.equal((await route.POST(new Request("http://localhost/api/models/refresh", { method: "POST", body: JSON.stringify(body) }))).status, 200);
  }
  assert.equal(calls[0].providers, undefined);
  assert.equal(calls[1].providers.length, 1);
  assert.equal(calls[1].providers[0], "openrouter");
  assert.equal(calls[1].accounts.openrouter, "synthetic-id");
});

// Exercise the real route code, but no provider or credential/disk/network IO.
test("extra-account API-key route passes one prepared binding and writes its credential store", async () => {
  const f = fixture();
  const binding = f.helper.prepareAccountModelRuntime({ openrouter: "synthetic-id" }, { agentDir: "/synthetic-agent", allowPendingLogin: true });
  let written = 0;
  f.store.modify = async (provider, fn) => { assert.equal(provider, "openrouter"); assert.equal((await fn()).type, "api_key"); written++; };
  const route = loadTsModule(new URL("../app/api/auth/accounts/[id]/api-key/route.ts", import.meta.url), {
    "next/server": { NextResponse: Response },
    "@/lib/provider-accounts": { listProviderAccounts: () => [{ id: "synthetic-id", provider: "openrouter", type: "api_key" }] },
    "@/lib/account-model-runtime": { prepareAccountModelRuntime(accounts, options) {
      assert.equal(accounts.openrouter, "synthetic-id"); assert.equal(options.allowPendingLogin, true); return binding;
    } },
    "@/lib/model-runtime": { async createModelRuntimeWithExtensions(actual) {
      assert.equal(actual, binding);
      return { getProvider: () => ({ auth: { apiKey: { async login(options) {
        assert.equal(await options.prompt({ type: "secret" }), "synthetic-key");
        return { type: "api_key", key: "synthetic-key" };
      } } } }) };
    } },
    "@/lib/models-cache": { invalidateModelsCache() {} },
  }).exports;
  const response = await route.POST(new Request("http://localhost/api/auth/accounts/synthetic-id/api-key", {
    method: "POST", body: JSON.stringify({ apiKey: "synthetic-key" }),
  }), { params: Promise.resolve({ id: "synthetic-id" }) });
  assert.equal(response.status, 200);
  assert.equal(written, 1);
});

test("extra-account OAuth route passes a pending-login binding before starting login", async (t) => {
  const f = fixture(), sse = sseFixture(t);
  const binding = f.helper.prepareAccountModelRuntime({ openrouter: "synthetic-id" }, { agentDir: "/synthetic-agent", allowPendingLogin: true });
  let calls = 0;
  const route = loadTsModule(new URL("../app/api/auth/login/[provider]/route.ts", import.meta.url), {
    "node:crypto": { randomUUID: () => "synthetic-token" },
    "@/lib/models-cache": { invalidateModelsCache() {} },
    "@/lib/provider-accounts": { listProviderAccounts: () => [{ id: "synthetic-id", provider: "openrouter", type: "oauth" }] },
    "@/lib/account-model-runtime": { prepareAccountModelRuntime(accounts, options) {
      assert.equal(accounts.openrouter, "synthetic-id"); assert.equal(options.allowPendingLogin, true); return binding;
    } },
    "@/lib/model-runtime": { async createModelRuntimeWithExtensions(actual) {
      assert.equal(actual, binding); calls++;
      return { getProvider: () => ({ auth: { oauth: {} } }), async login(provider, type) {
        assert.equal(provider, "openrouter"); assert.equal(type, "oauth");
      } };
    } },
    "@/lib/sse-stream": sse,
  }).exports;
  const reader = (await route.GET(new Request("http://localhost/api/auth/login/openrouter?accountId=synthetic-id"),
    { params: Promise.resolve({ provider: "openrouter" }) })).body.getReader();
  t.after(() => reader.cancel());
  assert.equal(await readText(reader), ":\n\n");
  assert.equal((await readData(reader)).type, "success");
  assert.equal((await reader.read()).done, true);
  assert.equal(calls, 1);
});

test("extra-account model selector injects its runtime, preserves trust gating and bypasses default cache", async () => {
  const f = fixture();
  const model = { provider: "openrouter", id: "synthetic-model", name: "Synthetic model", input: ["text"] };
  const trustOptions = { noProjectExtensions: true };
  let servicesCalls = 0;
  const route = loadTsModule(new URL("../app/api/models/route.ts", import.meta.url), {
    "fs/promises": { async stat() { return { isDirectory: () => true }; } }, "path": path,
    "@earendil-works/pi-coding-agent": {
      getAgentDir: () => "/synthetic-agent", SessionManager: {},
      async createAgentSessionServices(options) {
        assert.equal(options.modelRuntime.options.credentials, f.store);
        assert.match(options.modelRuntime.options.modelsStorePath, /model-stores\/v1\/[a-f0-9]{64}/);
        assert.equal(options.resourceLoaderReloadOptions, trustOptions);
        servicesCalls++;
        return { modelRuntime: options.modelRuntime, settingsManager: {
          getEnabledModels: () => [], getDefaultProvider() {}, getDefaultModel() {}, getModelThinkingLevel() {}, getDefaultThinkingLevel() {},
        } };
      },
    },
    "@/lib/account-model-runtime": { createAccountModelRuntime(accounts, options) {
      assert.equal(accounts.openrouter, "synthetic-id");
      return f.helper.createAccountModelRuntime(accounts, options);
    } },
    "@/lib/provider-accounts": { validateAccountSelection(accounts) { assert.equal(accounts.openrouter, "synthetic-id"); } },
    "@/lib/session-accounts": {}, "@/lib/rpc-manager": {}, "@/lib/session-reader": {},
    "@earendil-works/pi-ai": { getSupportedThinkingLevels: () => ["off"] },
    "@/lib/models-cache": {
      loadModelsWithCache() { assert.fail("Account selector must not use Pi-default cache"); },
      withModelRuntimeError: (data) => data, withSafeModelLoadFailure() { assert.fail("Selector failed"); },
    },
    "@/lib/model-scope": { async resolveVisibleModels() { return { visible: [model], thinkingLevelPins: {}, warnings: [] }; },
      selectInitialModelScope: () => ({ model }) },
    "@/lib/file-access": { async getAllowedFileRoots() { return []; }, isExistingFilePathAllowed: () => true },
    "@/lib/project-trust": { projectTrustReloadOptions: () => trustOptions },
  }).exports;
  const url = new URL("http://localhost/api/models?cwd=/synthetic-project");
  url.searchParams.set("accounts", JSON.stringify({ openrouter: "synthetic-id" }));
  const response = await route.GET(new Request(url));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).modelList[0].id, "synthetic-model");
  assert.equal(servicesCalls, 1);
});
