import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { createJiti } from "jiti";

// Actual W05a store, not canonical checkout/session authorization (W05b), live
// HTTP/runtime, native import derivation, discovery or content-read authority. All paths synthetic.
// Stable native forwarding installed BEFORE Jiti capture; serial per-case hooks.
const methods = ["openSync", "readSync", "closeSync", "writeFileSync", "renameSync", "mkdirSync"];
const originals = new Map(methods.map(name => [name, Object.getOwnPropertyDescriptor(fs, name)]));
const hooks = new Map(); let suppress = 0;
function restoreBuiltins() {
  hooks.clear(); for (const [name, descriptor] of originals) Object.defineProperty(fs, name, descriptor);
  syncBuiltinESMExports();
}
after(restoreBuiltins);
for (const [name, descriptor] of originals) fs[name] = (...args) => Reflect.apply((!suppress && hooks.get(name)) || descriptor.value, fs, args);
syncBuiltinESMExports();
const jiti = createJiti(import.meta.url, { fsCache: false });
let production;
try { production = await jiti.import("./preferences.ts"); } catch (error) { restoreBuiltins(); throw error; }
const { parsePreferences: parse, readScopedPreferences: read, saveScopedPreference: save, commitScopedImport: commit, copyOwnSessionChoices: copy,
  PreferencesError, PREFERENCES_MAX_BYTES: MAX, PREFERENCES_MAX_TARGETS: TARGETS, PREFERENCES_MAX_CHOICES: CHOICES } = production;
const { resolveSelection, selectionKey } = await jiti.import("./selection.ts");
const id = "11111111-1111-4111-8111-111111111111", generation = "22222222-2222-4222-8222-222222222222";
const global = Object.freeze({ scope: "global", binding: null });
const project = Object.freeze({ scope: "project", binding: "admitted-repository-A" });
const session = Object.freeze({ scope: "session", binding: "admitted-own-session-A" });
const empty = () => ({ version: 1, id, targets: [] });
const identity = (agentDir, name = "/installed/skills/guide/SKILL.md", origin = { scope: "global" }) => ({ agentDir, origin, kind: "skill", path: name });
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "resource-preferences-")), agentDir = join(root, "agent");
  // Register before work; release/join every owned native peer before removal,
  // including failed assertions. Keep cleanup errors instead of abandoning peers.
  const joins = [];
  t.after(async () => {
    hooks.clear();
    const results = await Promise.allSettled(joins.map(join => join()));
    const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
    if (errors.length) throw new AggregateError(errors, "fixture peers failed to settle");
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(agentDir, { mode: 0o700 });
  const dir = join(agentDir, "brabbler"), file = join(dir, "resource-preferences.json");
  const context = Object.freeze({ agentDir, projectBinding: project.binding, sessionBinding: session.binding });
  return { root, dir, file, context, resource: deepFreeze(identity(agentDir)), onClose(join) { joins.push(join); },
    wire(value = empty(), mode = 0o600) { fs.mkdirSync(dir, { mode: 0o700, recursive: true }); fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), { mode }); } };
}
function frozen(value) { if (value && typeof value === "object") { assert.equal(Object.isFrozen(value), true); Object.values(value).forEach(frozen); } }
function deepFreeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function failure(code, run) { assert.throws(run, error => { assert.equal(error instanceof PreferencesError, true); assert.equal(error.code, code); assert.ok(error.message.length < 100); return true; }); }
async function refusal(code, run) { await assert.rejects(run, error => { assert.equal(error instanceof PreferencesError, true); assert.equal(error.code, code); assert.ok(error.message.length < 100); return true; }); }
function patch(f, target, resource, choice) { return save(f.context, target, read(f.context, target).revision, resource, choice); }
function hook(t, method, build) {
  assert.equal(hooks.has(method), false); hooks.set(method, build(originals.get(method).value));
  t.after(() => hooks.delete(method));
}
function native(run) { suppress++; try { return run(); } finally { suppress--; } }
function observe(t, file, { beforeOpen, beforeRead, afterRead, beforeStageOpen, afterStage } = {}) {
  const io = { opens: [], reads: [], closes: [], stages: [], stageWrites: [], stageCloses: [], mutations: [] }, fds = new Set(), stageFds = new Map();
  const isStage = path => typeof path === "string" && dirname(path) === dirname(file) && path.endsWith(".tmp");
  hook(t, "openSync", original => (...args) => {
    if (args[0] === file) native(() => beforeOpen?.(io));
    const stage = isStage(args[0]);
    if (stage) native(() => beforeStageOpen?.(io, args[0]));
    let fd;
    try { fd = original(...args); }
    catch (error) { if (stage) io.stages.push({ path: args[0], flags: args[1], code: error.code }); throw error; }
    if (args[0] === file) { fds.add(fd); io.opens.push({ fd, flags: args[1] }); }
    if (stage) { stageFds.set(fd, args[0]); io.stages.push({ path: args[0], flags: args[1], fd }); }
    return fd;
  });
  hook(t, "readSync", original => (...args) => {
    if (fds.has(args[0])) native(() => beforeRead?.(io));
    const count = original(...args);
    if (fds.has(args[0])) { io.reads.push({ fd: args[0], length: args[1].length, count }); native(() => afterRead?.(io)); }
    return count;
  });
  hook(t, "closeSync", original => fd => {
    const result = original(fd);
    if (fds.has(fd)) { io.closes.push(fd); fds.delete(fd); }
    if (stageFds.has(fd)) { io.stageCloses.push(fd); stageFds.delete(fd); }
    return result;
  });
  if (afterStage) hook(t, "writeFileSync", original => (...args) => {
    const result = original(...args), stage = stageFds.get(args[0]) ?? (isStage(args[0]) ? args[0] : null);
    if (stage) native(() => {
      const stat = typeof args[0] === "number" ? fs.fstatSync(args[0]) : fs.statSync(stage);
      io.stageWrites.push({ path: stage, bytes: stat.size, ino: stat.ino, mode: stat.mode & 0o777 });
      afterStage(io, stage);
    });
    return result;
  });
  return io;
}
// Validate positive native admission, mutation and close independently of the
// expected error, so a short-circuit/setup failure cannot masquerade as a fence.
async function witnessed(t, io, run, checks, code) {
  let error, result;
  try { result = await run(); } catch (caught) { error = caught; } finally { hooks.clear(); }
  t.diagnostic(JSON.stringify({ ...io, outcome: error?.code ?? "success" }));
  const failures = [];
  for (const check of [() => {
    assert.ok(io.opens.length > 0, "qualified actual production open");
    assert.deepEqual(io.closes, io.opens.map(row => row.fd), "all actual production descriptors closed natively");
    for (const { fd, flags } of io.opens) {
      assert.ok(Number.isInteger(fd) && fd >= 0);
      assert.equal(flags & fs.constants.O_NOFOLLOW, fs.constants.O_NOFOLLOW);
      assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });
    }
  }, ...checks, () => { if (code) failure(code, () => { if (error) throw error; }); else if (error) throw error; }]) {
    try { await check(); } catch (caught) { failures.push(caught); }
  }
  if (failures.length) throw new AggregateError(failures, failures.map(item => item.message).join("; "));
  return result;
}
const targetRow = (agentDir, target = global, value = "disabled") => ({ target, generation, importReceipt: null,
  choices: [{ identity: identity(agentDir), value }] });

