import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createJiti } from "jiti";

// Actual PUBLIC SDK, no discovery replica, loader/session or real user settings.
// Install fences before importing the SDK/production graph. Cases are serial in
// this private file process. All native calls remain real except prohibited
// capabilities, which throw AND retain an independent unexpected-effect record.
const root = fs.mkdtempSync(join(tmpdir(), "resource-catalog-native-"));
const envKeys = ["HOME", "PI_CODING_AGENT_DIR", "PI_OFFLINE"];
const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
const descriptors = [], forbidden = [], processes = [], resolutions = [], supplements = [], missing = [], reads = [];
const allowedProbes = new Set();
let active = false;
function replace(object, key, value) {
  descriptors.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
  Object.defineProperty(object, key, { ...Object.getOwnPropertyDescriptor(object, key), value });
}
function restore() {
  active = false;
  for (const [object, key, descriptor] of descriptors.reverse()) Object.defineProperty(object, key, descriptor);
  for (const key of envKeys) {
    if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
  }
  syncBuiltinESMExports();
}
after(restore);
process.env.HOME = join(root, "home");
process.env.PI_CODING_AGENT_DIR = join(root, "ambient-agent-never-read");
process.env.PI_OFFLINE = "false"; // Qualify onMissing, not offline's earlier skip.
fs.mkdirSync(process.env.HOME);
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const original = childProcess[name];
  replace(childProcess, name, (...args) => {
    const probe = (name === "spawn" || name === "spawnSync") && args[0] === process.execPath && allowedProbes.has(args[1]?.[0])
      && JSON.stringify(args[1].slice(1)) === JSON.stringify(["root", "-g"]);
    if (!probe) { forbidden.push(`process:${name}:${String(args[0])}`); throw new Error("Unadmitted inventory subprocess"); }
    processes.push({ name, args: [...args[1]] });
    return Reflect.apply(original, childProcess, args);
  });
}
replace(globalThis, "fetch", () => { forbidden.push("fetch"); throw new Error("No inventory transport"); });
const readFileSync = fs.readFileSync;
replace(fs, "readFileSync", (...args) => {
  if (active && typeof args[0] === "string") reads.push(args[0]);
  return Reflect.apply(readFileSync, fs, args);
});
syncBuiltinESMExports();
const jiti = createJiti(import.meta.url, { fsCache: false, nativeModules: ["@earendil-works/pi-coding-agent"] });
let sdk, buildResourceCatalog, readCatalogMetadata, selectionKey;
try {
  sdk = await jiti.import("@earendil-works/pi-coding-agent");
  function deny(object, method) {
    assert.equal(typeof object[method], "function", `public fence ${method} exists`);
    replace(object, method, () => { forbidden.push(method); throw new Error(`Forbidden inventory capability: ${method}`); });
  }
  for (const method of ["install", "installAndPersist", "remove", "removeAndPersist", "update"]) deny(sdk.DefaultPackageManager.prototype, method);
  for (const method of ["create", "open", "inMemory"]) deny(sdk.SessionManager, method);
  deny(sdk.SettingsManager, "create");
  deny(sdk.DefaultResourceLoader.prototype, "reload");
  const resolve = sdk.DefaultPackageManager.prototype.resolve;
  replace(sdk.DefaultPackageManager.prototype, "resolve", function (onMissing) {
    assert.equal(this instanceof sdk.DefaultPackageManager, true, "actual public native instance");
    assert.equal(typeof onMissing, "function", "catalog must explicitly own missing-source behavior");
    resolutions.push(this);
    return resolve.call(this, async source => {
      const action = await onMissing(source); missing.push({ source, action }); return action;
    });
  });
  const supplement = sdk.DefaultPackageManager.prototype.resolveExtensionSources;
  replace(sdk.DefaultPackageManager.prototype, "resolveExtensionSources", function (sources, options) {
    assert.equal(sources.every(isAbsolute), true, "supplement only exact local absolute sources");
    assert.equal(options?.temporary, false, "never temporary refresh mode");
    supplements.push({ sources: [...sources], options: { ...options } });
    return supplement.call(this, sources, options);
  });
  ({ buildResourceCatalog } = await jiti.import("./catalog.ts"));
  ({ readCatalogMetadata } = await jiti.import("./catalog-metadata.ts"));
  ({ selectionKey } = await jiti.import("./selection.ts"));
} catch (error) { restore(); throw error; }

