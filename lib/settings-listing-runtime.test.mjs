import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import { loadTsModule } from "./sse-stream.fixture.mjs";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const turn = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  let agentDir = "/synthetic-agent", now = 0, builds = 0, refreshes = 0;
  const runtimes = [], controls = { build: undefined, refresh: undefined, diagnostics: [], loaderErrors: [], error: undefined };
  const sdk = {
    getAgentDir: () => agentDir,
    SettingsManager: { create(cwd, dir, options) { assert.equal(cwd, dir); assert.equal(options.projectTrusted, false); return { projectTrusted: false }; } },
    ModelRuntime: { async create(options) {
      builds++; assert.equal(options.refreshOnCreate, false);
      const runtime = { value: builds, nested: { value: builds }, getError: () => controls.error,
        async refresh(options) { assert.equal(options.allowNetwork, false); refreshes++; return await controls.refresh?.() ?? { aborted: false, errors: new Map() }; } };
      runtimes.push(runtime);
      return runtime;
    } },
    async createAgentSessionServices(options) {
      assert.equal(options.cwd, options.agentDir);
      assert.equal(options.settingsManager.projectTrusted, false);
      await controls.build?.(options.modelRuntime);
      return { modelRuntime: options.modelRuntime, diagnostics: controls.diagnostics, resourceLoader: { getExtensions: () => ({ errors: controls.loaderErrors }) } };
    },
  };
  const globals = { structuredClone, Date: { now: () => now } };
  const subject = loadTsModule(new URL("./settings-listing-runtime.ts", import.meta.url), { "node:path": path, "@earendil-works/pi-coding-agent": sdk }, globals);
  return { ...subject.exports, context: subject.context, sdk, controls, runtimes,
    set dir(value) { agentDir = value; }, set now(value) { now = value; },
    get builds() { return builds; }, get refreshes() { return refreshes; } };
}

test("shares construction but refreshes every read, detaches results, and scopes by agent directory", async () => {
  const f = fixture(), gate = deferred();
  f.controls.build = () => gate.promise;
  const first = f.readSettingsListing((runtime) => runtime.nested);
  const second = f.readSettingsListing((runtime) => runtime.nested);
  await turn(); assert.equal(f.builds, 1);
  gate.resolve();
  assert.deepEqual(await first, { value: 1 });
  const snapshot = await second;
  f.runtimes[0].nested.value = 9;
  assert.equal(snapshot.value, 1);
  assert.equal((await f.readSettingsListing((runtime) => runtime.nested)).value, 9);
  assert.equal(f.refreshes, 3);
  f.dir = "/another-agent";
  assert.equal(await f.readSettingsListing((runtime) => runtime.value), 2);
  f.dir = "/synthetic-agent";
  assert.equal(await f.readSettingsListing((runtime) => runtime.value), 1);
});

test("queue covers refresh AND an awaiting projection; a later caller cannot change its view", async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  const first = f.readSettingsListing(async (runtime) => { entered.resolve(); await release.promise; return runtime.nested; });
  await entered.promise;
  const second = f.readSettingsListing((runtime) => runtime.nested);
  await turn(); assert.equal(f.refreshes, 1);
  release.resolve(); await first; await second;
  assert.equal(f.refreshes, 2);
});

test("TTL is non-sliding from completed construction; invalidation does not retain late builds", async () => {
  const f = fixture();
  await f.readSettingsListing((runtime) => runtime.value);
  f.now = 599_999; await f.readSettingsListing((runtime) => runtime.value);
  assert.equal(f.builds, 1);
  f.now = 600_000; await f.readSettingsListing((runtime) => runtime.value);
  assert.equal(f.builds, 2);
  const entered = deferred(), release = deferred();
  f.controls.build = async () => { entered.resolve(); await release.promise; };
  f.invalidateSettingsListingRuntime();
  const old = assert.rejects(f.readSettingsListing(() => assert.fail("invalidated projection ran")), /listing changed/);
  await entered.promise;
  f.invalidateSettingsListingRuntime();
  f.controls.build = undefined;
  assert.equal(await f.readSettingsListing((runtime) => runtime.value), 4);
  release.resolve(); await old;
  assert.equal(await f.readSettingsListing((runtime) => runtime.value), 4);
  assert.equal(f.builds, 4);
});

test("invalidation escapes a blocked refresh and rejects old publication without replay", async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  await f.readSettingsListing(() => null);
  f.controls.refresh = async () => { entered.resolve(); await release.promise; };
  let projections = 0;
  const old = assert.rejects(f.readSettingsListing(() => { projections++; }), /listing changed/);
  await entered.promise;
  f.invalidateSettingsListingRuntime(); f.controls.refresh = undefined;
  assert.equal(await f.readSettingsListing((runtime) => runtime.value), 2);
  release.resolve(); await old; assert.equal(projections, 0);
  const projectionEntered = deferred(), projectionRelease = deferred();
  const pending = assert.rejects(f.readSettingsListing(async () => {
    projections++; projectionEntered.resolve(); await projectionRelease.promise; return "old";
  }), /listing changed/);
  await projectionEntered.promise; f.invalidateSettingsListingRuntime(); projectionRelease.resolve();
  await pending; assert.equal(projections, 1, "never replay a callback");
});