test("strict versioned closed state is detached and deeply immutable", () => {
  const agent = "/synthetic/agent", input = { ...empty(), targets: [targetRow(agent)] }, before = structuredClone(input);
  const result = parse(JSON.stringify(input), agent); frozen(result);
  assert.deepEqual(result, before); input.targets[0].choices[0].value = "enabled";
  assert.equal(result.targets[0].choices[0].value, "disabled");
  for (const change of [v => v.version = 2, v => v.version = "1", v => v.extra = true, v => delete v.id,
    v => v.id = "not-a-generation", v => v.targets[0].generation = "bad", v => v.targets[0].extra = 1,
    v => v.targets[0].target.extra = 1, v => v.targets[0].choices[0].extra = true,
    v => v.targets[0].choices[0].identity.extra = true, v => v.targets[0].choices[0].identity.origin.extra = true,
    v => v.targets[0].choices[0].value = "inherit", v => v.targets[0].choices[0].identity.kind = "theme",
    v => v.targets[0].choices[0].identity.path = "/bad/../path", v => v.targets[0].choices[0].identity.path = "/bad\0path"]) {
    const bad = structuredClone(before); change(bad); failure("schema", () => parse(JSON.stringify(bad), agent));
  }
  for (const bad of [null, [], 1, "x"]) failure("schema", () => parse(JSON.stringify(bad), agent));
  failure("scope", () => parse(JSON.stringify(before), "/different-context"));
});

test("duplicates, invalid JSON/UTF8/BOM, hostile depth/nodes and byte bounds refuse", () => {
  const agent = "/synthetic/agent", json = JSON.stringify(empty());
  for (const input of [json.replace('"version":1', '"version":0,"versi\\u006fn":1'), '{"a":{"x":1,"x":2}}',
    "", "{}{}", "[1,]", '{"a":01}', '{"a":1e999}', '\ufeff' + json, '{"a":"\\q"}', '{"a":"line\nbreak"}']) failure("json", () => parse(input, agent));
  failure("json", () => parse(Uint8Array.from([0xc0, 0xaf]), agent));
  failure("json", () => parse(Buffer.from('\ufeff' + json), agent));
  failure("limit", () => parse("[".repeat(18) + "0" + "]".repeat(18), agent));
  failure("limit", () => parse("[" + "0,".repeat(150_000) + "0]", agent));
  assert.equal(parse(json + " ".repeat(MAX - Buffer.byteLength(json)), agent).version, 1);
  failure("limit", () => parse(Buffer.alloc(MAX + 1), agent));
  const row = targetRow(agent);
  failure("schema", () => parse(JSON.stringify({ ...empty(), targets: [row, row] }), agent));
  row.choices.push(row.choices[0]);
  failure("schema", () => parse(JSON.stringify({ ...empty(), targets: [row] }), agent));
  failure("limit", () => parse(JSON.stringify({ ...empty(), targets: Array(TARGETS + 1).fill({}) }), agent));
  failure("limit", () => parse(JSON.stringify({ ...empty(), targets: [{ ...targetRow(agent), choices: Array(CHOICES + 1).fill(0) }] }), agent));
});

test("missing reads are inert; private atomic writes preserve unrelated native/settings sentinels", async t => {
  const f = fixture(t), first = read(f.context, global); frozen(first);
  assert.deepEqual(first.choices, []); assert.equal(fs.existsSync(f.dir), false);
  const nativeFile = join(f.context.agentDir, "settings.json"); fs.writeFileSync(nativeFile, "native sentinel");
  f.wire(); const io = observe(t, f.file);
  const saved = await witnessed(t, io, () => { const revision = read(f.context, global).revision; return save(f.context, global, revision, f.resource, "disabled"); }, [
    () => assert.ok(io.reads.some(row => row.count > 0), "qualified positive read"),
  ]);
  assert.equal(saved.choices[0].value, "disabled"); frozen(saved);
  assert.equal(fs.statSync(f.file).mode & 0o777, 0o600); assert.equal(fs.statSync(f.dir).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(f.dir), ["resource-preferences.json"]);
  assert.equal(fs.readFileSync(nativeFile, "utf8"), "native sentinel");
});

test("Global/Project/Session own choices reset only the named object/scope; revisions isolated", async t => {
  const f = fixture(t), other = identity(f.context.agentDir, "/installed/other/SKILL.md"); f.wire();
  const global0 = read(f.context, global), project0 = read(f.context, project), session0 = read(f.context, session);
  const g = await save(f.context, global, global0.revision, f.resource, "disabled");
  assert.equal(read(f.context, project).revision, project0.revision); assert.equal(read(f.context, session).revision, session0.revision);
  const p = await save(f.context, project, project0.revision, f.resource, "enabled");
  await save(f.context, session, session0.revision, f.resource, "disabled");
  assert.equal(read(f.context, global).revision, g.revision); assert.equal(read(f.context, project).revision, p.revision);
  await patch(f, project, other, "disabled");
  const before = read(f.context, project), reset = await save(f.context, project, before.revision, f.resource, "inherit");
  assert.deepEqual(reset.choices.map(row => row.identity.path), [other.path]);
  assert.equal(read(f.context, global).choices[0].value, "disabled"); assert.equal(read(f.context, session).choices[0].value, "disabled");
  await refusal("conflict", () => save(f.context, project, before.revision, other, "enabled"));
  const reopen = read(f.context, session); assert.deepEqual(reopen, read(f.context, session), "same admitted ID reopen keeps own values");
  await patch(f, project, other, "inherit"); assert.deepEqual(read(f.context, project).choices, []);
  await refusal("conflict", () => save(f.context, project, project0.revision, other, "enabled"));
});

test("scope targets match admitted opaque bindings only; project-local Global/unavailable/foreign targets refuse", async t => {
  const f = fixture(t), local = identity(f.context.agentDir, "/project/guide/SKILL.md", { scope: "project", binding: project.binding });
  await refusal("scope", () => save(f.context, global, read(f.context, global).revision, local, "enabled"));
  const noProject = { ...f.context, projectBinding: null }, noSession = { ...f.context, sessionBinding: null };
  failure("scope", () => read(noProject, project)); failure("scope", () => read(noSession, session));
  failure("scope", () => read(f.context, { scope: "session", binding: "submitted-foreign-sessionId" }));
  await refusal("scope", () => save(f.context, { scope: "session", binding: "submitted-foreign-sessionId" }, "a".repeat(64), f.resource, "disabled"));
  await refusal("scope", () => save(noProject, session, read(noProject, session).revision, local, "disabled"));
  await refusal("scope", () => save(f.context, project, read(f.context, project).revision,
    identity(f.context.agentDir, local.path, { scope: "project", binding: "other-repository" }), "disabled"));
  assert.equal(fs.existsSync(f.dir), false, "invalid admission cannot create writer paths");
  await patch(f, project, local, "disabled"); await patch(f, session, local, "enabled");
  assert.equal(read(f.context, project).choices[0].value, "disabled");
  // Registered-root and canonical live-session proofs deliberately NOT fabricated:
  // only the upstream admitted binding controls this library's comparisons.
  assert.equal(read({ ...f.context, projectBinding: null }, global).choices.length, 0);
  assert.equal(read({ ...f.context, projectBinding: null }, session).choices[0].value, "enabled");
});

test("already admitted shared worktree binding shares Project; distinct contexts/repositories/sessions isolate", async t => {
  const f = fixture(t), other = fixture(t); await patch(f, project, f.resource, "disabled");
  const linked = { ...f.context, sessionBinding: "admitted-worktree-B-session" };
  assert.deepEqual(read(linked, project), read(f.context, project));
  const secondRepo = { ...f.context, projectBinding: "admitted-repository-B" };
  assert.deepEqual(read(secondRepo, { scope: "project", binding: secondRepo.projectBinding }).choices, []);
  assert.deepEqual(read(other.context, project).choices, []);
  await patch(f, session, f.resource, "enabled");
  assert.deepEqual(read(linked, { scope: "session", binding: linked.sessionBinding }).choices, []);
  await refusal("scope", () => save(other.context, global, read(other.context, global).revision, f.resource, "disabled"));
});

