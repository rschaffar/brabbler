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
function sessionFixture() {
  const id = randomUUID(), entries = [];
  return { getSessionId: () => id, getEntries: () => entries,
    appendCustomEntry: (customType, data) => entries.push({ id: randomUUID(), parentId: entries.at(-1)?.id ?? null,
      timestamp: new Date().toISOString(), type: "custom", customType, data }) };
}
const jiti = createJiti(import.meta.url);
const { createGitCommitExtension } = await jiti.import("./git-commit-extension.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const git = promisify(execFile);
test("agent tool gates on saved policy and context cwd; previews then commits sequentially", async (t) => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-tool-commit-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await git("git", ["init", "-q", cwd]);
  await git("git", ["-C", cwd, "config", "user.name", "Tool"]);
  await git("git", ["-C", cwd, "config", "user.email", "tool@example.invalid"]);
  await writeFile(path.join(cwd, "a"), "first\n");
  await git("git", ["-C", cwd, "add", "a"]);
  await git("git", ["-C", cwd, "commit", "-qm", "initial"]);
  await writeFile(path.join(cwd, "a"), "second\n");
  let policy;
  let tool;
  const sessionManager = sessionFixture();
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
  const sessionManager = sessionFixture();
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

test("git commit registration is confined to the ordinary extensionFactories branch", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./rpc-manager.ts", import.meta.url), "utf8");
  const chatOnly = source.indexOf("extensionFactories: [exactSystemPromptExtension, createSessionReferenceExtension(), createGitWorkflowContextFilterExtension()]");
  const ordinary = source.indexOf("createProjectCommandBashExtension({", chatOnly);
  const end = source.indexOf("extensionsOverride:", ordinary);
  assert.ok(chatOnly > 0 && ordinary > chatOnly && end > ordinary);
  assert.match(source.slice(ordinary, end), /createGitCommitExtension\(/);
  assert.doesNotMatch(source.slice(source.indexOf("chatOnly\n"), ordinary), /createGitCommitExtension\(/);
});
