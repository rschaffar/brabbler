import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./draft-store.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const prefix = "pi-web:composer-draft:v1:";
function fixture() {
  const entries = new Map();
  const storage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  };
  function reload(window = { localStorage: storage }) {
    const compiledModule = { exports: {} };
    vm.runInNewContext(compiled, { module: compiledModule, exports: compiledModule.exports, window,
      require: () => ({ MAX_ATTACHED_IMAGES: 8, isBase64ImageWithinLimits: () => true }) });
    return compiledModule.exports;
  }
  return { entries, storage, reload };
}
const plain = value => JSON.parse(JSON.stringify(value));

test("literal text survives a fresh module/browser lifetime; images stay memory-only and keys stay isolated", () => {
  const f = fixture(), first = f.reload();
  const draft = { value: '  unsent\n@"my file" 🐈  ', images: [{ data: "aGVsbG8=", mimeType: "image/png" }] };
  first.setDraft("session-one", draft);
  assert.deepEqual(plain(first.getDraft("session-one")), draft);
  assert.equal([...f.entries.values()].some(value => value.includes("aGVsbG8=")), false);
  const reopened = f.reload();
  assert.deepEqual(plain(reopened.getDraft("session-one")), { value: draft.value, images: [] });
  assert.equal(reopened.getDraft("session-two"), null);
  reopened.clearDraft("session-one");
  assert.equal(f.reload().getDraft("session-one"), null);
});

test("promotion moves durable text once, restores rejected submissions and clears successfully sent text", () => {
  const f = fixture(), first = f.reload();
  first.setDraft("temporary", { value: "unsent", images: [] });
  first.rekeyDraft("temporary", "real");
  first.rekeyDraft("temporary", "real");
  const reopened = f.reload();
  assert.equal(reopened.getDraft("temporary"), null);
  assert.equal(reopened.getDraft("real").value, "unsent");
  reopened.restoreDraftSubmission("real", "rejected");
  assert.equal(f.reload().getDraft("real").value, "rejected\n\nunsent");
  reopened.setDraft("real", { value: "", images: [] });
  assert.equal(f.reload().getDraft("real"), null);
});

test("corrupt or unavailable storage never breaks drafts and failed clears cannot resurrect stale text in-page", () => {
  const f = fixture();
  for (const raw of ["invalid", "null", "[]", '{"value":3}']) {
    f.entries.set(prefix + "bad", raw);
    assert.equal(f.reload().getDraft("bad"), null);
  }
  f.entries.set(prefix + "old", JSON.stringify({ value: "stale" }));
  f.storage.setItem = f.storage.removeItem = () => { throw new Error("synthetic quota failure"); };
  const store = f.reload();
  store.setDraft("old", { value: "latest", images: [] });
  assert.equal(store.getDraft("old").value, "latest");
  store.clearDraft("old");
  assert.equal(store.getDraft("old"), null);
  const blocked = f.reload({ get localStorage() { throw new Error("synthetic private mode"); } });
  blocked.setDraft("private", { value: "memory", images: [] });
  assert.equal(blocked.getDraft("private").value, "memory");
});
