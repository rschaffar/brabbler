import assert from "node:assert/strict";
import test from "node:test";
import manifest, { dynamic } from "./manifest.ts";

test("manifest reads the installed app name at runtime without changing identity or metadata", (t) => {
  const original = process.env.BRABBLER_APP_NAME;
  t.after(() => {
    if (original === undefined) delete process.env.BRABBLER_APP_NAME;
    else process.env.BRABBLER_APP_NAME = original;
  });
  assert.equal(dynamic, "force-dynamic");
  delete process.env.BRABBLER_APP_NAME;
  const defaults = manifest();
  assert.equal(defaults.name, "Brabbler");
  assert.equal(defaults.short_name, "Brabbler");
  for (const [value, expected] of [["", "Brabbler"], [" \t\n ", "Brabbler"], ["  Brabbler 🚀 \n", "Brabbler 🚀"], ["Another instance", "Another instance"]]) {
    process.env.BRABBLER_APP_NAME = value;
    assert.deepEqual(manifest(), { ...defaults, name: expected, short_name: expected });
  }
});
