import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createJiti } from "jiti";

// Actual native owners, not injected authorization: shared path admission,
// registered Git roots, targeted saved-header resolution and real locked store.
// Serial process-local environment/globals and private native fixtures follow
// session-reader/project-native-resources' existing fixture workflow. No SDK open,
// catalogue scan, live settings, content authorization or runtime proof.
const root = fs.mkdtempSync(join(tmpdir(), "resource-context-"));
const env = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
process.env.HOME = root; process.env.PI_CODING_AGENT_DIR = join(root, "import-agent");
fs.mkdirSync(process.env.PI_CODING_AGENT_DIR, { mode: 0o700 });
const globals = ["__piAllowedRootsCache", "__piAdditionalAllowedRoots", "__piSessionPathCache", "__piPathToSessionIdCache"];
const savedGlobals = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const methods = ["openSync", "readSync", "closeSync", "writeFileSync"];
const originals = new Map(methods.map(key => [key, Object.getOwnPropertyDescriptor(fs, key)]));
const open = new Map(), observations = []; let onRead, afterStage;
fs.openSync = (...args) => {
  const fd = originals.get("openSync").value(...args);
  if (typeof args[0] === "string" && args[0].startsWith(root) && /\.(jsonl|tmp)$/.test(args[0])) {
    const row = { file: args[0], fd, closed: false }; open.set(fd, row); observations.push(row);
  }
  return fd;
};
fs.readSync = (...args) => { if (open.has(args[0])) onRead?.(open.get(args[0])); return originals.get("readSync").value(...args); };
fs.closeSync = fd => { const result = originals.get("closeSync").value(fd); if (open.has(fd)) { open.get(fd).closed = true; open.delete(fd); } return result; };
fs.writeFileSync = (...args) => {
  const result = originals.get("writeFileSync").value(...args);
  if (typeof args[0] === "number" && open.get(args[0])?.file.endsWith(".tmp")) afterStage?.(open.get(args[0]));
  return result;
};
syncBuiltinESMExports();
const forbidden = [], sdkRestores = [];
function restore() {
  onRead = afterStage = undefined;
  for (const undo of sdkRestores) undo();
  for (const [key, descriptor] of originals) Object.defineProperty(fs, key, descriptor);
  syncBuiltinESMExports();
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
after(() => {
  restore();
  assert.equal(open.size, 0, "all actual header/stage descriptors closed before fixture removal");
  assert.deepEqual(forbidden, []);
  fs.rmSync(root, { recursive: true, force: true });
});
const jiti = createJiti(import.meta.url, { fsCache: false });
let production, reader, access, store;
try {
  const sdk = await jiti.import("@earendil-works/pi-coding-agent");
  for (const key of ["create", "open", "listAll"]) {
    const descriptor = Object.getOwnPropertyDescriptor(sdk.SessionManager, key);
    sdkRestores.push(() => { if (descriptor) Object.defineProperty(sdk.SessionManager, key, descriptor); else delete sdk.SessionManager[key]; });
    sdk.SessionManager[key] = () => { forbidden.push(key); throw new Error(`Forbidden SDK ${key}`); };
  }
  production = await jiti.import("./context.ts");
  reader = await jiti.import("../session-reader.ts");
  access = await jiti.import("../file-access.ts");
  store = await jiti.import("./preferences.ts");
} catch (error) { restore(); throw error; }
const { resolveResourceContext: resolveContext, ResourceContextError } = production;
const { readScopedPreferences: read, saveScopedPreference: save, commitScopedImport: commit } = store;
const global = { scope: "global", binding: null };
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function repository(path) {
  fs.mkdirSync(path); git(path, "init", "-qb", "main");
  git(path, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "base");
}
function fixture(t, { gitRoot = true } = {}) {
  const base = fs.mkdtempSync(join(root, "case-")), agentDir = join(base, "agent"), cwd = join(base, "project");
  fs.mkdirSync(agentDir, { mode: 0o700 });
  if (gitRoot) repository(cwd); else fs.mkdirSync(cwd);
  process.env.PI_CODING_AGENT_DIR = agentDir;
  for (const key of globals) globalThis[key] = undefined;
  access.allowFileRoot(cwd); // Real private fixture admission, never production self-registration.
  const start = observations.length;
  t.after(() => {
    onRead = afterStage = undefined;
    for (const row of observations.slice(start)) {
      assert.equal(row.closed, true, "actual native header/stage close");
      assert.throws(() => fs.fstatSync(row.fd), { code: "EBADF" });
    }
    assert.deepEqual(forbidden, []);
  });
  function session(id = "own-session", owner = cwd, directory = join(agentDir, "sessions", "project")) {
    fs.mkdirSync(directory, { recursive: true });
    const file = join(directory, `2026-01-01T00-00-00-000Z_${id}.jsonl`);
    const header = { type: "session", version: 3, id, cwd: owner, timestamp: "2026-01-01T00:00:00.000Z" };
    fs.writeFileSync(file, JSON.stringify(header) + "\n"); return { file, header, id };
  }
  return { base, agentDir, cwd, session, resource: { agentDir, origin: { scope: "global" }, kind: "skill", path: "/installed/guide/SKILL.md" } };
}
function refused(code, run) { assert.throws(run, error => error instanceof ResourceContextError && error.code === code); }
async function rejected(code, input) { await assert.rejects(resolveContext(input), error => error instanceof ResourceContextError && error.code === code); }
const target = (context, scope) => ({ scope, binding: context.selection[scope + "Binding"] });
function snapshot(path) {
  return fs.readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const file = join(path, entry.name), stat = fs.lstatSync(file);
    return entry.isDirectory() ? [[file, "directory", stat.ino, stat.mode], ...snapshot(file)]
      : [[file, stat.ino, stat.mode, entry.isSymbolicLink() ? fs.readlinkSync(file) : fs.readFileSync(file).toString("base64")]];
  });
}

