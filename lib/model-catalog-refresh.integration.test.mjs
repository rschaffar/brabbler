import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Proves the whole mechanism #914 asks for: a catalog pi-web has never seen
// reaches the model list without a pi CLI run. pi.dev is stubbed, so the test
// is offline; everything between the response and the model list is real.
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-model-catalog-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
delete process.env.PI_OFFLINE;

const PROVIDER = "kimi-coding";
const CATALOG_URL = `https://pi.dev/api/models/providers/${PROVIDER}?types=chat%2Cimage%2Cclassifier`;
const NEW_MODEL_ID = "pi-web-test-preview";

// A provider with no credential is skipped before the network is touched.
await writeFile(
  join(agentDir, "auth.json"),
  JSON.stringify({ [PROVIDER]: { type: "api_key", key: "sk-test" } }, null, 2),
);

let catalogRequests = 0;
const OPENROUTER_CATALOG_URL = "https://pi.dev/api/models/providers/openrouter?types=chat%2Cimage%2Cclassifier";
const USER_MODELS_URL = "https://openrouter.ai/api/v1/models/user";
const personalRequests = [];
const unexpectedUrls = [];
const modelIds = { "synthetic-A": "pi-web/a", "synthetic-B": "pi-web/b", "synthetic-default": "pi-web/default" };
const personalMetadata = {
  "synthetic-A": { context: 64000, maxTokens: 8000, price: "0.000001" },
  "synthetic-B": { context: 96000, maxTokens: 12000, price: "0.000002" },
  "synthetic-default": { context: 128000, maxTokens: 16000, price: "0.000004" },
};
let inputPrice = personalMetadata["synthetic-A"].price;
let gate;
const catalogModel = (id) => ({ id, name: id, api: "openai-completions", provider: "openrouter",
  baseUrl: "https://openrouter.ai/api/v1", reasoning: true, input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 4000 });
const catalogResponse = (models) => new Response(JSON.stringify(models), { headers: {
  "content-type": "application/json", "last-modified": "Sat, 01 Jan 2050 00:00:00 GMT",
} });
const upstreamFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url === OPENROUTER_CATALOG_URL) return catalogResponse(Object.values(modelIds).map(catalogModel));
  if (url === USER_MODELS_URL) {
    const key = new Headers(init?.headers).get("authorization")?.replace(/^Bearer /, "");
    assert.ok(Object.hasOwn(modelIds, key), "Only synthetic identities may request personalized catalogs");
    personalRequests.push(key);
    if (gate?.key === key) {
      const active = gate;
      gate = undefined;
      active.entered.resolve();
      await active.release.promise;
    }
    const metadata = personalMetadata[key];
    return Response.json({ data: [{ id: modelIds[key], context_length: metadata.context,
      top_provider: { max_completion_tokens: metadata.maxTokens },
      pricing: { prompt: key === "synthetic-A" ? inputPrice : metadata.price, completion: "0.000002" } }] });
  }
  if (url !== CATALOG_URL) unexpectedUrls.push(url);
  assert.equal(url, CATALOG_URL); // ALL unexpected HTTP URLs fail; no live fallback.
  catalogRequests += 1;
  return new Response(
    JSON.stringify([
      {
        id: NEW_MODEL_ID,
        name: "Pi Web Test Preview",
        api: "anthropic-messages",
        provider: PROVIDER,
        baseUrl: "https://example.invalid/anthropic",
        reasoning: true,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 262144,
        maxTokens: 65536,
      },
    ]),
    {
      status: 200,
      headers: {
        "content-type": "application/json",
        etag: '"pi-web-test"',
        // The overlay is dropped unless the catalog postdates the SDK's own
        // generated model data, so a stale catalog cannot undo a pi upgrade.
        "last-modified": new Date().toUTCString(),
      },
    },
  );
};

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { refreshModelCatalogs, shareModelCatalogRefresh } = await jiti.import("./model-catalog-refresh.ts");
const { createModelRuntimeWithExtensions } = await jiti.import("./model-runtime.ts");
const { prepareAccountModelRuntime, createAccountModelRuntime } = await jiti.import("./account-model-runtime.ts");
const { addProviderAccount, accountCredentialStore } = await jiti.import("./provider-accounts.ts");
const { POST } = await jiti.import("../app/api/models/refresh/route.ts");
const { loadModelsWithCache } = await jiti.import("./models-cache.ts");
let accountsA, accountsB;
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

