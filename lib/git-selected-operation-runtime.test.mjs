import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFileSync, statSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(path.join(os.tmpdir(), "selected-operation-runtime-"));
const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
const oldGitGlobal = process.env.GIT_CONFIG_GLOBAL, oldGitSystem = process.env.GIT_CONFIG_NOSYSTEM;
const oldHome = process.env.HOME, oldXdg = process.env.XDG_CONFIG_HOME;
process.env.HOME = path.join(root, "home"); process.env.XDG_CONFIG_HOME = path.join(root, "xdg");
await mkdir(process.env.HOME); await mkdir(process.env.XDG_CONFIG_HOME);
process.env.GIT_CONFIG_GLOBAL = "/dev/null"; process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.PI_CODING_AGENT_DIR = path.join(root, "agent");
await mkdir(process.env.PI_CODING_AGENT_DIR, { mode: 0o700 });
await mkdir(path.join(process.env.PI_CODING_AGENT_DIR, "sessions"));
after(async () => { if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  if (oldGitGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = oldGitGlobal;
  if (oldGitSystem === undefined) delete process.env.GIT_CONFIG_NOSYSTEM; else process.env.GIT_CONFIG_NOSYSTEM = oldGitSystem;
  if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
  if (oldXdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldXdg;
  await rm(root, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url, { interopDefault: false });
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { writeGitWorkflowSettingsDocument } = await jiti.import("./git-workflow-settings-store.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const { createGitSelectedOperationRuntime, readSelectedRuntimeCurrent, readSelectedRuntimePreparationOrdering } = await jiti.import("./git-selected-operation-runtime.ts");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { createAgentGitWorkflowExtension } = await jiti.import("./agent-git-workflow-extension.ts");
const { createGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const { snapshotFreshManagedSessionGitWorkflow } = await jiti.import("./git-workflow-session.ts");
const { appendSessionGitWorkflow, readSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { readGitAction } = await jiti.import("./git-action-journal.ts");
const selectedNative = await jiti.import("./git-selected-integration.ts");
const preparationNative = await jiti.import("./git-preparation-apply.ts");
const workspaceNative = await jiti.import("./git-workspace-operation.ts");
const terminalNative = await jiti.import("./terminal-manager.ts"), actualTerminalUsage = terminalNative.readTerminalWorkspaceUsage;
const checkoutNative = await jiti.import("./git-checkout-verification.ts"), runCheck = checkoutNative.runGitCheckoutVerification;
function nativeChecks(t, observe = async () => {}, afterJournal = async () => {}) {
  // Real parked launcher/process/cwd measurement. Unit accounting is explicitly
  // node-test-simulated (no OS containment/escaped-descendant capability claim).
  const units = new Map(), stopped = new Set();
  const backend = {
    async absent(unit) { return !units.has(unit); },
    start(options) {
      const state = { invocation: randomUUID().replaceAll("-", ""), cwd: options.workingDirectory, done: false, code: null, output() {} };
      const child = spawn(process.execPath, ["-e", `process.send('ready');process.on('message',p=>{const c=require('child_process').spawn(p.argv[0],p.argv.slice(1),{env:p.env,cwd:process.cwd(),stdio:['ignore','inherit','inherit']});c.on('error',()=>process.exit(125));c.on('close',code=>process.exit(code??125));});`],
        { cwd: options.workingDirectory, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
      state.child = child; state.closed = new Promise((resolve) => child.once("close", (code) => { state.done = true; state.code = code ?? 125; resolve(); }));
      child.stdout.on("data", (data) => state.output(data)); child.stderr.on("data", (data) => state.output(data));
      const started = new Promise((resolve, reject) => { child.once("error", reject); child.once("message", () => {
        const proc = statSync(`/proc/${child.pid}`, { bigint: true }), text = readFileSync(`/proc/${child.pid}/stat`, "utf8");
        state.launcher = `${child.pid}:${text.slice(text.lastIndexOf(')') + 2).trim().split(/\s+/)[19]}:${proc.dev}:${proc.ino}`; resolve();
      }); });
      units.set(options.unit, state);
      return { started, release(payload) { child.send(JSON.parse(payload)); }, closeInput() {}, dispose() {}, output(callback) { state.output = callback; } };
    },
    async observe(name) {
      const state = units.get(name); if (!state) throw new Error("simulated unit absent");
      const unit = { Id: name, LoadState: "loaded", ControlGroup: `/test/${name}`, MainPID: state.done ? "0" : String(state.child.pid),
        ActiveState: "active", SubState: state.done ? "exited" : "running", Result: "success", ExecMainCode: "1", ExecMainStatus: String(state.code ?? 0),
        Delegate: "no", KillMode: "control-group", RemainAfterExit: "yes", Restart: "no", InvocationID: state.invocation };
      return { identity: `1:2:${state.invocation}:${unit.ControlGroup}`, populated: !state.done, launcherPlaced: !state.done, launcherIdentity: state.launcher, unit };
    },
    assertLauncherCwd(name, observation, expected) {
      const state = units.get(name); assert.equal(observation.launcherIdentity, state.launcher);
      const s = statSync(`/proc/${state.child.pid}/cwd`, { bigint: true });
      assert.equal(realpathSync(`/proc/${state.child.pid}/cwd`), realpathSync(state.cwd));
      assert.deepEqual({ device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) }, expected);
    },
    async stop(name) { const state = units.get(name); if (!state.done) process.kill(-state.child.pid, "SIGKILL"); await state.closed;
      stopped.add(`${name}:${state.invocation}`); units.delete(name); },
    async terminal(name, invocation) { return stopped.has(`${name}:${invocation}`); },
    async originalEmpty(name, _identity, invocation) { return stopped.has(`${name}:${invocation}`) ? "pinned-populated-zero" : undefined; },
  };
  const mock = t.mock.method(checkoutNative, "runGitCheckoutVerification", (options) => runCheck({ ...options,
    testContainmentBackend: backend, testRecoveryEvidence: true, timeoutMs: 30000,
    onExecution: async (row) => { if (process.env.SELECTED_RUNTIME_NATIVE_DEBUG) t.diagnostic(JSON.stringify(row)); await observe(row, options); const result = await options.onExecution(row); await afterJournal(row); return result; } }));
  return { ...backend, mock: mock.mock };
}
const actions = await jiti.import("./git-action-controller.ts");
const { createGitSelectedOperationRegistry } = await jiti.import("./git-selected-operation-registry.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } })).stdout.trim();
let count = 0;
async function fixture(t, { diverge = false, method = "ff", delivery = "local", checks = [], gitCaller = false, managed = false, legacySource = false, cleanupConfirmation = "disabled", cleanup = "retain", quietTestTerminals = false } = {}) {
  if (process.env.SELECTED_RUNTIME_NATIVE_DEBUG) {
    const workspace = await jiti.import("./git-workspace-operation.ts"), apply = workspace.applyGitWorkspaceOperationWithAuthority;
    t.mock.method(workspace, "applyGitWorkspaceOperationWithAuthority", async (options) => { try { return await apply(options); } catch (e) { t.diagnostic(e.stack); t.diagnostic(String(JSON.stringify(e.facts))); t.diagnostic(e.cause?.stack ?? ""); throw e; } });
    const journal = await jiti.import("./git-action-journal.ts"), transition = journal.transitionGitAction;
    t.mock.method(journal, "transitionGitAction", async (...args) => { try { return await transition(...args); } catch (e) { t.diagnostic(String(e.stack)); throw e; } });
    const finish = actions.finishVerifiedNativeGitAction;
    t.mock.method(actions, "finishVerifiedNativeGitAction", async (...args) => { try { return await finish(...args); } catch (e) { t.diagnostic(e.stack); throw e; } });
    const cleanup = await jiti.import("./git-cleanup-operation.ts"), createCleanup = cleanup.createGitCleanupEngineWithAuthority;
    t.mock.method(cleanup, "createGitCleanupEngineWithAuthority", (adapters) => { const engine = createCleanup(adapters); return { ...engine,
      async capture(...args) { try { return await engine.capture(...args); } catch (e) { t.diagnostic(e.stack); throw e; } },
      async apply(...args) { try { return await engine.apply(...args); } catch (e) { t.diagnostic(e.stack); t.diagnostic(String(JSON.stringify(e.facts))); throw e; } } }; });
    const native = await jiti.import("./git-selected-integration.ts"), prepare = native.prepareSelectedIntegration;
    t.mock.method(native, "prepareSelectedIntegration", async (...args) => { try { return await prepare(...args); } catch (e) { t.diagnostic(e.stack ?? String(e)); throw e; } });
  }
  const dir = path.join(root, `fixture-${++count}`), chat = path.join(dir, "chat"), repo = path.join(dir, "B"), source = path.join(dir, "feature");
  await mkdir(dir); await mkdir(chat); await mkdir(repo); allowFileRoot(dir);
  await git(repo, "init", "-q", "-b", "main"); await git(repo, "config", "user.name", "Fixture"); await git(repo, "config", "user.email", "fixture@example.invalid");
  await writeFile(path.join(repo, "base"), "base\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "base");
  await git(repo, "worktree", "add", "-qb", "feature", source);
  await writeFile(path.join(source, "feature-file"), "feature\n"); await git(source, "add", "."); await git(source, "commit", "-qm", "feature");
  if (diverge) { await writeFile(path.join(repo, "main-file"), "main\n"); await git(repo, "add", "."); await git(repo, "commit", "-qm", "main advances"); }
  if (gitCaller) {
    await git(chat, "init", "-q", "-b", "caller"); await git(chat, "config", "user.name", "Fixture"); await git(chat, "config", "user.email", "fixture@example.invalid");
    await writeFile(path.join(chat, "caller-only"), "A\n"); await git(chat, "add", "."); await git(chat, "commit", "-qm", "A");
  }
  const callerCwd = legacySource ? source : chat;
  const manager = SessionManager.create(callerCwd, path.join(process.env.PI_CODING_AGENT_DIR, "sessions", `fixture-${count}`));
  if (quietTestTerminals) {
    // Explicit isolated test backend only. The production terminal producer is
    // deliberately unknown and MUST NOT infer safety from an empty registry.
    t.mock.method(terminalNative, "readTerminalWorkspaceUsage", () => ({ known: true, entries: [] }));
  } else t.mock.method(terminalNative, "readTerminalWorkspaceUsage", actualTerminalUsage);
  if (managed) snapshotFreshManagedSessionGitWorkflow(manager, { ...DEFAULT_GIT_WORKFLOW_SETTINGS, enabled: true });
  if (legacySource) appendSessionGitWorkflow(manager, { mode: "current", onCreate: "stay", commits: "agent" });
  manager.appendMessage({ role: "user", content: "Work on B without moving this chat", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true }, projects: { [repo]: {
    enabled: true, mainBranch: "main", targetBranch: "main", method, delivery, prepareConfirmation: "ask", integrateConfirmation: "ask", checkConfirmation: "ask", cleanupConfirmation, cleanup, checks,
  } } });
  const asks = [], ctx = { cwd: callerCwd, sessionManager: manager, hasUI: true, ui: { gitAction: async (c) => { asks.push(c); return true; } } };
  let active = ["read", "edit"], cancel = false, selectionRevision = 1;
  const trustedRuntime = { readSelectionRevisionSync: () => `fixture-writer:${selectionRevision}` };
  const runtimeContext = { ...trustedRuntime, sessionCwd: callerCwd, manager, effectiveTools: () => active, appendEntry: (type, data) => manager.appendCustomEntry(type, data), ask: ctx.ui.gitAction, isCancelled: () => cancel };
  const runtime = createGitSelectedOperationRuntime(runtimeContext);
  t.after(() => runtime.dispose());
  const selection = await selectGitProjectResources(repo, "feature", source), target = { repositoryPath: repo, checkoutPath: repo, workspaceBranch: "main" };
  const selector = { repositoryPath: repo, checkoutPath: source, workspaceBranch: "feature" };
  const tools = new Map();
  const bootstrap = { registerTool: (tool) => tools.set(tool.name, tool), getActiveTools: () => active, appendEntry: runtimeContext.appendEntry };
  createAgentGitWorkflowExtension(callerCwd, undefined, undefined, trustedRuntime).factory(bootstrap);
  createGitCommitExtension(callerCwd, () => readSessionGitWorkflow(manager.getEntries()), trustedRuntime).factory(bootstrap);
  return { dir, chat, repo, source, manager, runtime, asks, ctx, selector, target, selection, trustedRuntime, tool: tools.get("git_workflow"), commitTool: tools.get("git_commit"),
    setTools: (tools) => { selectionRevision++; active = tools; }, cancel: () => { selectionRevision++; cancel = true; } };
}

async function cleanupFixture(t, { method = "ff", cleanupConfirmation = "ask", quietTestTerminals = true, ignored = false } = {}) {
  const f = await fixture(t, { method, cleanupConfirmation, cleanup: "worktree-and-branch", quietTestTerminals });
  const destination = path.join(`${f.repo}-worktrees`, "cleanup-feature"), base = await git(f.repo, "rev-parse", "HEAD");
  const created = await f.runtime.run("workspace", { selector: f.target, workspace: { repositoryPath: f.repo,
    sourceCheckoutPath: f.repo, destinationPath: destination, branch: "cleanup-feature", baseBranch: "main", expectedBaseOid: base, mode: "create" } });
  assert.equal(created.status, "completed", JSON.stringify(created));
  await writeFile(path.join(destination, "cleanup-feature-file"), "actual feature bytes\n");
  if (ignored) await writeFile(path.join(destination, ".gitignore"), "cache.bin\n");
  await git(destination, "add", "."); await git(destination, "commit", "-qm", "cleanup feature");
  if (ignored) await writeFile(path.join(destination, "cache.bin"), "explicitly ignored fixture data\n");
  if (method === "merge") { await writeFile(path.join(f.repo, "main-advance"), "divergence\n"); await git(f.repo, "add", "."); await git(f.repo, "commit", "-qm", "main divergence"); }
  const selector = { repositoryPath: f.repo, checkoutPath: destination, workspaceBranch: "cleanup-feature" };
  let revisionDependency;
  if (method === "merge") {
    const prepared = await f.runtime.run("prepare", { selector, target: f.target });
    assert.equal(prepared.status, "completed", JSON.stringify(prepared)); revisionDependency = prepared.revisionDependency;
  }
  const integrated = await f.runtime.run("integrate", { selector, target: f.target, ...(revisionDependency ? { revisionDependency } : {}) });
  assert.equal(integrated.status, "completed", JSON.stringify(integrated));
  return { ...f, destination, selector, integrated };
}

async function publicContenders(t, size, confirmation) {
  const checks = [{ label: "explicit optional contender check", argv: [process.execPath, "-e", "process.stdout.write('measured contender check\\n')"], requiredStage: "none" }];
  const f = await fixture(t, { checks });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true }, projects: { [f.repo]: {
    enabled: true, mainBranch: "main", targetBranch: "main", method: "ff", delivery: "local", checks,
    workspaceConfirmation: confirmation, prepareConfirmation: confirmation, checkConfirmation: confirmation, integrateConfirmation: confirmation,
  } } });
  if (confirmation === "none") {
    const project = await selectGitProjectResources(f.repo);
    for (const action of ["workspace", "prepare", "checks", "integration"])
      await saveProjectAuthorization(project, undefined, "project", action, "allow", await readProjectAuthorization(project));
  }
  const measured = [], backend = nativeChecks(t, async (row) => measured.push(row));
  const actors = [], holds = new Map(), originalConfirm = selectedNative.confirmSelectedIntegration;
  t.mock.method(selectedNative, "confirmSelectedIntegration", async (...args) => {
    const hold = holds.get(args[2]);
    if (hold) { holds.delete(args[2]); hold.args = args; hold.readyResolve(); await hold.released; }
    try { return await originalConfirm(...args); }
    catch (cause) { if (hold) hold.cause = cause; if (process.env.SELECTED_RUNTIME_NATIVE_DEBUG) t.diagnostic(cause.stack ?? String(cause)); throw cause; }
  });
  for (let i = 0; i < size; i++) {
    const chat = path.join(f.dir, `contender-chat-${i}`), source = path.join(`${f.repo}-worktrees`, `contender-${i}`), branch = `contender-${i}`;
    await mkdir(chat);
    const manager = SessionManager.create(chat, path.join(process.env.PI_CODING_AGENT_DIR, "sessions", `contender-${count}-${i}`));
    manager.appendMessage({ role: "user", content: "Land this chosen feature on Project B main without moving this chat", timestamp: Date.now() });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Use explicit selected operations" }], timestamp: Date.now() });
    const asks = [], tools = new Map(); let writer = 1, calls = 0;
    const ctx = { cwd: chat, sessionManager: manager, hasUI: confirmation === "ask", ui: { gitAction: async (card) => { asks.push(card); return true; } } };
    createAgentGitWorkflowExtension(chat, undefined, undefined, { readSelectionRevisionSync: () => `contender-writer:${writer}` }).factory({
      registerTool: (tool) => tools.set(tool.name, tool), getActiveTools: () => ["read", "edit"], appendEntry: (type, data) => manager.appendCustomEntry(type, data),
    });
    const actor = { manager, chat, source, branch, asks, receiptIds: [], dependency: undefined,
      async call(operation, params = {}) {
        const id = `contender-${i}-${++calls}`;
        const result = await tools.get("git_workflow").execute(id, { operation, repositoryPath: f.repo, checkoutPath: source,
          workspaceBranch: branch, confirmation, ...params }, undefined, undefined, ctx);
        manager.appendMessage({ role: "toolResult", toolCallId: id, toolName: "git_workflow", content: result.content, details: result.details,
          isError: !!result.isError, timestamp: Date.now() });
        manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Review the returned result before another explicit operation" }], timestamp: Date.now() });
        return result.details;
      },
      newUserRequest() {
        writer++;
        manager.appendMessage({ role: "user", content: "New request: explicitly prepare and land the remaining feature on the current main", timestamp: Date.now() });
        manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Fresh user request, fresh operation authorization" }], timestamp: Date.now() });
      },
    };
    const created = await actor.call("workspace", { checkoutPath: f.repo, workspaceBranch: "main", workspaceMode: "create",
      destinationPath: source, newBranch: branch, baseBranch: "main", expectedBaseOid: await git(f.repo, "rev-parse", "HEAD") });
    assert.equal(created.status, "completed", JSON.stringify(created)); assert.equal(created.scope.checkoutPath, source);
    assert.equal((await readGitAction(created.actionId)).record.state, "succeeded");
    actors.push(actor);
  }
  for (const [i, actor] of actors.entries()) {
    await writeFile(path.join(actor.source, `unique-${i}`), `feature ${i}\n`); await git(actor.source, "add", "."); await git(actor.source, "commit", "-qm", `chosen feature ${i}`);
  }
  async function check(actor) {
    const result = await actor.call("verify", { stage: "none", checkIndexes: [0], ...(actor.dependency ? { revisionDependency: actor.dependency } : {}) });
    assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.receiptIds.length, 1);
    actor.receiptIds = result.receiptIds; actor.dependency = result.revisionDependency;
    const history = (await readGitAction(result.actionId, { includeArtifact: true })).candidate.checkoutVerification;
    assert.equal(history.evidenceScope, "clean-checkout"); assert.equal(history.candidateTreeVerified, false); assert.equal(history.repositoryChecksWaived, false);
  }
  async function prepare(actor) {
    const result = await actor.call("prepare");
    assert.equal(result.status, "completed", JSON.stringify(result)); assert.ok(result.revisionDependency);
    actor.dependency = result.revisionDependency;
  }
  async function capture(actor) {
    const hold = { readyResolve() {}, release() {} };
    hold.ready = new Promise((resolve) => { hold.readyResolve = resolve; }); hold.released = new Promise((resolve) => { hold.release = resolve; });
    holds.set(actor.manager.getSessionId(), hold);
    hold.result = actor.call("integrate", actor.dependency ? { revisionDependency: actor.dependency } : {});
    await Promise.race([hold.ready, hold.result.then((result) => { throw new Error(`Public contender did not reach native confirmation: ${JSON.stringify(result)}`); })]);
    hold.actor = actor; hold.targetOid = await git(f.repo, "rev-parse", "HEAD"); hold.sourceOid = await git(actor.source, "rev-parse", "HEAD");
    return hold;
  }
  async function win(hold) {
    hold.release(); const result = await hold.result;
    assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(result.resultOid, hold.sourceOid);
    assert.equal(await git(f.repo, "rev-parse", "HEAD"), hold.sourceOid);
    assert.equal(await git(f.repo, "show", "-s", "--format=%P", "HEAD"), hold.targetOid);
    const history = (await readGitAction(result.actionId)).record;
    assert.equal(history.state, "succeeded"); assert.equal(history.checkoutVerification, undefined);
  }
  async function lose(hold, movements) {
    hold.release(); const result = await hold.result;
    assert.equal(result.status, "target-moved", JSON.stringify(result)); assert.ok(result.actionId);
    assert.equal(result.code, movements === 3 ? "contention-limit" : "target-moved");
    assert.deepEqual(result.movement, { count: movements, limit: 3, returnToAgent: true }); assert.equal(result.recoveryRequired, undefined);
    assert.equal((await readGitAction(result.actionId)).record.state, "blocked");
    assert.doesNotMatch(JSON.stringify(result), /planId|otherState|authorityRevision|noEffect/);
    const readMove = selectedNative.readSelectedIntegrationNativeTargetMove;
    assert.ok(readMove(hold.cause)); assert.equal(readMove({ ...hold.cause }), undefined); assert.equal(readMove(new Error(hold.cause.message)), undefined);
    assert.equal(result.sourceOid, hold.sourceOid); assert.equal(result.targetOid, hold.targetOid);
    assert.equal(await git(hold.actor.source, "rev-parse", "HEAD"), hold.sourceOid);
    assert.notEqual(await git(f.repo, "rev-parse", "HEAD"), hold.targetOid);
    for (const id of hold.actor.receiptIds) assert.equal(checkoutNative.lookupGitCheckoutVerificationReceipt(id), undefined);
    const questions = hold.actor.asks.length;
    const obsolete = await hold.actor.call("integrate", { receiptIds: hold.actor.receiptIds, ...(hold.actor.dependency ? { revisionDependency: hold.actor.dependency } : {}) });
    assert.notEqual(obsolete.status, "completed"); assert.equal(hold.actor.asks.length, questions);
    await assert.rejects(originalConfirm(...hold.args)); // The consumed native approval cannot be reused either.
  }
  for (const actor of actors) await check(actor); // Real explicit optional checks; not integration prerequisites.
  let active = actors;
  for (let round = 0; active.length > 1; round++) {
    const pending = []; for (const actor of active) pending.push(await capture(actor));
    await win(pending[0]); for (const hold of pending.slice(1)) await lose(hold, round + 1);
    active = active.slice(1); for (const actor of active) await prepare(actor); for (const actor of active) await check(actor);
  }
  if (size === 3) {
    // A third REAL winner advancement, not a fixture main commit. Same-user C
    // reaches its limit; only a new explicit user request can resume it.
    const first = actors[0]; first.dependency = undefined;
    await writeFile(path.join(first.source, "unique-second"), "second actual landing\n"); await git(first.source, "add", "."); await git(first.source, "commit", "-qm", "second chosen feature increment");
    await prepare(first); await check(first);
    const last = await capture(active[0]), winner = await capture(first);
    await win(winner); await lose(last, 3);
    const questions = active[0].asks.length, launches = backend.mock.callCount();
    assert.equal((await active[0].call("prepare")).code, "contention-limit");
    assert.equal((await active[0].call("verify", { stage: "none", checkIndexes: [0] })).code, "contention-limit");
    assert.equal(active[0].asks.length, questions); assert.equal(backend.mock.callCount(), launches);
    active[0].newUserRequest(); await prepare(active[0]); await check(active[0]);
  }
  await win(await capture(active[0]));
  for (const [i, actor] of actors.entries()) {
    assert.equal(await (await import("node:fs/promises")).readFile(path.join(f.repo, `unique-${i}`), "utf8"), `feature ${i}\n`);
    assert.equal(actor.manager.getCwd(), actor.chat);
    assert.equal(actor.manager.getEntries().some((entry) => entry.type === "custom" && entry.customType === "web-task"), false);
  }
  if (size === 3) assert.equal(await (await import("node:fs/promises")).readFile(path.join(f.repo, "unique-second"), "utf8"), "second actual landing\n");
  assert.equal(actors.reduce((sum, actor) => sum + actor.asks.length, 0), confirmation === "ask" ? size === 2 ? 9 : 24 : 0);
  assert.equal(backend.mock.callCount(), size === 2 ? 3 : 8); assert.equal(measured.length, size === 2 ? 3 : 8);
}
for (const size of [2, 3]) for (const confirmation of ["ask", "none"]) test(`${size} public contending features: actual winners, retired approvals, fresh preparation/checks and bounded ${confirmation}`, async (t) => {
  await publicContenders(t, size, confirmation);
});

test("real native FF dispatch: verified non-Git chat -> B, one default Ask, metadata only, no task/move", async (t) => {
  const f = await fixture(t);
  assert.equal((await readSelectedRuntimeCurrent(f.chat)).kind, "non-git");
  const before = await git(f.repo, "rev-parse", "HEAD"), tip = await git(f.source, "rev-parse", "HEAD");
  const result = await f.tool.execute("selected-ff", { operation: "integrate", repositoryPath: f.repo, checkoutPath: f.source }, undefined, undefined, f.ctx);
  assert.equal(result.details.status, "completed", JSON.stringify(result));
  assert.notEqual(before, tip); assert.equal(await git(f.repo, "rev-parse", "HEAD"), tip);
  assert.equal(f.asks.length, 1); assert.equal(f.asks[0].kind, "integration");
  assert.equal(f.manager.getCwd(), f.chat);
  assert.doesNotMatch(JSON.stringify(result), /patch|planId|recoveryPath|argv|approvalToken|identities/);
  assert.equal((await readGitAction(result.details.actionId)).record.state, "succeeded");
});

test("public target_moved constructor without native issued proof retains recovery action and never claims movement", async (t) => {
  const f = await fixture(t), before = await git(f.repo, "rev-parse", "HEAD"), source = await git(f.source, "rev-parse", "HEAD");
  const { GitIntegrationTargetMovedError } = await jiti.import("./git-integration.ts");
  t.mock.method(selectedNative, "confirmSelectedIntegration", async () => { throw new GitIntegrationTargetMovedError(); });
  const result = (await f.tool.execute("unissued-target-move", { operation: "integrate", repositoryPath: f.repo,
    checkoutPath: f.source }, undefined, undefined, f.ctx)).details;
  assert.equal(result.status, "recovery-required"); assert.ok(result.actionId); assert.equal(result.recoveryRequired, true);
  assert.equal(result.movement, undefined); assert.notEqual((await readGitAction(result.actionId)).record.state, "succeeded");
  const denied = (await f.tool.execute("unissued-target-move-retry", { operation: "integrate", repositoryPath: f.repo,
    checkoutPath: f.source }, undefined, undefined, f.ctx)).details;
  assert.equal(denied.code, "revision-dependency-required");
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), before); assert.equal(await git(f.source, "rev-parse", "HEAD"), source);
  assert.equal(f.asks.length, 1); assert.equal(f.manager.getCwd(), f.chat);
});

test("real native preparation publishes dependency only on durable completed return; restart denies history tokens", async (t) => {
  const f = await fixture(t, { diverge: true });
  const old = await git(f.source, "rev-parse", "HEAD");
  const result = await f.runtime.run("prepare", { selector: f.selector, target: f.target });
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.ok(result.revisionDependency);
  assert.notEqual(await git(f.source, "rev-parse", "HEAD"), old); assert.equal(f.asks.length, 1);
  assert.equal((await readSelectedRuntimePreparationOrdering(await selectGitProjectResources(f.source))).kind, "required");
  const blocked = await f.runtime.run("integrate", { selector: f.selector, target: f.target });
  assert.equal(blocked.code, "revision-dependency-required");
  const restarted = createGitSelectedOperationRuntime({ sessionCwd: f.chat, manager: f.manager, effectiveTools: () => ["read", "edit"], appendEntry: (type, data) => f.manager.appendCustomEntry(type, data), ask: async () => true, isCancelled: () => false });
  t.after(() => restarted.dispose());
  assert.equal((await restarted.run("integrate", { selector: f.selector, target: f.target, revisionDependency: result.revisionDependency })).code, "revision-dependency-required");
  const done = await f.runtime.run("integrate", { selector: f.selector, target: f.target, revisionDependency: result.revisionDependency });
  assert.equal(done.status, "completed", JSON.stringify(done)); assert.equal(f.asks.length, 2);
});

test("merge mode executes genuine two-parent local native integration", async (t) => {
  const f = await fixture(t, { method: "merge" });
  const target = await git(f.repo, "rev-parse", "HEAD"), feature = await git(f.source, "rev-parse", "HEAD");
  const result = await f.runtime.run("integrate", { selector: f.selector, target: f.target });
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.equal(await git(f.repo, "show", "-s", "--format=%P", "HEAD"), `${target} ${feature}`);
});

test("none requires live saved Allow; default Ask still asks exactly once with Allow", async (t) => {
  const f = await fixture(t);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true }, projects: { [f.repo]: { enabled: true, targetBranch: "main", method: "ff", delivery: "local", integrateConfirmation: "none" } } });
  const missing = await f.runtime.run("integrate", { selector: f.selector, target: f.target, confirmation: "none" });
  assert.equal(missing.code, "saved-allow-required"); assert.equal(f.asks.length, 0);
  const initial = await readProjectAuthorization(f.selection);
  await saveProjectAuthorization(f.selection, undefined, "project", "integration", "allow", initial);
  const done = await f.runtime.run("integrate", { selector: f.selector, target: f.target });
  assert.equal(done.status, "completed", JSON.stringify(done)); assert.equal(f.asks.length, 1);
});

