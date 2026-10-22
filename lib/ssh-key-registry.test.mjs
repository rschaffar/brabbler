import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { claimSshSettingsLease } from "../bin/ssh-agent-lease.js";

const { SshKeyRegistry, SshKeyRegistryError } = await createJiti(import.meta.url).import("./ssh-key-registry.ts");
const sourcePath = fileURLToPath(new URL("./ssh-key-registry.ts", import.meta.url));
const publicSpki = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64url");
const candidate = (changes = {}) => ({
  name: "Synthetic USB key", credential: { id: Buffer.from("synthetic-credential").toString("base64url"), spki: publicSpki },
  origin: "https://ssh.example.test:3443", policy: "strict", protection: null,
  discoverability: "unknown", applicationOnly: true, ...changes,
});
const copy = value => JSON.parse(JSON.stringify(value));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function fixture(t) {
  // Resolve platform /tmp aliases before invoking the intentionally no-symlink API.
  const temporary = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "ssh-key-registry-test-"));
  const root = join(temporary, "keys"), file = join(root, "registry.json");
  const registry = new SshKeyRegistry({ root });
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  return { temporary, root, file, registry };
}
function throwsCode(operation, code) {
  let caught;
  assert.throws(operation, error => { caught = error; return error instanceof SshKeyRegistryError && error.code === code; });
  return caught;
}
function writeSchema(file, value) {
  fs.writeFileSync(file, JSON.stringify(value) + "\n", { mode: 0o600 });
}
function patch(t, name, replacement) {
  const original = fs[name]; fs[name] = replacement(original);
  t.after(() => { fs[name] = original; });
}

// Tests are intentionally synthetic/private-root only: no host agent, network,
// authenticator, attestation, PIN, grants or private-key persistence is involved.
test("missing is stable initial; add persists only detached public metadata in private files", t => {
  const { root, file, registry } = fixture(t);
  assert.deepEqual(registry.snapshot(), { revision: "initial", keys: [] });
  assert.deepEqual(registry.snapshot(), { revision: "initial", keys: [] });
  assert.equal(fs.existsSync(file), false);
  assert.equal(registry.get("absent"), undefined);
  const proposed = candidate(), added = registry.add(proposed, "initial");
  assert.equal(added.snapshot.keys.length, 1); assert.deepEqual(added.record, added.snapshot.keys[0]);
  assert.match(added.record.id, /^[a-f0-9-]{36}$/);
  assert.equal(new Date(added.record.createdAt).toISOString(), added.record.createdAt);
  assert.deepEqual(Object.keys(added.record).sort(), ["id", "name", "credential", "origin", "policy", "protection", "discoverability", "applicationOnly", "createdAt"].sort());
  const disk = fs.readFileSync(file);
  assert.equal(added.snapshot.revision, hash(disk));
  assert.deepEqual(JSON.parse(disk), { version: 1, keys: [added.record] });
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(root), ["registry.json"]);
  const stable = copy(added.snapshot);
  proposed.credential.id = "changed"; added.record.name = "changed"; added.snapshot.keys.length = 0;
  assert.deepEqual(new SshKeyRegistry({ root }).snapshot(), stable);
  const fetched = registry.get(stable.keys[0].id); fetched.credential.id = "changed";
  assert.deepEqual(registry.snapshot(), stable);
});

