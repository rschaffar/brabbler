import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { randomUUID } from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

// Disposable saved sessions only: no Git repository, check execution or live history.
const home = await mkdtemp(join(tmpdir(), "pi-web-retired-check-recovery-"));
const agentDir = join(home, "agent");
await mkdir(agentDir, { mode: 0o700 });
const keys = ["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR", "PI_WEB_PASSWORD"];
const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
const processCalls = [];
const originalProcessMethods = new Map();
for (const name of ["exec", "execFile", "execSync", "execFileSync", "spawn", "spawnSync", "fork"]) {
  originalProcessMethods.set(name, childProcess[name]);
  childProcess[name] = (...args) => { processCalls.push([name, ...args]); throw new Error("Compatibility route must not execute processes"); };
}
syncBuiltinESMExports();
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { proxy } = await jiti.import("../../../../proxy.ts");
const { NextRequest } = await jiti.import("next/server");
const { createWebSessionToken } = await jiti.import("../../../../lib/web-auth.ts");
const endpoint = "http://localhost/api/git/check-recovery";
const get = (id) => GET(new Request(`${endpoint}?sessionId=${encodeURIComponent(id)}`));
const post = (body) => POST(new Request(endpoint, { method: "POST", body: JSON.stringify(body) }));
const approval = (sessionId) => ({ sessionId, actionId: randomUUID(), revision: randomUUID(), acknowledged: true });
after(async () => {
  for (const [name, original] of originalProcessMethods) childProcess[name] = original;
  syncBuiltinESMExports();
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
});
async function fixture(t) {
  const cwd = await mkdtemp(join(home, "checkout-"));
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "development fixture", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "saved" }], timestamp: Date.now() });
  allowFileRoot(cwd);
  t.after(async () => { await rm(sm.getSessionFile(), { force: true }); });
  return { cwd, sm, id: sm.getSessionId(), file: sm.getSessionFile() };
}
function information(body) {
  assert.deepEqual(Object.keys(body).sort(), ["diagnosticOnly", "reason", "retired"]);
  assert.equal(body.diagnosticOnly, true);
  assert.equal(body.retired, true);
  assert.match(body.reason, /no passing receipt/);
  assert.match(body.reason, /History does not admit or block other Git invocations/);
  assert.match(body.reason, /no recovery action is required/);
  assert.match(body.reason, /current checkout files and processes/);
  assert.match(body.reason, /not a native preflight or evidence that processes stopped/);
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE|eligible|admitted|nativeHealthy|processStopped|revision|actionId|expiresAt/);
}
async function snapshot(folder) {
  const result = {};
  for (const file of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (file.isFile()) result[join(file.parentPath, file.name)] = (await readFile(join(file.parentPath, file.name))).toString("base64");
  }
  return result;
}

test("GET validates a persisted ordinary context and returns fixed non-authoritative information", async (t) => {
  const f = await fixture(t);
  const before = await snapshot(home);
  const response = await get(f.id);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  information(await response.json());
  assert.deepEqual(await snapshot(home), before);
  for (const query of ["", "sessionId=../bad", `sessionId=${f.id}&sessionId=${f.id}`, `sessionId=${"a".repeat(129)}`,
    ...["cwd", "agentDir", "commands", "owner", "proofs", "skip"].map((key) => `sessionId=${f.id}&${key}=PRIVATE`)]) {
    assert.equal((await GET(new Request(`${endpoint}?${query}`))).status, 400, query);
  }
  assert.equal((await get("absent")).status, 404);
  await rm(f.file);
  assert.equal((await get(f.id)).status, 404, "removed sessions must not be recreated");
});

test("missing, changed, subagent and disallowed/symlink session contexts disclose no private metadata", async (t) => {
  const f = await fixture(t);
  const original = await readFile(f.file, "utf8");
  f.sm.appendCustomEntry("pi-web:subagent", { PRIVATE: true });
  assert.equal((await get(f.id)).status, 404);
  await writeFile(f.file, original.replace(f.id, randomUUID()));
  assert.equal((await get(f.id)).status, 404);
  await writeFile(f.file, "malformed PRIVATE session");
  assert.equal((await get(f.id)).status, 404);
  await writeFile(f.file, original);
  const roots = globalThis.__piAdditionalAllowedRoots, cached = globalThis.__piAllowedRootsCache;
  try {
    globalThis.__piAdditionalAllowedRoots = new Set();
    globalThis.__piAllowedRootsCache = undefined;
    const response = await get(f.id);
    assert.equal(response.status, 404, "no root discovery or permission from the supplied session header");
    assert.doesNotMatch(await response.text(), /PRIVATE|checkout-|agent\//);
  } finally { globalThis.__piAdditionalAllowedRoots = roots; globalThis.__piAllowedRootsCache = cached; }
  const other = join(home, "PRIVATE-session.jsonl");
  await writeFile(other, original);
  await rm(f.file);
  await symlink(other, f.file);
  assert.equal((await get(f.id)).status, 404);
});

test("saved-session lookup bounds and ambiguous identities fail closed without a catalogue fallback", async (t) => {
  const f = await fixture(t);
  const original = await readFile(f.file);
  await truncate(f.file, 16 * 1024 * 1024 + 1);
  assert.equal((await get(f.id)).status, 404);
  await writeFile(f.file, original);
  const duplicateFolder = join(agentDir, "sessions", "duplicate-fixture");
  await mkdir(duplicateFolder);
  const duplicate = join(duplicateFolder, `duplicate_${f.id}.jsonl`);
  await writeFile(duplicate, original);
  assert.equal((await get(f.id)).status, 404);
  await rm(duplicateFolder, { recursive: true });
  const directories = Array.from({ length: 257 }, (_, index) => join(agentDir, "sessions", `budget-fixture-${index}`));
  try {
    await Promise.all(directories.map((directory) => mkdir(directory)));
    assert.equal((await get(f.id)).status, 404);
  } finally { await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true }))); }
  assert.equal((await get(f.id)).status, 200);
});

