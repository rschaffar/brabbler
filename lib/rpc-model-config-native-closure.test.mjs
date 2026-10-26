// Contained owner controls. These invoke the SAME backendCase removal boundary
// and model-config fixture as the integration entry, not a copied rm algorithm.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { SessionManager, createAgentSessionServices, createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import { deferred } from "./testing/async.fixture.mjs";
import { ownedBackendNativeRoot } from "./backend-native-root.fixture.mjs";
import { rpcModelConfigNative } from "./rpc-model-config-native.fixture.mjs";

const rpc = await createJiti(import.meta.url, { fsCache: false, tsconfigPaths: true }).import("./rpc-manager.ts");
function capturedCase() {
  const hooks = [];
  let closing;
  return {
    t: { after: hook => hooks.push(hook) },
    close() {
      if (!closing) {
        closing = (async () => { for (const hook of hooks) await hook(); })();
        void closing.catch(() => {});
      }
      return closing;
    },
  };
}
function causes(error) {
  return error instanceof AggregateError ? error.errors.flatMap(causes) : [error];
}
function originalCauses(error, expected) {
  // Exact reference membership, not structural Error equality. The same cause
  // may be registered at independent owner boundaries; no multiplicity claim.
  const actual = new Set(causes(error));
  assert.equal(actual.size, expected.length, 'complete original cause identity set');
  for (const cause of expected) assert.equal(actual.has(cause), true, 'retain the SAME original Error object');
}
function rootPresent(root) {
  const rootExists = existsSync(root);
  assert.equal(rootExists, true, JSON.stringify({ earlyRm: !rootExists, rootExists }));
}

async function domain(scope, directory) {
  const owner = rpcModelConfigNative(scope.t, { directory, prefix: "model-control-", label: "Model-config owner control" });
  const previousEnvironment = process.env, previousFetch = globalThis.fetch;
  const previousActivity = globalThis.__piActivityReviewPersistenceFailed;
  owner.restore(() => { process.env = previousEnvironment; });
  owner.restore(() => { globalThis.fetch = previousFetch; });
  owner.restore(() => {
    if (previousActivity === undefined) delete globalThis.__piActivityReviewPersistenceFailed;
    else globalThis.__piActivityReviewPersistenceFailed = previousActivity;
  });
  try {
    const root = await owner.provision(), agentDir = join(root, "agent"), cwd = join(root, "project");
    owner.watchLoader();
    process.env = { PATH: previousEnvironment.PATH ?? "", HOME: root, XDG_CONFIG_HOME: join(root, "config"),
      TMPDIR: root, TMP: root, TEMP: root, JITI_FS_CACHE: "0", PI_CODING_AGENT_DIR: agentDir,
      PI_CODING_AGENT_SESSION_DIR: join(agentDir, "sessions"), PI_OFFLINE: "1" };
    globalThis.fetch = async () => { throw new Error("Owner controls must not use HTTP"); };
    await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
    await writeFile(join(agentDir, "auth.json"), "{}", { mode: 0o600 });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ cacheWarming: "off", enableInstallTelemetry: false,
      compaction: { enabled: false }, retry: { enabled: false }, defaultProvider: "synthetic-closure", defaultModel: "unused" }), { mode: 0o600 });
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "synthetic-closure": {
      api: "anthropic-messages", baseUrl: "http://127.0.0.1:9/unused", apiKey: "synthetic-unused-key",
      models: [{ id: "unused", name: "Owner control only", reasoning: false, input: ["text"], contextWindow: 128000, maxTokens: 4096 }],
    } } }), { mode: 0o600 });
    return { owner, root, agentDir, cwd };
  } catch (error) { owner.fail(error); throw error; }
}

async function realWrapper(f, name, onShutdown = async () => {}) {
  const manager = SessionManager.create(f.cwd, join(f.agentDir, name));
  const services = await f.owner.servicesStart(() => createAgentSessionServices({ cwd: f.cwd, agentDir: f.agentDir,
    resourceLoaderOptions: { noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
      extensionFactories: [{ name: `model-owner-${name}`, factory(pi) {
        pi.on("session_shutdown", async () => { await onShutdown(); });
      } }],
    } }));
  const { session: inner } = await f.owner.rawStart(() => createAgentSessionFromServices({ services, sessionManager: manager,
    model: services.modelRuntime.getModel("synthetic-closure", "unused"), tools: [] }));
  const wrapper = new rpc.AgentSessionWrapper(inner);
  f.owner.owned.add(wrapper); // Before start/binding can admit native work.
  wrapper.start(); wrapper.beginExtensionBinding();
  await wrapper.waitUntilReady();
  return wrapper;
}

