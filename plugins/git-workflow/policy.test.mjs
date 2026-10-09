import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
const jiti = createJiti(import.meta.url);
const { gitWorkflowManifest: manifest, workflowDefaults, workflowPresets } = await jiti.import("./manifest.ts");
const { gitPolicy } = await jiti.import("./policy.ts");
const { gitWorkflowPlugin } = await jiti.import("./index.ts");
const { updatePluginSettings, readPluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
const { executeGitOperation: executeWithReceipts } = await jiti.import("./server.ts");
const { preparePluginReview } = await jiti.import("../../lib/plugins/review-store.ts");
const { snapshotOperationReceipt } = await jiti.import("../../lib/operation-receipts.ts");
const executeGitOperation = (cwd, op, ui, ...rest) => executeWithReceipts(cwd, op, { prepareReview: preparePluginReview, operationReceipt(id, receipt) { snapshotOperationReceipt(id, receipt, 1); }, ...ui }, ...rest);
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-git-policy-")), agentDir = join(root, "agent");
  mkdirSync(agentDir);
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const init = (name) => {
    const cwd = join(root, name); git(root, "init", "-b", "main", cwd);
    git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.invalid");
    writeFileSync(join(cwd, "a"), "base\n"); git(cwd, "add", "."); git(cwd, "commit", "-m", "Initial"); return cwd;
  };
  const own = init("own"), other = init("other");
  const session = { id: "55555555-5555-4555-8555-555555555555", cwd: own };
  const set = (scope, values, cwd = own) => updatePluginSettings(manifest, scope, cwd, values, [], undefined, session);
  set("global", { enabled: true });
  return { root, agentDir, own, other, session, set };
}
test("every workflow choice supports ask; presets only replace workflow intent", (t) => {
  const { own, session, set } = fixture(t);
  set("project", { commit: "deny", merge: "ask", targetBranch: "main", commitChecks: [{ name: "Required", command: "true" }] });
  for (const field of Object.keys(workflowDefaults)) {
    assert.equal(manifest.fields[field].default, "ask");
    assert.ok(manifest.fields[field].options.includes("ask"));
  }
  for (const preset of Object.values(workflowPresets)) {
    assert.deepEqual(Object.keys(preset.values).sort(), Object.keys(workflowDefaults).sort());
    set("session", preset.values);
    const result = gitPolicy(own, session);
    assert.equal(result.effective.commit, "deny"); assert.equal(result.effective.merge, "ask");
    assert.equal(result.effective.targetBranch, "main"); assert.deepEqual(result.effective.commitChecks, [{ name: "Required", command: "true" }]);
  }
});
test("own session Allow never overrides foreign Ask or Deny, and relevant saves cancel pending approvals", async (t) => {
  const { own, other, session, set } = fixture(t);
  set("session", { commit: "allow", commitChecks: [{ name: "Own only", command: "exit 7" }] });
  writeFileSync(join(other, "a"), "foreign\n");
  const op = { action: "commit", checkout: other, mode: "files", files: ["a"], message: "Foreign" };
  let approvals = 0;
  const result = await executeGitOperation(own, op, { pluginCard: async (_id, _card, signal) => {
    approvals++;
    set("session", { commit: "deny" });
    assert.equal(signal.aborted, false, "unrelated own-project settings do not cancel foreign approval");
    return "approve";
  } }, undefined, session);
  assert.notEqual(result.isError, true, result.content[0].text); assert.equal(approvals, 1);
  set("project", { commit: "deny" }, other); set("session", { commit: "allow" });
  writeFileSync(join(other, "a"), "foreign again\n");
  assert.equal((await executeGitOperation(own, op, { pluginCard: () => assert.fail("UI on foreign deny") }, undefined, session)).isError, true);
  set("session", { commit: "ask", commitChecks: [] }); writeFileSync(join(own, "a"), "own\n");
  const cancelled = await executeGitOperation(own, { ...op, checkout: own }, { pluginCard: async (_id, _card, signal) => {
    set("session", { commit: "deny" }); assert.equal(signal.aborted, true); return "approve";
  } }, undefined, session);
  assert.equal(cancelled.isError, true); assert.equal(git(own, "log", "-1", "--format=%s"), "Initial");
});
test("Ask target/method choices are per invocation, not settings writes", async (t) => {
  const { own, session, set, root } = fixture(t);
  const linked = join(root, "feature"); git(own, "worktree", "add", "-b", "feature", linked);
  writeFileSync(join(linked, "a"), "feature\n"); git(linked, "add", "."); git(linked, "commit", "-m", "Feature");
  set("project", { merge: "allow", targetBranch: null, mergeMethod: "non-ff" });
  const result = await executeGitOperation(own, { action: "merge", checkout: own, featureBranch: "feature", targetBranch: "main", mergeMethod: "ff-only" }, {}, undefined, session);
  assert.notEqual(result.isError, true, result.content[0].text);
  assert.equal(git(own, "rev-parse", "HEAD"), git(linked, "rev-parse", "HEAD"));
  assert.equal(readPluginSettings(manifest, own).effective.targetBranch, null);
  set("project", { targetSelection: "configured", targetBranch: null, rebase: "allow" });
  const missing = await executeGitOperation(own, { action: "rebase", checkout: linked, featureBranch: "feature", targetBranch: "main" }, {}, undefined, session);
  assert.notEqual(missing.isError, true, missing.content[0].text);
  assert.equal(readPluginSettings(manifest, own).effective.targetBranch, null);
  set("project", { targetSelection: "configured", targetBranch: "other" });
  assert.equal((await executeGitOperation(own, { action: "merge", checkout: own, featureBranch: "feature", targetBranch: "main" }, {}, undefined, session)).isError, true);
});
test("SDK request context and read-only policy tool use the real session and refresh without transcript persistence", async (t) => {
  const { own, other, agentDir } = fixture(t);
  const sessionManager = SessionManager.inMemory(own), identity = { id: sessionManager.getSessionId(), cwd: own };
  updatePluginSettings(manifest, "session", own, { workspace: "current-branch", commit: "allow" }, [], undefined, identity);
  updatePluginSettings(manifest, "project", other, { commit: "deny" }, []);
  const faux = fauxProvider({ provider: "git-policy-test", api: "git-policy-test" });
  const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
  const services = await createAgentSessionServices({ cwd: own, agentDir, modelRuntime,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" }),
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [(pi) => pi.registerProvider(faux.provider), gitWorkflowPlugin.extension(own)] } });
  const { session } = await createAgentSessionFromServices({ services, model: faux.getModel(), thinkingLevel: "off", sessionManager });
  t.after(async () => { try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); } finally { session.dispose(); } });
  await session.bindExtensions({ mode: "rpc", uiContext: { notify() {} } });
  faux.setResponses([(context) => {
    const text = JSON.stringify(context.messages);
    assert.match(text, /pi-web:git-policy\/v1/); assert.match(text, /current-branch/); assert.match(text, /ask_user/);
    return fauxAssistantMessage([fauxToolCall("git_policy", { checkout: other }, { id: "policy-foreign" })], { stopReason: "toolUse" });
  }, fauxAssistantMessage("Done.")]);
  await session.prompt("Inspect the foreign repository policy.");
  const result = session.messages.find((m) => m.role === "toolResult" && m.toolCallId === "policy-foreign");
  assert.equal(result.isError, false); assert.equal(result.details.effective.commit, "deny");
  assert.equal(result.details.sessionOverridesApply, false);
  assert.equal(sessionManager.getEntries().some((e) => e.message?.customType?.startsWith("pi-web:plugin-policy:")), false);
  updatePluginSettings(manifest, "session", own, { workspace: "worktree" }, [], undefined, identity);
  faux.setResponses([(context) => {
    const policyMessages = context.messages.filter((m) => JSON.stringify(m).includes("Current harness Git policy"));
    assert.equal(policyMessages.length, 1); assert.match(JSON.stringify(policyMessages), /workspace\\\":\\\"worktree|"workspace":"worktree"/);
    return fauxAssistantMessage("Updated.");
  }]);
  await session.prompt("Check current policy.");
});
