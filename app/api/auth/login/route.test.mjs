import assert from "node:assert/strict";
import test from "node:test";
import { loadTsModule, sseFixture, readText, readData } from "../../../../lib/sse-stream.fixture.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function loginFixture(t) {
  const sse = sseFixture(t);
  const initialization = deferred();
  const login = deferred();
  const started = deferred();
  const abort = new AbortController();
  let options;
  let initCalls = 0;
  let loginCalls = 0;
  let invalidations = 0;
  let tokens = 0;
  const runtime = {
    getProvider: () => ({ auth: { oauth: {} } }),
    login(_provider, _type, value) {
      loginCalls++;
      options = value;
      started.resolve();
      return login.promise;
    },
  };
  const mocks = {
    "node:crypto": { randomUUID: () => `fixture-token-${++tokens}` },
    "@/lib/models-cache": { invalidateModelsCache() { invalidations++; } },
    "@/lib/model-runtime": { createModelRuntimeWithExtensions() { initCalls++; return initialization.promise; } },
    "@/lib/provider-accounts": { listProviderAccounts: () => [] },
    "@/lib/account-model-runtime": { prepareAccountModelRuntime() { throw new Error("Default OAuth must not select an extra-account binding"); } },
    "@/lib/sse-stream": sse,
  };
  const loaded = loadTsModule(new URL("./[provider]/route.ts", import.meta.url), mocks);
  const request = new Request("http://localhost/api/auth/login/fixture-provider", { signal: abort.signal });
  return { ...sse, initialization, login, started, abort, runtime,
    open: () => loaded.exports.GET(request, { params: Promise.resolve({ provider: "fixture-provider" }) }),
    submit: (token, code) => loaded.exports.POST(new Request(request.url, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, code }),
    }), { params: Promise.resolve({ provider: "fixture-provider" }) }),
    get options() { return options; }, get initCalls() { return initCalls; },
    get loginCalls() { return loginCalls; }, get invalidations() { return invalidations; },
    get registry() { return loaded.context.__piLoginCallbacks; },
  };
}

for (const outcome of ["success", "failure"]) {
  test(`OAuth emits heartbeats during initialization/login and closes on ${outcome}`, async (t) => {
    const f = loginFixture(t);
    const response = await f.open();
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    assert.equal(response.headers.has("connection"), false);
    const reader = response.body.getReader();
    t.after(() => reader.cancel());
    assert.equal(await readText(reader), ":\n\n");
    for (let i = 0; i < 5; i++) {
      f.tick();
      assert.equal(await readText(reader), ":\n\n");
    }
    f.initialization.resolve(f.runtime);
    await f.started.promise;
    f.options.notify({ type: "device_code", userCode: "test-code", verificationUri: "https://example.invalid/verify" });
    assert.equal((await readData(reader)).type, "device_code");
    f.tick();
    assert.equal(await readText(reader), ":\n\n");
    if (outcome === "success") f.login.resolve();
    else f.login.reject(new Error("fixture provider failed"));
    const event = await readData(reader);
    assert.equal(event.type, outcome === "success" ? "success" : "error");
    if (outcome === "failure") assert.equal(event.message, "fixture provider failed");
    assert.equal((await reader.read()).done, true);
    assert.equal(f.invalidations, outcome === "success" ? 1 : 0);
    assert.equal(f.intervals.size, 0);
    assert.equal(f.registry.size, 0);
  });
}

test("OAuth auth URL/manual-code handshake shares its token and POST settles input", async (t) => {
  const f = loginFixture(t);
  const reader = (await f.open()).body.getReader();
  t.after(() => reader.cancel());
  assert.equal(await readText(reader), ":\n\n");
  f.initialization.resolve(f.runtime);
  await f.started.promise;
  f.options.notify({ type: "auth_url", url: "https://example.invalid/auth" });
  const auth = await readData(reader);
  assert.equal(auth.type, "auth");
  const input = f.options.prompt({ type: "manual_code", message: "Enter fixture code" });
  const prompt = await readData(reader);
  assert.equal(prompt.type, "prompt_request");
  assert.equal(prompt.token, auth.token);
  assert.equal(f.registry.size, 1);
  assert.equal((await f.submit(auth.token, "fixture-code")).status, 200);
  assert.equal(await input, "fixture-code");
  assert.equal(f.registry.size, 0);

  const selection = f.options.prompt({ type: "select", message: "Choose", options: ["fixture-choice"] });
  const select = await readData(reader);
  assert.equal(select.type, "select_request");
  assert.notEqual(select.token, auth.token);
  assert.equal((await f.submit(select.token, "fixture-choice")).status, 200);
  assert.equal(await selection, "fixture-choice");
  f.login.resolve();
  assert.equal((await readData(reader)).type, "success");
  assert.equal((await reader.read()).done, true);
  assert.equal(f.invalidations, 1);
  assert.equal(f.registry.size, 0);
  assert.equal(f.intervals.size, 0);
});

for (const mode of ["abort", "cancel"]) {
  test(`OAuth ${mode} cancels pending input and ignores late provider events`, async (t) => {
    const f = loginFixture(t);
    const reader = (await f.open()).body.getReader();
    t.after(() => reader.cancel());
    assert.equal(await readText(reader), ":\n\n");
    f.initialization.resolve(f.runtime);
    await f.started.promise;
    const input = f.options.prompt({ type: "manual_code", message: "Enter fixture code" });
    const rejected = assert.rejects(input, /Login cancelled/);
    assert.equal((await readData(reader)).type, "prompt_request");
    assert.equal(f.registry.size, 1);
    if (mode === "abort") f.abort.abort();
    else await reader.cancel();
    await rejected;
    assert.equal(f.options.signal.aborted, true);
    assert.equal(f.registry.size, 0);
    assert.equal(f.intervals.size, 0);
    assert.equal((await reader.read()).done, true);
    assert.doesNotThrow(() => f.options.notify({ type: "auth_url", url: "https://example.invalid/auth" }));
    await assert.rejects(f.options.prompt({ type: "manual_code", message: "Late input" }), /Login cancelled/);
    f.login.resolve();
    await Promise.resolve();
    assert.equal(f.invalidations, 0);
    assert.equal(f.registry.size, 0);
  });
}

test("cancellation during OAuth initialization never starts provider login", async (t) => {
  const f = loginFixture(t);
  const reader = (await f.open()).body.getReader();
  assert.equal(await readText(reader), ":\n\n");
  await reader.cancel();
  f.initialization.resolve(f.runtime);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(f.loginCalls, 0);
  assert.equal(f.intervals.size, 0);
});

test("already-aborted OAuth does not initialize a runtime", async (t) => {
  const f = loginFixture(t);
  f.abort.abort();
  const response = await f.open();
  assert.equal(response.status, 204);
  assert.equal(f.initCalls, 0);
  assert.equal(f.intervals.size, 0);
});

test("OAuth initialization failure sends an error and clears its timer", async (t) => {
  const f = loginFixture(t);
  const reader = (await f.open()).body.getReader();
  assert.equal(await readText(reader), ":\n\n");
  f.initialization.reject(new Error("fixture initialization failed"));
  assert.equal((await readData(reader)).type, "error");
  assert.equal((await reader.read()).done, true);
  assert.equal(f.loginCalls, 0);
  assert.equal(f.intervals.size, 0);
});
