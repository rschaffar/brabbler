import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { createAgentSession, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
const { createProjectCommandBashExtension } = await createJiti(import.meta.url).import("./project-command-env.ts");
const model = { id: "offline-tools", name: "Offline fixture", provider: "fixture-no-provider", api: "anthropic-messages", baseUrl: "https://fixture.invalid", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };

test("native SDK startup/reload keeps host Bash registered but follows defaultTools", async () => {
  const root = await mkdtemp(join(tmpdir(), "host-bash-sdk-"));
  try {
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: join(root, "unused-model-store.json"), refreshOnCreate: false, allowModelNetwork: false });
    for (const [defaultTools, expected] of [
      [["read", "grep"], ["read", "grep"]], [["codemode"], ["codemode"]], [["-bash"], ["read", "edit", "write"]],
      [undefined, ["read", "bash", "edit", "write"]], [["bash"], ["bash"]],
    ]) {
      const settingsManager = SettingsManager.inMemory(defaultTools === undefined ? {} : { defaultTools });
      const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [createProjectCommandBashExtension({ cwd: root, settings: settingsManager }), createCodemodeExtension({ models: false })] });
      await resourceLoader.reload();
      // No explicit tools/noTools override: exercise native default selection.
      const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime, model, settingsManager, resourceLoader, sessionManager: SessionManager.inMemory(root) });
      try {
        const verify = () => {
          assert.deepEqual(resourceLoader.getExtensions().errors, []);
          assert.equal(session.getAllTools().find(t => t.name === "bash")?.sourceInfo?.path, "<inline:pi-web-project-command-environment>");
          assert.deepEqual([...session.getActiveToolNames()].sort(), [...expected].sort(), JSON.stringify(defaultTools));
        };
        verify();
        await session.reload();
        verify();
      } finally { session.dispose(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
