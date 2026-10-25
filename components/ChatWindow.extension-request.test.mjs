import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, useRef } from 'react';
import { packet, click, input, key, textButton } from './cards-git.fixture.mjs';

const ask = extra => ({ type: 'extension_ui_request', id: 'question-A', method: 'ask_user', question: 'Which <script>?',
  context: '**Background**', options: [{ title: 'First', description: 'First details' }, { title: 'Second', description: 'Second details' }],
  allowMultiple: false, allowFreeform: true, allowComment: true, contextExpanded: true, ...extra });
async function card(t, request, extra = {}) {
  const h = await packet(t), { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const calls = [];
  let props = { request, onRespond: async (...args) => { calls.push(args); }, ...extra };
  const render = async next => { props = { ...props, ...next }; await h.render(createElement(BlockingRequestCard, props)); };
  await render({});
  return { ...h, calls, renderCard: render };
}
const radios = view => [...view.container.querySelectorAll('input[type=radio]')];
const submit = view => view.container.querySelector('[type=submit]');
const collapse = view => view.container.querySelector('[aria-label="Collapse"]');
const expand = view => view.container.querySelector('.blocking-card-collapsed');

for (const allowMultiple of [false, true]) test(`real question normalizes ${allowMultiple ? 'multiple' : 'single'} choices, written answers and additive details`, async t => {
  const request = ask({ allowMultiple }), h = await card(t, request);
  assert.equal(submit(h.view).disabled, true, 'recommendations/draft details do not answer');
  const form = h.view.container.querySelector('form[role=group]');
  assert.equal(form.getAttribute('aria-label'), request.question);
  assert.equal(form.closest('dialog') === null, true, 'legacy questions remain inline, not modal');
  assert.equal(h.view.container.querySelector('script') === null, true);
  assert.equal(h.view.container.querySelector('details strong').textContent, 'Background');
  for (const description of ['First details', 'Second details']) assert.equal(form.textContent.includes(description), true);
  const comment = h.view.container.querySelector('textarea');
  await input(h.view, comment, '  Explanation  ');
  assert.equal(submit(h.view).disabled, true);
  const choices = [...h.view.container.querySelectorAll(allowMultiple ? 'input[type=checkbox]' : 'input[type=radio]')].slice(0, 2);
  await click(h.view, choices[0]); await click(h.view, choices[1]);
  await click(h.view, submit(h.view));
  assert.equal(h.calls[0][0] === request, true);
  assert.deepEqual(h.calls[0][1], { answer: { kind: 'selection', selections: allowMultiple ? ['First', 'Second'] : ['Second'], comment: 'Explanation' } });
  if (allowMultiple) {
    await click(h.view, choices[0]); await click(h.view, choices[1]);
    assert.equal(submit(h.view).disabled, true, 'empty multiple selection is not an answer');
  }
  const other = radios(h.view).at(-1); await click(h.view, other);
  const freeform = h.view.container.querySelector('textarea[aria-label]');
  await input(h.view, freeform, '  A tailored answer  ');
  assert.equal(await key(h.view, freeform, 'Enter', { ctrlKey: true, isComposing: true }), false);
  assert.equal(h.calls.length, 1);
  assert.equal(await key(h.view, freeform, 'Enter', { ctrlKey: true }), true);
  assert.deepEqual(h.calls[1][1], { answer: { kind: 'freeform', text: 'A tailored answer', comment: 'Explanation' } });
  await click(h.view, choices[0]); await click(h.view, other);
  assert.equal(h.view.container.querySelector('textarea[aria-label]').value, '  A tailored answer  ', 'inactive written draft survives switching');
});

test('collapse retains the exact field/draft and restores real focus; Escape/Cancel use the current request and callback', async t => {
  const request = ask({ options: [] }), h = await card(t, request), field = h.view.container.querySelector('textarea[aria-label]');
  await input(h.view, field, 'draft'); field.focus();
  await click(h.view, collapse(h.view));
  assert.equal(h.view.container.querySelector('textarea[aria-label]') === field, true);
  assert.equal(field.closest('form').hidden, true);
  assert.equal(h.view.window.document.activeElement === expand(h.view), true);
  await click(h.view, expand(h.view));
  assert.equal(h.view.window.document.activeElement === field, true);
  assert.equal(field.value, 'draft');
  const currentRequest = { ...request, question: 'Updated live question' }, current = [];
  await h.renderCard({ request: currentRequest, onRespond: (...args) => current.push(args) });
  assert.equal(await key(h.view, field, 'Escape', { isComposing: true }), false);
  assert.equal(current.length, 0);
  let outer = 0; h.view.window.document.addEventListener('keydown', () => outer++);
  assert.equal(await key(h.view, field, 'Escape'), true);
  assert.equal(outer, 0); assert.equal(current[0][0] === currentRequest, true);
  assert.deepEqual(current[0][1], { cancelled: true });
  await click(h.view, textButton(h.view.container, 'Cancel'));
  assert.equal(current[1][0] === currentRequest, true); assert.deepEqual(current[1][1], { cancelled: true });
  await click(h.view, submit(h.view));
  assert.equal(current[2][0] === currentRequest, true); assert.deepEqual(current[2][1], { answer: { kind: 'freeform', text: 'draft' } });
  assert.deepEqual(h.calls, []);
});

test('request IDs reset real dialog state across A/B/A; current same-ID props do not reset a draft', async t => {
  const a = ask({ options: [] }), h = await card(t, a);
  await input(h.view, h.view.container.querySelector('textarea[aria-label]'), 'private A');
  const original = h.view.container.querySelector('textarea[aria-label]');
  await h.renderCard({ request: { ...a, context: 'new context' } });
  assert.equal(h.view.container.querySelector('textarea[aria-label]') === original, true);
  for (const id of ['question-B', 'question-A']) {
    await h.renderCard({ request: { ...a, id } });
    const next = h.view.container.querySelector('textarea[aria-label]');
    assert.equal(next === original, false); assert.equal(next.value, ''); assert.equal(submit(h.view).disabled, true);
    await input(h.view, next, 'only current');
  }
});

test('no-comment/no-freeform questions omit those controls; text-only questions still require trimmed main text', async t => {
  const h = await card(t, ask({ allowComment: false, allowFreeform: false }));
  assert.equal(h.view.container.querySelector('textarea') === null, true); assert.equal(radios(h.view).length, 2);
  await click(h.view, radios(h.view)[0]); await click(h.view, submit(h.view));
  assert.deepEqual(h.calls[0][1], { answer: { kind: 'selection', selections: ['First'] } });
  await h.renderCard({ request: ask({ id: 'text-only', options: [], allowFreeform: false, allowComment: false }) });
  const field = h.view.container.querySelector('textarea'); await input(h.view, field, ' \n ');
  assert.equal(submit(h.view).disabled, true);
  await input(h.view, field, '  text  '); await click(h.view, submit(h.view));
  assert.deepEqual(h.calls[1][1], { answer: { kind: 'freeform', text: 'text' } });
});

test('the production inline slot routes a question set with its session/request lifetime, not a legacy Escape answer', async t => {
  const request = { type: 'extension_ui_request', id: 'set-A', method: 'ask_user_batch', title: 'Independent decisions',
    questions: [{ id: 'scope', shortLabel: 'Scope', question: 'Choose scope', type: 'single', required: true,
      options: [{ id: 'small', title: 'Small' }, { id: 'full', title: 'Full' }] }] };
  const h = await card(t, request, { sessionId: 'current-session' });
  assert.equal(h.view.container.querySelector('[data-question-set]').getAttribute('data-question-set'), 'set-A');
  assert.equal(h.view.container.querySelector('[role=group]').getAttribute('aria-label'), request.title);
  assert.match(h.view.container.textContent, /Choose scope/);
  const first = h.view.container.querySelector('input[type=radio]');
  await key(h.view, first, 'Escape'); assert.deepEqual(h.calls, []);
  await click(h.view, collapse(h.view)); await click(h.view, expand(h.view));
  assert.equal(h.view.container.querySelector('input[type=radio]') === first, true);
  await h.renderCard({ request: { ...request, id: 'set-B' } });
  assert.equal(h.view.container.querySelector('[data-question-set]').getAttribute('data-question-set'), 'set-B');
  assert.equal(h.view.container.querySelector('input[type=radio]') === first, false);
});

test('select renders actual Markdown inertly, focuses its first option and navigates every direction', async t => {
  const request = { type: 'extension_ui_request', id: 'select-A', method: 'select', title: 'Choose\nexactly',
    options: ['**First** [link](https://example.invalid)', '*Second*', 'Third'] };
  const h = await card(t, request), options = [...h.view.container.querySelectorAll('[data-extension-option]')];
  assert.equal(h.view.window.document.activeElement === options[0], true);
  assert.equal(Boolean(options[0].querySelector('strong')), true);
  assert.equal(Boolean(options[0].querySelector('[inert] a')), true);
  assert.equal(options[0].getAttribute('aria-label'), request.options[0]);
  for (const [from, pressed, to] of [[0, 'ArrowDown', 1], [1, 'ArrowRight', 2], [2, 'ArrowDown', 0], [0, 'ArrowUp', 2], [2, 'ArrowLeft', 1], [1, 'Home', 0], [0, 'End', 2]]) {
    assert.equal(await key(h.view, options[from], pressed), true);
    assert.equal(h.view.window.document.activeElement === options[to], true);
  }
  const current = [], updated = { ...request, title: 'Current title' };
  await h.renderCard({ request: updated, onRespond: (...args) => current.push(args) });
  await key(h.view, options[1], 'Enter'); await key(h.view, options[2], ' '); await click(h.view, options[0]);
  assert.equal(current.every(([actual]) => actual === updated), true);
  assert.deepEqual(current.map(([, response]) => response), request.options.slice(1).map(value => ({ value })).concat({ value: request.options[0] }));
  assert.deepEqual(h.calls, []);
  assert.equal(h.view.container.querySelector('[aria-modal]') === null, true);
  assert.equal(h.view.container.querySelector('[role=group]').getAttribute('aria-label'), updated.title);
});

for (const method of ['input', 'editor', 'confirm', 'select']) test(`${method} uses real collapse/cancel and keyboard/IME contracts with exact identity`, async t => {
  const request = { type: 'extension_ui_request', id: `${method}-A`, method, title: 'Extension',
    ...(method === 'confirm' ? { message: '**Exact** confirmation' } : method === 'select' ? { options: [] } : method === 'editor' ? { prefill: 'prefill' } : { placeholder: 'Enter a value' }) };
  const h = await card(t, request), field = h.view.container.querySelector('input, textarea');
  if (field) {
    assert.equal(field.value, method === 'editor' ? 'prefill' : ''); await input(h.view, field, ' exact value '); field.focus();
    await click(h.view, collapse(h.view)); await click(h.view, expand(h.view));
    assert.equal(h.view.container.querySelector('input, textarea') === field, true); assert.equal(field.value, ' exact value ');
    await key(h.view, field, 'Enter', { ctrlKey: method === 'editor', isComposing: true }); assert.equal(h.calls.length, 0);
    if (method === 'editor') { await key(h.view, field, 'Enter'); assert.equal(h.calls.length, 0); }
    await key(h.view, field, 'Enter', { ctrlKey: method === 'editor' });
    assert.equal(h.calls[0][0] === request, true); assert.deepEqual(h.calls[0][1], { value: ' exact value ' });
  } else if (method === 'confirm') {
    assert.equal(Boolean(h.view.container.querySelector('strong')), true);
    await click(h.view, textButton(h.view.container, 'Confirm'));
    assert.equal(h.calls[0][0] === request, true); assert.deepEqual(h.calls[0][1], { confirmed: true });
  } else assert.equal(h.view.container.querySelector('[data-extension-option]') === null, true);
  if (!field) {
    await click(h.view, collapse(h.view)); assert.equal(Boolean(expand(h.view)), true);
    await click(h.view, expand(h.view));
  }
  const before = h.calls.length, current = [], updated = { ...request, title: 'Current live request' };
  await h.renderCard({ request: updated, onRespond: async (...args) => { current.push(args); } });
  if (method !== 'select') {
    await click(h.view, textButton(h.view.container, method === 'confirm' ? 'Confirm' : 'Submit'));
    assert.equal(current[0][0] === updated, true);
    assert.deepEqual(current[0][1], method === 'confirm' ? { confirmed: true } : { value: ' exact value ' });
  }
  const beforeEscape = current.length;
  await key(h.view, h.view.container.querySelector('[role=group]'), 'Escape', { isComposing: true });
  assert.equal(current.length, beforeEscape);
  await click(h.view, textButton(h.view.container, 'Cancel'));
  assert.equal(current.at(-1)[0] === updated, true); assert.deepEqual(current.at(-1)[1], { cancelled: true });
  await key(h.view, h.view.container.querySelector('[role=group]'), 'Escape');
  assert.equal(current.at(-1)[0] === updated, true); assert.deepEqual(current.at(-1)[1], { cancelled: true });
  assert.equal(h.calls.length, before, 'old responders must not be retained by current controls');
  if (field) {
    await h.renderCard({ request: { ...request, id: `${method}-B` } });
    const next = h.view.container.querySelector('input, textarea');
    assert.equal(next === field, false, 'the real inline slot, not the fixture, keys ExtensionDialog by request ID');
    assert.equal(next.value, method === 'editor' ? 'prefill' : '');
  }
});

for (const method of ['ask_user', 'input']) test(`${method} countdown displays zero without authorizing local expiry, and releases its interval`, async t => {
  const callbacks = new Map(); let id = 0, now = 10_000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { assert.equal(delay, 1000); const token = ++id; callbacks.set(token, callback); return token; });
  t.mock.method(globalThis, 'clearInterval', token => callbacks.delete(token));
  const request = method === 'ask_user' ? ask({ expiresAt: 11_500 })
    : { type: 'extension_ui_request', id: 'input-countdown', method, title: 'Expiring', expiresAt: 11_500 };
  const h = await card(t, request);
  assert.equal(callbacks.size, 1, 'Strict replay released its first interval');
  assert.match(h.view.container.textContent, /2s|2 seconds/);
  await act(async () => { now = 11_499; for (const callback of callbacks.values()) callback(); });
  assert.match(h.view.container.textContent, /1s|1 seconds/); assert.deepEqual(h.calls, []);
  await act(async () => { now = 11_500; for (const callback of callbacks.values()) callback(); });
  assert.match(h.view.container.textContent, /0s|0 seconds/); assert.deepEqual(h.calls, []);
  await h.renderCard({ request: { ...request, expiresAt: undefined } }); assert.equal(callbacks.size, 0);
  await h.view.unmount(); assert.equal(callbacks.size, 0);
});