after(async () => {
  globalThis.fetch = upstreamFetch;
  await rm(agentDir, { recursive: true, force: true });
  assert.deepEqual(unexpectedUrls, [], "Unexpected HTTP must not be swallowed by the SDK");
});

async function providerModelIds() {
  const runtime = await createModelRuntimeWithExtensions();
  return runtime.getModels().filter((model) => model.provider === PROVIDER).map((model) => model.id);
}

test("a refreshed catalog reaches the model list the way the pi CLI's did", async () => {
  assert.ok(!(await providerModelIds()).includes(NEW_MODEL_ID));

  const result = await refreshModelCatalogs({ providers: [PROVIDER] });

  assert.equal(catalogRequests, 1);
  assert.deepEqual(result, { completed: true, changed: true });
  // A separate runtime with the network untouched — what GET /api/models builds.
  assert.ok((await providerModelIds()).includes(NEW_MODEL_ID));
});

test("a second press refetches and reports that nothing moved", async () => {
  // `force: true` is always sent, so the SDK's four-hour freshness window does
  // not turn the button into a no-op.
  const result = await refreshModelCatalogs({ providers: [PROVIDER] });

  assert.equal(catalogRequests, 2);
  assert.deepEqual(result, { completed: true, changed: false });
});

test("concurrent presses for the same provider share one pass", async () => {
  const before = catalogRequests;
  const [first, second] = await Promise.all([
    shareModelCatalogRefresh({ providers: [PROVIDER] }),
    shareModelCatalogRefresh({ providers: [PROVIDER] }),
  ]);

  assert.equal(catalogRequests, before + 1);
  assert.deepEqual(first, second);
});

test("unknown-owner shared sentinel is never restored into extra-account catalogs", async () => {
  const shared = JSON.parse(await readFile(join(agentDir, "models-store.json"), "utf8"));
  shared.openrouter = { models: [catalogModel("unknown-owner-sentinel")], checkedAt: Date.now() };
  await writeFile(join(agentDir, "models-store.json"), JSON.stringify(shared));
  for (const marker of ["A", "B"]) {
    const account = await addProviderAccount("openrouter", marker, "api_key");
    await accountCredentialStore({ openrouter: account.id }).modify("openrouter", async () => ({ type: "api_key", key: `synthetic-${marker}` }));
    if (marker === "A") accountsA = { openrouter: account.id };
    else accountsB = { openrouter: account.id };
  }
  const before = personalRequests.length;
  for (const accounts of [accountsA, accountsB]) {
    const runtime = await createAccountModelRuntime(accounts);
    assert.ok(!runtime.getModels().some((m) => m.id === "unknown-owner-sentinel"));
  }
  assert.equal(personalRequests.length, before);
  assert.equal(JSON.parse(await readFile(join(agentDir, "models-store.json"), "utf8")).openrouter.models[0].id, "unknown-owner-sentinel");
  await writeFile(join(agentDir, "auth.json"), JSON.stringify({
    [PROVIDER]: { type: "api_key", key: "sk-test" }, openrouter: { type: "api_key", key: "synthetic-default" },
  }));
});

test("explicit refresh joins only same scope/providers and serializes overlapping scope passes", async () => {
  const entered = deferred(), release = deferred();
  gate = { key: "synthetic-A", entered, release };
  const mutable = { ...accountsA };
  const providers = ["openrouter"];
  const first = shareModelCatalogRefresh({ accounts: mutable, providers });
  mutable.openrouter = accountsB.openrouter;
  providers.push(PROVIDER);
  const joined = shareModelCatalogRefresh({ accounts: accountsA, providers: ["openrouter", "openrouter"] });
  assert.equal(first, joined);
  await entered.promise;
  const overlap = shareModelCatalogRefresh({ accounts: accountsA, providers: [PROVIDER, "openrouter"] });
  const overlapJoined = shareModelCatalogRefresh({ accounts: accountsA, providers: ["openrouter", PROVIDER] });
  assert.equal(overlap, overlapJoined);
  const allProviders = shareModelCatalogRefresh({ accounts: accountsA });
  assert.equal(allProviders, shareModelCatalogRefresh({ accounts: accountsA }));
  const second = shareModelCatalogRefresh({ accounts: accountsB, providers: ["openrouter"] });
  const piDefault = shareModelCatalogRefresh({ providers: ["openrouter"] });
  assert.notEqual(second, first);
  assert.notEqual(piDefault, first);
  try {
    assert.deepEqual(await second, { completed: true, changed: true });
    assert.deepEqual(await piDefault, { completed: true, changed: true });
    assert.equal(personalRequests.filter((key) => key === "synthetic-A").length, 1);
  } finally { release.resolve(); }
  assert.deepEqual(await first, { completed: true, changed: true });
  assert.equal((await overlap).completed, true);
  assert.equal((await allProviders).completed, true);
  assert.equal(personalRequests.filter((key) => key === "synthetic-A").length, 3);
});