test("none with eligible live Allow runs with zero Ask", async (t) => {
  const f = await fixture(t);
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true }, projects: { [f.repo]: { enabled: true, targetBranch: "main", method: "ff", delivery: "local", integrateConfirmation: "none" } } });
  await saveProjectAuthorization(f.selection, undefined, "project", "integration", "allow", await readProjectAuthorization(f.selection));
  const done = await f.runtime.run("integrate", { selector: f.selector, target: f.target, confirmation: "none" });
  assert.equal(done.status, "completed", JSON.stringify(done)); assert.equal(f.asks.length, 0);
});

test("callback revocation after exact Ask never reaches native ref effects", async (t) => {
  const f = await fixture(t), tip = await git(f.repo, "rev-parse", "HEAD");
  const tools = new Map();
  createAgentGitWorkflowExtension(f.chat, undefined, undefined, f.trustedRuntime).factory({ registerTool: (tool) => tools.set(tool.name, tool), getActiveTools: () => ["read", "edit"], appendEntry: (type, data) => f.manager.appendCustomEntry(type, data) });
  const ctx = { ...f.ctx, ui: { gitAction: async () => { writeGitWorkflowSettingsDocument({ version: 1, paused: true, global: { enabled: true }, projects: {} }); return true; } } };
  const result = await tools.get("git_workflow").execute("revoke", { operation: "integrate", repositoryPath: f.repo, checkoutPath: f.source }, undefined, undefined, ctx);
  assert.equal(result.details.status, "blocked"); assert.equal(result.details.code, "paused"); assert.equal(await git(f.repo, "rev-parse", "HEAD"), tip);
});

