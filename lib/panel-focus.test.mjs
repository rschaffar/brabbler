import assert from "node:assert/strict";
import test from "node:test";
import { deepActiveElement, panelTabStops } from "./panel-focus.ts";

function element(name, overrides = {}) {
  return { name, tagName: "BUTTON", children: [], tabIndex: 0, ownerDocument: {},
    matches: () => false, closest: () => null, getClientRects: () => [{}], ...overrides };
}

test("panel traversal includes shadow-root gap controls in native document order", () => {
  const header = element("header"), toolbar = element("toolbar"), gap = element("gap");
  const host = element("host", { tabIndex: -1, shadowRoot: { children: [gap] } });
  assert.deepEqual(panelTabStops({ children: [header, toolbar, host] }).map((node) => node.name), ["header", "toolbar", "gap"]);
  assert.equal(deepActiveElement({ activeElement: { shadowRoot: { activeElement: host } } }), host);
  host.shadowRoot.activeElement = gap;
  assert.equal(deepActiveElement({ activeElement: host }), gap);
});

test("hidden, inert, disabled and negative-tabindex controls are excluded", () => {
  const hidden = element("hidden", { getClientRects: () => [] });
  const invisible = element("invisible", { ownerDocument: { defaultView: { getComputedStyle: () => ({ visibility: "hidden" }) } } });
  const disabled = element("disabled", { matches: () => true });
  const inert = element("inert", { closest: () => ({}) });
  const negative = element("negative", { tabIndex: -1 });
  const available = element("available");
  assert.deepEqual(panelTabStops({ children: [hidden, invisible, disabled, inert, negative, available] }), [available]);
});

test("assigned elements occupy their slot position and fallback content stays skipped", () => {
  const gap = element("gap"), fallback = element("fallback"), slot = element("slot", {
    tagName: "SLOT", tabIndex: -1, children: [fallback], assignedElements: () => [gap],
  });
  assert.deepEqual(panelTabStops({ children: [slot] }), [gap]);
});
