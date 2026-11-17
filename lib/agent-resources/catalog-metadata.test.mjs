import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

// Actual inert module + private native fixtures. Not native declaration/source
// admission, physical deduplication, preference-store or runtime loading proof.
// Stable forwarding functions precede the actual import: later case hooks do not
// depend on loader-held built-in bindings updating. Unhooked calls remain native.
const methods = ["openSync", "readSync", "realpathSync", "closeSync"];
const descriptors = new Map(methods.map(method => [method, Object.getOwnPropertyDescriptor(fs, method)]));
const hooks = new Map();
let suppressed = 0;
function restoreBuiltins() {
  hooks.clear();
  for (const [method, descriptor] of descriptors) Object.defineProperty(fs, method, descriptor);
  syncBuiltinESMExports();
}
after(restoreBuiltins);
for (const [method, descriptor] of descriptors) {
  fs[method] = (...args) => Reflect.apply((!suppressed && hooks.get(method)) || descriptor.value, fs, args);
}
syncBuiltinESMExports();
const jiti = createJiti(import.meta.url, { fsCache: false });
let metadata;
try { metadata = await jiti.import("./catalog-metadata.ts"); }
catch (error) { restoreBuiltins(); throw error; }
const { parseCatalogMetadata: parse, readCatalogMetadata: read, CatalogMetadataError,
  CATALOG_METADATA_MAX_BYTES: MAX_BYTES, CATALOG_METADATA_MAX_DEPTH: MAX_DEPTH,
  CATALOG_METADATA_MAX_NODES: MAX_NODES, CATALOG_METADATA_MAX_ENTRIES: MAX_ENTRIES,
  CATALOG_METADATA_MAX_PATH_LENGTH: MAX_PATH, CATALOG_METADATA_MAX_TEXT_LENGTH: MAX_TEXT } = metadata;
const empty = () => ({ version: 1, groups: [], packages: [], resources: [] });
const unboundEmpty = () => ({ binding: "unbound", version: 1, scope: "global", managedBy: "nix", groups: [], packages: [], standalone: [] });
const pkg = (source, group = null) => ({ source, name: "agent-skills-codegraph", group, managedBy: "nix" });
const packageSource = "/example/agent/skill-groups/codegraph";
const wire = () => ({ ...empty(), groups: [{ key: "development", description: "Plain text" }],
  packages: [pkg(packageSource)], resources: [
    { kind: "extension", package: packageSource, path: "extensions/codegraph/index.ts", managedBy: "nix" },
    { kind: "skill", package: packageSource, path: "skills/codegraph/SKILL.md", managedBy: "nix" },
    { kind: "skill", package: null, path: "/example/agent/skills/style/SKILL.md", group: "development", managedBy: "nix" },
  ] });
