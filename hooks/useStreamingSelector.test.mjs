import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Script } from "node:vm";
import test from "node:test";
import ts from "typescript";
import { createJiti } from "jiti";
const { createStreamingStore } = await createJiti(import.meta.url).import("../lib/streaming-message.ts");
const script = new Script(ts.transpileModule(await readFile(new URL("./useStreamingSelector.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText);
function mount(store, select, betweenRenderAndEffect = () => {}) {
  let value, updates = 0, cleanup;
  const exports = {};
  script.runInNewContext({ exports, require(name) {
    assert.equal(name, "react");
    return {
      useState(initial) { value = initial(); return [value, next => { if (!Object.is(value, next)) { value = next; updates++; } }]; },
      useLayoutEffect(effect) { betweenRenderAndEffect(); cleanup = effect(); },
    };
  } });
  exports.useStreamingSelector(store, select);
  return { get value() { return value; }, get updates() { return updates; }, unmount() { cleanup(); } };
}
const delta = (store, type, extra = {}) => store.dispatch({ type: "delta", event: { type, contentIndex: 0, ...extra } });

test("1000 reply chunks update the reply selector, not parent boolean selectors", () => {
  const store = createStreamingStore();
  const parentStreaming = mount(store, s => s.isStreaming);
  const parentContent = mount(store, s => Boolean(s.streamingMessage?.content.length));
  const reply = mount(store, s => s.streamingMessage);
  store.dispatch({ type: "start" });
  // SDK message_start supplies the assistant snapshot before block deltas.
  store.dispatch({ type: "snapshot", message: { role: "assistant", content: [] } });
  delta(store, "text_start");
  const before = [parentStreaming.updates, parentContent.updates, reply.updates];
  for (let i=0; i<1000; i++) delta(store, "text_delta", { delta: "界" });
  assert.deepEqual([parentStreaming.updates, parentContent.updates], before.slice(0,2));
  assert.equal(reply.updates - before[2], 1000);
  assert.equal(reply.value.content[0].text, "界".repeat(1000));
  store.dispatch({ type: "end" });
  assert.equal(parentStreaming.value, false);
  assert.equal(parentContent.value, false);
  assert.equal(reply.value, null);
  const settled = reply.updates;
  store.dispatch({ type: "end" });
  assert.equal(reply.updates, settled, "no-op dispatch does not publish");
  for (const selector of [parentStreaming, parentContent, reply]) selector.unmount();
});

test("subscription repairs a render/commit gap and unsubscribes deterministically", () => {
  const store = createStreamingStore();
  const selector = mount(store, s => s.isStreaming, () => store.dispatch({ type: "start" }));
  assert.equal(selector.value, true);
  selector.unmount();
  store.dispatch({ type: "end" });
  assert.equal(selector.value, true, "an unmounted selector cannot update");
  assert.equal(selector.updates, 1);
});
