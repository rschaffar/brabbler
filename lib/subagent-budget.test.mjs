import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJiti } from "jiti";
const { subagentInputLimits, assertSubagentInputBudget, loadSubagentInputFiles, MAX_SUBAGENT_INPUT_BYTES } = await createJiti(import.meta.url).import("./subagent-input.ts");
const model = contextWindow => ({ provider: "fixture", id: "small", contextWindow });
test("input allowance is finite, child-context based, and absolutely capped", () => {
  assert.deepEqual(subagentInputLimits(model(8000)), { maxBytes: 3200, model: "fixture/small" });
  assert.equal(subagentInputLimits(model(200_000)).maxBytes, 80_000);
  assert.equal(subagentInputLimits(model(2_000_000)).maxBytes, MAX_SUBAGENT_INPUT_BYTES);
  for (const window of [undefined, 0, -1, NaN, Infinity]) assert.deepEqual(subagentInputLimits(model(window)), {});
});
test("budget checks the same byte snapshot, including BOM and multibyte text", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "brabbler-budget-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bytes = Buffer.from("\ufefféé");
  await writeFile(join(dir, "fact.txt"), bytes);
  const files = loadSubagentInputFiles(dir, ["fact.txt", "fact.txt"], { maxBytes: bytes.length });
  assert.equal(files.length, 1);
  assert.equal(files[0].byteLength, 7);
  assert.equal(files[0].content, "éé");
  await writeFile(join(dir, "fact.txt"), "changed");
  assertSubagentInputBudget(files, { maxBytes: 7 });
  assert.throws(() => assertSubagentInputBudget(files, { maxBytes: 6, model: "fixture/small" }), /6-byte.*fixture\/small.*fewer or smaller/);
});
