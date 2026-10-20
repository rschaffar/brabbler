import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { parseSubagentModel } = await createJiti(import.meta.url).import("./subagent-model.ts");
const { splitSubagentModelReference } = await createJiti(import.meta.url).import("./subagent-model-reference.ts");
const models = ["plain", "tuned:high", "qwen:8b"].map(id => ({ provider: "fixture", id }));
const runtime = {
  getModels: () => models,
  getModel: (provider, id) => models.find(model => model.provider === provider && model.id === id),
};
test("strict references preserve whole literal colon IDs and parse only valid suffixes", () => {
  assert.equal(parseSubagentModel(runtime, undefined), undefined);
  assert.deepEqual(parseSubagentModel(runtime, " fixture/plain:high "), { model: models[0], thinkingLevel: "high" });
  assert.deepEqual(parseSubagentModel(runtime, "tuned:high"), { model: models[1] });
  assert.deepEqual(parseSubagentModel(runtime, "fixture/tuned:high:max"), { model: models[1], thinkingLevel: "max" });
  assert.deepEqual(parseSubagentModel(runtime, "qwen:8b"), { model: models[2] });
  for (const reference of ["plain:typo", "pla", "other/plain", "fixture/unknown:high"]) assert.throws(() => parseSubagentModel(runtime, reference), /not found/);
  assert.deepEqual(splitSubagentModelReference("fixture/plain:high", ref => ref === "fixture/plain"), { reference: "fixture/plain", thinkingLevel: "high" });
});
test("ambiguous exact bare IDs never choose a provider through suffixes", () => {
  const ambiguous = { ...runtime, getModels: () => [...models, { provider: "other", id: "plain" }] };
  assert.throws(() => parseSubagentModel(ambiguous, "plain"), /ambiguous/);
  assert.throws(() => parseSubagentModel(ambiguous, "plain:high"), /ambiguous/);
  assert.equal(parseSubagentModel(ambiguous, "fixture/plain:high").model, models[0]);
});