test('the actual custom panel remains an overlay, not a blocking question form', async t => {
  const h = await packet(t), { ExtensionCustomPanel } = await h.load('./ExtensionCustomPanel.tsx');
  const request = { type: 'extension_ui_request', id: 'custom', method: 'custom', lines: ['custom content'] }, sent = [];
  await h.render(createElement(ExtensionCustomPanel, { request, onInput: (...args) => sent.push(args) }));
  const overlay = h.view.container.firstElementChild, field = overlay.querySelector('textarea');
  assert.equal(overlay.style.position, 'absolute'); assert.equal(overlay.style.inset, '0');
  assert.equal(overlay.querySelector('form') === null, true);
  assert.equal(h.view.window.document.activeElement === field, true);
  await key(h.view, field, 'Enter', { isComposing: true }); assert.deepEqual(sent, []);
  await click(h.view, textButton(h.view.container, 'Close'));
  assert.equal(sent[0][0] === request, true); assert.equal(sent[0][1], '\x03');
});

for (const unrevealed of [false, true]) test(`actual minimap navigation relinquishes current-question follow (${unrevealed ? 'unrevealed' : 'rendered'} history)`, async t => {
  const h = await packet(t), { useBlockingQuestionFollow } = await h.load('./useBlockingQuestionFollow.ts');
  const { ChatMinimap } = await h.load('./ChatMinimap.tsx');
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const timers = new Map(); let next = 0;
  const nativeTimeout = globalThis.setTimeout, nativeClear = globalThis.clearTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (![50, 150, 250].includes(delay)) return nativeTimeout(callback, delay, ...args);
    const token = { id: ++next }; timers.set(token, { callback, delay }); return token;
  });
  t.mock.method(globalThis, 'clearTimeout', token => { if (!timers.delete(token)) nativeClear(token); });
  const fireMeasurement = async () => act(async () => {
    const entry = [...timers].find(([, timer]) => timer.delay === 150);
    assert.equal(Boolean(entry), true, 'actual minimap measurement is scheduled');
    timers.delete(entry[0]); entry[1].callback();
  });
  for (const [name, value] of [['clientHeight', 300], ['clientWidth', 800], ['scrollHeight', 1000]])
    Object.defineProperty(h.view.window.HTMLElement.prototype, name, { configurable: true, get: () => value });
  let reveals = 0;
  const messages = [{ role: 'user', content: 'Historical question', timestamp: 1 }];
  const noStreaming = () => null;
  function Host({ id = 'live-A', covered = false, loading = false }) {
    const scroll = useRef(null), card = useRef(null), refs = useRef([]);
    const stop = useBlockingQuestionFollow(id, loading, covered, scroll, card);
    return createElement('div', null,
      createElement('div', { ref: scroll, 'data-scroller': '' },
        createElement('div', null,
          !unrevealed && createElement('div', { ref: element => { refs.current[0] = element; } }, 'History'),
          createElement('div', { ref: card, 'data-fixture-top': '500', 'data-fixture-height': '200' },
            createElement(BlockingRequestCard, { request: ask({ id }), onRespond() {} })))),
      createElement(ChatMinimap, { messages, getStreamingMessage: noStreaming, scrollContainer: scroll, messageRefs: refs,
        onNavigate: stop, onRevealHistory: () => { stop(); reveals++; } }));
  }
  await h.render(createElement(Host, {}));
  await fireMeasurement();
  const scroller = h.view.container.querySelector('[data-scroller]');
  await h.frames.fire(h.frames.take()); assert.equal(scroller.scrollTop, 416, 'only the chat scroller is assigned');
  const node = h.view.container.querySelector('[data-minimap-node-index]'); assert.equal(Boolean(node), true);
  await h.view.dispatch(node.parentElement, new h.view.window.MouseEvent('mouseover', { bubbles: true }));
  await click(h.view, h.view.container.querySelector('[data-minimap-preview-user="0"]'));
  assert.equal(reveals, unrevealed ? 1 : 0);
  const afterNavigation = scroller.scrollTop;
  await h.resize(scroller); await h.frames.fire(h.frames.take());
  assert.equal(scroller.scrollTop, afterNavigation, 'resize must not revive follow after minimap navigation');
  await h.render(createElement(Host, { covered: true }));
  await h.render(createElement(Host, { covered: false }));
  await h.frames.fire(h.frames.take()); assert.equal(scroller.scrollTop, afterNavigation, 'same request retains relinquished follow');
  await h.render(createElement(Host, { id: 'live-B' }));
  await h.frames.fire(h.frames.take()); assert.equal(scroller.scrollTop > afterNavigation, true, 'a new request owns a fresh arrival-follow');
  await h.view.unmount();
  assert.equal(h.observers.every(observer => observer.targets.size === 0), true);
  assert.equal(timers.size, 0, 'actual minimap timeout cleanup');
});

