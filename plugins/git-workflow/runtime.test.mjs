import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionServices, createAgentSessionFromServices, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { getCurrentTools, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
const jiti = createJiti(import.meta.url);
const { gitWorkflowPlugin } = await jiti.import("./index.ts");
const { bundledPluginExtensions } = await jiti.import("../../lib/plugins/registry.ts");
const { updatePluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
async function disposeSession(session) {
  // Mirror Pi Web shutdown: dispose alone invalidates the SDK runner without
  // sending extension cleanup, leaving process-global settings listeners stale.
  try { await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }); }
  finally { session.dispose(); }
}
test("real Pi lifecycle keeps disabled sessions ordinary, enables live and withdraws tools on disable", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-plugin-runtime-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(root, "agent"); process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  execFileSync("git", ["init", "-b", "main", root], { stdio: "ignore" });
  const services = await createAgentSessionServices({ cwd: root, agentDir,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [gitWorkflowPlugin.extension(root)] } });
  const { session } = await createAgentSessionFromServices({ services, sessionManager: SessionManager.inMemory(root) });
  t.after(() => disposeSession(session));
  await session.bindExtensions({ uiContext: { notify() {} }, mode: "rpc" });
  assert.ok(session.getActiveToolNames().includes("read"));
  assert.equal(session.getAllTools().some((tool) => tool.name.startsWith("git_")), false);
  updatePluginSettings(gitWorkflowPlugin.manifest, "global", root, { enabled: true }, []);
  assert.ok(session.getActiveToolNames().includes("git_commit"));
  assert.ok(session.getAllTools().some((tool) => tool.name === "git_merge" && tool.exposure === "model-only"));
  updatePluginSettings(gitWorkflowPlugin.manifest, "global", root, { enabled: false }, []);
  assert.equal(session.getActiveToolNames().some((name) => name.startsWith("git_")), false);
  assert.ok(session.getAllTools().filter((tool) => tool.name.startsWith("git_")).every((tool) => tool.exposure === "hidden"));
  assert.ok(session.getActiveToolNames().includes("read"));
  // Malformed plugin settings also must not break core session startup.
  writeFileSync(join(agentDir, "pi-web", "plugins", "git-workflow", "settings.json"), "not JSON");
  await session.reload();
  assert.equal(session.getActiveToolNames().some((name) => name.startsWith("git_")), false);
});

