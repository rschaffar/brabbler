import assert from "node:assert/strict";
import test, { mock } from "node:test";

const listeners = new Map();
globalThis.self = {
  location: {
    href: "https://pi.test/sw.js?v=test",
    origin: "https://pi.test",
  },
  addEventListener: (type, listener) => listeners.set(type, listener),
  clients: null,
};

await import("./sw.js");

function dispatchNotificationClick(data) {
  let pending;
  let closed = false;
  listeners.get("notificationclick")({
    notification: {
      data,
      close: () => { closed = true; },
    },
    waitUntil: (promise) => { pending = promise; },
  });
  return { pending, wasClosed: () => closed };
}

function dispatchPush(payload, clients) {
  let pending;
  const shown = [];
  self.clients = {
    matchAll: async () => clients,
    openWindow: async () => assert.fail("push must not open windows"),
  };
  self.registration = {
    showNotification: async (title, options) => { shown.push({ title, options }); },
  };
  listeners.get("push")({
    data: { json: () => payload },
    waitUntil: (promise) => { pending = promise; },
  });
  return { pending, shown };
}

test("push always shows a notification, even when a window is visible", async () => {
  const event = dispatchPush(
    {
      title: "Session complete",
      body: "Task finished.",
      url: "/?session=session-1",
      tag: "brabbler-session-complete:session-1",
    },
    [
      { url: "https://pi.test/?session=other", visibilityState: "hidden" },
      { url: "https://pi.test/?session=session-1", visibilityState: "visible" },
    ],
  );
  await event.pending;

  // iOS revokes the push subscription when a push is handled without a
  // notification, so the notification must never be suppressed.
  assert.deepEqual(event.shown, [{
    title: "Session complete",
    options: {
      body: "Task finished.",
      data: { url: "/?session=session-1" },
      tag: "brabbler-session-complete:session-1",
      renotify: true,
    },
  }]);
});

test("push ignores malformed payloads", async () => {
  const event = dispatchPush(
    { title: "", body: 42 },
    [],
  );
  await event.pending;

  assert.deepEqual(event.shown, []);
});