test("default location is getAgentDir()/ssh-keys/registry.json, not a routing namespace", t => {
  const { temporary } = fixture(t);
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentRoot = join(temporary, "private-agent"); process.env.PI_CODING_AGENT_DIR = agentRoot;
  try {
    const registry = new SshKeyRegistry();
    const added = registry.add(candidate(), "initial");
    const file = join(agentRoot, "ssh-keys", "registry.json");
    assert.equal(hash(fs.readFileSync(file)), added.snapshot.revision);
    assert.equal(fs.existsSync(join(agentRoot, "ssh-routing")), false);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("metadata validation is bounded, exact, inert, and rejects hidden secret fields", t => {
  const { registry } = fixture(t);
  const valid = candidate();
  const invalidCandidates = [
    null, [], {}, { ...valid, extra: "metadata" }, { ...valid, grant: "not-stored" },
    { ...valid, pin: "not-stored" }, { ...valid, privateKey: "not-stored" },
    { ...valid, proof: {} }, { ...valid, assertion: {} }, { ...valid, capability: "not-stored" },
    { ...valid, credential: { ...valid.credential, privateKey: "not-stored" } },
    { ...valid, policy: undefined }, { ...valid, policy: null }, { ...valid, policy: "touch" },
    { ...valid, policy: false }, { ...valid, protection: 0 }, { ...valid, protection: 4 },
    { ...valid, protection: "3" }, { ...valid, protection: true }, { ...valid, protection: undefined },
    { ...valid, discoverability: "maybe" }, { ...valid, applicationOnly: "true" },
    { ...valid, applicationOnly: undefined }, { ...valid, credential: null },
    { ...valid, credential: { id: "", spki: publicSpki } },
    { ...valid, credential: { id: "YQ==", spki: publicSpki } },
    { ...valid, credential: { id: Buffer.alloc(1025).toString("base64url"), spki: publicSpki } },
    { ...valid, credential: { ...valid.credential, spki: "not-a-key" } },
    { ...valid, credential: { ...valid.credential, spki: publicSpki + "=" } },
  ];
  for (const input of invalidCandidates) throwsCode(() => registry.add(input, "initial"), "INVALID");
  const withAccessor = candidate(); let invoked = false;
  Object.defineProperty(withAccessor, "name", { get() { invoked = true; return "name"; }, enumerable: true });
  throwsCode(() => registry.add(withAccessor, "initial"), "INVALID"); assert.equal(invoked, false);
  throwsCode(() => registry.add({ ...valid, [Symbol("hidden")]: "not-stored" }, "initial"), "INVALID");
  for (const name of ["", " ", "x".repeat(81), "bad\nname", "bad\rname", "bad\tname", "bad\0name", "bad\x7fname", "bad\x85name", "bad\u202ename", "bad\u2028name", "bad\ud800name"]) {
    throwsCode(() => registry.add(candidate({ name }), "initial"), "INVALID");
  }
  assert.deepEqual(registry.snapshot(), { revision: "initial", keys: [] });
  const first = registry.add(candidate({ name: "x".repeat(80) }), "initial");
  const named = registry.rename(first.record.id, "备用 🔑", first.snapshot.revision);
  assert.equal(named.keys[0].name, "备用 🔑");
});

test("strict must be supplied by the caller; supported policy/report combinations round-trip without inference", t => {
  const { registry } = fixture(t);
  let current = registry.snapshot();
  for (const policy of ["strict", "session"]) for (const protection of [null, 1, 2, 3]) {
    const id = Buffer.from(`${policy}-${protection}`).toString("base64url");
    const added = registry.add(candidate({ policy, protection, discoverability: "non-resident", applicationOnly: false,
      credential: { id, spki: publicSpki } }), current.revision);
    assert.equal(added.record.policy, policy); assert.equal(added.record.protection, protection);
    assert.equal(added.record.discoverability, "non-resident"); assert.equal(added.record.applicationOnly, false);
    current = added.snapshot;
  }
  const resident = registry.add(candidate({ discoverability: "resident" }), current.revision);
  assert.equal(resident.record.discoverability, "resident");
});

test("origin validation is exact and delegates P-256 validation to sshIdentity", t => {
  const { registry } = fixture(t);
  for (const origin of [
    "https://ssh.example.test:3443/", "https://SSH.example.test:3443", "https://ssh.example.test:443",
    "https://ssh.example.test/path", "https://ssh.example.test?x", "https://ssh.example.test#x",
    "https://user@ssh.example.test", "https://ssh.example.test.", "http://ssh.example.test",
    "https://127.0.0.1", "https://[::1]", "file:///tmp", "null", "https://" + "a".repeat(2050),
  ]) throwsCode(() => registry.add(candidate({ origin }), "initial"), "INVALID");
  const nonP256 = generateKeyPairSync("ec", { namedCurve: "secp384r1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const ed25519 = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const trailing = Buffer.concat([Buffer.from(publicSpki, "base64url"), Buffer.from([0])]).toString("base64url");
  for (const spki of [nonP256, ed25519, trailing]) throwsCode(() => registry.add(candidate({ credential: { ...candidate().credential, spki } }), "initial"), "INVALID");
  let current = registry.snapshot();
  // Same credential ID is unique PER exact origin, not per RP/hostname.
  for (const origin of ["https://ssh.example.test:3443", "https://ssh.example.test", "http://localhost:3000"]) {
    const added = registry.add(candidate({ origin }), current.revision);
    assert.equal(added.record.origin, origin); current = added.snapshot;
  }
  assert.equal(current.keys.length, 3);
});

test("duplicate enrollment is idempotent but never updates reports, label, SPKI or policy", t => {
  const { registry, file } = fixture(t);
  const added = registry.add(candidate(), "initial"), before = fs.readFileSync(file);
  const duplicate = registry.add(candidate({ name: "Other name", protection: 3, discoverability: "resident", applicationOnly: false }), added.snapshot.revision);
  assert.deepEqual(duplicate, added); assert.deepEqual(fs.readFileSync(file), before);
  throwsCode(() => registry.add(candidate({ policy: "session" }), added.snapshot.revision), "POLICY_MISMATCH");
  const otherSpki = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  throwsCode(() => registry.add(candidate({ credential: { ...candidate().credential, spki: otherSpki } }), added.snapshot.revision), "KEY_MISMATCH");
  throwsCode(() => registry.add(candidate(), "initial"), "CONFLICT");
  assert.deepEqual(registry.snapshot(), added.snapshot);
  const empty = registry.remove(added.record.id, added.snapshot.revision);
  const session = registry.add(candidate({ policy: "session" }), empty.revision);
  throwsCode(() => registry.add(candidate(), session.snapshot.revision), "POLICY_MISMATCH");
});

test("rename/remove are compare-and-swap, preserve immutable fields, and report explicit not-found", t => {
  const { registry } = fixture(t);
  const added = registry.add(candidate(), "initial");
  const renamed = registry.rename(added.record.id, "Backup", added.snapshot.revision);
  assert.deepEqual(renamed.keys[0], { ...added.record, name: "Backup" });
  assert.notEqual(renamed.revision, added.snapshot.revision);
  assert.deepEqual(registry.rename(added.record.id, "Backup", renamed.revision), renamed);
  const conflict = throwsCode(() => registry.rename(added.record.id, "Stale", added.snapshot.revision), "CONFLICT");
  assert.deepEqual(conflict.snapshot, renamed);
  throwsCode(() => registry.remove(added.record.id, added.snapshot.revision), "CONFLICT");
  throwsCode(() => registry.rename("unknown", "Name", renamed.revision), "NOT_FOUND");
  throwsCode(() => registry.remove("unknown", renamed.revision), "NOT_FOUND");
  throwsCode(() => registry.rename(added.record.id, "bad\nname", renamed.revision), "INVALID");
  const removed = registry.remove(added.record.id, renamed.revision);
  assert.deepEqual(removed.keys, []); assert.notEqual(removed.revision, "initial");
  assert.equal(registry.get(added.record.id), undefined);
  throwsCode(() => registry.remove(added.record.id, removed.revision), "NOT_FOUND");
  throwsCode(() => registry.add(candidate(), undefined), "INVALID");
  assert.deepEqual(registry.snapshot(), removed);
});

test("capacity is 32 and idempotent enrollment at capacity is still allowed", t => {
  const { registry } = fixture(t);
  let current = registry.snapshot();
  for (let n = 0; n < 32; n++) {
    current = registry.add(candidate({ credential: { id: Buffer.from(`key-${n}`).toString("base64url"), spki: publicSpki } }), current.revision).snapshot;
  }
  throwsCode(() => registry.add(candidate(), current.revision), "LIMIT");
  const first = current.keys[0];
  const duplicate = registry.add(candidate({ credential: first.credential }), current.revision);
  assert.deepEqual(duplicate.record, first); assert.deepEqual(duplicate.snapshot, current);
  const missing = registry.remove(first.id, current.revision);
  assert.equal(registry.add(candidate(), missing.revision).snapshot.keys.length, 32);
});

test("malformed, oversized, non-UTF8 and unsupported disk state fails closed and is preserved", t => {
  const { registry, file } = fixture(t); registry.snapshot();
  for (const bytes of [Buffer.from("{"), Buffer.from(""), Buffer.from("null"), Buffer.from("[]"),
    Buffer.from('{"version":2,"keys":[]}'), Buffer.from([0xff, 0xfe]), Buffer.alloc(128 * 1024 + 1, 32)]) {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    throwsCode(() => registry.snapshot(), "CORRUPT");
    throwsCode(() => registry.get("any"), "CORRUPT");
    throwsCode(() => registry.add(candidate(), "initial"), "CORRUPT");
    throwsCode(() => registry.rename("any", "Name", "initial"), "CORRUPT");
    throwsCode(() => registry.remove("any", "initial"), "CORRUPT");
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
});

test("persisted schema checks every field, duplicate identity and ID, timestamps, and bounds", t => {
  const { registry, file } = fixture(t);
  const added = registry.add(candidate(), "initial"), base = { version: 1, keys: [added.record] };
  const cases = [
    value => { value.version = "1"; }, value => { value.extra = "not-stored"; },
    value => { value.keys = {}; }, value => { value.keys = Array(33).fill(value.keys[0]); },
    value => { value.keys[0].id = "unversioned"; }, value => { value.keys[0].createdAt = "yesterday"; },
    value => { value.keys[0].createdAt = "2026-01-01"; }, value => { delete value.keys[0].policy; },
    value => { value.keys[0].policy = "weaker"; }, value => { value.keys[0].name = ""; },
    value => { value.keys[0].name = "bad\nname"; }, value => { value.keys[0].origin += "/"; },
    value => { value.keys[0].credential.spki = "not-a-key"; }, value => { value.keys[0].credential.id = "YQ=="; },
    value => { value.keys[0].credential.pin = "not-stored"; }, value => { value.keys[0].grant = "not-stored"; },
    value => { value.keys[0].protection = 9; }, value => { value.keys[0].discoverability = null; },
    value => { value.keys[0].applicationOnly = 1; },
    value => { value.keys.push({ ...value.keys[0], id: "00000000-0000-4000-8000-000000000000" }); },
    value => { value.keys.push({ ...value.keys[0], credential: { id: "b3RoZXI", spki: publicSpki } }); },
  ];
  for (const change of cases) {
    const malformed = copy(base); change(malformed); writeSchema(file, malformed);
    const bytes = fs.readFileSync(file);
    throwsCode(() => registry.snapshot(), "CORRUPT");
    throwsCode(() => registry.add(candidate(), added.snapshot.revision), "CORRUPT");
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
});

test("revisions are actual disk bytes, never cached metadata or an in-memory revision", t => {
  const { registry, root, file } = fixture(t);
  const added = registry.add(candidate(), "initial");
  const disk = fs.readFileSync(file, "utf8"); fs.writeFileSync(file, disk + " ");
  const changed = new SshKeyRegistry({ root }).snapshot();
  assert.equal(changed.revision, hash(Buffer.from(disk + " "))); assert.notEqual(changed.revision, added.snapshot.revision);
  assert.deepEqual(changed.keys, added.snapshot.keys);
  throwsCode(() => registry.remove(added.record.id, added.snapshot.revision), "CONFLICT");
  assert.deepEqual(registry.snapshot(), changed);
});

test("unsafe registry modes, symlinks, hardlinks and non-regular files are not repaired", t => {
  const { registry, root, file, temporary } = fixture(t);
  registry.add(candidate(), "initial");
  for (const mode of [0o644, 0o620, 0o666]) {
    fs.chmodSync(file, mode);
    throwsCode(() => registry.snapshot(), "UNSAFE"); throwsCode(() => registry.add(candidate(), "initial"), "UNSAFE");
    assert.equal(fs.statSync(file).mode & 0o777, mode);
  }
  fs.chmodSync(file, 0o600);
  for (const mode of [0o750, 0o770, 0o777]) {
    fs.chmodSync(root, mode); throwsCode(() => registry.snapshot(), "UNSAFE");
    assert.equal(fs.statSync(root).mode & 0o777, mode);
  }
  fs.chmodSync(root, 0o700);
  const saved = join(temporary, "saved.json"); fs.renameSync(file, saved);
  fs.symlinkSync(saved, file); throwsCode(() => registry.snapshot(), "UNSAFE");
  throwsCode(() => registry.add(candidate(), "initial"), "UNSAFE"); assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
  fs.unlinkSync(file); fs.symlinkSync(join(temporary, "missing"), file); throwsCode(() => registry.snapshot(), "UNSAFE");
  fs.unlinkSync(file); fs.linkSync(saved, file); throwsCode(() => registry.snapshot(), "UNSAFE");
  fs.unlinkSync(file); fs.mkdirSync(file, { mode: 0o700 }); throwsCode(() => registry.snapshot(), "UNSAFE");
});

test("root and ancestor symlinks, writable parents, and foreign ownership fail closed", t => {
  const { registry, root, temporary } = fixture(t); registry.snapshot();
  const alias = join(temporary, "alias"); fs.symlinkSync(root, alias);
  throwsCode(() => new SshKeyRegistry({ root: alias }).snapshot(), "UNSAFE");
  throwsCode(() => new SshKeyRegistry({ root: join(alias, "nested") }).snapshot(), "UNSAFE");
  fs.chmodSync(temporary, 0o770); throwsCode(() => registry.snapshot(), "UNSAFE"); fs.chmodSync(temporary, 0o700);
  patch(t, "lstatSync", original => function (location, ...args) {
    const stat = original.call(fs, location, ...args);
    if (location === root) return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: process.getuid() + 1 });
    return stat;
  });
  throwsCode(() => registry.snapshot(), "UNSAFE");
});

test("filesystem-root ownership may be unmapped without relaxing registry or writable-ancestor checks", t => {
  const { registry, root } = fixture(t); const original = fs.lstatSync;
  try {
    fs.lstatSync = function(location, ...args) {
      const stat = original.call(fs, location, ...args);
      if (location === "/") return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: process.getuid() + 1, mode: (stat.mode & ~0o7777) | 0o755 });
      return stat;
    };
    assert.equal(registry.add(candidate(), "initial").snapshot.keys.length, 1);
    fs.lstatSync = function(location, ...args) {
      const stat = original.call(fs, location, ...args);
      if (location === "/") return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: process.getuid() + 1, mode: (stat.mode & ~0o7777) | 0o777 });
      return stat;
    };
    throwsCode(() => registry.snapshot(), "UNSAFE");
  } finally { fs.lstatSync = original; }
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
});

test("foreign file ownership is refused without chown or host fixture access", t => {
  const { registry, file } = fixture(t); registry.add(candidate(), "initial");
  patch(t, "lstatSync", original => function (location, ...args) {
    const stat = original.call(fs, location, ...args);
    if (location === file) return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { uid: process.getuid() + 1 });
    return stat;
  });
  throwsCode(() => registry.snapshot(), "UNSAFE");
});

