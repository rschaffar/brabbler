import assert from "node:assert/strict";
import test from "node:test";

import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
// Pure helpers receive fake storage; no hardware, network or connection authority.
async function subject() { return jiti.import("./browser-ssh-client.ts"); }
const origin = "https://ssh.example.test";
const a = { id: "YQ", spki: "c3BraUE", origin };
const b = { id: "Yg", spki: "c3BraUI", origin };

class FakeStorage {
  constructor(entries = []) {
    this.values = new Map(entries);
    this.reads = []; this.writes = []; this.removals = []; this.keyReads = 0;
    this.blockReads = false; this.blockWrites = false; this.beforeSet = null;
  }
  get length() { if (this.blockReads) throw new Error("blocked"); return this.values.size; }
  key(index) {
    if (this.blockReads) throw new Error("blocked");
    this.keyReads++; return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    if (this.blockReads) throw new Error("blocked");
    this.reads.push(key); return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.writes.push(key);
    if (this.blockWrites) throw new Error("quota");
    this.beforeSet?.(key, value); this.values.set(key, String(value));
  }
  removeItem(key) { this.removals.push(key); this.values.delete(key); }
}
function ack(credential, recordId = "record-a") {
  const record = { id: recordId, origin: credential.origin, credential: { id: credential.id, spki: credential.spki }, policy: "strict" };
  return {
    record,
    snapshot: { revision: "server-revision", keys: [{ ...record, credential: { ...record.credential } }] },
  };
}
function registry(recordId = "record-a", recordOrigin = origin, credential = a) {
  return { revision: "fresh-server-revision", keys: [{ id: recordId, origin: recordOrigin, credential: { id: credential.id, spki: credential.spki } }] };
}

test("browser RP eligibility excludes IP origins without blocking native loopback management", async () => {
  const s = await subject();
  for (const url of [origin, "http://localhost", "http://localhost:30141", "https://localhost"]) assert.equal(s.browserSshOriginSupported(url), true);
  for (const url of ["http://127.0.0.1", "https://127.0.0.1", "https://[::1]", "http://ssh.example.test", origin + "/path", "https://ssh.example.test.", "null"]) assert.equal(s.browserSshOriginSupported(url), false);
});

test("interleaved tabs stage distinct public identities without a shared-slot overwrite", async () => {
  const s = await subject();
  const storage = new FakeStorage([
    [s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(a)],
    [s.BROWSER_SSH_STAGED_KEY, JSON.stringify(b)],
    ["unrelated", "unchanged"],
  ]);
  let other;
  storage.beforeSet = key => {
    if (key === s.sshRecoveryStagedKey(a) && !other) other = s.stageSshPublicRecovery(b, storage);
  };
  const first = s.stageSshPublicRecovery(a, storage);
  assert.equal(first.item.persistent, true);
  assert.equal(other.item.persistent, true);
  assert.notEqual(first.item.storageKey, other.item.storageKey);
  assert.deepEqual(JSON.parse(storage.values.get(first.item.storageKey)), a);
  assert.deepEqual(JSON.parse(storage.values.get(other.item.storageKey)), b);
  assert.equal(storage.values.get(s.BROWSER_SSH_STORAGE_KEY), JSON.stringify(a));
  assert.equal(storage.values.get(s.BROWSER_SSH_STAGED_KEY), JSON.stringify(b));
  assert.equal(storage.values.get("unrelated"), "unchanged");
  const loaded = s.loadSshPublicRecovery(storage);
  assert.deepEqual(loaded.issues, []);
  assert.equal(loaded.items.filter(item => item.storageKey.startsWith(s.BROWSER_SSH_STAGED_PREFIX)).length, 2);
  assert.equal(storage.reads.includes("unrelated"), false);
});

test("stable staged keys bind both original credential ID and SPKI, plus exact origin", async () => {
  const s = await subject();
  assert.equal(s.sshRecoveryStagedKey(a), s.sshRecoveryStagedKey({ ...a }));
  assert.notEqual(s.sshRecoveryStagedKey(a), s.sshRecoveryStagedKey({ ...a, spki: b.spki }));
  assert.notEqual(s.sshRecoveryStagedKey(a), s.sshRecoveryStagedKey({ ...a, origin: origin + ":8443" }));
  const storage = new FakeStorage();
  const first = s.stageSshPublicRecovery(a, storage);
  const second = s.stageSshPublicRecovery({ ...a, spki: b.spki }, storage);
  assert.equal(first.item.persistent && second.item.persistent, true);
  assert.equal(storage.values.size, 2);
});

