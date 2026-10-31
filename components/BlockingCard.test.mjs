import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { packet, click, input, key, textButton } from './cards-git.fixture.mjs';
import { review, overview, page, preview, live, deliver } from './operation-review.fixture.mjs';

async function ssr(t) {
  const h = await packet(t), { I18nProvider } = await h.load('../hooks/useI18n.tsx');
  return { ...h, html: element => renderToStaticMarkup(createElement(I18nProvider, null, element)) };
}
const pluginRequest = () => ({ type: 'extension_ui_request', id: 'request', method: 'plugin_card', pluginId: 'example', title: 'Review',
  subtitle: 'Approval required', fields: [{ label: 'Checkout', value: '/repo/<script>', code: true }],
  sections: [{ title: 'Message', text: 'Exact\n\nMessage', code: true },
    { title: 'Checks', fields: [{ label: 'Tests', value: 'npm test', code: true }] },
    { title: 'Warning', text: 'All selected files', notice: true }, { title: 'Technical details', text: 'full IDs', collapsible: true }],
  scope: 'Approve the entire candidate', actions: [{ id: 'reject', label: 'Reject' }, { id: 'approve', label: 'Approve commit', primary: true }] });

test('observer-only native attachment and selected-file rerenders retain accepted reads; new files use the current observer', async t => {
  const h = await packet(t, { review: true }), { ReviewAttachment } = await h.load('./plugin-ui/ReviewAttachment.tsx');
  const old = [], first = [], current = [];
  const observe = list => work => { list.push(work); h.onReadWork(work); };
  const render = observer => h.render(createElement(ReviewAttachment, { sessionId: 'current', review, onReadWork: observer }));
  await render(observe(old));
  const accepted = live(h, 'overview'), count = h.requests.length, oldCount = old.length;
  assert.equal(old.includes(accepted.readWork), true);
  await render(observe(first)); assert.equal(h.requests.length, count); assert.equal(first.length, 0);
  assert.equal(accepted.signal.aborted, false);
  await deliver(h, 'overview', overview()); await deliver(h, 'page', page('first', 'second'));
  const selectedRead = live(h, 'preview'); assert.equal(first.includes(selectedRead.readWork), true);
  await deliver(h, 'preview', preview('raw first file'));
  await click(h.view, h.view.container.querySelector('[aria-label="Next file"]'));
  const held = live(h, 'preview'), heldCount = h.requests.length, firstCount = first.length;
  assert.equal(held.url.searchParams.get('file'), '1'); assert.equal(first.includes(held.readWork), true);
  const browser = h.view.container.querySelector('.review-file-browser'), content = browser.querySelector('.review-file-content');
  const selected = browser.querySelector('.review-file-navigation [aria-live]'); assert.equal(selected.textContent, 'second');
  await render(observe(current)); assert.equal(h.requests.length, heldCount); assert.equal(held.signal.aborted, false);
  assert.equal(h.view.container.querySelector('.review-file-browser') === browser, true);
  assert.equal(browser.querySelector('.review-file-content') === content, true); assert.equal(browser.querySelector('.review-file-navigation [aria-live]') === selected, true);
  assert.equal(current.length, 0); assert.equal(first.length, firstCount); assert.equal(old.length, oldCount);
  await deliver(h, 'preview', preview('raw second file'));
  assert.equal(content.querySelector('[aria-label="Raw patch"]').textContent, 'raw second file');
  const from = h.requests.length;
  await click(h.view, h.view.container.querySelector('[aria-label="Previous file"]'));
  const admitted = h.requests.slice(from); assert.ok(admitted.length);
  for (const read of admitted) { assert.equal(read.url.searchParams.get('file'), '0'); assert.equal(current.includes(read.readWork), true); }
  assert.equal(old.length, oldCount); assert.equal(first.length, firstCount);
  await deliver(h, 'preview', preview('current first file')); assert.match(content.textContent, /current first file/);
});

test('shared shell SSR labels grouped sections/forms, escapes titles, and retains collapsed draft markup', async t => {
  const h = await ssr(t), { BlockingCard } = await h.load('./BlockingCard.tsx');
  const props = { title: 'Question <script>', label: 'Pending', children: createElement('input', { defaultValue: 'draft' }),
    footer: createElement('button', null, 'Submit'), onCollapse() {} };
  const html = h.html(createElement(BlockingCard, props));
  assert.match(html, /<section role="group" aria-label="Question &lt;script&gt;" aria-labelledby=/);
  for (const part of ['header', 'body', 'footer']) assert.match(html, new RegExp(`blocking-card-${part}`));
  assert.doesNotMatch(html, /<script>/);
  const form = h.html(createElement(BlockingCard, { ...props, onSubmit() {}, collapsed: true, onExpand() {} }));
  assert.match(form, /blocking-card-collapsed/); assert.match(form, /<form hidden="" role="group"/); assert.match(form, /value="draft"/);
});