test("filesystem read errors do not become empty state", t => {
  const { registry, file } = fixture(t); registry.add(candidate(), "initial");
  patch(t, "openSync", original => function (location, ...args) {
    if (location === file) throw Object.assign(new Error("synthetic read denial"), { code: "EACCES" });
    return original.call(fs, location, ...args);
  });
  throwsCode(() => registry.snapshot(), "IO"); throwsCode(() => registry.add(candidate(), "initial"), "IO");
});

test("a held lease is rejected before reading even corrupt disk state; no wait/replay", t => {
  const { registry, file } = fixture(t); registry.snapshot();
  const held = claimSshSettingsLease(file);
  try {
    fs.writeFileSync(file, "{", { mode: 0o600 });
    throwsCode(() => registry.add(candidate(), "initial"), "BUSY");
    assert.equal(fs.readFileSync(file, "utf8"), "{");
  } finally { held.release(); }
  throwsCode(() => registry.add(candidate(), "initial"), "CORRUPT");
});

test("incomplete foreign lease and unrelated staging evidence are preserved", t => {
  const { registry, root, file } = fixture(t); registry.snapshot();
  const evidence = join(root, ".registry-unfamiliar.tmp"); fs.writeFileSync(evidence, "public evidence", { mode: 0o600 });
  fs.mkdirSync(file + ".lock", { mode: 0o700 });
  throwsCode(() => registry.add(candidate(), "initial"), "BUSY");
  assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(file + ".lock"), true);
  assert.equal(fs.readFileSync(evidence, "utf8"), "public evidence");
  fs.rmdirSync(file + ".lock");
  registry.add(candidate(), "initial"); assert.equal(fs.readFileSync(evidence, "utf8"), "public evidence");
});

