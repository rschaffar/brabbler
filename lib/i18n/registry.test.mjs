import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { getLocalePlugin, getSupportedLocales } = await jiti.import("./registry.ts");

test("ships only the English interface catalog", () => {
  assert.deepEqual(getSupportedLocales(), ["en"]);
  assert.equal(getLocalePlugin("en").id, "en");
  assert.equal(getLocalePlugin("en").messages["common.ok"], "OK");
  for (const id of ["zh-CN", "zh-TW", "de", "missing"]) {
    assert.equal(getLocalePlugin(id), undefined);
  }
});