test("rejected/degraded builds and refreshes are not retained; queues recover from projection failure", async () => {
  const f = fixture();
  f.controls.build = () => { throw new Error("build failed"); };
  await assert.rejects(f.readSettingsListing(() => null), /build failed/);
  f.controls.build = undefined;
  await f.readSettingsListing(() => null); assert.equal(f.builds, 2);
  f.controls.refresh = () => { throw new Error("refresh failed"); };
  await assert.rejects(f.readSettingsListing(() => null), /refresh failed/);
  f.controls.refresh = undefined;
  await f.readSettingsListing(() => null); assert.equal(f.builds, 3);
  const rejected = assert.rejects(f.readSettingsListing(() => { throw new Error("projection failed"); }), /projection failed/);
  const queued = f.readSettingsListing(() => "next");
  await rejected; assert.equal(await queued, "next");
  f.controls.diagnostics = [{ type: "error" }]; f.invalidateSettingsListingRuntime();
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 5);
  f.controls.diagnostics = []; f.controls.error = "degraded"; f.invalidateSettingsListingRuntime();
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 7);
});

test("plugin mutation gates reuse, invalidates on both sides, and failed updates disable retention across reloads", async () => {
  const f = fixture();
  await f.readSettingsListing(() => null);
  const finish = f.beginSettingsListingMutation();
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 3);
  finish(true); finish(false); // completion is idempotent
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 4);
  const fail = f.beginSettingsListingMutation(); fail(false);
  f.invalidateSettingsListingRuntime();
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 6);
  f.dir = "/other-agent";
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 7, "another agent dir retains its own healthy cache");
});

test("SDK background registration refreshes are drained and rejected refreshes are observed", async () => {
  const f = fixture(), entered = deferred(), release = deferred();
  let calls = 0, projected = false;
  f.controls.refresh = async () => { if (++calls === 1) { entered.resolve(); await release.promise; throw new Error("background failure"); } };
  f.controls.build = (runtime) => { void runtime.refresh({ allowNetwork: false }); };
  const read = f.readSettingsListing(() => { projected = true; return "ready"; });
  await entered.promise; await turn(); assert.equal(projected, false);
  release.resolve(); assert.equal(await read, "ready");
  f.controls.build = undefined;
  await f.readSettingsListing(() => null); assert.equal(f.builds, 2, "degraded background build not retained");
});

test("loader errors and fulfilled/aborted/background refresh failures cannot be retained", async () => {
  const f = fixture();
  f.controls.loaderErrors = [{ error: "factory failed" }];
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 2);
  f.controls.loaderErrors = [];
  for (const result of [{ aborted: true, errors: new Map() }, { aborted: false, errors: new Map([["provider", new Error("refresh failed")]]) }]) {
    f.controls.refresh = () => result;
    await f.readSettingsListing(() => null);
    f.controls.refresh = undefined;
    const before = f.builds;
    await f.readSettingsListing(() => null); assert.equal(f.builds, before + 1);
    f.invalidateSettingsListingRuntime();
  }
  let calls = 0;
  f.controls.build = (runtime) => { void runtime.refresh(); };
  f.controls.refresh = () => ++calls === 1 ? { aborted: false, errors: new Map([["provider", new Error("background failure")]]) } : { aborted: false, errors: new Map() };
  await f.readSettingsListing(() => null);
  const before = f.builds;
  await f.readSettingsListing(() => null); assert.equal(f.builds, before + 1);
});

test("overlapping mutations and uncloneable projections never reopen unsafe retention", async () => {
  const f = fixture();
  const first = f.beginSettingsListingMutation(), second = f.beginSettingsListingMutation();
  first(true);
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 2);
  second(true);
  await f.readSettingsListing(() => null); await f.readSettingsListing(() => null);
  assert.equal(f.builds, 3);
  await assert.rejects(f.readSettingsListing(() => ({ callback() {} })), /clone|cloned/i);
  await f.readSettingsListing(() => null); assert.equal(f.builds, 4);
});

test("module copies share the same queue and scope state", async () => {
  const f = fixture();
  await f.readSettingsListing(() => null);
  const copy = loadTsModule(new URL("./settings-listing-runtime.ts", import.meta.url), {
    "node:path": path, "@earendil-works/pi-coding-agent": f.sdk,
  }, { structuredClone, Date: { now: () => 0 }, __piSettingsListingScopes: f.context.__piSettingsListingScopes }).exports;
  await copy.readSettingsListing(() => null);
  assert.equal(f.builds, 1);
  copy.invalidateSettingsListingRuntime();
  await f.readSettingsListing(() => null);
  assert.equal(f.builds, 2);
});