function write(path, contents) {
  fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, contents); return path;
}
function fixture(t) {
  const dir = fs.mkdtempSync(join(root, "case-")), agentDir = join(dir, "agent"), cwd = join(dir, "project");
  fs.mkdirSync(agentDir); fs.mkdirSync(cwd); fs.mkdirSync(join(cwd, ".git")); // Native ancestor discovery stops here.
  write(join(dir, "package.json"), JSON.stringify({ type: "module" }));
  const marker = join(dir, "extension-effects.txt");
  const context = { agentDir, projectBinding: "admitted-project", sessionBinding: "own-session" };
  const f = { dir, agentDir, cwd, marker, context,
    extension(path) {
      return write(path, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'import\\n');\nexport default function () { appendFileSync(${JSON.stringify(marker)}, 'factory\\n'); }\n`);
    },
    skill(path, name = "query-guide", manual = true) {
      return write(path, `---\nname: ${name}\ndescription: Synthetic native catalog fixture.\ndisable-model-invocation: ${manual}\n---\n# Fixture instructions\n`);
    },
    package(path = join(dir, "package"), { name = "codegraph-like", extra = false } = {}) {
      const extension = f.extension(join(path, "extensions/main.js"));
      const skill = f.skill(join(path, "skills/query-guide/SKILL.md"));
      const pi = { extensions: ["extensions/main.js"], skills: ["skills/query-guide"] };
      if (extra) { f.extension(join(path, "extensions/new.js")); pi.extensions.push("extensions/new.js"); }
      write(join(path, "package.json"), JSON.stringify({ name, type: "module", pi }));
      return { path, extension, skill };
    },
    metadata(packages = [], resources = [], groups = []) {
      const file = write(join(agentDir, "resource-catalog.json"), JSON.stringify({ version: 1, groups,
        packages: packages.map(({ source, group = null }) => ({ source, name: "display-only", group, managedBy: "nix" })),
        resources: resources.map(resource => ({ ...resource, managedBy: "nix" })) }));
      return readCatalogMetadata({ status: "configured", path: file, context });
    },
    async catalog(overrides = {}) {
      const before = forbidden.length;
      active = true;
      try {
        return await buildResourceCatalog({ cwd, context, discoveryAdmitted: true, globalSettings: {}, projectSettings: {}, projectTrusted: true,
          managedMetadataTrusted: true, metadata: { status: "unconfigured" }, eligibility: () => ({ source: true, trust: true, profile: true }), ...overrides });
      } finally { active = false; assert.equal(forbidden.length, before, "no suppressed unexpected effects"); }
    },
    readonly(path, mode) {
      assert.ok(path.startsWith(`${dir}/`), "only exact case-owned fixture objects");
      const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      const original = fs.fstatSync(fd);
      // Register before chmod, retaining the original object rather than following
      // a later symlink/path replacement. Node preserves test and hook failures.
      t.after(() => {
        try {
          const current = fs.fstatSync(fd);
          assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
          fs.fchmodSync(fd, original.mode & 0o7777);
          assert.equal(fs.fstatSync(fd).mode & 0o7777, original.mode & 0o7777, "original fixture mode restored before sandbox disposal");
        } finally { fs.closeSync(fd); }
      });
      fs.fchmodSync(fd, mode);
    },
    inert() { assert.equal(fs.existsSync(marker), false, "catalog never imports extension or executes its factory"); },
  };
  t.after(() => { active = false; }); // No asynchronous fixture work survives awaited public resolve.
  return f;
}
const member = (kind, pkg, path) => ({ kind, package: pkg, path });
const standalone = (kind, path, group = null) => ({ kind, package: null, path, group });
function row(result, kind, path) {
  const values = result.rows.filter(value => value.kind === kind && value.path === path);
  assert.equal(values.length, 1, `one ${kind} row at ${path}`); return values[0];
}
function has(result, code) { return result.diagnostics.some(value => value.code === code); }
function selections(result, kind) { return result.rows.filter(value => value.kind === kind).map(value => value.selection); }