test("lexical path/origin/kind/group identity retains unused choices; source retarget and parent changes do not rewrite", async t => {
  const f = fixture(t), source = join(f.root, "installed"), one = join(f.root, "one"), two = join(f.root, "two");
  fs.mkdirSync(one); fs.mkdirSync(two); fs.symlinkSync(one, source);
  const resource = identity(f.context.agentDir, source + "/./SKILL.md"), canonical = identity(f.context.agentDir, source + "/SKILL.md");
  await patch(f, global, resource, "disabled"); const before = read(f.context, global);
  fs.unlinkSync(source); fs.symlinkSync(two, source);
  assert.deepEqual(read(f.context, global), before, "no catalog/source content read or realpath in store");
  assert.equal(before.choices[0].identity.path, canonical.path);
  await patch(f, global, { ...canonical, kind: "extension" }, "enabled");
  await patch(f, global, { agentDir: f.context.agentDir, origin: { scope: "global" }, kind: "group", groupKey: "development" }, "disabled");
  assert.equal(read(f.context, global).choices.length, 3);
  const moved = identity(f.context.agentDir, source + "/new/SKILL.md"); await patch(f, global, moved, "enabled");
  const retained = read(f.context, global).choices;
  const valueOf = resource => retained.find(row => selectionKey(row.identity) === selectionKey(resource))?.value;
  assert.equal(valueOf(canonical), "disabled", "unused old skill identity retained");
  assert.equal(valueOf({ ...canonical, kind: "extension" }), "enabled", "same-path extension remains independent");
  assert.equal(valueOf(moved), "enabled", "new path has its own choice");
});

test("immutable own Session copy is independent, not inherited parent effectiveness or permissions", async t => {
  const f = fixture(t), parent = { agentDir: f.context.agentDir, origin: { scope: "global" }, kind: "group", groupKey: "off-parent" };
  await patch(f, global, parent, "disabled"); await patch(f, session, f.resource, "enabled");
  const own = read(f.context, session), input = deepFreeze({ target: own.target, choices: own.choices });
  const copied = copy(input, f.context.agentDir, "admitted-new-session"); frozen(copied);
  assert.notEqual(copied.choices, own.choices); assert.notEqual(copied.choices[0].identity, own.choices[0].identity);
  const eligibility = { source: true, trust: true, profile: true };
  const resolved = resolveSelection([{ identity: parent, choices: { global: "disabled" }, eligibility },
    { identity: f.resource, parent, choices: { session: copied.choices[0].value }, eligibility }], f.context);
  assert.equal(resolved[1].own.enabled, true); assert.equal(resolved[1].enabled, false);
  assert.deepEqual(copied.choices.map(row => row.value), ["enabled"], "copy explicit own, not effective false");
  await patch(f, session, f.resource, "disabled"); assert.equal(copied.choices[0].value, "enabled");
  failure("schema", () => copy({ ...input, permissions: {} }, f.context.agentDir, "new"));
  failure("scope", () => copy(input, f.context.agentDir, session.binding));
  failure("scope", () => copy({ target: global, choices: [] }, f.context.agentDir, "new"));
  assert.deepEqual(copy({ target: session, choices: [] }, f.context.agentDir, "new").choices, [], "no own choice never copies inherited Enabled/Off");
});

test("corrupt/unsupported data cannot be read, silently reset or overwritten", async t => {
  const f = fixture(t); f.wire(); const revision = read(f.context, global).revision;
  for (const bytes of ["bad JSON", JSON.stringify({ ...empty(), version: 2 }), "", JSON.stringify({ ...empty(), extra: true })]) {
    f.wire(bytes); const before = fs.readFileSync(f.file);
    assert.throws(() => read(f.context, global), PreferencesError);
    await assert.rejects(() => save(f.context, global, revision, f.resource, "inherit"), PreferencesError);
    assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.existsSync(f.file + ".lock"), false);
  }
});

test("no-follow private regular reads refuse symlinks/hardlinks/directories/nonprivate files or directories", t => {
  const f = fixture(t), outside = join(f.root, "outside.json"); f.wire(); fs.renameSync(f.file, outside);
  fs.symlinkSync(outside, f.file); failure("private", () => read(f.context, global)); fs.unlinkSync(f.file);
  fs.linkSync(outside, f.file); failure("private", () => read(f.context, global)); fs.unlinkSync(f.file);
  fs.mkdirSync(f.file); failure("private", () => read(f.context, global)); fs.rmdirSync(f.file);
  f.wire(); fs.chmodSync(f.file, 0o644); failure("private", () => read(f.context, global)); fs.chmodSync(f.file, 0o600);
  fs.chmodSync(f.dir, 0o755); failure("private", () => read(f.context, global)); fs.chmodSync(f.dir, 0o700);
  const held = f.dir + "-held"; fs.renameSync(f.dir, held); fs.symlinkSync(held, f.dir);
  failure("private", () => read(f.context, global));
  assert.equal(fs.readFileSync(outside, "utf8"), JSON.stringify(empty()));
});

test("oversized file refuses before bytes; positive native read witness qualifies the negative", async t => {
  const f = fixture(t); f.wire();
  const positive = observe(t, f.file);
  await witnessed(t, positive, () => read(f.context, global), [() => assert.ok(positive.reads.some(row => row.count > 0))]);
  fs.truncateSync(f.file, MAX + 1);
  let reads = 0, opens = 0;
  hook(t, "readSync", original => (...args) => { reads++; return original(...args); });
  hook(t, "openSync", original => (...args) => { opens++; return original(...args); });
  failure("limit", () => read(f.context, global)); assert.equal(reads, 0); assert.equal(opens, 0);
});

test("growth after stat is bounded to initial size plus one, closes, and refuses", async t => {
  const f = fixture(t); f.wire(); const size = fs.statSync(f.file).size;
  const io = observe(t, f.file, { beforeRead(io) { if (!io.mutations.length) { fs.appendFileSync(f.file, " ".repeat(MAX)); io.mutations.push({ kind: "grow", size: fs.statSync(f.file).size }); } } });
  await witnessed(t, io, () => read(f.context, global), [() => assert.equal(io.mutations.length, 1),
    () => assert.equal(fs.statSync(f.file).size, size + MAX),
    () => assert.equal(io.reads.reduce((n, row) => n + row.count, 0), size + 1),
    () => assert.ok(io.reads.every(row => row.length === size + 1))], "generation");
});

test("file replacement before actual open is observed and refused without reading replacement", async t => {
  const f = fixture(t); f.wire(); const old = fs.statSync(f.file).ino, replacement = f.file + ".replacement"; fs.copyFileSync(f.file, replacement);
  const io = observe(t, f.file, { beforeOpen(io) { fs.renameSync(replacement, f.file); io.mutations.push({ kind: "replace-before-open", ino: fs.statSync(f.file).ino }); } });
  await witnessed(t, io, () => read(f.context, global), [() => assert.equal(io.mutations.length, 1),
    () => assert.notEqual(fs.statSync(f.file).ino, old), () => assert.equal(io.reads.length, 0)], "generation");
});

