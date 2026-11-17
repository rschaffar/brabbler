import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
import { rpcModelConfigNative } from "../rpc-model-config-native.fixture.mjs";

// Real facade/import/store -> ordinary RPC construction -> real SDK requests and
// persisted reopen. No idle adapter, HTTP/browser, provider network or native
// engine closure claim. Two inputs distinguish native-On record suppression from
// native-Off restoration; both retain native/authored bytes throughout.
for (const nativeOff of [false, true]) test(`committed resources reach real startup/reopen and requests (native extension ${nativeOff ? "Off" : "On"})`, async t => {
  const native = rpcModelConfigNative(t, { prefix: "resource-runtime-", label: "Resource runtime fixture closure failed" });
  const root = await native.provision(), agentDir = join(root, "agent"), cwd = join(root, "project");
  const environment = process.env, previousFetch = globalThis.fetch, restores = [], forbidden = [], requests = [];
  const key = `__resource_runtime_${randomUUID().replaceAll("-", "_")}`;
  native.restore(() => { process.env = environment; globalThis.fetch = previousFetch; });
  native.restore(() => { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); delete globalThis[key]; });
  const globals = ["__piAllowedRootsCache", "__piAdditionalAllowedRoots", "__piSessionPathCache", "__piPathToSessionIdCache", "__piActivityReviewPersistenceFailed"];
  for (const name of globals) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    native.restore(() => { if (before) Object.defineProperty(globalThis, name, before); else delete globalThis[name]; });
    delete globalThis[name];
  }
  const replace = (object, name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    restores.push(() => Object.defineProperty(object, name, descriptor));
    Object.defineProperty(object, name, { ...descriptor, value });
  };
  const deny = (object, name) => replace(object, name, () => {
    forbidden.push(name); throw new Error(`Unsupported runtime fixture capability: ${name}`);
  });
  try {
    process.env = { PATH: environment.PATH ?? "", HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
      TMPDIR: root, TMP: root, TEMP: root, JITI_FS_CACHE: "0", PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"), PI_OFFLINE: "1" };
    globalThis.fetch = () => { forbidden.push("fetch"); throw new Error("No provider/network transport admitted"); };
    for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
      const original = cp[name];
      replace(cp, name, (...args) => {
        const argv = args[1], directory = Array.isArray(argv) && argv.includes("-C") ? argv[argv.indexOf("-C") + 1] : undefined;
        if (args[0] !== "git" || !directory?.startsWith(root + "/") || argv.some(arg => ["init", "commit", "add", "reset", "checkout", "clean"].includes(arg))) {
          forbidden.push(`process:${name}`); throw new Error("Only private read-only Git identity probes admitted");
        }
        return Reflect.apply(original, cp, args);
      });
    }
    syncBuiltinESMExports();
    const write = (path, content) => { fs.mkdirSync(dirname(path), { recursive: true }); fs.writeFileSync(path, content); return path; };
    fs.mkdirSync(agentDir, { mode: 0o700 }); fs.mkdirSync(cwd, { mode: 0o700 }); fs.mkdirSync(join(agentDir, ".git"));
    const state = { faux: undefined, factories: 0, inputs: 0, starts: 0, discoveries: 0, extraSkills: [] };
    globalThis[key] = state;
    const pkg = join(agentDir, "managed/package"), ext = join(pkg, "extensions/main.js"), skill = join(pkg, "skills/guide/SKILL.md");
    const control = join(agentDir, "extensions/control.js");
    const aiPath = import.meta.resolve("@earendil-works/pi-ai");
    write(control, `import { fauxProvider } from ${JSON.stringify(aiPath)};
export default pi => {
  const state = globalThis[${JSON.stringify(key)}];
  const faux = fauxProvider({ provider: "resource-fixture", models: [{ id: "probe" }] });
  state.faux = faux; pi.registerProvider(faux.provider);
  pi.registerTool({ name: "retained_control", label: "Control", description: "RETAINED_CONTROL_DESCRIPTION",
    parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "control" }] }) });
  pi.on("resources_discover", () => { state.discoveries++; return { skillPaths: [${JSON.stringify(skill)}, ...state.extraSkills] }; });
};\n`);
    write(ext, `export default pi => {
  const state = globalThis[${JSON.stringify(key)}]; state.factories++;
  ${nativeOff ? "" : `pi.registerTool({ name: "bash", label: "External Bash", description: "EXTERNAL_BASH_DESCRIPTION",
    parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "external" }] }) });`}
  pi.registerTool({ name: "resource_probe", label: "Resource probe", description: "RESOURCE_EXTENSION_DESCRIPTION",
    promptSnippet: "RESOURCE_EXTENSION_SNIPPET", promptGuidelines: ["RESOURCE_EXTENSION_GUIDELINE"],
    parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "probe" }] }) });
  pi.registerCommand("resource-command", { description: "Synthetic resource command", handler: async () => {} });
  pi.on("input", () => { state.inputs++; return { action: "continue" }; });
  pi.on("session_start", () => { state.starts++; });
  pi.on("before_agent_start", event => { event.systemPromptOptions.promptGuidelines.push("RESOURCE_EXTENSION_INSTRUCTION"); });
};\n`);
    write(skill, "---\nname: runtime-guide\ndescription: RESOURCE_SKILL_DESCRIPTION\ndisable-model-invocation: false\nmetadata:\n  authored: preserved\n---\nRESOURCE_SKILL_BODY\n");
    // Not declared in the native manifest or observed catalog. Its physical
    // containment in the managed package is NOT authority to guess a parent.
    const unseenSkill = write(join(pkg, "late/unseen/SKILL.md"), "---\nname: unseen-runtime-guide\ndescription: UNSEEN_SKILL_DESCRIPTION\n---\nUNSEEN_SKILL_BODY\n");
    const prompt = write(join(pkg, "prompts/keep.md"), "NATIVE_TEMPLATE_BODY\n");
    const manifest = write(join(pkg, "package.json"), JSON.stringify({ name: "synthetic-runtime-managed", type: "module",
      pi: { extensions: ["extensions/main.js"], skills: ["skills/guide"], prompts: ["prompts/keep.md"] } }));
    const settings = write(join(agentDir, "settings.json"), JSON.stringify({
      packages: [{ source: pkg, extensions: nativeOff ? [] : ["extensions/main.js"], skills: [], prompts: ["prompts/keep.md"], themes: [] }],
      cacheWarming: "off", enableInstallTelemetry: false, compaction: { enabled: false }, retry: { enabled: false },
      defaultProvider: "synthetic-bootstrap", defaultModel: "bootstrap", enabledModels: ["synthetic-bootstrap/bootstrap", "resource-fixture/probe"],
    }));
    const metadata = write(join(agentDir, "resource-catalog.json"), JSON.stringify({ version: 1, groups: [],
      packages: [{ source: pkg, name: "synthetic-runtime-managed", group: null, managedBy: "nix" }],
      resources: [{ kind: "extension", package: pkg, path: "extensions/main.js", managedBy: "nix" }, { kind: "skill", package: pkg, path: "skills/guide/SKILL.md", managedBy: "nix" }] }));
    const auth = write(join(agentDir, "auth.json"), "{}");
    const models = write(join(agentDir, "models.json"), JSON.stringify({ providers: { "synthetic-bootstrap": { api: "anthropic-messages",
      baseUrl: "https://synthetic-unused.invalid", apiKey: "synthetic-unused-key", models: [{ id: "bootstrap", name: "Bootstrap", reasoning: false,
        input: ["text"], contextWindow: 128000, maxTokens: 4096 }] } } }));
    const files = [ext, skill, unseenSkill, prompt, manifest, settings, metadata, control, auth, models];
    const bytes = () => files.map(path => [path, fs.statSync(path).mode, fs.readFileSync(path).toString("base64")]);
    const before = bytes();
    const sdk = await import("@earendil-works/pi-coding-agent");
    const ai = await import("@earendil-works/pi-ai");
    for (const name of ["install", "installAndPersist", "remove", "removeAndPersist", "update"]) deny(sdk.DefaultPackageManager.prototype, name);
    const jiti = createJiti(import.meta.url, { fsCache: false, alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) }, nativeModules: ["@earendil-works/pi-coding-agent"] });
    const api = await jiti.import("./api.ts"), rpc = await jiti.import("../rpc-manager.ts");
    const access = await jiti.import("../file-access.ts"); access.allowFileRoot(cwd);
    const resourceRow = (view, kind) => view.catalog.rows.find(row => row.kind === kind && row.path === (kind === "package" ? pkg : kind === "skill" ? skill : ext));
    const change = async (view, kind, scope, choice) => api.patchResourceChoice({ cwd,
      ...(view.context.sessionId ? { sessionId: view.context.sessionId } : {}), selectionKey: resourceRow(view, kind).selectionKey,
      scope, choice, revision: view.scopes[scope].revision, contextToken: view.contextToken });
    let view = await api.getResourceInventory({ cwd });
    assert.equal(resourceRow(view, "extension").nativeEnabled, !nativeOff);
    assert.equal(resourceRow(view, "skill").nativeEnabled, false);
    view = await change(view, "package", "global", "enabled");
    view = await change(view, "extension", "global", "enabled");
    view = await change(view, "skill", "global", "enabled");
    assert.equal(resourceRow(view, "skill").desired.enabled, true);
    assert.equal(resourceRow(view, "extension").desired.enabled, true);
    const open = async (id, file = "", options = {}) => {
      const started = await native.start(rpc, id, file, file ? undefined : cwd, options);
      await started.session.waitUntilReady(); return started.session;
    };
    const issue = async (wrapper, text, included) => {
      const faux = state.faux; assert.ok(faux, "retained real provider control initialized");
      await wrapper.inner.setModel(faux.getModel("probe"));
      const previous = requests.length;
      faux.setResponses([context => {
        const definitions = ai.getCurrentTools(context.messages), tools = definitions.map(tool => tool.name), system = ai.getCurrentSystemPrompt(context.messages);
        const user = context.messages.findLast(message => message.role === "user");
        const userText = typeof user.content === "string" ? user.content : user.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        requests.push({ text, included, tools, definitions, system, userText });
        return ai.fauxAssistantMessage("Synthetic resource answer");
      }]);
      await wrapper.inner.prompt(text, { source: "rpc" });
      assert.equal(requests.length, previous + 1, `one actual faux model request: ${wrapper.inner.getLastAssistantText()}`);
      const request = requests.at(-1);
      // Assert outside the provider callback: SDK provider errors become assistant
      // errors, so throwing inside that callback could hide an assertion failure.
      assert.equal(request.tools.includes("retained_control"), true, "unmanaged native control is not guessed optional");
      assert.equal(request.tools.includes("resource_probe"), included, "actual model request declarations");
      assert.equal(request.definitions.some(tool => tool.description.includes("RESOURCE_EXTENSION_DESCRIPTION")), included);
      for (const marker of ["RESOURCE_EXTENSION_SNIPPET", "RESOURCE_EXTENSION_GUIDELINE", "RESOURCE_EXTENSION_INSTRUCTION", "RESOURCE_SKILL_DESCRIPTION"]) {
        assert.equal(request.system.includes(marker), included, `actual current request prompt: ${marker}`);
      }
      return request;
    };
    const first = await open(`__new__${randomUUID()}`, "", { toolNames: nativeOff ? ["read"] : ["read", "bash"] });
    assert.ok(first.inner.resourceLoader.getExtensions().extensions.some(extension => extension.path === "<inline:brabbler-session-references>"), "required inline factory retained");
    await issue(first, "RESOURCE_ORDINARY_ON", true);
    const explicitOn = await issue(first, "/skill:runtime-guide on", true);
    assert.match(explicitOn.userText, /RESOURCE_SKILL_BODY/, "actual explicit skill expansion when enabled");
    const templateOn = await issue(first, "/keep", true);
    assert.match(templateOn.userText, /NATIVE_TEMPLATE_BODY/, "native prompt template remains native");
    const id = first.sessionId, file = first.sessionFile;
    assert.ok(fs.existsSync(file));
    view = await api.getResourceInventory({ cwd, sessionId: id });
    view = await change(view, "package", "session", "disabled");
    assert.equal(view.state, "desired"); assert.equal(resourceRow(view, "skill").desired.enabled, false);
    assert.ok(first.inner.getAllTools().some(tool => tool.name === "resource_probe"), "save alone is not live application");
    await native.close(first);
    assert.equal(rpc.getRpcSession(id), undefined, "no warm wrapper may satisfy the reopen");
    const reopened = await open(id, file);
    assert.notEqual(reopened, first); assert.equal(reopened.sessionId, id); assert.equal(reopened.sessionFile, file);
    const loaded = reopened.inner.resourceLoader.getExtensions(); assert.deepEqual(loaded.errors, []);
    assert.equal(loaded.extensions.some(extension => extension.path === ext), false, "whole optional record removed");
    assert.equal(reopened.inner.getAllTools().some(tool => tool.name === "resource_probe"), false);
    if (!nativeOff) {
      assert.equal(reopened.inner.getAllTools().find(tool => tool.name === "bash")?.sourceInfo?.path,
        "<inline:brabbler-project-command-environment>", "Off external Bash retains the real host fallback despite the prefilter SDK collision");
    }
    const counts = { starts: state.starts, inputs: state.inputs };
    const offRequest = await issue(reopened, "RESOURCE_ORDINARY_OFF", false);
    if (!nativeOff) {
      assert.equal(offRequest.tools.includes("bash"), true, "retained host Bash reaches the actual request");
      assert.equal(offRequest.definitions.find(tool => tool.name === "bash").description.includes("EXTERNAL_BASH_DESCRIPTION"), false);
    }
    const explicitOff = await issue(reopened, "/skill:runtime-guide off", false);
    assert.equal(explicitOff.userText, "/skill:runtime-guide off", "actual unknown skill remains literal; no expansion");
    assert.equal(explicitOff.userText.includes("RESOURCE_SKILL_BODY"), false);
    assert.deepEqual({ starts: state.starts, inputs: state.inputs }, counts, "removed ordinary handlers never run");
    assert.ok(state.discoveries >= 2, "retained control really re-contributed the disabled skill through resources_discover");
    const templateOff = await issue(reopened, "/keep", false);
    assert.match(templateOff.userText, /NATIVE_TEMPLATE_BODY/, "Brabbler package Off does not gate native prompts");
    assert.ok(reopened.inner.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("RESOURCE_SKILL_BODY")), "old consumed instructions remain history");
    if (nativeOff) {
      state.extraSkills = [unseenSkill];
      const discoveries = state.discoveries;
      await assert.rejects(reopened.inner.reload(), /unbound skill candidate/, "actual resources_discover cannot add an unseen optional skill to the fixed snapshot");
      assert.ok(state.discoveries > discoveries, "the real SDK discovery handler ran before refusal");
    }
    await native.close(reopened);

    // Cold child's saved profile flags and SDK tool allowlist stay hard ceilings,
    // even though the Global managed package/skill are enabled for this new ID.
    const { persistChildSession } = await jiti.import("../subagent-lifecycle.ts");
    const { SUBAGENT_META_TYPE } = await jiti.import("../subagents.ts");
    const manager = sdk.SessionManager.create(cwd);
    manager.appendModelChange("synthetic-bootstrap", "bootstrap");
    manager.appendCustomEntry(SUBAGENT_META_TYPE, { version: 1, parentSessionId: id, parentSessionPath: file, parentToolCallId: "synthetic-profile",
      profile: "synthetic-no-resources", description: "Profile ceiling", task: "No resource loading", runInBackground: false,
      createdAt: new Date().toISOString(), turnLimit: 0, resourceSnapshot: { version: 1, appendSystemPrompt: ["SAVED_CHILD_PROMPT"],
        exactSystemPrompt: "SAVED_CHILD_PROMPT", tools: ["read"], loadSkills: false, loadExtensions: false } });
    persistChildSession(manager);
    const child = await open(manager.getSessionId(), manager.getSessionFile());
    assert.deepEqual(child.inner.getActiveToolNames(), ["read"]);
    assert.equal(child.inner.resourceLoader.getExtensions().extensions.some(extension => [ext, control].includes(extension.path)), false);
    assert.equal((await child.send({ type: "get_state" })).systemPrompt, "SAVED_CHILD_PROMPT");
    await native.close(child);
    assert.deepEqual(bytes(), before, "native settings/package/auth/model files and authored invocation metadata remain byte/mode identical");
    assert.deepEqual(forbidden, []);
    t.diagnostic(JSON.stringify({ nativeOff, requests: requests.length, advertisingOn: true, recordAndInstructionsOff: true,
      explicitOnExpanded: true, explicitOffLiteral: true, sessionChoiceReopened: id === reopened.sessionId,
      nativeTemplateRetained: true, childCeilingsRetained: true, nativeBytesUnchanged: true, factoryCount: state.factories }));
  } catch (error) { console.error("Resource runtime primary failure:", error); native.fail(error); throw error; }
  finally {
    try { await native.finish(); }
    catch (error) { console.error("Resource runtime closure failure:", error); throw error; }
  }
});