// Each test below names a management/native obligation, not runtime application,
// legacy import, content-read authority, zero subprocesses or complete inventory.
test("actual SDK mixed managed package + standalone: readonly lexical identities, parent gates and inert factories", async t => {
  const f = fixture(t), target = f.package(join(f.dir, "store-target"), { extra: true });
  const installed = join(f.agentDir, "skill-groups/codegraph"); fs.mkdirSync(dirname(installed), { recursive: true }); fs.symlinkSync(target.path, installed);
  for (const file of [target.extension, target.skill, join(target.path, "package.json")]) f.readonly(file, 0o444);
  f.readonly(target.path, 0o555);
  const extension = join(installed, "extensions/main.js"), skill = join(installed, "skills/query-guide/SKILL.md");
  const solo = f.skill(join(f.agentDir, "skills/style/SKILL.md"), "style-notes", false);
  const metadata = f.metadata([{ source: installed }], [member("extension", installed, "extensions/main.js"),
    member("skill", installed, "skills/query-guide/SKILL.md"), standalone("skill", solo, "development")], [{ key: "development", description: "Development" }]);
  const original = fs.readFileSync(target.skill, "utf8"), globalSettings = { packages: [installed] };
  const result = await f.catalog({ metadata, globalSettings, choices: identity => identity.kind === "package" || identity.kind === "group" ? { global: "disabled" } : {} });
  assert.equal(result.ok, true);
  assert.equal(result.metadataGeneration, metadata.generation.token);
  assert.equal(row(result, "package", installed).parent, undefined, "CodeGraph remains ungrouped");
  for (const path of [extension, join(installed, "extensions/new.js")]) {
    const entry = row(result, "extension", path);
    assert.equal(entry.membership, "confirmed"); assert.equal(entry.nativeEnabled, true);
    assert.equal(entry.selection.enabled, false, "OFF package gates every member, including newly observed unmanaged members");
    assert.equal(entry.selection.own.enabled, true, "baseline remains Enabled");
    assert.equal(entry.selection.disabledReasons.some(reason => reason.code === "parent-disabled"), true);
  }
  assert.equal(row(result, "extension", extension).ownership, "readonly");
  assert.equal(row(result, "extension", join(installed, "extensions/new.js")).managedBy, null, "metadata omission does not claim a managed resource declaration");
  assert.equal(row(result, "extension", join(installed, "extensions/new.js")).ownership, "readonly", "known Nix package contents remain readonly");
  assert.equal(row(result, "skill", solo).selection.enabled, false, "standalone group gate");
  assert.equal(row(result, "skill", skill).skill.disableModelInvocation, true, "authored manual-only flag unchanged");
  assert.equal(row(result, "skill", skill).identity.path, skill, "identity is installed lexical entry, never store target");
  assert.equal(fs.readFileSync(target.skill, "utf8"), original);
  assert.deepEqual(globalSettings, { packages: [installed] });
  assert.equal(Object.isFrozen(result.rows[0]), true); assert.equal(Object.isFrozen(result.native), true);
  assert.ok(result.coverage.includes("not a complete"));
  assert.ok(resolutions.length > 0); assert.ok(supplements.some(value => value.sources.includes(installed)), "actual supplementary public discovery exercised");
  f.inert();
  // Positive fixture witness AFTER all listing assertions: this actual module
  // would record both phases if management had imported/invoked it.
  const control = await import(pathToFileURL(extension).href); control.default();
  assert.equal(fs.readFileSync(f.marker, "utf8"), "import\nfactory\n");
});

