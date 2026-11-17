import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createJiti } from "jiti";

// Same finite native package shapes/findings as catalog.test.mjs. Actual public
// SDK + canonical context + atomic store; no loader/session/install/live files.
// Stable forwarding hooks precede production imports, retaining real native I/O.
const root = fs.mkdtempSync(join(tmpdir(), "native-import-"));
const envKeys = ["HOME", "PI_CODING_AGENT_DIR", "PI_OFFLINE"];
const env = envKeys.map(key => [key, process.env[key]]);
process.env.HOME = join(root, "home"); fs.mkdirSync(process.env.HOME);
process.env.PI_CODING_AGENT_DIR = join(root, "ambient"); fs.mkdirSync(process.env.PI_CODING_AGENT_DIR);
process.env.PI_OFFLINE = "1";
const globals = ["__piAllowedRootsCache", "__piAdditionalAllowedRoots", "__piSessionPathCache", "__piPathToSessionIdCache"];
const savedGlobals = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const restores = [], forbidden = [], opened = new Map(), reads = [];
let onRead, onStage, onRename, resolving;
function replace(object, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  restores.push(() => { if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key]; });
  Object.defineProperty(object, key, { ...descriptor, value });
}
const native = Object.fromEntries(["openSync", "closeSync", "readSync", "writeFileSync", "renameSync"].map(key => [key, fs[key]]));
replace(fs, "openSync", (...args) => { const fd = native.openSync(...args); opened.set(fd, args[0]); return fd; });
replace(fs, "closeSync", fd => { const result = native.closeSync(fd); opened.delete(fd); return result; });
replace(fs, "readSync", (...args) => { reads.push(opened.get(args[0])); onRead?.(opened.get(args[0])); return native.readSync(...args); });
replace(fs, "writeFileSync", (...args) => { const result = native.writeFileSync(...args); if (typeof args[0] === "number" && String(opened.get(args[0])).endsWith(".tmp")) onStage?.(); return result; });
replace(fs, "renameSync", (...args) => { const result = native.renameSync(...args); onRename?.(...args); return result; });
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const original = cp[key];
  replace(cp, key, (...args) => {
    const argv = args[1], options = args[2];
    const cwd = Array.isArray(argv) && argv.includes("-C") ? argv[argv.indexOf("-C") + 1] : options?.cwd;
    if (args[0] !== "git" || typeof cwd !== "string" || !cwd.startsWith(root + "/")) {
      forbidden.push(`process:${key}:${String(args[0])}`); throw new Error("Unadmitted native import subprocess");
    }
    return Reflect.apply(original, cp, args);
  });
}
replace(globalThis, "fetch", () => { forbidden.push("fetch"); throw new Error("No native import transport"); });
syncBuiltinESMExports();
const jiti = createJiti(import.meta.url, { fsCache: false, nativeModules: ["@earendil-works/pi-coding-agent"] });
let importer, contextOwner, access, store, selection, sdk;
function restore() {
  onRead = onStage = onRename = resolving = undefined;
  for (const undo of restores.reverse()) undo(); syncBuiltinESMExports();
  for (const [key, value] of env) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
after(() => { try { assert.equal(opened.size, 0, "all owned native descriptors closed"); assert.deepEqual(forbidden, []); } finally { restore(); } });
try {
  sdk = await jiti.import("@earendil-works/pi-coding-agent");
  const deny = (object, key) => { assert.equal(typeof object[key], "function", `real public SDK capability ${key}`); replace(object, key, () => { forbidden.push(key); throw new Error(`Forbidden ${key}`); }); };
  for (const key of ["install", "installAndPersist", "remove", "removeAndPersist", "update"]) deny(sdk.DefaultPackageManager.prototype, key);
  for (const key of ["create", "open", "inMemory", "listAll"]) deny(sdk.SessionManager, key);
  deny(sdk.SettingsManager, "create"); deny(sdk.DefaultResourceLoader.prototype, "reload");
  deny(sdk.SettingsManager.prototype, "flush");
  for (const key of ["setPackages", "setProjectPackages", "setSkillPaths", "setProjectSkillPaths", "setExtensionPaths", "setProjectExtensionPaths", "setPromptTemplatePaths", "setProjectPromptTemplatePaths", "setThemePaths", "setProjectThemePaths"]) deny(sdk.SettingsManager.prototype, key);
  const resolve = sdk.DefaultPackageManager.prototype.resolve;
  replace(sdk.DefaultPackageManager.prototype, "resolve", async function (...args) { resolving?.(); return resolve.apply(this, args); });
  importer = await jiti.import("./native-import.ts");
  contextOwner = await jiti.import("./context.ts"); access = await jiti.import("../file-access.ts");
  store = await jiti.import("./preferences.ts"); selection = await jiti.import("./selection.ts");
} catch (error) { restore(); throw error; }
const { captureNativeImportSources: capture, deriveNativeImport: derive, ensureScopedNativeImport: ensure } = importer;
const globalTarget = { scope: "global", binding: null };
const git = (cwd, ...args) => cp.execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function repository(path) {
  fs.mkdirSync(path); git(path, "init", "-qb", "main");
  git(path, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "base");
}
async function fixture(t, { project = false } = {}) {
  const base = fs.mkdtempSync(join(root, "case-")), agentDir = join(base, "agent"), cwd = join(base, "project");
  fs.mkdirSync(agentDir, { mode: 0o700 }); fs.mkdirSync(join(agentDir, ".git"));
  if (project) repository(cwd); else { fs.mkdirSync(cwd); fs.mkdirSync(join(cwd, ".git")); }
  process.env.PI_CODING_AGENT_DIR = agentDir;
  for (const key of globals) globalThis[key] = undefined;
  access.allowFileRoot(cwd);
  const context = await contextOwner.resolveResourceContext({ cwd });
  const paths = new Set([agentDir, cwd, join(agentDir, "skills"), join(agentDir, "extensions"), join(agentDir, "prompts"), join(agentDir, "themes"), join(process.env.HOME, ".agents")]);
  const remember = path => { paths.add(path); for (let p = dirname(path); p.startsWith(base + "/"); p = dirname(p)) paths.add(p); return path; };
  const write = (path, text) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text); return remember(path); };
  const skill = (path, name = "guide", manual = true) => write(path, `---\nname: ${name}\ndescription: Synthetic native import fixture.\ndisable-model-invocation: ${manual}\n---\nInstructions\n`);
  const extension = path => write(path, `throw new Error('native import MUST NOT execute this extension');\nexport default () => {};\n`);
  const pkg = (path = join(base, "package")) => {
    const ext = extension(join(path, "extensions/main.js")), sk = skill(join(path, "skills/guide/SKILL.md"));
    write(join(path, "package.json"), JSON.stringify({ type: "module", pi: { extensions: ["extensions/main.js"], skills: ["skills/guide"] } }));
    for (const plural of ["extensions", "skills", "prompts", "themes"]) remember(join(path, plural));
    return { path, ext, sk };
  };
  const settings = (value, scope = "global") => write(scope === "global" ? join(agentDir, "settings.json") : join(cwd, ".pi/settings.json"), JSON.stringify(value));
  const input = (scope = "global", overrides = {}) => ({ context, scope, catalog: { discoveryAdmitted: true, metadata: { status: "unconfigured" }, managedMetadataTrusted: true,
    eligibility: () => ({ source: true, trust: true, profile: true }) }, admittedEvidencePaths: [...paths],
    assertNativeReadAllowed(path) { assert.ok(path.startsWith(base + "/") || path === join(process.env.HOME, ".agents"), `synthetic admitted native path ${path}`); },
    assertPublicationCurrent() {}, ...overrides });
  const disposers = [];
  t.after(() => { onRead = onStage = onRename = resolving = undefined; for (const dispose of disposers) dispose(); assert.equal(opened.size, 0); assert.deepEqual(forbidden, []); });
  return { base, agentDir, cwd, context, paths, remember, write, skill, extension, pkg, settings, input, disposers };
}
const off = source => ({ source, extensions: [], skills: [], prompts: [], themes: [] });
const ownFile = f => join(f.agentDir, "brabbler/resource-preferences.json");
const absentStore = f => assert.equal(fs.existsSync(ownFile(f)), false);
const nativeSentinels = f => [...f.paths].filter(path => { try { return fs.lstatSync(path).isFile(); } catch { return false; } }).map(path => [path, fs.lstatSync(path).mode, fs.readFileSync(path).toString("base64")]);
// Actual resolver, not a replica of parent/default semantics. Proposed choices
// below expose the meaning that an unsafe import would publish, without writing.
const prospective = (c, decisions) => selection.resolveSelection(c.catalog.rows.filter(row => row.identity).map(row => {
  const decision = decisions.find(d => selection.selectionKey(d.identity) === selection.selectionKey(row.identity));
  return { identity: row.identity, parent: row.parent, eligibility: { source: true, trust: true, profile: true },
    choices: decision ? { [c.scope]: decision.value } : {} };
}), c.context);

