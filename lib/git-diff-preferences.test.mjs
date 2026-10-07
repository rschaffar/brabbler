import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_DIFF_PREFERENCES, GIT_DIFF_PREFERENCE_KEY, readDiffPreferences, writeDiffPreferences } from "./git-diff-preferences.ts";

test("diff preferences validate persisted presentation and strip all other fields", () => {
  assert.deepEqual(readDiffPreferences({ getItem: () => JSON.stringify({ view: "unified", wrap: false, contents: "private", fullFile: true }) }), { view: "unified", wrap: false });
  for (const value of [null, "{", "[]", '{"view":"after","wrap":true}', '{"view":"split","wrap":"false"}']) {
    assert.equal(readDiffPreferences({ getItem: () => value }), DEFAULT_DIFF_PREFERENCES);
  }
});
test("diff preferences tolerate absent or blocked storage and only write layout/wrapping", () => {
  assert.equal(readDiffPreferences(null), DEFAULT_DIFF_PREFERENCES);
  assert.equal(readDiffPreferences({ getItem() { throw new Error("blocked"); } }), DEFAULT_DIFF_PREFERENCES);
  const calls = [];
  writeDiffPreferences({ setItem: (...args) => calls.push(args) }, { view: "raw", wrap: true, contents: "not stored" });
  assert.deepEqual(calls, [[GIT_DIFF_PREFERENCE_KEY, '{"view":"raw","wrap":true}']]);
  assert.doesNotThrow(() => writeDiffPreferences(null, DEFAULT_DIFF_PREFERENCES));
  assert.doesNotThrow(() => writeDiffPreferences({ setItem() { throw new Error("quota"); } }, DEFAULT_DIFF_PREFERENCES));
});
