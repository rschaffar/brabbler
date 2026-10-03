import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, rename, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true, moduleCache: false });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization, projectAuthorizationPath } = await jiti.import("./git-project-authorization.ts");
const { assertManagedGitProjectDenial, ManagedGitAccessError } = await jiti.import("./git-workflow-access.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument, withGitWorkflowSettingsLock } = await jiti.import("./git-workflow-settings-store.ts");
const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-project-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agentDir = join(root, "agent"), repo = join(root, "repo"), other = join(root, "other"), linked = join(root, "linked");
  const git = async (...args) => exec("git", args, { env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "no-config") } });
  for (const path of [repo, other]) {
    await git("init", "-qb", "main", path);
    await git("-C", path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", `core.hooksPath=${join(root, "no-hooks")}`,
      "commit", "--allow-empty", "-qm", "initial");
    allowFileRoot(path);
  }
  await git("-C", repo, "worktree", "add", "-qb", "alternate", linked);
  allowFileRoot(linked);
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; });
  const session = SessionManager.create(repo, join(agentDir, "sessions"));
  session.appendMessage({ role: "user", content: "test", timestamp: Date.now() });
  session.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const owner = { sessionId: session.getSessionId(), sessionFile: session.getSessionFile(), sessionCwd: repo };
  return { agentDir, root, repo, other, linked, git, session, owner,
    selection: await selectGitProjectResources(repo), alternate: await selectGitProjectResources(linked),
    otherSelection: await selectGitProjectResources(other) };
}
const read = function (f, selection = f.selection, owner) {
  return readProjectAuthorization(selection, arguments.length < 3 ? f.owner : owner, f.agentDir);
};
const save = (f, scope, action, decision, before, selection = f.selection, owner = scope === "session" ? f.owner : undefined) =>
  saveProjectAuthorization(selection, owner, scope, action, decision, before, f.agentDir);
const globalRead = (f) => readProjectAuthorization(undefined, undefined, f.agentDir);
const globalSave = (f, action, decision, before) => saveProjectAuthorization(undefined, undefined, "global", action, decision, before, f.agentDir);

// These tests use disposable repos/agentDir only; do not touch live credentials or operator settings.
test("default denies nothing but grants nothing; no preference, confirmation or legacy record mints a grant", async (t) => {
  const f = await fixture(t);
  const initial = await read(f);
  for (const value of Object.values(initial.actions)) assert.deepEqual(value, { global: "inherit", project: "inherit", session: "inherit", effective: "none", source: "none" });
  assert.equal(initial.approvalToken, false);
  f.session.appendCustomEntry("pi-web:git-project-settings", { version: 1, projectRoot: f.repo, overrides: { commitConfirmation: "none" } });
  assert.equal((await read(f)).actions.commit.effective, "none");
  await assert.rejects(save(f, "session", "commit", "allow", initial), /changed; review again/);
  const path = projectAuthorizationPath(f.agentDir);
  await writeFile(path, JSON.stringify({ version: 1, revision: "none", grants: [] }), { mode: 0o600 }).catch(async () => {
    // A document need not exist until a decision is saved.
    await globalSave(f, "checks", "deny", await globalRead(f));
    await writeFile(path, JSON.stringify({ version: 1, revision: "none", grants: [] }), { mode: 0o600 });
  });
  await assert.rejects(globalRead(f), /Unsupported project authorization document/);
});

test("v2 migration preserves exact records; old commit Allow never grants prepare/cleanup", async (t) => {
  const f = await fixture(t);
  await globalSave(f, "commit", "allow", await globalRead(f));
  await save(f, "project", "checks", "deny", await read(f, f.selection, undefined));
  await save(f, "session", "workspace", "allow", await read(f));
  const path = projectAuthorizationPath(f.agentDir);
  const old = { ...JSON.parse(await readFile(path, "utf8")), version: 2 };
  const bytes = JSON.stringify(old);
  await writeFile(path, bytes, { mode: 0o600 });
  const status = await read(f);
  assert.equal(status.revision, old.revision);
  assert.equal(status.actions.commit.effective, "allow");
  assert.equal(status.actions.workspace.effective, "allow");
  assert.equal(status.actions.checks.effective, "deny");
  for (const action of ["prepare", "cleanup"]) {
    assert.deepEqual(status.actions[action], { global: "inherit", project: "inherit", session: "inherit", effective: "none", source: "none" });
  }
  assert.equal(await readFile(path, "utf8"), bytes, "read never writes/migrates real settings");
  await save(f, "project", "prepare", "allow", await read(f, f.selection, undefined));
  const migrated = JSON.parse(await readFile(path, "utf8"));
  assert.equal(migrated.version, 3);
  assert.deepEqual(migrated.grants.slice(0, old.grants.length), old.grants);
  assert.equal((await read(f)).actions.prepare.effective, "allow");
  assert.equal((await read(f)).actions.cleanup.effective, "none");
  await save(f, "session", "cleanup", "deny", await read(f));
  assert.equal((await read(f)).actions.cleanup.effective, "deny");
  assert.equal((await read(f)).actions.commit.effective, "allow");
  await writeFile(path, JSON.stringify({ ...migrated, version: 2 }), { mode: 0o600 });
  await assert.rejects(read(f), /Invalid authorization record/, "v2 never carried the new action keys");
});

