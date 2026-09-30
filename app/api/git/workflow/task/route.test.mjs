import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import nodeTest, { after, beforeEach } from "node:test";
const test = (name, run) => nodeTest(name, { skip: process.platform !== "linux" && "Fixture uses Linux source capture" }, run);
import { createJiti } from "jiti";
import fs from "node:fs";
import { bindingTestModule } from "../../../../../lib/git-workflow-binding-test-loader.mjs";
const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await realpath(await mkdtemp(join(tmpdir(), "pi-task-route-agent-")));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET, POST } = await jiti.import("./route.ts");
const settingsRoute = await jiti.import("../settings/route.ts");
const legacyRoute = await jiti.import("../route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../../lib/session-reader.ts");
const { appendManagedSessionGitWorkflow } = await jiti.import("../../../../../lib/git-workflow-session.ts");
const { inheritSessionGitWorkflow } = await jiti.import("../../../../../lib/git-workflow-policy.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("../../../../../lib/git-workflow-settings.ts");
const { gitWorkflowSettingsPath, withGitWorkflowSettingsLock, readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("../../../../../lib/git-workflow-settings-store.ts");
const { readGitTaskBinding } = await jiti.import("../../../../../lib/git-workflow-binding-store.ts");
const { gitTaskBindingRuntime } = await jiti.import("../../../../../lib/git-workflow-binding-runtime.ts");
const { acquireGitCheckoutGate } = await jiti.import("../../../../../lib/git-checkout-gate.ts");
const { moveSessionFamily } = await jiti.import("../../../../../lib/session-move.ts");
const exec = promisify(execFile);
const endpoint = "http://localhost/api/git/workflow/task";
const req = (body) => new Request(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function json(response, status = 200) { assert.equal(response.status, status, await response.clone().text()); return response.json(); }
const status = (sessionId) => GET(new Request(`${endpoint}?${new URLSearchParams({ sessionId })}`)).then(json);
const post = (body, code = 200) => POST(req(body)).then((response) => json(response, code));
const settings = (sessionId) => settingsRoute.GET(new Request(`http://localhost/api/git/workflow/settings?${new URLSearchParams({ sessionId })}`)).then(json);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(agentDir, "no-git-config") } })).stdout.trim();
beforeEach(async () => { await rm(gitWorkflowSettingsPath(), { force: true }); gitTaskBindingRuntime().previews.clear(); });
after(async () => { if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = priorAgentDir; await rm(agentDir, { recursive: true, force: true }); });
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "pi-task-route-repo-"))), cwd = join(dir, "repo");
  await git(dir, "init", "-qb", "feature", cwd);
  await git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(dir, "no-hooks")}`, "commit", "--allow-empty", "-qm", "initial");
  await writeFile(join(cwd, "AGENTS.md"), "Always retain human review.\n");
  await writeFile(join(cwd, "rules.md"), "Referenced task rules.\n");
  allowFileRoot(cwd);
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "Implement a bounded fixture feature", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "Fixture ready" }], timestamp: Date.now() });
  appendManagedSessionGitWorkflow(sm, {}, { kind: "managed", settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS } });
  const id = sm.getSessionId(), file = sm.getSessionFile(), entry = sm.getBranch().find((entry) => entry.type === "message" && entry.message.role === "user");
  cacheSessionPath(id, file);
  t.after(async () => { invalidateSessionPathCache(id); invalidateSessionListCache(); await rm(dir, { recursive: true, force: true }); });
  return { dir, cwd, sm, id, file, requestEntryId: entry.id };
}
async function input(f, overrides = {}) { return { operation: "preview", sessionId: f.id, revision: (await status(f.id)).status.revision,
  settingsRevision: (await settings(f.id)).revision, workspaceBranch: "feature", requestEntryId: f.requestEntryId,
  goal: "Implement the fixture feature", dependencies: ["rules.md"], targets: [], ...overrides }; }
const preview = async (f, overrides = {}) => post(await input(f, overrides));
const adopt = (f, candidate) => post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId });
async function save(f, scope, fields = {}) {
  return json(await settingsRoute.PUT(new Request("http://localhost/api/git/workflow/settings", { method: "PUT", body: JSON.stringify({ scope, sessionId: f.id, revision: (await settings(f.id)).revision, ...fields }) })));
}

test("GET and preview never create task authority, wrappers, transcript entries, or Git mutations; exact adoption stays outside SDK context", async (t) => {
  const f = await fixture(t), transcript = await readFile(f.file, "utf8"), beforeContext = f.sm.buildSessionContext(), registry = new Map(globalThis.__piSessions ?? []);
  const head = await git(f.cwd, "rev-parse", "HEAD"), changed = await git(f.cwd, "status", "--porcelain");
  assert.equal((await status(f.id)).status.status, "none");
  assert.deepEqual(readGitTaskBinding(f.id), { revision: "none", record: null });
  const candidate = await preview(f);
  assert.equal(candidate.snapshot.workspace.branch, "feature");
  assert.equal(candidate.snapshot.sources.sources.length, 2);
  assert.equal(readGitTaskBinding(f.id).record, null);
  assert.equal(await readFile(f.file, "utf8"), transcript);
  assert.deepEqual(new Map(globalThis.__piSessions ?? []), registry);
  const result = await adopt(f, candidate);
  assert.equal(result.status.status, "current"); assert.equal(result.status.binding.generation, 1);
  assert.match(result.status.reason, /not execution permission/);
  assert.equal(result.status.binding.sources.length, 2);
  assert.equal(JSON.stringify(result).includes("Referenced task rules"), false, "Status must not return captured source text");
  assert.equal(await readFile(f.file, "utf8"), transcript);
  assert.deepEqual(SessionManager.open(f.file).buildSessionContext(), beforeContext);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), head);
  assert.equal(await git(f.cwd, "status", "--porcelain"), changed);
  await post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId }, 409);
  assert.equal((await settings(f.id)).task.settings.commits, "ask");
});
test("exact server preview cannot be forged, used by another session, or silently refreshed after source changes", async (t) => {
  const f = await fixture(t), other = await fixture(t), candidate = await preview(f);
  await post({ operation: "adopt", sessionId: other.id, previewId: candidate.previewId }, 409);
  await post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId, reviewed: true }, 400);
  await writeFile(join(f.cwd, "rules.md"), "changed after review");
  const stale = await post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId }, 409);
  assert.match(stale.error, /stale|changed/);
  assert.equal(readGitTaskBinding(f.id).record, null);
  const fresh = await preview(f); await adopt(f, fresh);
  await writeFile(join(f.cwd, "AGENTS.override.md"), "new higher-priority policy");
  assert.equal((await status(f.id)).status.status, "stale");
});
test("source symlinks disclose targets first, require exact read selection, and fail closed after retargeting", async (t) => {
  const f = await fixture(t), real = join(f.dir, "installed.md"), source = join(f.cwd, "AGENTS.md");
  await writeFile(real, "private fixture instruction source"); await rm(source); await symlink(real, source);
  const request = await input(f), blocked = await post(request, 409);
  assert.deepEqual(blocked.sourceTargets, [{ path: source, realPath: real }]);
  assert.equal(JSON.stringify(blocked).includes("private fixture instruction source"), false);
  const candidate = await post({ ...request, targets: blocked.sourceTargets });
  assert.equal(candidate.snapshot.sources.sources[0].content, "private fixture instruction source");
  const replacement = join(f.dir, "replacement.md"); await writeFile(replacement, "private fixture instruction source");
  await rm(source); await symlink(replacement, source);
  await post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId }, 409);
  assert.equal(readGitTaskBinding(f.id).record, null);
});
test("defaults do not retarget binding; new task capture and Pause round trips fence metadata previews", async (t) => {
  const f = await fixture(t), candidate = await preview(f);
  const current = await adopt(f, candidate);
  await save(f, "global", { overrides: { commits: "manual" } });
  assert.equal((await status(f.id)).status.status, "current");
  const waiting = await preview(f);
  await save(f, "pause", { paused: true }); await save(f, "pause", { paused: false });
  await post({ operation: "adopt", sessionId: f.id, previewId: waiting.previewId }, 409);
  const recaptured = await save(f, "task"); assert.equal(recaptured.task.settings.commits, "manual");
  const stale = await status(f.id);
  assert.equal(stale.status.status, "stale"); assert.equal(stale.status.binding.generation, current.status.binding.generation + 1);
  await save(f, "global", { overrides: { commits: "ask" } }); await save(f, "task");
  assert.equal((await status(f.id)).status.status, "stale", "Returning equal settings must not revive the old binding");
});
test("settings round trips in another process cannot revive this process's pending review", async (t) => {
  const f = await fixture(t), candidate = await preview(f);
  const script = `import {createJiti} from 'jiti';
    const jiti=createJiti(process.cwd()+'/package.json',{alias:{'@':process.cwd()}});
    const {GET,PUT}=await jiti.import('./app/api/git/workflow/settings/route.ts');
    for (const paused of [true,false]) {
      const before=await (await GET(new Request('http://localhost/api/git/workflow/settings'))).json();
      const saved=await PUT(new Request('http://localhost/api/git/workflow/settings',{method:'PUT',body:JSON.stringify({scope:'pause',revision:before.revision,paused})}));
      if(saved.status!==200) throw new Error(await saved.text());
    } console.log('done');`;
  await exec(process.execPath, ["--input-type=module", "-e", script], { timeout: 30_000, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir } });
  assert.ok(gitTaskBindingRuntime().previews.has(candidate.previewId), "The other process cannot clear this map");
  const result = await post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId }, 409);
  assert.match(result.error, /stale/); assert.equal(readGitTaskBinding(f.id).record, null);
});
test("compatibility project-setting round trips share the durable preview fence", async (t) => {
  const f = await fixture(t), candidate = await preview(f), initial = await settings(f.id);
  for (const policy of [{ mode: "current", onCreate: "stay", commits: "manual" }, null]) {
    await json(await legacyRoute.PUT(new Request("http://localhost/api/git/workflow", { method: "PUT", body: JSON.stringify({ scope: "project", cwd: f.cwd, policy }) })));
  }
  const current = await settings(f.id);
  assert.deepEqual(current.resolved, initial.resolved); assert.notEqual(current.revision, initial.revision);
  assert.ok(gitTaskBindingRuntime().previews.has(candidate.previewId));
  const result = await post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId }, 409);
  assert.match(result.error, /stale/); assert.equal(readGitTaskBinding(f.id).record, null);
});
test("a consumed confirm waiting for the write lock still checks the durable write epoch", async (t) => {
  const f = await fixture(t), candidate = await preview(f);
  let ready, release;
  const entered = new Promise((resolve) => { ready = resolve; }), held = new Promise((resolve) => { release = resolve; });
  const writer = withGitWorkflowSettingsLock(agentDir, async () => {
    ready(); await held;
    const document = readGitWorkflowSettingsDocument();
    writeGitWorkflowSettingsDocument({ ...document, paused: true });
    writeGitWorkflowSettingsDocument(document);
    gitTaskBindingRuntime().previews.clear();
  });
  await entered;
  const confirming = POST(req({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId }));
  for (let i = 0; i < 100 && gitTaskBindingRuntime().previews.has(candidate.previewId); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(gitTaskBindingRuntime().previews.has(candidate.previewId), false);
  release(); await writer;
  const response = await json(await confirming, 409);
  assert.match(response.error, /stale/); assert.equal(readGitTaskBinding(f.id).record, null);
});
test("a failed session move keeps source bytes but never restores its invalidated binding", async (t) => {
  const f = await fixture(t); await adopt(f, await preview(f));
  const transcript = await readFile(f.file, "utf8"), destination = join(f.dir, "destination"); await mkdir(destination);
  const imports = { "node:fs": { ...fs, renameSync(from, to) {
    if (from === f.file) throw new Error("injected move publication failure");
    return fs.renameSync(from, to);
  } }, "@earendil-works/pi-coding-agent": await jiti.import("@earendil-works/pi-coding-agent") };
  for (const name of ["rpc-manager", "session-reader", "session-path", "subagents", "subagent-runtime", "git-workflow-settings-store", "git-workflow-binding-store", "git-workflow-write-epoch"]) {
    imports[`./${name}`] = await jiti.import(`../../../../../lib/${name}.ts`);
  }
  const injectedMove = bindingTestModule("./session-move.ts", imports);
  await assert.rejects(injectedMove.moveSessionFamily(f.id, destination), /injected move publication failure/);
  assert.equal(await readFile(f.file, "utf8"), transcript);
  const stored = readGitTaskBinding(f.id);
  assert.equal(stored.record.state, "invalidated"); assert.equal(stored.record.generation, 2);
  assert.equal((await status(f.id)).status.status, "stale");
});
test("concurrent confirms have one winner; replacing/cancelling/releasing a review cannot recreate authority", async (t) => {
  const f = await fixture(t), first = await preview(f), second = await preview(f);
  await post({ operation: "adopt", sessionId: f.id, previewId: first.previewId }, 409);
  const body = { operation: "adopt", sessionId: f.id, previewId: second.previewId };
  const results = await Promise.all([POST(req(body)), POST(req(body))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const state = await status(f.id);
  await post({ operation: "release", sessionId: f.id, revision: state.status.revision });
  assert.equal((await status(f.id)).status.status, "released");
  const cancelled = await preview(f);
  await post({ operation: "cancel", sessionId: f.id, previewId: cancelled.previewId });
  await post({ operation: "adopt", sessionId: f.id, previewId: cancelled.previewId }, 409);
  assert.equal((await status(f.id)).status.binding.generation, 2);
});
test("running sessions and checkout reservations block adoption; reservations never span the human review", async (t) => {
  const f = await fixture(t), candidate = await preview(f), prior = globalThis.__piSessions;
  const release = acquireGitCheckoutGate([f.cwd]);
  try { await post({ operation: "adopt", sessionId: f.id, previewId: candidate.previewId }, 409); }
  finally { release(); }
  const next = await preview(f);
  globalThis.__piSessions = new Map([[f.id, { sessionFile: f.file, cwd: f.cwd, isAlive: () => true, isRunning: () => true, inner: { sessionManager: f.sm } }]]);
  try { await post({ operation: "adopt", sessionId: f.id, previewId: next.previewId }, 409); }
  finally { globalThis.__piSessions = prior; }
  assert.equal(readGitTaskBinding(f.id).record, null);
  const fresh = await preview(f); const available = acquireGitCheckoutGate([f.cwd]); available();
  await adopt(f, fresh);
});
test("forks/copies and file replacement cannot inherit a private binding; restart preserves evidence but not previews", async (t) => {
  const f = await fixture(t); await adopt(f, await preview(f));
  const child = SessionManager.create(f.cwd);
  child.appendMessage({ role: "user", content: "copied context", timestamp: Date.now() });
  child.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  inheritSessionGitWorkflow(f.sm.getEntries(), child);
  cacheSessionPath(child.getSessionId(), child.getSessionFile());
  assert.equal((await status(child.getSessionId())).status.status, "none");
  const copied = join(f.dir, "copy.jsonl"); await copyFile(f.file, copied); cacheSessionPath(f.id, copied);
  assert.equal((await status(f.id)).status.status, "stale");
  cacheSessionPath(f.id, f.file);
  const replacement = `${f.file}.replacement`; await copyFile(f.file, replacement); await rename(replacement, f.file);
  assert.equal((await status(f.id)).status.status, "stale");
  await adopt(f, await preview(f));
  const pending = await preview(f), runtime = gitTaskBindingRuntime(), epoch = runtime.epoch;
  runtime.previews.clear(); runtime.epoch = "00000000-0000-4000-8000-000000000000";
  try {
    assert.equal((await status(f.id)).status.status, "reconciliation-required");
    await post({ operation: "adopt", sessionId: f.id, previewId: pending.previewId }, 409);
  } finally { runtime.epoch = epoch; }
});
test("move-and-back invalidates before file replacement and never revives the old generation", async (t) => {
  const f = await fixture(t), candidate = await preview(f); await adopt(f, candidate);
  const destination = join(f.dir, "destination"); await mkdir(destination); allowFileRoot(destination);
  const before = readGitTaskBinding(f.id);
  await moveSessionFamily(f.id, destination);
  assert.equal(readGitTaskBinding(f.id).record.state, "invalidated");
  assert.equal(readGitTaskBinding(f.id).record.generation, before.record.generation + 1);
  await moveSessionFamily(f.id, f.cwd);
  assert.equal((await status(f.id)).status.status, "stale");
});
test("selected physical sibling workspace is bound, but branch changes and recaptured restrictions require new review", async (t) => {
  const f = await fixture(t), sibling = join(f.dir, "sibling");
  await git(f.cwd, "worktree", "add", "-qb", "chosen", sibling); allowFileRoot(sibling);
  await writeFile(join(sibling, "AGENTS.md"), "sibling instruction source");
  const candidate = await preview(f, { workspaceBranch: "chosen", dependencies: [] });
  assert.equal(candidate.snapshot.owner.cwd, f.cwd);
  assert.equal(candidate.snapshot.workspace.root, sibling);
  assert.equal(candidate.snapshot.sources.sources.at(-1).content, "sibling instruction source");
  await adopt(f, candidate);
  await git(sibling, "checkout", "-qb", "changed");
  assert.equal((await status(f.id)).status.status, "stale");
  const alias = join(f.dir, "alias"); await symlink(f.cwd, alias);
  const transcript = await readFile(f.file, "utf8"); const lines = transcript.split("\n"); const header = JSON.parse(lines[0]); header.cwd = alias; lines[0] = JSON.stringify(header);
  await writeFile(f.file, lines.join("\n"));
  await json(await GET(new Request(`${endpoint}?sessionId=${f.id}`)), 409);
});
test("malformed payloads, subagents, non-user origins and unsupported modes never create a binding", async (t) => {
  const f = await fixture(t), body = await input(f);
  for (const bad of [{ ...body, grants: ["commit"] }, { ...body, snapshot: {} }, { ...body, operation: "automatic" }, { ...body, dependencies: "rules.md" }]) await post(bad, 400);
  await post({ ...body, requestEntryId: f.sm.getEntries().find((entry) => entry.type === "message" && entry.message.role === "assistant").id }, 409);
  f.sm.appendCustomEntry("pi-web:subagent", { parentSessionId: "parent" });
  await post(body, 409);
  assert.equal(readGitTaskBinding(f.id).record, null);
  await json(await GET(new Request(`${endpoint}?sessionId=${f.id}&cwd=/other`)), 400);
});