const parseWire = value => parse(JSON.stringify(value));
function failure(code, run) {
  assert.throws(run, error => {
    assert.equal(error instanceof CatalogMetadataError, true);
    assert.equal(error.code, code);
    assert.ok(error.message.length < 500, "bounded diagnostic, not hostile input echo");
    return true;
  });
}
const restorations = new WeakMap();
function restore(t) {
  for (const callback of (restorations.get(t) ?? []).reverse()) callback();
  restorations.delete(t);
}
function fixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), "catalog-metadata-"));
  t.after(() => { restore(t); fs.rmSync(root, { recursive: true, force: true }); });
  const file = join(root, "resource-catalog.json");
  const configured = { status: "configured", path: file, context: { agentDir: join(root, "agent") } };
  return { root, file, configured, write(value = wire()) { fs.writeFileSync(file, JSON.stringify(value)); } };
}
// Top-level cases are serial (node:test default). Clear case hooks on every
// outcome before fixture removal; restore original descriptors at file teardown.
function interpose(t, method, wrapper) {
  assert.equal(hooks.has(method), false, "no overlapping case hook");
  hooks.set(method, wrapper(descriptors.get(method).value));
  if (!restorations.has(t)) restorations.set(t, []);
  restorations.get(t).push(() => hooks.delete(method));
  t.after(() => restore(t));
}
function nativeEffect(run) {
  suppressed++;
  try { return run(); } finally { suppressed--; }
}
function observeIO(t, { beforeOpen, beforeRead, afterRead } = {}) {
  const io = { opens: [], reads: [], realpaths: [], closes: [] };
  interpose(t, "openSync", original => (...args) => {
    nativeEffect(() => beforeOpen?.());
    const fd = original(...args); io.opens.push({ path: args[0], fd }); return fd;
  });
  interpose(t, "readSync", original => (...args) => {
    nativeEffect(() => beforeRead?.());
    const count = original(...args);
    io.reads.push({ fd: args[0], buffer: args[1].length, count });
    nativeEffect(() => afterRead?.());
    return count;
  });
  interpose(t, "realpathSync", original => (...args) => {
    const path = original(...args); io.realpaths.push(args[0]); return path;
  });
  interpose(t, "closeSync", original => fd => {
    const result = original(fd); io.closes.push(fd); return result;
  });
  return io;
}
function closedDescriptors(io) {
  assert.ok(io.opens.length > 0, "actual production open observed");
  for (const { fd } of io.opens) assert.ok(Number.isInteger(fd) && fd >= 0, "actual integer descriptor");
  assert.deepEqual(io.closes, io.opens.map(({ fd }) => fd), "each actual descriptor closed natively");
  for (const { fd } of io.opens) assert.throws(() => fs.fstatSync(fd), { code: "EBADF" });
}
// Capture the operation first. Run every witness independently of the expected
// error assertion, so a missing/wrong error cannot hide an unadmitted mutation.
function witnessedRead(t, configured, io, checks, expectedCode) {
  let result, error;
  try { result = read(configured); } catch (caught) { error = caught; }
  finally { restore(t); }
  t.diagnostic(JSON.stringify({ ...io, outcome: error?.code ?? result?.status }));
  const errors = [];
  for (const check of [() => closedDescriptors(io), ...checks, () => {
    if (expectedCode) failure(expectedCode, () => { if (error) throw error; });
    else { if (error) throw error; assert.equal(result.status, "loaded"); }
  }]) {
    try { check(); } catch (caught) { errors.push(caught); }
  }
  if (errors.length) throw new AggregateError(errors, errors.map(item => item.message).join("; "));
  return result;
}
function frozen(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(frozen);
}

test("closed producer v1 normalizes immutable UNBOUND declarations, not availability/authority", () => {
  const input = wire(), before = structuredClone(input), result = parseWire(input);
  assert.deepEqual(result, { ...unboundEmpty(), groups: [{ key: "development", purpose: "Plain text" }],
    packages: [{ source: packageSource, label: "agent-skills-codegraph", group: null, members: [
      { kind: "extension", path: "extensions/codegraph/index.ts" }, { kind: "skill", path: "skills/codegraph/SKILL.md" },
    ] }], standalone: [{ kind: "skill", path: "/example/agent/skills/style/SKILL.md", group: "development" }] });
  frozen(result);
  input.resources[0].path = "changed.ts";
  assert.equal(result.packages[0].members[0].path, before.resources[0].path);
  assert.deepEqual(parseWire(empty()), unboundEmpty());
  assert.deepEqual(result.packages[0].members.map(member => member.kind), ["extension", "skill"]);
  assert.equal(result.packages[0].group, null, "no implicit Core group");
});

