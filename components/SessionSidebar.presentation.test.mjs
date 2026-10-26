import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
// Intentional declaration guards only. Real row/toggle/resizer controls are
// mounted elsewhere; installed browser owns touch visibility and geometry.
test('sidebar separator focus decoration and touch action declarations retain their existing presentation contract', () => {
  assert.match(css, /\.sidebar-section-resize-handle:focus-visible::after/);
  assert.doesNotMatch(css, /\.sidebar-section-resize-handle:focus-visible \{[^}]*outline: 2px solid var\(--accent\)/);
  assert.match(css, /\.sidebar-section-resize-handle::after[\s\S]*?background: transparent/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\) \{\s*\.session-row-actions-toggle \{\s*display: flex;\s*\}\s*\.session-row-actions\[data-open="true"\] \{\s*display: flex;/);
  assert.doesNotMatch(css, /min-width: 40px;/);
});