test("native excluded members survive with false observation while desired defaults remain independent", async t => {
  const f = fixture(t), pkg = f.package();
  const filters = { source: pkg.path, extensions: [], skills: [] };
  const result = await f.catalog({ globalSettings: { packages: [filters] }, metadata: f.metadata([{ source: pkg.path }],
    [member("extension", pkg.path, "extensions/main.js"), member("skill", pkg.path, "skills/query-guide/SKILL.md")]) });
  assert.equal(result.ok, true);
  for (const [kind, path] of [["extension", pkg.extension], ["skill", pkg.skill]]) {
    const entry = row(result, kind, path); assert.equal(entry.nativeEnabled, false);
    assert.equal(entry.membership, "confirmed"); assert.equal(entry.selection.enabled, true);
  }
  assert.deepEqual(result.raw.global.packages, [filters]); assert.equal(result.configuredPackages[0].filtered, true);
  f.inert();
});

test("flat group/package mapping uses W03 scope overrides; project-local resources have no Global scope", async t => {
  const f = fixture(t), pkg = f.package();
  const projectExtension = f.extension(join(f.cwd, ".pi/extensions/project.js"));
  const metadata = f.metadata([{ source: pkg.path, group: "development" }], [member("extension", pkg.path, "extensions/main.js")],
    [{ key: "development", description: "Flat controlling group" }]);
  const result = await f.catalog({ globalSettings: { packages: [pkg.path] }, metadata,
    choices: identity => identity.kind === "group" ? { global: "disabled", session: "enabled" } : {} });
  assert.equal(result.ok, true);
  assert.equal(row(result, "extension", pkg.extension).selection.enabled, true, "session can enable globally OFF parent");
  const project = row(result, "extension", projectExtension);
  assert.equal(project.identity.origin.scope, "project"); assert.equal(project.selection.scopes.global.editable, false);
  assert.equal(project.selection.scopes.global.choice, null); assert.equal(project.selection.own.source, "default");
  f.inert();
});

test("native prompt/theme observations are descriptive only, never new availability gates", async t => {
  const f = fixture(t), prompt = write(join(f.agentDir, "prompts/review.md"), "Review fixture"), theme = write(join(f.agentDir, "themes/plain.json"), "{}");
  const result = await f.catalog();
  for (const [kind, path] of [["prompt", prompt], ["theme", theme]]) {
    const entry = row(result, kind, path); assert.equal(entry.nativeEnabled, true);
    assert.equal(entry.identity, undefined); assert.equal(entry.selection, undefined);
  }
  assert.equal(result.ok, true);
});

test("native physical dedup keeps its real winner; one confirmed alias gets the canonical package gate", async t => {
  const f = fixture(t), pkg = f.package();
  const alias = join(f.agentDir, "extensions/alias.js"); fs.mkdirSync(dirname(alias)); fs.symlinkSync(pkg.extension, alias);
  const result = await f.catalog({ globalSettings: { packages: [pkg.path] },
    metadata: f.metadata([{ source: pkg.path }], [member("extension", pkg.path, "extensions/main.js")]),
    choices: identity => identity.kind === "package" ? { global: "disabled" } : {} });
  assert.equal(result.ok, true);
  assert.deepEqual(result.native.extensions.map(value => value.path), [alias], "preserve SDK winner/order, not a replacement native registry");
  const entry = row(result, "extension", pkg.extension);
  assert.deepEqual(entry.observedPaths, [alias]); assert.equal(entry.identity.path, pkg.extension);
  assert.equal(entry.selection.enabled, false, "automatic alias cannot bypass package gate");
  f.inert();
});