test("canonical exact registered roots and linked worktrees share Project without markers or other writes", async t => {
  const f = fixture(t), linked = join(f.base, "linked"), alias = join(f.base, "alias");
  git(f.cwd, "worktree", "add", "-qb", "linked", linked); access.allowFileRoot(linked); fs.symlinkSync(linked, alias);
  const before = snapshot(f.base), a = await resolveContext({ cwd: f.cwd }), b = await resolveContext({ cwd: linked }), c = await resolveContext({ cwd: alias });
  assert.match(a.selection.projectBinding, /^[a-f0-9]{64}$/);
  assert.equal(a.selection.projectBinding, b.selection.projectBinding); assert.equal(b.selection.projectBinding, c.selection.projectBinding);
  assert.equal(c.cwd, fs.realpathSync(linked)); assert.equal(Object.isFrozen(a.selection), true); assert.equal(Object.isFrozen(a), true);
  a.assertAdmissionCurrent(); b.assertAdmissionCurrent(); c.assertAdmissionCurrent();
  assert.deepEqual(snapshot(f.base), before, "no trust/native marker, permanent registry, session or scan-index write");
  const p = target(a, "project"); await save(a.selection, p, read(a.selection, p).revision, f.resource, "disabled", a.assertAdmissionCurrent);
  assert.equal(read(b.selection, target(b, "project")).choices[0].value, "disabled");
});

