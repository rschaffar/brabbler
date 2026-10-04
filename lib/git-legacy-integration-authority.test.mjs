import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const home = await mkdtemp(join(tmpdir(), "pi-web-legacy-authority-")), agentDir = join(home, "agent");
await mkdir(agentDir, { mode: 0o700 });
const previous = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map(key => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
const jiti = createJiti(import.meta.url);
const { captureLegacyIntegrationAuthority } = await jiti.import("./git-legacy-integration-authority.ts");
const { captureGitMutationAuthority } = await jiti.import("./git-mutation-invocation.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const exec = promisify(execFile), git = async (cwd, ...args) => exec("git", ["-C", cwd, ...args]);
after(async () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } await rm(home, { recursive: true, force: true }); });
async function fixture() {
  const dir = await mkdtemp(join(home, "fixture-")), targetCwd = join(dir, "main"), sourceCwd = join(dir, "feature");
  await exec("git", ["init", "-qb", "main", targetCwd]); await git(targetCwd, "config", "user.name", "Fixture"); await git(targetCwd, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(targetCwd, "a"), "base\n"); await git(targetCwd, "add", "a"); await git(targetCwd, "commit", "-qm", "base");
  await git(targetCwd, "worktree", "add", "-qb", "feature", sourceCwd);
  // Trusted bootstrap admits the exact actual checkout roots before tool entry.
  allowFileRoot(targetCwd); allowFileRoot(sourceCwd);
  const manager = SessionManager.create(targetCwd); manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "persisted" }], timestamp: Date.now() });
  const ctx = { cwd: targetCwd, sessionManager: manager };
  let revision = 1, tools = ["read", "edit"];
  return { manager, ctx, targetCwd, sourceCwd, mutate() { revision++; }, tools(value) { revision++; tools = value; },
    options: { sessionCwd: targetCwd, agentDir, ctx, effectiveTools: () => tools, readSelectionRevisionSync: () => String(revision) } };
}
test("real persisted SDK owner needs original monotonic selection provider when no live RPC exists", async () => {
  const f = await fixture(); const { readSelectionRevisionSync, ...missing } = f.options; void readSelectionRevisionSync;
  assert.throws(() => captureLegacyIntegrationAuthority(missing), /authority|owner/);
  const original = captureLegacyIntegrationAuthority(f.options);
  const caller = await selectGitProjectResources(f.targetCwd), source = await selectGitProjectResources(f.sourceCwd);
  original.select(caller, source, caller); original.assertCurrentSync();
  f.manager.appendMessage({ role: "user", content: "ordinary SDK history", timestamp: Date.now() }); original.assertCurrentSync();
  f.tools(["read"]); f.tools(["read", "edit"]);
  assert.throws(() => original.assertCurrentSync(), /authority|owner/);
});
test("original opaque snapshot selects Alpha and Beta after discovery; Gamma is neutral, own restore during await revokes", async () => {
  const alpha = await fixture(), beta = await fixture(), gamma = await fixture();
  const authority = captureLegacyIntegrationAuthority(alpha.options);
  const doc = readGitWorkflowSettingsDocument(agentDir);
  writeGitWorkflowSettingsDocument({ ...doc, projects: { ...doc.projects, [gamma.targetCwd]: { commits: "manual" } } }, agentDir, [{ kind: "project", projectRoot: gamma.targetCwd }]);
  const caller = await selectGitProjectResources(alpha.targetCwd), source = await selectGitProjectResources(beta.sourceCwd), target = await selectGitProjectResources(beta.targetCwd);
  authority.select(caller, source, target); authority.assertCurrentSync();
  const second = captureLegacyIntegrationAuthority(alpha.options), current = readGitWorkflowSettingsDocument(agentDir);
  writeGitWorkflowSettingsDocument({ ...current, projects: { ...current.projects, [beta.targetCwd]: { enabled: false } } }, agentDir, [{ kind: "project", projectRoot: beta.targetCwd }]);
  writeGitWorkflowSettingsDocument(current, agentDir, [{ kind: "project", projectRoot: beta.targetCwd }]);
  await Promise.resolve(); assert.throws(() => second.select(caller, source, target), /authority|owner/);
  assert.throws(() => authority.assertCurrentSync(), /authority|owner/);
});
test("the original manager instance and synchronous exact native candidate/approval are mandatory", async () => {
  const f = await fixture(), original = captureLegacyIntegrationAuthority(f.options);
  const target = await selectGitProjectResources(f.targetCwd), source = await selectGitProjectResources(f.sourceCwd); original.select(target, source, target);
  let approved = true;
  const adapter = original.nativeAuthority(() => { if (!approved) throw new Error("approval revoked"); });
  assert.equal(adapter.owner.sessionId, f.manager.getSessionId()); assert.equal(adapter.owner.sessionFile, f.manager.getSessionFile());
  const captured = captureGitMutationAuthority(adapter), invocation = captured.bind({ kind: "integrate", source, target, candidateSha256: "a".repeat(64) });
  invocation.assertCurrentSync(); approved = false; assert.throws(() => invocation.consumeSync(), /approval/); invocation.retire();
  assert.throws(() => captureGitMutationAuthority(original.nativeAuthority(async () => {})).bind({ kind: "integrate", source, target, candidateSha256: "b".repeat(64) }), /authority|owner/);
  f.ctx.sessionManager = SessionManager.open(f.manager.getSessionFile()); assert.throws(() => original.assertCurrentSync(), /authority|owner/);
});
