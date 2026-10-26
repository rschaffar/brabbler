import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { composerFixture, inputText, click } from './composer.fixture.mjs';

test('real focus handle preserves literal drafts, caret and hidden/disabled/IME ownership', async t => {
  const f = composerFixture(t), c = await f.input();
  const text = ' literal draft\n@"my file"  ';
  await inputText(c.view, c.ta, text);
  c.ta.getClientRects = () => [{ width: 100, height: 30 }];
  const handle = c.api.current;
  let focuses = 0;
  const focus = c.ta.focus.bind(c.ta);
  c.ta.focus = options => { assert.equal(options.preventScroll, true); focuses++; focus(options); };
  await act(async () => handle.focus());
  assert.equal(c.view.window.document.activeElement === c.ta, true);
  assert.deepEqual([c.ta.selectionStart, c.ta.selectionEnd], [text.length, text.length]);
  assert.equal(c.ta.value, text);
  const parent = c.ta.parentElement;
  for (const attr of ['inert', 'hidden']) {
    parent.setAttribute(attr, ''); await act(async () => handle.focus()); parent.removeAttribute(attr);
  }
  c.ta.disabled = true; await act(async () => handle.focus()); c.ta.disabled = false;
  await c.view.dispatch(c.ta, new c.view.window.CompositionEvent('compositionstart', { bubbles: true }));
  await act(async () => handle.focus());
  await c.view.dispatch(c.ta, new c.view.window.CompositionEvent('compositionend', { bubbles: true }));
  c.ta.getClientRects = () => []; await act(async () => handle.focus());
  await c.view.unmount(); await act(async () => handle.focus());
  assert.equal(focuses, 1);
});

test('real Ask here insertion retains the suffix and owns the caret without clearing document selection afterwards', async t => {
  const f = composerFixture(t), c = await f.chat({ messages: [{ role: 'assistant', content: [{ type: 'text', text: 'selected response' }] }], entryIds: ['answer'] }, { quoteSelectionEnabled: true });
  const ta = c.view.container.querySelector('textarea');
  await inputText(c.view, ta, 'prefix suffix'); ta.setSelectionRange(6, 6);
  const target = c.view.container.querySelector('[data-message-role="assistant"] p'); assert.ok(target);
  const selection = c.view.window.getSelection(), range = c.view.window.document.createRange(); range.selectNodeContents(target); selection.removeAllRanges(); selection.addRange(range);
  await c.view.dispatch(target, new c.view.window.Event('pointerup', { bubbles: true }));
  const toolbar = c.view.window.document.querySelector('[role="toolbar"]'); assert.ok(toolbar);
  let cleared = 0; const remove = selection.removeAllRanges.bind(selection);
  selection.removeAllRanges = () => { cleared++; remove(); };
  await click(c.view, toolbar.querySelector('[aria-label="Ask here"]')); await f.frame();
  assert.equal(cleared, 0); assert.equal(ta.value.startsWith('prefix '), true); assert.equal(ta.value.endsWith(' suffix'), true);
  assert.equal(ta.value.includes('> selected response'), true);
  assert.equal(ta.selectionStart, ta.value.length - ' suffix'.length); assert.equal(ta.selectionEnd, ta.selectionStart);
  assert.equal(c.view.window.document.activeElement === ta, true);
});

test('actual chat composition binds draft keys to provisional and saved identities without retargeting other drafts', async t => {
  const f = composerFixture(t), p = await f.load();
  const provisional = 'new:chat-view-draft', saved = 'saved-chat-view-draft';
  f.release(() => { p.clearDraft(provisional); p.clearDraft(saved); });
  p.setDraft(provisional, { value: 'provisional literal', images: [] }); p.setDraft(saved, { value: 'saved literal', images: [] });
  const c = await f.chat({}, { newSessionDraftKey: provisional });
  assert.equal(c.view.container.querySelector('textarea').value, 'provisional literal');
  await c.update({}, { session: { id: saved, cwd: '', firstMessage: '', messageCount: 0 } });
  assert.equal(c.view.container.querySelector('textarea').value, 'saved literal');
  assert.equal(p.getDraft(provisional).value, 'provisional literal');
});
