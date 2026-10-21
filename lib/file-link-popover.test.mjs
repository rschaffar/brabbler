import assert from 'node:assert/strict';
import test from 'node:test';
import { fileLinkAnchor, fileLinkPopoverPosition } from './file-link-popover.ts';
const viewport = { left: 0, top: 0, width: 800, height: 600 };
const rect = (left, top, width = 100, height = 20) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('floating controls prefer above the link without changing its rectangle', () => {
  const anchor = rect(100, 200), before = { ...anchor };
  assert.deepEqual(fileLinkPopoverPosition(anchor, { width: 200, height: 36 }, viewport), { left: 100, top: 158 });
  assert.deepEqual(anchor, before);
});
test('controls flip below at the top edge and clamp at the right edge', () => {
  assert.deepEqual(fileLinkPopoverPosition(rect(750, 5), { width: 200, height: 36 }, viewport), { left: 592, top: 31 });
});
test('tall More contents remain inside a small visible viewport', () => {
  const visible = { left: 30, top: 140, width: 320, height: 200 };
  assert.deepEqual(fileLinkPopoverPosition(rect(300, 290), { width: 600, height: 600 }, visible), { left: 38, top: 148 });
});
test('zoom/keyboard offsets are layout coordinates, not a second bottom offset', () => {
  assert.deepEqual(fileLinkPopoverPosition(rect(150, 300), { width: 200, height: 40 }, { left: 40, top: 180, width: 400, height: 300 }), { left: 150, top: 254 });
});
test('wrapped links use the pointer line and keyboard uses the first visible line', () => {
  const lines = [rect(20, -30), rect(20, 30), rect(20, 60, 50)];
  assert.equal(fileLinkAnchor(lines, viewport, { x: 30, y: 65 }), lines[2]);
  assert.equal(fileLinkAnchor(lines, viewport), lines[1]);
});
test('hidden, zero-size and offscreen anchors do not acquire floating controls', () => {
  assert.equal(fileLinkAnchor([rect(0, 0, 0, 0), rect(10, 700)], viewport), undefined);
});
