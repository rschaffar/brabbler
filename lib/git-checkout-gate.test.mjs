import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEventBus, createExtensionRuntime, ExtensionRunner, SessionManager } from "@earendil-works/pi-coding-agent";

const { createJiti } = await import("jiti");
const { acquireGitCheckoutGate, createGitCheckoutOperationGuard, isGitCheckoutGated } = await createJiti(import.meta.url).import("./git-checkout-gate.ts");

test("checkout gates reserve both roots and release exactly once", () => {
  const source = "/tmp/pi-web-gate-source";
  const target = "/tmp/pi-web-gate-target";
  const release = acquireGitCheckoutGate([source, target]);
  try {
    assert.equal(isGitCheckoutGated(source), true);
    assert.equal(isGitCheckoutGated(target), true);
    assert.equal(isGitCheckoutGated("/tmp/pi-web-gate-unrelated"), false);
    assert.throws(() => acquireGitCheckoutGate(["/tmp/pi-web-gate-unrelated", target]), /busy/);
    assert.equal(isGitCheckoutGated("/tmp/pi-web-gate-unrelated"), false);
  } finally { release(); release(); }
  assert.equal(isGitCheckoutGated(source), false);
  assert.equal(isGitCheckoutGated(target), false);
});

test("SDK admission blocks deferred/unknown tools and user_bash even if a run began before gate acquisition", () => {
  const cwd = join(tmpdir(), "pi-web-gate-tools");
  const handlers = new Map();
  let admittedBash = false;
  const guard = createGitCheckoutOperationGuard({
    isBuiltinReadOnlyTool: (name) => name === "read",
    onUserBash: () => { admittedBash = true; },
  });
  guard.factory({ on: (event, handler) => { handlers.set(event, handler); } });
  const release = acquireGitCheckoutGate([cwd]);
  try {
    const tool = (toolName) => handlers.get("tool_call")({ toolName }, { cwd });
    assert.equal(tool("read"), undefined);
    for (const name of ["write", "edit", "bash", "powershell", "unknown", "ls"]) {
      assert.deepEqual(tool(name).block, true, name);
    }
    assert.throws(() => handlers.get("user_bash")({ command: "touch file" }, { cwd }), /busy/);
    assert.equal(admittedBash, false);
  } finally { release(); }
  handlers.get("user_bash")({ command: "touch file" }, { cwd });
  assert.equal(admittedBash, true);
});

test("pinned SDK runner enforces checkout gate before executing tools and user_bash", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-web-guard-sdk-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const sdk = import.meta.resolve("@earendil-works/pi-coding-agent");
  const { loadExtensionFromFactory } = await import(new URL("./core/extensions/loader.js", sdk));
  const runtime = createExtensionRuntime();
  const guard = createGitCheckoutOperationGuard({ isBuiltinReadOnlyTool: (name) => name === "read", onUserBash: () => {} });
  const extension = await loadExtensionFromFactory(guard.factory, cwd, createEventBus(), runtime, "<inline:pi-web-checkout-operation-guard>");
  const runner = new ExtensionRunner([extension], runtime, cwd, SessionManager.inMemory(cwd), {});
  t.after(() => runner.invalidate());
  const release = acquireGitCheckoutGate([cwd]);
  try {
    assert.equal(await runner.emitToolCall({ type: "tool_call", toolCallId: "read", toolName: "read", input: {} }), undefined);
    const blocked = await runner.emitToolCall({ type: "tool_call", toolCallId: "write", toolName: "write", input: { path: "a", content: "x" } });
    assert.equal(blocked.block, true);
    await assert.rejects(runner.emitUserBash({ type: "user_bash", command: "touch a", cwd, excludeFromContext: false }), /busy/);
  } finally { release(); }
});

test("checkout gate also blocks a session cwd referring to the same physical path by symlink", async (t) => {
  const base = await mkdtemp(join(tmpdir(), "pi-web-gate-alias-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  const link = join(base, "alias");
  await symlink(base, link, "dir");
  const release = acquireGitCheckoutGate([base]);
  try {
    assert.equal(isGitCheckoutGated(link), true);
    assert.throws(() => acquireGitCheckoutGate([link]), /busy/);
  } finally { release(); }
  assert.equal(isGitCheckoutGated(link), false);
});