for (const kind of ["nonGit", "subdirectory"]) test(`${kind} has no Project but Global and actual own saved Session work`, async t => {
  const f = fixture(t, { gitRoot: kind !== "nonGit" });
  const cwd = kind === "subdirectory" ? join(f.cwd, "subdir") : f.cwd;
  if (cwd !== f.cwd) fs.mkdirSync(cwd);
  const s = f.session("own-session", cwd), before = snapshot(f.base);
  const admitted = await resolveContext({ cwd, sessionId: s.id });
  assert.equal(admitted.selection.projectBinding, null); assert.match(admitted.selection.sessionBinding, /^[a-f0-9]{64}$/);
  assert.equal(reader.readSessionHeader(s.file).id, s.id); assert.deepEqual(snapshot(f.base), before);
  for (const scope of ["global", "session"]) {
    const own = scope === "global" ? global : target(admitted, scope);
    await save(admitted.selection, own, read(admitted.selection, own).revision, f.resource, "disabled", admitted.assertAdmissionCurrent);
    assert.equal(read(admitted.selection, own).choices.length, 1);
  }
  assert.throws(() => read(admitted.selection, { scope: "project", binding: "fabricated" }), { code: "scope" });
});

test("unknown, escaped, missing and malformed cwd cannot admit themselves; Global alone is inert", async t => {
  const f = fixture(t), outside = join(f.base, "outside"); fs.mkdirSync(outside);
  const escape = join(f.cwd, "escape"); fs.symlinkSync(outside, escape);
  const before = snapshot(f.base);
  for (const cwd of [outside, escape]) await rejected("forbidden", { cwd });
  await rejected("forbidden", { cwd: join(f.cwd, "missing") });
  for (const cwd of ["", "relative", null, 42, "/bad\0path"]) await rejected("invalid", { cwd });
  for (const input of [{ agentDir: f.agentDir }, { providerAccountId: "same-account" }, { cwd: f.cwd, sessionId: "../foreign" }]) await rejected("invalid", input);
  const a = await resolveContext(); assert.deepEqual(a.selection, { agentDir: f.agentDir, projectBinding: null, sessionBinding: null });
  a.assertAdmissionCurrent(); assert.deepEqual(snapshot(f.base), before);
});

test("repository incarnation replacement refuses captured context and never transfers Project or own Session choices", async t => {
  const f = fixture(t), s = f.session(), a = await resolveContext({ cwd: f.cwd, sessionId: s.id }), p = target(a, "project"), own = target(a, "session");
  for (const scope of [p, own]) await save(a.selection, scope, read(a.selection, scope).revision, f.resource, "disabled", a.assertAdmissionCurrent);
  const file = join(f.agentDir, "brabbler/resource-preferences.json"), before = fs.readFileSync(file);
  fs.renameSync(f.cwd, f.cwd + "-held"); repository(f.cwd);
  refused("generation", a.assertAdmissionCurrent);
  await assert.rejects(() => save(a.selection, p, read(a.selection, p).revision, f.resource, "enabled", a.assertAdmissionCurrent), ResourceContextError);
  const b = await resolveContext({ cwd: f.cwd, sessionId: s.id });
  assert.notEqual(b.selection.projectBinding, a.selection.projectBinding); assert.notEqual(b.selection.sessionBinding, a.selection.sessionBinding);
  assert.deepEqual(read(b.selection, target(b, "project")).choices, []); assert.deepEqual(read(b.selection, target(b, "session")).choices, []);
  assert.deepEqual(fs.readFileSync(file), before);
});

test("worktree registration removal invalidates the captured Project while Global remains available", async t => {
  const f = fixture(t), linked = join(f.base, "linked"); git(f.cwd, "worktree", "add", "-qb", "linked", linked); access.allowFileRoot(linked);
  const a = await resolveContext({ cwd: linked }); assert.ok(a.selection.projectBinding);
  fs.renameSync(join(f.cwd, ".git/worktrees/linked"), join(f.base, "held-registration"));
  refused("generation", a.assertAdmissionCurrent);
  const b = await resolveContext({ cwd: linked }); assert.equal(b.selection.projectBinding, null);
  assert.deepEqual(read(b.selection, global).choices, []);
});