test("every object is closed; required fields/types/version/ownership and old/native schemas refuse", () => {
  const locations = [value => value, value => value.groups[0], value => value.packages[0],
    value => value.resources[0], value => value.resources[2]];
  for (const location of locations) {
    for (const extra of ["id", "alias", "enabled", "dependencies", "skills", "extensions", "package", "managedBy", "resources", "scope", "members", "standalone", "label", "purpose"]) {
      const value = wire(), record = location(value);
      if (Object.hasOwn(record, extra)) continue;
      record[extra] = true;
      failure("schema", () => parseWire(value));
    }
    const required = Object.keys(location(wire()));
    for (const key of required) {
      const value = wire(); delete location(value)[key];
      failure("schema", () => parseWire(value));
    }
  }
  for (const value of [0, 2, "1", null]) failure("schema", () => parseWire({ ...wire(), version: value }));
  for (const location of [value => value.packages[0], value => value.resources[0], value => value.resources[2]]) {
    for (const managedBy of ["user", null, 1]) {
      const value = wire(); location(value).managedBy = managedBy;
      failure("schema", () => parseWire(value));
    }
  }
  for (const value of [null, [], true, 1, "string"]) failure("schema", () => parseWire(value));
  for (const field of ["groups", "packages", "resources"]) {
    for (const value of [null, {}, "array"]) failure("limit", () => parseWire({ ...wire(), [field]: value }));
  }
  for (const value of [null, 1, {}, "bad\0text", "x".repeat(MAX_TEXT + 1), "\ud800"]) {
    for (const location of [input => { input.groups[0].description = value; }, input => { input.packages[0].name = value; }]) {
      const input = wire(); location(input); failure("schema", () => parseWire(input));
    }
  }
  assert.equal(parseWire({ ...empty(), groups: [{ key: "emoji", description: "Tools 🛠" }] }).groups[0].purpose, "Tools 🛠");
  assert.deepEqual(parseWire({ ...empty(), groups: [{ key: "plain", description: "Notes\n<data stays text>" }] }).groups,
    [{ key: "plain", purpose: "Notes\n<data stays text>" }]);
  const blank = wire(); blank.groups[0].description = ""; blank.packages[0].name = "";
  assert.equal(parseWire(blank).groups[0].purpose, ""); assert.equal(parseWire(blank).packages[0].label, "");
  failure("schema", () => parseWire({ version: 1, scope: "global", managedBy: "nix", groups: [], packages: [], standalone: [] }));
});

test("JSON duplicates are rejected at all levels, including escaped keys and prototype keys", () => {
  const json = JSON.stringify(wire());
  for (const bad of [json.replace('"version":1', '"version":0,"versi\\u006fn":1'),
    json.replace('"key":"development"', '"key":"old","key":"development"'),
    json.replace('"source":', '"source":"/old","source":'),
    json.replace('"kind":"extension"', '"kind":"skill","kind":"extension"'),
    json.replace('"package":null', '"package":null,"group":null'),
    '{"__proto__":{},"__proto__":{}}', '{"unknown":{"a":0,"\\u0061":1}}']) failure("json", () => parse(bad));
  assert.equal({}.polluted, undefined);
});

test("malformed JSON/UTF-8, trailing data, BOM and invalid string tokens fail closed", () => {
  for (const input of ["", " ", "{}{}", "[] trailing", '{"a":1,}', '[1,]', '{"a":01}', '{"a":NaN}',
    '{"a":"\\q"}', '{"a":"unterminated}', '\ufeff{}', '{"a":"line\nbreak"}', '{"a":true false}']) failure("json", () => parse(input));
  failure("json", () => parse(Uint8Array.from([0x7b, 0xc0, 0xaf, 0x7d])));
  failure("json", () => parse(Buffer.from('\ufeff{}')));
  assert.deepEqual(parse(Buffer.from(JSON.stringify(empty()))), parseWire(empty()));
});

test("public byte, depth, node, declaration, path and presentation bounds are enforced", () => {
  assert.equal(MAX_BYTES, 4 * 1024 * 1024);
  for (const limit of [MAX_DEPTH, MAX_NODES, MAX_ENTRIES, MAX_PATH, MAX_TEXT]) assert.ok(Number.isSafeInteger(limit) && limit > 0);
  const json = JSON.stringify(empty());
  assert.equal(parse(json + " ".repeat(MAX_BYTES - Buffer.byteLength(json))).binding, "unbound", "exact byte bound accepted");
  failure("limit", () => parse(json + " ".repeat(MAX_BYTES - json.length + 1)));
  failure("limit", () => parse(Buffer.alloc(MAX_BYTES + 1)));
  failure("limit", () => parse("[".repeat(MAX_DEPTH + 1) + "0" + "]".repeat(MAX_DEPTH + 1)));
  failure("limit", () => parse("[" + "0,".repeat(MAX_NODES) + "0]"));
  const groups = Array.from({ length: MAX_ENTRIES }, (_, index) => ({ key: `group-${index}`, description: "" }));
  assert.equal(parseWire({ ...empty(), groups }).groups.length, MAX_ENTRIES);
  failure("limit", () => parseWire({ ...empty(), groups: [...groups, { key: "overflow", description: "" }] }));
  failure("limit", () => parseWire({ ...empty(), groups, packages: [pkg("/package")] }));
  const input = wire(); input.packages[0].source = "/" + "a".repeat(MAX_PATH);
  failure("schema", () => parseWire(input));
});

