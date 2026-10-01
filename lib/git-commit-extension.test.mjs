import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-commit-history-test-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});
function sessionFixture(cwd) {
  const persisted = SessionManager.create(cwd, path.join(agentDir, "sessions"));
  persisted.appendMessage({ role: "user", content: "task", timestamp: Date.now() });
  persisted.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  const id = persisted.getSessionId(), entries = [];
  return { getSessionId: () => id, getSessionFile: () => persisted.getSessionFile(), getCwd: () => cwd,
    getHeader: () => ({ id, cwd }), getEntries: () => entries,
    appendCustomEntry: (customType, data) => entries.push({ id: randomUUID(), parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(), type: "custom", customType, data }) };
}
const jiti = createJiti(import.meta.url, { interopDefault: false });
const rpc = await jiti.import("./rpc-manager.ts");
const { createGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("./git-project-authorization.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = promisify(execFile);
test("agent tool gates on saved policy and context cwd; previews then commits sequentially", async (t) => {
  // Direct tool invocations lack a running SDK wrapper; exact-ID admission is
  // exercised by rpc-manager tests rather than granting a production fallback.
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-tool-commit-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.name", "Tool"]);
  await git("git", ["-C", cwd, "config", "user.email", "tool@example.invalid"]);
  await writeFile(path.join(cwd, "a"), "first\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await git("git", ["-C", cwd, "commit", "-qm", "initial"]);
  await writeFile(path.join(cwd, "a"), "second\n");
  allowFileRoot(cwd);
  let policy;
  let tool;
  const sessionManager = sessionFixture(cwd);
  createGitCommitExtension(cwd, () => policy).factory({ getActiveTools: () => ["read", "edit"], appendEntry: sessionManager.appendCustomEntry, registerTool: (registered) => { tool = registered; } });
  assert.equal(tool.executionMode, "sequential");
  const execute = (params, contextCwd = cwd) => tool.execute("id", params, undefined, undefined, { cwd: contextCwd, sessionManager });
  assert.equal((await execute({ operation: "preview", paths: ["a"] })).isError, true);
  policy = { mode: "current", onCreate: "stay", commits: "manual" };
  assert.equal((await execute({ operation: "preview", paths: ["a"] })).isError, true);
  policy = { ...policy, commits: "agent" };
  assert.equal((await execute({ operation: "preview", paths: ["a"] }, os.tmpdir())).isError, true);
  const { details: { preview } } = await execute({ operation: "preview", paths: ["a"] });
  await writeFile(path.join(cwd, "a"), "third\n");
  assert.equal((await execute({ operation: "confirm", preview, message: "stale" })).isError, true);
  const fresh = (await execute({ operation: "preview", paths: ["a"] })).details.preview;
  const result = await execute({ operation: "confirm", preview: fresh, message: "approved" });
  assert.equal(result.details.status, "committed");
  assert.equal(result.details.authorEmail, "tool@example.invalid");
  assert.deepEqual(result.details.parents, [fresh.head]);
  assert.equal(result.details.tree, fresh.tree);
});
test("saved chat commit consent can target a different registered worktree but not an unregistered path", async (t) => {
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-web-tool-cross-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = path.join(home, "source"), other = path.join(home, "other");
  await git("git", ["init", "-q", "-b", "source", source]);
  await git("git", ["-C", source, "config", "user.name", "Tool"]);
  await git("git", ["-C", source, "config", "user.email", "tool@example.invalid"]);
  await writeFile(path.join(source, "a"), "first\n");
  await git("git", ["-C", source, "add", "a"]);
  await git("git", ["-C", source, "commit", "-qm", "initial"]);
  await git("git", ["-C", source, "worktree", "add", "-qb", "other", other]);
  allowFileRoot(home);
  await writeFile(path.join(other, "a"), "second\n");
  let tool;
  const sessionManager = sessionFixture(source);
  createGitCommitExtension(source, () => ({ commits: "agent" })).factory({ getActiveTools: () => ["read", "edit"], appendEntry: sessionManager.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const run = (params) => tool.execute("id", params, undefined, undefined, { cwd: source, sessionManager });
  const before = (await git("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
  assert.equal((await run({ operation: "preview", workspaceBranch: "missing", paths: ["a"] })).isError, true);
  const preview = (await run({ operation: "preview", workspaceBranch: "other", paths: ["a"] })).details.preview;
  assert.equal(preview.repositoryRoot, other);
  assert.equal((await run({ operation: "confirm", workspaceBranch: "source", preview, message: "wrong checkout" })).isError, true);
  const result = await run({ operation: "confirm", workspaceBranch: "other", preview, message: "other commit" });
  assert.equal(result.details.status, "committed");
  assert.equal((await git("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim(), before);
});

test("legacy git_commit enforces saved Deny at preview, confirm and immediately before Ask apply across worktrees", async (t) => {
  t.mock.method(rpc, "hasConflictingRpcCheckoutOperation", () => false);
  const home = await mkdtemp(path.join(os.tmpdir(), "pi-web-agent-deny-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const source = path.join(home, "source"), other = path.join(home, "other");
  await git("git", ["init", "-qb", "source", source]);
  await git("git", ["-C", source, "config", "user.name", "Test"]);
  await git("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(source, "a"), "base\n");
  await git("git", ["-C", source, "add", "a"]);
  await git("git", ["-C", source, "commit", "-qm", "base"]);
  await git("git", ["-C", source, "worktree", "add", "-qb", "other", other]);
  await writeFile(path.join(other, "a"), "change\n");
  allowFileRoot(home);
  const manager = sessionFixture(source);
  const owner = { sessionId: manager.getSessionId(), sessionFile: manager.getSessionFile(), sessionCwd: source };
  const selection = await selectGitProjectResources(other);
  const status = () => readProjectAuthorization(selection, owner, agentDir);
  const save = async (decision) => saveProjectAuthorization(selection, owner, "session", "commit", decision, await status(), agentDir);
  let tool, policy = { mode: "current", onCreate: "stay", commits: "agent" }, approvals = 0;
  createGitCommitExtension(source, () => policy).factory({ getActiveTools: () => ["read", "edit"],
    appendEntry: manager.appendCustomEntry, registerTool: (value) => { tool = value; } });
  const run = (params, ui = async () => { approvals++; return true; }) => tool.execute("id", { workspaceBranch: "other", ...params }, undefined, undefined,
    { cwd: source, sessionManager: manager, hasUI: true, ui: { gitAction: ui } });
  const before = (await git("git", ["-C", other, "rev-parse", "HEAD"])).stdout.trim();
  await save("deny");
  assert.equal((await run({ operation: "preview", paths: ["a"] })).isError, true);
  assert.equal((await run({ operation: "commit", paths: ["a"], message: "blocked" })).isError, true);
  assert.equal(approvals, 0);
  await save("inherit");
  const preview = (await run({ operation: "preview", paths: ["a"] })).details.preview;
  await save("deny");
  assert.equal((await run({ operation: "confirm", preview, message: "blocked" })).isError, true);
  await save("inherit");
  const afterApproval = await run({ operation: "commit", paths: ["a"], message: "blocked" }, async () => {
    approvals++; await save("deny"); return true;
  });
  assert.equal(afterApproval.isError, true);
  assert.equal(await git("git", ["-C", other, "rev-parse", "HEAD"]).then(({ stdout }) => stdout.trim()), before);
  await save("allow");
  policy = { ...policy, commits: "manual" };
  assert.equal((await run({ operation: "preview", paths: ["a"] })).isError, true, "Allow cannot grant legacy agent consent");
});

test("git commit registration is confined to the ordinary extensionFactories branch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const chatOnly = source.indexOf("extensionFactories: [checkoutGuard, exactSystemPromptExtension, createSessionReferenceExtension(), createGitWorkflowContextFilterExtension()]");
  const ordinary = source.indexOf("createProjectCommandBashExtension({", chatOnly);
  const end = source.indexOf("extensionsOverride:", ordinary);
  assert.ok(chatOnly > 0 && ordinary > chatOnly && end > ordinary);
  assert.match(source.slice(ordinary, end), /createGitCommitExtension\(/);
  assert.doesNotMatch(source.slice(source.indexOf("chatOnly\n"), ordinary), /createGitCommitExtension\(/);
});
