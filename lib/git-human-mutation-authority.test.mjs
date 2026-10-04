import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const home = await mkdtemp(join(tmpdir(), "pi-web-human-authority-")), agentDir = join(home, "agent");
await mkdir(agentDir, { mode: 0o700 });
const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url, { moduleCache: true });
const { captureHumanGitMutationAuthority } = await jiti.import("./git-human-mutation-authority.ts");
const { captureGitMutationAuthority } = await jiti.import("./git-mutation-invocation.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const exec = promisify(execFile), git = async (cwd, ...args) => exec("git", ["-C", cwd, ...args]);
after(async () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; await rm(home, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(home, "fixture-")), targetCwd = join(dir, "main"), sourceCwd = join(dir, "feature");
  await exec("git", ["init", "-qb", "main", targetCwd]); await git(targetCwd, "config", "user.name", "Fixture"); await git(targetCwd, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(targetCwd, "a"), "base\n"); await git(targetCwd, "add", "a"); await git(targetCwd, "commit", "-qm", "base");
  await git(targetCwd, "worktree", "add", "-qb", "feature", sourceCwd); allowFileRoot(sourceCwd); allowFileRoot(targetCwd);
  const sm = SessionManager.create(sourceCwd); sm.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "persisted" }], timestamp: Date.now() });
  return { scope: { sessionId: sm.getSessionId(), sessionFile: sm.getSessionFile(), cwd: sourceCwd }, targetCwd };
}
test("later canonical project dependencies derive from original pre-await map, including change-and-restore", async () => {
  const f = await fixture(), authority = captureHumanGitMutationAuthority(f.scope, agentDir);
  const original = readGitWorkflowSettingsDocument(agentDir);
  writeGitWorkflowSettingsDocument({ ...original, projects: { ...original.projects, [f.targetCwd]: { enabled: false } } }, agentDir, [{ kind: "project", projectRoot: f.targetCwd }]);
  writeGitWorkflowSettingsDocument(original, agentDir, [{ kind: "project", projectRoot: f.targetCwd }]);
  const source = await selectGitProjectResources(f.scope.cwd), target = await selectGitProjectResources(f.targetCwd);
  assert.throws(() => authority.select(source, target), /revoked/);
});
test("unrelated project writes are neutral; actual saved-owner rewrite fences even equal restored bytes", async () => {
  const f = await fixture(), authority = captureHumanGitMutationAuthority(f.scope, agentDir), doc = readGitWorkflowSettingsDocument(agentDir), other = join(home, "other");
  writeGitWorkflowSettingsDocument({ ...doc, projects: { ...doc.projects, [other]: { commits: "manual" } } }, agentDir, [{ kind: "project", projectRoot: other }]);
  authority.select(await selectGitProjectResources(f.scope.cwd), await selectGitProjectResources(f.targetCwd));
  authority.assertCurrentSync();
  const bytes = await readFile(f.scope.sessionFile); await writeFile(f.scope.sessionFile, bytes);
  assert.throws(() => authority.assertCurrentSync(), /revoked/);
});
test("actual persisted owner, exact physical resources, private generation and synchronous approval bind native invocation", async () => {
  const f = await fixture(), authority = captureHumanGitMutationAuthority(f.scope, agentDir);
  const source = await selectGitProjectResources(f.scope.cwd), target = await selectGitProjectResources(f.targetCwd); authority.select(source, target);
  const adapter = authority.nativeAuthority(() => {}), original = captureGitMutationAuthority(adapter);
  assert.equal(adapter.owner.sessionId, f.scope.sessionId); assert.equal(adapter.owner.sessionFile, f.scope.sessionFile); assert.ok(adapter.owner.generation);
  const invocation = original.bind({ kind: "integrate", source, target, candidateSha256: "a".repeat(64) }); invocation.assertCurrentSync();
  assert.throws(() => original.bind({ kind: "integrate", source: target, target: source, candidateSha256: "a".repeat(64) }), /Exact human/);
  const bad = captureGitMutationAuthority(authority.nativeAuthority(async () => {}));
  assert.throws(() => bad.bind({ kind: "integrate", source, target, candidateSha256: "b".repeat(64) }), /Synchronous/);
  invocation.consumeSync(); assert.throws(() => invocation.consumeSync()); invocation.retire();
});