test("native object omitted-kind conventional skill alias refuses unconfirmed membership under an OFF package", async t => {
  const f = fixture(t), pkg = f.package();
  write(join(pkg.path, "package.json"), JSON.stringify({ type: "module", pi: { extensions: ["extensions/main.js"] } }));
  const alias = join(f.agentDir, "skills/alias/SKILL.md");
  fs.mkdirSync(dirname(alias), { recursive: true }); fs.symlinkSync(pkg.skill, alias);
  // Metadata deliberately does not enumerate the newly observed conventional skill.
  const metadata = f.metadata([{ source: pkg.path }], [member("extension", pkg.path, "extensions/main.js")]);
  const options = { metadata, choices: identity => identity.kind === "package" ? { global: "disabled" } : {} };
  const result = await f.catalog({ ...options, globalSettings: { packages: [{ source: pkg.path, extensions: [] }] } });
  assert.deepEqual(result.native.skills.map(value => value.path), [alias], "actual native object discovery + automatic physical-dedup winner");
  assert.equal(row(result, "extension", pkg.extension).nativeEnabled, false, "object extension filter really applied");
  assert.equal(row(result, "extension", pkg.extension).selection.enabled, false, "other observed member cannot mask the missing parent");
  const entry = row(result, "skill", alias);
  assert.equal(entry.nativeEnabled, true); assert.equal(entry.parent, undefined, "no invented package mapping");
  assert.equal(entry.membership, "unsupported"); assert.equal(entry.selection.enabled, false, "uncertain automatic alias is not admissible");
  assert.equal(entry.skill, undefined, "unsupported instructions are not validated/read");
  assert.equal(result.ok, false); assert.equal(has(result, "unsupported-object-membership"), true);
  assert.ok(result.diagnostics.find(value => value.code === "unsupported-object-membership").message.includes("declare this kind"));
  const ordinary = await f.catalog({ ...options, globalSettings: { packages: [pkg.path] } });
  assert.equal(ordinary.ok, true, "string partial manifests do not declare the conventional skill");
  assert.equal(row(ordinary, "skill", alias).selection.enabled, true, "do not arbitrarily suppress ordinary string sources");
  f.inert();
});

test("multiple package aliases are explicit unsupported ownership, not a guessed logical winner", async t => {
  const f = fixture(t), pkg = f.package(); const aliasRoot = join(f.dir, "other-package"); fs.symlinkSync(pkg.path, aliasRoot);
  const result = await f.catalog({ globalSettings: { packages: [pkg.path, aliasRoot] } });
  assert.equal(result.native.extensions.length, 1, "ordinary native physical dedup retained");
  assert.equal(has(result, "ambiguous-owner"), true); assert.equal(result.ok, false);
  assert.equal(result.rows.filter(value => value.kind === "extension").every(value => value.selection?.enabled === false), true);
  f.inert();
});

test("actual native skill name collisions remain actionable with both paths, not silent first-wins success", async t => {
  const f = fixture(t), a = f.skill(join(f.agentDir, "skills/a/SKILL.md"), "duplicate"), b = f.skill(join(f.agentDir, "skills/b/SKILL.md"), "duplicate");
  const result = await f.catalog();
  assert.equal(result.native.skills.length, 2); assert.equal(has(result, "native-skill-collision"), true);
  assert.equal(result.ok, false); assert.equal(row(result, "skill", a).selection.enabled, false); assert.equal(row(result, "skill", b).selection.enabled, false);
});

test("autoload delta provenance is refused honestly; raw scoped records survive native dedup", async t => {
  const f = fixture(t), pkg = f.package();
  const delta = { source: pkg.path, autoload: false, extensions: ["-extensions/main.js"] };
  const result = await f.catalog({ globalSettings: { packages: [pkg.path] }, projectSettings: { packages: [delta] } });
  assert.equal(has(result, "unsupported-delta"), true); assert.equal(result.ok, false);
  assert.deepEqual(result.raw.project.packages, [delta]); assert.equal(result.configuredPackages.length, 2);
  assert.ok(result.rows.some(value => value.membership === "unsupported"), "no invented complete delta inventory"); f.inert();
});