test("in-place same-length native content rewrite after read refuses generation", async t => {
  const f = fixture(t); f.wire(); const before = fs.statSync(f.file), bytes = fs.readFileSync(f.file, "utf8").replace(id, "33333333-3333-4333-8333-333333333333");
  const io = observe(t, f.file, { afterRead(io) { if (!io.mutations.length) {
    fs.writeFileSync(f.file, bytes); fs.utimesSync(f.file, before.atime, new Date(before.mtimeMs + 1000));
    io.mutations.push({ kind: "in-place", ino: fs.statSync(f.file).ino });
  } } });
  await witnessed(t, io, () => read(f.context, global), [() => assert.equal(io.mutations.length, 1),
    () => assert.equal(fs.readFileSync(f.file, "utf8"), bytes), () => assert.equal(fs.statSync(f.file).ino, before.ino),
    () => assert.equal(fs.statSync(f.file).size, before.size), () => assert.ok(io.reads.some(row => row.count > 0))], "generation");
});

test("path replaced after actual read refuses even when old descriptor bytes/stats stay coherent", async t => {
  const f = fixture(t); f.wire(); const old = fs.statSync(f.file).ino, replacement = f.file + ".replacement"; fs.copyFileSync(f.file, replacement);
  const io = observe(t, f.file, { afterRead(io) { if (!io.mutations.length) { fs.renameSync(replacement, f.file); io.mutations.push({ kind: "replace-after-read" }); } } });
  await witnessed(t, io, () => read(f.context, global), [() => assert.equal(io.mutations.length, 1),
    () => assert.notEqual(fs.statSync(f.file).ino, old), () => assert.ok(io.reads.some(row => row.count > 0))], "generation");
});

test("stale desired revision refuses; another target save merges current full store without lost updates", async t => {
  const f = fixture(t); f.wire(); const before = read(f.context, global), p = read(f.context, project);
  await patch(f, global, f.resource, "disabled"); const bytes = fs.readFileSync(f.file);
  await refusal("conflict", () => save(f.context, global, before.revision, f.resource, "enabled")); assert.deepEqual(fs.readFileSync(f.file), bytes);
  await save(f.context, project, p.revision, f.resource, "enabled");
  assert.equal(read(f.context, global).choices[0].value, "disabled"); assert.equal(read(f.context, project).choices[0].value, "enabled");
});

test("exclusive native lock refuses reentrant concurrent writes and abandoned lock without takeover", async t => {
  const f = fixture(t); f.wire(); const revision = read(f.context, global).revision; let attempted = 0, concurrent;
  const io = observe(t, f.file, { afterStage(io) {
    attempted++; concurrent = refusal("locked", () => save(f.context, global, revision, f.resource, "enabled"));
    io.mutations.push({ kind: "concurrent-save" });
  } });
  f.onClose(async () => { await concurrent; });
  await witnessed(t, io, () => save(f.context, global, revision, f.resource, "disabled"), [
    () => assert.equal(attempted, 1), async () => { await concurrent; }, () => assert.ok(io.reads.some(row => row.count > 0))]);
  fs.mkdirSync(f.file + ".lock", { mode: 0o700 }); const ino = fs.statSync(f.file + ".lock").ino;
  await refusal("locked", () => patch(f, global, f.resource, "enabled")); assert.equal(fs.statSync(f.file + ".lock").ino, ino);
});

for (const kind of ["content", "file", "lock", "directory"]) test(`after real staging ${kind} replacement refuses publication and preserves replacement`, async t => {
  const f = fixture(t); f.wire(); const revision = read(f.context, global).revision, original = fs.readFileSync(f.file, "utf8");
  const replacement = original.replace(id, "33333333-3333-4333-8333-333333333333");
  let mutatedPath, held;
  const io = observe(t, f.file, { afterStage(io) {
    if (kind === "content") { fs.writeFileSync(f.file, replacement); const st = fs.statSync(f.file); fs.utimesSync(f.file, st.atime, new Date(st.mtimeMs + 1000)); mutatedPath = f.file; }
    else if (kind === "file") { mutatedPath = f.file; const next = f.file + ".replacement"; fs.writeFileSync(next, replacement, { mode: 0o600 }); fs.renameSync(next, f.file); }
    else if (kind === "lock") { mutatedPath = f.file + ".lock"; held = mutatedPath + ".held"; fs.renameSync(mutatedPath, held); fs.mkdirSync(mutatedPath, { mode: 0o700 }); }
    else { mutatedPath = f.dir; held = f.dir + ".held"; fs.renameSync(f.dir, held); fs.mkdirSync(f.dir, { mode: 0o700 }); }
    io.mutations.push({ kind, path: mutatedPath, ino: fs.statSync(mutatedPath).ino });
  } });
  await witnessed(t, io, () => save(f.context, global, revision, f.resource, "enabled"), [
    () => assert.equal(io.mutations.length, 1), () => assert.equal(fs.statSync(mutatedPath).ino, io.mutations[0].ino),
    () => assert.ok(io.reads.some(row => row.count > 0), "actual store read before native mutation"),
    () => { if (kind === "content" || kind === "file") assert.equal(fs.readFileSync(f.file, "utf8"), replacement);
      else if (kind === "lock") assert.equal(fs.readFileSync(f.file, "utf8"), original);
      else assert.equal(fs.existsSync(f.file), false); },
  ], "generation");
});

test("failed native exclusive stage create preserves the preexisting unowned sentinel", async t => {
  const f = fixture(t); f.wire(); const revision = read(f.context, global).revision, original = fs.readFileSync(f.file);
  const sentinel = "unowned exclusive-create sentinel"; let stage, ino;
  const io = observe(t, f.file, { beforeStageOpen(io, path) {
    stage = path; fs.writeFileSync(stage, sentinel, { flag: "wx", mode: 0o600 }); ino = fs.statSync(stage).ino;
    io.mutations.push({ kind: "preexisting-stage", path: stage, ino });
  } });
  await witnessed(t, io, () => assert.rejects(() => save(f.context, global, revision, f.resource, "enabled"), { code: "EEXIST" }), [
    () => assert.equal(io.mutations.length, 1, "native sentinel creation admitted"),
    () => assert.deepEqual(io.stages, [{ path: stage, flags: "wx", code: "EEXIST" }], "actual exclusive open refused"),
    () => assert.deepEqual(io.stageCloses, [], "no unowned stage descriptor"),
    () => assert.equal(fs.readFileSync(stage, "utf8"), sentinel, "unowned stage bytes preserved"),
    () => assert.equal(fs.statSync(stage).ino, ino, "unowned stage inode preserved"),
    () => assert.deepEqual(fs.readFileSync(f.file), original),
  ]);
});

for (const kind of ["stage", "directory", "write-failure"]) test(`failed publication preserves unowned ${kind} stage sentinel and closes owned descriptor`, async t => {
  const f = fixture(t); f.wire(); const revision = read(f.context, global).revision, original = fs.readFileSync(f.file, "utf8");
  const sentinel = `unowned ${kind} sentinel`; let stage, ino;
  const io = observe(t, f.file, { afterStage(io, path) {
    if (kind === "directory") {
      fs.renameSync(f.dir, f.dir + ".held"); fs.mkdirSync(f.dir, { mode: 0o700 }); stage = join(f.dir, basename(path));
    } else { stage = path; fs.unlinkSync(stage); }
    fs.writeFileSync(stage, sentinel, { flag: "wx", mode: 0o600 }); ino = fs.statSync(stage).ino;
    io.mutations.push({ kind, path: stage, ino });
    if (kind === "write-failure") throw Object.assign(new Error("injected after native stage write"), { code: "EIO" });
    if (kind === "stage") fs.writeFileSync(f.file, original.replace(id, "33333333-3333-4333-8333-333333333333"));
  } });
  await witnessed(t, io, async () => {
    if (kind === "write-failure") await assert.rejects(() => save(f.context, global, revision, f.resource, "enabled"), { code: "EIO" });
    else await refusal("generation", () => save(f.context, global, revision, f.resource, "enabled"));
  }, [
    () => assert.equal(io.mutations.length, 1, "native replacement admitted"),
    () => { assert.equal(io.stages.length, 1); assert.equal(io.stages[0].flags, "wx"); assert.ok(Number.isInteger(io.stages[0].fd)); },
    () => { assert.equal(io.stageWrites.length, 1); assert.ok(io.stageWrites[0].bytes > 0); assert.equal(io.stageWrites[0].mode, 0o600); assert.notEqual(io.stageWrites[0].ino, ino); },
    () => { assert.deepEqual(io.stageCloses, io.stages.map(row => row.fd)); for (const fd of io.stageCloses) assert.throws(() => fs.fstatSync(fd), { code: "EBADF" }); },
    () => assert.equal(fs.readFileSync(stage, "utf8"), sentinel, "unowned stage bytes preserved"),
    () => assert.equal(fs.statSync(stage).ino, ino, "unowned stage inode preserved"),
    () => { if (kind === "directory") { assert.equal(fs.existsSync(f.file), false); assert.equal(fs.readFileSync(join(f.dir + ".held", basename(stage)), "utf8").endsWith("\n"), true); }
      else assert.equal(fs.readFileSync(f.file, "utf8"), kind === "stage" ? original.replace(id, "33333333-3333-4333-8333-333333333333") : original); },
  ]);
});