test("ordinary four-empty package imports ONE gate without history; newly added members inherit Off", async t => {
  const f = await fixture(t), p = f.pkg(); f.settings({ packages: [off(p.path)], unrelatedSecret: "never persisted" });
  const before = nativeSentinels(f), c = await capture(f.input()), receipt = derive(c);
  assert.equal(receipt.decisions.length, 1); assert.equal(receipt.decisions[0].rule, "whole-package-off");
  assert.equal(receipt.decisions[0].identity.kind, "package"); assert.equal(receipt.decisions[0].value, "disabled");
  assert.ok(c.catalog.rows.find(row => row.kind === "extension").selection.enabled, "desired default is NOT native evidence");
  const resolvedImport = prospective(c, receipt.decisions);
  for (const [plural, kind] of [["extensions", "extension"], ["skills", "skill"]]) {
    const row = c.catalog.rows.find(row => row.kind === kind), winner = c.catalog.native[plural].find(resource => row.observedPaths.includes(resource.path));
    assert.equal(winner.path, row.path); assert.equal(winner.metadata.origin, "package"); assert.equal(winner.enabled, false);
    assert.equal(resolvedImport.find(value => value.identity.path === row.path).enabled, winner.enabled, "direct package Off preserves actual SDK availability");
  }
  const result = await ensure(f.input()); assert.equal(result.choices.length, 1);
  assert.deepEqual(nativeSentinels(f), before); assert.ok(!fs.readFileSync(ownFile(f), "utf8").includes("never persisted"));
  const fresh = f.extension(join(p.path, "extensions/new.js"));
  f.write(join(p.path, "package.json"), JSON.stringify({ type: "module", pi: { extensions: ["extensions/main.js", "extensions/new.js"], skills: ["skills/guide"] } }));
  const nextCatalog = (await capture(f.input())).catalog;
  const resolved = selection.resolveSelection(nextCatalog.rows.filter(row => row.identity).map(row => ({ identity: row.identity, parent: row.parent,
    eligibility: { source: true, trust: true, profile: true }, choices: result.choices.some(choice => selection.selectionKey(choice.identity) === selection.selectionKey(row.identity)) ? { global: "disabled" } : {} })), f.context.selection);
  assert.equal(resolved.find(row => row.identity.path === fresh).enabled, false, "real newly discovered native member inherits the recorded package gate");
});

