import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Actual connected HTTP handlers, public inert SDK, canonical context, import and
// private atomic store. External capability denials precede production imports.
// No UI/network/runtime-application or exhaustive discovery/hostile-writer proof.
const root = fs.mkdtempSync(join(tmpdir(), "resource-api-"));
const keys = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "PI_CODING_AGENT_DIR", "PI_OFFLINE", "BRABBLER_ALLOWED_HOSTS", "BRABBLER_HOSTNAME"];
const env = keys.map(key => [key, process.env[key]]);
const globals = ["__piAllowedRootsCache", "__piAdditionalAllowedRoots", "__piSessionPathCache", "__piPathToSessionIdCache"];
const savedGlobals = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const restores = [], forbidden = [], open = new Map(), writes = [];
let observing = false, onStage, nativeResolves = 0;
function replace(object, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  restores.push(() => { if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key]; });
  Object.defineProperty(object, key, { ...descriptor, value });
}
function deny(object, key) { assert.equal(typeof object[key], "function", key); replace(object, key, () => { forbidden.push(key); throw new Error(`Forbidden resource API effect: ${key}`); }); }
function restore() {
  observing = false; onStage = undefined;
  for (const undo of restores.reverse()) undo(); syncBuiltinESMExports();
  for (const [key, value] of env) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
after(() => { try { assert.equal(open.size, 0); assert.deepEqual(forbidden, []); } finally { restore(); } });
let route, store, contextOwner, access;
try {
  process.env.HOME = join(root, "home"); process.env.XDG_CONFIG_HOME = join(root, "config"); process.env.XDG_CACHE_HOME = join(root, "cache");
  process.env.PI_CODING_AGENT_DIR = join(root, "ambient"); process.env.PI_OFFLINE = "1";
  delete process.env.BRABBLER_ALLOWED_HOSTS; delete process.env.BRABBLER_HOSTNAME;
  for (const dir of [process.env.HOME, process.env.PI_CODING_AGENT_DIR]) fs.mkdirSync(dir);
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
    const original = cp[key];
    replace(cp, key, (...args) => {
      const argv = args[1], cwd = Array.isArray(argv) && argv.includes("-C") ? argv[argv.indexOf("-C") + 1] : undefined;
      if (args[0] !== "git" || !cwd?.startsWith(root + "/")) { forbidden.push(`process:${key}:${args[0]}`); throw new Error("Only private fixture Git is admitted"); }
      return Reflect.apply(original, cp, args);
    });
  }
  deny(globalThis, "fetch");
  const originals = Object.fromEntries(["openSync", "closeSync", "writeFileSync", "renameSync", "mkdirSync", "rmdirSync", "utimesSync"].map(key => [key, fs[key]]));
  replace(fs, "openSync", (...args) => { const fd = originals.openSync(...args); open.set(fd, args[0]);
    const flags = args[1];
    if (observing && (typeof flags === "string" ? /[wa+]/.test(flags) : flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR))) writes.push({ operation: "openSync", path: String(args[0]) }); return fd; });
  replace(fs, "closeSync", fd => { const result = originals.closeSync(fd); open.delete(fd); return result; });
  replace(fs, "writeFileSync", (...args) => { if (observing) writes.push({ operation: "writeFileSync", path: String(typeof args[0] === "number" ? open.get(args[0]) : args[0]) });
    const result = originals.writeFileSync(...args); if (typeof args[0] === "number" && String(open.get(args[0])).endsWith(".tmp")) onStage?.(); return result; });
  for (const key of ["renameSync", "mkdirSync", "rmdirSync", "utimesSync"]) replace(fs, key, (...args) => {
    if (observing) writes.push(...args.slice(0, key === "renameSync" ? 2 : 1).map(path => ({ operation: key, path: String(path),
      existingDirectory: fs.existsSync(path) && fs.statSync(path).isDirectory(), recursive: args[1]?.recursive === true })));
    return originals[key](...args);
  });
  syncBuiltinESMExports();
  const jiti = createJiti(import.meta.url, { fsCache: false, alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) }, nativeModules: ["@earendil-works/pi-coding-agent"] });
  const sdk = await jiti.import("@earendil-works/pi-coding-agent");
  for (const key of ["install", "installAndPersist", "remove", "removeAndPersist", "update"]) deny(sdk.DefaultPackageManager.prototype, key);
  for (const key of ["create", "open", "inMemory", "listAll"]) deny(sdk.SessionManager, key);
  deny(sdk.DefaultResourceLoader.prototype, "reload"); deny(sdk.SettingsManager, "create");
  for (const key of ["set", "setMany"]) deny(sdk.ProjectTrustStore.prototype, key);
  for (const key of ["flush", "setPackages", "setProjectPackages", "setSkillPaths", "setProjectSkillPaths", "setExtensionPaths", "setProjectExtensionPaths", "setPromptTemplatePaths", "setProjectPromptTemplatePaths", "setThemePaths", "setProjectThemePaths"]) deny(sdk.SettingsManager.prototype, key);
  const resolve = sdk.DefaultPackageManager.prototype.resolve;
  replace(sdk.DefaultPackageManager.prototype, "resolve", function (...args) { nativeResolves++; return resolve.apply(this, args); });
  route = await jiti.import("../../app/api/agent-resources/route.ts");
  store = await jiti.import("./preferences.ts"); contextOwner = await jiti.import("./context.ts");
  access = await jiti.import("../file-access.ts");
} catch (error) { restore(); throw error; }
const git = (cwd, ...args) => cp.execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const off = source => ({ source, skills: [], extensions: [], prompts: [], themes: [] });
function fixture(t, { project = false, empty = false } = {}) {
  const base = fs.mkdtempSync(join(root, "case-")), agentDir = join(base, "agent"), cwd = join(base, "checkout");
  fs.mkdirSync(agentDir, { mode: 0o700 }); fs.mkdirSync(join(agentDir, ".git")); fs.mkdirSync(cwd);
  if (project) {
    git(cwd, "init", "-qb", "main");
    git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "base");
  }
  process.env.PI_CODING_AGENT_DIR = agentDir;
  for (const key of globals) globalThis[key] = undefined;
  access.allowFileRoot(cwd);
  const files = new Set();
  const write = (path, text) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, text); files.add(path); return path; };
  const pkg = join(agentDir, "managed/package"), ext = join(pkg, "extensions/main.js"), skill = join(pkg, "skills/guide/SKILL.md");
  if (!empty) {
    write(ext, 'throw new Error("Inventory MUST NOT import or execute extension factories"); export default () => {};\n');
    write(skill, "---\nname: pilot-guide\ndescription: Synthetic managed guide\ndisable-model-invocation: true\n---\nInstructions are not HTTP inventory content.\n");
    write(join(pkg, "package.json"), JSON.stringify({ name: "synthetic-managed", type: "module", pi: { extensions: ["extensions/main.js"], skills: ["skills/guide"], prompts: ["prompts/keep.md"], themes: ["themes/keep.json"] } }));
    write(join(pkg, "prompts/keep.md"), "Native prompt\n"); write(join(pkg, "themes/keep.json"), "{}\n");
  }
  write(join(agentDir, "settings.json"), JSON.stringify({ packages: empty ? [] : [off(pkg)], privateSetting: "DO NOT expose this captured value" }));
  write(join(agentDir, "resource-catalog.json"), JSON.stringify({ version: 1, groups: [{ key: "pilot", description: "Pilot resources" }],
    packages: empty ? [] : [{ source: pkg, name: "synthetic-managed", group: "pilot", managedBy: "nix" }],
    resources: empty ? [] : [{ kind: "extension", package: pkg, path: "extensions/main.js", managedBy: "nix" }, { kind: "skill", package: pkg, path: "skills/guide/SKILL.md", managedBy: "nix" }] }));
  const session = (id = "own-pilot", owner = cwd) => write(join(agentDir, "sessions/project", `2026-01-01T00-00-00-000Z_${id}.jsonl`), JSON.stringify({ type: "session", version: 3, id, cwd: owner, timestamp: "2026-01-01T00:00:00.000Z" }) + "\n");
  const snapshot = () => [...files].map(path => [path, fs.lstatSync(path).mode, fs.readFileSync(path).toString("base64")]);
  const preferences = join(agentDir, "brabbler/resource-preferences.json");
  t.after(() => { onStage = undefined; observing = false; assert.equal(open.size, 0); assert.deepEqual(forbidden, []); });
  return { base, agentDir, cwd, pkg, ext, skill, write, session, snapshot, preferences };
}
function request(method, body, headers = {}) {
  return new Request("http://localhost/api/agent-resources", { method, headers: { host: "localhost", "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
}
async function invoke(method, body, query = "", headers = {}) {
  const req = query ? new Request(`http://localhost/api/agent-resources?${query}`, { headers: { host: "localhost", ...headers } }) : request(method, body, headers);
  observing = true; const start = writes.length;
  let response, value;
  try { response = await route[method](req); value = await response.json(); } finally { observing = false; }
  assert.equal(response.headers.get("cache-control"), "no-store");
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  const operations = writes.slice(start), trustLock = join(agentDir, "trust.json.lock");
  const readLockMetadata = operation => operation.path === trustLock
    && (operation.operation === "mkdirSync" && !operation.recursive
      || ["rmdirSync", "utimesSync"].includes(operation.operation) && operation.existingDirectory);
  const unexpectedWrites = operations.filter(operation => {
    if (operation.path.startsWith(join(agentDir, "brabbler") + "/") || operation.path === join(agentDir, "brabbler")) return false;
    if (operation.operation === "mkdirSync" && operation.path === agentDir && operation.existingDirectory && operation.recursive) return false;
    return !readLockMetadata(operation);
  });
  assert.deepEqual(unexpectedWrites, [], "only Brabbler preferences and exact canonical trust read-lock directory metadata");
  assert.equal(fs.existsSync(trustLock), false, "canonical read lock released after response/body settlement");
  return { status: response.status, value, lockMetadata: operations.filter(readLockMetadata) };
}
async function inventory(f, { sessionId, cwd = f.cwd } = {}) {
  const result = await invoke("GET", undefined, new URLSearchParams({ cwd, ...(sessionId ? { sessionId } : {}) }));
  assert.equal(result.status, 200, JSON.stringify(result.value)); return result.value;
}
const row = (view, kind) => view.catalog.rows.find(row => row.kind === kind);
const change = (view, kind, scope, choice) => ({ ...(view.context.cwd ? { cwd: view.context.cwd } : {}), ...(view.context.sessionId ? { sessionId: view.context.sessionId } : {}),
  selectionKey: row(view, kind).selectionKey, scope, choice, contextToken: view.contextToken, revision: view.scopes[scope]?.revision ?? "0".repeat(64) });
const own = async f => store.readScopedPreferences((await contextOwner.resolveResourceContext({ cwd: f.cwd })).selection, { scope: "global", binding: null });

test("actual GET imports package Off once, returns inert desired hierarchy and replays receipt without native mutation", async t => {
  const f = fixture(t), before = f.snapshot();
  assert.equal(fs.existsSync(f.preferences), false);
  const view = await inventory(f), imported = await own(f);
  assert.equal(route.dynamic, "force-dynamic"); assert.equal(view.state, "desired");
  assert.deepEqual(view.context.scopes, { global: true, project: false, session: false });
  assert.equal(view.scopes.global.nativeImport, "completed"); assert.equal(imported.importReceipt.decisions.length, 1);
  assert.equal(imported.importReceipt.decisions[0].rule, "whole-package-off");
  assert.equal(row(view, "package").desired.scopes.global.choice, "disabled");
  assert.equal(row(view, "skill").desired.enabled, false); assert.equal(row(view, "skill").skill.disableModelInvocation, true);
  assert.equal(row(view, "extension").parentKey, row(view, "package").selectionKey);
  assert.ok(view.catalog.rows.some(row => row.kind === "prompt" && row.selectionKey === null));
  assert.ok(view.catalog.rows.some(row => row.kind === "theme" && row.selectionKey === null));
  const serialized = JSON.stringify(view);
  assert.equal(serialized.includes("DO NOT expose"), false); assert.equal(serialized.includes("Instructions are not"), false);
  assert.equal(serialized.includes('"applied"'), false);
  const bytes = fs.readFileSync(f.preferences), again = await inventory(f);
  assert.equal(again.scopes.global.revision, view.scopes.global.revision); assert.deepEqual(fs.readFileSync(f.preferences), bytes);
  assert.deepEqual((await own(f)).importReceipt, imported.importReceipt); assert.deepEqual(f.snapshot(), before);
});

test("confirmed installed symlink source uses existing physical admission and never writes read-only native contents", async t => {
  const f = fixture(t), target = join(f.base, "readonly-package");
  fs.renameSync(f.pkg, target); fs.symlinkSync(target, f.pkg);
  access.allowFileRoot(target); // Existing real file-access owner, never API self-admission.
  for (const path of [f.ext, f.skill, join(f.pkg, "package.json"), join(f.pkg, "prompts/keep.md"), join(f.pkg, "themes/keep.json")]) fs.chmodSync(path, 0o444);
  const before = f.snapshot(), view = await inventory(f);
  assert.equal(row(view, "package").path, f.pkg); assert.equal(row(view, "skill").path, f.skill);
  const edited = await invoke("PATCH", change(view, "package", "global", "enabled"));
  assert.equal(edited.status, 200, JSON.stringify(edited.value)); assert.equal(row(edited.value, "skill").desired.enabled, true);
  assert.deepEqual(f.snapshot(), before); assert.equal(fs.realpathSync(f.pkg), target);
});

test("connected PATCH edits a child under parent Off, CAS conflicts, inherit resets and native filters never become a second desired gate", async t => {
  const f = fixture(t), before = f.snapshot(), initial = await inventory(f), receipt = (await own(f)).importReceipt;
  const edited = await invoke("PATCH", change(initial, "extension", "global", "enabled"));
  assert.equal(edited.status, 200, JSON.stringify(edited.value));
  assert.equal(row(edited.value, "extension").desired.scopes.global.choice, "enabled");
  assert.equal(row(edited.value, "extension").desired.enabled, false, "parent still Off; edits are allowed");
  assert.equal((await invoke("PATCH", change(initial, "extension", "global", "disabled"))).status, 409);
  const enabled = await invoke("PATCH", change(edited.value, "package", "global", "enabled"));
  assert.equal(enabled.status, 200, JSON.stringify(enabled.value));
  assert.equal(row(enabled.value, "extension").nativeEnabled, false); assert.equal(row(enabled.value, "extension").desired.enabled, true);
  const reset = await invoke("PATCH", change(enabled.value, "extension", "global", "inherit"));
  assert.equal(reset.status, 200); assert.equal(row(reset.value, "extension").desired.scopes.global.choice, "inherit");
  assert.deepEqual((await own(f)).importReceipt, receipt); assert.deepEqual(f.snapshot(), before);
});

test("first PATCH also imports before CAS; Global/Project/own Session use real scopes, no historical Session receipt", async t => {
  const f = fixture(t, { project: true }); f.session();
  const first = await invoke("PATCH", { cwd: f.cwd, scope: "global", revision: "0".repeat(64), contextToken: "0".repeat(64), selectionKey: "unknown", choice: "enabled" });
  assert.equal(first.status, 409); assert.ok((await own(f)).importReceipt, "automatic first write attempt, not just GET");
  const before = f.snapshot(), initial = await inventory(f, { sessionId: "own-pilot" });
  assert.deepEqual(initial.context.scopes, { global: true, project: true, session: true });
  assert.equal(initial.scopes.project.nativeImport, "completed"); assert.equal(initial.scopes.session.nativeImport, "not-applicable");
  const project = await invoke("PATCH", change(initial, "package", "project", "enabled")); assert.equal(project.status, 200, JSON.stringify(project.value));
  assert.equal(row(project.value, "skill").desired.enabled, true);
  const session = await invoke("PATCH", change(project.value, "skill", "session", "disabled")); assert.equal(session.status, 200);
  assert.equal(row(session.value, "skill").desired.enabled, false); assert.equal(row(session.value, "extension").desired.enabled, true);
  const admitted = await contextOwner.resolveResourceContext({ cwd: f.cwd, sessionId: "own-pilot" });
  const projectImport = store.readScopedPreferences(admitted.selection, { scope: "project", binding: admitted.selection.projectBinding });
  assert.deepEqual(projectImport.importReceipt.decisions, [], "real empty Project receipt is complete, not a fabricated choice");
  const ownSession = store.readScopedPreferences(admitted.selection, { scope: "session", binding: admitted.selection.sessionBinding });
  assert.equal(ownSession.importReceipt, null); assert.equal(ownSession.choices.length, 1);
  assert.equal((await invoke("GET", undefined, new URLSearchParams({ cwd: f.cwd, sessionId: "foreign-session" }))).status, 403);
  assert.deepEqual(f.snapshot(), before);
});

test("trusted Project-local native filter imports and scoped save succeeds; fresh trust revocation fences staged save", async t => {
  const f = fixture(t, { project: true }), trustPath = join(f.agentDir, "trust.json");
  const local = f.write(join(f.cwd, ".pi/extensions/local.js"), 'throw new Error("must remain inert"); export default () => {};\n');
  f.write(join(f.cwd, ".pi/settings.json"), JSON.stringify({ extensions: ["!**/local.js"] }));
  f.write(trustPath, JSON.stringify({ [f.cwd]: true })); // Synthetic native input, not route authority.
  const before = f.snapshot(), loaded = await invoke("GET", undefined, new URLSearchParams({ cwd: f.cwd }));
  assert.equal(loaded.status, 200, JSON.stringify(loaded.value));
  for (const operation of ["mkdirSync", "utimesSync", "rmdirSync"]) assert.ok(loaded.lockMetadata.some(item => item.operation === operation), `actual canonical ${operation} witness`);
  const view = loaded.value, localRow = view.catalog.rows.find(item => item.path === local);
  assert.equal(localRow.nativeEnabled, false); assert.equal(localRow.desired.scopes.project.choice, "disabled");
  assert.equal(localRow.desired.scopes.global.editable, false, "Project origin has no Global choice");
  const context = await contextOwner.resolveResourceContext({ cwd: f.cwd }), destination = { scope: "project", binding: context.selection.projectBinding };
  const imported = store.readScopedPreferences(context.selection, destination);
  assert.equal(imported.importReceipt.decisions.length, 1); assert.equal(imported.importReceipt.decisions[0].identity.path, local);
  const body = { ...change(view, "package", "project", "enabled"), selectionKey: localRow.selectionKey };
  assert.equal((await invoke("PATCH", { ...body, scope: "global", revision: view.scopes.global.revision })).status, 400);
  const saved = await invoke("PATCH", body); assert.equal(saved.status, 200, JSON.stringify(saved.value));
  const selected = saved.value.catalog.rows.find(item => item.path === local);
  assert.equal(selected.desired.enabled, true); assert.equal(selected.nativeEnabled, false);
  assert.deepEqual(store.readScopedPreferences(context.selection, destination).importReceipt, imported.importReceipt);
  assert.deepEqual(f.snapshot(), before, "all native settings, trust and resource bytes/modes unchanged");
  const preferences = fs.readFileSync(f.preferences); let revoked = false, afterRevocation;
  onStage = () => { onStage = undefined; observing = false; try {
    f.write(trustPath, JSON.stringify({ [f.cwd]: false })); revoked = true; afterRevocation = f.snapshot();
  } finally { observing = true; } };
  const failed = await invoke("PATCH", { ...change(saved.value, "package", "project", "disabled"), selectionKey: localRow.selectionKey });
  assert.equal(revoked, true, "external trust revocation occurs after staging, not before admission");
  assert.equal(failed.status, 409, JSON.stringify(failed.value)); assert.deepEqual(fs.readFileSync(f.preferences), preferences, "no save after trust revocation");
  assert.deepEqual(f.snapshot(), afterRevocation);
});

test("explicitly denied Project refuses before import/receipt; subdirectory keeps Global and own Session only", async t => {
  const f = fixture(t, { project: true });
  f.write(join(f.cwd, ".pi/extensions/local.js"), 'throw new Error("must remain inert"); export default () => {};\n');
  f.write(join(f.agentDir, "trust.json"), JSON.stringify({ [f.cwd]: false }));
  const before = f.snapshot(), denied = await invoke("GET", undefined, new URLSearchParams({ cwd: f.cwd }));
  assert.equal(denied.status, 403, JSON.stringify(denied.value)); assert.equal(denied.value.code, "project-trust");
  assert.equal(fs.existsSync(f.preferences), false); assert.deepEqual(f.snapshot(), before);
  const subdir = join(f.cwd, "subdir"); fs.mkdirSync(subdir); f.session("sub-own", subdir);
  const sub = await inventory(f, { cwd: subdir, sessionId: "sub-own" });
  assert.deepEqual(sub.context.scopes, { global: true, project: false, session: true });
  assert.equal((await invoke("PATCH", { ...change(sub, "package", "session", "enabled"), scope: "project" })).status, 400);
});

test("ungranted Project leaves absent native trust absent; staged trust revocation prevents first import receipt", async t => {
  const f = fixture(t, { project: true }), trustPath = join(f.agentDir, "trust.json");
  f.write(join(f.cwd, ".pi/extensions/local.js"), 'throw new Error("must remain inert"); export default () => {};\n');
  const before = f.snapshot(), denied = await invoke("GET", undefined, new URLSearchParams({ cwd: f.cwd }));
  assert.equal(denied.status, 403, JSON.stringify(denied.value));
  assert.equal(fs.existsSync(trustPath), false, "canonical read never creates absent trust data");
  assert.equal(fs.existsSync(f.preferences), false); assert.deepEqual(f.snapshot(), before);
  f.write(trustPath, JSON.stringify({ [f.cwd]: true })); let revoked = false, afterRevocation;
  onStage = () => { onStage = undefined; observing = false; try {
    f.write(trustPath, JSON.stringify({ [f.cwd]: false })); revoked = true; afterRevocation = f.snapshot();
  } finally { observing = true; } };
  const failed = await invoke("GET", undefined, new URLSearchParams({ cwd: f.cwd }));
  assert.equal(revoked, true); assert.equal(failed.status, 409, JSON.stringify(failed.value));
  assert.equal(fs.existsSync(f.preferences), false, "no choices or receipt committed after revocation during import");
  assert.deepEqual(f.snapshot(), afterRevocation);
});

test("context/catalog generation and final staged publication guard refuse stale choices without native or desired publication", async t => {
  const f = fixture(t), initial = await inventory(f), baseline = fs.readFileSync(f.preferences);
  f.write(f.ext, 'throw new Error("new inert generation"); export default () => {};\n');
  assert.equal((await invoke("PATCH", change(initial, "package", "global", "enabled"))).status, 409);
  assert.deepEqual(fs.readFileSync(f.preferences), baseline);
  const current = await inventory(f);
  onStage = () => { onStage = undefined; observing = false; try { f.write(f.ext, 'throw new Error("changed after staging"); export default () => {};\n'); } finally { observing = true; } };
  const failed = await invoke("PATCH", change(current, "package", "global", "enabled"));
  assert.equal(failed.status, 409, JSON.stringify(failed.value)); assert.deepEqual(fs.readFileSync(f.preferences), baseline);
});

test("unsupported alias and remote source refuse before receipt; unadmitted physical targets cannot gain authority from metadata", async t => {
  const f = fixture(t), alias = join(f.agentDir, "extensions/alias.js"); fs.mkdirSync(dirname(alias)); fs.symlinkSync(f.ext, alias);
  const denied = await invoke("GET"); assert.equal(denied.status, 422, JSON.stringify(denied.value)); assert.match(denied.value.error, /whole-package Off.*enabled native winner/);
  assert.equal(fs.existsSync(f.preferences), false);
  fs.unlinkSync(alias);
  f.write(join(f.agentDir, "settings.json"), JSON.stringify({ packages: ["npm:not-supported"] }));
  const count = nativeResolves, remote = await invoke("GET"); assert.equal(remote.status, 422); assert.equal(nativeResolves, count, "no npm location/resolve before source refusal");
  assert.equal(fs.existsSync(f.preferences), false);
  const outside = join(f.base, "outside.js"); f.write(outside, 'throw new Error("not admitted");'); fs.symlinkSync(outside, alias);
  f.write(join(f.agentDir, "settings.json"), JSON.stringify({ packages: [off(f.pkg)] }));
  const escaped = await invoke("GET"); assert.equal(escaped.status, 403); assert.match(escaped.value.error, /physical installed location/); assert.equal(fs.existsSync(f.preferences), false);
});

test("request origin, type, closed fields, duplicate queries and actual streamed byte bound refuse before discovery", async t => {
  const f = fixture(t, { empty: true }), start = nativeResolves;
  assert.equal((await invoke("GET", undefined, "", { origin: "https://foreign.invalid" })).status, 403);
  assert.equal((await invoke("PATCH", "{}", "", { "content-type": "text/plain" })).status, 415);
  assert.equal((await invoke("PATCH", { agentDir: f.agentDir, binding: "forged" })).status, 400);
  assert.equal((await invoke("GET", undefined, "cwd=a&cwd=b")).status, 400);
  assert.equal((await invoke("GET", undefined, "agentDir=forged")).status, 400);
  let cancelled = false;
  const req = new Request("http://localhost/api/agent-resources", { method: "PATCH", duplex: "half", headers: { host: "localhost", "content-type": "application/json", "content-length": "2" },
    body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(40_000)); }, cancel() { cancelled = true; } }) });
  const response = await route.PATCH(req), body = await response.json();
  assert.equal(response.status, 413, JSON.stringify(body)); assert.equal(cancelled, true);
  assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(nativeResolves, start); assert.equal(fs.existsSync(f.preferences), false);
});
