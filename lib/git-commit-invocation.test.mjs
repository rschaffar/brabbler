import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = mkdtempSync(join(tmpdir(), "commit-invocation-adapter-"));
const previous = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = home;
after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(home, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url);
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { prepareGitCommit } = await jiti.import("./git-commit.ts");
const { gitExactCommitInvocationBinding } = await jiti.import("./git-exact-commit-operation.ts");
const { captureGitCommitAuthority } = await jiti.import("./git-commit-invocation.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { assertGitInvocationCurrentSync, consumeGitInvocationSync, retireGitInvocation } = await jiti.import("./git-invocation.ts");

async function fixture(t) {
  const cwd = mkdtempSync(join(home, "repo-"));
  const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "pipe" });
  git("init", "-qb", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  writeFileSync(join(cwd, "a"), "base\n"); git("add", "a"); git("commit", "-qm", "base");
  writeFileSync(join(cwd, "a"), "candidate\n"); allowFileRoot(cwd);
  const manager = SessionManager.create(cwd, join(home, "sessions"));
  manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  let tools = ["read", "edit"];
  const inner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager,
    settingsManager: SettingsManager.create(cwd, home), getActiveToolNames: () => tools,
    setActiveToolsByName: (names) => { tools = [...names]; }, dispose() {}, agent: { state: {} } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
  const previousSessions = globalThis.__piSessions;
  globalThis.__piSessions = new Map([[inner.sessionId, wrapper]]);
  t.after(() => { wrapper.destroy(); globalThis.__piSessions = previousSessions; });
  const scope = { sessionId: inner.sessionId, sessionFile: inner.sessionFile, cwd };
  const capture = () => captureGitCommitAuthority({ scope, manager, effectiveTools: inner.getActiveToolNames });
  const authority = capture();
  const source = await selectGitProjectResources(cwd);
  await authority.selectSource(source);
  const preview = await prepareGitCommit(cwd, ["a"]);
  let approved = false;
  return { authority, inner, source, preview, scope, captureUnselected: capture,
    async capture() { const fresh = capture(); await fresh.selectSource(source); return fresh; },
    approve() { approved = true; }, revokeApproval() { approved = false; },
    bind(original = authority) { return original.bind(source, preview, "exact message", () => assert.equal(approved, true, "own exact approval required")); } };
}

test("real primitive binding uses the persisted owner and private generation, consumes once and cannot change candidate", async (t) => {
  const f = await fixture(t); f.approve();
  const invocation = f.bind();
  const binding = gitExactCommitInvocationBinding(f.source, f.preview, "exact message", invocation.owner);
  assert.equal(invocation.owner.sessionId, f.scope.sessionId); assert.equal(invocation.owner.sessionFile, f.scope.sessionFile);
  assert.match(invocation.owner.generation, /^[a-f0-9-]{36}$/);
  assertGitInvocationCurrentSync(invocation.handle, binding);
  consumeGitInvocationSync(invocation.handle, binding);
  assert.throws(() => consumeGitInvocationSync(invocation.handle, binding));
  assert.throws(() => f.bind(), /already bound/);
  const next = f.bind(await f.capture());
  assert.notEqual(next.owner.generation, invocation.owner.generation);
  assert.throws(() => assertGitInvocationCurrentSync(next.handle,
    gitExactCommitInvocationBinding(f.source, f.preview, "other message", next.owner)));
  retireGitInvocation(next.handle);
});

test("original scoped snapshot excludes Gamma but rejects relevant change-and-restore during async source selection", async (t) => {
  const f = await fixture(t);
  const gamma = mkdtempSync(join(home, "gamma-"));
  execFileSync("git", ["init", "-qb", "main", gamma], { stdio: "pipe" });
  const captured = f.captureUnselected();
  const document = readGitWorkflowSettingsDocument(home);
  document.projects[gamma] = { commits: "off" };
  writeGitWorkflowSettingsDocument(document, home, [{ kind: "project", projectRoot: gamma }]);
  await captured.selectSource(f.source);
  captured.assertCurrentSync(); f.authority.assertCurrentSync();
  const duringDiscovery = f.captureUnselected();
  const original = structuredClone(document);
  document.projects[f.source.projectRoot] = { commits: "off" };
  writeGitWorkflowSettingsDocument(document, home, [{ kind: "project", projectRoot: f.source.projectRoot }]);
  writeGitWorkflowSettingsDocument(original, home, [{ kind: "project", projectRoot: f.source.projectRoot }]);
  await assert.rejects(duringDiscovery.selectSource(f.source), /revoked/);
  assert.throws(() => captured.assertCurrentSync(), /revoked/);
});

test("capturing after approval cannot refresh an original wrapper epoch, and own approval remains live", async (t) => {
  const f = await fixture(t);
  f.inner.setActiveToolsByName(["read"]); f.inner.setActiveToolsByName(["read", "edit"]);
  f.approve();
  assert.throws(() => f.bind(), /revoked/);
  const invocation = f.bind(await f.capture()); f.revokeApproval();
  assert.throws(() => assertGitInvocationCurrentSync(invocation.handle,
    gitExactCommitInvocationBinding(f.source, f.preview, "exact message", invocation.owner)), /approval/);
});