test("old approvals return 410 repeatedly with no effects, including malformed legacy evidence and active other checks", async (t) => {
  const f = await fixture(t);
  const request = approval(f.id);
  const legacy = join(agentDir, "pi-web", "git-operation-admission", "v1", "fixture-resource");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "PRIVATE.post"), "malformed historical proof");
  await writeFile(join(legacy, "PRIVATE.intent"), JSON.stringify({ unresolved: true, owner: "other-session", processStopped: false }));
  // Even forged hot-reload leftovers remain inert, not consumed or resolved.
  const key = Symbol.for("pi-web:git-check-recovery:reviews"), oldTickets = globalThis[key];
  const tickets = new Map([[request.revision, { ...request, expiresAt: Date.now() + 60000 }]]);
  globalThis[key] = tickets;
  const oldSessions = globalThis.__piSessions;
  globalThis.__piSessions = new Map([["another-active-check", {
    cwd: f.cwd, isAlive: () => true, isRunning: () => true,
  }]]);
  t.after(() => { globalThis[key] = oldTickets; globalThis.__piSessions = oldSessions; });
  const before = await snapshot(home);
  information(await (await get(f.id)).json());
  for (const input of [request, request, { ...request, reviewedMovement: true }]) {
    const response = await post(input);
    assert.equal(response.status, 410);
    information(await response.json());
  }
  assert.equal(tickets.size, 1, "do not manipulate legacy process-local tickets either");
  assert.deepEqual(await snapshot(home), before, "no record cleanup, receipt, spool, Git, session or metadata writes");
});

test("POST has strict bounded input and no caller-controlled paths, commands, proofs or bypass flags", async (t) => {
  const f = await fixture(t), request = approval(f.id);
  const before = await snapshot(home);
  for (const input of [null, [], {}, { ...request, acknowledged: false }, { ...request, reviewedMovement: false },
    { ...request, revision: 1 }, { ...request, actionId: "invalid" },
    ...["cwd", "agentDir", "commands", "owner", "proofs", "skip", "admitted"].map((key) => ({ ...request, [key]: "PRIVATE" }))]) {
    assert.equal((await post(input)).status, 400);
  }
  for (const body of ["{", "x".repeat(4097)]) assert.equal((await POST(new Request(endpoint, { method: "POST", body }))).status, 400);
  const streamed = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); controller.close(); } });
  assert.equal((await POST(new Request(endpoint, { method: "POST", body: streamed, duplex: "half" }))).status, 400);
  assert.equal((await POST(new Request(endpoint, { method: "POST", headers: { "Content-Length": "4097" }, body: "{}" }))).status, 400);
  assert.equal((await POST(new Request(`${endpoint}?cwd=PRIVATE`, { method: "POST", body: JSON.stringify(request) }))).status, 400);
  assert.equal((await post(approval("absent"))).status, 404);
  assert.deepEqual(await snapshot(home), before);
});

test("the standard API proxy still requires authenticated, same-origin context for GET and retired POST", () => {
  process.env.PI_WEB_PASSWORD = "fixture-password";
  try {
    for (const method of ["GET", "POST"]) {
      assert.equal(proxy(new NextRequest(endpoint, { method, headers: { host: "localhost" } })).status, 401);
      assert.equal(proxy(new NextRequest(endpoint, { method, headers: { host: "localhost", origin: "https://foreign.invalid" } })).status, 403);
      const token = createWebSessionToken(process.env.PI_WEB_PASSWORD);
      assert.equal(proxy(new NextRequest(endpoint, { method, headers: { host: "localhost", cookie: `pi_web_session=${token}` } })).status, 200);
    }
  } finally { delete process.env.PI_WEB_PASSWORD; }
});

test("compatibility route has no history/admission/check/process/receipt or gate call sites", async () => {
  const source = await readFile(new URL("./route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from ["'][^"']*(?:git-operation-admission|git-checkout-gate|git-verification|git-integration|git-action-journal|child_process|git-review|git-project-resources)["']/);
  assert.doesNotMatch(source, /acquireGit|invalidateGit|resolveHumanReviewed|isGitVerificationRunning|systemctl|execFile|globalThis|Symbol\.for|writeFile|unlink|\.delete\(/);
  assert.doesNotMatch(source, /await resolveSessionPath|await getAllowedFileRoots/);
  assert.deepEqual(processCalls, [], "including transitive helpers: no Git/systemctl/check/process execution");
});