test("real disk-backed OpenRouter A/B/default catalogs reopen offline with identity-specific limits and prices", async () => {
  process.env.PI_OFFLINE = "1";
  const before = personalRequests.length;
  try {
    const paths = new Set();
    for (const [accounts, id] of [[accountsA, "pi-web/a"], [accountsB, "pi-web/b"], [{}, "pi-web/default"]]) {
      const binding = prepareAccountModelRuntime(accounts);
      paths.add(binding.modelsStorePath);
      const saved = JSON.parse(await readFile(binding.modelsStorePath, "utf8"));
      assert.deepEqual(saved.openrouter.models.filter((m) => !m.type || m.type === "chat").map((m) => m.id), [id]);
      assert.ok(saved.openrouter.models.some((m) => m.type === "image"));
      assert.ok(saved.openrouter.models.some((m) => m.type === "classifier"));
      assert.equal((await stat(binding.modelsStorePath)).mode & 0o777, 0o600);
      const runtime = Object.keys(accounts).length ? await createAccountModelRuntime(accounts) : await createModelRuntimeWithExtensions();
      const models = runtime.getModels().filter((m) => m.provider === "openrouter");
      assert.deepEqual(models.map((m) => m.id), [id]);
      const key = Object.keys(modelIds).find((key) => modelIds[key] === id);
      assert.equal(models[0].contextWindow, personalMetadata[key].context);
      assert.equal(models[0].maxTokens, personalMetadata[key].maxTokens);
      assert.equal(models[0].cost.input, Number(personalMetadata[key].price) * 1_000_000);
    }
    assert.equal(paths.size, 3);
    assert.equal(personalRequests.length, before);
  } finally { delete process.env.PI_OFFLINE; }
});

test("metadata-only refresh broadly invalidates caches without touching another identity's disk catalog", async () => {
  const pathB = prepareAccountModelRuntime(accountsB).modelsStorePath;
  const pathDefault = join(agentDir, "models-store.json");
  const beforeB = await readFile(pathB, "utf8"), beforeDefault = await readFile(pathDefault, "utf8");
  await loadModelsWithCache("synthetic-cwd", async () => ({ marker: "cached" }));
  const generation = globalThis.__piModelsCacheState.generation;
  inputPrice = "0.000003";
  const response = await POST(new Request("http://localhost/api/models/refresh", { method: "POST", body: JSON.stringify({ accounts: accountsA, provider: "openrouter" }) }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { completed: true, changed: true });
  assert.equal(globalThis.__piModelsCacheState.generation, generation + 1);
  assert.equal(globalThis.__piModelsCacheState.entries.size, 0);
  assert.equal(await readFile(pathB, "utf8"), beforeB);
  assert.equal(await readFile(pathDefault, "utf8"), beforeDefault);
  assert.deepEqual(await refreshModelCatalogs({ accounts: accountsA, providers: ["openrouter"] }), { completed: true, changed: false });
});

test("refresh backend rejects invalid, pending, missing and wrong-provider snapshots even offline", async () => {
  const pending = await addProviderAccount("openrouter", "Pending", "api_key");
  process.env.PI_OFFLINE = "1";
  const before = personalRequests.length;
  try {
    for (const accounts of [null, [], { openrouter: 1 }, { openrouter: "missing" }, { openrouter: pending.id }, { anthropic: accountsA.openrouter }]) {
      const response = await POST(new Request("http://localhost/api/models/refresh", { method: "POST", body: JSON.stringify({ accounts }) }));
      assert.equal(response.status, 400);
    }
    for (const body of [{}, { accounts: {} }, { accounts: accountsA }]) {
      const response = await POST(new Request("http://localhost/api/models/refresh", { method: "POST", body: JSON.stringify(body) }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { completed: false, changed: false, reason: "offline" });
    }
    assert.equal(personalRequests.length, before);
  } finally { delete process.env.PI_OFFLINE; }
});
