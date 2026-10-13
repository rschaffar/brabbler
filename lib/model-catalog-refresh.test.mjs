import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const {
  isModelNetworkDisabled,
  modelCatalogSignature,
  refreshModelCatalogs,
} = await jiti.import("./model-catalog-refresh.ts");

function model(provider, id, name = id) {
  return { provider, id, name };
}

test("catalog signature ignores the order models are listed in", () => {
  const first = modelCatalogSignature([
    model("kimi-coding", "k3"),
    model("kimi-coding", "K2.8-preview"),
  ]);
  const second = modelCatalogSignature([
    model("kimi-coding", "K2.8-preview"),
    model("kimi-coding", "k3"),
  ]);

  assert.equal(first, second);
});

test("catalog signature moves when a model is added, renamed, or changes provider", () => {
  const baseline = modelCatalogSignature([model("kimi-coding", "k3")]);

  assert.notEqual(
    modelCatalogSignature([model("kimi-coding", "k3"), model("kimi-coding", "K2.8-preview")]),
    baseline,
  );
  assert.notEqual(modelCatalogSignature([model("kimi-coding", "k3", "Kimi K3")]), baseline);
  assert.notEqual(modelCatalogSignature([model("moonshotai", "k3")]), baseline);
});

test("catalog signature does not confuse a provider/id split with a model id", () => {
  assert.notEqual(
    modelCatalogSignature([model("stepfun", "Step-5-Preview")]),
    modelCatalogSignature([model("commandcode", "stepfun/Step-5-Preview")]),
  );
});

test("catalog signature tracks capability, limits and prices deterministically, never headers", () => {
  const base = { ...model("openrouter", "same-id"), reasoning: true, input: ["text"], contextWindow: 32000,
    maxTokens: 4000, cost: { input: 1, output: 2 }, thinkingLevelMap: { low: "low", high: "high" },
    compat: { supportsTools: true } };
  const signature = modelCatalogSignature([base]);
  for (const change of [{ reasoning: false }, { input: ["text", "image"] }, { contextWindow: 64000 },
    { maxTokens: 8000 }, { cost: { input: 3, output: 2 } }, { thinkingLevelMap: { low: null, high: "high" } },
    { compat: { supportsTools: false } }, { inputLimits: { maxRequestBytes: 100 } }, { promptCache: { short: 300 } }]) {
    assert.notEqual(modelCatalogSignature([{ ...base, ...change }]), signature);
  }
  assert.equal(modelCatalogSignature([{ ...base, cost: { output: 2, input: 1 }, thinkingLevelMap: { high: "high", low: "low" } }]), signature);
  assert.equal(modelCatalogSignature([{ ...base, headers: { authorization: "synthetic-secret" } }]), signature);
  assert.ok(!modelCatalogSignature([{ ...base, headers: { authorization: "synthetic-secret" } }]).includes("synthetic-secret"));
  assert.notEqual(modelCatalogSignature([model("p", "a\u0000b", "c")]), modelCatalogSignature([model("p", "a", "b\u0000c")]));
});

test("PI_OFFLINE keeps its pi meaning: any value, empty included, disables the network", () => {
  const previous = process.env.PI_OFFLINE;
  try {
    delete process.env.PI_OFFLINE;
    assert.equal(isModelNetworkDisabled(), false);
    process.env.PI_OFFLINE = "";
    assert.equal(isModelNetworkDisabled(), true);
    process.env.PI_OFFLINE = "0";
    assert.equal(isModelNetworkDisabled(), true);
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
});

test("an offline refresh says so instead of building a runtime", async () => {
  const previous = process.env.PI_OFFLINE;
  process.env.PI_OFFLINE = "1";
  try {
    assert.deepEqual(await refreshModelCatalogs(), {
      completed: false,
      changed: false,
      reason: "offline",
    });
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
});
