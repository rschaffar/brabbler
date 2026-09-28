import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-web-commit-route-home-"));
const agentDir = join(home, "agent");
await mkdir(agentDir);
const original = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache, invalidateSessionListCache } = await jiti.import("../../../../lib/session-reader.ts");
const { readGitAction, subscribeGitActionUpdates } = await jiti.import("../../../../lib/git-action-journal.ts");
const { beginGitAction, gitActionSink } = await jiti.import("../../../../lib/git-action-controller.ts");
const git = promisify(execFile);
after(async () => {
  const pending = globalThis[Symbol.for("pi-web:git-action-human:v1")]?.pending;
  for (const item of pending?.values() ?? []) { clearTimeout(item.timer); item.handle.release(); }
  pending?.clear();
  for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
});
function post(body, signal) { return POST(new Request("http://localhost/api/git/commit", { method: "POST", body: JSON.stringify(body), signal })); }
const previewRequest = (id, message = "approved", paths = ["a"]) => ({ sessionId: id, operation: "preview", paths, message });
const confirmRequest = (id, candidate, message = "approved") => ({ sessionId: id, operation: "confirm", preview: candidate.preview, actionId: candidate.actionId, message });
const history = (id) => readGitAction(id, { includeArtifact: true });
const entries = (sm) => SessionManager.open(sm.getSessionFile()).getEntries();
const anchors = (sm) => entries(sm).filter((e) => e.type === "custom" && e.customType === "pi-web:git-action");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-commit-route-"));
  const cwd = join(dir, "repo");
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.name", "Route Tester"]);
  await git("git", ["-C", cwd, "config", "user.email", "route@example.invalid"]);
  await writeFile(join(cwd, "a"), "first\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await git("git", ["-C", cwd, "commit", "-qm", "initial"]);
  const sm = SessionManager.create(cwd);
  sm.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const id = sm.getSessionId();
  cacheSessionPath(id, sm.getSessionFile());
  allowFileRoot(cwd);
  t.after(async () => { invalidateSessionPathCache(id); invalidateSessionListCache(); await rm(dir, { recursive: true, force: true }); });
  return { cwd, id, sm };
}
test("missing session, invalid cwd input and unauthorized persisted checkout", async (t) => {
  assert.equal((await post(previewRequest("missing"))).status, 404);
  const { cwd, id } = await fixture(t);
  assert.equal((await post({ ...previewRequest(id), cwd })).status, 400);
  const old = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
  const actions = () => readdir(join(agentDir, "pi-web/git-actions/v1")).catch(() => []);
  const before = await actions();
  try { assert.equal((await post(previewRequest(id))).status, 403); }
  finally { globalThis.__piAllowedRootsCache = old; }
  assert.deepEqual(await actions(), before);
});
test("manual commit without policy, running rejection, checkout mismatch, stale preview and success", async (t) => {
  const { cwd, id } = await fixture(t);
  const previous = globalThis.__piSessions;
  const live = { isAlive: () => false, isRunning: () => true };
  globalThis.__piSessions = new Map([[id, live]]);
  t.after(() => { globalThis.__piSessions = previous; });
  await writeFile(join(cwd, "a"), "second\n");
  assert.equal((await post(previewRequest(id))).status, 409);
  live.isRunning = () => false;
  const denied = await post(previewRequest(id, "approved", ["https://user:secret@example.invalid/repo"]));
  assert.equal(denied.status, 409);
  assert.doesNotMatch(await denied.text(), /secret/);
  const response = await post(previewRequest(id));
  assert.equal(response.status, 200);
  const candidate = await response.json();
  const { preview, actionId, candidateDiff, candidateDiffUnavailable } = candidate;
  assert.equal(candidateDiffUnavailable, undefined);
  assert.equal(candidateDiff.fromTreeOid, (await git("git", ["-C", cwd, "rev-parse", `${preview.head}^{tree}`])).stdout.trim());
  assert.equal(candidateDiff.toTreeOid, preview.tree);
  assert.match(candidateDiff.patch, /\+second/);
  assert.equal(candidateDiff.hasBinaryChanges, false);
  assert.equal((await post({ ...confirmRequest(id, candidate), preview: { ...preview, repositoryRoot: agentDir } })).status, 409);
  await writeFile(join(cwd, "a"), "third\n");
  assert.equal((await post(confirmRequest(id, candidate))).status, 409);
  assert.equal((await history(actionId)).record.state, "blocked");
  assert.match((await history(actionId)).candidate.diff.patch, /\+second/);
  const freshCandidate = await (await post(previewRequest(id))).json();
  const fresh = freshCandidate.preview;
  const committed = await post(confirmRequest(id, freshCandidate));
  assert.equal(committed.status, 200);
  const result = await committed.json();
  assert.equal(result.status, "committed");
  assert.equal(result.authorEmail, "route@example.invalid");
  assert.deepEqual(result.parents, [fresh.head]);
  assert.equal(result.tree, fresh.tree);
  assert.equal((await git("git", ["-C", cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
});

test("candidate patch is from server-derived trees even if caller supplies other OIDs", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "a"), "only approved contents\n");
  const response = await post({ ...previewRequest(id), head: "0".repeat(40), tree: "f".repeat(40) });
  assert.equal(response.status, 200);
  const { preview, candidateDiff } = await response.json();
  assert.notEqual(preview.tree, "f".repeat(40));
  assert.equal(candidateDiff.toTreeOid, preview.tree);
  assert.match(candidateDiff.patch, /\+only approved contents/);
  assert.equal(candidateDiff.fromTreeOid, (await git("git", ["-C", cwd, "rev-parse", `${preview.head}^{tree}`])).stdout.trim());
});

test("binary candidate patch is a summary; oversized patch has explicit unavailability, not partial output", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "binary.bin"), Buffer.from([0, 1, 2, 255]));
  const binary = await post(previewRequest(id, "approved", ["binary.bin"]));
  assert.equal(binary.status, 200);
  const binaryBody = await binary.json();
  assert.equal(binaryBody.candidateDiff.hasBinaryChanges, true);
  assert.match(binaryBody.candidateDiff.patch, /Binary files .* differ/);
  assert.equal(binaryBody.candidateDiffUnavailable, undefined);
  await writeFile(join(cwd, "large.txt"), "x".repeat(1024 * 1024 + 100) + "\n");
  const large = await post(previewRequest(id, "approved", ["large.txt"]));
  assert.equal(large.status, 200);
  const body = await large.json();
  assert.ok(body.preview.reviewToken);
  assert.match(body.candidateDiffUnavailable, /1 MB limit/);
  assert.equal(body.candidateDiff, undefined);
  assert.equal((await history(binaryBody.actionId)).candidate.diff.hasBinaryChanges, true);
  assert.equal((await history(body.actionId)).candidate.diffUnavailable, body.candidateDiffUnavailable);
  assert.equal((await history(body.actionId)).candidate.diff, undefined);
});

