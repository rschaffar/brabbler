import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { createAgentSessionServices, createAgentSessionFromServices, SessionManager } from "@earendil-works/pi-coding-agent";
const jiti = createJiti(import.meta.url);
const { gitWorkflowPlugin } = await jiti.import("./index.ts");
const { updatePluginSettings } = await jiti.import("../../lib/plugins/settings.ts");
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
  t.after(() => session.dispose());
  await session.bindExtensions({ uiContext: { notify() {} }, mode: "rpc" });
  assert.ok(session.getActiveToolNames().includes("read"));
  assert.equal(session.getAllTools().some((tool) => tool.name.startsWith("git_")), false);
  updatePluginSettings(gitWorkflowPlugin.manifest, "global", root, { enabled: true }, []);
  assert.ok(session.getActiveToolNames().includes("git_commit"));
  assert.ok(session.getAllTools().some((tool) => tool.name === "git_merge" && tool.exposure === "model-only"));
  updatePluginSettings(gitWorkflowPlugin.manifest, "global", root, { enabled: false }, []);
  assert.equal(session.getActiveToolNames().some((name) => name.startsWith("git_")), false);
  assert.ok(session.getAllTools().filter((tool) => tool.name.startsWith("git_")).every((tool) => tool.exposure === "hidden"));
  assert.ok(session.getActiveToolNames().includes("read"));
  // Malformed plugin settings also must not break core session startup.
  writeFileSync(join(agentDir, "pi-web", "plugins", "git-workflow", "settings.json"), "not JSON");
  await session.reload();
  assert.equal(session.getActiveToolNames().some((name) => name.startsWith("git_")), false);
});