test("strict selected dispatch refuses command/env/proof/skip inputs before Ask; current starts no native creation", async (t) => {
  const f = await fixture(t);
  for (const [key, value] of [["checks", []], ["env", {}], ["agentDir", f.dir], ["proof", {}], ["skipChecks", true], ["actionId", "old"]]) {
    const result = await f.tool.execute("invalid", { operation: "verify", repositoryPath: f.repo, checkoutPath: f.source, [key]: value }, undefined, undefined, f.ctx);
    assert.equal(result.details.code, "invalid-request");
  }
  const current = await f.tool.execute("current", { operation: "workspace", workspaceMode: "current", repositoryPath: f.repo, checkoutPath: f.source }, undefined, undefined, f.ctx);
  assert.equal(current.details.status, "current"); assert.equal(current.details.nativeCreation, false); assert.equal(f.asks.length, 0);
});

test("broken caller .git never turns into a non-Git authorization; persisted file replacement revokes", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.chat, ".git"), "gitdir: missing\n");
  await assert.rejects(readSelectedRuntimeCurrent(f.chat));
  assert.equal((await f.runtime.run("integrate", { selector: f.selector, target: f.target })).status, "blocked");
  await rm(path.join(f.chat, ".git"));
  const file = f.manager.getSessionFile(); await rename(file, `${file}.old`); await writeFile(file, await (await import("node:fs/promises")).readFile(`${file}.old`), { mode: 0o600 });
  assert.equal((await f.runtime.run("integrate", { selector: f.selector, target: f.target })).code, "persisted-owner-replaced");
});