test("unexpected tree diff failure fails preview rather than returning a token alone", async (t) => {
  const { cwd, id } = await fixture(t);
  await writeFile(join(cwd, "a"), "updated\n");
  const bin = await mkdtemp(join(tmpdir(), "pi-web-git-fail-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" --no-pager diff --no-color "*) exit 1 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  try {
    const response = await post(previewRequest(id));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).preview, undefined);
  } finally { process.env.PATH = oldPath; }
});

test("durable human candidate uses the shared agent contract, metadata anchors only, and survives checkout removal", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "captured private patch\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  let stored = await history(candidate.actionId);
  assert.equal(stored.record.source, "human");
  assert.equal(stored.record.state, "awaiting-decision");
  assert.equal(stored.record.outcome, undefined);
  assert.equal(stored.candidate.message, "approved");
  assert.equal(stored.candidate.parentOid, candidate.preview.head);
  assert.match(stored.candidate.diff.patch, /captured private patch/);
  assert.doesNotMatch(JSON.stringify(stored), /reviewToken|planId|receiptIds/);
  assert.equal(stored.record.summary.diff, undefined);
  assert.deepEqual(anchors(f.sm).map((e) => e.data), [{ version: 1, actionId: candidate.actionId }]);
  assert.doesNotMatch(await readFile(f.sm.getSessionFile(), "utf8"), /captured private patch|reviewToken/);
  const manager = SessionManager.open(f.sm.getSessionFile());
  const agent = await beginGitAction(gitActionSink(manager, (type, data) => manager.appendCustomEntry(type, data)), "agent", stored.candidate);
  try {
    await agent.update("awaiting-decision");
    assert.deepEqual((await history(agent.record.id)).candidate, stored.candidate);
    await agent.update("declined", { decision: "declined" });
  } finally { agent.release(); }
  const result = await (await post(confirmRequest(f.id, candidate))).json();
  assert.equal(result.status, "committed");
  assert.doesNotMatch(JSON.stringify(result), /patch|captured private patch/);
  stored = await history(candidate.actionId);
  assert.equal(stored.record.state, "succeeded");
  assert.equal(stored.record.decision, "approved");
  assert.equal(stored.record.intended.commit, result.commit);
  assert.equal(stored.record.outcome.commit, result.commit);
  assert.equal(stored.record.outcome.authorEmail, "route@example.invalid");
  assert.deepEqual(stored.record.outcome.parents, [candidate.preview.head]);
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
  assert.equal((await history(candidate.actionId)).record.revision, stored.record.revision);
  await rm(f.cwd, { recursive: true, force: true });
  assert.deepEqual((await history(candidate.actionId)).candidate, stored.candidate);
});