test("targeted saved-session owner admits only actual matching ID, location and physical cwd", async t => {
  const f = fixture(t), s = f.session(), other = join(f.base, "other"); fs.mkdirSync(other); access.allowFileRoot(other);
  const alias = join(f.base, "alias"); fs.symlinkSync(f.cwd, alias);
  const before = snapshot(f.base), a = await resolveContext({ cwd: alias, sessionId: s.id });
  assert.ok(a.selection.sessionBinding); assert.equal(await reader.resolveSessionPath(s.id, { allowCatalogueScan: false }), s.file);
  await rejected("session", { cwd: other, sessionId: s.id });
  await rejected("session", { cwd: f.cwd, sessionId: "missing-id" });
  reader.cacheSessionPath("wrong-id", s.file);
  await rejected("session", { cwd: f.cwd, sessionId: "wrong-id" });
  await rejected("invalid", { sessionId: s.id });
  assert.deepEqual(snapshot(f.base), before, "lookup/refusals neither migrate nor catalogue-scan/write");
});

for (const kind of ["cached-outside", "symlink-file", "symlink-sessions", "hardlink"]) test(`${kind} cannot borrow own saved-session authority`, async t => {
  const f = fixture(t), outside = join(f.base, "outside"), external = f.session("external", f.cwd, outside);
  let id = external.id;
  if (kind === "cached-outside") {
    fs.mkdirSync(join(f.agentDir, "sessions")); // Prove containment refusal, not a missing native namespace.
    reader.cacheSessionPath(id, external.file);
  }
  else if (kind === "symlink-sessions") {
    fs.symlinkSync(outside, join(f.agentDir, "sessions"));
    reader.cacheSessionPath(id, join(f.agentDir, "sessions", basename(external.file)));
  }
  else {
    const own = f.session(); id = own.id; fs.unlinkSync(own.file);
    fs.writeFileSync(external.file, JSON.stringify({ ...external.header, id }) + "\n");
    if (kind === "symlink-file") fs.symlinkSync(external.file, own.file); else fs.linkSync(external.file, own.file);
    reader.cacheSessionPath(id, own.file);
  }
  const hinted = await reader.resolveSessionPath(id, { allowCatalogueScan: false });
  assert.ok(hinted); assert.equal(reader.readSessionHeader(hinted).id, id, "actual matching saved header is not sufficient authority");
  const before = snapshot(f.base);
  await rejected("session", { cwd: f.cwd, sessionId: id }); assert.deepEqual(snapshot(f.base), before);
  assert.deepEqual(read((await resolveContext({ cwd: f.cwd })).selection, global).choices, []);
});

for (const kind of ["id", "cwd", "timestamp", "replacement", "mode", "relocation"]) test(`saved-session ${kind} change invalidates stable captured ownership`, async t => {
  const f = fixture(t), s = f.session(), a = await resolveContext({ cwd: f.cwd, sessionId: s.id });
  if (kind === "replacement") { fs.copyFileSync(s.file, s.file + ".new"); fs.renameSync(s.file + ".new", s.file); }
  else if (kind === "mode") fs.chmodSync(s.file, (fs.statSync(s.file).mode & 0o777) ^ 0o020);
  else if (kind === "relocation") fs.renameSync(s.file, s.file + ".moved");
  else fs.writeFileSync(s.file, JSON.stringify({ ...s.header, [kind]: kind === "cwd" ? f.base : "changed-owner" }) + "\n");
  refused("generation", a.assertAdmissionCurrent);
});

test("concurrent append during actual bounded header read and later growth do not stale Session ownership", async t => {
  const f = fixture(t), s = f.session(); let appends = 0;
  onRead = row => { if (row.file === s.file) { onRead = undefined; fs.appendFileSync(s.file, '{"type":"message","id":"first"}\n'); appends++; } };
  const a = await resolveContext({ cwd: f.cwd, sessionId: s.id });
  assert.equal(appends, 1); const initial = fs.statSync(s.file);
  fs.appendFileSync(s.file, '{"type":"message","id":"second"}\n');
  fs.utimesSync(s.file, initial.atime, new Date(initial.mtimeMs + 2000));
  a.assertAdmissionCurrent(); const b = await resolveContext({ cwd: f.cwd, sessionId: s.id });
  assert.equal(a.selection.sessionBinding, b.selection.sessionBinding); assert.ok(fs.statSync(s.file).size > initial.size);
  const own = target(a, "session"); await save(a.selection, own, read(a.selection, own).revision, f.resource, "disabled", a.assertAdmissionCurrent);
  assert.equal(read(b.selection, own).choices[0].value, "disabled");
  assert.ok(observations.some(row => row.file === s.file && row.closed), "actual read-only header owner opened and closed");
});

