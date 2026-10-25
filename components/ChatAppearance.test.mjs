import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement as h } from 'react';
import { createJiti } from 'jiti';
import { generalFixture } from './general-settings.fixture.mjs';
const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, fsCache: false });
const { clampChatContentWidth, clampChatContentFontSize } = await jiti.import('../hooks/useChatAppearance.ts');

test('chat width validation preserves the default and supported range', () => {
  assert.equal(clampChatContentWidth(undefined), 820);
  assert.equal(clampChatContentWidth('invalid'), 820);
  assert.equal(clampChatContentWidth(700), 820);
  assert.equal(clampChatContentWidth(1104), 1104);
  assert.equal(clampChatContentWidth(2400), 2000);
});
test('chat font size preserves the default and bounds stored or supplied values', () => {
  for (const value of [undefined, null, 'invalid', Infinity, NaN]) assert.equal(clampChatContentFontSize(value), 14);
  assert.equal(clampChatContentFontSize(8), 12); assert.equal(clampChatContentFontSize('18'), 18);
  assert.equal(clampChatContentFontSize(18.7), 19); assert.equal(clampChatContentFontSize(30), 24);
});

test('actual General controls share the real persisted appearance snapshot; width/reset enters reading mode independently of font size', async t => {
  const { f, graph, props } = await generalFixture(t);
  function Peer() { const value = graph.useChatAppearance(); return h('output', { id: 'appearance-peer' }, JSON.stringify(value)); }
  await f.mount(h('div', null, h(graph.GeneralSettings, props), h(Peer)));
  const root = f.view.window.document.documentElement;
  const width = f.node('#settings-chat-content-width'), size = f.node('#settings-chat-content-font-size');
  assert.equal(width.value, '820'); assert.equal(size.value, '14');
  assert.deepEqual([width.min, width.max, width.step], ['820', '2000', '10']);
  assert.deepEqual([size.min, size.max, size.step], ['12', '24', '1']);
  const full = f.node('button[aria-label="Full-width chat"]');
  assert.equal(full.getAttribute('aria-checked'), 'true');
  assert.equal(root.style.getPropertyValue('--chat-content-max-width'), 'none');
  await f.click(full);
  assert.equal(root.style.getPropertyValue('--chat-content-max-width'), '820px');
  assert.equal(f.view.window.localStorage.getItem('pi-chat-content-full-width'), 'false');
  await f.input(width, '1100'); await f.input(size, '18');
  assert.deepEqual(JSON.parse(f.node('#appearance-peer').textContent), { width: 1100, fullWidth: false, fontSize: 18 });
  assert.equal(root.style.getPropertyValue('--chat-content-font-size'), '18px');
  assert.equal(f.view.window.localStorage.getItem('pi-chat-content-width'), '1100');
  assert.equal(f.view.window.localStorage.getItem('pi-chat-content-font-size'), '18');
  await f.click(full); assert.equal(root.style.getPropertyValue('--chat-content-max-width'), 'none');
  await f.click(f.node('#settings-chat-content-width').closest('.settings-chat-option').querySelector('button.settings-chat-reset'));
  assert.equal(full.getAttribute('aria-checked'), 'false');
  assert.equal(width.value, '820'); assert.equal(size.value, '18', 'width reset does not reset font size');
  const snapshot = f.node('#appearance-peer').textContent;
  await f.view.unmount(); assert.equal(snapshot.includes('18'), true);
});

test('actual General resets preserve the original 2000/24 width-size tuple independently and store 820/14 defaults', async t => {
  const { f, graph, props } = await generalFixture(t);
  await f.mount(h(graph.GeneralSettings, props));
  const width = f.node('#settings-chat-content-width'), size = f.node('#settings-chat-content-font-size');
  const resetWidth = () => width.closest('.settings-chat-option').querySelector('button.settings-chat-reset');
  const resetSize = () => size.closest('.settings-chat-option').querySelector('button.settings-chat-reset');
  await f.input(width, '2000'); await f.input(size, '24');
  await f.click(resetWidth());
  assert.equal(width.value, '820'); assert.equal(size.value, '24', 'width reset preserves font size');
  await f.input(width, '2000'); await f.click(resetSize());
  assert.equal(size.value, '14'); assert.equal(width.value, '2000', 'font-size reset preserves width');
  await f.click(resetWidth());
  const root = f.view.window.document.documentElement, storage = f.view.window.localStorage;
  assert.deepEqual({ width: storage.getItem('pi-chat-content-width'), fontSize: storage.getItem('pi-chat-content-font-size'),
    appliedWidth: root.style.getPropertyValue('--chat-content-max-width'), appliedFontSize: root.style.getPropertyValue('--chat-content-font-size') },
  { width: '820', fontSize: '14', appliedWidth: '820px', appliedFontSize: '14px' });
  assert.equal(resetWidth().disabled, true); assert.equal(resetSize().disabled, true);
});

// Static CSS consumers/declarations are retained as presentation contracts only.
// Actual AppShell restoration and composer remeasurement are separately held for their owners.
test('chat consumers use one width variable and font CSS declarations retain mono/emphasis inheritance', async () => {
  const windowSource = await readFile(new URL('./ChatWindow.tsx', import.meta.url), 'utf8');
  const inputSource = await readFile(new URL('./ChatInput.tsx', import.meta.url), 'utf8');
  const globals = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  const widthVariable = /var\(--chat-content-max-width, none\)/g;
  assert.equal((windowSource.match(widthVariable) ?? []).length, 2);
  assert.equal((inputSource.match(widthVariable) ?? []).length, 1);
  assert.match(globals, /--chat-content-max-width: none;/);
  assert.doesNotMatch(windowSource, /max-w-\[820px\]|maxWidth: 820/);
  assert.doesNotMatch(inputSource, /maxWidth: 820/);
  assert.match(globals, /--font-mono-default: var\(--font-noto-mono\)/);
  assert.match(globals, /\.git-diff-code-view diffs-container \{[^}]*--diffs-font-family: var\(--font-mono\)[^}]*font-weight: var\(--font-mono-weight\)/);
  assert.match(globals, /\.markdown-body :is\(h1, h2, h3, h4, h5, h6, strong, b\) code \{\s*font-weight: inherit/);
});

test('HELD cross-owner AppShell font restore/composer family-weight remeasurement wiring (not mounted proof)', async () => {
  const shell = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
  const input = await readFile(new URL('./ChatInput.tsx', import.meta.url), 'utf8');
  assert.match(shell, /useFontPreferences\(\);/);
  assert.match(input, /useLayoutEffect\(resizeTextarea, \[value, fontSize, uiFontFamily, uiWeight, resizeTextarea\]\)/);
  assert.match(input, /useChatAppearance\(\)/);
  assert.match(input, /aria-label=\{fullWidth \? t\("chat.useReadingWidth"\) : t\("chat.useFullWidth"\)\}/);
  assert.match(input, /onClick=\{\(\) => setFullWidth\(!fullWidth\)\}/);
});