test("only the same live session, exact message and native candidate can be confirmed; legacy and historical IDs are not executable", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "approved content\n");
  assert.equal((await post({ sessionId: f.id, operation: "preview", paths: ["a"] })).status, 400);
  assert.equal(anchors(f.sm).length, 0);
  const candidate = await (await post(previewRequest(f.id, "exact message"))).json();
  const other = await fixture(t);
  const sm = SessionManager.create(f.cwd);
  sm.appendMessage({ role: "user", content: "fork", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  sm.appendCustomEntry("pi-web:git-action", { version: 1, actionId: candidate.actionId });
  cacheSessionPath(sm.getSessionId(), sm.getSessionFile());
  t.after(() => invalidateSessionPathCache(sm.getSessionId()));
  for (const id of [other.id, sm.getSessionId()]) assert.equal((await post(confirmRequest(id, candidate, "exact message"))).status, 409);
  assert.equal((await post(confirmRequest(f.id, candidate, "different message"))).status, 409);
  assert.equal((await post({ ...confirmRequest(f.id, candidate, "exact message"), preview: { ...candidate.preview, tree: "f".repeat(40) } })).status, 409);
  assert.equal((await post({ ...confirmRequest(f.id, candidate, "exact message"), actionId: undefined })).status, 409);
  assert.equal((await post({ ...confirmRequest(f.id, candidate, "exact message"), actionId: "00000000-0000-0000-0000-000000000000" })).status, 409);
  assert.equal((await history(candidate.actionId)).record.state, "awaiting-decision");
  assert.equal((await post(confirmRequest(f.id, candidate, "exact message"))).status, 200);
});

test("expired association cannot be revived even with an otherwise authentic native token", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "expired\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const now = Date.now;
  Date.now = () => candidate.expiresAt + 1;
  try { assert.equal((await post(confirmRequest(f.id, candidate))).status, 409); }
  finally { Date.now = now; }
  assert.equal((await history(candidate.actionId)).record.state, "expired");
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
});

test("callback journals intended identity before ref CAS; cancellation after that write prevents mutation", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "cancelled\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const controller = new AbortController();
  let observed;
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionId !== candidate.actionId) return;
    const record = JSON.parse(readFileSync(join(agentDir, "pi-web/git-actions/v1", actionId, "record.json"), "utf8")).record;
    if (record.state === "executing" && record.intended) { observed = record.intended; controller.abort(); }
  });
  try { assert.equal((await post(confirmRequest(f.id, candidate), controller.signal)).status, 409); }
  finally { off(); }
  assert.ok(observed.commit);
  assert.equal(observed.tree, candidate.preview.tree);
  assert.equal((await history(candidate.actionId)).record.state, "cancelled");
  assert.equal((await history(candidate.actionId)).record.outcome, undefined);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
});