test("two real independent processes with the same desired revision cannot lose an update", async t => {
  const f = fixture(t); f.wire(); const revision = read(f.context, global).revision;
  const modulePath = fileURLToPath(new URL("./preferences.ts", import.meta.url));
  const code = `import { createJiti } from 'jiti';
const [file, context, target, revision, identity, choice] = process.argv.slice(1);
const { saveScopedPreference } = await createJiti(import.meta.url, { fsCache: false }).import(file);
process.once('message', async () => { let result; try { result = { status: 'saved', revision: (await saveScopedPreference(JSON.parse(context), JSON.parse(target), revision, JSON.parse(identity), choice)).revision }; }
catch (error) { result = { status: 'refused', code: error.code, name: error.name }; }
process.send(result, () => process.disconnect()); }); process.send({ status: 'ready' });`;
  const children = [];
  f.onClose(async () => { for (const peer of children) if (peer.child.exitCode === null) peer.child.kill(); await Promise.all(children.map(peer => peer.done)); });
  for (const choice of ["enabled", "disabled"]) {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code, modulePath, JSON.stringify(f.context), JSON.stringify(global), revision, JSON.stringify(f.resource), choice],
      { cwd: process.cwd(), env: { ...process.env, JITI_FS_CACHE: "0" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let stderr = "", stdout = "", result, readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    child.stderr.on("data", bytes => stderr += bytes); child.stdout.on("data", bytes => stdout += bytes);
    child.on("message", message => { if (message.status === "ready") readyResolve(); else result = message; });
    const done = new Promise(resolve => {
      let childError;
      child.on("error", error => { childError = error; readyReject(error); });
      child.on("close", (status, signal) => { readyReject(new Error(`child closed before readiness: ${status}/${signal}: ${stderr}`)); resolve({ status, signal, result, stderr, stdout, error: childError }); });
    });
    children.push({ child, ready, done });
  }
  const timer = setTimeout(() => { for (const peer of children) peer.child.kill(); }, 10_000);
  try {
    await Promise.all(children.map(peer => peer.ready)); for (const peer of children) peer.child.send("go");
    const outcomes = await Promise.all(children.map(peer => peer.done));
    for (const outcome of outcomes) { assert.equal(outcome.status, 0, outcome.stderr); assert.equal(outcome.signal, null); assert.equal(outcome.stderr, ""); }
    assert.equal(outcomes.filter(row => row.result.status === "saved").length, 1);
    const refused = outcomes.find(row => row.result.status === "refused").result;
    assert.equal(refused.name, "PreferencesError"); assert.ok(["locked", "conflict"].includes(refused.code));
    const winner = outcomes.findIndex(row => row.result.status === "saved");
    assert.equal(read(f.context, global).choices[0].value, ["enabled", "disabled"][winner]);
    t.diagnostic(JSON.stringify(outcomes));
  } finally { clearTimeout(timer); }
});

for (const operation of ["choice", "import"]) for (const phase of ["initial", "prepublication"]) test(`${operation} trusted admission guard refuses at ${phase} under the existing lock without losing prior state`, async t => {
  const f = fixture(t); await patch(f, global, f.resource, "enabled");
  const before = fs.readFileSync(f.file), revision = read(f.context, global).revision;
  let staged = false, current = true, checks = 0;
  const refused = new Error("fresh context/catalog membership refused");
  const io = observe(t, f.file, {
    afterStage(io) { staged = true; io.mutations.push({ kind: "native-stage" }); },
    // Change at the actual final store-read boundary, AFTER staging/evidence
    // checks. This specifically qualifies the last admission check, not merely
    // the earlier check or the inherited store-replacement fence.
    afterRead() { if (staged) current = false; },
  });
  let error;
  try {
    const guard = () => {
      checks++; assert.equal(fs.statSync(f.file + ".lock").isDirectory(), true);
      if (phase === "initial" || !current) throw refused;
    };
    if (operation === "choice") await save(f.context, global, revision, f.resource, "disabled", guard);
    else { const input = importInput(f, []); await commit(f.context, global, revision, input, () => input.evidenceDigest, guard); }
  } catch (caught) { error = caught; } finally { hooks.clear(); }
  assert.equal(error, refused, "fresh guard refusal, not a schema/revision/setup exception");
  assert.equal(checks, phase === "initial" ? 1 : 2);
  assert.equal(io.stages.length, phase === "initial" ? 0 : 1);
  assert.deepEqual(io.closes, io.opens.map(row => row.fd));
  assert.deepEqual(io.stageCloses, io.stages.map(row => row.fd));
  for (const row of [...io.opens, ...io.stages]) assert.throws(() => fs.fstatSync(row.fd), { code: "EBADF" });
  for (const row of io.stages) assert.ok(fs.statSync(row.path).size > 0, "failure stage retained");
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.equal(read(f.context, global).importReceipt, null); assert.equal(fs.existsSync(f.file + ".lock"), false);
  t.diagnostic(JSON.stringify({ operation, phase, checks, ...io }));
});

test("fresh synchronous guard preserves scope-local CAS, whole-store exclusion and atomic import receipt/choices", async t => {
  const f = fixture(t); f.wire(); const stale = read(f.context, global).revision;
  await patch(f, global, f.resource, "enabled"); let calls = 0;
  const contenders = [];
  f.onClose(async () => { await Promise.all(contenders); });
  const guard = () => {
    calls++;
    contenders.push(refusal("locked", () => save(f.context, project, read(f.context, project).revision, f.resource, "disabled")));
  };
  await refusal("conflict", () => save(f.context, global, stale, f.resource, "disabled", guard)); assert.equal(calls, 0);
  const p = read(f.context, project); await patch(f, session, f.resource, "disabled");
  await save(f.context, project, p.revision, f.resource, "enabled", guard); assert.equal(calls, 2);
  const input = importInput(f, []), result = await commit(f.context, global, read(f.context, global).revision, input, () => input.evidenceDigest, guard);
  await Promise.all(contenders);
  assert.equal(calls, 4); assert.deepEqual(result.importReceipt, input); assert.equal(result.choices[0].value, "enabled");
  assert.equal(read(f.context, project).choices[0].value, "enabled"); assert.equal(read(f.context, session).choices[0].value, "disabled");
  assert.deepEqual(await commit(f.context, global, "obsolete", null, () => { throw new Error("no reimport"); }, () => { throw new Error("no publication"); }), result);
});

// W06a storage inputs are explicitly admitted synthetic decisions. Neither these
// labels nor the digest callback derive native semantics or grant authorization.
function importInput(f, decisions = [{ identity: f.resource, value: "disabled", rule: "individual", evidence: ["global-filter"] }]) {
  return { ruleVersion: 1, evidenceDigest: "a".repeat(64),
    fragments: [{ reference: "global-filter", digest: "b".repeat(64), provenance: "native-filter" }], decisions };
}
function importNow(f, target = global, input = importInput(f), recheck = () => input.evidenceDigest) {
  return commit(f.context, target, read(f.context, target).revision, input, recheck);
}

// Named gates hold the actual returned guard promise, not a timer/read double.
// Observe callback AND mutation promises immediately; release/join all originals
// before private fixture teardown even when an intentionally broken guard wins.
for (const operation of ["choice", "import"]) for (const phase of ["initial", "prepublication"]) for (const settlement of ["resolve", "reject", "expired"]) {
  test(`${operation} ${phase} async guard holds publication and lock until actual ${settlement} settlement`, async t => {
    const f = fixture(t); await patch(f, global, f.resource, "enabled");
    if (operation === "choice") await importNow(f, global, importInput(f, [])); // Prior receipt must survive refusal/edit.
    const before = fs.readFileSync(f.file), prior = read(f.context, global), input = importInput(f, []);
    const entered = Promise.withResolvers(), release = Promise.withResolvers(), guards = [];
    const refused = new Error("late native admission refusal"), clock = Date.now;
    let checks = 0, renames = 0, settled = false, outcome;
    f.onClose(async () => { release.resolve(); try { await outcome; await Promise.all(guards); } finally { Date.now = clock; } });
    const io = observe(t, f.file, { afterStage() {} });
    hook(t, "renameSync", original => (...args) => { renames++; return original(...args); });
    const lockAttempts = [];
    hook(t, "mkdirSync", original => (...args) => {
      try { return original(...args); }
      catch (error) { if (args[0] === f.file + ".lock") lockAttempts.push(error.code); throw error; }
    });
    const guard = () => {
      const pending = (async () => {
        if (++checks !== (phase === "initial" ? 1 : 2)) return;
        entered.resolve(); await release.promise;
        if (settlement === "reject") throw refused;
      })();
      guards.push(pending.then(() => ({ ok: true }), error => ({ error })));
      return pending;
    };
    const work = operation === "choice" ? save(f.context, global, prior.revision, f.resource, "disabled", guard)
      : commit(f.context, global, prior.revision, input, () => input.evidenceDigest, guard);
    outcome = work.then(result => { settled = true; return { result }; }, error => { settled = true; return { error }; });
    let result;
    try {
      await entered.promise;
      assert.equal(fs.existsSync(f.file + ".lock"), true, "held guard retains actual native critical ownership");
      assert.equal(settled, false, "mutation cannot settle ahead of held guard");
      assert.equal(renames, 0, "no publication while guard is held");
      assert.deepEqual(fs.readFileSync(f.file), before, "held guard preserves published bytes");
      assert.deepEqual(read(f.context, global), prior, "held guard preserves receipt and target revision");
      assert.equal(io.stages.length, phase === "initial" ? 0 : 1);
      assert.deepEqual(io.stageCloses, io.stages.map(row => row.fd));
      if (phase === "prepublication") assert.equal(io.stageWrites.length, 1, "actual flushed closed stage admitted");
      if (settlement === "expired") Date.now = () => clock() + 6000;
      // A real mkdir(EEXIST), not an operation-result or mocked-reader marker.
      await refusal("locked", () => save(f.context, project, read(f.context, project).revision, f.resource, "enabled"));
      assert.deepEqual(lockAttempts, ["EEXIST"]);
      assert.equal(fs.statSync(f.file + ".lock").isDirectory(), true, "even expired work owns its pending guard");
      assert.equal(settled, false);
    } finally {
      release.resolve();
      result = await outcome;
      await Promise.all(guards);
      Date.now = clock;
      hooks.clear();
    }
    assert.equal(fs.existsSync(f.file + ".lock"), false, "release only after original guard settles");
    if (settlement === "resolve") {
      if (result.error) throw result.error;
      assert.equal(renames, 1); assert.deepEqual(read(f.context, global), result.result);
      assert.notEqual(result.result.revision, prior.revision);
      assert.deepEqual(result.result.importReceipt, operation === "choice" ? prior.importReceipt : input);
      assert.equal(result.result.choices[0].value, operation === "choice" ? "disabled" : "enabled");
    } else {
      if (settlement === "reject") assert.equal(result.error, refused, "same late rejection is owned by the mutation");
      else { assert.equal(result.error instanceof PreferencesError, true); assert.equal(result.error.code, "generation"); }
      assert.equal(renames, 0); assert.deepEqual(fs.readFileSync(f.file), before); assert.deepEqual(read(f.context, global), prior);
      for (const stage of io.stages) assert.ok(fs.statSync(stage.path).size > 0, "closed failure stage retained");
    }
    assert.deepEqual(io.closes, io.opens.map(row => row.fd));
    for (const row of [...io.opens, ...io.stages]) assert.throws(() => fs.fstatSync(row.fd), { code: "EBADF" });
    t.diagnostic(JSON.stringify({ operation, phase, settlement, checks, renames, lockAttempts, stages: io.stages.length, closed: io.stageCloses.length }));
  });
}

for (const operation of ["choice", "import"]) for (const kind of ["content", "replacement"]) test(`${operation} final synchronous guard ${kind} mutation refuses stale store without overwrite`, async t => {
  const f = fixture(t); await patch(f, global, f.resource, "enabled");
  const prior = read(f.context, global), original = fs.readFileSync(f.file, "utf8"), oldIno = fs.statSync(f.file).ino;
  const changed = JSON.parse(original); changed.targets[0].generation = generation;
  const replacement = JSON.stringify(changed); let checks = 0, renames = 0, mutated = false;
  const io = observe(t, f.file, { afterStage() {} });
  hook(t, "renameSync", original => (from, to) => { if (from.endsWith(".tmp")) renames++; return original(from, to); });
  const guard = () => {
    if (++checks !== 2) return;
    assert.equal(io.stageCloses.length, 1, "guard follows actual closed/flushed staging");
    if (kind === "content") fs.writeFileSync(f.file, replacement);
    else { fs.writeFileSync(f.file + ".replacement", replacement, { mode: 0o600 }); fs.renameSync(f.file + ".replacement", f.file); }
    mutated = true;
    assert.equal(fs.readFileSync(f.file, "utf8"), replacement, "native mutation admitted inside guard");
  };
  const input = importInput(f, []);
  await witnessed(t, io, () => operation === "choice" ? save(f.context, global, prior.revision, f.resource, "disabled", guard)
    : commit(f.context, global, prior.revision, input, () => input.evidenceDigest, guard), [
    () => assert.equal(checks, 2), () => assert.equal(mutated, true), () => assert.equal(renames, 0),
    () => assert.equal(fs.statSync(f.file).ino === oldIno, kind === "content"),
    () => assert.equal(fs.readFileSync(f.file, "utf8"), replacement),
    () => { const current = read(f.context, global); assert.notEqual(current.revision, prior.revision); assert.deepEqual(current.choices, prior.choices); assert.equal(current.importReceipt, null); },
    () => { assert.equal(io.stages.length, 1); assert.deepEqual(io.stageCloses, io.stages.map(row => row.fd)); assert.ok(fs.statSync(io.stages[0].path).size > 0); },
  ], "generation");
});

for (const operation of ["choice", "import"]) test(`${operation} final async guard native source/evidence mutation refuses publication`, async t => {
  const f = fixture(t); await patch(f, global, f.resource, "enabled");
  const prior = read(f.context, global), before = fs.readFileSync(f.file), input = importInput(f, []);
  const source = join(f.root, "admitted-source-evidence"); fs.writeFileSync(source, input.evidenceDigest);
  const entered = Promise.withResolvers(), release = Promise.withResolvers(), guards = [];
  const refused = new Error("fresh source membership refused"); let checks = 0, evidenceReads = 0, mutated = false, outcome;
  f.onClose(async () => { release.resolve(); await outcome; await Promise.all(guards); });
  const io = observe(t, f.file, { afterStage() {} });
  const guard = () => {
    const pending = (async () => {
      if (++checks !== 2) return;
      entered.resolve(); await release.promise;
      fs.writeFileSync(source, "c".repeat(64)); mutated = true;
      // Save has no import-evidence callback: the trusted guard itself composes
      // fresh exact source membership. Import must independently recheck evidence
      // AFTER this normally returning callback, not rely on it to throw.
      if (operation === "choice" && fs.readFileSync(source, "utf8") !== input.evidenceDigest) throw refused;
    })();
    guards.push(pending.then(() => ({ ok: true }), error => ({ error }))); return pending;
  };
  const work = operation === "choice" ? save(f.context, global, prior.revision, f.resource, "disabled", guard)
    : commit(f.context, global, prior.revision, input, () => { evidenceReads++; return fs.readFileSync(source, "utf8"); }, guard);
  outcome = work.then(result => ({ result }), error => ({ error }));
  try {
    await entered.promise;
    assert.equal(io.stageWrites.length, 1); assert.deepEqual(io.stageCloses, io.stages.map(row => row.fd));
    assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.existsSync(f.file + ".lock"), true);
  } finally { release.resolve(); await outcome; await Promise.all(guards); hooks.clear(); }
  const result = await outcome;
  assert.equal(mutated, true); assert.equal(fs.readFileSync(source, "utf8"), "c".repeat(64), "actual source/evidence write qualified");
  if (operation === "choice") assert.equal(result.error, refused);
  else { assert.equal(result.error instanceof PreferencesError, true); assert.equal(result.error.code, "generation"); assert.equal(evidenceReads, 3); }
  assert.deepEqual(fs.readFileSync(f.file), before); assert.deepEqual(read(f.context, global), prior);
  assert.equal(fs.existsSync(f.file + ".lock"), false);
  assert.deepEqual(io.closes, io.opens.map(row => row.fd));
  for (const row of [...io.opens, ...io.stages]) assert.throws(() => fs.fstatSync(row.fd), { code: "EBADF" });
  assert.ok(fs.statSync(io.stages[0].path).size > 0, "closed failure stage retained");
});