test('generic plugin SSR preserves exact fields, warnings, checks and complete approval scope', async t => {
  const h = await ssr(t), { PluginCard } = await h.load('./plugin-ui/PluginCard.tsx');
  const html = h.html(createElement(PluginCard, { request: pluginRequest(), onRespond() {} }));
  assert.match(html, /<dt>Checkout<\/dt><dd class="blocking-card-code">\/repo\/&lt;script&gt;/);
  assert.match(html, /Exact\n\nMessage/); assert.match(html, /npm test/); assert.match(html, /blocking-card-notice/);
  assert.match(html, /<details[^>]*><summary[^>]*>Technical details/); assert.match(html, /Approve the entire candidate/);
  assert.match(html, /data-primary="true"[^>]*>Approve commit/); assert.doesNotMatch(html, /<script>/);
});

test('large reference-only review SSR remains bounded with the complete live action and exact read path', async t => {
  const h = await ssr(t), { PluginCard } = await h.load('./plugin-ui/PluginCard.tsx');
  const request = { ...pluginRequest(), title: 'Large operation', operationId: 'operation', scope: 'Approve the entire operation',
    review: { version: 1, id: 'review', operationId: 'operation', sha256: 'a'.repeat(64), entries: 100000, bytes: 5_000_000_000 },
    actions: [{ id: 'approve', label: 'Approve merge', primary: true }] };
  const html = h.html(createElement(PluginCard, { request, sessionId: 'current-session', onRespond() {} }));
  assert.match(html, /Legacy review unavailable; offline migration required/); assert.doesNotMatch(html, /Download complete exact/);
  assert.match(html, /data-primary="true"[^>]*>Approve merge/); assert.match(html, /Approve the entire operation/);
  assert.equal(html.length < 10000, true); assert.equal(h.requests.length, 0, 'SSR never starts attachment reads');
});

test('selected native patch download remains exact-owner scoped; complete resource metadata is collapsed and lazy', async t => {
  const h = await packet(t, { review: true }), { ReviewAttachment } = await h.load('./plugin-ui/ReviewAttachment.tsx');
  await h.render(createElement(ReviewAttachment, { sessionId: 'current', onReadWork: h.onReadWork, review }));
  await deliver(h, 'overview', overview()); await deliver(h, 'page', page('first', 'second'));
  await click(h.view, h.view.container.querySelector('[aria-label="Next file"]'));
  await deliver(h, 'preview', preview('raw selected exact patch'));
  assert.equal(h.view.container.querySelector('[aria-label="Raw patch"]').textContent, 'raw selected exact patch');
  assert.deepEqual([...h.view.container.querySelectorAll('.review-file-content a')].map(a => a.getAttribute('href')),
    ['/api/sessions/current/reviews/review?view=proposal&file=1&op=patch']);
  const details = h.view.container.querySelector('details'); assert.equal(details.open, false);
  assert.equal(h.requests.some(read => read.url.searchParams.get('op') === 'details'), false);
  await h.render(createElement(ReviewAttachment, { key: 'metadata', sessionId: 'current', onReadWork: h.onReadWork, review }));
  const resource = overview(); resource.hasFiles = false; resource.views[0].available = false; resource.views[0].reason = 'Resources, not a patch.';
  await deliver(h, 'overview', resource);
  assert.equal(h.view.container.querySelector('.review-file-browser') === null, true);
  assert.equal(h.view.container.querySelector('details').open, false);
});