test('arrival-follow effects gate loading/coverage, release on absence and never scroll a receipt or nested body', async t => {
  const h = await packet(t), { useBlockingQuestionFollow } = await h.load('./useBlockingQuestionFollow.ts');
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const { InteractionReceiptCard } = await h.load('./InteractionReceiptCard.tsx');
  function Host({ id, loading = false, covered = false }) {
    const scroll = useRef(null), card = useRef(null);
    useBlockingQuestionFollow(id, loading, covered, scroll, card);
    return createElement('div', { ref: scroll, 'data-scroller': '' },
      createElement('div', { ref: card, 'data-fixture-top': '500', 'data-fixture-height': '200' },
        id ? createElement(BlockingRequestCard, { request: ask({ id }), onRespond() {} })
          : createElement(InteractionReceiptCard, { receipt: { version: 1, outcome: 'cancelled', response: { cancelled: true }, request: ask() } })));
  }
  await h.render(createElement(Host, {}));
  const scroller = h.view.container.querySelector('[data-scroller]');
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 300 });
  assert.equal(h.frames.take().length, 0, 'history has no arrival-follow');
  await h.render(createElement(Host, { id: 'A', loading: true }));
  assert.equal(h.frames.take().length, 0);
  await h.render(createElement(Host, { id: 'A', covered: true }));
  assert.equal(h.frames.take().length, 0);
  await h.render(createElement(Host, { id: 'A' }));
  const body = h.view.container.querySelector('.blocking-card-body'); body.scrollTop = 91;
  await h.frames.fire(h.frames.take());
  assert.equal(scroller.scrollTop, 416); assert.equal(body.scrollTop, 91);
  assert.equal(h.view.window.document.body.scrollTop, 0);
  await h.view.dispatch(body, new h.view.window.Event('wheel', { bubbles: true }));
  await h.resize(scroller); assert.equal(h.frames.take().length, 0, 'an actual nested reader gesture ends follow');
  await h.render(createElement(Host, {}));
  assert.equal(h.observers.every(observer => observer.targets.size === 0), true, 'absence releases actual observers');
  const previous = scroller.scrollTop;
  await h.render(createElement(Host, { id: 'A' })); await h.frames.fire(h.frames.take());
  assert.equal(scroller.scrollTop > previous, true, 'absence cleared the old lifecycle, even if an ID is reused');
  await h.view.unmount(); assert.equal(h.observers.every(observer => observer.targets.size === 0), true);
});
