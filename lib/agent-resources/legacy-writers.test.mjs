import assert from "node:assert/strict";
import test, { after } from "node:test";
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Actual route handlers and public SDK graph. Fence environment/capabilities
// BEFORE importing either; native sentinels are never under the source cwd.
const root = fs.mkdtempSync(join(tmpdir(), "legacy-writers-"));
const agentDir = join(root, "agent"), cwd = join(root, "project");
const keys = ["HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "PI_CODING_AGENT_DIR", "PI_OFFLINE", "BRABBLER_HOSTNAME", "BRABBLER_ALLOWED_HOSTS"];
const env = keys.map(key => [key, process.env[key]]);
const globals = ["__piAllowedRootsCache", "__piAdditionalAllowedRoots"];
const savedGlobals = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
const restores = [], effects = [], writes = [];
let observing = false, restored = false;
function replace(object, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  restores.push(() => Object.defineProperty(object, key, descriptor));
  Object.defineProperty(object, key, { ...descriptor, value });
}
function deny(object, key) {
  assert.equal(typeof object[key], "function", `real capability ${key}`);
  replace(object, key, () => { effects.push(key); throw new Error(`Unadmitted legacy writer capability: ${key}`); });
}
function restore() {
  if (restored) return;
  restored = true;
  for (const undo of restores.reverse()) undo();
  syncBuiltinESMExports();
  for (const [key, value] of env) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
}
after(() => { try { assert.deepEqual(effects, [], "no swallowed unsupported effects"); } finally { restore(); } });
let plugins, skills, access;
const retiredDistribution = new Map();
try {
  process.env.HOME = join(root, "home");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  process.env.XDG_CACHE_HOME = join(root, "cache");
  process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1";
  delete process.env.BRABBLER_HOSTNAME; delete process.env.BRABBLER_ALLOWED_HOSTS;
  for (const key of globals) globalThis[key] = undefined;
  for (const dir of [process.env.HOME, agentDir, join(cwd, ".pi")]) fs.mkdirSync(dir, { recursive: true });
  // No cleanup is needed to prove refusal; private roots remain for sandbox disposal.
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) deny(cp, key);
  deny(globalThis, "fetch");
  const write = fs.writeFileSync;
  replace(fs, "writeFileSync", (...args) => {
    if (observing) {
      const path = String(args[0]);
      assert.ok(path.startsWith(root + "/"), "native write must stay in private fixture");
      writes.push(path);
    }
    return write(...args);
  });
  syncBuiltinESMExports();
  const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const jiti = createJiti(import.meta.url, { fsCache: false, alias: { "@": sourceRoot }, nativeModules: ["@earendil-works/pi-coding-agent"] });
  const sdk = await jiti.import("@earendil-works/pi-coding-agent");
  deny(sdk.SettingsManager, "create");
  for (const key of ["setPackages", "setProjectPackages", "flush"]) deny(sdk.SettingsManager.prototype, key);
  for (const key of ["install", "installAndPersist", "remove", "removeAndPersist", "update", "resolve"]) deny(sdk.DefaultPackageManager.prototype, key);
  for (const key of ["create", "open", "inMemory", "listAll"]) deny(sdk.SessionManager, key);
  deny(sdk.DefaultResourceLoader.prototype, "reload");
  access = await jiti.import("../file-access.ts");
  plugins = await jiti.import("../../app/api/plugins/route.ts");
  skills = await jiti.import("../../app/api/skills/route.ts");
  for (const endpoint of ["skills/install", "skills/update", "skills/search", "skills/check", "plugins/check"]) {
    retiredDistribution.set(endpoint, await jiti.import(`../../app/api/${endpoint}/route.ts`));
  }
  access.allowFileRoot(cwd);
} catch (error) { restore(); throw error; }

const files = new Map();
function sentinel(path, text) {
  fs.mkdirSync(dirname(path), { recursive: true });
  const bytes = Buffer.from(text); fs.writeFileSync(path, bytes); files.set(path, bytes); return path;
}
const source = join(root, "package");
sentinel(join(source, "package.json"), '{"name":"synthetic-legacy","pi":{"extensions":["extension.js"]}}\n');
sentinel(join(source, "extension.js"), 'throw new Error("legacy route must never import/factory this extension");\nexport default () => {};\n');
for (const base of [agentDir, join(cwd, ".pi")]) {
  sentinel(join(base, "settings.json"), JSON.stringify({ packages: [{ source, skills: ["skills/guide"], extensions: [], prompts: ["keep.md"], themes: [] }], unrelated: "sentinel" }, null, 2) + "\n");
}
const skillFiles = [join(agentDir, "skills/manual/SKILL.md"), join(cwd, ".agents/skills/manual/SKILL.md")].map(path => sentinel(path,
  "---\nname: manual\ndescription: Synthetic authored manual-only metadata\ndisable-model-invocation: true\ncustom: 'keep formatting'\n---\n\n# Instructions\n"));