test("real model-issued Git tools select repositories independently of Git and non-Git session cwds", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-plugin-cross-repo-runtime-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = join(root, "agent"); process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(root, { recursive: true, force: true }); });
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const init = (cwd, branch) => {
    git(root, "init", "-b", branch, cwd);
    git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.invalid");
    writeFileSync(join(cwd, "a"), "base a\n"); writeFileSync(join(cwd, "b"), "base b\n");
    git(cwd, "add", "."); git(cwd, "commit", "-m", "Initial"); return cwd;
  };
  const set = (cwd, values) => updatePluginSettings(gitWorkflowPlugin.manifest, "project", cwd, values, []);
  updatePluginSettings(gitWorkflowPlugin.manifest, "global", undefined, { enabled: true }, []);
  for (const kind of ["git", "non-git"]) await t.test(kind, async (st) => {
    const callerCwd = join(root, `${kind}-caller`);
    if (kind === "git") {
      init(callerCwd, "main");
      set(callerCwd, { commit: "deny", rebase: "deny", merge: "deny", createWorktree: "deny", attachWorktree: "deny", removeWorktree: "deny",
        targetBranch: "caller-only", mergeMethod: "ff-only", commitChecks: [{ name: "Caller", command: "exit 7" }], mergeChecks: [{ name: "Caller", command: "exit 7" }] });
    } else mkdirSync(callerCwd);
    const callerHead = kind === "git" ? git(callerCwd, "rev-parse", "HEAD") : null;
    const selected = init(join(root, `${kind}-selected`), "delivery");
    const linked = join(`${selected}-worktrees`, "feature");
    set(selected, { targetBranch: "delivery", mergeMethod: "non-ff", commit: "ask", merge: "ask", rebase: "allow",
      createWorktree: "allow", attachWorktree: "allow", removeWorktree: "allow",
      commitChecks: [{ name: "Selected commit", command: `test "$PWD" = '${selected}'` }], mergeChecks: [{ name: "Selected feature", command: `test "$PWD" = '${linked}'` }] });
    const faux = fauxProvider({ provider: `git-runtime-${kind}`, api: `git-runtime-${kind}` });
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
    const services = await createAgentSessionServices({ cwd: callerCwd, agentDir, modelRuntime,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" }),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        extensionFactories: [(pi) => { pi.registerProvider(faux.provider); }, ...bundledPluginExtensions(callerCwd)] } });
    const sessionManager = SessionManager.inMemory(callerCwd);
    const { session } = await createAgentSessionFromServices({ services, model: faux.getModel(), thinkingLevel: "off", sessionManager });
    st.after(() => disposeSession(session));
    let expectedCheckout; let approvals = 0; let calls = 0;
    await session.bindExtensions({ mode: "rpc", uiContext: { notify() {}, operationReceipt(_pluginId, receipt) { sessionManager.appendCustomEntry("pi-web:operation-receipt", receipt); }, pluginCard: async (id, card) => {
      assert.equal(id, "git-workflow"); assert.equal(card.fields.find((field) => field.label === "Checkout").value, expectedCheckout);
      approvals++; return "approve";
    } } });
    const toolNames = ["git_commit", "git_rebase", "git_merge", "git_worktree"];
    assert.ok(toolNames.every((name) => session.getActiveToolNames().includes(name)));
    assert.ok(session.getAllTools().filter((tool) => toolNames.includes(tool.name)).every((tool) => tool.exposure === "model-only"));
    const invoke = async (name, args) => {
      expectedCheckout = args.checkout; const id = `${kind}-${++calls}`;
      faux.setResponses([(context) => {
        assert.ok(toolNames.every((toolName) => getCurrentTools(context.messages).some((tool) => tool.name === toolName)));
        return fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
      }, fauxAssistantMessage("Done.")]);
      await session.prompt(`Execute the explicitly selected ${name} operation.`);
      const result = session.messages.find((message) => message.role === "toolResult" && message.toolCallId === id);
      assert.ok(result, `Missing ${name} result`); assert.equal(result.isError, false, JSON.stringify(result));
      assert.equal(faux.state.callCount, calls * 2); assert.equal(sessionManager.getCwd(), callerCwd);
    };
    writeFileSync(join(selected, "a"), "selected a\n"); git(selected, "add", "a");
    await invoke("git_commit", { checkout: selected, mode: "staged", message: "Cross-repository SDK commit" });
    assert.equal(git(selected, "log", "-1", "--format=%s"), "Cross-repository SDK commit");
    await invoke("git_worktree", { action: "createWorktree", checkout: selected, branch: "feature", baseBranch: "delivery", path: linked });
    writeFileSync(join(linked, "a"), "feature a\n"); git(linked, "add", "a"); git(linked, "commit", "-m", "Feature");
    writeFileSync(join(selected, "b"), "target b\n"); git(selected, "add", "b"); git(selected, "commit", "-m", "Target");
    await invoke("git_rebase", { checkout: linked, featureBranch: "feature" });
    assert.equal(git(linked, "show", "HEAD:b"), "target b");
    const targetTip = git(selected, "rev-parse", "HEAD"); const featureTip = git(linked, "rev-parse", "HEAD");
    await invoke("git_merge", { checkout: selected, featureBranch: "feature" });
    assert.equal(git(selected, "show", "-s", "--format=%P", "HEAD"), `${targetTip} ${featureTip}`);
    await invoke("git_worktree", { action: "removeWorktree", checkout: selected, path: linked });
    assert.equal(existsSync(linked), false); assert.equal(git(selected, "rev-parse", "refs/heads/feature"), featureTip);
    await invoke("git_worktree", { action: "attachWorktree", checkout: selected, branch: "feature", baseBranch: "feature", path: linked });
    assert.equal(git(linked, "rev-parse", "HEAD"), featureTip);
    updatePluginSettings(gitWorkflowPlugin.manifest, "global", undefined, { enabled: false }, []);
    assert.equal(session.getActiveToolNames().some((name) => name.startsWith("git_")), false);
    updatePluginSettings(gitWorkflowPlugin.manifest, "global", undefined, { enabled: true }, []);
    const next = init(join(root, `${kind}-next-selected`), "main");
    writeFileSync(join(next, "a"), "next selected a\n"); git(next, "add", "a");
    await invoke("git_commit", { checkout: next, mode: "staged", message: "Independent next selection" });
    assert.equal(git(next, "log", "-1", "--format=%s"), "Independent next selection");
    assert.equal(git(selected, "show", "-s", "--format=%P", "HEAD"), `${targetTip} ${featureTip}`);
    assert.equal(approvals, 3);
    if (kind === "git") { assert.equal(git(callerCwd, "rev-parse", "HEAD"), callerHead); assert.equal(git(callerCwd, "status", "--porcelain"), ""); }
    else assert.equal(existsSync(join(callerCwd, ".git")), false);
  });
});
