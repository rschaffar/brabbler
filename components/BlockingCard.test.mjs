import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { packet, click, input, key, textButton } from './cards-git.fixture.mjs';

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

test('observer-only attachment and selected-entry rerenders retain accepted reads; new entries use the current observer', async t => {
  const h = await packet(t, { review: true }), { ReviewAttachment } = await h.load('./plugin-ui/ReviewAttachment.tsx');
  const old = [], first = [], current = [];
  const observe = list => work => { list.push(work); h.onReadWork(work); };
  const oldObserver = observe(old), firstObserver = observe(first), currentObserver = observe(current);
  const metadata = { id: 0, label: 'Exact operation', bytes: 100, kind: 'text', sha256: 'a'.repeat(64) };
  const patch = { id: 1, label: 'a/file b/file', bytes: 100, kind: 'patch', sha256: 'b'.repeat(64) };
  const review = { version: 1, id: 'review', operationId: 'operation', bytes: 1024, entries: 2, sha256: 'c'.repeat(64) };
  const render = observer => h.render(createElement(ReviewAttachment, { sessionId: 'current', review, onReadWork: observer }));
  const live = name => h.requests.findLast(request => !request.signal.aborted && request.url.searchParams.has(name));
  await render(oldObserver);
  const pageRead = live('start'), aggregateRead = live('patch'), count = h.requests.length, oldCount = old.length;
  assert.equal(old.includes(pageRead.readWork), true); assert.equal(old.includes(aggregateRead.readWork), true);
  await render(firstObserver);
  assert.equal(h.requests.length, count, 'observer-only update cannot restart page or aggregate reads');
  assert.equal(pageRead.signal.aborted, false); assert.equal(aggregateRead.signal.aborted, false);
  assert.equal(first.length, 0, 'accepted work is not replayed to a replacement observer');
  await h.reply(pageRead, { entries: [metadata, patch], total: 2, next: null });
  await h.reply(aggregateRead, '', { status: 503 });
  const metadataRead = live('entry');
  assert.equal(metadataRead.url.searchParams.get('entry'), '0');
  assert.equal(first.includes(metadataRead.readWork), true, 'the newly mounted entry receives the current observer and exact promise');
  await h.reply(metadataRead, { text: 'Exact metadata body', complete: true, offset: 0, next: null });
  await click(h.view, h.view.container.querySelector('[aria-label="Next file"]'));
  const heldEntry = live('entry'), heldCount = h.requests.length, firstCount = first.length;
  assert.equal(heldEntry.url.searchParams.get('entry'), '1'); assert.equal(first.includes(heldEntry.readWork), true);
  const browser = h.view.container.querySelector('.review-file-browser');
  const content = browser.querySelector('.review-file-content');
  const selected = browser.querySelector('.review-file-navigation [aria-live]');
  assert.equal(selected.textContent, patch.label);
  await render(currentObserver);
  assert.equal(h.requests.length, heldCount, 'neither the entry nor its parent reads may restart on an observer swap');
  assert.equal(heldEntry.signal.aborted, false); assert.equal(pageRead.signal.aborted, false); assert.equal(aggregateRead.signal.aborted, false);
  assert.equal(h.view.container.querySelector('.review-file-browser') === browser, true);
  assert.equal(browser.querySelector('.review-file-content') === content, true);
  assert.equal(browser.querySelector('.review-file-navigation [aria-live]') === selected, true); assert.equal(selected.textContent, patch.label);
  assert.equal(current.length, 0); assert.equal(first.length, firstCount); assert.equal(old.length, oldCount);
  // Invalid raw supplied material intentionally does not claim parsed descendant
  // highlighter/context closure; that remains the independent review's limit.
  await h.reply(heldEntry, { text: 'raw selected exact patch', complete: true, offset: 0, next: null });
  const raw = content.querySelector('[aria-label="Raw patch"]'); assert.equal(raw.textContent, 'raw selected exact patch');
  assert.equal(current.length, 0); assert.equal(first.length, firstCount);
  const before = h.requests.length;
  await click(h.view, h.view.container.querySelector('[aria-label="Previous file"]'));
  const admitted = h.requests.slice(before);
  assert.equal(admitted.length > 0, true); assert.equal(current.length, admitted.length);
  for (const request of admitted) {
    assert.equal(request.url.searchParams.get('entry'), '0');
    assert.equal(current.includes(request.readWork), true, 'current observer gets each exact already-created production promise');
  }
  assert.equal(old.length, oldCount); assert.equal(first.length, firstCount);
  await h.reply(admitted.findLast(request => !request.signal.aborted), { text: 'Current metadata body', complete: true, offset: 0, next: null });
  assert.match(content.textContent, /Current metadata body/);
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
  assert.match(html, /Download complete exact patch/); assert.match(html, /\/api\/sessions\/current-session\/reviews\/review/);
  assert.match(html, /data-primary="true"[^>]*>Approve merge/); assert.match(html, /Approve the entire operation/);
  assert.equal(html.length < 10000, true); assert.equal(h.requests.length, 0, 'SSR never starts attachment reads');
});

