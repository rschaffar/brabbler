// Explicit opt-in model-behavior regression. Never run in npm test or the browser suite:
// it uses the selected Pi provider and may incur usage charges. No live chat is opened.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createJiti } from "jiti";
import { Type } from "@earendil-works/pi-ai";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

if (process.env.PI_GUIDANCE_MODEL_EVAL !== "1") throw new Error("Set PI_GUIDANCE_MODEL_EVAL=1 to authorize this opt-in provider-backed test.");
if (!process.env.PI_PROVIDER || !process.env.PI_MODEL) throw new Error("Select PI_PROVIDER and PI_MODEL explicitly; no fallback provider is chosen.");
const root = await mkdtemp(path.join(os.tmpdir(), "pi-web-guidance-eval-"));
const cwd = path.join(root, "repo");
const agentDir = path.join(root, "agent");
const git = promisify(execFile);
let session;
try {
  await git("git", ["init", "-q", "-b", "model-eval", cwd]);
  const jiti = createJiti(import.meta.url);
  const { createGitWorkflowExtension } = await jiti.import("../lib/git-workflow-extension.ts");
  const { readSessionGitWorkflow } = await jiti.import("../lib/git-workflow-policy.ts");
  const { snapshotManagedSessionGitWorkflow } = await jiti.import("../lib/git-workflow-session.ts");
  const { resolveGitWorkflowSettings } = await jiti.import("../lib/git-workflow-settings.ts");
  const { loadGitWorkflowSettings } = await jiti.import("../lib/git-workflow-settings-store.ts");
  const manager = SessionManager.inMemory(cwd);
  snapshotManagedSessionGitWorkflow(manager, resolveGitWorkflowSettings({ workspace: "worktree", baseBranch: null }).values);
  const calls = [];
  const loader = new DefaultResourceLoader({ cwd, agentDir, extensionFactories: [
    createGitWorkflowExtension(() => readSessionGitWorkflow(manager.getEntries()),
      () => loadGitWorkflowSettings(cwd, manager.getEntries(), agentDir, manager.getSessionId())),
    { name: "pi-web-disposable-git-probe", factory(pi) {
      pi.registerTool({ name: "git_workflow", label: "Git Workflow (disposable status probe)",
        description: "Inspect the local Git branch only with operation status; no mutation is possible in this probe.",
        parameters: Type.Object({ operation: Type.Literal("status") }),
        execute: async (_id, params) => {
          calls.push(params.operation);
          return { content: [{ type: "text", text: "Local branch: model-eval. No operation was approved or executed." }] };
        } });
    } },
  ] });
  await loader.reload();
  // SDK uses the normal configured auth runtime, but all resources, settings and
  // transcript storage for this test are isolated under root or in memory.
  const runtime = await ModelRuntime.create();
  const available = await runtime.getAvailable(process.env.PI_PROVIDER);
  const model = available.find((item) => item.id === process.env.PI_MODEL);
  if (!model) throw new Error("The selected provider/model is unavailable to the SDK; no alternate provider was used.");
  ({ session } = await createAgentSession({ cwd, agentDir, modelRuntime: runtime, model,
    thinkingLevel: "off", resourceLoader: loader, sessionManager: manager,
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }) }));
  assert.equal(session.sessionFile, undefined, "a real chat file must not be created");
  // Keep a coding tool available so this exercises the ordinary instruction
  // branch; the only Git tool is an inert status probe in the disposable repo.
  session.setActiveToolsByName(["edit", "git_workflow"]);
  assert.ok(session.getActiveToolNames().includes("git_workflow"), "status probe must be active");
  assert.ok(session.getActiveToolNames().includes("edit"), "ordinary coding-tool guidance must be active");
  const toolNames = () => session.messages.flatMap((message) => message.role === "assistant"
    ? message.content.filter((block) => block.type === "toolCall").map((block) => block.name) : []);
  const firstTimeout = setTimeout(() => { void session.abort(); }, 120_000);
  try {
    await session.prompt("Please render a LaTeX example demonstrating the Gaussian integral, with display math and a short explanation.");
  } finally { clearTimeout(firstTimeout); }
  assert.deepEqual(toolNames(), [], "ordinary math rendering must not invoke tools");
  assert.deepEqual(calls, [], "ordinary math rendering must not call Git status");
  assert.ok(session.getLastAssistantText()?.trim(), "ordinary answer must not be empty");
  console.log("PASS: real model answered ordinary LaTeX request without tools or Git setup");
  const secondTimeout = setTimeout(() => { void session.abort(); }, 120_000);
  try {
    await session.prompt("For this disposable repository, what local Git branch is checked out? Consult git_workflow status once; do not create or change anything.");
  } finally { clearTimeout(secondTimeout); }
  assert.deepEqual(calls, ["status"], "a relevant Git request should invoke one read-only status probe");
  assert.deepEqual(toolNames(), ["git_workflow"], "the relevant request must not edit files or invoke another tool");
  assert.ok(session.getLastAssistantText()?.trim(), "Git answer must not be empty");
  assert.equal(session.sessionFile, undefined);
  console.log("PASS: real model used one read-only Git status for a Git-relevant request");
} finally {
  session?.dispose();
  await rm(root, { recursive: true, force: true });
}
