import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";
import { seedRetiredGitBookkeeping } from "./retired-git-bookkeeping-fixture.mjs";

// Every SDK/config/resource read and write belongs to this disposable fixture.
const home = mkdtempSync(join(tmpdir(), "pi-web-outer-startup-"));
process.env.HOME = home;
process.env.XDG_CONFIG_HOME = join(home, "config");
process.env.PI_CODING_AGENT_DIR = join(home, "agent");
mkdirSync(process.env.PI_CODING_AGENT_DIR);
process.env.PI_WEB_IDLE_TIMEOUT_MS = "0";
const jiti = createJiti(import.meta.url);
const rpc = await jiti.import("./rpc-manager.ts");
const { createSubagentController } = await jiti.import("./subagent-runtime.ts");
test.after(() => rmSync(home, { recursive: true, force: true }));

function repository() {
  const root = mkdtempSync(join(home, "repo-")), linked = `${root}-linked`;
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  git("worktree", "add", "-b", "feature", linked);
  return { root, linked };
}

test("real RPC startup and SDK tool execution ignore retired bookkeeping in same and linked checkouts", async () => {
  const { root, linked } = repository();
  const restore = seedRetiredGitBookkeeping([root, linked]);
  const sessions = [];
  try {
    for (const cwd of [root, linked]) {
      const { session } = await rpc.startRpcSession(randomUUID(), "", cwd, { toolNames: ["read", "write"], gitWorkflow: null });
      sessions.push(session);
      await session.waitUntilReady();
      assert.equal(session.cwd, cwd);
      assert.ok((await session.send({ type: "get_tools" })).some((tool) => tool.name === "write" && tool.active));
      const extensions = session.inner.resourceLoader.getExtensions().extensions;
      assert.ok(extensions.every((extension) => extension.path !== "<inline:pi-web-checkout-operation-guard>"));
      // Use the actual startup runner and actual SDK write tool, not an admitted=true stub.
      const runner = session.inner.extensionRunner;
      assert.ok(runner);
      const input = { path: join(cwd, "tool-output.txt"), content: "independent B\n" };
      assert.equal(await runner.emitToolCall({ type: "tool_call", toolCallId: "fixture-write", toolName: "write", input }), undefined);
      const tool = session.inner.agent.state.tools.find((tool) => tool.name === "write");
      assert.ok(tool);
      await tool.execute("fixture-write", input);
      assert.equal(readFileSync(input.path, "utf8"), input.content);
    }
  } finally {
    for (const session of sessions) await session.shutdown();
    restore();
  }
});

test("new subagent constructs real SDK services despite retired bookkeeping without inheriting mutation tools", async () => {
  const { root } = repository();
  const { session: parent } = await rpc.startRpcSession(randomUUID(), "", root, { toolNames: ["read", "write"], gitWorkflow: null });
  // Persist without submitting to a model or starting a live request.
  parent.inner.sessionManager.appendMessage({ role: "user", content: "fixture task", timestamp: Date.now() });
  const hosts = new Map([[parent.sessionId, parent]]);
  let submitted = 0, child;
  const controller = createSubagentController({
    isBuiltInSubagentsEnabled: () => true,
    getSession: (id) => hosts.get(id),
    registerSession(inner) {
      child = new rpc.AgentSessionWrapper(inner);
      hosts.set(inner.sessionId, child);
      // Model dispatch is outside this test. Everything through SDK construction is real.
      inner.prompt = async (_task, options) => { submitted++; options.preflightResult(); };
    },
    reopenSession: async () => { throw new Error("unexpected reopen"); },
    resolveSessionPath: async () => null,
    invalidateSessionList() {},
  });
  const restore = seedRetiredGitBookkeeping([root]);
  try {
    const execution = await controller.extensionRuntime.start({ parentContext: parent.inner,
      parentToolCallId: "fixture-agent", profile: "explore", task: "Inspect fixture", description: "fixture", isolation: "off" });
    assert.equal((await execution.completion).status, "completed");
    assert.equal(submitted, 1);
    assert.ok(child);
    assert.ok(!child.inner.getActiveToolNames().includes("write"));
    assert.ok(!child.inner.getActiveToolNames().includes("git_commit"));
    assert.ok(child.inner.resourceLoader.getExtensions().extensions.every((extension) => extension.path !== "<inline:pi-web-checkout-operation-guard>"));
  } finally {
    await child?.shutdown(); await parent.shutdown(); restore();
  }
});

test("unused RPC inventory and cross-session admission APIs are deleted", () => {
  assert.equal(rpc.readRpcWorkspaceSessionUsage, undefined);
  assert.equal(rpc.createRpcWorkspaceCleanupUsage, undefined);
  assert.equal(rpc.hasConflictingRpcCheckoutOperation, undefined);
});
