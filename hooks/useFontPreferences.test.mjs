import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as fonts from "../lib/font-preferences.ts";

const script = new Script(ts.transpileModule(readFileSync(new URL("./useFontPreferences.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText);
function fixture({ initial = {}, server = false } = {}) {
  const stored = new Map(Object.entries(initial)), applied = new Map(), events = new Map();
  let blockReads = false, blockWrites = false;
  const storage = {
    getItem(key) { if (blockReads) throw Error("read blocked"); return stored.get(key) ?? null; },
    setItem(key, value) { if (blockWrites) throw Error("write blocked"); stored.set(key, value); },
    removeItem(key) { if (blockWrites) throw Error("remove blocked"); stored.delete(key); },
  };
  const exports = {};
  script.runInNewContext({
    exports,
    require(id) {
      if (id === "@/lib/font-preferences") return fonts;
      if (id === "react") return { useSyncExternalStore: (_subscribe, getSnapshot, getServerSnapshot) => server ? getServerSnapshot() : getSnapshot() };
      throw Error(`Unexpected import ${id}`);
    },
    ...(!server && {
      window: { localStorage: storage,
        addEventListener(type, callback) { assert.equal(events.has(type), false); events.set(type, callback); },
        removeEventListener(type, callback) { assert.equal(events.get(type), callback); events.delete(type); },
      },
      document: { documentElement: { style: {
        setProperty(key, value) { applied.set(key, value); }, removeProperty(key) { applied.delete(key); },
      } } },
    }),
  });
  return { ...exports, stored, applied, events, storage,
    block({ reads = false, writes = false } = {}) { blockReads = reads; blockWrites = writes; },
    event(key, storageArea = storage) { events.get("storage")?.({ key, storageArea }); },
  };
}

test("SSR is stable and AppShell subscribers restore browser fonts without Settings", () => {
  const server = fixture({ server: true });
  assert.deepEqual({ ...server.useFontPreferences(), setFontPreference: undefined, setFontWeight: undefined, resetFontPreference: undefined, resetFontWeight: undefined },
    { ...fonts.DEFAULT_FONT_PREFERENCES, setFontPreference: undefined, setFontWeight: undefined, resetFontPreference: undefined, resetFontWeight: undefined });
  const store = fixture({ initial: { "pi-ui-font-family": "Georgia", "pi-mono-font-family": "Menlo", "pi-mono-font-weight": "600" } });
  const stop = store.subscribeFontPreferences(() => {});
  assert.equal(store.useFontPreferences().ui, "Georgia");
  assert.equal(store.applied.get("--font-mono"), '"Menlo", var(--font-mono-default)');
  assert.equal(store.applied.get("--font-mono-weight"), "600");
  stop();
  assert.equal(store.events.size, 0);
});

test("families and weights reset separately, without touching other fonts or layout keys", () => {
  const store = fixture({ initial: { "pi-chat-content-full-width": "false", "pi-chat-content-width": "1200", "pi-chat-content-font-size": "18" } });
  let updates = 0, terminalUpdates = 0;
  const stop = store.subscribeFontPreferences(() => updates++);
  const stopTerminal = store.subscribeFontPreferences(() => terminalUpdates++);
  store.setFontPreference("ui", "Times New ");
  store.setFontWeight("ui", 500);
  store.setFontPreference("mono", "Menlo");
  store.setFontWeight("mono", 600);
  assert.equal(store.useFontPreferences().ui, "Times New ");
  store.setFontWeight("mono", 600);
  assert.equal(updates, 4);
  store.resetFontPreference("ui");
  assert.equal(store.useFontPreferences().uiWeight, 500);
  assert.equal(store.applied.has("--font-ui"), false);
  store.resetFontWeight("ui");
  assert.equal(store.applied.has("--font-ui-weight"), false);
  assert.equal(store.useFontPreferences().mono, "Menlo");
  assert.equal(store.useFontPreferences().monoWeight, 600);
  store.resetFontWeight("mono");
  assert.equal(store.useFontPreferences().mono, "Menlo");
  assert.equal(store.stored.has("pi-mono-font-weight"), false);
  assert.equal(store.stored.get("pi-chat-content-width"), "1200");
  assert.equal(store.stored.get("pi-chat-content-font-size"), "18");
  assert.equal(store.stored.get("pi-chat-content-full-width"), "false");
  assert.equal(updates, terminalUpdates);
  stop(); assert.equal(store.events.size, 1);
  stopTerminal(); assert.equal(store.events.size, 0);
});

test("cross-tab changes and clear synchronize, ignoring unrelated/session storage; remount reconciles", () => {
  const store = fixture();
  let updates = 0;
  const stop = store.subscribeFontPreferences(() => updates++);
  store.stored.set("pi-ui-font-family", "Arial");
  store.event("other");
  store.event("pi-ui-font-family", {});
  assert.equal(updates, 0);
  store.event("pi-ui-font-family");
  assert.equal(store.useFontPreferences().ui, "Arial");
  store.stored.set("pi-ui-font-weight", "300");
  store.event("pi-ui-font-weight");
  assert.equal(store.applied.get("--font-ui-weight"), "300");
  store.stored.clear(); store.event(null);
  assert.equal(store.applied.size, 0);
  assert.equal(updates, 3);
  stop();
  store.stored.set("pi-mono-font-weight", "500");
  const stopAgain = store.subscribeFontPreferences(() => {});
  assert.equal(store.useFontPreferences().monoWeight, 500);
  stopAgain();
});

test("failed writes and failed resets keep memory over old persisted values and unrelated cross-tab edits", () => {
  const store = fixture({ initial: { "pi-ui-font-family": "Old", "pi-ui-font-weight": "500" } });
  const stop = store.subscribeFontPreferences(() => {});
  store.block({ writes: true });
  store.setFontPreference("ui", "Unsaved");
  store.resetFontWeight("ui");
  assert.equal(store.stored.get("pi-ui-font-family"), "Old");
  store.stored.set("pi-mono-font-family", "Other tab");
  store.event("pi-mono-font-family");
  assert.equal(store.useFontPreferences().ui, "Unsaved");
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(store.useFontPreferences().mono, "Other tab");
  stop();
  const stopAgain = store.subscribeFontPreferences(() => {});
  assert.equal(store.useFontPreferences().ui, "Unsaved");
  store.block();
  store.setFontPreference("ui", "Unsaved"); // same-value edits retry persistence
  store.resetFontWeight("ui");
  assert.equal(store.stored.get("pi-ui-font-family"), "Unsaved");
  assert.equal(store.stored.has("pi-ui-font-weight"), false);
  store.stored.set("pi-ui-font-family", "Fresh external"); store.event("pi-ui-font-family");
  assert.equal(store.useFontPreferences().ui, "Fresh external");
  store.block({ reads: true, writes: true });
  store.setFontWeight("mono", 200);
  store.event(null);
  assert.equal(store.useFontPreferences().monoWeight, 200);
  assert.equal(store.useFontPreferences().mono, "Other tab");
  stopAgain();
});

test("invalid persisted values use defaults without rewriting stored data", () => {
  const store = fixture({ initial: { "pi-ui-font-family": "x".repeat(501), "pi-ui-font-weight": "bold", "pi-mono-font-weight": "900" } });
  assert.equal(store.useFontPreferences().ui, "");
  assert.equal(store.useFontPreferences().uiWeight, 400);
  assert.equal(store.useFontPreferences().monoWeight, 400);
  assert.equal(store.applied.size, 0);
  assert.equal(store.stored.get("pi-ui-font-weight"), "bold");
});
