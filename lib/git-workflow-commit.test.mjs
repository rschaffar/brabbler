import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = fs.mkdtempSync(join(tmpdir(), "commit-report-consumer-"));
const savedEnv = new Map(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map(key => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: home, PI_CODING_AGENT_DIR: home });
after(() => { for (const [key, value] of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } fs.rmSync(home, { recursive: true, force: true }); });
const jiti = createJiti(import.meta.url);
const { SessionManager, SettingsManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { captureGitCommitAuthority } = await jiti.import("./git-commit-invocation.ts");
const { requestWorkflowCommit, workflowCommitDiagnosticReport } = await jiti.import("./git-workflow-commit.ts");
const { gitActionSink, beginGitAction } = await jiti.import("./git-action-controller.ts");
const { captureExactCommitCandidate } = await jiti.import("./git-exact-commit-operation.ts");
const { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace } = await jiti.import("./git-workflow-access.ts");

function fixture(t) {
  const agentDir = fs.mkdtempSync(join(home, "agent-")), cwd = fs.mkdtempSync(join(home, "repo-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const git = (...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
  git("init", "-qb", "main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(join(cwd, "a"), "base\n"); git("add", "a"); git("commit", "-qm", "base");
  fs.writeFileSync(join(cwd, "a"), "exact candidate\n"); allowFileRoot(cwd);
  const manager = SessionManager.create(cwd, join(agentDir, "sessions"));
  manager.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  let tools = ["read", "edit"];
  const inner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionManager: manager,
    settingsManager: SettingsManager.create(cwd, agentDir), getActiveToolNames: () => tools,
    setActiveToolsByName: names => { tools = [...names]; }, dispose() {}, agent: { state: {} } };
  const wrapper = new AgentSessionWrapper(inner, { checkoutGuardInstalled: true });
  const registry = globalThis.__piSessions; globalThis.__piSessions = new Map([[inner.sessionId, wrapper]]);
  t.after(() => { wrapper.destroy(); globalThis.__piSessions = registry; });
  const scope = { sessionId: inner.sessionId, sessionFile: inner.sessionFile, cwd };
  const sink = gitActionSink(manager, (type, data) => manager.appendCustomEntry(type, data));
  const run = (options = {}) => {
    const authority = captureGitCommitAuthority({ scope, manager, agentDir, effectiveTools: inner.getActiveToolNames });
    return requestWorkflowCommit({ cwd, paths: ["a"], message: "exact message", sink, authority, agentDir,
      ask: async () => true, ...options, beforeApply: async () => {
        const state = await assertManagedGitAction(cwd, manager.getEntries(), "commit", "agent", agentDir, tools);
        await assertManagedGitProjectDenial(cwd, { sessionId: scope.sessionId, sessionFile: scope.sessionFile, sessionCwd: cwd }, "commit", agentDir);
        await assertManagedGitWorkspace(state, cwd); authority.assertCurrentSync(); return authority.assertCurrentSync;
      } });
  };
  return { cwd, agentDir, scope, manager, sink, git, run };
}
const warning = result => {
  assert.equal(result.details.diagnosticsUnavailable, true);
  assert.deepEqual(result.details.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
  assert.equal(result.details.recoveryRequired, undefined);
  assert.doesNotMatch(JSON.stringify(result), /uncertain|refresh|retry|ENOSPC|private storage/);
};

test("initial namespace and real SDK anchor storage failure preserve the full exact Ask and native success", async t => {
  for (const fault of ["namespace", "anchor"]) await t.test(fault, async t => {
    const f = fixture(t), before = f.git("rev-parse", "HEAD");
    let attempts = 0, mock;
    if (fault === "namespace") fs.writeFileSync(join(f.agentDir, "git-diagnostics-v2"), "not a directory");
    else {
      const append = fs.appendFileSync;
      mock = t.mock.method(fs, "appendFileSync", (path, data, ...args) => {
        if (path === f.scope.sessionFile && String(data).includes("pi-web:git-action")) {
          attempts++; throw Object.assign(new Error("private storage failure"), { code: "ENOSPC" });
        }
        return append(path, data, ...args);
      });
      syncBuiltinESMExports();
    }
    let approved;
    try {
      const result = await f.run({ ask: async candidate => {
        approved = structuredClone(candidate);
        assert.equal(candidate.preview.head, before); assert.equal(candidate.message, "exact message");
        assert.match(candidate.diff.patch, /\+exact candidate/);
        assert.equal(candidate.diagnosticsUnavailable, true);
        assert.equal(candidate.diagnostics.reason, "storage-unavailable");
        return true;
      } });
      assert.equal(result.details.status, "committed"); warning(result);
      assert.equal(f.git("rev-parse", "HEAD"), result.details.commit);
      assert.equal(result.details.tree, approved.preview.tree); assert.deepEqual(result.details.parents, [before]);
      assert.match(result.content[0].text, /storage-unavailable/);
      if (fault === "anchor") assert.equal(attempts, 1, "optional anchor is not retried");
    } finally { mock?.mock.restore(); syncBuiltinESMExports(); }
  });
});

test("late update/completion storage loss survives forwarding wrappers and does not change the native result", async t => {
  const f = fixture(t);
  const result = await f.run({ ask: async () => {
    const root = join(f.agentDir, "git-diagnostics-v2");
    fs.renameSync(root, `${root}.unavailable`); fs.writeFileSync(root, "not a directory");
    return true;
  } });
  assert.equal(result.details.status, "committed"); warning(result);
  assert.equal(f.git("rev-parse", "HEAD"), result.details.commit);
  assert.equal(fs.existsSync(join(f.cwd, ".git/index.lock")), false);
  assert.equal(fs.existsSync(join(f.agentDir, "pi-web/git-operation-admission")), false);
});

test("decline and cancellation stay harmless with unavailable history and include an outcome-neutral notice", async t => {
  for (const cancel of [false, true]) await t.test(cancel ? "cancel" : "decline", async t => {
    const f = fixture(t), head = f.git("rev-parse", "HEAD"), index = fs.readFileSync(join(f.cwd, ".git/index"));
    fs.writeFileSync(join(f.agentDir, "git-diagnostics-v2"), "unavailable");
    const abort = new AbortController();
    const result = await f.run({ signal: abort.signal, ask: async () => { if (cancel) abort.abort(); return false; } });
    assert.equal(result.details.approved, false); warning(result);
    assert.match(result.content[0].text, /no commit was made.*diagnostics unavailable/);
    assert.doesNotMatch(JSON.stringify(result), /Commit completed|recoveryWarning/);
    assert.equal(f.git("rev-parse", "HEAD"), head); assert.deepEqual(fs.readFileSync(join(f.cwd, ".git/index")), index);
  });
});

test("forwarded diagnostic report and callback fallback retain storage precedence without throwing", async t => {
  const f = fixture(t);
  const captured = await captureExactCommitCandidate(f.cwd, ["a"], "exact message", "whole-file");
  const handle = await beginGitAction(f.sink, "agent", captured.snapshot, f.agentDir);
  const forwarded = { get record() { return handle.record; }, update: handle.update, release: handle.release };
  try {
    assert.equal(await forwarded.update("awaiting-decision"), undefined);
    assert.deepEqual(workflowCommitDiagnosticReport(forwarded), {});
    const foreign = join(f.agentDir, "git-diagnostics-v2", "foreign");
    fs.writeFileSync(foreign, "preserve unknown data", { mode: 0o600 });
    assert.equal(await forwarded.update("declined", { decision: "declined" }), undefined);
    assert.deepEqual(workflowCommitDiagnosticReport(forwarded), { diagnosticsUnavailable: true,
      diagnostics: { status: "unavailable", reason: "retention-limited" } });
    assert.deepEqual(workflowCommitDiagnosticReport(forwarded, true), { diagnosticsUnavailable: true,
      diagnostics: { status: "unavailable", reason: "storage-unavailable" } });
    assert.equal(fs.readFileSync(foreign, "utf8"), "preserve unknown data");
  } finally { handle.release(); }
});

test("invalid candidate and actual native stale-candidate failure remain failures, not storage success", async t => {
  const f = fixture(t), head = f.git("rev-parse", "HEAD"), index = fs.readFileSync(join(f.cwd, ".git/index"));
  fs.writeFileSync(join(f.agentDir, "git-diagnostics-v2"), "unavailable");
  let prompts = 0;
  await assert.rejects(f.run({ paths: ["../escape"], ask: async () => { prompts++; return true; } }));
  assert.equal(prompts, 0);
  await assert.rejects(f.run({ ask: async () => { fs.writeFileSync(join(f.cwd, "a"), "different native bytes\n"); return true; } }));
  assert.equal(f.git("rev-parse", "HEAD"), head); assert.deepEqual(fs.readFileSync(join(f.cwd, ".git/index")), index);
});