// Original methods are joined separately in the outer proof. Fault markers are
// thrown AFTER real SDK abort/public retirement, not instead of those operations.
test("model-config real owner retains setup/body, abort, shutdown and restore identities while an independent native peer completes", { timeout: 10000 }, async t => {
  const native = await ownedBackendNativeRoot(t), scope = capturedCase();
  const bodyMarker = new Error("exact model-config setup/body marker");
  const abortMarker = new Error("exact model-config abort marker");
  const shutdownMarker = new Error("exact model-config shutdown marker");
  const restoreMarker = new Error("exact model-config restore marker");
  const entered = deferred(), gate = deferred(), restores = [], wrappers = [];
  let f, closing, result, bad, peer, originalAbort, originalShutdown, peerFinished = false, proved = false;
  const settleActual = async () => {
    gate.resolve();
    await Promise.allSettled([closing ?? scope.close()]);
    const results = await Promise.allSettled(wrappers.map(async wrapper => {
      await wrapper.waitUntilReady();
      if (wrapper === bad) {
        await originalAbort.call(wrapper.inner); await originalShutdown.call(wrapper);
      } else { await wrapper.inner.abort(); await wrapper.shutdown(); }
    }));
    const errors = results.filter(value => value.status === "rejected").map(value => value.reason);
    if (errors.length) throw new AggregateError(errors, "Independent actual SDK control join failed");
  };
  native.closeWith(async () => {
    await settleActual();
    assert.equal(proved, true);
    rootPresent(f.root);
    originalCauses(result.error, [bodyMarker, abortMarker, shutdownMarker, restoreMarker]);
    assert.deepEqual(restores, ["failed restore attempted", "independent restore attempted"]);
    assert.equal(peerFinished, true); assert.equal(peer.isAlive(), false); assert.equal(bad.isAlive(), false);
    assert.equal(await readFile(join(f.root, "peer.shutdown"), "utf8"), "joined\n");
  });
  try {
    f = await domain(scope, native.root);
    bad = await realWrapper(f, "bad"); wrappers.push(bad);
    peer = await realWrapper(f, "peer", async () => {
      entered.resolve(); await gate.promise;
      await writeFile(join(f.root, "peer.shutdown"), "joined\n"); peerFinished = true;
    }); wrappers.push(peer);
    originalAbort = bad.inner.abort; originalShutdown = bad.shutdown;
    f.owner.restore(() => { bad.inner.abort = originalAbort; });
    f.owner.restore(() => { bad.shutdown = originalShutdown; });
    bad.inner.abort = async function (...args) { await Reflect.apply(originalAbort, this, args); throw abortMarker; };
    bad.shutdown = async function (...args) { await Reflect.apply(originalShutdown, this, args); throw shutdownMarker; };
    f.owner.restore(() => { restores.push("failed restore attempted"); throw restoreMarker; });
    f.owner.restore(() => { restores.push("independent restore attempted"); });
    try { throw bodyMarker; } catch (error) { f.owner.fail(error); }
    closing = scope.close();
    let ended = false;
    const observed = closing.then(() => ({ ok: true }), error => ({ error }));
    void observed.then(() => { ended = true; });
    // Omitted real-owner join races to actual removal, rather than hanging here.
    await Promise.race([entered.promise, observed]);
    rootPresent(f.root); assert.equal(ended, false);
    gate.resolve(); result = await observed;
    rootPresent(f.root); // Unconditional-rm fault: {earlyRm:true,rootExists:false}.
    originalCauses(result.error, [bodyMarker, abortMarker, shutdownMarker, restoreMarker]);
    assert.equal(peerFinished, true); assert.equal(peer.isAlive(), false);
    assert.deepEqual(restores, ["failed restore attempted", "independent restore attempted"]);
    proved = true;
  } finally { await settleActual(); }
});

test("model-config actual extension/native completion precedes root rm; omitted join is a rootExists false scalar", { timeout: 10000 }, async t => {
  const native = await ownedBackendNativeRoot(t), scope = capturedCase();
  const entered = deferred(), gate = deferred(), wrappers = [];
  let f, closing, wrapper, nativeFinished = false, proved = false;
  const settleActual = async () => {
    gate.resolve();
    await Promise.allSettled([closing ?? scope.close()]);
    // The same real wrapper is independently joined even when the fixture join
    // was removed. This fallback NEVER grants the inner owner permission to rm.
    await Promise.allSettled(wrappers.map(async value => {
      await value.waitUntilReady(); await value.inner.abort(); await value.shutdown();
    }));
  };
  native.closeWith(async () => {
    await settleActual();
    assert.equal(proved, true); assert.equal(nativeFinished, true);
    assert.equal(wrapper.isAlive(), false); assert.equal(existsSync(f.root), false);
  });
  try {
    f = await domain(scope, native.root);
    wrapper = await realWrapper(f, "held", async () => {
      entered.resolve(); await gate.promise;
      await writeFile(join(f.root, "native.shutdown"), "joined\n"); nativeFinished = true;
    }); wrappers.push(wrapper);
    closing = scope.close();
    const observed = closing.then(() => ({ ok: true }), error => ({ error }));
    await Promise.race([entered.promise, observed]);
    // Report the scalar BEFORE fallback cleanup can encounter an already-removed
    // directory. Do not accept a generic ENOENT, timeout, or absent callback.
    rootPresent(f.root);
    assert.equal(nativeFinished, false); assert.equal(wrapper.isAlive(), true);
    gate.resolve();
    const result = await observed;
    if (result.error) throw result.error;
    assert.equal(nativeFinished, true); assert.equal(wrapper.isAlive(), false);
    assert.equal(existsSync(f.root), false);
    proved = true;
  } finally { await settleActual(); }
});

test("model-config early setup failure preserves original identity and root while independent restorations run", { timeout: 10000 }, async t => {
  const native = await ownedBackendNativeRoot(t), scope = capturedCase();
  const owner = rpcModelConfigNative(scope.t, { directory: native.root, prefix: "early-setup-", label: "Early setup control" });
  const marker = new Error("exact pre-mkdir setup marker"), restored = [];
  let root, result, proved = false;
  native.closeWith(async () => {
    await Promise.allSettled([scope.close()]);
    assert.equal(proved, true); rootPresent(root);
    originalCauses(result.error, [marker]); assert.deepEqual(restored, [1, 2]);
  });
  try {
    root = await owner.provision();
    owner.restore(() => { restored.push(1); }); owner.restore(() => { restored.push(2); });
    try { throw marker; } catch (error) { owner.fail(error); }
    result = await scope.close().then(() => ({ ok: true }), error => ({ error }));
    rootPresent(root); originalCauses(result.error, [marker]); assert.deepEqual(restored, [1, 2]);
    proved = true;
  } finally { await Promise.allSettled([scope.close()]); }
});