test("stale generic ack leaves replacements and unrelated generic slots byte-for-byte untouched", async () => {
  const s = await subject();
  const storage = new FakeStorage([
    [s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(a)],
    [s.BROWSER_SSH_STAGED_KEY, JSON.stringify(a)],
    ["brabbler:another-feature", "unrelated-original"],
  ]);
  const originals = s.loadSshPublicRecovery(storage).items;
  // An older tab does not cooperate: replace both originals *inside* hint publication.
  storage.beforeSet = key => {
    if (key.startsWith(s.BROWSER_SSH_ACK_PREFIX)) {
      storage.values.set(s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(b));
      storage.values.set(s.BROWSER_SSH_STAGED_KEY, JSON.stringify(b));
    }
  };
  for (const item of originals) assert.deepEqual(s.acknowledgeSshPublicRecovery(item, ack(a), storage).issues, []);
  assert.deepEqual(storage.removals, []);
  assert.equal(storage.values.get(s.BROWSER_SSH_STORAGE_KEY), JSON.stringify(b));
  assert.equal(storage.values.get(s.BROWSER_SSH_STAGED_KEY), JSON.stringify(b));
  assert.equal(storage.values.get("brabbler:another-feature"), "unrelated-original");
  assert.equal(storage.writes.every(key => key === s.sshRecoveryHintKey(a)), true);
  const loaded = s.loadSshPublicRecovery(storage);
  assert.equal(s.visibleSshPublicRecovery(loaded.items, registry(), storage).items.length, 2,
    "A's ack hint must not suppress B's replacement public metadata");
});

test("matching durable ack deletes only its unique key, never a distinct identity or original slot", async () => {
  const s = await subject();
  const storage = new FakeStorage([[s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(a)], [s.BROWSER_SSH_STAGED_KEY, JSON.stringify(b)]]);
  const first = s.stageSshPublicRecovery(a, storage).item;
  const second = s.stageSshPublicRecovery(b, storage).item;
  const result = s.acknowledgeSshPublicRecovery(first, ack(a), storage);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.hint, { recordId: "record-a", spki: a.spki, origin });
  assert.deepEqual(storage.removals, [first.storageKey]);
  assert.equal(storage.values.has(second.storageKey), true);
  assert.equal(storage.values.get(s.BROWSER_SSH_STORAGE_KEY), JSON.stringify(a));
  assert.equal(storage.values.get(s.BROWSER_SSH_STAGED_KEY), JSON.stringify(b));
  const stale = s.acknowledgeSshPublicRecovery(second, ack(a), storage);
  assert.equal(stale.hint, null);
  assert.deepEqual(stale.issues, ["ackMissing"]);
  assert.equal(storage.values.has(second.storageKey), true);
});

test("malformed or unrelated finish-enroll ack preserves staged and imported metadata without writing a hint", async () => {
  const s = await subject();
  const changed = mutate => { const wire = ack(a); mutate(wire); return wire; };
  const cases = [
    ["missing response", undefined],
    ["null response", null],
    ["array response", []],
    ["missing record/snapshot", {}],
    ["old ID/revision-only response", { record: { id: "record-a" }, snapshot: { revision: "rev", keys: [{ id: "record-a", origin }] } }],
    ["another credential", ack(b)],
    ["different credential ID", ack({ ...a, id: b.id })],
    ["different SPKI", ack({ ...a, spki: b.spki })],
    ["different exact origin", ack({ ...a, origin: origin + ":8443" })],
    ["missing record credential", changed(wire => { delete wire.record.credential; })],
    ["malformed record credential", changed(wire => { wire.record.credential = "not-a-credential"; })],
    ["non-string record ID", changed(wire => { wire.record.id = 42; })],
    ["missing snapshot", changed(wire => { delete wire.snapshot; })],
    ["null snapshot", changed(wire => { wire.snapshot = null; })],
    ["empty revision", changed(wire => { wire.snapshot.revision = ""; })],
    ["non-string revision", changed(wire => { wire.snapshot.revision = 42; })],
    ["missing keys", changed(wire => { delete wire.snapshot.keys; })],
    ["non-array keys", changed(wire => { wire.snapshot.keys = {}; })],
    ["empty snapshot", changed(wire => { wire.snapshot.keys = []; })],
    ["only malformed rows", changed(wire => { wire.snapshot.keys = [null, false, 7, "row", {}]; })],
    ["different snapshot record ID", changed(wire => { wire.snapshot.keys[0].id = "record-b"; })],
    ["same ID/origin but missing snapshot credential", changed(wire => { delete wire.snapshot.keys[0].credential; })],
    ["same ID/origin but wrong snapshot credential ID", changed(wire => { wire.snapshot.keys[0].credential.id = b.id; })],
    ["same ID/origin but wrong snapshot SPKI", changed(wire => { wire.snapshot.keys[0].credential.spki = b.spki; })],
    ["same ID/credential but wrong snapshot origin", changed(wire => { wire.snapshot.keys[0].origin = origin + ":8443"; })],
  ];
  const storage = new FakeStorage([
    [s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(a)],
    [s.BROWSER_SSH_STAGED_KEY, JSON.stringify(a)],
    ["unrelated", "preserved"],
  ]);
  s.stageSshPublicRecovery(a, storage);
  const originals = s.loadSshPublicRecovery(storage).items;
  assert.equal(originals.length, 3, "exercise both imported generic slots and the new staged slot");
  const preserved = [...storage.values];
  storage.reads = []; storage.writes = []; storage.removals = [];
  for (const item of originals) {
    for (const [name, response] of cases) {
      assert.deepEqual(s.acknowledgeSshPublicRecovery(item, response, storage), { hint: null, issues: ["ackMissing"] }, `${item.source}: ${name}`);
      assert.deepEqual([...storage.values], preserved, name);
    }
  }
  assert.deepEqual(storage.reads, [], "reject unrelated/malformed acknowledgements before touching storage");
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(storage.removals, []);
  assert.equal(s.visibleSshPublicRecovery(originals, registry(), storage).items.length, 3,
    "an HTTP-like success or a matching record ID alone must not suppress recovery");
});

