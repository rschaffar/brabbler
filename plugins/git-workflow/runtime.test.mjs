import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs, { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { setImmediate as afterMessageEndMicrotasks } from "node:timers/promises";
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
const { AgentSessionWrapper } = await jiti.import("../../lib/rpc-manager.ts");
const { findOperationReview } = await jiti.import("../../lib/plugins/review-metadata.ts");
const { updatePluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
async function disposeSession(session) {
  // Mirror Brabbler shutdown: dispose alone invalidates the SDK runner without
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
  assert.deepEqual(session.getAllTools().filter((tool) => tool.name.startsWith("git_")).map((tool) => tool.name).sort(),
    ["git_cleanup", "git_commit", "git_merge", "git_policy", "git_rebase", "git_worktree"]);
  assert.equal(session.getAllTools().some((tool) => /discard/.test(tool.name)), false);
  updatePluginSettings(gitWorkflowPlugin.manifest, "global", root, { enabled: false }, []);
  assert.equal(session.getActiveToolNames().some((name) => name.startsWith("git_")), false);
  assert.ok(session.getAllTools().filter((tool) => tool.name.startsWith("git_")).every((tool) => tool.exposure === "hidden"));
  assert.ok(session.getActiveToolNames().includes("read"));
  // Malformed plugin settings also must not break core session startup.
  writeFileSync(join(agentDir, "brabbler", "plugins", "git-workflow", "settings.json"), "not JSON");
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
    const sessionManager = SessionManager.create(callerCwd, join(root, `sessions-${kind}`));
    const { session } = await createAgentSessionFromServices({ services, model: faux.getModel(), thinkingLevel: "off", sessionManager });
    const wrapper = new AgentSessionWrapper(session);
    st.after(() => wrapper.shutdown());
    const hostUi = wrapper.createExtensionUiContext(), events = [];
    wrapper.onEvent(event => events.push(event));
    let expectedCheckout; let approvals = 0; let calls = 0;
    await session.bindExtensions({ mode: "rpc", uiContext: { ...hostUi, pluginCard: async (id, card, signal) => {
      assert.equal(id, "git-workflow"); assert.equal(card.fields.find((field) => field.label === "Checkout").value, expectedCheckout);
      const saved = SessionManager.open(sessionManager.getSessionFile());
      assert.ok(findOperationReview(saved.getEntries(), id, card.review, saved.getLeafId()), "metadata is durable before live card publication");
      approvals++;
      const waiting = hostUi.pluginCard(id, card, signal);
      const request = events.findLast(event => event.type === "extension_ui_request" && event.method === "plugin_card");
      assert.ok(request);
      await wrapper.send({ type: "extension_ui_response", id: request.id, action: "approve" });
      return waiting;
    } } });
    const toolNames = ["git_commit", "git_rebase", "git_merge", "git_worktree"];
    assert.ok(toolNames.every((name) => session.getActiveToolNames().includes(name)));
    assert.ok(session.getAllTools().filter((tool) => toolNames.includes(tool.name)).every((tool) => tool.exposure === "model-only"));
    const invoke = async (name, args) => {
      expectedCheckout = args.checkout; const id = `${kind}-${++calls}`;
      let tools, providerReport;
      faux.setResponses([(context) => {
        tools = getCurrentTools(context.messages);
        return fauxAssistantMessage([fauxToolCall(name, args, { id })], { stopReason: "toolUse" });
      }, (context) => {
        if (["git_commit", "git_rebase", "git_merge"].includes(name)) {
          const result = context.messages.find(message => message.role === "toolResult" && message.toolCallId === id);
          assert.ok(result, "next provider request contains the corresponding tool result");
          const text = result.content.filter(block => block.type === "text").map(block => block.text).join("\n");
          const line = text.split("\n").find(line => line.startsWith("Postflight report: "));
          assert.ok(line, "model-visible content, not details/custom receipts, carries the report");
          providerReport = JSON.parse(line.slice("Postflight report: ".length));
          assert.equal(providerReport.verification, "verified");
          assert.match(providerReport.scope, /Selected local refs/);
          assert.equal(providerReport.checkouts.some(checkout => checkout.path === args.checkout), true);
          assert.equal(providerReport.commit.oid, git(args.checkout, "rev-parse", "HEAD"));
        }
        return fauxAssistantMessage("Done.");
      }]);
      await session.prompt(`Execute the explicitly selected ${name} operation.`);
      assert.ok(toolNames.every((toolName) => tools.some((tool) => tool.name === toolName)));
      const rebase = tools.find((tool) => tool.name === "git_rebase");
      const merge = tools.find((tool) => tool.name === "git_merge");
      assert.match(rebase.parameters.properties.checkout.description, /feature branch.*not the target/i);
      assert.match(merge.parameters.properties.checkout.description, /target branch.*not the feature/i);
      assert.match(merge.description, /git worktree list --porcelain/);
      assert.match(merge.description, /do not reuse.*rebase checkout/i);
      assert.match(merge.description, /or switch the feature worktree to the target/);
      const result = session.messages.find((message) => message.role === "toolResult" && message.toolCallId === id);
      assert.ok(result, `Missing ${name} result`); assert.equal(result.isError, false, JSON.stringify(result));
      if (providerReport) {
        assert.deepEqual(result.details.postflight, providerReport);
        const receipt = sessionManager.getEntries().findLast(entry => entry.customType === "brabbler:operation-receipt" && entry.data.toolCallId === id);
        assert.ok(receipt.data.summary.includes(JSON.stringify(providerReport)), "durable summary uses the same report");
      }
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

test("real SDK continuation and live history quarantine a failed terminal tail after memory mutation", async t => {
  for (const fault of ["append", "barrier"]) await t.test(fault, async st => {
    const root = mkdtempSync(join(tmpdir(), "pi-git-host-reporting-")), agentDir = join(root, "agent"), cwd = join(root, "repo");
    mkdirSync(cwd);
    const previous = process.env.PI_CODING_AGENT_DIR, registry = globalThis.__piSessions;
    process.env.PI_CODING_AGENT_DIR = agentDir; globalThis.__piSessions = new Map();
    let wrapper, manager, promptWork, injected = false, rejectedId, originalPrefix, toolResult, attempts = 0;
    const restore = [];
    st.after(async () => {
      try {
        await Promise.allSettled([promptWork]);
        // Join the already-scheduled synchronous message_end microtasks before
        // teardown can hide them behind the wrapper's not-alive guard.
        await afterMessageEndMicrotasks();
        await wrapper?.shutdown();
      } finally {
        for (const undo of restore.reverse()) undo(); syncBuiltinESMExports();
        globalThis.__piSessions = registry;
        if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
        rmSync(root, { recursive: true, force: true });
      }
    });
    const append = fs.appendFileSync, fsync = fs.fsyncSync;
    const witness = () => {
      const entry = manager.getEntries().at(-1);
      assert.equal(entry.customType, "brabbler:operation-receipt"); assert.equal(entry.data.phase, "succeeded");
      assert.equal(manager.getLeafId(), entry.id, "real SDK memory advanced before filesystem fault");
      rejectedId = entry.id; injected = true;
    };
    const appendMock = st.mock.method(fs, "appendFileSync", (path, data, ...args) => {
      if (manager && path === manager.getSessionFile()) {
        const entry = JSON.parse(String(data));
        if (entry.customType === "brabbler:operation-receipt" && entry.data.phase === "succeeded" && !injected) {
          originalPrefix = readFileSync(path);
          if (fault === "append") { witness(); throw Object.assign(new Error("terminal disk append EIO"), { code: "EIO" }); }
        }
      }
      return append(path, data, ...args);
    });
    const fsyncMock = st.mock.method(fs, "fsyncSync", fd => {
      if (fault === "barrier" && originalPrefix && !injected && fs.fstatSync(fd).ino === statSync(manager.getSessionFile()).ino) {
        witness(); throw Object.assign(new Error("terminal save barrier EIO"), { code: "EIO" });
      }
      return fsync(fd);
    });
    restore.push(() => appendMock.mock.restore(), () => fsyncMock.mock.restore()); syncBuiltinESMExports();
    // Bind the real host to the faulted native export, not a pre-append UI double.
    const loader = createJiti(import.meta.url, { tsconfigPaths: true, fsCache: false, moduleCache: false });
    const { AgentSessionWrapper: Wrapper, getRpcSessionInfos } = await loader.import("../../lib/rpc-manager.ts");
    const { gitWorkflowPlugin: plugin } = await loader.import("./index.ts");
    const { updatePluginSettings: set } = await loader.import("../../lib/plugins/settings.ts");
    const history = await loader.import("../../app/api/sessions/[id]/route.ts");
    const context = await loader.import("../../app/api/sessions/[id]/context/route.ts");
    const git = (...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-qb", "main"); git("config", "user.name", "Test"); git("config", "user.email", "test@example.invalid");
    writeFileSync(join(cwd, "source"), "base\n"); git("add", "source"); git("commit", "-qm", "Base");
    writeFileSync(join(cwd, "source"), "candidate\n");
    set(plugin.manifest, "global", cwd, { enabled: true, commit: "allow", commitChecks: [] }, []);
    const faux = fauxProvider({ provider: `git-failed-tail-${fault}`, api: `git-failed-tail-${fault}` });
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false });
    const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime,
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: "off" }),
      resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
        extensionFactories: [pi => pi.registerProvider(faux.provider), plugin.extension(cwd)] } });
    manager = SessionManager.create(cwd, join(root, "sessions"));
    manager.appendMessage({ role: "user", content: "Unrelated retained history", timestamp: Date.now() });
    manager.appendMessage(fauxAssistantMessage("Retained earlier response."));
    const { session } = await createAgentSessionFromServices({ services, model: faux.getModel(), thinkingLevel: "off", sessionManager: manager });
    const priorIds = manager.getEntries().map(entry => entry.id), prefix = readFileSync(manager.getSessionFile());
    wrapper = new Wrapper(session); globalThis.__piSessions.set(session.sessionId, wrapper);
    const ui = wrapper.createExtensionUiContext(), receipt = ui.operationReceipt, events = [];
    let completedNotifications = 0;
    wrapper.onAgentRunComplete = () => { completedNotifications++; };
    wrapper.onEvent(event => events.push(event));
    wrapper.start(); // Actual production SDK subscription, including deferred readers.
    let observedContinuation = false;
    await session.bindExtensions({ mode: "rpc", uiContext: { ...ui, operationReceipt(...args) {
      try { return receipt(...args); }
      finally {
        if (injected && !observedContinuation) {
          observedContinuation = true;
          const containedAppend = manager.appendMessage.bind(manager);
          manager.appendMessage = message => {
            if (message.role === "toolResult") { attempts++; toolResult = message; }
            return containedAppend(message);
          };
        }
      }
    } } });
    faux.setResponses([fauxAssistantMessage([fauxToolCall("git_commit", { checkout: cwd, mode: "files", files: ["source"], message: "Once only" }, { id: `fault-${fault}` })], { stopReason: "toolUse" }),
      () => assert.fail("Unexpected provider continuation after unsafe storage failure")]);
    promptWork = session.prompt("Execute the selected commit once.");
    await assert.rejects(promptWork, /quarantined/);
    // SDK message_end deferred readers have now had their event turn. This is
    // not a universal I/O idle assertion or an uncaught-exception suppressor.
    await afterMessageEndMicrotasks();
    assert.equal(injected, true); assert.equal(attempts, 1, "real SDK attempts tool-result continuation after one-shot filesystem fault clears");
    assert.equal(toolResult.isError, true); assert.equal(toolResult.details.completed, true); assert.equal(toolResult.details.receiptPersisted, false);
    assert.equal(toolResult.details.postflight.verification, "verified"); assert.match(toolResult.content[0].text, /Do not repeat/);
    const liveToolResult = events.find(event => event.type === "message_end" && event.message === toolResult);
    assert.ok(liveToolResult, "started wrapper forwards the actual completed/reporting-error result");
    assert.equal(Object.hasOwn(liveToolResult, "entryId"), false, "refused SDK append has no saved entry binding");
    assert.equal(completedNotifications, 0, "uncertain persistence does not emit normal completion");
    assert.equal(git("rev-list", "--count", "HEAD"), "2", "one native commit, never retried");
    for (const route of [history, context]) {
      const response = await route.GET(new Request(`http://localhost/api/sessions/${session.sessionId}`), { params: Promise.resolve({ id: session.sessionId }) });
      const body = await response.json(); assert.equal(response.status, 500); assert.match(body.error, /quarantined/);
      assert.equal(Object.hasOwn(body, "context"), false, "live history cannot publish rejected SDK memory as saved context");
    }
    assert.throws(() => manager.getEntries(), /quarantined/);
    assert.deepEqual(getRpcSessionInfos(), [], "rejected memory supplies no live catalogue data and cannot poison other history reads");
    assert.equal(events.some(event => event.type === "operation_receipt" && event.entry.data.phase === "succeeded"), false);
    const bytes = readFileSync(manager.getSessionFile()); assert.equal(bytes.subarray(0, prefix.length).equals(prefix), true, "unrelated saved history is never discarded");
    if (fault === "append") assert.equal(bytes.equals(originalPrefix), true, "containment refuses before an orphaning SDK append");
    const reopened = SessionManager.open(manager.getSessionFile()), entries = reopened.getEntries(), ids = new Set(entries.map(entry => entry.id));
    for (const entry of entries) assert.equal(entry.parentId === null || ids.has(entry.parentId), true, "reopened parent chain is sound");
    for (const id of priorIds) assert.equal(ids.has(id), true);
    assert.equal(entries.some(entry => entry.type === "message" && entry.message.role === "toolResult"), false, "refused continuation never writes an orphan");
    const reviews = entries.filter(entry => entry.customType === "brabbler:operation-review");
    assert.deepEqual(reviews.map(entry => entry.data.payload.kind), ["proposal", "settlement"]);
    assert.equal(reviews[1].data.payload.result.commit, git("rev-parse", "HEAD"));
    if (fault === "append") {
      assert.equal(ids.has(rejectedId), false);
      const latest = entries.findLast(entry => entry.customType === "brabbler:operation-receipt");
      assert.equal(latest.data.phase, "executing"); assert.equal(latest.data.card.review.id, reviews[0].data.id);
    } else assert.equal(ids.has(rejectedId), true, "a failed barrier can leave bytes; their presence must NOT override host refusal/reporting evidence");
  });
});