test("still-declared missing packages/members and exact top-level sources remain diagnostic rows", async t => {
  const f = fixture(t), broken = join(f.dir, "broken-package"), missingExtension = join(f.agentDir, "missing.js");
  const result = await f.catalog({ globalSettings: { packages: [broken], extensions: [missingExtension] },
    metadata: f.metadata([{ source: broken }], [member("skill", broken, "skills/lost/SKILL.md")]) });
  assert.equal(result.ok, false); assert.equal(has(result, "broken-package"), true); assert.equal(has(result, "broken-declaration"), true);
  assert.equal(row(result, "package", broken).membership, "unresolved");
  assert.equal(row(result, "skill", join(broken, "skills/lost/SKILL.md")).membership, "unresolved");
  assert.equal(row(result, "extension", missingExtension).nativeEnabled, null); f.inert();
});

test("metadata cannot register a stray existing member or standalone file", async t => {
  const f = fixture(t), pkg = f.package(); const stray = f.extension(join(pkg.path, "not-declared.js")), solo = f.extension(join(f.dir, "arbitrary.js"));
  const result = await f.catalog({ globalSettings: { packages: [pkg.path] }, metadata: f.metadata([{ source: pkg.path }],
    [member("extension", pkg.path, "not-declared.js"), standalone("extension", solo)]) });
  assert.equal(result.ok, false); assert.equal(has(result, "metadata-native-mismatch"), true);
  for (const path of [stray, solo]) {
    const entry = row(result, "extension", path); assert.equal(entry.membership, "unresolved");
    assert.equal(entry.identity, undefined); assert.equal(entry.managedBy, null); assert.equal(entry.ownership, "unresolved");
  }
  f.inert();
});

test("metadata producer authority is independent of native source admission and project trust", async t => {
  const f = fixture(t), pkg = f.package();
  const result = await f.catalog({ globalSettings: { packages: [pkg.path] }, managedMetadataTrusted: false,
    metadata: f.metadata([{ source: pkg.path, group: "development" }], [member("extension", pkg.path, "extensions/main.js")], [{ key: "development", description: "Untrusted producer" }]) });
  assert.equal(result.ok, false); assert.equal(has(result, "metadata-trust"), true);
  assert.equal(row(result, "extension", pkg.extension).managedBy, null); assert.equal(result.rows.some(value => value.kind === "group"), false); f.inert();
});

test("source, trust and profile ceilings independently refuse skill validation/content and desired availability", async t => {
  const f = fixture(t), skill = f.skill(join(f.agentDir, "skills/refused/SKILL.md"), "refused");
  for (const denied of ["source", "trust", "profile"]) {
    const before = reads.length;
    const result = await f.catalog({ eligibility: () => ({ source: true, trust: true, profile: true, [denied]: false }) });
    assert.equal(row(result, "skill", skill).selection.enabled, false); assert.equal(row(result, "skill", skill).skill, undefined);
    assert.equal(reads.slice(before).includes(skill), false, `no instruction read past ${denied} ceiling`);
    assert.equal(has(result, "resource-refused"), true);
  }
});

test("untrusted project settings are retained evidence, never package/root probing authority", async t => {
  const f = fixture(t), pkg = f.package(join(f.cwd, "untrusted-package"));
  const project = f.extension(join(f.cwd, ".pi/extensions/untrusted.js")), before = supplements.length;
  const result = await f.catalog({ projectTrusted: false, projectSettings: { packages: [pkg.path], extensions: [project] } });
  assert.equal(result.native.extensions.length, 0); assert.equal(result.configuredPackages.length, 0);
  assert.equal(supplements.length, before); assert.equal(has(result, "project-trust"), true);
  assert.deepEqual(result.raw.project.packages, [pkg.path]); f.inert();
});

