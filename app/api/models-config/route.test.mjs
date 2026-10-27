import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "brabbler-models-config-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, PUT } = await jiti.import("./route.ts");
const modelsPath = join(testAgentDir, "models.json");

after(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function put(body) {
  return new Request("http://localhost/api/models-config", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("a models.json with a syntax error is reported instead of read as empty, and a save cannot replace it", async () => {
  const original = '{ "providers": { "acme": { "models": [ } } }';
  await writeFile(modelsPath, original);

  let response = await GET();
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /models\.json/);

  response = await PUT(put({ providers: {} }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /models\.json/);
  assert.equal(await readFile(modelsPath, "utf8"), original);
});

test("a commented models.json loads with its providers", async () => {
  await writeFile(modelsPath, '{\n  // local models\n  "providers": { "acme": { "models": [{ "id": "a" },] } },\n}\n');

  const response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { providers: { acme: { models: [{ id: "a" }] } } });
});

test("invalid context budgets refuse without changing saved bytes", async () => {
  const config = { providers: { managed: { modelOverrides: { one: { contextWindow: 32000 } } } } };
  const original = JSON.stringify(config);
  await writeFile(modelsPath, original);
  for (const value of [0, null, "500k", "100junk", "1.5"]) {
    const draft = structuredClone(config);
    draft.providers.managed.modelOverrides.one.contextWindow = value;
    const response = await PUT(put(draft));
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /managed\/one/);
    assert.equal(await readFile(modelsPath, "utf8"), original);
  }
});

test("managed context overrides reach pinned SDK offline and clearing restores its catalog", async () => {
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const authPath = join(testAgentDir, "synthetic-auth.json");
  const credentials = JSON.stringify({ "openai-codex": { type: "oauth", access: "synthetic-test-only", refresh: "synthetic-test-only", expires: 9999999999999 } });
  await writeFile(authPath, credentials);
  const options = { authPath, modelsPath, modelsStorePath: join(testAgentDir, "synthetic-store.json"), refreshOnCreate: false };
  const baseline = await ModelRuntime.create({ ...options, modelsPath: null });
  const model = baseline.getModels().find(model => model.provider === "openai-codex");
  assert.ok(model, "pinned SDK has managed fixture provider");
  const config = { providers: {
    [model.provider]: { modelOverrides: { [model.id]: { contextWindow: "500000", maxTokens: 2048 } } },
    relay: { baseUrl: "https://synthetic.invalid", api: "openai-completions", apiKey: "SYNTHETIC_TEST_ONLY", models: [{ id: "keep" }] },
  } };
  await writeFile(modelsPath, "{}");
  assert.equal((await PUT(put(config))).status, 200);
  const saved = await (await GET()).json();
  assert.equal(saved.providers[model.provider].modelOverrides[model.id].contextWindow, 500000);
  const runtime = await ModelRuntime.create(options);
  assert.equal(runtime.getError(), undefined);
  assert.equal(runtime.getModel(model.provider, model.id).contextWindow, 500000);
  delete config.providers[model.provider].modelOverrides[model.id].contextWindow;
  assert.equal((await PUT(put(config))).status, 200);
  const reset = await ModelRuntime.create(options);
  assert.equal(reset.getModel(model.provider, model.id).contextWindow, model.contextWindow);
  assert.equal(reset.getModel(model.provider, model.id).maxTokens, 2048);
  config.providers[model.provider].modelOverrides[model.id].contextWindow = 400000.5;
  assert.equal((await PUT(put(config))).status, 200, "SDK-compatible existing number remains saveable");
  assert.deepEqual((await (await GET()).json()).providers.relay, config.providers.relay);
  assert.equal(await readFile(authPath, "utf8"), credentials);
});

test("prototype-like provider/model IDs remain literal data through normalize, save, read and clear", async () => {
  const { withContextWindowOverride } = await jiti.import("@/lib/model-context.ts");
  await writeFile(modelsPath, "{}");
  const draft = withContextWindowOverride({ providers: {} }, "__proto__", "constructor", "12000");
  assert.equal((await PUT(put(draft))).status, 200);
  const saved = await (await GET()).json();
  assert.equal(Object.hasOwn(saved.providers, "__proto__"), true);
  assert.equal(saved.providers.__proto__.modelOverrides.constructor.contextWindow, 12000);
  assert.equal((await PUT(put(withContextWindowOverride(saved, "__proto__", "constructor", undefined)))).status, 200);
  assert.deepEqual(await (await GET()).json(), { providers: {} });
  assert.equal({}.contextWindow, undefined);
});