test("missing durable candidate prevents mutation, and post-apply recording failure preserves actual result with recovery warning", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "journal failure\n");
  const unavailable = await (await post(previewRequest(f.id))).json();
  await rm(join(agentDir, "pi-web/git-actions/v1", unavailable.actionId, "candidate.json"));
  assert.equal((await post(confirmRequest(f.id, unavailable))).status, 409);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), unavailable.preview.head);
  const candidate = await (await post(previewRequest(f.id))).json();
  const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
    if (actionId !== candidate.actionId) return;
    const file = join(agentDir, "pi-web/git-actions/v1", actionId, "record.json");
    const record = JSON.parse(readFileSync(file, "utf8")).record;
    if (record.state === "executing" && record.intended) writeFileSync(file, "injected journal failure");
  });
  let response;
  try { response = await post(confirmRequest(f.id, candidate)); }
  finally { off(); }
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "committed");
  assert.equal(result.actionId, candidate.actionId);
  assert.equal(result.recoveryRequired, true);
  assert.match(result.recoveryWarning, /do not repeat/i);
  assert.doesNotMatch(JSON.stringify(result), /refresh|no mutation|injected journal failure/i);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
  assert.equal((await post(confirmRequest(f.id, candidate))).status, 409);
});

test("native post-ref partial success is recovery-required with actual OIDs, never an ordinary failed commit", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "partial\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const bin = await mkdtemp(join(tmpdir(), "pi-web-git-partial-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; rm "${f.cwd}/.git/index.lock"; exit 0 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirmRequest(f.id, candidate)); }
  finally { process.env.PATH = oldPath; }
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, "partial-success");
  const stored = await history(candidate.actionId);
  assert.equal(stored.record.state, "recovery-required");
  assert.equal(stored.record.outcome.commit, result.commit);
  assert.equal(stored.record.outcome.reason, undefined);
  assert.deepEqual(stored.record.outcome.parents, [candidate.preview.head]);
  assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), result.commit);
});

test("callback intent-write failure and late access revocation both prevent the ref CAS", async (t) => {
  for (const fault of ["journal", "revocation"]) {
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), `${fault}\n`);
    const candidate = await (await post(previewRequest(f.id))).json();
    const roots = globalThis.__piAllowedRootsCache;
    let injected = false;
    const off = subscribeGitActionUpdates(f.id, ({ actionId }) => {
      if (actionId !== candidate.actionId || injected) return;
      const record = JSON.parse(readFileSync(join(agentDir, "pi-web/git-actions/v1", actionId, "record.json"), "utf8")).record;
      if (record.state !== "executing") return;
      if (fault === "journal" && !record.intended) {
        writeFileSync(join(agentDir, "pi-web/git-actions/v1", actionId, "candidate.json"), "invalid candidate");
        injected = true;
      } else if (fault === "revocation" && record.intended) {
        globalThis.__piAllowedRootsCache = { roots: new Set([agentDir]), expiresAt: Date.now() + 10000 };
        injected = true;
      }
    });
    try { assert.equal((await post(confirmRequest(f.id, candidate))).status, 409); }
    finally { off(); globalThis.__piAllowedRootsCache = roots; }
    assert.equal(injected, true);
    assert.equal((await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim(), candidate.preview.head);
    if (fault === "revocation") assert.equal((await history(candidate.actionId)).record.state, "blocked");
  }
});

