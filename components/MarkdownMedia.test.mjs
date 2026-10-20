import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import ts from "typescript";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const helpers = await jiti.import("../lib/markdown-media.ts");
const source = await readFile(new URL("./MarkdownMedia.tsx", import.meta.url), "utf8");
const script = new Script(ts.transpileModule(source + "\nexports.LoadedMedia = LoadedMedia; exports.MediaPlayer = MediaPlayer;", {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText);
function find(node, predicate) {
  if (Array.isArray(node)) return node.map(n => find(n, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : find(node.props?.children, predicate);
}

// Run the entire production component against public hook/native-media doubles.
function harness(src = "/api/files/take.wav?type=read&sessionId=origin") {
  let stateCursor = 0, refCursor = 0;
  const states = [], refs = [], effects = [], calls = [], listeners = new Map();
  const attrs = new Map([["src", src]]);
  const media = { getAttribute: key => attrs.get(key), setAttribute(key, value) { attrs.set(key, value); calls.push(["set", key, value]); },
    pause() { calls.push("pause"); }, removeAttribute(key) { attrs.delete(key); calls.push(["remove", key]); }, load() { calls.push("load"); } };
  const doc = { hidden: false, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); } };
  const h = { active: true };
  const hooks = {
    createContext: value => ({ value, Provider: "provider" }), useContext: () => h.active,
    useState(value) { const index = stateCursor++; if (!(index in states)) states[index] = value; return [states[index], next => { states[index] = next; }]; },
    useRef(value) { const index = refCursor++; return refs[index] ??= { current: value }; },
    useEffect(effect) { effects.push(effect); },
  };
  const jsx = (type, props, key) => {
    if (type === "audio" || type === "video") props.ref(media);
    return { type, props, key };
  };
  const exports = {};
  script.runInNewContext({ exports, document: doc, require(id) {
    if (id === "react") return hooks;
    if (id === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    if (id === "@/hooks/useI18n") return { useI18n: () => ({ t: key => key }) };
    if (id === "@/lib/markdown-media") return helpers;
    throw new Error(`Unexpected import ${id}`);
  } });
  return Object.assign(h, { exports, effects, media, calls, attrs, doc, listeners,
    render(name, props) { stateCursor = 0; refCursor = 0; effects.length = 0; return exports[name](props); },
  });
}
const props = { filePath: "/outside/take.wav", label: "Recording", type: "audio", sessionId: "origin" };

test("real activation creates no native player until click and keeps recovery session-bound", () => {
  const h = harness();
  let tree = h.render("MediaPlayer", props);
  assert.equal(find(tree, n => n.type === "audio" || n.type?.name === "LoadedMedia"), undefined);
  assert.equal(find(tree, n => n.type === "a").props.href, "/api/files/outside/take.wav?type=download&sessionId=origin");
  find(tree, n => n.props?.className === "markdown-media-load").props.onClick();
  tree = h.render("MediaPlayer", props);
  const loaded = find(tree, n => n.type?.name === "LoadedMedia");
  assert.match(loaded.props.src, /^\/api\/files\/outside\/take.wav\?type=read&sessionId=origin&v=\d+-\d+$/);
  find(tree, n => n.type === "button" && n.props.children === "chat.unloadMedia").props.onClick();
  tree = h.render("MediaPlayer", props);
  assert.equal(find(tree, n => n.type?.name === "LoadedMedia"), undefined);
  find(tree, n => n.props?.className === "markdown-media-load").props.onClick();
  const reloaded = find(h.render("MediaPlayer", props), n => n.type?.name === "LoadedMedia");
  assert.notEqual(reloaded.props.src, loaded.props.src, "each explicit load bypasses native failed-media cache");
});

test("inactive scope removes activation owner and source/session identity keys change", () => {
  const h = harness();
  const initial = h.render("MarkdownMedia", props);
  assert.notEqual(initial.key, h.render("MarkdownMedia", { ...props, sessionId: "other" }).key);
  assert.notEqual(initial.key, h.render("MarkdownMedia", { ...props, filePath: "/other.wav" }).key);
  h.active = false;
  assert.equal(h.render("MarkdownMedia", props).type, "span");
});

test("native error reporting does not retry and cleanup survives Strict Mode setup replay", () => {
  const h = harness();
  const loadedProps = { type: "video", src: h.attrs.get("src"), label: "Demo" };
  let tree = h.render("LoadedMedia", loadedProps);
  const node = find(tree, n => n.type === "video");
  assert.equal(node.props.controls, true); assert.equal(node.props.playsInline, true);
  assert.equal(node.props.autoPlay, undefined); assert.equal(node.props["aria-label"], "Demo");
  const setup = h.effects[0], cleanup = setup();
  node.props.onError();
  tree = h.render("LoadedMedia", loadedProps);
  assert.equal(find(tree, n => n.props?.role === "status").props.children, "chat.mediaFailed");
  assert.deepEqual(h.calls, [], "reporting an error never reloads or retries");
  cleanup();
  assert.deepEqual(h.calls, ["pause", ["remove", "src"], "load"]);
  const replayCleanup = setup();
  assert.equal(h.attrs.get("src"), loadedProps.src);
  replayCleanup(); assert.equal(h.attrs.has("src"), false);
});

test("visibility scope observes hidden state and releases its listener", () => {
  const h = harness();
  const props = { active: true, children: "chat" };
  h.render("MarkdownMediaScope", props);
  const cleanup = h.effects[0]();
  h.doc.hidden = true; h.listeners.get("visibilitychange")();
  assert.equal(h.render("MarkdownMediaScope", props).props.value, false);
  h.doc.hidden = false; h.listeners.get("visibilitychange")();
  assert.equal(h.render("MarkdownMediaScope", props).props.value, true);
  assert.equal(h.render("MarkdownMediaScope", { ...props, active: false }).props.value, false);
  cleanup(); assert.equal(h.listeners.size, 0);
});