test("global allow/deny; project allow/deny; chat allow/deny; inherit removes only that scope", async (t) => {
  const f = await fixture(t);
  let g = await globalSave(f, "commit", "allow", await globalRead(f));
  assert.equal(g.actions.commit.effective, "allow");
  assert.equal(g.actions.commit.project, "inherit");
  let p = await save(f, "project", "commit", "deny", await read(f, f.selection, undefined));
  assert.deepEqual([p.actions.commit.global, p.actions.commit.project, p.actions.commit.effective, p.actions.commit.source], ["allow", "deny", "deny", "project"]);
  assert.equal((await read(f, f.otherSelection, undefined)).actions.commit.effective, "allow");
  let s = await save(f, "session", "commit", "allow", await read(f));
  assert.equal(s.actions.commit.effective, "allow");
  assert.equal(s.actions.commit.source, "session");
  s = await save(f, "session", "commit", "deny", s);
  assert.equal(s.actions.commit.effective, "deny");
  s = await save(f, "session", "commit", "inherit", s);
  assert.equal(s.actions.commit.effective, "deny");
  p = await save(f, "project", "commit", "inherit", await read(f, f.selection, undefined));
  assert.equal((await read(f)).actions.commit.effective, "allow");
  g = await globalSave(f, "commit", "deny", await globalRead(f));
  assert.equal((await read(f)).actions.commit.effective, "deny");
  assert.equal(g.approvalToken, false);
  await globalSave(f, "commit", "inherit", g);
  assert.equal((await read(f)).actions.commit.effective, "none");
});

test("project and global survive alternate registered checkout and unrelated chat, session binds ordinary chat and canonical project", async (t) => {
  const f = await fixture(t);
  await globalSave(f, "workspace", "allow", await globalRead(f));
  const project = await save(f, "project", "checks", "allow", await read(f, f.selection, undefined));
  assert.equal(project.actions.checks.effective, "allow");
  assert.equal((await read(f, f.alternate, undefined)).actions.checks.effective, "allow");
  assert.equal((await read(f, f.alternate, undefined)).actions.workspace.effective, "allow");
  const saved = await save(f, "session", "integration", "allow", await read(f));
  assert.equal((await read(f, f.alternate)).actions.integration.effective, "allow");
  assert.equal((await read(f, f.otherSelection)).actions.integration.effective, "none");
  const second = SessionManager.create(f.repo, join(f.agentDir, "sessions"));
  second.appendMessage({ role: "user", content: "another", timestamp: Date.now() });
  second.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const owner = { sessionId: second.getSessionId(), sessionFile: second.getSessionFile(), sessionCwd: f.repo };
  assert.equal((await read(f, f.selection, owner)).actions.integration.effective, "none");
  assert.equal(saved.approvalToken, false);
  const revoked = await save(f, "project", "checks", "deny", await read(f, f.selection, undefined));
  assert.equal((await read(f, f.alternate, undefined)).actions.checks.effective, "deny");
  assert.equal(revoked.approvalToken, false);
});

