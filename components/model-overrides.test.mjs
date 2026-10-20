import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { setCompatFlag } = await jiti.import("./models-config-helpers.ts");
const { readModelsConfig, writeModelsConfig } = await jiti.import("../lib/models-config-store.ts");
test("adaptive thinking uses native compat flags and preserves inherited true/explicit false", () => {
  const original = Object.freeze({ reasoning: true, compat: Object.freeze({ other: "retained" }) });
  assert.deepEqual(setCompatFlag(original, "forceAdaptiveThinking", true), { reasoning: true, compat: { other: "retained", forceAdaptiveThinking: true } });
  assert.deepEqual(setCompatFlag(original, "forceAdaptiveThinking", false), original);
  assert.equal(setCompatFlag(original, "forceAdaptiveThinking", false, true).compat.forceAdaptiveThinking, false);
  assert.deepEqual(original.compat, { other: "retained" });
  assert.equal(setCompatFlag({ compat: { forceAdaptiveThinking: true } }, "forceAdaptiveThinking", false).compat, undefined);
});
test("model endpoint/adaptive overrides round-trip without changing siblings or provider defaults", t => {
  const root = mkdtempSync(join(tmpdir(), "model-overrides-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "models.json");
  const config = { providers: { fixture: { baseUrl: "https://provider.example.test/v1", api: "anthropic-messages", models: [
    { id: "custom", baseUrl: "https://model.example.test/v1", reasoning: true, compat: { forceAdaptiveThinking: true, other: "retained" } }, { id: "sibling" },
  ] } } };
  writeModelsConfig(config, file);
  assert.deepEqual(readModelsConfig(file), config);
  delete config.providers.fixture.models[0].baseUrl;
  writeModelsConfig(config, file);
  const loaded = readModelsConfig(file);
  assert.equal(loaded.providers.fixture.models[0].baseUrl, undefined);
  assert.equal(loaded.providers.fixture.baseUrl, "https://provider.example.test/v1");
  assert.deepEqual(loaded.providers.fixture.models[1], { id: "sibling" });
});
