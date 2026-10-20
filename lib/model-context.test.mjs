import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { ContextWindowError, isOverridesOnlyProvider, managedProviderKind, withContextWindowOverride, normalizeContextWindowOverrides, parseContextWindow } = await jiti.import("./model-context.ts");

test("overrides-only providers prefer their active authentication method", () => {
  for (const value of [{ modelOverrides: {} }, { modelOverrides: null }]) assert.equal(isOverridesOnlyProvider(value), true);
  for (const value of [null, [], {}, { modelOverrides: {}, models: [] }]) assert.equal(isOverridesOnlyProvider(value), false);
  const oauth = [{ id: "dual", loggedIn: false }], keys = [{ id: "dual", configured: true }];
  assert.equal(managedProviderKind("dual", oauth, keys), "apikey");
  assert.equal(managedProviderKind("dual", [{ id: "dual", loggedIn: true }], [{ id: "dual", configured: false }]), "oauth");
  assert.equal(managedProviderKind("dual", oauth, [{ id: "dual", configured: false }]), "oauth");
  assert.equal(managedProviderKind("unknown", oauth, keys), null);
});

test("context edits preserve sibling overrides, credentials, custom models and the original draft", () => {
  const original = { providers: {
    managed: { apiKey: "SYNTHETIC_TEST_ONLY", headers: { example: "keep" }, modelOverrides: { one: { maxTokens: 2048 }, two: { contextWindow: 32000 } } },
    custom: { models: [{ id: "keep", contextWindow: 100000 }] },
  } };
  const saved = normalizeContextWindowOverrides(withContextWindowOverride(original, "managed", "one", "500000"));
  assert.deepEqual(saved.providers.managed, { ...original.providers.managed, modelOverrides: { one: { maxTokens: 2048, contextWindow: 500000 }, two: { contextWindow: 32000 } } });
  assert.deepEqual(saved.providers.custom, original.providers.custom);
  assert.equal(original.providers.managed.modelOverrides.one.contextWindow, undefined);
  assert.deepEqual(withContextWindowOverride(saved, "managed", "one", undefined).providers.managed.modelOverrides.one, { maxTokens: 2048 });
});

test("clearing prunes only empty containers and safely treats prototype names as data", () => {
  const config = { providers: { managed: { modelOverrides: { one: { contextWindow: 500000 } } } } };
  assert.deepEqual(withContextWindowOverride(config, "managed", "one", undefined), { providers: {} });
  assert.deepEqual(withContextWindowOverride({ providers: {} }, "absent", "absent", undefined), { providers: {} });
  const special = withContextWindowOverride({ providers: {} }, "__proto__", "constructor", "12000");
  assert.equal(Object.hasOwn(special.providers, "__proto__"), true);
  assert.equal(special.providers.__proto__.modelOverrides.constructor.contextWindow, "12000");
  assert.equal({}.contextWindow, undefined);
});

test("typed tokens must be positive whole safe numbers and invalid drafts name their model", () => {
  for (const value of ["", " ", "500k", "100junk", "1e6", "0x100", "1.5", "-1", "0", String(Number.MAX_SAFE_INTEGER + 2), null, true, {}, 0, -1, Infinity, NaN]) {
    assert.equal(parseContextWindow(value), undefined, String(value));
    assert.throws(() => normalizeContextWindowOverrides({ providers: { managed: { modelOverrides: { one: { contextWindow: value } } } } }), error => error instanceof ContextWindowError && error.model === "managed/one");
  }
  assert.equal(parseContextWindow(" 1050000 "), 1050000);
  assert.equal(parseContextWindow(400000.5), 400000.5, "existing numeric values accepted by SDK remain saveable");
  assert.throws(() => withContextWindowOverride({ providers: { managed: { modelOverrides: { one: null } } } }, "managed", "one", "2"), /must be an object/);
});