function childWriter(t, f, proposed) {
  const temporary = join(f.temporary, "tmp"); fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  const script = `
    const { createJiti } = await import(${JSON.stringify(import.meta.resolve("jiti"))});
    const { SshKeyRegistry } = await createJiti(${JSON.stringify(import.meta.url)}).import(${JSON.stringify(sourcePath)});
    const registry = new SshKeyRegistry({root:${JSON.stringify(f.root)}});
    process.once("message", () => {
      let result;
      try { result = {ok:true, value:registry.add(${JSON.stringify(proposed)}, "initial")}; }
      catch(error) { result = {ok:false, code:error.code, message:error.message}; }
      process.send(result, () => process.disconnect());
    });
    process.send({ready:true});
  `;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: { PATH: process.env.PATH, HOME: f.temporary, TMPDIR: temporary, XDG_CACHE_HOME: join(f.temporary, "cache"), JITI_FS_CACHE: "0", PI_CODING_AGENT_DIR: join(f.temporary, "agent"), NODE_ENV: "test" },
  });
  let stderr = ""; child.stderr.on("data", bytes => { stderr += bytes; }); child.stdout.resume();
  const closed = new Promise(resolve => child.once("close", resolve));
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM"); await closed; });
  const ready = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.on("message", message => { if (message.ready) resolve(); });
    child.once("exit", code => { if (code !== 0) reject(new Error(`child exited ${code}: ${stderr}`)); });
  });
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.on("message", message => { if (!message.ready) resolve(message); });
    child.once("exit", code => { if (code !== 0) reject(new Error(`child exited ${code}: ${stderr}`)); });
  });
  return { child, ready, result };
}

