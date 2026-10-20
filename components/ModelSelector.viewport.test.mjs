import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { getModelPanelVerticalLayout } = await createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true }).import("./ModelSelector.tsx");

test("model panels stay in visual-viewport bounds, including panned and short keyboards", () => {
  for (const [top, height, anchor] of [
    [0, 844, { top: 760, bottom: 792 }],
    [0, 450, { top: 370, bottom: 402 }],
    [70, 340, { top: 330, bottom: 362 }],
    [0, 280, { top: 600, bottom: 634 }], // Settings trigger behind keyboard
    [90, 130, { top: 180, bottom: 212 }], // less than the old 120px minimum
    [70, 340, { top: 0, bottom: 32 }], // trigger scrolled above the visible area
  ]) for (const placement of ["up", "auto"]) {
    const layout = getModelPanelVerticalLayout(anchor, top, height, placement);
    const end = Number(layout.verticalPosition.top);
    const panelTop = layout.openAbove ? end - layout.maxHeight : end;
    const panelBottom = layout.openAbove ? end : end + layout.maxHeight;
    assert.ok(layout.maxHeight > 0, JSON.stringify({ top, height, anchor, placement }));
    assert.ok(panelTop >= top + 8);
    assert.ok(panelBottom <= top + height - 8);
    assert.equal(layout.verticalPosition.bottom, undefined, "never mix layout-fixed bottom with visual height");
  }
});

test("desktop prefers upward placement and auto can use space below", () => {
  assert.equal(getModelPanelVerticalLayout({ top: 200, bottom: 234 }, 0, 844, "up").openAbove, true);
  assert.equal(getModelPanelVerticalLayout({ top: 200, bottom: 234 }, 0, 844, "auto").openAbove, false);
});