test("direct-main/PR discovery never fabricates a target or an empty-check receipt; workspace uses actual native creation", async (t) => {
  const f = await fixture(t, { delivery: "pr" });
  const main = { repositoryPath: f.repo, checkoutPath: f.repo, workspaceBranch: "main" };
  assert.equal((await f.runtime.run("verify", { selector: main, stage: "handoff" })).status, "no-defined");
  assert.equal((await f.runtime.run("integrate", { selector: f.selector, target: f.target })).code, "delivery-not-local");
  const workspace = await f.runtime.run("workspace", { selector: main, workspace: { repositoryPath: f.repo, sourceCheckoutPath: f.repo,
    destinationPath: path.join(f.dir, "new"), branch: "new", baseBranch: "main", expectedBaseOid: await git(f.repo, "rev-parse", "HEAD"), mode: "create" } });
  assert.equal(workspace.status, "completed", JSON.stringify(workspace)); assert.equal(f.asks.length, 1);
  assert.equal(await git(path.join(f.dir, "new"), "branch", "--show-current"), "new"); assert.equal(f.manager.getCwd(), f.chat);
});

test("workspace create with sealed parent creation -> FF integration -> cleanup holds actual resources without moving non-Git chat", async (t) => {
  const f = await fixture(t, { cleanupConfirmation: "ask", cleanup: "worktree-and-branch", quietTestTerminals: true }), main = { repositoryPath: f.repo, checkoutPath: f.repo, workspaceBranch: "main" };
  const destination = path.join(`${f.repo}-worktrees`, "created"), tip = await git(f.repo, "rev-parse", "HEAD");
  const created = await f.runtime.run("workspace", { selector: main, workspace: { repositoryPath: f.repo, sourceCheckoutPath: f.repo,
    destinationPath: destination, branch: "created", baseBranch: "main", expectedBaseOid: tip, mode: "create" } });
  assert.equal(created.status, "completed", JSON.stringify(created)); assert.ok(created.knownParentCreation);
  assert.equal(created.scope.checkoutPath, destination); assert.equal(f.asks.length, 1);
  const duplicate = await f.runtime.run("workspace", { selector: main, workspace: { repositoryPath: f.repo, sourceCheckoutPath: f.repo,
    destinationPath: destination, branch: "created", baseBranch: "main", expectedBaseOid: tip, mode: "create" } });
  assert.notEqual(duplicate.status, "completed"); assert.equal(f.asks.length, 1);
  await writeFile(path.join(destination, "created-content"), "committed in the disposable fixture\n");
  await git(destination, "add", "."); await git(destination, "commit", "-qm", "created feature");
  const selector = { repositoryPath: f.repo, checkoutPath: destination, workspaceBranch: "created" };
  const integrated = await f.runtime.run("integrate", { selector, target: f.target });
  assert.equal(integrated.status, "completed", JSON.stringify(integrated));
  const admissionModule = await jiti.import("./git-cleanup-admission.ts"), createAdmission = admissionModule.createGitCleanupAdmission;
  const { beginGitWorkspacePlacement } = await jiti.import("./git-workspace-usage.ts");
  let removalAcknowledged = false;
  t.mock.method(admissionModule, "createGitCleanupAdmission", (options) => {
    const admission = createAdmission(options);
    return { ...admission, async beginIntent(evidence) { const intent = await admission.beginIntent(evidence); return { ...intent,
      async recordRemoval(proof) {
        const ack = await intent.recordRemoval(proof);
        assert.equal(admission.readRecordedRemoval({ ...ack }), undefined);
        assert.equal(admission.readRecordedRemoval(ack).sourcePath, destination);
        assert.throws(() => beginGitWorkspacePlacement(destination), (cause) => cause.code === "leased");
        removalAcknowledged = true; return ack;
      } }; } };
  });
  const cleaned = await f.runtime.run("cleanup", { selector });
  assert.equal(removalAcknowledged, true);
  assert.equal(cleaned.status, "completed", JSON.stringify(cleaned)); assert.equal(f.asks.length, 3);
  await assert.rejects((await import("node:fs/promises")).stat(destination), { code: "ENOENT" });
  assert.equal(await git(f.repo, "branch", "--list", "created"), ""); assert.equal(f.manager.getCwd(), f.chat);
  const history = await readGitAction(cleaned.actionId); assert.equal(history.record.outcome.cleanup.effects.length, 2);
  assert.doesNotMatch(JSON.stringify(cleaned), /proof|identities|planId|argv|patch/);
});