const foreignSkill = sentinel(join(root, "foreign/SKILL.md"), "---\nname: foreign\ndescription: Foreign sentinel\n---\nUntouched\n");
function unchanged() {
  for (const [path, bytes] of files) assert.equal(fs.readFileSync(path).equals(bytes), true, `native sentinel bytes unchanged: ${path}`);
  assert.deepEqual(writes, [], "no native availability writes admitted");
  assert.deepEqual(effects, [], "no settings manager, install, loader, session, process or transport effects");
  assert.equal(fs.existsSync(join(agentDir, "brabbler/resource-preferences.json")), false, "refusal precedes first import; no store activation");
}
function request(endpoint, method, body, headers = {}) {
  return new Request(`http://localhost/api/${endpoint}`, { method, headers: { host: "localhost", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
async function refused(handler, req, status = 410, code = "LEGACY_RESOURCE_AVAILABILITY_RETIRED") {
  observing = true;
  let response, value;
  try { response = await handler(req); value = await response.json(); } finally { observing = false; }
  // Byte assertion comes first so an actual old frontmatter write is the defect witness.
  unchanged();
  assert.equal(response.status, status, JSON.stringify(value));
  if (status === 410) {
    assert.match(value.error, /retired/i); assert.equal(value.code, code);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
}

test("native mutation witness is active on private files", () => {
  const path = join(root, "witness.txt");
  observing = true;
  try { fs.writeFileSync(path, "private witness"); } finally { observing = false; }
  assert.deepEqual(writes.splice(0), [path]); assert.equal(fs.readFileSync(path, "utf8"), "private witness");
});

test("retired skill PATCH preserves Global/Project authored manual-only bytes for both toggle values before first import", async () => {
  for (const filePath of skillFiles) for (const disableModelInvocation of [false, true]) {
    await refused(skills.PATCH, request("skills", "PATCH", { filePath, disableModelInvocation }));
  }
});

test("all retired package actions refuse both native scopes before settings/listing writer admission", async () => {
  for (const action of ["install", "remove", "update", "enable", "disable"]) for (const scope of ["global", "project"]) {
    await refused(plugins.POST, request("plugins", "POST", { action, source, scope, cwd }));
  }
});

test("retired package/distribution paths never consume bodies or discover sources, with request security retained", async () => {
  for (const [endpoint, route] of [["plugins", plugins], ...retiredDistribution]) {
    const code = endpoint === "plugins" ? "LEGACY_RESOURCE_AVAILABILITY_RETIRED" : "PACKAGE_MANAGEMENT_RETIRED";
    for (const scope of ["global", "project"]) {
      await refused(route.POST, request(endpoint, "POST", { action: "install", package: "synthetic/skill", source, cwd, scope }), 410, code);
    }
    const unread = request(endpoint, "POST", "{malformed");
    unread.json = unread.text = () => { effects.push("body consumed"); throw new Error("Retired routes must not consume bodies"); };
    await refused(route.POST, unread, 410, code);
    for (const [headers, status] of [[{ origin: "https://foreign.invalid" }, 403], [{ host: "foreign.invalid" }, 403], [{ "content-type": "text/plain" }, 415]]) {
      await refused(route.POST, request(endpoint, "POST", {}, headers), status, code);
    }
  }
});

test("invalid and foreign legacy inputs never gain writer admission", async () => {
  for (const body of [{}, null, [], { filePath: foreignSkill, disableModelInvocation: false }, { filePath: 42 }, { filePath: join(root, "missing/SKILL.md"), disableModelInvocation: "false" }]) {
    await refused(skills.PATCH, request("skills", "PATCH", body));
  }
  const unread = request("skills", "PATCH", "{malformed");
  unread.json = unread.text = () => { effects.push("body consumed"); throw new Error("Retired PATCH must not consume body"); };
  await refused(skills.PATCH, unread);
  for (const action of ["enable", "disable"]) for (const body of [
    { action }, { action, cwd, source: 42, scope: "foreign" },
    { action, cwd: join(root, "foreign"), source, scope: "project", sessionId: "foreign-session" },
  ]) await refused(plugins.POST, request("plugins", "POST", body));
  await refused(plugins.POST, request("plugins", "POST", { action: "disable", cwd, source }, { origin: "https://foreign.invalid" }), 403);
  await refused(plugins.POST, request("plugins", "POST", { action: "enable", cwd, source }, { host: "foreign.invalid" }), 403);
  await refused(plugins.POST, request("plugins", "POST", { action: "disable", cwd, source }, { "content-type": "text/plain" }), 415);
});