test("unknown error after the ref boundary reports uncertain execution with intended facts, never stale-preview guidance", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "uncertain update\n");
  const candidate = await (await post(previewRequest(f.id))).json();
  const bin = await mkdtemp(join(tmpdir(), "pi-web-git-uncertain-"));
  t.after(() => rm(bin, { recursive: true, force: true }));
  const realGit = (await git("which", ["git"])).stdout.trim();
  const wrapper = join(bin, "git");
  await writeFile(wrapper, `#!/bin/sh\ncase " $* " in *" update-ref "*) "${realGit}" "$@" || exit $?; echo 'secret unknown error' >&2; exit 1 ;; esac\nexec "${realGit}" "$@"\n`);
  await chmod(wrapper, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}:${oldPath}`;
  let response;
  try { response = await post(confirmRequest(f.id, candidate)); }
  finally { process.env.PATH = oldPath; }
  assert.equal(response.status, 409);
  const result = await response.json();
  assert.equal(result.recoveryRequired, true);
  assert.match(result.recoveryWarning, /uncertain execution result/);
  assert.match(result.error, /do not retry/);
  assert.doesNotMatch(JSON.stringify(result), /refresh|new preview|secret unknown error/);
  assert.equal(result.outcome, undefined);
  assert.equal(result.intended.commit, (await git("git", ["-C", f.cwd, "rev-parse", "HEAD"])).stdout.trim());
  assert.equal((await history(candidate.actionId)).record.state, "recovery-required");
});

test("anchor resolves the latest disk parent or newly-created live manager after awaited artifact work", async (t) => {
  const registry = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = registry; });
  for (const mode of ["disk", "new-live-wrapper"]) {
    globalThis.__piSessions = registry;
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "fresh anchor parent\n");
    let latest;
    let expectedParent;
    const off = subscribeGitActionUpdates(f.id, ({ revision }) => {
      if (revision !== 1 || latest) return;
      latest = SessionManager.open(f.sm.getSessionFile());
      latest.appendCustomEntry("test:concurrent-metadata", { mode });
      expectedParent = latest.getLeafId();
      if (mode === "new-live-wrapper") globalThis.__piSessions = new Map([...(registry ?? []), [f.id, {
        sessionId: f.id, sessionFile: f.sm.getSessionFile(), cwd: f.cwd, isAlive: () => true, isRunning: () => false,
        inner: { sessionManager: latest },
      }]]);
    });
    let response;
    try { response = await post(previewRequest(f.id)); }
    finally { off(); }
    assert.equal(response.status, 200, await response.clone().text());
    const candidate = await response.json();
    const [anchor] = anchors(f.sm);
    assert.equal(anchor.data.actionId, candidate.actionId);
    assert.equal(anchor.parentId, expectedParent, "append must not branch from the pre-artifact manager's parent");
    assert.equal(entries(f.sm).filter((e) => e.customType === "test:concurrent-metadata").length, 1);
    if (mode === "new-live-wrapper") assert.equal(latest.getLeafId(), anchor.id, "the live SDK manager receives the anchor too");
  }
});

test("disk-ahead live manager and moved/replaced source file are refused at anchor append, never recreated or overwritten", async (t) => {
  const registry = globalThis.__piSessions;
  t.after(() => { globalThis.__piSessions = registry; });
  for (const mode of ["disk-ahead-live", "moved", "replaced"]) {
    globalThis.__piSessions = registry;
    const f = await fixture(t);
    await writeFile(join(f.cwd, "a"), "do not recreate source\n");
    const file = f.sm.getSessionFile();
    const moved = `${file}.moved`;
    const source = await readFile(file, "utf8");
    if (mode === "disk-ahead-live") globalThis.__piSessions = new Map([...(registry ?? []), [f.id, {
      sessionId: f.id, sessionFile: file, cwd: f.cwd, isAlive: () => true, isRunning: () => false, inner: { sessionManager: f.sm },
    }]]);
    let actionId;
    const off = subscribeGitActionUpdates(f.id, (event) => {
      if (event.revision !== 1) return;
      actionId = event.actionId;
      if (mode === "disk-ahead-live") SessionManager.open(file).appendCustomEntry("test:external", { keep: true });
      else {
        renameSync(file, moved);
        if (mode === "replaced") writeFileSync(file, source);
      }
    });
    let response;
    try { response = await post(previewRequest(f.id)); }
    finally { off(); }
    assert.equal(response.status, 409);
    assert.ok(actionId, "fault injected after durable artifact creation, before anchor append");
    assert.equal((await history(actionId)).record.state, "blocked");
    if (mode === "moved") {
      assert.equal(existsSync(file), false, "SDK must not recreate a removed source file");
      assert.equal(await readFile(moved, "utf8"), source);
    } else {
      assert.equal(anchors(f.sm).length, 0);
      if (mode === "replaced") assert.equal(await readFile(file, "utf8"), source);
      else assert.equal(entries(f.sm).at(-1).customType, "test:external");
    }
  }
});