test("lexical installed identity normalizes benign absolute spelling without realpath or case folding", () => {
  const input = wire();
  input.packages[0].source = "/example//agent/./skill-groups/codegraph/";
  input.resources[0].package = input.packages[0].source;
  input.resources[1].package = packageSource;
  input.resources[2].path = "/example//agent/skills/./style/SKILL.md";
  const result = parseWire(input);
  assert.equal(result.packages[0].source, packageSource);
  assert.equal(result.standalone[0].path, wire().resources[2].path);
  input.packages[0].source = "/example/Case";
  input.resources[0].package = input.resources[1].package = "/example/Case";
  input.packages.push(pkg("/example/case"));
  assert.equal(parseWire(input).packages.length, 2, "POSIX case is exact");
  input.packages[0].source = "/example/a\\b";
  input.resources[0].package = input.resources[1].package = "/example/a\\b";
  assert.equal(parseWire(input).packages[0].source, "/example/a\\b", "literal POSIX backslash is not a separator");
});

test("remote, relative, traversal, Windows and UNC absolute wire identities explicitly refuse", () => {
  for (const path of ["", "/", "relative", "~/agent", "npm:package", "git:repo", "https://host/path", "file:///path",
    "C:/agent", "c:\\agent", "C:relative", "\\\\server\\share", "//server/share", "\\?\\C:\\agent",
    "/example/../escape", "/example/..", "/example/*.ts", "/example/[a]", "/bad\0path", "/bad\npath"]) {
    const input = wire(); input.packages[0].source = path;
    assert.throws(() => parseWire(input), CatalogMetadataError, path);
    input.packages = []; input.resources = [{ ...wire().resources[2], path }];
    assert.throws(() => parseWire(input), CatalogMetadataError, path);
  }
  for (const path of ["/example/dir/", "/example/dir/."]) {
    const input = wire(); input.resources[2] = { kind: "extension", package: null, path, group: null, managedBy: "nix" };
    failure("path", () => parseWire(input));
  }
});

test("members are exact slash-relative files, not globs, directories, groups or nested packages", () => {
  for (const path of ["", ".", "..", "./entry.ts", "a/../entry.ts", "a//entry.ts", "a/./entry.ts", "a/", "/entry.ts",
    "C:/entry.ts", "C:entry.ts", "\\\\server\\entry.ts", "a\\entry.ts", "*.ts", "a?.ts", "[ab].ts", "{a,b}.ts", "https://host/path"]) {
    const input = wire(); input.resources[0].path = path;
    assert.throws(() => parseWire(input), CatalogMetadataError, path);
  }
  for (const field of ["group", "members", "packages", "source"]) {
    const input = wire(); input.resources[0][field] = [];
    failure("schema", () => parseWire(input));
  }
  for (const path of ["skills/directory", "skills/other.md", "skills/skill.md"]) {
    const input = wire(); input.resources[1].path = path; failure("path", () => parseWire(input));
  }
  for (const path of ["extensions/tree", "extensions/entry.mjs", "extensions/entry.TS"]) {
    const input = wire(); input.resources[0].path = path; failure("path", () => parseWire(input));
  }
  for (const kind of ["unknown", "prompt", "theme"]) {
    const input = wire(); input.resources[0].kind = kind; failure("schema", () => parseWire(input));
  }
  for (const source of ["/unknown", null, 1, "relative", "npm:package", "/a/../b"]) {
    const input = wire(); input.resources[0].package = source;
    assert.throws(() => parseWire(input), CatalogMetadataError);
  }
  const input = wire(); input.resources[0].path = "extensions/entry.js";
  assert.equal(parseWire(input).packages[0].members[0].path, "extensions/entry.js");
});