test("qualified missing npm source: public skip callback, real allowed location probe, zero install/fetch/session/factory", async t => {
  const f = fixture(t), probe = join(f.dir, "npm-probe.cjs"), records = join(f.dir, "npm-operations.jsonl"), npmRoot = join(f.dir, "global-node-modules");
  fs.mkdirSync(npmRoot);
  write(probe, `const fs = require('node:fs'); const args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(records)}, JSON.stringify(args)+'\\n');\nif (JSON.stringify(args) !== '["root","-g"]') { process.exitCode = 91; } else { process.stdout.write(${JSON.stringify(npmRoot)}+'\\n'); }\n`);
  allowedProbes.add(probe); const beforeMissing = missing.length, beforeProcesses = processes.length;
  const source = "npm:catalog-fixture-does-not-exist@1.0.0";
  const result = await f.catalog({ globalSettings: { packages: [source], npmCommand: [process.execPath, probe] } });
  assert.deepEqual(missing.slice(beforeMissing), [{ source, action: "skip" }], "actual public missing branch reached with offline mode disabled");
  assert.ok(processes.length > beforeProcesses, "actual native command probe reached");
  assert.deepEqual(fs.readFileSync(records, "utf8").trim().split("\n").map(JSON.parse), [["root", "-g"]]);
  assert.equal(fs.existsSync(join(f.agentDir, "npm")), false, "no install project created");
  assert.equal(has(result, "missing-source"), true); assert.equal(has(result, "broken-package"), true);
  assert.equal(result.ok, false); assert.equal(forbidden.length, 0); f.inert();
});

test("same lexical installed paths keep keys/choices across readonly symlink target updates", async t => {
  const f = fixture(t), first = f.package(join(f.dir, "store-v1")), second = f.package(join(f.dir, "store-v2"));
  for (const pkg of [first, second]) {
    for (const path of [pkg.extension, pkg.skill, join(pkg.path, "package.json")]) f.readonly(path, 0o444);
    f.readonly(pkg.path, 0o555);
  }
  const installed = join(f.agentDir, "installed"); fs.symlinkSync(first.path, installed);
  const metadata = f.metadata([{ source: installed }], [member("extension", installed, "extensions/main.js")]);
  const options = { globalSettings: { packages: [installed] }, metadata, choices: identity => identity.kind === "extension" ? { global: "disabled" } : {} };
  const a = await f.catalog(options); fs.unlinkSync(installed); fs.symlinkSync(second.path, installed); const b = await f.catalog(options);
  const path = join(installed, "extensions/main.js");
  assert.notEqual(fs.realpathSync(first.path), fs.realpathSync(installed));
  assert.equal(selectionKey(row(a, "extension", path).identity), selectionKey(row(b, "extension", path).identity));
  assert.equal(row(a, "extension", path).selection.enabled, false); assert.equal(row(b, "extension", path).selection.enabled, false);
  assert.equal(a.ok, true); assert.equal(b.ok, true); f.inert();
});

test("source generation changes during observation refuse a mixed snapshot without a transaction framework", async t => {
  const f = fixture(t), pkg = f.package(); let changed = false;
  const result = await f.catalog({ globalSettings: { packages: [pkg.path] }, eligibility: resource => {
    if (resource.kind === "extension" && !changed) {
      changed = true; fs.appendFileSync(join(pkg.path, "package.json"), "\n");
    }
    return { source: true, trust: true, profile: true };
  } });
  assert.equal(changed, true); assert.equal(has(result, "source-generation"), true); assert.equal(result.ok, false);
  assert.equal(selections(result, "extension").every(value => value.enabled === false), true); f.inert();
});

test("metadata generation/context and discovery admission are fail-closed preconditions", async t => {
  const f = fixture(t), metadata = f.metadata();
  fs.appendFileSync(metadata.generation.path, "\n");
  await assert.rejects(f.catalog({ metadata }), /generation changed/);
  const before = resolutions.length;
  await assert.rejects(f.catalog({ discoveryAdmitted: false }), /independent admission/);
  assert.equal(resolutions.length, before, "no native discovery before admission");
  assert.equal(forbidden.length, 0);
});