test("notification click focuses an existing client at the session URL", async () => {
  const calls = [];
  const focusedClient = {
    url: "https://pi.test/?session=session-1",
    focus: async () => { calls.push("focus"); },
    navigate: async () => assert.fail("exact client should not navigate"),
  };
  self.clients = {
    matchAll: async () => [focusedClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.equal(event.wasClosed(), true);
  assert.deepEqual(calls, ["focus"]);
});

test("notification click navigates an existing client to the session", async () => {
  const calls = [];
  const navigatedClient = {
    focus: async () => { calls.push("focus"); },
  };
  const existingClient = {
    url: "https://pi.test/?session=other-session",
    navigate: async (url) => {
      calls.push(["navigate", url]);
      return navigatedClient;
    },
    focus: async () => assert.fail("the navigated client should be focused"),
  };
  self.clients = {
    matchAll: async () => [existingClient],
    openWindow: async () => assert.fail("existing client should be reused"),
  };

  const event = dispatchNotificationClick({ url: "/?session=session-1" });
  await event.pending;

  assert.deepEqual(calls, [
    ["navigate", "https://pi.test/?session=session-1"],
    "focus",
  ]);
});

test("notification click opens a window and rejects cross-origin targets", async () => {
  const opened = [];
  self.clients = {
    matchAll: async () => [],
    openWindow: async (url) => { opened.push(url); },
  };

  const event = dispatchNotificationClick({ url: "https://example.com/redirect" });
  await event.pending;

  assert.deepEqual(opened, ["https://pi.test/"]);
});

// A reachable port backed by a dead upstream answers nothing at all, so these
// tests drive fetch() with a stub that only settles once the worker aborts it.
function installOfflineStub() {
  const offline = new Response("<!doctype html><title>Brabbler is offline</title>", {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
  globalThis.caches = {
    match: async (request) => ((typeof request === "string" ? request : request.url).endsWith("/offline.html")
      ? offline
      : undefined),
    open: async () => ({ put: async () => {} }),
  };
}

function dispatchFetch(url, { mode = "cors", method = "GET" } = {}) {
  let pending;
  const background = [];
  const request = new Request(url, { method });
  Object.defineProperty(request, "mode", { value: mode });
  listeners.get("fetch")({
    request,
    respondWith: (promise) => { pending = promise; },
    waitUntil: (promise) => { background.push(promise); },
  });
  return { pending, background };
}

test("install precaches offline assets but never the runtime manifest", async () => {
  let pending, precached;
  globalThis.caches = { open: async () => ({ addAll: async (urls) => { precached = urls; } }) };
  self.skipWaiting = async () => {};
  listeners.get("install")({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual(precached, ["/offline.html", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"]);
});

test("manifest bypasses even stale caches with query strings and navigation mode", () => {
  globalThis.caches = { match: () => assert.fail("must bypass old manifest caches"), open: () => assert.fail("must not cache manifests") };
  globalThis.fetch = () => assert.fail("the browser, not the worker, owns this request");
  for (const path of ["/manifest.webmanifest", "/manifest.webmanifest?v=old"]) {
    for (const mode of ["cors", "navigate"]) {
      assert.deepEqual(dispatchFetch(`https://pi.test${path}`, { mode }), { pending: undefined, background: [] });
    }
  }
});

for (const phase of ["open", "put"]) test(`a delayed cache ${phase} cannot delay an asset response`, async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  let stored;
  const cache = { put: async (_request, response) => { stored = response; if (phase === "put") await held; } };
  globalThis.caches = { match: async () => undefined, open: async () => { if (phase === "open") await held; return cache; } };
  globalThis.fetch = async () => {
    const response = new Response("chunk");
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };
  const { pending, background } = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
  let timer;
  try {
    const response = await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("cache blocked response")), 1000); })]);
    assert.equal(await response.text(), "chunk");
    assert.equal(background.length, 1);
    release();
    await Promise.all(background);
    assert.equal(await stored.text(), "chunk", "clone must remain readable after response consumption");
  } finally { clearTimeout(timer); release(); }
});

for (const phase of ["open", "put"]) test(`a rejected cache ${phase} cannot discard a healthy asset response`, async () => {
  globalThis.caches = {
    match: async () => undefined,
    open: async () => {
      if (phase === "open") throw new Error("storage unavailable");
      return { put: async () => { throw new Error("quota exceeded"); } };
    },
  };
  globalThis.fetch = async () => {
    const response = new Response("healthy");
    Object.defineProperty(response, "type", { value: "basic" });
    return response;
  };
  const { pending, background } = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
  assert.equal(await (await pending).text(), "healthy");
  await Promise.all(background);
});

test("cache hits and non-cacheable responses schedule no cache write", async () => {
  globalThis.caches = { match: async () => new Response("cached"), open: () => assert.fail("no write on a hit") };
  globalThis.fetch = () => assert.fail("no fetch on a hit");
  const hit = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
  assert.equal(await (await hit.pending).text(), "cached");
  assert.deepEqual(hit.background, []);
  globalThis.caches.match = async () => undefined;
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  const miss = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
  assert.equal((await miss.pending).status, 503);
  assert.deepEqual(miss.background, []);
});

/** fetch() that never settles until the signal it was handed is aborted. */
function installHungNetwork() {
  let aborted = false;
  globalThis.fetch = (_request, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => {
        aborted = true;
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  return () => aborted;
}

/**
 * Let a handler's await chain reach its fetch (and schedule its timer) before
 * the fake clock is ticked. setImmediate is not faked, unlike setTimeout.
 */
const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test("a stalled navigation falls back to offline.html", async () => {
  installOfflineStub();
  const wasAborted = installHungNetwork();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { pending } = dispatchFetch("https://pi.test/", { mode: "navigate" });
    await flushMicrotasks();
    mock.timers.tick(8000);
    const response = await pending;

    assert.equal(wasAborted(), true, "a hung upstream must be aborted, not awaited forever");
    assert.match(await response.text(), /Brabbler is offline/);
  } finally {
    mock.timers.reset();
  }
});

test("a stalled static asset request is bounded as well", async () => {
  installOfflineStub();
  const wasAborted = installHungNetwork();

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { pending } = dispatchFetch("https://pi.test/_next/static/chunks/app.js");
    // cacheFirst awaits the cache lookup before it reaches the network.
    await flushMicrotasks();
    mock.timers.tick(8000);

    assert.equal(wasAborted(), true);
    await assert.rejects(pending, /abort/i);
  } finally {
    mock.timers.reset();
  }
});

test("a response that arrives in time is not cut off mid-stream", async () => {
  installOfflineStub();
  let signal;
  globalThis.fetch = async (_request, init) => {
    signal = init.signal;
    return new Response("<!doctype html><title>Brabbler</title>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });
  };

  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { pending } = dispatchFetch("https://pi.test/", { mode: "navigate" });
    const response = await pending;
    // The budget only covers time to first byte: a long-lived body keeps
    // streaming past it (Next.js streams its SSR payload).
    mock.timers.tick(60000);

    assert.equal(signal.aborted, false);
    assert.match(await response.text(), /<title>Brabbler<\/title>/);
  } finally {
    mock.timers.reset();
  }
});