test('failed aggregate patch naturally falls back to one selected entry; metadata-only review remains collapsed', async t => {
  const h = await packet(t, { review: true }), { ReviewAttachment } = await h.load('./plugin-ui/ReviewAttachment.tsx');
  const metadata = { id: 0, label: 'Exact operation', bytes: 100, kind: 'text', sha256: 'a'.repeat(64) };
  const patch = { id: 1, label: 'a/file b/file', bytes: 100, kind: 'patch', sha256: 'b'.repeat(64) };
  await h.render(createElement(ReviewAttachment, { sessionId: 'current', onReadWork: h.onReadWork,
    review: { version: 1, id: 'review', operationId: 'operation', bytes: 1024, entries: 2, sha256: 'c'.repeat(64) } }));
  const live = key => h.requests.filter(request => !request.signal.aborted && request.url.searchParams.has(key)).at(-1);
  await h.reply(live('start'), { entries: [metadata, patch], total: 2, next: null });
  await h.reply(live('patch'), '', { status: 503 });
  assert.match(h.view.container.textContent, /Exact patch unavailable/);
  assert.equal(Boolean(h.view.container.querySelector('.review-file-browser')), true);
  await click(h.view, h.view.container.querySelector('[aria-label="Next file"]'));
  const entry = live('entry');
  assert.equal(entry.url.searchParams.get('entry'), '1');
  await h.reply(entry, { text: 'raw selected exact patch', complete: true, offset: 0, next: null });
  assert.equal(h.view.container.querySelector('[aria-label="Raw patch"]').textContent, 'raw selected exact patch');
  const selectedEntryDownloads = [...h.view.container.querySelectorAll('.review-file-content a')].map(link => link.getAttribute('href'));
  assert.deepEqual(selectedEntryDownloads, ['/api/sessions/current/reviews/review?entry=1&download=1'], 'the selected entry retains its exact session-bound download URL');
  assert.match(h.view.container.textContent, /Download complete exact patch/);
  assert.equal(h.view.container.querySelectorAll('.review-file-content [aria-label="Raw patch"]').length, 1);
  // Same endpoint, new component lifetime: actual metadata page, no hook-index seeding.
  await h.render(createElement(ReviewAttachment, { key: 'metadata', sessionId: 'current', onReadWork: h.onReadWork,
    review: { version: 1, id: 'review', operationId: 'operation', bytes: 1024, entries: 1, sha256: 'c'.repeat(64) } }));
  await h.reply(live('start'), { entries: [metadata], total: 1, next: null }); await h.reply(live('patch'), '');
  const details = [...h.view.container.querySelectorAll('details')].find(node => /Exact operation/.test(node.textContent));
  assert.equal(Boolean(details), true); assert.equal(details.open, false);
  assert.equal(h.view.container.querySelector('.review-file-browser') === null, true);
  assert.doesNotMatch(h.view.container.textContent, /Loading review|Exact details/);
});

test('live review failure keeps whole scope and current actions; collapse/fullscreen never narrow or answer it', async t => {
  const h = await packet(t, { review: true }), { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const request = { ...pluginRequest(), id: 'live-review', allowDetails: true,
    review: { version: 1, id: 'review', operationId: 'operation', bytes: 1024, entries: 2, sha256: 'c'.repeat(64) } };
  const old = [], current = [];
  let props = { request, sessionId: 'current', onReadWork: h.onReadWork, onRespond: async (...args) => { old.push(args); } };
  const render = async next => { props = { ...props, ...next }; await h.render(createElement(BlockingRequestCard, props)); };
  await render({});
  const live = name => h.requests.filter(item => !item.signal.aborted && item.url.searchParams.has(name)).at(-1);
  await h.reply(live('start'), { entries: [], total: 0, next: null });
  await h.reply(live('patch'), '', { status: 503 });
  assert.match(h.view.container.querySelector('[role=alert]').textContent, /Exact patch unavailable/);
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