for (const filters of [{ extensions: [] }, { extensions: ["extensions/main.js"] }, { extensions: ["!extensions/main.js"] }, { extensions: ["*", "-extensions/main.js", "+extensions/main.js"] }]) {
  test(`narrower ordinary filters use concrete public SDK booleans ${JSON.stringify(filters)}`, async t => {
    const f = await fixture(t), p = f.pkg(); f.settings({ packages: [{ source: p.path, ...filters }] });
    const c = await capture(f.input()), receipt = derive(c), row = c.catalog.rows.find(row => row.kind === "extension");
    assert.equal(receipt.decisions.length, 1); assert.equal(receipt.decisions[0].rule, "individual");
    assert.equal(receipt.decisions[0].value, row.nativeEnabled ? "enabled" : "disabled");
    assert.equal(receipt.decisions[0].identity.path, p.ext); assert.ok(!receipt.decisions.some(d => d.identity.kind === "package"));
    await ensure(f.input());
  });
}
for (const delta of [{ ...off("placeholder"), autoload: false }, { autoload: false, extensions: ["-extensions/main.js"] }]) {
  test(`delta ${JSON.stringify(delta)} never fabricates Off/completion`, async t => {
    const f = await fixture(t), p = f.pkg(); f.settings({ packages: [{ ...delta, source: p.path }] });
    await assert.rejects(ensure(f.input()), /unsupported-delta|delta attribution/); absentStore(f);
  });
}
test("narrow filter refuses confirmed alias winner rather than borrowing its enabled bit", async t => {
  const f = await fixture(t), p = f.pkg(), alias = join(f.agentDir, "extensions/alias.js");
  fs.mkdirSync(dirname(alias)); fs.symlinkSync(p.ext, alias); f.remember(alias);
  f.settings({ packages: [{ source: p.path, extensions: [] }] });
  await assert.rejects(ensure(f.input()), /alias\/shadow/); absentStore(f);
});
for (const [plural, kind, member, suffix] of [["extensions", "extension", "ext", "extensions/alias.js"], ["skills", "skill", "sk", "skills/alias/SKILL.md"]]) {
  test(`whole-package Off refuses an enabled native ${kind} alias winner before receipt`, async t => {
    const f = await fixture(t), p = f.pkg(), alias = join(f.agentDir, suffix);
    fs.mkdirSync(dirname(alias), { recursive: true }); fs.symlinkSync(p[member], alias); f.remember(alias);
    f.settings({ packages: [off(p.path)] });
    const before = nativeSentinels(f), c = await capture(f.input());
    assert.equal(c.catalog.ok, true);
    const child = c.catalog.rows.find(row => row.kind === kind), owner = c.catalog.rows.find(row => row.kind === "package");
    assert.equal(child.membership, "confirmed"); assert.equal(child.identity.path, p[member]);
    assert.equal(selection.selectionKey(child.parent), selection.selectionKey(owner.identity));
    assert.deepEqual(child.observedPaths, [alias]); assert.equal(child.nativeEnabled, true);
    const winner = c.catalog.native[plural].find(resource => resource.path === alias);
    assert.equal(winner.enabled, true); assert.notEqual(winner.metadata.origin, "package");
    const unsafe = prospective(c, [{ identity: owner.identity, value: "disabled" }, { identity: child.identity, value: "enabled" }]);
    assert.equal(unsafe.find(row => row.identity.path === child.path).enabled, false, "even child On cannot preserve the enabled SDK winner beneath package Off");
    assert.throws(() => derive(c), /whole-package Off.*enabled native winner.*remove duplicate aliases/);
    await assert.rejects(ensure(f.input()), /whole-package Off.*enabled native winner.*remove duplicate aliases/);
    absentStore(f); assert.equal(store.readScopedPreferences(f.context.selection, globalTarget).importReceipt, null);
    assert.deepEqual(nativeSentinels(f), before);
  });
}
test("top-level selectors refuse package-associated alias attribution even with a standalone winner", async t => {
  const f = await fixture(t), p = f.pkg(), alias = join(f.agentDir, "extensions/alias.js");
  fs.mkdirSync(dirname(alias)); fs.symlinkSync(p.ext, alias); f.remember(alias);
  const standalone = f.extension(join(f.agentDir, "extensions/standalone.js"));
  f.settings({ packages: [p.path], extensions: ["!**/alias.js"] });
  const before = nativeSentinels(f), c = await capture(f.input()); assert.equal(c.catalog.ok, true);
  const child = c.catalog.rows.find(row => row.kind === "extension" && row.path === p.ext);
  assert.equal(child.membership, "confirmed"); assert.equal(child.parent.kind, "package"); assert.deepEqual(child.observedPaths, [alias]);
  const aliasWinner = c.catalog.native.extensions.find(resource => resource.path === alias);
  const standaloneWinner = c.catalog.native.extensions.find(resource => resource.path === standalone);
  assert.notEqual(aliasWinner.metadata.origin, "package"); assert.equal(aliasWinner.enabled, false); assert.equal(child.nativeEnabled, false);
  assert.equal(standaloneWinner.enabled, true);
  const omitted = prospective(c, [{ identity: c.catalog.rows.find(row => row.path === standalone).identity, value: "enabled" }]);
  assert.equal(omitted.find(row => row.identity.path === child.path).enabled, true, "omitting the disabled SDK alias would silently restore Enabled baseline");
  assert.throws(() => derive(c), /top-level selector.*package-associated native winner.*remove duplicate aliases/);
  await assert.rejects(ensure(f.input()), /top-level selector.*package-associated native winner.*remove duplicate aliases/);
  absentStore(f); assert.equal(store.readScopedPreferences(f.context.selection, globalTarget).importReceipt, null);
  assert.deepEqual(nativeSentinels(f), before);
});
test("duplicate package ownership refuses with actionable provenance and no writes", async t => {
  const f = await fixture(t), p = f.pkg(), alias = join(f.base, "alias"); fs.symlinkSync(p.path, alias);
  for (const suffix of ["", "package.json", "extensions", "extensions/main.js", "skills", "skills/guide", "skills/guide/SKILL.md", "prompts", "themes"]) f.remember(join(alias, suffix));
  f.settings({ packages: [off(p.path), alias] }); await assert.rejects(ensure(f.input()), /ambiguous-owner/); absentStore(f);
});
test("authored manual-only and registration alone import empty, preserving native bytes", async t => {
  const f = await fixture(t), p = f.pkg(); f.settings({ packages: [p.path], prompts: [], themes: [] });
  const before = nativeSentinels(f), c = await capture(f.input());
  assert.equal(c.catalog.rows.find(row => row.kind === "skill").skill.disableModelInvocation, true);
  assert.deepEqual(derive(c).decisions, []); const result = await ensure(f.input()); assert.ok(result.importReceipt); assert.deepEqual(result.choices, []);
  assert.deepEqual(nativeSentinels(f), before);
});
test("top-level selector snapshot uses exact native provenance, not a homegrown glob", async t => {
  const f = await fixture(t), ext = f.extension(join(f.agentDir, "extensions/main.js")); f.settings({ extensions: ["!**/main.js"] });
  const c = await capture(f.input()), d = derive(c).decisions;
  assert.equal(d.length, 1); assert.equal(d[0].identity.path, ext);
  assert.equal(d[0].value, c.catalog.native.extensions[0].enabled ? "enabled" : "disabled"); await ensure(f.input());
});
test("completed EMPTY receipt wins BEFORE capture even after malformed Pi edits, rollback/re-upgrade and broken admission availability", async t => {
  const f = await fixture(t); const initial = await ensure(f.input()); assert.ok(initial.importReceipt); assert.deepEqual(initial.choices, []);
  f.write(join(f.agentDir, "settings.json"), "{broken later Pi edit"); const start = reads.length;
  const result = await ensure(f.input("global", { assertNativeReadAllowed() { throw new Error("MUST NOT recapture"); }, assertPublicationCurrent() { throw new Error("MUST NOT rederive"); } }));
  assert.deepEqual(result, initial); assert.equal(reads.slice(start).includes(join(f.agentDir, "settings.json")), false);
});
test("nonempty receipt survives own-choice edits and later corrupt Pi state without reimport", async t => {
  const f = await fixture(t), p = f.pkg(); f.settings({ packages: [off(p.path)] });
  const imported = await ensure(f.input());
  const edited = await store.saveScopedPreference(f.context.selection, globalTarget, imported.revision, imported.choices[0].identity, "enabled", f.context.assertAdmissionCurrent);
  f.write(join(f.agentDir, "settings.json"), "invalid later native state");
  const result = await ensure(f.input("global", { assertNativeReadAllowed() { throw new Error("no recapture"); } }));
  assert.deepEqual(result, edited); assert.equal(result.choices[0].value, "enabled"); assert.deepEqual(result.importReceipt, imported.importReceipt);
});
test("unexplained preexisting preferences refuse before native capture, never overwrite", async t => {
  const f = await fixture(t), identity = { agentDir: f.agentDir, origin: { scope: "global" }, kind: "extension", path: join(f.agentDir, "old.js") };
  await store.saveScopedPreference(f.context.selection, globalTarget, store.readScopedPreferences(f.context.selection, globalTarget).revision, identity, "disabled", f.context.assertAdmissionCurrent);
  const before = fs.readFileSync(ownFile(f));
  await assert.rejects(ensure(f.input("global", { assertNativeReadAllowed() { throw new Error("no capture"); } })), /unexplained preferences/);
  assert.deepEqual(fs.readFileSync(ownFile(f)), before);
});
test("Global is independent of visited Project; Project origins and agentDir namespaces stay separate", async t => {
  const f = await fixture(t, { project: true }), globalPkg = f.pkg(), projectPkg = f.pkg(join(f.base, "project-package"));
  f.skill(projectPkg.sk, "project-guide");
  f.settings({ packages: [off(globalPkg.path)] }); f.settings({ packages: [off(projectPkg.path)] }, "project");
  const global = await ensure(f.input()), project = await ensure(f.input("project"));
  assert.equal(global.choices.length, 1); assert.equal(global.choices[0].identity.path, globalPkg.path);
  assert.equal(project.choices.length, 1); assert.equal(project.choices[0].identity.origin.scope, "project");
  assert.equal(project.target.binding, f.context.selection.projectBinding);
  const other = await fixture(t); assert.notEqual(other.agentDir, f.agentDir); assert.deepEqual((await ensure(other.input())).choices, []);
});
test("linked registered roots share one Project receipt without recapturing another worktree", async t => {
  const f = await fixture(t, { project: true }), linked = join(f.base, "linked");
  git(f.cwd, "worktree", "add", "-qb", "linked", linked); access.allowFileRoot(linked);
  const a = await ensure(f.input("project")), context = await contextOwner.resolveResourceContext({ cwd: linked });
  assert.equal(context.selection.projectBinding, f.context.selection.projectBinding);
  const b = await ensure(f.input("project", { context, assertNativeReadAllowed() { throw new Error("no recapture"); } })); assert.deepEqual(a, b);
});
test("new repository incarnation cannot reuse a Project receipt", async t => {
  const f = await fixture(t, { project: true }); const a = await ensure(f.input("project"));
  fs.renameSync(f.cwd, f.cwd + "-held"); repository(f.cwd);
  await assert.rejects(ensure(f.input("project")), /context refused: generation/);
  const context = await contextOwner.resolveResourceContext({ cwd: f.cwd }); assert.notEqual(context.selection.projectBinding, a.target.binding);
  assert.equal(store.readScopedPreferences(context.selection, { scope: "project", binding: context.selection.projectBinding }).importReceipt, null);
});
test("unsupported Project and historical Session requests refuse before source capture", async t => {
  const f = await fixture(t); assert.equal(f.context.selection.projectBinding, null);
  await assert.rejects(ensure(f.input("project")), /registered Project/);
  await assert.rejects(ensure(f.input("session")), /no historical Session/); absentStore(f);
});
for (const [name, text] of [["BOM", "\ufeff{}"], ["empty", ""], ["unrelated keys", '{"arbitrary":{"native":"preserved"}}']]) test(`native ${name} settings import empty with distinct byte evidence`, async t => {
  const f = await fixture(t); f.write(join(f.agentDir, "settings.json"), text); const before = nativeSentinels(f);
  assert.deepEqual((await ensure(f.input())).choices, []); assert.deepEqual(nativeSentinels(f), before);
});
for (const [name, text] of [["JSON", "{"], ["root", "[]"], ["skills", '{"skills":42}'], ["package array", '{"packages":{}}'], ["filter", '{"packages":[{"source":"/x","extensions":[2]}]}'], ["legacy", '{"skills":{"customDirectories":42}}']]) test(`invalid consumed ${name} refuses without store`, async t => {
  const f = await fixture(t); f.write(join(f.agentDir, "settings.json"), text); await assert.rejects(ensure(f.input()), /Native import refused/); absentStore(f);
});
test("legitimate readonly Nix-like symlinks accepted, all target bytes/modes preserved and modes restored before disposal", async t => {
  const f = await fixture(t), p = f.pkg(), target = f.write(join(f.base, "nix-settings"), JSON.stringify({ packages: [off(p.path)] }));
  fs.symlinkSync(target, join(f.agentDir, "settings.json"));
  const owned = [target, p.ext, p.sk, join(p.path, "package.json")].map(path => { const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); return { fd, stat: fs.fstatSync(fd), path }; });
  f.disposers.push(() => { for (const { fd, stat } of owned) { try { assert.equal(fs.fstatSync(fd).ino, stat.ino); fs.fchmodSync(fd, stat.mode & 0o7777); assert.equal(fs.fstatSync(fd).mode & 0o7777, stat.mode & 0o7777); } finally { fs.closeSync(fd); } } });
  for (const { fd } of owned) fs.fchmodSync(fd, 0o444);
  const before = nativeSentinels(f); assert.equal((await ensure(f.input())).choices[0].value, "disabled"); assert.deepEqual(nativeSentinels(f), before); assert.equal(fs.realpathSync(join(f.agentDir, "settings.json")), target);
});
for (const kind of ["dangling", "directory", "oversize", "invalid-encoding"]) test(`strict native settings ${kind} refusal`, async t => {
  const f = await fixture(t), path = join(f.agentDir, "settings.json");
  if (kind === "dangling") fs.symlinkSync(join(f.base, "missing"), path);
  if (kind === "directory") fs.mkdirSync(path);
  if (kind === "oversize") fs.writeFileSync(path, Buffer.alloc(1024 * 1024 + 1));
  if (kind === "invalid-encoding") fs.writeFileSync(path, Buffer.from([0xff]));
  await assert.rejects(ensure(f.input()), /Native import refused/); absentStore(f);
});
for (const race of ["settings", "absence", "manifest", "member", "symlink"]) test(`source ${race} changes during SDK preparation refuse without receipt`, async t => {
  const f = await fixture(t), p = f.pkg();
  if (race !== "absence") f.settings({ packages: [off(p.path)] });
  if (race === "symlink") { fs.unlinkSync(join(f.agentDir, "settings.json")); const target = f.write(join(f.base, "settings-target"), JSON.stringify({ packages: [off(p.path)] })); fs.symlinkSync(target, join(f.agentDir, "settings.json")); }
  resolving = () => { resolving = undefined;
    if (race === "settings" || race === "absence") f.settings({ packages: [p.path] });
    if (race === "manifest") fs.appendFileSync(join(p.path, "package.json"), " ");
    if (race === "member") fs.appendFileSync(p.ext, "// changed\n");
    if (race === "symlink") { fs.unlinkSync(join(f.agentDir, "settings.json")); fs.symlinkSync(f.write(join(f.base, "replacement"), "{}"), join(f.agentDir, "settings.json")); }
  };
  await assert.rejects(ensure(f.input()), /changed|BEFORE evidence|source-generation|unresolved/); absentStore(f);
});
test("source/trust/profile ceiling refusal is not imported as availability Off", async t => {
  const f = await fixture(t), p = f.pkg(); f.settings({ packages: [off(p.path)] });
  const input = f.input(); input.catalog.eligibility = () => ({ source: true, trust: false, profile: true });
  await assert.rejects(ensure(input), /source-refused|resource-refused|unresolved/); absentStore(f);
});
test("eligibility callback mutations of native settings cannot publish stale evidence", async t => {
  const f = await fixture(t), p = f.pkg(), path = f.settings({ packages: [off(p.path)] }); let changed = false;
  const input = f.input(); input.catalog.eligibility = () => { if (!changed) { changed = true; fs.appendFileSync(path, " "); } return { source: true, trust: true, profile: true }; };
  await assert.rejects(ensure(input), /changed since preparation/); absentStore(f);
});
test("bounded descriptor observes replacement during read, not silent short/growing capture", async t => {
  const f = await fixture(t), path = f.settings({});
  onRead = file => { if (file === path) { onRead = undefined; fs.appendFileSync(path, " "); } };
  await assert.rejects(ensure(f.input()), /changed during capture/); absentStore(f);
});
test("missing BEFORE member evidence refuses rather than inventing source coverage", async t => {
  const f = await fixture(t), p = f.pkg(); f.settings({ packages: [off(p.path)] }); f.paths.delete(p.ext);
  await assert.rejects(ensure(f.input()), /BEFORE evidence/); absentStore(f);
});
for (const phase of ["stage", "final async publication"]) test(`${phase} source mutation cannot publish choices/receipt`, async t => {
  const f = await fixture(t), p = f.pkg(), path = f.settings({ packages: [off(p.path)] }); let calls = 0;
  if (phase === "stage") onStage = () => { onStage = undefined; fs.appendFileSync(path, " "); };
  await assert.rejects(ensure(f.input("global", { async assertPublicationCurrent() { await Promise.resolve(); if (++calls === 4 && phase !== "stage") fs.appendFileSync(path, " "); } })), /changed/);
  absentStore(f);
});
test("async publication callback concurrent store choice is fenced by actual CAS", async t => {
  const f = await fixture(t), p = f.pkg(); f.settings({ packages: [off(p.path)] }); let calls = 0;
  const identity = { agentDir: f.agentDir, origin: { scope: "global" }, kind: "extension", path: p.ext };
  await assert.rejects(ensure(f.input("global", { async assertPublicationCurrent() { if (++calls === 2) await store.saveScopedPreference(f.context.selection, globalTarget, store.readScopedPreferences(f.context.selection, globalTarget).revision, identity, "enabled", f.context.assertAdmissionCurrent); } })), /conflict/);
  const result = store.readScopedPreferences(f.context.selection, globalTarget); assert.equal(result.importReceipt, null); assert.equal(result.choices[0].value, "enabled");
});
test("lost acknowledgement rereads receipt ONCE, no duplicate import/capture", async t => {
  const f = await fixture(t), p = f.pkg(); f.settings({ packages: [off(p.path)] }); let resolutions = 0, renames = 0;
  resolving = () => resolutions++;
  onRename = (_from, to) => { if (to === ownFile(f)) { renames++; throw new Error("lost acknowledgement after native rename"); } };
  const result = await ensure(f.input()); assert.ok(result.importReceipt); assert.equal(resolutions, 1); assert.equal(renames, 1);
  onRename = undefined; assert.deepEqual(store.readScopedPreferences(f.context.selection, globalTarget), result);
});