test("import publishes choices and completion together at the native rename; own edits retain receipt", async t => {
  const f = fixture(t), input = importInput(f); f.wire();
  const before = fs.readFileSync(f.file), revision = read(f.context, global).revision;
  let renames = 0, checks = 0;
  hook(t, "renameSync", original => (from, to) => {
    assert.equal(to, f.file); assert.deepEqual(fs.readFileSync(to), before);
    const staged = parse(fs.readFileSync(from), f.context.agentDir).targets[0];
    assert.equal(staged.choices[0].value, "disabled"); assert.deepEqual(staged.importReceipt, input);
    assert.equal(checks, 2); renames++; return original(from, to);
  });
  const result = await commit(f.context, global, revision, input, () => { checks++; return input.evidenceDigest; });
  hooks.clear(); assert.equal(renames, 1); frozen(result); assert.deepEqual(read(f.context, global), result);
  await refusal("conflict", () => save(f.context, global, revision, f.resource, "enabled"));
  await patch(f, global, f.resource, "inherit");
  assert.deepEqual(read(f.context, global).choices, []);
  assert.deepEqual(read(f.context, global).importReceipt, input, "receipt is provenance, not a constraint on later choices");
});

test("empty Global and subsequently encountered supported Projects complete independently per agentDir", async t => {
  const f = fixture(t), other = fixture(t), input = importInput(f, []);
  const g = await importNow(f, global, input); assert.deepEqual(g.choices, []); assert.deepEqual(g.importReceipt, input);
  assert.equal(read(f.context, project).importReceipt, null);
  const p = await importNow(f, project, input); assert.deepEqual(p.importReceipt, input);
  const linked = { ...f.context, sessionBinding: "linked-worktree-session" };
  assert.deepEqual(read(linked, project), p);
  const newContext = { ...f.context, projectBinding: "subsequent-repository" };
  const target = { scope: "project", binding: newContext.projectBinding };
  assert.equal(read(newContext, target).importReceipt, null);
  await commit(newContext, target, read(newContext, target).revision, input, () => input.evidenceDigest);
  assert.equal(read(other.context, global).importReceipt, null);
  assert.equal(read(f.context, session).importReceipt, null);
  await refusal("scope", () => importNow(f, session, input));
  assert.deepEqual(read(f.context, global), g);
});