test("a durable ack requires its exact full public row in the snapshot, not necessarily the first row", async () => {
  const s = await subject();
  const storage = new FakeStorage([[s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(a)]]);
  const item = s.stageSshPublicRecovery(a, storage).item;
  const response = ack(a);
  response.snapshot.keys.unshift(ack(b, "record-b").record);
  const result = s.acknowledgeSshPublicRecovery(item, response, storage);
  assert.deepEqual(result, { hint: { recordId: "record-a", spki: a.spki, origin }, issues: [] });
  assert.deepEqual(storage.removals, [item.storageKey]);
  assert.equal(storage.values.get(s.BROWSER_SSH_STORAGE_KEY), JSON.stringify(a));
});

test("even corrupt replacement evidence in a unique key is preserved, not cleaned up", async () => {
  const s = await subject();
  const storage = new FakeStorage();
  const item = s.stageSshPublicRecovery(a, storage).item;
  // This cannot be produced by a cooperating identity-bound writer; preserve evidence anyway.
  storage.values.set(item.storageKey, JSON.stringify(b));
  const result = s.acknowledgeSshPublicRecovery(item, ack(a), storage);
  assert.deepEqual(result.issues, ["recoveryMalformed"]);
  assert.equal(storage.values.get(item.storageKey), JSON.stringify(b));
  assert.deepEqual(storage.removals, []);
});

test("ack hint hides recovery only with a latest matching registry ID/origin; it is never authority", async () => {
  const s = await subject();
  const storage = new FakeStorage([[s.BROWSER_SSH_STORAGE_KEY, JSON.stringify({ ...a, token: "ignored", grant: "ignored" })]]);
  const item = s.loadSshPublicRecovery(storage).items[0];
  assert.deepEqual(item.credential, a, "legacy extras must never be returned as authority");
  const acknowledged = s.acknowledgeSshPublicRecovery(item, ack(a), storage);
  assert.deepEqual(Object.keys(acknowledged.hint).sort(), ["origin", "recordId", "spki"]);
  const original = [item];
  for (const current of [null, { revision: null, keys: registry().keys }, { revision: "rev", keys: [] }, registry("other-record"), registry("record-a", origin + ":8443"), registry("record-a", origin, b), { ...registry(), error: "unavailable" }]) {
    assert.equal(s.visibleSshPublicRecovery(original, current, storage).items.length, 1);
  }
  const confirmed = s.visibleSshPublicRecovery(original, registry(), storage);
  assert.deepEqual(confirmed, { items: [], issues: [] });
  assert.deepEqual(Object.keys(confirmed).sort(), ["issues", "items"]);
  assert.equal("connection" in confirmed || "grant" in confirmed || "token" in confirmed, false);
  assert.equal(s.visibleSshPublicRecovery(original, { revision: "removed", keys: [] }, storage).items.length, 1,
    "retained generic metadata reappears when the server no longer confirms the record");
  // A hint extended with copied capability/grant fields is invalid and must not be consumed.
  storage.values.set(s.sshRecoveryHintKey(a), JSON.stringify({ ...acknowledged.hint, token: "ignored", grant: "ignored" }));
  const extended = s.visibleSshPublicRecovery(original, registry(), storage);
  assert.equal(extended.items.length, 1);
  assert.deepEqual(extended.issues, ["recoveryMalformed"]);
});