test("independent processes cannot both commit an initial revision and do not retry a loser", { timeout: 15000 }, async t => {
  const f = fixture(t); f.registry.snapshot();
  const a = childWriter(t, f, candidate({ name: "Process A" }));
  const b = childWriter(t, f, candidate({ name: "Process B", credential: { id: "cHJvY2Vzcy1i", spki: publicSpki } }));
  await Promise.all([a.ready, b.ready]);
  a.child.send({ start: true }); b.child.send({ start: true });
  const results = await Promise.all([a.result, b.result]);
  const successes = results.filter(result => result.ok), failures = results.filter(result => !result.ok);
  assert.equal(successes.length, 1); assert.equal(failures.length, 1);
  assert.ok(["BUSY", "CONFLICT"].includes(failures[0].code), JSON.stringify(failures));
  assert.deepEqual(f.registry.snapshot(), successes[0].value.snapshot);
  assert.equal(f.registry.snapshot().keys.length, 1);
});

test("atomic install orders private stage/file fsync, rename, then directory fsync", t => {
  const { registry, file, root } = fixture(t); registry.snapshot();
  const events = [];
  patch(t, "fsyncSync", original => function (fd) {
    const stat = fs.fstatSync(fd);
    events.push(stat.isDirectory() ? "directory-fsync" : "file-fsync");
    if (stat.isFile()) assert.equal(stat.mode & 0o777, 0o600);
    return original.call(fs, fd);
  });
  patch(t, "renameSync", original => function (from, to) {
    if (to === file) { assert.match(from, /\.registry-[a-f0-9-]+\.tmp$/); events.push("rename"); }
    return original.call(fs, from, to);
  });
  registry.add(candidate(), "initial");
  assert.deepEqual(events.slice(-3), ["file-fsync", "rename", "directory-fsync"]);
  assert.ok(events.slice(0, -3).every(event => event === "directory-fsync"), "ancestor entries are flushed before staging");
  assert.deepEqual(fs.readdirSync(root), ["registry.json"]);
});

