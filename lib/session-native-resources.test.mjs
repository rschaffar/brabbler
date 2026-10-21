import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const { validateNativeResourceSelection: validate, readNativeResourceSelection: read, appendNativeResourceSelection: append,
  effectiveNativeResourceSelection: effective, NATIVE_RESOURCE_SELECTION_TYPE: type, NO_NATIVE_RESOURCES: off } = await createJiti(import.meta.url).import("./session-native-resources.ts");
const selection = () => ({ version: 1, codeMode: true, mcpServers: [{ scope: "global", name: "a-server" }, { scope: "project", name: "b" }] });
const entry = data => ({ type: "custom", customType: type, data });

test("legacy, explicit off and malformed latest metadata cannot acquire or revive resources", () => {
  assert.deepEqual(read([]), off);
  assert.deepEqual(read([entry(selection()), entry(off)]), off);
  for (const invalid of [null, {}, { ...selection(), version: 2 }, { ...selection(), codeMode: "true" }]) {
    assert.deepEqual(read([entry(selection()), entry(invalid)]), off);
  }
  assert.deepEqual(read([entry(selection()), { type: "custom_message", customType: type, data: off }]), selection());
});

test("selection capture is deterministic, defensive and deeply immutable", () => {
  const original = selection(), checked = validate({ ...original, mcpServers: [...original.mcpServers].reverse() });
  assert.deepEqual(checked, original);
  original.mcpServers[0].name = "changed";
  assert.equal(checked.mcpServers[0].name, "a-server");
  assert.throws(() => checked.mcpServers.push({ scope: "global", name: "extra" }));
  assert.throws(() => { checked.mcpServers[0].scope = "project"; });
});

test("strict schema rejects duplicates, namespace aliases, unbounded names and authority-like extras", () => {
  for (const value of [null, [], {}, { ...selection(), enabled: true }, { ...selection(), version: 2 },
    { ...selection(), codeMode: 1 }, { ...selection(), mcpServers: "all" },
    ...["", "*", "../server", "server.name", "server name", "a".repeat(129)].map(name => ({ ...selection(), mcpServers: [{ scope: "global", name }] })),
    { ...selection(), mcpServers: [{ scope: "other", name: "a" }] },
    { ...selection(), mcpServers: [{ scope: "global", name: "a", url: "https://example.invalid" }] },
    { ...selection(), mcpServers: [{ scope: "global", name: "a" }, { scope: "project", name: "a" }] },
    { ...selection(), mcpServers: [{ scope: "global", name: "a-b" }, { scope: "global", name: "a_b" }] },
    { ...selection(), mcpServers: Array.from({ length: 129 }, (_, i) => ({ scope: "global", name: `s${i}` })) }]) assert.throws(() => validate(value));
});

test("accessors, sparse arrays and prototype-bearing records never execute during validation", () => {
  let invoked = false;
  const object = { version: 1, codeMode: true, get mcpServers() { invoked = true; return []; } };
  assert.throws(() => validate(object)); assert.equal(invoked, false);
  const array = []; Object.defineProperty(array, "0", { enumerable: true, get() { invoked = true; return { scope: "global", name: "a" }; } });
  assert.throws(() => validate({ ...selection(), mcpServers: array })); assert.equal(invoked, false);
  assert.throws(() => validate({ ...selection(), mcpServers: Array(1) }));
  assert.throws(() => validate(Object.assign(Object.create({ grant: true }), selection())));
});

test("Chat-only suppresses all resources before construction and project refusal never falls back to global", () => {
  assert.deepEqual(effective(selection(), { chatOnly: true, projectTrusted: true }), off);
  assert.deepEqual(effective(selection(), { chatOnly: false, projectTrusted: false }), { ...selection(), mcpServers: [{ scope: "global", name: "a-server" }] });
  assert.deepEqual(effective(selection(), { chatOnly: false, projectTrusted: true }), selection());
  assert.deepEqual(effective({ ...selection(), mcpServers: [{ scope: "project", name: "a-server" }] }, { chatOnly: false, projectTrusted: false }).mcpServers, []);
});

test("persistence writes only validated selection intent and does not borrow another snapshot", () => {
  const entries = [], manager = { appendCustomEntry(customType, data) { entries.push({ type: "custom", customType, data }); } };
  append(manager, selection()); assert.deepEqual(read(entries), selection());
  append(manager, off); assert.deepEqual(read(entries), off);
  assert.throws(() => append(manager, { ...selection(), credential: "placeholder" })); assert.equal(entries.length, 2);
});