test("completed import ignores later Pi edits and stale/invalid preparation after rollback/re-upgrade", async t => {
  const f = fixture(t), settings = join(f.context.agentDir, "settings.json"), frontmatter = join(f.root, "SKILL.md");
  const registration = join(f.root, "nix-registration.json");
  fs.writeFileSync(settings, '{"skills":["-synthetic"],"unrelated":"private-sentinel"}');
  fs.writeFileSync(frontmatter, "---\ndisable-model-invocation: true\n---\nAuthored body");
  fs.writeFileSync(registration, '{"source":"/installed/package"}');
  const sentinels = [settings, frontmatter, registration].map(file => ({ file, bytes: fs.readFileSync(file), ino: fs.statSync(file).ino }));
  const result = await importNow(f), bytes = fs.readFileSync(f.file), ino = fs.statSync(f.file).ino;
  for (const row of sentinels) { assert.deepEqual(fs.readFileSync(row.file), row.bytes); assert.equal(fs.statSync(row.file).ino, row.ino); }
  // Plain Pi use while Brabbler is stopped is represented by an independent
  // synthetic native write, NOT SDK execution or safe old-binary fencing.
  fs.writeFileSync(settings, '{"skills":["+different"],"unrelated":"private-sentinel"}');
  const piAfter = fs.readFileSync(settings); let calls = 0;
  assert.deepEqual(await commit(f.context, global, "obsolete", null, () => { calls++; throw new Error("must not reimport"); }), result);
  assert.equal(calls, 0); assert.deepEqual(fs.readFileSync(f.file), bytes); assert.equal(fs.statSync(f.file).ino, ino);
  assert.deepEqual(fs.readFileSync(settings), piAfter);
  for (const row of sentinels.slice(1)) assert.deepEqual(fs.readFileSync(row.file), row.bytes);
  assert.equal(bytes.includes(Buffer.from("private-sentinel")), false);
});

test("admitted whole-package Off is a package gate for new members; narrower choices remain individual", async t => {
  const f = fixture(t), pkg = { ...f.resource, kind: "package", path: "/installed/package" };
  const child = { ...f.resource, path: "/installed/package/new/SKILL.md" };
  const individual = { ...f.resource, kind: "extension", path: "/installed/narrow.ts" };
  const result = await importNow(f, global, importInput(f, [
    { identity: pkg, value: "disabled", rule: "whole-package-off", evidence: ["global-filter"] },
    { identity: individual, value: "disabled", rule: "individual", evidence: ["global-filter"] },
  ]));
  assert.equal(result.choices.length, 2); assert.equal(result.choices.some(row => row.identity.path === child.path), false);
  const eligibility = { source: true, trust: true, profile: true };
  const resolved = resolveSelection([{ identity: pkg, choices: { global: "disabled" }, eligibility },
    { identity: child, parent: pkg, choices: {}, eligibility }], f.context);
  assert.equal(resolved[1].enabled, false);
  assert.equal(result.choices.find(row => row.identity.path === individual.path).identity.kind, "extension");
});