test("cleanup disabled preference and unknown host terminal inventory remain independent exact gates", async (t) => {
  const disabled = await cleanupFixture(t, { cleanupConfirmation: "disabled" });
  const denied = await disabled.runtime.run("cleanup", { selector: disabled.selector });
  assert.equal(denied.code, "confirmation-disabled", JSON.stringify(denied)); assert.equal(disabled.asks.length, 2);
  assert.ok(await (await import("node:fs/promises")).stat(disabled.destination));
  const unknown = await cleanupFixture(t, { quietTestTerminals: false });
  const blocked = await unknown.runtime.run("cleanup", { selector: unknown.selector });
  assert.equal(blocked.code, "cleanup-usage-unknown", JSON.stringify(blocked));
  assert.ok(await (await import("node:fs/promises")).stat(unknown.destination));
  assert.match(await git(unknown.repo, "branch", "--list", "cleanup-feature"), /(?:^|\s)cleanup-feature$/);
});

test("cleanup confirmation none needs its own fresh saved Allow and never infers approval from operation seals", async (t) => {
  const f = await cleanupFixture(t, { cleanupConfirmation: "none" });
  const denied = await f.runtime.run("cleanup", { selector: f.selector, confirmation: "none" });
  assert.notEqual(denied.status, "completed"); assert.equal(f.asks.length, 2);
  const selected = await selectGitProjectResources(f.destination);
  await saveProjectAuthorization(selected, undefined, "project", "cleanup", "allow", await readProjectAuthorization(selected));
  const cleaned = await f.runtime.run("cleanup", { selector: f.selector, confirmation: "none" });
  assert.equal(cleaned.status, "completed", JSON.stringify(cleaned)); assert.equal(f.asks.length, 2);
  assert.equal((await readGitAction(cleaned.actionId)).record.decision, undefined);
});

test("genuine non-FF merge cleanup uses sealed resources and exact Ask without moving the caller", async (t) => {
  const f = await cleanupFixture(t, { method: "merge" });
  assert.equal((await git(f.repo, "rev-list", "--parents", "-n", "1", "HEAD")).split(" ").length, 3);
  const cleaned = await f.runtime.run("cleanup", { selector: f.selector });
  assert.equal(cleaned.status, "completed", JSON.stringify(cleaned)); assert.equal(f.asks.length, 4);
  await assert.rejects((await import("node:fs/promises")).stat(f.destination), { code: "ENOENT" });
  assert.equal(await git(f.repo, "branch", "--list", "cleanup-feature"), ""); assert.equal(f.manager.getCwd(), f.chat);
});