for (const failure of ["write", "file-fsync", "rename"]) {
  test(`pre-install ${failure} error preserves the old registry, removes only its stage, and releases the lease`, t => {
    const { registry, file, root } = fixture(t);
    const added = registry.add(candidate(), "initial"), before = fs.readFileSync(file);
    const evidence = join(root, ".registry-unrelated.tmp"); fs.writeFileSync(evidence, "keep", { mode: 0o600 });
    const injected = () => { throw Object.assign(new Error("synthetic durability failure"), { code: "EIO" }); };
    if (failure === "write") patch(t, "writeFileSync", original => function (target, ...args) {
      if (typeof target === "number") { original.call(fs, target, Buffer.from("partial")); injected(); }
      return original.call(fs, target, ...args);
    });
    if (failure === "file-fsync") patch(t, "fsyncSync", original => function (fd) {
      if (fs.fstatSync(fd).isFile()) injected(); return original.call(fs, fd);
    });
    if (failure === "rename") patch(t, "renameSync", original => function (from, to) {
      if (to === file) injected(); return original.call(fs, from, to);
    });
    throwsCode(() => registry.rename(added.record.id, "Changed", added.snapshot.revision), "IO");
    assert.deepEqual(fs.readFileSync(file), before); assert.deepEqual(registry.snapshot(), added.snapshot);
    assert.deepEqual(fs.readdirSync(root).sort(), [".registry-unrelated.tmp", "registry.json"]);
    const lease = claimSshSettingsLease(file); lease.release();
  });
}