test("legacy negative overlay follows chat×canonical-project across registered worktrees, never another repository", async (t) => {
  const f = await fixture(t);
  const gate = (cwd, owner = f.owner) => assertManagedGitProjectDenial(cwd, owner, "workspace", f.agentDir);
  await gate(f.repo);
  await gate(f.linked);
  await assert.rejects(gate(f.other), ManagedGitAccessError);
  await save(f, "session", "workspace", "deny", await read(f));
  for (const cwd of [f.repo, f.linked]) await assert.rejects(gate(cwd), /denies or cannot verify/);
  const another = SessionManager.create(f.repo, join(f.agentDir, "sessions"));
  another.appendMessage({ role: "user", content: "other", timestamp: Date.now() });
  another.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  await gate(f.linked, { sessionId: another.getSessionId(), sessionFile: another.getSessionFile(), sessionCwd: f.repo });
  await assert.rejects(gate(f.linked, { ...f.owner, sessionCwd: f.linked }), ManagedGitAccessError);
  await save(f, "project", "workspace", "deny", await read(f, f.selection, undefined));
  await assert.rejects(gate(f.linked, { sessionId: another.getSessionId(), sessionFile: another.getSessionFile(), sessionCwd: f.repo }), ManagedGitAccessError);
  await save(f, "session", "workspace", "allow", await read(f));
  await gate(f.linked); // narrower allow removes only this deny; legacy consent is still independent.
  await save(f, "session", "workspace", "inherit", await read(f));
  await save(f, "project", "workspace", "inherit", await read(f, f.selection, undefined));
  await globalSave(f, "workspace", "deny", await globalRead(f));
  await assert.rejects(gate(f.linked), ManagedGitAccessError);
});

test("live revocation, pause and policy epoch; replacement and copied session cannot inherit", async (t) => {
  const f = await fixture(t);
  const global = await globalSave(f, "commit", "allow", await globalRead(f));
  const saved = await save(f, "session", "commit", "allow", await read(f));
  await withGitWorkflowSettingsLock(f.agentDir, async () => {
    const doc = readGitWorkflowSettingsDocument(f.agentDir);
    doc.paused = true;
    writeGitWorkflowSettingsDocument(doc, f.agentDir);
  });
  assert.equal((await read(f)).actions.commit.effective, "deny");
  await withGitWorkflowSettingsLock(f.agentDir, async () => {
    const doc = readGitWorkflowSettingsDocument(f.agentDir);
    doc.paused = false;
    writeGitWorkflowSettingsDocument(doc, f.agentDir);
  });
  assert.deepEqual([(await read(f)).actions.commit.session, (await read(f)).actions.commit.effective], ["stale", "deny"]);
  assert.equal((await globalRead(f)).actions.commit.effective, "allow", "global remains independent of chat/checkout settings revision");
  await assert.rejects(globalSave(f, "integration", "allow", global), /changed; review again/);
  await assert.rejects(save(f, "session", "commit", "allow", saved), /changed; review again/);
  await save(f, "session", "commit", "inherit", await read(f));
  assert.equal((await read(f)).actions.commit.effective, "allow");
  const renewed = await save(f, "session", "integration", "allow", await read(f));
  const backup = `${f.owner.sessionFile}.old`;
  await rename(f.owner.sessionFile, backup);
  await copyFile(backup, f.owner.sessionFile);
  assert.equal((await read(f)).actions.integration.session, "stale");
  assert.equal((await read(f)).actions.integration.effective, "deny");
  assert.equal(renewed.approvalToken, false);
  const next = await globalSave(f, "commit", "deny", await globalRead(f));
  assert.equal((await read(f)).actions.commit.effective, "deny");
  assert.equal(next.actions.commit.effective, "deny");
});

test("lost document closes grants, malformed/future/duplicate/copy-carried records never widen", async (t) => {
  const f = await fixture(t);
  await save(f, "project", "commit", "allow", await read(f, f.selection, undefined));
  const path = projectAuthorizationPath(f.agentDir);
  const original = JSON.parse(await readFile(path, "utf8"));
  await rm(path);
  assert.equal((await read(f)).actions.commit.effective, "none");
  await writeFile(path, JSON.stringify(original), { mode: 0o600 });
  for (const bad of ["{", JSON.stringify({ ...original, version: 99 }), JSON.stringify({ ...original, grants: [...original.grants, original.grants[0]] }),
    JSON.stringify({ ...original, grants: [{ ...original.grants[0], action: "unknown-action" }] }),
    JSON.stringify({ ...original, grants: [{ ...original.grants[0], projectIdentity: { ...original.grants[0].projectIdentity, common: { device: "1", inode: "2", birthtime: "3" } } }] }),
    JSON.stringify({ ...original, unknown: true })]) {
    await writeFile(path, bad, { mode: 0o600 });
    if (bad.includes('"device":"1"')) assert.deepEqual([(await read(f)).actions.commit.project, (await read(f)).actions.commit.effective], ["stale", "deny"]);
    else await assert.rejects(read(f));
    await assert.rejects(save(f, "project", "commit", "allow", { revision: "none", policyRevision: "none" }, f.selection, undefined));
    assert.equal(await readFile(path, "utf8"), bad);
  }
});