test("cleanup standing Allow does not approve ignored data; exact names require independent Ask", async (t) => {
  const f = await cleanupFixture(t, { cleanupConfirmation: "none", ignored: true });
  const selected = await selectGitProjectResources(f.destination);
  await saveProjectAuthorization(selected, undefined, "project", "cleanup", "allow", await readProjectAuthorization(selected));
  const missingNames = await f.runtime.run("cleanup", { selector: f.selector, confirmation: "none" });
  assert.notEqual(missingNames.status, "completed"); assert.equal(f.asks.length, 2);
  const cleaned = await f.runtime.run("cleanup", { selector: f.selector, confirmation: "none", ignoredNames: ["cache.bin"] });
  assert.equal(cleaned.status, "completed", JSON.stringify(cleaned)); assert.equal(f.asks.length, 3);
  const question = f.asks.at(-1); assert.equal(question.kind, "cleanup"); assert.deepEqual(question.cleanup.ignored.map((r) => r.path), ["cache.bin"]);
  const history = await readGitAction(cleaned.actionId); assert.equal(history.record.outcome.cleanup.ignoredDataDeletionApproved, true);
});

test("cleanup original epoch survives actual removal and refuses restored tools before branch deletion", async (t) => {
  const f = await cleanupFixture(t), native = await jiti.import("./git-cleanup-operation.ts"), create = native.createGitCleanupEngineWithAuthority;
  let afterRemoval = false;
  t.mock.method(native, "createGitCleanupEngineWithAuthority", (adapters) => create({ ...adapters, async authorize(phase, candidate) {
    if (phase === "before-delete") { afterRemoval = true; f.setTools(["read"]); f.setTools(["read", "edit"]); }
    await adapters.authorize(phase, candidate);
  } }));
  const result = await f.runtime.run("cleanup", { selector: f.selector });
  assert.equal(afterRemoval, true); assert.equal(result.status, "recovery-required", JSON.stringify(result));
  assert.equal(result.knownFacts.removalVerified, true); assert.equal(result.knownFacts.branchDeleteVerified, false);
  await assert.rejects((await import("node:fs/promises")).stat(f.destination), { code: "ENOENT" });
  assert.equal(await git(f.repo, "branch", "--list", "cleanup-feature"), "cleanup-feature");
});

test("workspace attach executes a real existing branch but cannot issue create-only cleanup authority", async (t) => {
  const f = await fixture(t), tip = await git(f.repo, "rev-parse", "HEAD"); await git(f.repo, "branch", "attached", tip);
  const destination = path.join(f.dir, "attached"), main = { repositoryPath: f.repo, checkoutPath: f.repo, workspaceBranch: "main" };
  const result = await f.runtime.run("workspace", { selector: main, workspace: { repositoryPath: f.repo, sourceCheckoutPath: f.repo,
    destinationPath: destination, branch: "attached", baseBranch: "main", expectedBaseOid: tip, expectedTipOid: tip, mode: "attach" } });
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.equal(await git(destination, "rev-parse", "HEAD"), tip);
  const denied = await f.runtime.run("cleanup", { selector: { repositoryPath: f.repo, checkoutPath: destination, workspaceBranch: "attached" } });
  assert.notEqual(denied.status, "completed"); assert.equal(f.asks.length, 1); assert.equal(f.manager.getCwd(), f.chat);
});

test("read-only reconciliation uses actual clean paired snapshots and returns only a fresh process ordering dependency", async (t) => {
  const f = await fixture(t), source = await git(f.source, "rev-parse", "HEAD"), target = await git(f.repo, "rev-parse", "HEAD");
  const result = await f.runtime.run("reconcile", { selector: f.selector, target: f.target });
  assert.equal(result.status, "completed", JSON.stringify(result)); assert.ok(result.revisionDependency);
  assert.equal(await git(f.source, "rev-parse", "HEAD"), source); assert.equal(await git(f.repo, "rev-parse", "HEAD"), target);
  assert.equal(f.asks.length, 1); assert.equal(f.asks[0].kind, "review");
  assert.equal((await readGitAction(result.actionId)).record.kind, "review");
  assert.doesNotMatch(JSON.stringify(result), /recoveryHandle|nativeHandle|patch|identities/);
});

test("preparation preserves its original authority epoch after actual checkout and refuses change-and-restore before ref CAS", async (t) => {
  const f = await fixture(t, { diverge: true }), before = await git(f.source, "rev-parse", "HEAD"), apply = preparationNative.applyGitPreparationWithAuthority;
  let afterCheckout = false;
  t.mock.method(preparationNative, "applyGitPreparationWithAuthority", (options) => apply({ ...options,
    authorize: async (phase) => {
      if (phase === "final-ref") { afterCheckout = true; f.setTools(["read"]); f.setTools(["read", "edit"]); }
      await options.authorize(phase);
    } }));
  const result = await f.runtime.run("prepare", { selector: f.selector, target: f.target });
  assert.equal(afterCheckout, true, JSON.stringify(result));
  assert.equal(result.status, "recovery-required", JSON.stringify(result));
  assert.equal(await git(f.source, "rev-parse", "HEAD"), before);
  assert.equal((await readGitAction(result.actionId)).record.state, "recovery-required");
  assert.equal(f.asks.length, 1); assert.equal(f.manager.getCwd(), f.chat);
});

test("workspace preserves its original authority epoch through repeated native authorization", async (t) => {
  const f = await fixture(t), apply = workspaceNative.applyGitWorkspaceOperationWithAuthority;
  const destination = path.join(f.dir, "revoked-workspace"), before = await git(f.repo, "rev-parse", "HEAD");
  let invoked = false;
  t.mock.method(workspaceNative, "applyGitWorkspaceOperationWithAuthority", (options) => apply({ ...options,
    authorize: async (...args) => { await options.authorize(...args); invoked = true; f.setTools(["read"]); f.setTools(["read", "edit"]); } }));
  const result = await f.runtime.run("workspace", { selector: f.target, workspace: { repositoryPath: f.repo,
    sourceCheckoutPath: f.repo, destinationPath: destination, branch: "revoked-workspace", baseBranch: "main", expectedBaseOid: before, mode: "create" } });
  assert.equal(invoked, true); assert.notEqual(result.status, "completed", JSON.stringify(result));
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), before);
  await assert.rejects((await import("node:fs/promises")).stat(destination), { code: "ENOENT" });
});

test("workspace retains original authority after genuine held intent and refuses restored tools before child effects", async (t) => {
  const f = await fixture(t), nativeAdmission = await jiti.import("./git-workspace-admission.ts"), create = nativeAdmission.createGitWorkspaceAdmission;
  let held = false;
  t.mock.method(nativeAdmission, "createGitWorkspaceAdmission", (options) => {
    const admission = create(options);
    return { ...admission, async beginIntent(evidence) {
      const intent = await admission.beginIntent(evidence); // Original native held operation; never a reservation copy.
      held = true; f.setTools(["read"]); f.setTools(["read", "edit"]); return intent;
    } };
  });
  const destination = path.join(f.dir, "revoked-after-intent"), before = await git(f.repo, "rev-parse", "HEAD");
  const result = await f.runtime.run("workspace", { selector: f.target, workspace: { repositoryPath: f.repo,
    sourceCheckoutPath: f.repo, destinationPath: destination, branch: "revoked-after-intent", baseBranch: "main", expectedBaseOid: before, mode: "create" } });
  assert.equal(held, true, JSON.stringify(result)); assert.notEqual(result.status, "completed", JSON.stringify(result));
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), before); assert.equal(f.asks.length, 1);
  await assert.rejects((await import("node:fs/promises")).stat(destination), { code: "ENOENT" });
  assert.equal(await git(f.repo, "branch", "--list", "revoked-after-intent"), "");
});

