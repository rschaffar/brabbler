import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { Script } from "node:vm";
import ts from "typescript";
import { createTerminalWriter, terminalRequest } from "../lib/terminal-client.ts";

const componentFile = new URL("./TerminalPanel.tsx", import.meta.url);
const componentScript = new Script(ts.transpileModule(await readFile(componentFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText, { filename: componentFile.pathname });

test("terminal errors preserve server diagnostics and explain non-JSON responses", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch");
  for (const body of [null, "<html>Server error</html>", "null"]) {
    fetch.mock.mockImplementation(async () => new Response(body, { status: 500 }));
    await assert.rejects(terminalRequest("/api/terminal"), /HTTP 500.*pi-web server log/);
  }
  fetch.mock.mockImplementation(async () => Response.json({ error: "Native module missing; run npm rebuild node-pty" }, { status: 500 }));
  await assert.rejects(terminalRequest("/api/terminal"), /Native module missing; run npm rebuild node-pty/);
});

test("a delayed input request cannot be overtaken by typing or resize", async (t) => {
  const received = [];
  let finishFirst;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    received.push(JSON.parse(options.body));
    if (received.length === 1) await new Promise((resolve) => { finishFirst = resolve; });
    return Response.json({ success: true });
  });
  const writer = createTerminalWriter("id", assert.fail);
  writer.write("a");
  writer.resize(100, 30);
  writer.write("b\r");
  await setImmediate();
  assert.equal(received.length, 1);
  finishFirst();
  await setImmediate();
  assert.deepEqual(received, [
    { type: "input", data: "a" },
    { type: "resize", cols: 100, rows: 30 },
    { type: "input", data: "b\r" },
  ]);
  await writer.stop();
});

test("large Unicode pastes preserve characters while bounding input requests", async (t) => {
  const chunks = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    chunks.push(JSON.parse(options.body).data);
    return Response.json({ success: true });
  });
  const writer = createTerminalWriter("id", assert.fail);
  const text = "a".repeat(32767) + "\u{1f600}".repeat(40000);
  writer.write(text);
  await setImmediate();
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => chunk.length <= 65536 && chunk.isWellFormed()));
  await writer.stop();
});

test("typing during a slow request is batched into the next ordered write", async (t) => {
  const received = [];
  let release;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    received.push(JSON.parse(options.body).data);
    if (received.length === 1) await new Promise((resolve) => { release = resolve; });
    return Response.json({ success: true });
  });
  const writer = createTerminalWriter("id", assert.fail);
  writer.write("first");
  await setImmediate();
  for (const character of "a long command\r") writer.write(character);
  assert.deepEqual(received, ["first"]);
  release();
  await setImmediate();
  assert.deepEqual(received, ["first", "a long command\r"]);
  await writer.stop();
});

