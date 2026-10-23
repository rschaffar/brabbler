import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const prefix = "pi-web:composer-draft:v1:";
function fixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete globalThis.window;
  });
  const entries = new Map();
  const storage = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, value),
    removeItem: key => entries.delete(key),
  };
  async function reload(window = { localStorage: storage }) {
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: window });
    // Fresh production singleton and real image-validation imports; only the
    // narrow storage capability survives this simulated page lifetime.
    const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
    return jiti.import("./draft-store.ts");
  }
  return { entries, storage, reload };
}

test("literal text survives a fresh module/browser lifetime; images stay memory-only and keys stay isolated", async t => {
  const f = fixture(t), first = await f.reload();
  const draft = { value: '  unsent\n@"my file" 🐈  ', images: [{ data: "aGVsbG8=", mimeType: "image/png" }] };
  first.setDraft("session-one", draft);
  assert.deepEqual(first.getDraft("session-one"), draft);
  assert.equal([...f.entries.values()].some(value => value.includes("aGVsbG8=")), false);
  const reopened = await f.reload();
  assert.deepEqual(reopened.getDraft("session-one"), { value: draft.value, images: [] });
  assert.equal(reopened.getDraft("session-two"), null);
  reopened.clearDraft("session-one");
  assert.equal((await f.reload()).getDraft("session-one"), null);
});

test("promotion moves durable text once, restores rejected submissions and clears successfully sent text", async t => {
  const f = fixture(t), first = await f.reload();
  first.setDraft("temporary", { value: "unsent", images: [] });
  first.rekeyDraft("temporary", "real");
  first.rekeyDraft("temporary", "real");
  const reopened = await f.reload();
  assert.equal(reopened.getDraft("temporary"), null);
  assert.equal(reopened.getDraft("real").value, "unsent");
  reopened.restoreDraftSubmission("real", "rejected");
  assert.equal((await f.reload()).getDraft("real").value, "rejected\n\nunsent");
  reopened.setDraft("real", { value: "", images: [] });
  assert.equal((await f.reload()).getDraft("real"), null);
});

test("corrupt or unavailable storage never breaks drafts and failed clears cannot resurrect stale text in-page", async t => {
  const f = fixture(t);
  for (const raw of ["invalid", "null", "[]", '{"value":3}']) {
    f.entries.set(prefix + "bad", raw);
    assert.equal((await f.reload()).getDraft("bad"), null);
  }
  f.entries.set(prefix + "old", JSON.stringify({ value: "stale" }));
  f.storage.setItem = f.storage.removeItem = () => { throw new Error("synthetic quota failure"); };
  const store = await f.reload();
  store.setDraft("old", { value: "latest", images: [] });
  assert.equal(store.getDraft("old").value, "latest");
  store.clearDraft("old");
  assert.equal(store.getDraft("old"), null);
  const blocked = await f.reload({ get localStorage() { throw new Error("synthetic private mode"); } });
  blocked.setDraft("private", { value: "memory", images: [] });
  assert.equal(blocked.getDraft("private").value, "memory");
});

test("restored images use the actual production validator and attachment limit", async t => {
  const f = fixture(t), store = await f.reload();
  const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
  const { MAX_ATTACHED_IMAGES } = await jiti.import("./image-attachments.ts");
  const image = { data: "aGVsbG8=", mimeType: "image/png" };
  const restored = store.restoreDraftSubmission("images", "text", [
    { data: "not base64", mimeType: "image/png" },
    { data: "aGVsbG8=", mimeType: "text/plain" },
    ...Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image),
  ]);
  assert.deepEqual(restored.images, Array.from({ length: MAX_ATTACHED_IMAGES }, () => image));
  assert.deepEqual((await f.reload()).getDraft("images"), { value: "text", images: [] });
});