test("independently recovered failed native check reconciles only its original consumed launch, at most three renewals and no automatic check", async (t) => {
  let launches = 0; const backend = nativeChecks(t, () => { launches++; });
  const f = await fixture(t, { diverge: true, checks: [{ label: "definite failure", argv: [process.execPath, "-e", "process.exit(9)"], requiredStage: "commit" }] });
  const prepared = await f.runtime.run("prepare", { selector: f.selector, target: f.target });
  assert.equal(prepared.status, "completed", JSON.stringify(prepared));
  const failed = await f.runtime.run("verify", { selector: f.selector, stage: "commit", revisionDependency: prepared.revisionDependency });
  assert.equal(failed.status, "recovery-required", JSON.stringify(failed)); assert.equal(launches, 1);
  const history = await readGitAction(failed.actionId, { includeArtifact: true }); assert.equal(history.record.state, "failed");
  // Reconciliation NEVER clears quarantine. Model an independent trusted human
  // recovery of this disposable fixture through the real admission API, with
  // a fresh measured snapshot and original test-simulated unit emptiness.
  const admission = await jiti.import("./git-operation-admission.ts"), selected = await selectGitProjectResources(f.source);
  const recovery = admission.readUnresolvedGitCheckRecovery(process.env.PI_CODING_AGENT_DIR, selected.commonDir);
  const row = history.record.outcome.checkoutVerification.runs[0], recipe = history.candidate.checkoutVerification.checks[0].recipe;
  assert.equal(recovery.actionId, failed.actionId); assert.equal(recovery.cleanupProof.invocation, row.invocation);
  assert.equal(await backend.originalEmpty(recovery.unit, recovery.cleanupProof.cgroupIdentity, row.invocation), "pinned-populated-zero");
  const fresh = await checkoutNative.captureGitCheckoutCheckRecoverySnapshot(selected, { recipe, checkIndex: row.checkIndex,
    stage: row.stage, policyRevision: history.candidate.checkoutVerification.policyRevision, policyDigest: row.policyDigest, environmentDigest: row.environmentDigest });
  admission.resolveHumanReviewedGitCheck(process.env.PI_CODING_AGENT_DIR, selected.commonDir, recovery.id, recovery.actionId, fresh,
    row.invocation, { kind: "human-reviewed-git-check-recovery", id: recovery.id, actionId: recovery.actionId, resource: selected.commonDir,
      unit: recovery.unit, proofIdentifier: row.invocation });
  const source = await git(f.source, "rev-parse", "HEAD"), target = await git(f.repo, "rev-parse", "HEAD");
  for (let renewal = 0; renewal < 3; renewal++) {
    const reconciled = await f.runtime.run("reconcile", { selector: f.selector, target: f.target });
    assert.equal(reconciled.status, "completed", JSON.stringify(reconciled)); assert.ok(reconciled.revisionDependency);
  }
  const bounded = await f.runtime.run("reconcile", { selector: f.selector, target: f.target });
  assert.notEqual(bounded.status, "completed", JSON.stringify(bounded)); assert.equal(bounded.revisionDependency, undefined);
  assert.equal(launches, 1); assert.equal(await git(f.source, "rev-parse", "HEAD"), source); assert.equal(await git(f.repo, "rev-parse", "HEAD"), target);
});

test("mandatory preparation native guard cannot be omitted after exact Ask", async (t) => {
  const f = await fixture(t, { diverge: true }), tip = await git(f.source, "rev-parse", "HEAD"), apply = preparationNative.applyGitPreparationWithAuthority;
  t.mock.method(preparationNative, "applyGitPreparationWithAuthority", (options) => apply({ ...options, assertCurrentSync: undefined }));
  const result = await f.runtime.run("prepare", { selector: f.selector, target: f.target });
  assert.notEqual(result.status, "completed"); assert.equal(f.asks.length, 1);
  assert.equal(await git(f.source, "rev-parse", "HEAD"), tip);
});

test("required saved checks cannot be omitted or forged; native execution journals before publishing an actual v2 receipt", async (t) => {
  const checks = [{ label: "saved-source", argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", env: {}, requiredStage: "integration" }];
  const f = await fixture(t, { checks }), before = await git(f.repo, "rev-parse", "HEAD");
  const launch = nativeChecks(t, async (row) => {
    assert.equal(checkoutNative.readGitCheckoutVerificationNativeExecution(row), row);
    assert.equal(checkoutNative.lookupGitCheckoutVerificationReceipt(row.receipt.id), undefined);
  });
  const missing = await f.runtime.run("integrate", { selector: f.selector, target: f.target });
  assert.equal(missing.code, "required-receipts-missing");
  const forged = await f.runtime.run("integrate", { selector: f.selector, target: f.target, receiptIds: ["old-history-id"] });
  assert.notEqual(forged.status, "completed"); assert.equal(f.asks.length, 0);
  const verify = await f.runtime.run("verify", { selector: f.selector, stage: "integration" });
  assert.equal(verify.status, "completed", JSON.stringify(verify)); assert.equal(launch.mock.callCount(), 1);
  const receipt = checkoutNative.lookupGitCheckoutVerificationReceipt(verify.receiptIds[0]); assert.equal(receipt.version, 2);
  const journal = await readGitAction(verify.actionId); assert.equal(journal.record.kind, "checkout-verification");
  assert.equal(journal.record.outcome.checkoutVerification.runs[0].receipt.id, receipt.id);
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), before);
  const done = await f.runtime.run("integrate", { selector: f.selector, target: f.target, receiptIds: verify.receiptIds });
  assert.equal(done.status, "completed", JSON.stringify(done));
});

test("expired original v2 receipt refuses integration before Ask or native effects", async (t) => {
  const f = await fixture(t, { checks: [{ label: "saved expiry", argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "integration" }] });
  nativeChecks(t);
  const verified = await f.runtime.run("verify", { selector: f.selector, stage: "integration" });
  assert.equal(verified.status, "completed", JSON.stringify(verified));
  const receipt = checkoutNative.lookupGitCheckoutVerificationReceipt(verified.receiptIds[0]), before = await git(f.repo, "rev-parse", "HEAD");
  t.mock.method(Date, "now", () => receipt.expiresAt + 1);
  const denied = await f.runtime.run("integrate", { selector: f.selector, target: f.target, receiptIds: verified.receiptIds });
  assert.notEqual(denied.status, "completed", JSON.stringify(denied)); assert.equal(f.asks.length, 1);
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), before);
});

test("clean v2 batching journals each actual per-recipe snapshot before publication across integration, handoff and explicit optional checks", async (t) => {
  const checks = ["integration", "integration", "handoff", "none"].map((requiredStage, index) => ({ label: `saved-${index}`,
    argv: [process.execPath, "-e", `if(process.env.SOURCE_SCOPE!=='B')process.exit(91);process.stdout.write('${index}')`], env: { SOURCE_SCOPE: "B" }, requiredStage }));
  const f = await fixture(t, { checks }); let publishedRows = 0;
  nativeChecks(t, async (row) => { assert.equal(checkoutNative.lookupGitCheckoutVerificationReceipt(row.receipt.id), undefined); }, async (row) => {
    const journal = await readGitAction(row.actionId, { includeArtifact: true });
    assert.equal(journal.candidate.checkoutVerification.evidenceScope, "clean-checkout");
    assert.equal(journal.record.outcome.checkoutVerification.runs.at(-1).receipt.id, row.receipt.id);
    assert.equal(checkoutNative.lookupGitCheckoutVerificationReceipt(row.receipt.id), undefined);
    assert.equal(journal.record.state, row.checkIndex === 0 ? "executing" : "succeeded"); publishedRows++;
  });
  const integratedChecks = await f.runtime.run("verify", { selector: f.selector, stage: "integration" });
  assert.equal(integratedChecks.status, "completed", JSON.stringify(integratedChecks)); assert.equal(integratedChecks.receiptIds.length, 2);
  const journal = await readGitAction(integratedChecks.actionId, { includeArtifact: true });
  assert.notEqual(journal.candidate.checkoutVerification.checks[0].snapshot.recipeDigest, journal.candidate.checkoutVerification.checks[1].snapshot.recipeDigest);
  for (const stage of ["handoff", "none"]) {
    const result = await f.runtime.run("verify", { selector: f.selector, stage, ...(stage === "none" ? { checkIndexes: [3] } : {}) });
    assert.equal(result.status, "completed", JSON.stringify(result));
    const receipt = checkoutNative.lookupGitCheckoutVerificationReceipt(result.receiptIds[0]); assert.equal(receipt.version, 2); assert.equal(receipt.stage, stage);
  }
  assert.equal(publishedRows, 4); assert.equal(f.manager.getCwd(), f.chat);
});