test("failed or stopped delivery discards queued input without retrying commands", async (t) => {
  const errors = [];
  const fetch = t.mock.method(globalThis, "fetch", async () => Response.json({ error: "gone" }, { status: 404 }));
  const writer = createTerminalWriter("id", (error) => errors.push(error.message));
  writer.write("first");
  writer.write("second");
  await setImmediate();
  assert.deepEqual(errors, ["gone"]);
  assert.equal(fetch.mock.callCount(), 1);
  await writer.stop();
  writer.write("third");
  await setImmediate();
  assert.equal(fetch.mock.callCount(), 1);
});

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function findElement(node, predicate) {
  if (Array.isArray(node)) return node.map((child) => findElement(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : findElement(node.props?.children, predicate);
}

// Execute the entire production component, not extracted/copied lifecycle logic.
// The doubles expose public hooks/browser/xterm boundaries; no ref index is assumed.
function terminalPanelHarness({ deleteFailures = 0, online = true } = {}) {
  const refs = [], states = [], effects = [];
  const sources = [], terminals = [], writers = [], requests = [], order = [];
  const listeners = new Map();
  const creation = deferred();
  const container = { offsetWidth: 800, offsetHeight: 480 };
  let refCursor = 0, stateCursor = 0, effectCursor = 0, pendingEffects = [];
  let dirty = false, mounted = true, tree, hostRef;
  let closed = 0, closeErrors = 0;
  let tab = { id: "a".repeat(32), cwd: "/workspace" };
  const path = `/api/terminal/${encodeURIComponent(tab.id)}`;
  const onClosed = () => { closed++; order.push("callback:closed"); };
  const onCloseError = () => { closeErrors++; order.push("callback:close-error"); };

  const hooks = {
    useRef(initial) {
      const index = refCursor++;
      if (index === refs.length) refs.push({ current: initial });
      return refs[index];
    },
    useState(initial) {
      const index = stateCursor++;
      if (index === states.length) states.push({ value: typeof initial === "function" ? initial() : initial });
      const cell = states[index];
      return [cell.value, (next) => {
        if (!mounted) return;
        const value = typeof next === "function" ? next(cell.value) : next;
        if (!Object.is(cell.value, value)) { cell.value = value; dirty = true; }
      }];
    },
    useEffect(callback, deps) {
      const index = effectCursor++;
      const previous = effects[index];
      if (!previous || !deps || !previous.deps || deps.length !== previous.deps.length
        || deps.some((value, i) => !Object.is(value, previous.deps[i]))) {
        pendingEffects.push({ index, callback, deps });
      }
    },
  };
  const jsx = (type, props) => {
    if (props?.className === "terminal-xterm-host") {
      hostRef = props.ref;
      hostRef.current = container; // DOM refs are attached before passive effects commit.
    }
    return { type, props };
  };

  class FakeTerminal {
    constructor(options) {
      this.options = { ...options };
      this.cols = 80;
      this.rows = 24;
      this.disposed = false;
      this.dataListeners = new Set();
      this.resizeListeners = new Set();
      terminals.push(this);
    }
    loadAddon() {}
    open(host) { assert.equal(host, container); }
    attachCustomKeyEventHandler() {}
    hasSelection() { return false; }
    focus() {}
    reset() {}
    write() {}
    onData(callback) {
      this.dataListeners.add(callback);
      return { dispose: () => this.dataListeners.delete(callback) };
    }
    onResize(callback) {
      this.resizeListeners.add(callback);
      return { dispose: () => this.resizeListeners.delete(callback) };
    }
    emitData(data) { for (const callback of this.dataListeners) callback(data); }
    emitResize(cols, rows) { for (const callback of this.resizeListeners) callback({ cols, rows }); }
    dispose() { this.disposed = true; }
  }
  class FakeEventSource {
    static CLOSED = 2;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.closed = false;
      sources.push(this);
      order.push("sse:create");
    }
    open() { this.readyState = 1; this.onopen?.({}); }
    close() { this.closed = true; this.readyState = FakeEventSource.CLOSED; order.push("sse:close"); }
  }
  const client = {
    terminalRequest(url, options = {}) {
      const method = options.method ?? "GET";
      requests.push({ url, method, options });
      order.push(`request:${method}`);
      assert.equal(url, method === "POST" ? "/api/terminal" : path);
      if (method === "POST") return creation.promise.then((result) => { order.push("created"); return result; });
      if (method === "DELETE" && deleteFailures > 0) {
        deleteFailures--;
        return Promise.reject(new Error("termination failed"));
      }
      assert.ok(method === "GET" || method === "DELETE");
      return Promise.resolve({ id: tab.id });
    },
    createTerminalWriter(id) {
      assert.equal(id, tab.id);
      const writer = {
        drain: deferred(), writes: [], resizes: [], stopCalls: 0,
        write(data) { this.writes.push(data); },
        resize(cols, rows) { this.resizes.push({ cols, rows }); },
        stop() { this.stopCalls++; order.push("writer:stop"); return this.drain.promise; },
      };
      writers.push(writer);
      return writer;
    },
  };
  const loaded = { exports: {} };
  componentScript.runInNewContext({
    module: loaded, exports: loaded.exports,
    require(id) {
      if (id === "react") return hooks;
      if (id === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (id === "@xterm/xterm") return { Terminal: FakeTerminal };
      if (id === "@xterm/addon-fit") return { FitAddon: class { fit() {} } };
      if (id === "@/hooks/useI18n") return { useI18n: () => ({ t: (key) => key }) };
      if (id === "@/lib/terminal-client") return client;
      throw new Error(`Unexpected component dependency: ${id}`);
    },
    EventSource: FakeEventSource,
    ResizeObserver: class { observe() {} disconnect() {} },
    navigator: { onLine: online },
    localStorage: { getItem: () => null, setItem() {} },
    document: { fonts: { load: () => Promise.resolve([]) } },
    getComputedStyle: () => ({ getPropertyValue: () => "monospace" }),
    window: {
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(callback);
      },
      removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    },
  });

  function render(tabChanges = {}) {
    assert.ok(mounted, "cannot render an unmounted panel");
    tab = { ...tab, ...tabChanges };
    refCursor = stateCursor = effectCursor = 0;
    dirty = false;
    pendingEffects = [];
    tree = loaded.exports.TerminalPanel({ tab, active: true, onRestart() {}, onClosed, onCloseError });
    // React cleans up changed effects before running their replacement callbacks.
    for (const { index } of pendingEffects) effects[index]?.cleanup?.();
    for (const { index, callback, deps } of pendingEffects) effects[index] = { deps, cleanup: callback() };
    return tree;
  }
  function unmount() {
    if (!mounted) return;
    mounted = false;
    for (const effect of effects) effect?.cleanup?.();
    if (hostRef) hostRef.current = null;
  }
  return {
    creation, sources, terminals, writers, requests, order, path, render, unmount,
    get tab() { return tab; },
    get tree() { return tree; },
    get closed() { return closed; },
    get closeErrors() { return closeErrors; },
    dispatch(type, event = {}) { for (const callback of listeners.get(type) ?? []) callback(event); },
    async flush() {
      // Only settle microtasks and scheduled state renders, never poll a real timer/network.
      for (let turn = 0; turn < 8; turn++) {
        await setImmediate();
        if (!mounted || !dirty) return;
        render();
      }
      assert.fail("component did not settle within eight render turns");
    },
  };
}

const methods = (harness) => harness.requests.map(({ method }) => method);

for (const restored of [false, true]) {
  test(`${restored ? "restored" : "new"} terminal connects to the reachable local endpoint when navigator reports offline`, async (t) => {
    const h = terminalPanelHarness({ online: false });
    t.after(() => h.unmount());
    h.render({ restored });
    if (!restored) h.creation.resolve({ id: h.tab.id });
    await h.flush();
    assert.deepEqual(methods(h), [restored ? "GET" : "POST"]);
    assert.equal(h.sources.length, 1, "advisory Internet-interface state must not block the local event stream");
    assert.equal(h.sources[0].url, `${h.path}/events`);
    h.sources[0].open();
    await h.flush();
    assert.equal(h.terminals[0].options.disableStdin, false);
    assert.equal(findElement(h.tree, (node) => node.props?.className?.startsWith("terminal-status-dot"))?.props.className,
      "terminal-status-dot is-ready");
    assert.deepEqual(methods(h), [restored ? "GET" : "POST"], "connection must not create a replacement shell");
  });
}

test("closing during held creation never opens SSE and awaits creation and writer drain before DELETE", async (t) => {
  const h = terminalPanelHarness();
  t.after(() => h.unmount());
  h.render();
  h.render({ closing: "close" });
  await h.flush();
  assert.deepEqual(methods(h), ["POST"]);
  assert.equal(h.sources.length, 0);
  assert.equal(h.writers[0].stopCalls, 0, "creation must settle before draining input");
  assert.equal(h.closed, 0);

  h.creation.resolve({ id: h.tab.id });
  await h.flush();
  assert.equal(h.sources.length, 0, "creation completing while closing must not open an EventSource");
  assert.equal(h.writers[0].stopCalls, 1);
  assert.deepEqual(methods(h), ["POST"], "DELETE must wait for writer drain");
  assert.equal(h.closed, 0);
  h.writers[0].drain.resolve();
  await h.flush();
  h.render();
  await h.flush();
  assert.deepEqual(methods(h), ["POST", "DELETE"]);
  assert.equal(h.requests[1].options.keepalive, true);
  assert.deepEqual(h.order, ["request:POST", "created", "writer:stop", "request:DELETE", "callback:closed"]);
  assert.equal(h.closed, 1);
  assert.equal(h.closeErrors, 0);
});

test("closing an attached terminal disconnects immediately and ignores online/pageshow and late SSE callbacks", async (t) => {
  const h = terminalPanelHarness();
  t.after(() => h.unmount());
  h.render();
  h.creation.resolve({ id: h.tab.id });
  await h.flush();
  assert.equal(h.sources.length, 1);
  const source = h.sources[0], terminal = h.terminals[0], writer = h.writers[0];
  source.open();
  await h.flush();
  assert.equal(terminal.options.disableStdin, false);
  terminal.emitData("before close");
  assert.deepEqual(writer.writes, ["before close"]);
  const lateOpen = source.onopen, lateError = source.onerror;
  const resizeCount = writer.resizes.length;

  h.render({ closing: "close" });
  assert.equal(source.closed, true, "close must disconnect SSE synchronously, before awaiting creation/drain");
  assert.equal(terminal.options.disableStdin, true);
  assert.equal(writer.stopCalls, 0);
  assert.deepEqual(methods(h), ["POST"]);
  await h.flush();
  assert.equal(writer.stopCalls, 1);
  const status = () => findElement(h.tree, (node) => node.props?.className?.startsWith("terminal-status-dot"))?.props.className;
  const closingStatus = status();
  h.dispatch("online");
  h.dispatch("pageshow", { persisted: true });
  lateOpen({});
  lateError({});
  terminal.emitData("must not send");
  terminal.emitResize(100, 30);
  await h.flush();
  assert.equal(h.sources.length, 1, "lifecycle events must not reconnect a closing terminal");
  assert.equal(terminal.options.disableStdin, true, "late onopen must not re-enable input");
  assert.deepEqual(writer.writes, ["before close"]);
  assert.equal(writer.resizes.length, resizeCount);
  assert.equal(status(), closingStatus, "late onerror must not change closing status");
  assert.deepEqual(methods(h), ["POST"], "DELETE must still wait for drain");
  writer.drain.resolve();
  await h.flush();
  assert.deepEqual(methods(h), ["POST", "DELETE"]);
  assert.ok(h.order.indexOf("sse:close") < h.order.indexOf("writer:stop"));
  assert.ok(h.order.indexOf("writer:stop") < h.order.indexOf("request:DELETE"));
  assert.equal(h.closed, 1);
  assert.equal(h.closeErrors, 0);
});

for (const attached of [false, true]) test(`unmount ${attached ? "after connection" : "during held creation"} only disconnects and never deletes the terminal lease`, async (t) => {
  const h = terminalPanelHarness();
  t.after(() => h.unmount());
  h.render();
  if (attached) {
    h.creation.resolve({ id: h.tab.id });
    await h.flush();
    h.sources[0].open();
    await h.flush();
  }
  h.unmount();
  assert.equal(h.terminals[0].disposed, true);
  assert.equal(h.writers[0].stopCalls, 1);
  assert.deepEqual(methods(h), ["POST"]);
  h.creation.resolve({ id: h.tab.id });
  h.writers[0].drain.resolve();
  h.dispatch("online");
  h.dispatch("pageshow", { persisted: true });
  await h.flush();
  assert.equal(h.sources.length, attached ? 1 : 0, "late creation must respect unmount");
  if (attached) assert.equal(h.sources[0].closed, true);
  assert.deepEqual(methods(h), ["POST"], "unmount is not explicit termination");
  assert.equal(h.closed, 0);
  assert.equal(h.closeErrors, 0);
});

for (const reconnect of [false, true]) test(`failed DELETE keeps the tab available for ${reconnect ? "same-id GET reconnect and close retry" : "explicit close retry"}`, async (t) => {
  const h = terminalPanelHarness({ deleteFailures: 1 });
  t.after(() => h.unmount());
  h.render();
  h.creation.resolve({ id: h.tab.id });
  await h.flush();
  h.sources[0].open();
  await h.flush();
  h.render({ closing: "close" });
  await h.flush();
  h.writers[0].drain.resolve();
  await h.flush();
  assert.deepEqual(methods(h), ["POST", "DELETE"]);
  assert.equal(h.closed, 0);
  assert.equal(h.closeErrors, 1);
  assert.equal(h.terminals[0].disposed, false);
  assert.equal(findElement(h.tree, (node) => node.props?.role === "alert")?.props.children, "termination failed");

  // The owner responds to onCloseError by clearing closing, leaving the same tab mounted.
  h.render({ closing: undefined });
  const button = findElement(h.tree, (node) => node.props?.["aria-label"] === "terminal.reconnect");
  assert.ok(button, "a failed termination must retain an explicit reconnect action");
  assert.equal(button.props.disabled, false);
  if (reconnect) {
    button.props.onClick();
    await h.flush();
    assert.deepEqual(methods(h), ["POST", "DELETE", "GET"], "reconnect must not create a replacement shell");
    assert.equal(h.requests[2].url, h.path);
    assert.equal(h.sources.length, 2);
    assert.equal(h.sources[1].url, `${h.path}/events`);
    h.sources[1].open();
    await h.flush();
    assert.equal(h.terminals[1].options.disableStdin, false);
  }
  h.render({ closing: "close" });
  await h.flush();
  h.writers.at(-1).drain.resolve();
  await h.flush();
  assert.deepEqual(methods(h), reconnect ? ["POST", "DELETE", "GET", "DELETE"] : ["POST", "DELETE", "DELETE"]);
  assert.equal(h.closed, 1);
  assert.equal(h.closeErrors, 1);
});