test("flat single group parent references must exist; exact group keys never infer labels", () => {
  for (const target of [value => value.packages[0], value => value.resources[2]]) {
    for (const group of ["missing", "Development", ["development"], {}, 1]) {
      const input = wire(); target(input).group = group;
      assert.throws(() => parseWire(input), CatalogMetadataError);
    }
  }
  for (const field of ["group", "groups", "members"]) {
    const input = wire(); input.groups[0][field] = "development";
    failure("schema", () => parseWire(input));
  }
  for (const key of ["Development", "a_b", "-a", "a-", "a--b", "a b"]) {
    const input = wire(); input.groups.push({ key, description: "" });
    failure("schema", () => parseWire(input));
  }
  const input = wire(); input.groups.push({ key: "other-group", description: "Other" });
  input.packages[0].group = "other-group";
  assert.equal(parseWire(input).packages[0].group, "other-group");
});

test("duplicate normalized refs, kinds, groups and conflicting lexical owners fail, not first-wins", () => {
  const variants = [
    value => value.groups.push({ key: "development", description: "Other" }),
    value => value.packages.push({ ...value.packages[0], source: "/example//agent/skill-groups/./codegraph/" }),
    value => value.resources.push({ ...value.resources[0] }),
    value => value.resources.push({ ...value.resources[2], group: null, path: "/example/agent/skills/style/./SKILL.md" }),
    value => value.resources.push({ kind: "extension", package: null, path: packageSource + "/extensions/codegraph/index.ts", group: "development", managedBy: "nix" }),
    value => value.packages.push(pkg(packageSource + "/nested")),
    value => { value.packages = ["/a", "/a-b", "/a/nested"].map(source => pkg(source)); value.resources = []; },
    value => { value.packages = [pkg("/a.ts")]; value.resources = [{ kind: "extension", package: null, path: "/a.ts", group: null, managedBy: "nix" }]; },
    value => { value.packages = []; value.resources = ["/a.ts", "/a.ts/child.ts"].map(path => ({ kind: "extension", package: null, path, group: null, managedBy: "nix" })); },
    value => { value.packages = [pkg("/a.ts")]; value.resources = [{ kind: "extension", package: "/a.ts", path: "child.ts", managedBy: "nix" },
      { kind: "extension", package: null, path: "/a.ts", group: null, managedBy: "nix" }]; },
    value => value.resources.push({ ...value.resources[1] }),
  ];
  for (const change of variants) { const input = wire(); change(input); failure("conflict", () => parseWire(input)); }
  const crossKind = wire(); crossKind.resources.push({ ...crossKind.resources[1], kind: "extension" });
  failure("path", () => parseWire(crossKind)); // Kinds cannot share a valid v1 entry suffix.
});

test("explicit unconfigured absence alone succeeds; configured missing/broken/malformed never becomes empty", t => {
  const fixtureRoot = fixture(t);
  assert.deepEqual(read({ status: "unconfigured" }), { status: "unconfigured" });
  failure("read", () => read(fixtureRoot.configured));
  fs.symlinkSync(join(fixtureRoot.root, "absent"), fixtureRoot.file);
  failure("read", () => read(fixtureRoot.configured));
  fs.unlinkSync(fixtureRoot.file);
  fs.mkdirSync(fixtureRoot.file);
  failure("read", () => read(fixtureRoot.configured));
  fs.rmdirSync(fixtureRoot.file);
  fs.writeFileSync(fixtureRoot.file, "bad JSON");
  failure("json", () => read(fixtureRoot.configured));
  fs.writeFileSync(fixtureRoot.file, JSON.stringify({ ...empty(), version: 2 }));
  failure("schema", () => read(fixtureRoot.configured));
  assert.equal(fs.readFileSync(fixtureRoot.file, "utf8"), JSON.stringify({ ...empty(), version: 2 }), "no repair/write");
});

test("bounded native reader refuses oversized regular files before reading bytes", t => {
  const { file, configured, write } = fixture(t);
  write(empty());
  const positive = observeIO(t);
  witnessedRead(t, configured, positive, [
    () => assert.ok(positive.reads.some(({ count }) => count > 0), "qualified positive native read"),
    () => assert.deepEqual(positive.opens.map(({ path }) => path), [file]),
  ]);
  fs.writeFileSync(file, ""); fs.truncateSync(file, MAX_BYTES + 1);
  let reads = 0;
  interpose(t, "readSync", original => (...args) => { reads++; return original(...args); });
  failure("limit", () => read(configured));
  assert.equal(reads, 0);
});