test("post-rename directory fsync failure is AMBIGUOUS; reload reconciles without automatic replay", t => {
  const { registry, file, root } = fixture(t); registry.snapshot();
  let installed = false, installations = 0;
  patch(t, "renameSync", original => function (from, to) {
    const result = original.call(fs, from, to);
    if (to === file) { installed = true; installations++; } return result;
  });
  const originalFsync = fs.fsyncSync;
  patch(t, "fsyncSync", original => function (fd) {
    if (installed && fs.fstatSync(fd).isDirectory()) throw Object.assign(new Error("synthetic directory fsync failure"), { code: "EIO" });
    return original.call(fs, fd);
  });
  const error = throwsCode(() => registry.add(candidate(), "initial"), "AMBIGUOUS");
  assert.match(error.message, /reload.*do not replay/i); assert.equal(error.snapshot, undefined);
  assert.equal(installations, 1); assert.equal(fs.existsSync(file + ".lock"), false);
  const actual = new SshKeyRegistry({ root }).snapshot(); assert.equal(actual.keys.length, 1);
  assert.equal(actual.revision, hash(fs.readFileSync(file)));
  throwsCode(() => registry.add(candidate(), "initial"), "CONFLICT"); assert.equal(installations, 1);
  // Caller explicitly reconciles the lost acknowledgement using the reloaded revision.
  fs.fsyncSync = originalFsync;
  assert.deepEqual(registry.add(candidate(), actual.revision), { record: actual.keys[0], snapshot: actual });
  assert.equal(installations, 1);
});

test("parent fsync failure cannot claim a commit; an explicit retry flushes preexisting parent entries", t => {
  const { registry, root, file, temporary } = fixture(t);
  const parent = fs.statSync(temporary);
  let fail = true, parentFlushed = false;
  patch(t, "fsyncSync", original => function (fd) {
    const stat = fs.fstatSync(fd);
    if (fail && stat.isDirectory()) throw Object.assign(new Error("synthetic parent durability error"), { code: "EIO" });
    if (stat.ino === parent.ino && stat.dev === parent.dev) parentFlushed = true;
    if (stat.isFile()) assert.equal(parentFlushed, true, "parent entry must be flushed before staging is acknowledged");
    return original.call(fs, fd);
  });
  throwsCode(() => registry.add(candidate(), "initial"), "IO");
  assert.equal(fs.existsSync(file), false); assert.equal(fs.existsSync(file + ".lock"), false);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  fail = false;
  assert.equal(registry.add(candidate(), "initial").snapshot.keys.length, 1);
  assert.equal(parentFlushed, true);
});