test("actual dirty v3 saved-B verification feeds both aliases Ask/none without using caller-A recipes", async (t) => {
  for (const name of ["git_workflow", "git_commit"]) {
    const checks = [{ label: "B", argv: [process.execPath, "-e", "if(process.env.SOURCE_SCOPE !== 'B')process.exit(9)"], env: { SOURCE_SCOPE: "B" }, requiredStage: "commit" }];
    const f = await fixture(t, { checks, gitCaller: true, managed: true }); nativeChecks(t);
    writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: { enabled: true }, projects: {
      [f.chat]: { enabled: true, commits: "ask", checks: [{ label: "A must never execute", argv: [process.execPath, "-e", "process.exit(99)"], requiredStage: "commit" }] },
      [f.repo]: { enabled: true, mainBranch: "main", targetBranch: "main", delivery: "local", method: "ff", commits: "ask", commitConfirmation: "none", checks } } });
    await saveProjectAuthorization(f.selection, undefined, "project", "commit", "allow", await readProjectAuthorization(f.selection));
    await writeFile(path.join(f.source, "feature-file"), "dirty B working bytes\n");
    const verified = await f.runtime.run("verify", { selector: f.selector, stage: "commit" });
    assert.equal(verified.status, "completed", JSON.stringify(verified));
    const receipt = checkoutNative.lookupGitCheckoutVerificationReceipt(verified.receiptIds[0]); assert.equal(receipt.version, 3);
    assert.equal(receipt.evidenceScope, "working-workspace"); assert.equal(receipt.candidateTreeVerified, false);
    const tool = name === "git_commit" ? f.commitTool : f.tool, params = { operation: "commit", repositoryPath: f.repo, checkoutPath: f.source,
      paths: ["feature-file"], message: "B only", receiptIds: verified.receiptIds };
    let questions = 0;
    const declined = await tool.execute("ask", params, undefined, undefined, { ...f.ctx, ui: { gitAction: async () => { questions++; return false; } } });
    assert.equal(declined.details.approved, false, JSON.stringify(declined)); assert.equal(questions, 1);
    const committed = await tool.execute("none", { ...params, confirmation: "none" }, undefined, undefined, { ...f.ctx, hasUI: false });
    assert.equal(committed.details.status, "committed", JSON.stringify(committed)); assert.equal(questions, 1);
    const journal = await readGitAction(committed.details.actionId); assert.equal(journal.record.decision, undefined);
    assert.equal(journal.record.outcome.workingWorkspaceVerification.runs[0].receipt.id, receipt.id);
    assert.equal(f.manager.getCwd(), f.chat); assert.equal(await git(f.chat, "rev-list", "--count", "HEAD"), "1");
  }
});

test("legacy confirm preserves actual v3 receipt context and final authority guard", async (t) => {
  const checks = [{ label: "legacy-source", argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "commit" }];
  const f = await fixture(t, { checks, legacySource: true }); nativeChecks(t);
  await writeFile(path.join(f.source, "feature-file"), "legacy dirty bytes\n");
  const verified = await f.runtime.run("verify", { selector: f.selector, stage: "commit" }); assert.equal(verified.status, "completed", JSON.stringify(verified));
  const preview = await f.commitTool.execute("preview", { operation: "preview", paths: ["feature-file"] }, undefined, undefined, f.ctx);
  assert.ok(preview.details.preview, JSON.stringify(preview));
  const confirmed = await f.commitTool.execute("confirm", { operation: "confirm", preview: preview.details.preview, message: "legacy verified", receiptIds: verified.receiptIds }, undefined, undefined, f.ctx);
  assert.equal(confirmed.details.status, "committed", JSON.stringify(confirmed));
  assert.equal((await readGitAction(confirmed.details.actionId)).record.outcome.workingWorkspaceVerification.runs[0].receipt.id, verified.receiptIds[0]);
});

test("absent live monotonic SDK writer coverage refuses integration instead of hashing a constant authority", async (t) => {
  const f = await fixture(t), before = await git(f.repo, "rev-parse", "HEAD");
  const runtime = createGitSelectedOperationRuntime({ sessionCwd: f.chat, manager: f.manager,
    effectiveTools: () => ["read", "edit"], appendEntry: (type, data) => f.manager.appendCustomEntry(type, data),
    ask: async () => { assert.fail("unsupported authority must refuse before Ask"); }, isCancelled: () => false });
  t.after(() => runtime.dispose());
  assert.equal((await runtime.run("integrate", { selector: f.selector, target: f.target })).code, "live-monotonic-authority-provider-unavailable");
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), before);
});

test("actual checkout followed by tools change-and-restore refuses final ref CAS and preserves measured partial effects", async (t) => {
  const f = await fixture(t), before = await git(f.repo, "rev-parse", "HEAD"), prepare = selectedNative.prepareSelectedIntegration;
  t.mock.method(selectedNative, "prepareSelectedIntegration", (options) => prepare({ ...options,
    afterCheckout: () => { f.setTools(["read"]); f.setTools(["read", "edit"]); } }));
  const result = await f.runtime.run("integrate", { selector: f.selector, target: f.target });
  assert.equal(result.status, "recovery-required", JSON.stringify(result)); assert.equal(result.knownFacts.checkoutAttempted, true);
  assert.equal(result.knownFacts.refUpdateCompleted, false); assert.equal(await git(f.repo, "rev-parse", "HEAD"), before);
  assert.equal((await readGitAction(result.actionId)).record.state, "recovery-required");
  assert.equal(f.asks.length, 1); assert.equal(f.manager.getCwd(), f.chat);
});

test("failed final journal publication retains actual integrated refs and recovery facts, without sealing a capability", async (t) => {
  const f = await fixture(t), tip = await git(f.source, "rev-parse", "HEAD");
  t.mock.method(actions, "finishGitAction", async () => { throw new Error("private-journal-failure"); });
  const result = await f.runtime.run("integrate", { selector: f.selector, target: f.target });
  assert.equal(result.status, "recovery-required", JSON.stringify(result)); assert.equal(result.knownFacts.refUpdateCompleted, true);
  assert.equal(await git(f.repo, "rev-parse", "HEAD"), tip); assert.equal(f.asks.length, 1);
  assert.doesNotMatch(JSON.stringify(result), /private-journal-failure|nativeHandle|planId|patch/);
});

test("registry durable barrier rejects even an authentic native completion when durable publication is unconfirmed", async (t) => {
  const f = await fixture(t), confirm = selectedNative.confirmSelectedIntegration; let nativeHandle, nativeResult;
  t.mock.method(selectedNative, "confirmSelectedIntegration", async (...args) => {
    const result = await confirm(...args); nativeHandle = result.nativeHandle; nativeResult = result; return result;
  });
  const result = await f.runtime.run("integrate", { selector: f.selector, target: f.target }); assert.equal(result.status, "completed");
  const proof = selectedNative.readSelectedIntegrationNativeProof(nativeHandle);
  const registry = createGitSelectedOperationRegistry({ sessionId: f.manager.getSessionId(), sessionFile: f.manager.getSessionFile(), sessionCwd: f.chat },
    { readCleanupProof: () => undefined, readRecoveryProof: () => undefined, readPreparationNoEffect: () => undefined });
  const handle = registry.completed({ stage: "completed", actionId: result.actionId, candidateRevision: "registry-fixture", completedAt: 1,
    completion: { operation: "integrate", result: nativeResult, integration: proof } }, nativeHandle);
  await assert.rejects(registry.seal(handle, async () => { throw new Error("barrier failed"); }), /barrier failed/);
  assert.equal(registry.readDurableCompletion(handle), undefined);
  assert.equal(registry.readNativeCompletion({ ...handle }), undefined);
});
