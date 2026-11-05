import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { composerFixture, inputText } from './composer.fixture.mjs';

test('a secondary chat cannot replace the main global Stop owner or expose BTW tool switching', async t => {
  const f = composerFixture(t);
  const shortcuts = await f.jiti.import('../hooks/useKeyboardShortcuts.ts');
  let mainStops = 0, childStops = 0;
  shortcuts.registerAbortHandler(() => { mainStops++; });
  t.after(() => shortcuts.registerAbortHandler(null));
  const session = { id: 'btw-child', cwd: '', path: '', created: '', modified: '', firstMessage: '', messageCount: 0,
    relation: { kind: 'btw', parentSessionId: 'source', sourceLeafId: null } };
  const h = await f.chat({ agentRunning: true, handleAbort() { childStops++; }, handleToolPresetChange() { assert.fail('no tool switching'); }, toolPreset: 'none' }, { session, secondary: true });
  function Shortcuts() { shortcuts.useGlobalKeyboardShortcuts({}); return null; }
  const props = { session, secondary: true, archivedRootSessionId: null, archiveActionBusy: false, onSessionRestored() {}, newSessionCwd: null, newSessionDraftKey: null, state: h.state, work: h.work };
  await h.view.rerender(createElement(h.p.I18nProvider, null, createElement(Shortcuts), createElement(h.p.ChatView, props)));
  await h.view.dispatch(h.view.window.document.body, new h.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(mainStops, 1); assert.equal(childStops, 0);
  props.state = { ...h.state, agentRunning: false };
  await h.view.rerender(createElement(h.p.I18nProvider, null, createElement(Shortcuts), createElement(h.p.ChatView, props)));
  assert.equal(h.view.container.querySelector('[title^="Change tool preset"]') === null, true);
  await h.view.dispatch(h.view.window.document.body, new h.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(mainStops, 2, 'idle secondary must not clear main ownership');
});

test('mounting and hiding an independent BTW view preserves the exact source question node and unsent answer', async t => {
  const f = composerFixture(t);
  const responses = [];
  const request = { type: 'extension_ui_request', id: 'waiting-question', method: 'ask_user_batch', title: 'Choose the next step',
    questions: [{ id: 'choice', shortLabel: 'Choice', question: 'What next?', type: 'text', required: true, options: [] }] };
  const h = await f.chat({ extensionDialog: request, respondToExtensionUi: async (...args) => { responses.push(args); } });
  const childWork = h.p.createComposerWork(); f.join(() => childWork.whenSettled());
  const base = { session: null, archivedRootSessionId: null, archiveActionBusy: false, onSessionRestored() {}, newSessionCwd: null, newSessionDraftKey: null };
  const child = { ...h.state, extensionDialog: null, messages: [{ role: 'assistant', content: [{ type: 'text', text: 'Independent answer' }] }], entryIds: ['answer'], streamingStore: h.p.createStreamingStore(), scrollContainerRef: { current: null }, sessionIdRef: { current: 'btw' } };
  const element = show => createElement(h.p.I18nProvider, null, createElement('div', null,
    createElement(h.p.ChatView, { ...base, key: 'main', state: h.state, work: h.work }),
    createElement('aside', { hidden: !show }, show && createElement(h.p.ChatView, { ...base, secondary: true, key: 'btw', state: child, work: childWork }))));
  await h.view.rerender(element(false));
  const textarea = h.view.container.querySelector('[data-question-set] textarea');
  assert.equal(Boolean(textarea), true);
  await inputText(h.view, textarea, 'Unsubmitted answer stays private');
  await h.view.rerender(element(true));
  assert.equal(h.view.container.querySelector('[data-question-set] textarea') === textarea, true);
  assert.equal(textarea.value, 'Unsubmitted answer stays private');
  assert.match(h.view.container.textContent, /Independent answer/);
  await h.view.rerender(element(false));
  assert.equal(h.view.container.querySelector('[data-question-set] textarea') === textarea, true);
  assert.equal(textarea.value, 'Unsubmitted answer stays private');
  assert.equal(responses.length, 0);
});