test("import retains unrelated and identical existing choices; conflicting uninitialized data refuses", async t => {
  const f = fixture(t), unrelated = identity(f.context.agentDir, "/unused/retained/SKILL.md");
  await patch(f, global, unrelated, "enabled"); await patch(f, project, f.resource, "enabled"); await patch(f, session, unrelated, "disabled");
  await patch(f, global, f.resource, "enabled");
  const bytes = fs.readFileSync(f.file);
  await refusal("conflict", () => importNow(f)); assert.deepEqual(fs.readFileSync(f.file), bytes);
  await patch(f, global, f.resource, "disabled");
  const p = read(f.context, project), s = read(f.context, session);
  const result = await importNow(f); assert.equal(result.choices.length, 2);
  assert.equal(result.choices.find(row => row.identity.path === unrelated.path).value, "enabled");
  assert.deepEqual(read(f.context, project), p); assert.deepEqual(read(f.context, session), s);
});

test("ambiguous, malformed, cross-scope or oversized admitted import refuses without publishing", async t => {
  const f = fixture(t); f.wire(); const before = fs.readFileSync(f.file);
  for (const change of [v => v.ruleVersion = 2, v => v.ambiguity = true, v => v.evidenceDigest = "unknown",
    v => v.fragments[0].unrelatedSettings = "forbidden", v => v.fragments.push(v.fragments[0]),
    v => v.fragments[0].reference = "x".repeat(257), v => v.decisions[0].rule = "ambiguous",
    v => v.decisions[0].evidence = ["absent"], v => v.decisions.push(v.decisions[0]),
    v => v.decisions[0].identity.kind = "package", v => v.decisions[0].value = "inherit",
    v => v.decisions[0].identity = { ...f.resource, origin: { scope: "project", binding: project.binding } },
    v => v.decisions[0].identity = { ...f.resource, agentDir: "/other/agent" }]) {
    const input = structuredClone(importInput(f)); change(input);
    await assert.rejects(() => importNow(f, global, input), PreferencesError);
    assert.deepEqual(fs.readFileSync(f.file), before); assert.equal(fs.existsSync(f.file + ".lock"), false);
    assert.equal(fs.readdirSync(f.dir).some(name => name.endsWith(".tmp")), false);
  }
  // Project import is native same-scope data, never a Global-origin override.
  await refusal("scope", () => importNow(f, project));
  const local = { ...f.resource, origin: { scope: "project", binding: project.binding } };
  const input = importInput(f, [{ identity: local, value: "enabled", rule: "individual", evidence: ["global-filter"] }]);
  assert.equal((await importNow(f, project, input)).choices[0].value, "enabled");
});

test("failed and changing synthetic native evidence prevent import, with closed retained stage", async t => {
  const f = fixture(t); f.wire(); const original = fs.readFileSync(f.file), input = importInput(f);
  const evidenceFile = join(f.root, "native-settings.json"); fs.writeFileSync(evidenceFile, input.evidenceDigest);
  let checks = 0;
  await assert.rejects(() => importNow(f, global, input, () => { checks++; throw new Error("capture unavailable"); }), /capture unavailable/);
  assert.equal(checks, 1); assert.deepEqual(fs.readFileSync(f.file), original);
  const io = observe(t, f.file, { afterStage(io) {
    fs.writeFileSync(evidenceFile, "c".repeat(64)); io.mutations.push({ kind: "native-evidence-changed" });
  } });
  await witnessed(t, io, () => importNow(f, global, input, () => { checks++; return fs.readFileSync(evidenceFile, "utf8"); }), [
    () => assert.equal(checks, 3), () => assert.equal(io.mutations.length, 1),
    () => assert.deepEqual(io.stageCloses, io.stages.map(row => row.fd)),
    () => { for (const row of io.stages) { assert.equal(fs.existsSync(row.path), true); assert.throws(() => fs.fstatSync(row.fd), { code: "EBADF" }); } },
    () => assert.deepEqual(fs.readFileSync(f.file), original),
  ], "generation");
});

test("stale/concurrent import and evidence callbacks cannot lose current store updates", async t => {
  const f = fixture(t); f.wire(); const input = importInput(f), stale = read(f.context, global).revision;
  await patch(f, global, identity(f.context.agentDir, "/other/SKILL.md"), "enabled"); const before = fs.readFileSync(f.file);
  let checks = 0;
  await refusal("conflict", () => commit(f.context, global, stale, input, () => { checks++; return input.evidenceDigest; }));
  assert.equal(checks, 0); assert.deepEqual(fs.readFileSync(f.file), before);
  const contenders = [];
  f.onClose(async () => { await Promise.all(contenders); });
  const result = await importNow(f, global, input, () => {
    contenders.push(refusal("locked", () => importNow(f, project, importInput(f, [])))); return input.evidenceDigest;
  });
  await Promise.all(contenders);
  assert.equal(contenders.length, 2); assert.equal(result.choices.length, 2);
  // A different target's update does not invalidate the target-local CAS.
  const p = read(f.context, project); await patch(f, session, f.resource, "enabled");
  await commit(f.context, project, p.revision, importInput(f, []), () => input.evidenceDigest);
  assert.equal(read(f.context, session).choices[0].value, "enabled");
});

for (const phase of ["first-check", "final-check"]) test(`external store replacement during ${phase} refuses import without overwrite`, async t => {
  const f = fixture(t); f.wire(); const input = importInput(f), replaced = JSON.stringify({ ...empty(), id: generation });
  let checks = 0;
  await refusal("generation", () => importNow(f, global, input, () => {
    checks++;
    if (checks === (phase === "first-check" ? 1 : 2)) {
      const replacement = f.file + ".replacement"; fs.writeFileSync(replacement, replaced, { mode: 0o600 }); fs.renameSync(replacement, f.file);
    }
    return input.evidenceDigest;
  }));
  assert.equal(checks, 2); assert.equal(fs.readFileSync(f.file, "utf8"), replaced);
  assert.equal(read(f.context, global).importReceipt, null);
});

for (const published of [false, true]) test(`interruption ${published ? "after rename/lost acknowledgement" : "before rename"} keeps choices and receipt inseparable`, async t => {
  const f = fixture(t); f.wire(); const before = fs.readFileSync(f.file), input = importInput(f);
  let stage, renamed = false;
  const io = observe(t, f.file);
  hook(t, "renameSync", original => (from, to) => {
    stage = from; assert.equal(to, f.file);
    const candidate = parse(native(() => fs.readFileSync(from)), f.context.agentDir).targets[0];
    assert.equal(candidate.choices.length, 1); assert.deepEqual(candidate.importReceipt, input);
    if (published) { original(from, to); renamed = true; }
    throw new Error("interrupted publication acknowledgement");
  });
  await assert.rejects(() => importNow(f), /interrupted publication acknowledgement/); hooks.clear();
  assert.equal(renamed, published); assert.equal(io.stages.length, 1);
  assert.deepEqual(io.stageCloses, io.stages.map(row => row.fd));
  for (const row of io.stages) assert.throws(() => fs.fstatSync(row.fd), { code: "EBADF" });
  const after = read(f.context, global);
  assert.equal(after.choices.length, published ? 1 : 0); assert.equal(after.importReceipt !== null, published);
  assert.equal(fs.existsSync(stage), !published);
  if (!published) assert.deepEqual(fs.readFileSync(f.file), before);
  else assert.deepEqual(await commit(f.context, global, "lost", null, () => { throw new Error("no reimport"); }), after);
});