test('live review failure keeps whole scope and current actions; collapse/fullscreen never narrow or answer it', async t => {
  const h = await packet(t, { review: true }), { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const request = { ...pluginRequest(), id: 'live-review', allowDetails: true,
    review };
  const old = [], current = [];
  let props = { request, sessionId: 'current', onReadWork: h.onReadWork, onRespond: async (...args) => { old.push(args); } };
  const render = async next => { props = { ...props, ...next }; await h.render(createElement(BlockingRequestCard, props)); };
  await render({});
  await deliver(h, 'overview', { error: 'Review unavailable' }, { status: 409 });
  assert.match(h.view.container.querySelector('[role=alert]').textContent, /Review unavailable/);
  assert.match(h.view.container.querySelector('.blocking-card-footer').textContent, /Approve the entire candidate/);
  const field = h.view.container.querySelector('textarea'); await input(h.view, field, 'exact additional details'); field.focus();
  await click(h.view, h.view.container.querySelector('[aria-label="Collapse"]'));
  await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
  assert.equal(h.view.container.querySelector('textarea') === field, true); assert.equal(field.value, 'exact additional details');
  await click(h.view, h.view.container.querySelector('[aria-label="Open fullscreen review"]'));
  await key(h.view, h.view.container.querySelector('dialog.blocking-card-dialog'), 'Escape');
  assert.deepEqual(old, []); assert.deepEqual(current, []);
  const updated = { ...request, title: 'Current exact review' };
  await render({ request: updated, onRespond: async (...args) => { current.push(args); } });
  await click(h.view, textButton(h.view.container, 'Reject'));
  assert.equal(current[0][0] === updated, true); assert.deepEqual(current[0][1], { action: 'reject', details: 'exact additional details' });
  assert.equal(textButton(h.view.container, 'Approve commit').disabled, true);
  await h.view.dispatch(textButton(h.view.container, 'Approve commit'), new h.view.window.MouseEvent('click', { bubbles: true }));
  assert.equal(current.length, 1, 'the live sentRef rejects duplicate answers'); assert.deepEqual(old, []);
  await render({ request: { ...updated, id: 'new-live-request', review: undefined } });
  assert.equal(h.view.container.querySelector('textarea').value, '', 'a new request owns a fresh details/sent lifetime');
  await click(h.view, textButton(h.view.container, 'Approve commit'));
  assert.equal(current.at(-1)[0].id, 'new-live-request'); assert.deepEqual(current.at(-1)[1], { action: 'approve', details: '' });
  await render({ request: { ...updated, id: 'cancel-live-request', review: undefined } });
  await key(h.view, h.view.container.querySelector('[role=group]'), 'Escape', { isComposing: true });
  assert.equal(current.length, 2);
  await key(h.view, h.view.container.querySelector('[role=group]'), 'Escape');
  assert.equal(current.at(-1)[0].id, 'cancel-live-request'); assert.deepEqual(current.at(-1)[1], { cancelled: true });
});

test('historical shell SSR omits expensive collapsed bodies and labels their outcome, not a pending request', async t => {
  const h = await ssr(t), { BlockingCard } = await h.load('./BlockingCard.tsx');
  let rendered = 0;
  const Content = () => { rendered++; return createElement('div', null, 'diff renderer'); };
  const html = h.html(createElement(BlockingCard, { title: 'Approval', collapsed: true, collapsedLabel: 'Answered', retainBodyWhenCollapsed: false,
    onExpand() {}, footer: createElement('p', null, 'Decision only') }, createElement(Content)));
  assert.match(html, /Answered/); assert.doesNotMatch(html, /Pending|diff renderer/); assert.equal(rendered, 0);
});

const interaction = () => ({ version: 1, outcome: 'answered', response: { action: 'approve' }, request: {
  type: 'extension_ui_request', id: 'receipt', method: 'plugin_card', pluginId: 'example', title: 'Commit',
  text: 'Exact message', patch: 'exact patch', scope: 'Entire candidate', subtitle: 'Approval required',
  actions: [{ id: 'approve', label: 'Approve commit', primary: true }],
} });
const operation = () => ({ version: 1, pluginId: 'example', sequence: 1, operationId: 'a046677d-8293-4445-9a2b-558317345abc', toolCallId: 'call-1',
  card: { title: 'Operation', text: 'Exact candidate', scope: 'Entire candidate', patch: 'exact patch',
    actions: [{ id: 'approve', label: 'Forbidden callback control' }] }, phase: 'executing',
  authorization: { mode: 'allow', source: 'session', revision: 'revision-1', decision: 'policy-authorized' },
  checks: [{ name: 'Tests', status: 'passed' }], effectStarted: true });
const assertInert = root => {
  assert.equal(root.querySelector('form, input, textarea, [type=submit], [data-primary]') === null, true);
  // Saved response text may legitimately repeat an action label. Reject actual
  // actionable controls, not the historical decision being displayed.
  for (const control of root.querySelectorAll('button, [role="button"], [role="menuitem"]')) {
    const name = [control.getAttribute('aria-label'), control.getAttribute('title'), control.textContent].filter(Boolean).join(' ');
    assert.doesNotMatch(name, /Forbidden callback control|Approve commit/);
  }
};

test('actual receipt expansion preserves decision scope and patch but can never answer or execute', async t => {
  const h = await ssr(t), { InteractionReceiptCard } = await h.load('./InteractionReceiptCard.tsx'), receipt = interaction();
  const collapsed = h.html(createElement(InteractionReceiptCard, { receipt }));
  assert.match(collapsed, /data-interaction-receipt="receipt"/); assert.match(collapsed, /aria-expanded="false"/);
  assert.doesNotMatch(collapsed, /Exact message|exact patch|Pending/);
  await h.render(createElement(InteractionReceiptCard, { receipt }));
  await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
  for (const text of ['Exact message', 'exact patch', 'Entire candidate', 'Approval required', 'Decision only']) assert.match(h.view.container.textContent, new RegExp(text));
  assertInert(h.view.container);
  assert.equal(h.view.container.querySelectorAll('button').length, 2, 'only collapse/fullscreen, no fabricated action');
  assert.equal(Boolean(h.view.container.querySelector('[aria-label="Open fullscreen review"]')), true);
  const recordedResponse = [...h.view.container.querySelectorAll('pre.blocking-card-code')].find(node => node.textContent === 'Approve commit');
  assert.equal(Boolean(recordedResponse), true, 'the saved approval decision remains readable history');
  // Attempts to activate the real historical response text must stay inert;
  // transport/error guards remain live even if an accidental handler catches.
  await click(h.view, recordedResponse);
  await key(h.view, recordedResponse, 'Enter');
  await key(h.view, recordedResponse, ' ');
  assertInert(h.view.container);
  assert.equal(h.requests.length, 0, 'activating historical response text cannot dispatch an operation');
  await click(h.view, h.view.container.querySelector('[aria-label="Open fullscreen review"]'));
  assertInert(h.view.container);
  await key(h.view, h.view.container.querySelector('dialog'), 'Escape');
  await click(h.view, h.view.container.querySelector('[aria-label="Collapse"]'));
  assert.doesNotMatch(h.view.container.textContent, /Exact message|exact patch/);
  assert.equal(h.requests.length, 0, 'history offers no execution transport');
});

test('actual operation expansion separates policy authorization from unknown execution, including intent-only and failure', async t => {
  const h = await ssr(t), { OperationReceiptCard } = await h.load('./OperationReceiptCard.tsx'), receipt = operation();
  const collapsed = h.html(createElement(OperationReceiptCard, { receipt }));
  assert.match(collapsed, /aria-expanded="false"/); assert.match(collapsed, /Policy authorized/); assert.match(collapsed, /outcome unknown/);
  assert.doesNotMatch(collapsed, /Exact candidate|exact patch|Forbidden callback control|User accepted|Succeeded/);
  const terminal = h.html(createElement(OperationReceiptCard, { receipt: { ...receipt, phase: 'failed' } }));
  assert.match(terminal, /Failed/); assert.doesNotMatch(terminal, /outcome unknown/);
  await h.render(createElement(OperationReceiptCard, { receipt })); await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
  for (const text of ['Exact candidate', 'exact patch', 'Entire candidate', 'revision-1', 'call-1', 'Tests: passed', 'Effect started'])
    assert.equal(h.view.container.textContent.includes(text), true, text);
  assertInert(h.view.container); assert.equal(h.view.container.querySelectorAll('button').length, 2);
  assert.doesNotMatch(h.view.container.textContent, /Forbidden callback control/, 'operation card actions are not receipt content');
  await h.render(createElement(OperationReceiptCard, { receipt: { ...receipt, effectStarted: false } }));
  assert.match(h.view.container.textContent, /Effect may have started/); assert.doesNotMatch(h.view.container.textContent, /Effect not started/);
  assertInert(h.view.container);
  assert.doesNotMatch(h.view.container.textContent, /Forbidden callback control/);
  await h.render(createElement(OperationReceiptCard, { receipt: { ...receipt, phase: 'failed' } }));
  assert.match(h.view.container.textContent, /Failed/); assert.doesNotMatch(h.view.container.textContent, /outcome unknown/);
  assertInert(h.view.container);
  assert.doesNotMatch(h.view.container.textContent, /Forbidden callback control/);
  assert.equal(h.requests.length, 0, 'an execution receipt never replays an operation');
});

test('serialized legacy and postflight outcome summaries stay readable and inert', async t => {
  const h = await packet(t), { OperationReceiptCard } = await h.load('./OperationReceiptCard.tsx');
  const summaries = [undefined,
    'merge native outcome: completed; postflight: verified. Selected target and feature observed clean.',
    'merge native outcome: completed; postflight: unavailable. Do not repeat the operation.',
    'cleanupFeature native outcome: started; postflight: not-run. Completed one step; remaining resource present.'];
  for (const [index, summary] of summaries.entries()) {
    const receipt = JSON.parse(JSON.stringify({ ...operation(), phase: index === 3 ? 'failed' : 'succeeded', ...(summary ? { summary } : {}) }));
    await h.render(createElement(OperationReceiptCard, { receipt }));
    const collapsed = h.view.container.querySelector('.blocking-card-collapsed');
    if (collapsed) await click(h.view, collapsed);
    if (summary) assert.equal(h.view.container.textContent.includes(summary), true);
    else assert.doesNotMatch(h.view.container.textContent, /postflight/);
    assertInert(h.view.container);
  }
  assert.equal(h.requests.length, 0, 'historical summaries cannot execute or replay');
});

test('actual expanded question history preserves context, described choices and normalized read-only answer', async t => {
  const h = await packet(t), { InteractionReceiptCard } = await h.load('./InteractionReceiptCard.tsx');
  const receipt = { version: 1, outcome: 'answered', response: { answer: { kind: 'selection', selections: ['Second'], comment: 'Explanation' } },
    request: { type: 'extension_ui_request', id: 'question', method: 'ask_user', question: 'Which?', context: 'Background',
      options: [{ title: 'First', description: 'First details' }, { title: 'Second', description: 'Second details' }],
      allowMultiple: false, allowFreeform: true, allowComment: true, contextExpanded: false } };
  await h.render(createElement(InteractionReceiptCard, { receipt })); await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
  for (const text of ['Background', 'Second — Explanation', 'First details', 'Second details']) assert.equal(h.view.container.textContent.includes(text), true);
  assert.equal(h.view.container.querySelector('[data-selected=true] strong').textContent, 'Second');
  assertInert(h.view.container);
});

test('real BlockingCard fullscreen keeps body/draft/scroll identity, wraps Tab, and gives nested Escape first refusal', async t => {
  const h = await packet(t), { BlockingCard } = await h.load('./BlockingCard.tsx');
  function Owner() {
    const [collapsed, setCollapsed] = useState(false);
    return createElement(BlockingCard, { title: 'Exact review', allowFullscreen: true, collapsed,
      onCollapse: () => setCollapsed(true), onExpand: () => setCollapsed(false),
      footer: createElement('button', { type: 'button' }, 'Action footer') }, createElement('input', { defaultValue: 'draft' }));
  }
  await h.render(createElement(Owner));
  const body = h.view.container.querySelector('.blocking-card-body'), field = body.querySelector('input'); body.scrollTop = 91;
  await click(h.view, h.view.container.querySelector('[aria-label="Open fullscreen review"]'));
  const restore = h.view.container.querySelector('[aria-label="Restore inline review"]'), dialog = h.view.container.querySelector('dialog');
  assert.equal(h.view.container.querySelector('.blocking-card-body') === body, true); assert.equal(body.scrollTop, 91);
  assert.equal(body.querySelector('input') === field, true); assert.equal(field.value, 'draft');
  assert.equal(h.view.window.document.activeElement === restore, true);
  const last = textButton(h.view.container, 'Action footer'); last.focus();
  assert.equal(await key(h.view, last, 'Tab'), true); assert.equal(h.view.window.document.activeElement === restore, true);
  assert.equal(await key(h.view, restore, 'Tab', { shiftKey: true }), true); assert.equal(h.view.window.document.activeElement === last, true);
  const nested = h.view.window.document.createElement('dialog'); nested.open = true; const nestedControl = h.view.window.document.createElement('button'); nested.append(nestedControl); body.append(nested);
  assert.equal(await key(h.view, nestedControl, 'Escape'), false); assert.equal(dialog.getAttribute('role'), 'dialog'); nested.remove();
  assert.equal(await key(h.view, restore, 'Escape', { isComposing: true }), false); assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.equal(await key(h.view, restore, 'Escape'), true); assert.equal(dialog.getAttribute('role'), 'presentation');
  assert.equal(h.view.window.document.activeElement === restore, true);
  assert.equal(h.view.container.querySelector('.blocking-card-body') === body, true);
});

test('blocking-card CSS declaration contract retains bounded header/body and fixed footer', async () => {
  // Deliberate presentation-declaration retain, not an effect/layout/behavior oracle.
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.match(css, /\.blocking-card-title[^\n]*white-space: pre-wrap; overflow-wrap: anywhere/);
  assert.match(css, /\.blocking-card-header[^\n]*max-height: min\(180px, 22dvh\); overflow-y: auto/);
  assert.match(css, /\.blocking-card-body[^\n]*min-height: 0; overflow-y: auto/);
  assert.match(css, /\.blocking-card-footer[^\n]*flex-shrink: 0/);
});
