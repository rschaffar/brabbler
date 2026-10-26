// Separate contained control, not an extra variant of the original speed case.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
import { ownedBackendNativeRoot } from "./backend-native-root.fixture.mjs";
import { speedLifecycleNative } from "./session-model-speed-native.fixture.mjs";
const rpc = await createJiti(import.meta.url, { fsCache: false, tsconfigPaths: true }).import("./rpc-manager.ts");
const leaves = error => error instanceof AggregateError ? error.errors.flatMap(leaves) : [error];
function originalCauses(error, expected) {
  const actual = new Set(leaves(error));
  // Name a missing ORIGINAL reference before cardinality can obscure it.
  // Expected values are these five local Error sentinels, not native graphs.
  for (const cause of expected) assert.equal(actual.has(cause), true, `SAME original speed cleanup cause: ${cause.message}`);
  assert.equal(actual.size, expected.length, "complete original speed cleanup cause identity set");
}

test("speed native owner retains body/abort/idle/shutdown/restore originals and joins the independent shutdown peer", { timeout: 10000 }, async t => {
  const outer = await ownedBackendNativeRoot(t);
  const native = speedLifecycleNative({ after() {} }, { directory: outer.root });
  const body = new Error("speed original body"), abort = new Error("speed original abort"), idle = new Error("speed original idle");
  const shutdown = new Error("speed original shutdown"), restore = new Error("speed original restore");
  const expected = [body, abort, idle, shutdown, restore], wrappers = [], restored = [];
  let root, release, entered, bad, peer, closing, result, proved = false, peerFinished = false;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = new Promise(resolve => { entered = resolve; });
  const originals = new Map();
  // Independent original-method fallback is rescue, never permission for the
  // inner conditional-rm owner to remove an uncertain root.
  const settleActual = async () => {
    release();
    await Promise.allSettled([closing ?? native.finish()]);
    const results = await Promise.allSettled(wrappers.map(async wrapper => {
      const errors = [], methods = originals.get(wrapper) ?? {
        abort: wrapper.inner.abort, idle: wrapper.inner.waitForIdle, shutdown: wrapper.shutdown,
      };
      try { await wrapper.waitUntilReady(); } catch (error) { errors.push(error); }
      try { await methods.abort.call(wrapper.inner); } catch (error) { errors.push(error); }
      try { await methods.idle.call(wrapper.inner); } catch (error) { errors.push(error); }
      try { await methods.shutdown.call(wrapper); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, "Independent actual speed cleanup failed");
    }));
    const errors = results.filter(value => value.status === "rejected").map(value => value.reason);
    if (errors.length) throw new AggregateError(errors, "Independent speed peers failed");
  };
  outer.closeWith(async () => {
    await settleActual();
    assert.equal(proved, true); assert.equal(existsSync(root), true, JSON.stringify({ rootExists: existsSync(root) }));
    originalCauses(result.error, expected);
    assert.equal(peerFinished, true); assert.equal(bad.isAlive(), false); assert.equal(peer.isAlive(), false);
    assert.equal(await readFile(join(root, "peer.shutdown"), "utf8"), "joined\n");
    assert.deepEqual(restored, [1, 2]);
  });
  const dirBefore = process.env.PI_CODING_AGENT_DIR, offlineBefore = process.env.PI_OFFLINE, fetchBefore = globalThis.fetch;
  native.release(release);
  native.restore(() => { if (dirBefore === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = dirBefore; });
  native.restore(() => { if (offlineBefore === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = offlineBefore; });
  native.restore(() => { globalThis.fetch = fetchBefore; });
  try {
    root = await native.provision();
    const agentDir = join(root, "agent"), cwd = join(root, "project");
    await mkdir(agentDir, { mode: 0o700 }); await mkdir(cwd, { mode: 0o700 });
    process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1";
    globalThis.fetch = async () => { throw new Error("Speed owner control must not call a provider"); };
    const accountId = "default-fixture";
    const credential = { type: "oauth", accountId, refresh: "fixture-not-real",
      access: `fixture.${Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url")}.not-real`,
      expires: Date.now() + 86_400_000 };
    await writeFile(join(agentDir, "auth.json"), JSON.stringify({ "openai-codex": credential }), { mode: 0o600 });
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "gpt-5.5",
      defaultThinkingLevel: "high", cacheWarming: "off", enableInstallTelemetry: false }), { mode: 0o600 });
    const start = () => native.operation("control RPC start", () => rpc.startRpcSession(`__new__${randomUUID()}`, "", cwd,
      { toolNames: [], modelSpeed: "fast", thinkingLevel: "high" }), value => {
        native.retain(value.session); wrappers.push(value.session);
      });
    bad = (await start()).session; peer = (await start()).session;
    await Promise.all(wrappers.map(wrapper => wrapper.waitUntilReady()));
    const methods = { abort: bad.inner.abort, idle: bad.inner.waitForIdle, shutdown: bad.shutdown };
    originals.set(bad, methods);
    native.restore(() => { bad.inner.abort = methods.abort; bad.inner.waitForIdle = methods.idle; bad.shutdown = methods.shutdown; });
    // Pinned SDK abort() itself awaits this.waitForIdle(). Inject each marker
    // only after its own top-level cleanup stage delegates the REAL native work;
    // an idle fault inside abort must not prevent reaching the abort marker.
    let delegatingAbort = 0;
    bad.inner.abort = async function (...args) {
      delegatingAbort++;
      try { await Reflect.apply(methods.abort, this, args); }
      finally { delegatingAbort--; }
      throw abort;
    };
    bad.inner.waitForIdle = async function (...args) {
      await Reflect.apply(methods.idle, this, args);
      if (delegatingAbort === 0) throw idle;
    };
    bad.shutdown = async function (...args) { await Reflect.apply(methods.shutdown, this, args); throw shutdown; };
    const runner = peer.inner.extensionRunner, emit = runner.emit;
    native.restore(() => { runner.emit = emit; });
    runner.emit = async function (event) {
      if (event.type !== "session_shutdown") return Reflect.apply(emit, this, [event]);
      entered(); await gate;
      const value = await Reflect.apply(emit, this, [event]);
      await writeFile(join(root, "peer.shutdown"), "joined\n"); peerFinished = true;
      return value;
    };
    native.restore(() => { restored.push(1); throw restore; });
    native.restore(() => { restored.push(2); });
    native.fail(body);
    closing = native.finish();
    const observed = closing.then(() => ({ ok: true }), error => ({ error }));
    // The owner's release callback must release before its wrapper joins; the
    // real peer still completes its actual shutdown and native write.
    await Promise.race([seen, observed]);
    result = await observed;
    assert.equal(existsSync(root), true, JSON.stringify({ rootExists: existsSync(root) }));
    originalCauses(result.error, expected);
    assert.equal(peerFinished, true); assert.deepEqual(restored, [1, 2]);
    assert.equal(process.env.PI_CODING_AGENT_DIR, dirBefore); assert.equal(process.env.PI_OFFLINE, offlineBefore);
    assert.equal(globalThis.fetch, fetchBefore);
    proved = true;
  } catch (error) { native.fail(error); throw error; }
  finally { await settleActual(); }
});