test("a hint with the wrong SPKI cannot hide an item even if its server record ID matches", async () => {
  const s = await subject();
  const storage = new FakeStorage([[s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(a)]]);
  const items = s.loadSshPublicRecovery(storage).items;
  storage.values.set(s.sshRecoveryHintKey(a), JSON.stringify({ recordId: "record-a", spki: b.spki, origin }));
  assert.equal(s.visibleSshPublicRecovery(items, registry(), storage).items.length, 1);
});

test("quota/blocked storage retains complete in-page metadata and exposes a recovery notice code", async () => {
  const s = await subject();
  for (const mode of ["quota", "blocked", "absent"]) {
    const storage = mode === "absent" ? null : new FakeStorage();
    if (mode === "quota") storage.blockWrites = true;
    if (mode === "blocked") storage.blockReads = true;
    const result = s.stageSshPublicRecovery(a, storage);
    assert.equal(result.item.persistent, false);
    assert.deepEqual(result.item.credential, a);
    assert.equal(result.item.storageKey, s.sshRecoveryStagedKey(a));
    assert.deepEqual(result.issues, ["recoveryStorageUnavailable"]);
    const saved = s.acknowledgeSshPublicRecovery(result.item, ack(a), storage);
    assert.deepEqual(saved.issues, ["recoveryStorageUnavailable"]);
    const inPageHints = new Map([[s.sshRecoveryHintKey(a), saved.hint]]);
    assert.equal(s.visibleSshPublicRecovery([result.item], null, storage, inPageHints).items.length, 1);
    assert.equal(s.visibleSshPublicRecovery([result.item], registry(), storage, inPageHints).items.length, 0);
    if (storage) assert.deepEqual(storage.removals, []);
  }
});

test("malformed generic entries are preserved and reported without quoting raw contents", async () => {
  const s = await subject();
  for (const raw of ["not-json-untrusted-marker", "null", "{}", JSON.stringify({ ...a, origin: "not-an-origin" })]) {
    const storage = new FakeStorage([[s.BROWSER_SSH_STORAGE_KEY, raw], [s.BROWSER_SSH_STAGED_KEY, "{}"]]);
    const loaded = s.loadSshPublicRecovery(storage);
    assert.deepEqual(loaded.items, []);
    assert.deepEqual(loaded.issues, ["recoveryMalformed"]);
    assert.equal(JSON.stringify(loaded).includes("untrusted-marker"), false);
    assert.equal(storage.values.get(s.BROWSER_SSH_STORAGE_KEY), raw);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(storage.removals, []);
    // Explicitly restored public metadata is readable again; no guessing or auto-import occurred.
    storage.values.set(s.BROWSER_SSH_STORAGE_KEY, JSON.stringify(a));
    assert.deepEqual(s.loadSshPublicRecovery(storage).items[0].credential, a);
  }
});

test("enumeration reads at most eight new staged records and preserves excess/unrelated entries", async () => {
  const s = await subject();
  const storage = new FakeStorage([["unrelated-slot", "do-not-read"]]);
  for (let index = 0; index < 10; index++) {
    const credential = { ...a, id: `id${index}` };
    storage.values.set(s.sshRecoveryStagedKey(credential), JSON.stringify(credential));
  }
  const loaded = s.loadSshPublicRecovery(storage);
  assert.equal(loaded.items.length, s.SSH_RECOVERY_MAX_RECORDS);
  assert.deepEqual(loaded.issues, ["recoveryLimit"]);
  assert.equal(storage.reads.includes("unrelated-slot"), false);
  assert.equal(storage.reads.filter(key => key.startsWith(s.BROWSER_SSH_STAGED_PREFIX)).length, s.SSH_RECOVERY_MAX_RECORDS);
  assert.equal(storage.removals.length + storage.writes.length, 0);
  const overflow = s.stageSshPublicRecovery(b, storage);
  assert.equal(overflow.item.persistent, false);
  assert.deepEqual(overflow.item.credential, b);
  assert.deepEqual(overflow.issues, ["recoveryLimit"]);
  assert.equal(storage.values.size, 11);
});

test("a very large unrelated storage namespace has a bounded key-name scan and no value reads", async () => {
  const s = await subject();
  const storage = new FakeStorage(Array.from({ length: s.SSH_RECOVERY_MAX_KEY_SCAN + 20 }, (_, index) => [`other:${index}`, "untouched"]));
  const loaded = s.loadSshPublicRecovery(storage);
  assert.equal(storage.keyReads, s.SSH_RECOVERY_MAX_KEY_SCAN);
  assert.deepEqual(storage.reads, [s.BROWSER_SSH_STORAGE_KEY, s.BROWSER_SSH_STAGED_KEY]);
  assert.deepEqual(loaded, { items: [], issues: ["recoveryLimit"] });
});
