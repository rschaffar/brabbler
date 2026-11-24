import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createJiti } from "jiti";
import { rpcModelConfigNative } from "../rpc-model-config-native.fixture.mjs";
import { deferred } from "../testing/async.fixture.mjs";

// Actual route saves/Apply, ordinary host startup, SDK requests and public native
// disposal. No service/browser, external provider or arbitrary-JS isolation claim.
for (const spec of [{ nativeOff: false }, { nativeOff: true }, { nativeOff: true, children: true }, { nativeOff: false, failure: true }, { nativeOff: true, reopen: true }]) test(`saved resources / explicit Apply ${JSON.stringify(spec)}`, async t => {
  const { nativeOff, children = false, failure = false, reopen = false } = spec;

  const native = rpcModelConfigNative(t, { prefix: "resource-runtime-", label: "Resource runtime fixture closure failed" });
  const root = await native.provision(), agentDir = join(root, "agent"), cwd = join(root, "project");
  const environment = process.env, previousFetch = globalThis.fetch, restores = [], forbidden = [], requests = [];
  const key = `__resource_runtime_${randomUUID().replaceAll("-", "_")}`;
  native.restore(() => { process.env = environment; globalThis.fetch = previousFetch; });
  native.restore(() => { for (const restore of restores.reverse()) restore(); syncBuiltinESMExports(); delete globalThis[key]; });
  for (const name of ["__piAllowedRootsCache", "__piAdditionalAllowedRoots", "__piSessionPathCache", "__piPathToSessionIdCache", "__piActivityReviewPersistenceFailed", "__piResourceApplications"]) {
    const before = Object.getOwnPropertyDescriptor(globalThis, name);
    native.restore(() => { if (before) Object.defineProperty(globalThis, name, before); else delete globalThis[name]; });
    delete globalThis[name];
  }
  const replace = (object, name, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, name);
    restores.push(() => Object.defineProperty(object, name, descriptor));
    Object.defineProperty(object, name, { ...descriptor, value });
  };
  const deny = (object, name) => replace(object, name, () => { forbidden.push(name); throw new Error(`Unsupported fixture capability: ${name}`); });
  try {
    process.env = { PATH: environment.PATH ?? "", HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"),
      TMPDIR: root, TMP: root, TEMP: root, JITI_FS_CACHE: "0", PI_CODING_AGENT_DIR: agentDir, PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"), PI_OFFLINE: "1" };
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
    const entered = deferred(), release = deferred(), retirementEntered = deferred(), retirementRelease = deferred();
    native.release(() => { release.resolve(); retirementRelease.resolve(); });
    const state = { providers: new Map(), factories: 0, inputs: 0, starts: 0, discoveries: 0, extraSkills: [], holdAtInput: nativeOff,
      held: async () => { entered.resolve(); await release.promise; }, retire: async () => { retirementEntered.resolve(); await retirementRelease.promise; } };
    globalThis[key] = state;
    const pkg = join(agentDir, "managed/package"), ext = join(pkg, "extensions/main.js"), skill = join(pkg, "skills/guide/SKILL.md"), control = join(agentDir, "extensions/control.js");
    const aiPath = import.meta.resolve("@earendil-works/pi-ai");
    write(control, `import { fauxProvider } from ${JSON.stringify(aiPath)};
export default pi => {
  const state = globalThis[${JSON.stringify(key)}];
  const faux = fauxProvider({ provider: "resource-fixture", models: [{ id: "probe" }] });
  pi.registerProvider(faux.provider);
  pi.on("session_start", async (_event, ctx) => { state.providers.set(ctx.sessionManager.getSessionId(), faux); await state.binding?.(); });
  pi.on("input", async event => { if (event.text === "RESOURCE_HELD_ACCEPTED" && state.holdAtInput) await state.held(); return { action: "continue" }; });
  pi.registerTool({ name: "retained_control", label: "Control", description: "RETAINED_CONTROL_DESCRIPTION",
    parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "control" }] }) });
  pi.registerTool({ name: "retained_hold", label: "Standalone effect", description: "RETAINED_STANDALONE_EFFECT",
    parameters: { type: "object", properties: {} }, execute: async () => { await state.standalone?.(); return { content: [{ type: "text", text: "effect complete" }] }; } });
  pi.on("resources_discover", () => { state.discoveries++; return { skillPaths: [${JSON.stringify(skill)}, ...state.extraSkills] }; });
};\n`);
    write(ext, `export default pi => {
  const state = globalThis[${JSON.stringify(key)}]; state.factories++;
  ${nativeOff ? "" : `pi.registerTool({ name: "bash", label: "External Bash", description: "EXTERNAL_BASH_DESCRIPTION", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "external" }] }) });`}
  pi.registerTool({ name: "resource_probe", label: "Probe", description: "RESOURCE_EXTENSION_DESCRIPTION", promptSnippet: "RESOURCE_EXTENSION_SNIPPET", promptGuidelines: ["RESOURCE_EXTENSION_GUIDELINE"],
    parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: "probe" }] }) });
  pi.registerCommand("resource-command", { description: "Resource command", handler: async () => {} });
  pi.on("input", () => { state.inputs++; return { action: "continue" }; });
  pi.on("session_start", () => { state.starts++; });
  pi.on("session_shutdown", async (_event, ctx) => { if (state.holdRetirementId === ctx.sessionManager.getSessionId()) { state.holdRetirementId = undefined; await state.retire(); } });
  pi.on("before_agent_start", event => { event.systemPromptOptions.promptGuidelines.push("RESOURCE_EXTENSION_INSTRUCTION"); });
};\n`);
    write(skill, "---\nname: runtime-guide\ndescription: RESOURCE_SKILL_DESCRIPTION\ndisable-model-invocation: false\nmetadata:\n  authored: preserved\n---\nRESOURCE_SKILL_BODY\n");
    const unseenSkill = write(join(pkg, "late/unseen/SKILL.md"), "---\nname: unseen-runtime-guide\ndescription: UNSEEN_SKILL_DESCRIPTION\n---\nUNSEEN_SKILL_BODY\n");
    const prompt = write(join(pkg, "prompts/keep.md"), "NATIVE_TEMPLATE_BODY\n");
    const manifest = write(join(pkg, "package.json"), JSON.stringify({ name: "synthetic-runtime-managed", type: "module", pi: { extensions: ["extensions/main.js"], skills: ["skills/guide"], prompts: ["prompts/keep.md"] } }));
    const settings = write(join(agentDir, "settings.json"), JSON.stringify({ packages: [{ source: pkg, extensions: nativeOff ? [] : ["extensions/main.js"], skills: [], prompts: ["prompts/keep.md"], themes: [] }],
      cacheWarming: "off", enableInstallTelemetry: false, compaction: { enabled: false }, retry: { enabled: false }, defaultProvider: "synthetic-bootstrap", defaultModel: "bootstrap", enabledModels: ["synthetic-bootstrap/bootstrap", "resource-fixture/probe"] }));
    const metadata = write(join(agentDir, "resource-catalog.json"), JSON.stringify({ version: 1, groups: [], packages: [{ source: pkg, name: "synthetic-runtime-managed", group: null, managedBy: "nix" }],
      resources: [{ kind: "extension", package: pkg, path: "extensions/main.js", managedBy: "nix" }, { kind: "skill", package: pkg, path: "skills/guide/SKILL.md", managedBy: "nix" }] }));
    const auth = write(join(agentDir, "auth.json"), "{}");
    const models = write(join(agentDir, "models.json"), JSON.stringify({ providers: { "synthetic-bootstrap": { api: "anthropic-messages", baseUrl: "https://synthetic-unused.invalid", apiKey: "synthetic-unused-key",
      models: [{ id: "bootstrap", name: "Bootstrap", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }] } } }));
    const files = [ext, skill, unseenSkill, prompt, manifest, settings, metadata, control, auth, models];
    const bytes = () => files.map(path => [path, fs.statSync(path).mode, fs.readFileSync(path).toString("base64")]);
    const before = bytes();
    const sdk = await import("@earendil-works/pi-coding-agent"), ai = await import("@earendil-works/pi-ai");
    for (const name of ["install", "installAndPersist", "remove", "removeAndPersist", "update"]) deny(sdk.DefaultPackageManager.prototype, name);
    const jiti = createJiti(import.meta.url, { fsCache: false, alias: { "@": fileURLToPath(new URL("../../", import.meta.url)) }, nativeModules: ["@earendil-works/pi-coding-agent"] });
    const api = await jiti.import("./api.ts"), rpc = await jiti.import("../rpc-manager.ts"), ingress = await jiti.import("../../app/api/agent/[id]/route.ts"), route = await jiti.import("../../app/api/agent-resources/route.ts");
    (await jiti.import("../file-access.ts")).allowFileRoot(cwd);
    const patch = async body => {
      const response = await route.PATCH(new Request("http://localhost/api/agent-resources", { method: "PATCH", headers: { host: "localhost", "content-type": "application/json" }, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    };
    const change = async (view, kind, scope, choice) => {
      const path = kind === "package" ? pkg : kind === "skill" ? skill : ext;
      const result = await patch({ cwd, ...(view.context.sessionId ? { sessionId: view.context.sessionId } : {}), selectionKey: view.catalog.rows.find(row => row.kind === kind && row.path === path).selectionKey,
        scope, choice, revision: view.scopes[scope].revision, contextToken: view.contextToken });
      assert.equal(result.status, 200, result.body.error); return result.body;
    };
    const apply = id => patch({ cwd, sessionId: id, action: "apply" });
    const busy = async id => { const result = await apply(id); assert.equal(result.status, 409, result.body.error); assert.match(result.body.error, /unsettled|while work/); };
    const open = async (id, file = "", options = {}) => { const started = await native.start(rpc, id, file, file ? undefined : cwd, options); await started.session.waitUntilReady(); return started.session; };
    const issue = async (wrapper, text, included, options = {}) => {
      const faux = state.providers.get(wrapper.sessionId); assert.ok(faux);
      await wrapper.inner.setModel(faux.getModel("probe"));
      const previous = requests.length;
      faux.setResponses([async context => {
        const definitions = ai.getCurrentTools(context.messages), tools = definitions.map(tool => tool.name), system = ai.getCurrentSystemPrompt(context.messages), user = context.messages.findLast(message => message.role === "user");
        const userText = typeof user.content === "string" ? user.content : user.content.filter(part => part.type === "text").map(part => part.text).join("\n");
        requests.push({ tools, definitions, system, userText, content: user.content, messages: context.messages });
        if (text === "RESOURCE_HELD_ACCEPTED" && !state.holdAtInput) await state.held();
        return ai.fauxAssistantMessage("Synthetic answer");
      }]);
      await wrapper.inner.prompt(text, { source: "rpc", ...options });
      assert.equal(requests.length, previous + 1, wrapper.inner.getLastAssistantText());
      const request = requests.at(-1);
      assert.equal(request.tools.includes("retained_control"), true); assert.equal(request.tools.includes("resource_probe"), included);
      assert.equal(request.definitions.some(tool => tool.description.includes("RESOURCE_EXTENSION_DESCRIPTION")), included);
      for (const marker of ["RESOURCE_EXTENSION_SNIPPET", "RESOURCE_EXTENSION_GUIDELINE", "RESOURCE_EXTENSION_INSTRUCTION", "RESOURCE_SKILL_DESCRIPTION"]) assert.equal(request.system.includes(marker), included, marker);
      return request;
    };
    let view = await api.getResourceInventory({ cwd });
    assert.equal(view.catalog.rows.find(row => row.path === ext).nativeEnabled, !nativeOff);
    assert.equal(view.catalog.rows.find(row => row.path === skill).nativeEnabled, false);
    for (const kind of ["package", "extension", "skill"]) view = await change(view, kind, "global", "enabled");
    if (children) {
      write(join(agentDir, "agents/settings.json"), JSON.stringify({ builtInEnabled: true, maxConcurrent: 1 }));
      write(join(agentDir, "agents/resource-child.md"), "---\ndescription: Resource child\ntools: read\nload_skills: true\nload_extensions: false\n---\nComplete the task.\n");
    }
    let first = await open(`__new__${randomUUID()}`, "", { toolNames: nativeOff ? ["read"] : ["read", "bash"], ...(!nativeOff ? { nativeResources: { version: 1, codeMode: true, mcpServers: [] } } : {}) });
    assert.ok(first.inner.resourceLoader.getExtensions().extensions.some(extension => extension.path === "<inline:brabbler-session-references>"));
    await issue(first, "RESOURCE_ORDINARY_ON", true);
    assert.match((await issue(first, "/skill:runtime-guide on", true)).userText, /RESOURCE_SKILL_BODY/);
    assert.match((await issue(first, "/keep", true)).userText, /NATIVE_TEMPLATE_BODY/);
    const id = first.sessionId, file = first.sessionFile; assert.ok(fs.existsSync(file));
    if (children) {
      // The fresh parent's construction predates its saved own-Session binding.
      // Reopen that actual saved identity, rather than fabricating a matched receipt.
      await native.close(first); first = await open(id, file);
      // Actual managed built-in explore: desired Enabled and matching receipts
      // must not imply membership through its independent no-skills/extensions ceiling.
      const exploreIds = new Set();
      const unwatch = first.onEvent(event => {
        const details = (event.partialResult ?? event.result)?.details;
        if (details?.kind === "brabbler-subagent") {
          exploreIds.add(details.sessionId);
          const child = rpc.getRpcSession(details.sessionId); if (child) native.owned.add(child);
        }
      });
      try {
        state.providers.get(id).setResponses([
          ai.fauxAssistantMessage([ai.fauxToolCall("Agent", { subagent_type: "explore", prompt: "Inspect without resources", description: "Restricted reporting control", run_in_background: false })], { stopReason: "toolUse" }),
          ai.fauxAssistantMessage("Explore done"), ai.fauxAssistantMessage("Parent done"),
        ]);
        await first.inner.prompt("PROFILE_INCLUSION_REPORTING");
      } finally { unwatch(); }
      assert.equal(exploreIds.size, 1, "actual Agent creates one restricted child");
      const exploreId = [...exploreIds][0], explore = rpc.getRpcSession(exploreId);
      assert.ok(explore); await explore.waitUntilReady();
      assert.equal(explore.inner.resourceLoader.getSkills().skills.some(entry => entry.filePath === skill), false);
      assert.equal(explore.inner.resourceLoader.getExtensions().extensions.some(entry => entry.path === ext), false);
      for (const [sessionId, included] of [[id, true], [exploreId, false]]) {
        const response = await route.GET(new Request(`http://localhost/api/agent-resources?${new URLSearchParams({ cwd, sessionId })}`, { headers: { host: "localhost" } }));
        const status = await response.json(); assert.equal(response.status, 200, status.error);
        assert.equal(status.runtime.state, "applied");
        assert.equal(status.runtime.appliedRevision, status.runtime.savedRevision);
        for (const path of [skill, ext]) {
          const row = status.catalog.rows.find(row => row.path === path);
          assert.equal(row.desired.enabled, true, "management choice stays independently Enabled");
          assert.equal(status.runtime.includedKeys.includes(row.selectionKey), included, "only actual public loaded membership earns inclusion evidence");
        }
      }
      // The store invalidates old edit tokens on row deletion, but another live
      // session's actual resource selection did not change.
      const beforeReset = await api.getResourceInventory({ cwd, sessionId: exploreId });
      const explicit = await change(await api.getResourceInventory({ cwd, sessionId: id }), "skill", "session", "disabled");
      await change(explicit, "skill", "session", "inherit");
      const afterReset = await api.getResourceInventory({ cwd, sessionId: exploreId });
      assert.notEqual(afterReset.scopes.session.revision, beforeReset.scopes.session.revision);
      assert.equal(afterReset.runtime.state, "applied");
      assert.equal(afterReset.runtime.savedRevision, beforeReset.runtime.savedRevision);
    }
    if (reopen) {
      await native.close(first); const primed = await open(id, file);
      const previous = (await api.getResourceInventory({ cwd, sessionId: id })).runtime;
      await native.close(primed);
      const bindingEntered = deferred(), bindingRelease = deferred(); native.release(() => bindingRelease.resolve());
      state.binding = async () => { bindingEntered.resolve(); await bindingRelease.promise; throw new Error("R1_REOPEN_BIND_FAILURE"); };
      const replacement = (await native.start(rpc, id, file, undefined)).session;
      native.expectBindingFailure(replacement, "session_start: R1_REOPEN_BIND_FAILURE");
      const readiness = assert.rejects(replacement.waitUntilReady(), /R1_REOPEN_BIND_FAILURE/); native.join(() => readiness);
      await Promise.race([bindingEntered.promise, readiness.then(() => { throw new Error("Reopen readiness settled before its binding gate"); })]);
      const held = (await api.getResourceInventory({ cwd, sessionId: id })).runtime;
      assert.equal(held.savedRevision, previous.appliedRevision); assert.equal(held.state, "starting"); assert.equal(held.appliedRevision, null);
      bindingRelease.resolve(); await readiness;
      const failed = (await api.getResourceInventory({ cwd, sessionId: id })).runtime;
      assert.equal(failed.state, "error"); assert.equal(failed.appliedRevision, null); await native.close(replacement);
      assert.deepEqual(bytes(), before); assert.deepEqual(forbidden, []); return;
    }
    const sibling = !nativeOff && !failure ? await open(`__new__${randomUUID()}`, "", { toolNames: ["read"] }) : undefined;
    if (sibling) sibling.persistInitialSession();
    // A genuine 1x1 PNG: accepted and deferred image bytes must survive naturally.
    const chunk = (name, data) => {
      const body = Buffer.concat([Buffer.from(name), data]); let crc = 0xffffffff;
      for (const byte of body) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
      const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); body.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
    };
    const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
    const image = { type: "image", mimeType: "image/png", data: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))), chunk("IEND", Buffer.alloc(0))]).toString("base64") };
    const childFirst = deferred(), childSecond = deferred(), childRelease = deferred(), childQueued = deferred(), childIds = new Set(), childRequests = [];
    native.release(() => childRelease.resolve());
    let queuedChildId, queuedOwner;
    const childFailure = deferred();
    const failedChild = childFailure.promise.then(result => { throw new Error(`Actual Agent tool failed before child admission: ${JSON.stringify(result)}`); });
    void failedChild.catch(error => native.fail(error));
    const unsubscribe = first.onEvent(event => {
      if (event.type === "tool_execution_end" && event.toolName === "Agent" && (event.isError || event.result?.isError)) childFailure.resolve(event.result);
      const details = (event.partialResult ?? event.result)?.details;
      if (details?.kind === "brabbler-subagent") {
        childIds.add(details.sessionId); const child = rpc.getRpcSession(details.sessionId); if (child) native.owned.add(child);
        if (details.status === "queued" && childIds.size === 2) { queuedChildId = details.sessionId; childQueued.resolve(); }
      }
    }); native.restore(unsubscribe);
    let held;
    if (children) {
      // Save after the parent's runtime was admitted: new children must use the
      // CURRENT own Session choice, not the live parent's older loaded selection.
      view = await change(await api.getResourceInventory({ cwd, sessionId: id }), "skill", "session", "disabled");
      // Exercise the same fork owner with an actual host and canonical saved
      // contexts, not only the controlled RPC fixture. Both anchors predate Off.
      const historical = first.inner.sessionManager.getEntries();
      for (const [type, role] of [["fork", "user"], ["fork_branch", "assistant"]]) {
        const entryId = historical.find(entry => entry.type === "message" && entry.message.role === role).id;
        const result = await first.send({ type, entryId });
        assert.equal(result.cancelled, false); assert.notEqual(result.newSessionId, id);
        const savedFork = await api.getResourceInventory({ cwd, sessionId: result.newSessionId });
        const skillKey = savedFork.catalog.rows.find(row => row.path === skill).selectionKey;
        assert.deepEqual(savedFork.scopes.session.ownChoices, [{ selectionKey: skillKey, choice: "disabled" }], "fork copies current own choice, not the historical branch or live applied selection");
      }
      const reply = async (context, entry, gate) => { childRequests.push(ai.getCurrentSystemPrompt(context.messages)); entry.resolve(); await gate; return ai.fauxAssistantMessage("Child done"); };
      state.providers.get(id).setResponses([
        ai.fauxAssistantMessage(["one", "two"].map(name => ai.fauxToolCall("Agent", { subagent_type: "resource-child", prompt: `CHILD_${name}`, description: name, run_in_background: false })), { stopReason: "toolUse" }),
        context => reply(context, childFirst, release.promise), context => reply(context, childSecond, childRelease.promise), ai.fauxAssistantMessage("Parent done"),
      ]);
      held = first.inner.prompt("RESOURCE_CHILD_PARENT");
    } else held = issue(first, "RESOURCE_HELD_ACCEPTED", true, { images: [image] });
    void held.catch(error => native.fail(error)); native.join(() => held);
    if (children) await Promise.race([Promise.all([childFirst.promise, childQueued.promise]), failedChild, held.then(() => { throw new Error("Missing real queued child"); })]);
    else await Promise.race([entered.promise, held.then(() => { throw new Error("Prompt settled before reaching held input"); })]);
    view = await api.getResourceInventory({ cwd, sessionId: id }); const oldRevision = view.runtime.appliedRevision;
    view = await change(view, "package", nativeOff && !children ? "session" : "global", "disabled");
    assert.equal(view.runtime.state, "saved"); assert.equal(view.runtime.appliedRevision, oldRevision); assert.notEqual(view.runtime.savedRevision, oldRevision);
    await busy(id); assert.equal(rpc.getRpcSession(id), first, "busy Apply did not retire or enqueue replacement");
    if (children) {
      view = await change(view, "skill", "session", "enabled"); // later parent edits never recopy an admitted child
      queuedOwner = rpc.getRpcSession(queuedChildId); await queuedOwner.waitUntilReady();
      const copied = await api.getResourceInventory({ cwd, sessionId: queuedChildId });
      const skillKey = copied.catalog.rows.find(row => row.path === skill).selectionKey;
      assert.deepEqual(copied.scopes.session.ownChoices, [{ selectionKey: skillKey, choice: "disabled" }]);
      assert.equal(queuedOwner.isRunning(), false, "queued child is not represented by the streaming/running flag");
      await busy(queuedChildId); // Its own admitted queue record must fence Apply.
    }
    const acceptedQueue = [];
    if (!children) {
      const response = context => { acceptedQueue.push({ messages: context.messages, tools: ai.getCurrentTools(context.messages).map(tool => tool.name) }); return ai.fauxAssistantMessage("Accepted queue done"); };
      state.providers.get(id).appendResponses([response, response]);
      const result = await ingress.POST(new Request(`http://localhost/api/agent/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "follow_up", message: "/skill:runtime-guide ACCEPTED_AFTER_SAVE", images: [image] }) }), { params: Promise.resolve({ id }) });
      const body = await result.json(); assert.equal(body.success, true, body.error);
    }
    release.resolve();
    if (children) {
      await Promise.race([childSecond.promise, failedChild, held.then(() => { throw new Error("Queued child did not start"); })]);
      await busy(id); assert.equal(childRequests.length, 2); for (const system of childRequests) assert.doesNotMatch(system, /RESOURCE_SKILL_DESCRIPTION/);
      childRelease.resolve();
    }
    const accepted = await held;
    if (!children) {
      assert.equal(accepted.userText, "RESOURCE_HELD_ACCEPTED"); assert.ok(accepted.content.some(part => part.type === "image" && part.data === image.data));
      const delivered = JSON.stringify(acceptedQueue); for (const marker of ["ACCEPTED_AFTER_SAVE", "RESOURCE_SKILL_BODY", image.data]) assert.ok(delivered.includes(marker));
    }
    assert.equal(rpc.getRpcSession(id), first, "settling old work must not run the refused Apply later");
    if (queuedOwner) {
      assert.equal(rpc.getRpcSession(queuedChildId), queuedOwner, "queued-child busy refusal is never retried at settlement");
      const childFile = queuedOwner.sessionFile;
      await native.close(queuedOwner);
      const reopened = await open(queuedChildId, childFile);
      const saved = await api.getResourceInventory({ cwd, sessionId: queuedChildId });
      assert.equal(saved.scopes.session.ownChoices.length, 1); assert.equal(saved.scopes.session.ownChoices[0].choice, "disabled");
      assert.equal(reopened.inner.resourceLoader.getSkills().skills.some(entry => entry.filePath === skill), false);
      await native.close(reopened);
    }
    if (sibling) assert.equal(rpc.getRpcSession(sibling.sessionId), sibling, "Global save never broadcasts a replacement");
    // PUBLIC nextTurn remains in SDK custody; no conversion, cloning or replay.
    await first.inner.sendCustomMessage({ customType: "deferred-context", content: [{ type: "text", text: "PUBLIC_NEXT_TURN" }, image], display: true }, { deliverAs: "nextTurn" });
    await busy(id);
    const drained = await issue(first, "DRAIN_PUBLIC_DEFERRED_CONTEXT", true);
    assert.ok(JSON.stringify(drained.messages).includes("PUBLIC_NEXT_TURN")); assert.ok(JSON.stringify(drained.messages).includes(image.data));
    assert.equal(rpc.getRpcSession(id), first, "ordinary deferred consumption is not an Apply trigger");
    const effectEntered = deferred(), effectRelease = deferred(); native.release(() => effectRelease.resolve());
    state.standalone = async () => { effectEntered.resolve(); await effectRelease.promise; };
    const effect = first.inner.extensionRunner.createToolContext().executeTool("retained_hold", {});
    void effect.catch(error => native.fail(error)); native.join(() => effect);
    await Promise.race([effectEntered.promise, effect.then(() => { throw new Error("Standalone effect settled before its execution gate"); })]);
    assert.equal(first.isRunning(), false); await busy(id); effectRelease.resolve(); await effect;
    assert.equal(rpc.getRpcSession(id), first, "standalone settlement cannot retry Apply");
    const priorModel = [first.inner.model.provider, first.inner.model.id];
    const priorThinking = first.inner.agent.state.thinkingLevel;
    const priorNative = (await first.send({ type: "get_state" })).nativeResources;
    if (!nativeOff) state.holdRetirementId = id;
    const applying = apply(id); native.join(async () => { await applying; const current = rpc.getRpcSession(id); if (current) native.owned.add(current); });
    if (!nativeOff) {
      await Promise.race([retirementEntered.promise, applying.then(() => { throw new Error("Apply missed native retirement gate"); })]);
      const response = await ingress.POST(new Request(`http://localhost/api/agent/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "prompt", message: "REFUSED_DURING_APPLY" }) }), { params: Promise.resolve({ id }) });
      const rejected = await response.json(); assert.equal(rejected.accepted, false); assert.match(rejected.error, /Apply is in progress/);
      const status = (await api.getResourceInventory({ cwd, sessionId: id })).runtime; assert.equal(status.state, "applying"); assert.equal(status.appliedRevision, null); assert.equal(status.applyingRevision, view.runtime.savedRevision);
      if (failure) fs.utimesSync(metadata, new Date(0), new Date(0)); retirementRelease.resolve();
    }
    const applied = await applying;
    if (failure) {
      assert.equal(applied.status, 503); const status = (await api.getResourceInventory({ cwd, sessionId: id })).runtime;
      assert.equal(status.state, "error"); assert.equal(status.appliedRevision, null); assert.equal(rpc.getRpcSession(id), undefined);
      assert.equal((await apply(id)).status, 409); assert.deepEqual(bytes(), before); assert.deepEqual(forbidden, []); return;
    }
    assert.equal(applied.status, 200, applied.body.error); assert.equal(applied.body.runtime.state, "applied");
    assert.equal(applied.body.runtime.appliedRevision, applied.body.runtime.savedRevision);
    for (const row of applied.body.catalog.rows.filter(row => [skill, ext].includes(row.path))) {
      assert.equal(applied.body.runtime.includedKeys.includes(row.selectionKey), false, "Apply receipt observes actual removal, not revision equality");
    }
    const replaced = rpc.getRpcSession(id); assert.ok(replaced); native.owned.add(replaced); await replaced.waitUntilReady();
    assert.notEqual(replaced, first); assert.equal(replaced.sessionId, id); assert.equal(replaced.sessionFile, file);
    assert.deepEqual([replaced.inner.model.provider, replaced.inner.model.id], priorModel);
    assert.equal(replaced.inner.agent.state.thinkingLevel, priorThinking);
    assert.deepEqual((await replaced.send({ type: "get_state" })).nativeResources, priorNative);
    assert.equal(replaced.hasNativeSessionTools(), !nativeOff);
    if (!nativeOff) assert.equal(replaced.hasNativeSessionTools(), true);
    if (sibling) { assert.equal(rpc.getRpcSession(sibling.sessionId), sibling); await issue(sibling, "SIBLING_REMAINS_OLD", true); await native.close(sibling); }
    const loaded = replaced.inner.resourceLoader.getExtensions(); assert.deepEqual(loaded.errors, []); assert.equal(loaded.extensions.some(extension => extension.path === ext), false);
    const counts = { starts: state.starts, inputs: state.inputs };
    const off = await issue(replaced, "RESOURCE_ORDINARY_OFF", false);
    if (!nativeOff) { assert.equal(off.tools.includes("codemode"), true); assert.equal(off.tools.includes("bash"), true); assert.equal(off.definitions.find(tool => tool.name === "bash").description.includes("EXTERNAL_BASH_DESCRIPTION"), false); }
    assert.equal((await issue(replaced, "/skill:runtime-guide off", false)).userText, "/skill:runtime-guide off");
    assert.deepEqual({ starts: state.starts, inputs: state.inputs }, counts);
    assert.match((await issue(replaced, "/keep", false)).userText, /NATIVE_TEMPLATE_BODY/);
    assert.ok(replaced.inner.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("RESOURCE_SKILL_BODY")), "already consumed instructions remain history");
    assert.ok(state.discoveries >= 2);
    if (nativeOff) { state.extraSkills = [unseenSkill]; const count = state.discoveries; await assert.rejects(replaced.inner.reload(), /unbound skill candidate/); assert.ok(state.discoveries > count); state.extraSkills = []; }
    await native.close(replaced);
    assert.equal((await api.getResourceInventory({ cwd, sessionId: id })).runtime.state, "on-open", "closed owner is not an applied receipt");
    if (nativeOff && !children) { const cold = await open(id, file); await issue(cold, "COLD_REOPEN_SAVED_OFF", false); await native.close(cold); }
    // Saved child profile/tool ceilings retain the committed cold-start obligation.
    const { persistChildSession } = await jiti.import("../subagent-lifecycle.ts"), { SUBAGENT_META_TYPE } = await jiti.import("../subagents.ts");
    const manager = sdk.SessionManager.create(cwd); manager.appendModelChange("synthetic-bootstrap", "bootstrap");
    manager.appendCustomEntry(SUBAGENT_META_TYPE, { version: 1, parentSessionId: id, parentSessionPath: file, parentToolCallId: "profile", profile: "no-resources", description: "Profile ceiling", task: "No loading", runInBackground: false,
      createdAt: new Date().toISOString(), turnLimit: 0, resourceSnapshot: { version: 1, appendSystemPrompt: ["SAVED_CHILD_PROMPT"], exactSystemPrompt: "SAVED_CHILD_PROMPT", tools: ["read"], loadSkills: false, loadExtensions: false } });
    persistChildSession(manager); const child = await open(manager.getSessionId(), manager.getSessionFile());
    assert.deepEqual(child.inner.getActiveToolNames(), ["read"]); assert.equal(child.inner.resourceLoader.getExtensions().extensions.some(extension => [ext, control].includes(extension.path)), false);
    assert.equal((await child.send({ type: "get_state" })).systemPrompt, "SAVED_CHILD_PROMPT"); await native.close(child);
    assert.deepEqual(bytes(), before, "native/authored bytes and modes unchanged"); assert.deepEqual(forbidden, []);
  } catch (error) { console.error("Resource runtime primary failure:", error); native.fail(error); throw error; }
  finally { try { await native.finish(); } catch (error) { console.error("Resource runtime closure failure:", error); throw error; } }
});