test("server native agentDir separates preferences and refuses stale or cross-agent cached Session authority", async t => {
  const f = fixture(t), s = f.session(), a = await resolveContext({ cwd: f.cwd, sessionId: s.id });
  await save(a.selection, global, read(a.selection, global).revision, f.resource, "disabled", a.assertAdmissionCurrent);
  const other = join(f.base, "second-agent"); fs.mkdirSync(other, { mode: 0o700 }); fs.mkdirSync(join(other, "sessions"));
  process.env.PI_CODING_AGENT_DIR = other;
  refused("generation", a.assertAdmissionCurrent);
  await rejected("session", { cwd: f.cwd, sessionId: s.id }); // Existing real path cache is deliberately retained.
  const b = await resolveContext({ cwd: f.cwd }); assert.equal(b.selection.agentDir, other);
  assert.deepEqual(read(b.selection, global).choices, []);
  const privateSession = f.session(s.id, f.cwd, join(other, "sessions/project")); reader.cacheSessionPath(s.id, privateSession.file);
  assert.ok((await resolveContext({ cwd: f.cwd, sessionId: s.id })).selection.sessionBinding);
  assert.equal(read(a.selection, global).choices[0].value, "disabled", "old store remains separate, not transferred");
});

for (const operation of ["choice", "import"]) test(`native context change after real ${operation} staging vetoes publication and retains previous bytes/closed stage`, async t => {
  const f = fixture(t), a = await resolveContext({ cwd: f.cwd });
  await save(a.selection, global, read(a.selection, global).revision, f.resource, "enabled", a.assertAdmissionCurrent);
  const file = join(f.agentDir, "brabbler/resource-preferences.json"), before = fs.readFileSync(file), revision = read(a.selection, global).revision;
  let stage;
  afterStage = row => {
    stage = row; afterStage = undefined; fs.renameSync(f.cwd, f.cwd + "-held"); repository(f.cwd);
  };
  const input = { ruleVersion: 1, evidenceDigest: "a".repeat(64), fragments: [{ reference: "empty", digest: "b".repeat(64), provenance: "native-filter" }], decisions: [] };
  await assert.rejects(() => operation === "choice"
    ? save(a.selection, global, revision, f.resource, "disabled", a.assertAdmissionCurrent)
    : commit(a.selection, global, revision, input, () => input.evidenceDigest, a.assertAdmissionCurrent),
  error => error instanceof ResourceContextError && error.code === "generation");
  assert.ok(stage, "actual flushed stage reached"); assert.equal(stage.closed, true); assert.ok(fs.statSync(stage.file).size > 0);
  assert.deepEqual(fs.readFileSync(file), before); assert.equal(read(a.selection, global).importReceipt, null);
  assert.equal(fs.existsSync(file + ".lock"), false);
});

test("cwd admission revocation and native directory replacement stale the context without self-repair", async t => {
  const f = fixture(t), a = await resolveContext({ cwd: f.cwd });
  globalThis.__piAdditionalAllowedRoots.clear(); refused("generation", a.assertAdmissionCurrent);
  access.allowFileRoot(f.cwd); a.assertAdmissionCurrent();
  fs.renameSync(f.agentDir, f.agentDir + "-held"); fs.mkdirSync(f.agentDir, { mode: 0o700 });
  refused("generation", a.assertAdmissionCurrent);
  const b = await resolveContext({ cwd: f.cwd }); assert.deepEqual(read(b.selection, global).choices, []);
});
