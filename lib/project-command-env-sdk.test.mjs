import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { InMemoryCredentialStore, fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { createAgentSession, createBashToolDefinition, createCodemodeExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
const { createProjectCommandBashExtension, preferUserBashExtension } = await createJiti(import.meta.url).import("./project-command-env.ts");
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
          assert.equal(session.getAllTools().find(t => t.name === "bash")?.sourceInfo?.path, "<inline:brabbler-project-command-environment>");
          assert.deepEqual([...session.getActiveToolNames()].sort(), [...expected].sort(), JSON.stringify(defaultTools));
        };
        verify();
        await session.reload();
        verify();
      } finally { session.dispose(); }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("native model Bash keeps a user override ahead of the hidden host fallback after reload", async () => {
  const root = await mkdtemp(join(tmpdir(), "host-bash-user-sdk-"));
  const environment = {
    PI_CODING_AGENT_DIR: root,
    SSH_AUTH_SOCK: join(root, "synthetic-public-agent.sock"),
    BRABBLER_PASSWORD: "synthetic-override-password-not-a-credential",
    BRABBLER_SSH_RUNTIME: join(root, "synthetic-managed-runtime"),
  };
  const previous = Object.fromEntries(Object.keys(environment).map(name => [name, process.env[name]]));
  Object.assign(process.env, environment);
  let session;
  try {
    const modelRuntime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: join(root, "unused-model-store.json"), refreshOnCreate: false, allowModelNetwork: false });
    const faux = fauxProvider({ models: [{ id: "bash-override" }] });
    modelRuntime.registerNativeProvider(faux.provider);
    const settingsManager = SettingsManager.inMemory();
    const userBash = { name: "synthetic-user-bash", factory: pi => pi.registerTool(createBashToolDefinition(root, {
      // A real native Bash command prefix makes ownership observable without
      // replacing execution or exposing any inherited environment values.
      commandPrefix: "printf 'synthetic-user-override\\n'",
    })) };
    const resourceLoader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager,
      noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [userBash, createProjectCommandBashExtension({ cwd: root, settings: settingsManager })],
      extensionsOverride: preferUserBashExtension });
    await resourceLoader.reload();
    ({ session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime, model: faux.getModel("bash-override"),
      settingsManager, resourceLoader, tools: ["bash"], sessionManager: SessionManager.inMemory(root) }));
    let observed = 0;
    for (const reload of [false, true]) {
      if (reload) await session.reload();
      assert.deepEqual(resourceLoader.getExtensions().errors, []);
      assert.deepEqual(session.getActiveToolNames(), ["bash"]);
      assert.equal(session.getAllTools().find(tool => tool.name === "bash")?.sourceInfo?.path, "<inline:synthetic-user-bash>");
      faux.setResponses([
        fauxAssistantMessage([fauxToolCall("bash", { command: "printf 'native-sdk-bash\\n'" })], { stopReason: "toolUse" }),
        context => {
          const result = context.messages.findLast(message => message.role === "toolResult" && message.toolName === "bash");
          assert.ok(result);
          assert.notEqual(result.isError, true);
          assert.equal(result.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim(), "synthetic-user-override\nnative-sdk-bash");
          observed++;
          return fauxAssistantMessage([fauxText("user override retained")]);
        },
      ]);
      await session.prompt("Run the synthetic Bash ownership probe");
    }
    assert.equal(observed, 2);
  } finally {
    try { if (session) { await session.abort(); session.dispose(); } }
    finally {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      await rm(root, { recursive: true, force: true });
    }
  }
});