test("Nix-like readonly metadata symlink works; sources are neither read, resolved nor imported", t => {
  const { root, file, configured } = fixture(t);
  const store = join(root, "store-generation-1"), installed = join(root, "installed");
  fs.mkdirSync(store); fs.mkdirSync(installed);
  const sentinel = join(root, "IMPORTED");
  fs.writeFileSync(join(store, "extension.ts"), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(sentinel)}, 'imported'); throw new Error('must never execute');`);
  fs.symlinkSync(store, join(installed, "package"), "dir");
  const input = { ...empty(), packages: [pkg(join(installed, "package"))], resources: [
    { kind: "extension", package: join(installed, "package"), path: "extension.ts", managedBy: "nix" },
    { kind: "skill", package: null, path: join(root, "not-present", "SKILL.md"), group: null, managedBy: "nix" },
  ] };
  const target = join(store, "metadata.json");
  fs.writeFileSync(target, JSON.stringify(input), { mode: 0o444 });
  fs.symlinkSync(target, file);
  const openedPaths = [], realpaths = [];
  const load = () => {
    const io = observeIO(t);
    const result = witnessedRead(t, configured, io, [
      () => assert.deepEqual(io.opens.map(({ path }) => path), [file]),
      () => assert.deepEqual(io.realpaths, [file, file], "qualified metadata-only realpath"),
      () => assert.ok(io.reads.some(({ count }) => count > 0), "qualified positive native read"),
      () => assert.equal(io.reads.reduce((sum, { count }) => sum + count, 0), Buffer.byteLength(JSON.stringify(input))),
      () => assert.ok(io.reads.every(({ fd }) => fd === io.opens[0].fd), "reads use actual opened descriptor"),
    ]);
    openedPaths.push(...io.opens.map(({ path }) => path)); realpaths.push(...io.realpaths);
    return result;
  };
  const first = load(), second = load();
  assert.equal(first.status, "loaded"); frozen(first);
  assert.deepEqual(first.catalog, { ...unboundEmpty(),
    packages: [{ source: join(installed, "package"), group: null, label: "agent-skills-codegraph", members: [{ kind: "extension", path: "extension.ts" }] }],
    standalone: [{ kind: "skill", path: join(root, "not-present", "SKILL.md"), group: null }] });
  assert.equal(first.generation.path, file);
  assert.equal(first.generation.agentDir, configured.context.agentDir);
  assert.equal(first.generation.token, second.generation.token);
  assert.deepEqual(openedPaths, [file, file]);
  assert.deepEqual(realpaths, [file, file, file, file], "metadata resolution only, not source targets");
  assert.equal(fs.statSync(target).mode & 0o222, 0);
  assert.equal(fs.existsSync(sentinel), false);
  assert.equal(first.catalog.binding, "unbound", "missing source remains pending W04b binding, not admitted success");
});

test("source symlink retarget retains lexical declarations; metadata retarget changes generation", t => {
  const { root, file, configured } = fixture(t);
  for (const generation of ["one", "two"]) fs.mkdirSync(join(root, generation));
  const installed = join(root, "package"); fs.symlinkSync(join(root, "one"), installed);
  const input = { ...empty(), packages: [pkg(installed)],
    resources: [{ kind: "extension", package: installed, path: "entry.ts", managedBy: "nix" }] };
  for (const generation of ["one", "two"]) fs.writeFileSync(join(root, generation, "metadata.json"), JSON.stringify(input), { mode: 0o444 });
  fs.symlinkSync(join(root, "one", "metadata.json"), file);
  const first = read(configured);
  fs.unlinkSync(installed); fs.symlinkSync(join(root, "two"), installed);
  assert.deepEqual(read(configured), first, "source targets do not enter metadata identity");
  fs.unlinkSync(file); fs.symlinkSync(join(root, "two", "metadata.json"), file);
  const second = read(configured);
  assert.deepEqual(first.catalog, second.catalog);
  assert.notEqual(first.generation.token, second.generation.token);
});

test("retarget between observation and open refuses the replacement generation and closes descriptor", t => {
  const { root, file, configured } = fixture(t);
  const one = join(root, "one.json"), two = join(root, "two.json");
  fs.writeFileSync(one, JSON.stringify(empty())); fs.writeFileSync(two, JSON.stringify(empty())); fs.symlinkSync(one, file);
  let mutations = 0;
  const io = observeIO(t, { beforeOpen() {
    fs.unlinkSync(file); fs.symlinkSync(two, file); mutations++;
    io.mutation = { kind: "retarget-before-open", target: fs.readlinkSync(file), mutations };
  } });
  witnessedRead(t, configured, io, [
    () => assert.equal(mutations, 1, "retarget hook reached exactly once"),
    () => assert.equal(fs.readlinkSync(file), two, "actual retarget persisted"),
    () => assert.deepEqual(io.opens.map(({ path }) => path), [file]),
    () => assert.equal(io.reads.length, 0, "replacement refused before reading"),
  ], "generation");
});

test("retarget after actual native read fails the before/after generation fence", t => {
  const { root, file, configured } = fixture(t);
  const one = join(root, "one.json"), two = join(root, "two.json");
  fs.writeFileSync(one, JSON.stringify(empty())); fs.writeFileSync(two, JSON.stringify(empty())); fs.symlinkSync(one, file);
  let mutations = 0;
  const io = observeIO(t, { afterRead() {
    if (!mutations) {
      fs.unlinkSync(file); fs.symlinkSync(two, file); mutations++;
      io.mutation = { kind: "retarget-after-read", target: fs.readlinkSync(file), mutations };
    }
  } });
  witnessedRead(t, configured, io, [
    () => assert.equal(mutations, 1, "post-read retarget reached"),
    () => assert.equal(fs.readlinkSync(file), two, "actual retarget persisted"),
    () => assert.ok(io.reads.some(({ count }) => count > 0), "actual bytes read before retarget"),
    () => assert.deepEqual(io.opens.map(({ path }) => path), [file]),
  ], "generation");
});

test("in-place same-length native modification after read refuses", t => {
  const { file, configured, write } = fixture(t);
  write(empty());
  const previous = fs.statSync(file), replacement = JSON.stringify(empty()).replace('"version":1', '"version":2');
  let mutations = 0;
  const io = observeIO(t, { afterRead() {
    if (!mutations) {
      fs.writeFileSync(file, replacement);
      fs.utimesSync(file, previous.atime, new Date(previous.mtimeMs + 1000));
      mutations++;
      io.mutation = { kind: "same-length-rewrite", contents: fs.readFileSync(file, "utf8"),
        size: fs.statSync(file).size, previousMtime: previous.mtimeMs, mtime: fs.statSync(file).mtimeMs, mutations };
    }
  } });
  witnessedRead(t, configured, io, [
    () => assert.equal(mutations, 1, "same-length rewrite reached"),
    () => assert.equal(fs.readFileSync(file, "utf8"), replacement, "actual replacement persisted"),
    () => assert.equal(fs.statSync(file).size, previous.size, "same length"),
    () => assert.ok(fs.statSync(file).mtimeMs > previous.mtimeMs, "actual mtime changed"),
    () => assert.ok(io.reads.some(({ count }) => count > 0), "actual bytes read before rewrite"),
    () => assert.deepEqual(io.opens.map(({ path }) => path), [file]),
  ], "generation");
});

test("growth is bounded to original stat size plus one and never accepted", t => {
  const { file, configured, write } = fixture(t); write(empty());
  const originalSize = fs.statSync(file).size;
  let mutations = 0;
  const io = observeIO(t, { beforeRead() {
    if (!mutations) {
      fs.appendFileSync(file, " ".repeat(MAX_BYTES)); mutations++;
      io.mutation = { kind: "growth-before-read", size: fs.statSync(file).size, originalSize, mutations };
    }
  } });
  witnessedRead(t, configured, io, [
    () => assert.equal(mutations, 1, "growth hook reached"),
    () => assert.equal(fs.statSync(file).size, originalSize + MAX_BYTES, "actual append persisted"),
    () => assert.equal(Math.max(...io.reads.map(({ buffer }) => buffer)), originalSize + 1),
    () => assert.equal(io.reads.reduce((sum, { count }) => sum + count, 0), originalSize + 1, "native read bounded despite growth"),
    () => assert.deepEqual(io.opens.map(({ path }) => path), [file]),
  ], "generation");
});
