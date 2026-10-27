import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { createHash } from 'node:crypto';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { deferred } from '../lib/testing/async.fixture.mjs';
const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const { NotebookReviewPanel } = await jiti.import('./NotebookReviewPanel.tsx');
const { GuidedReviewReader } = await jiti.import('./GuidedReviewReader.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
const { freshReviewDraft } = await jiti.import('../lib/notebook-review-drafts.ts');
const { reduceReview, validateReply } = await jiti.import('../lib/notebook-review.ts');
const hash = 'a'.repeat(64), nextHash = 'b'.repeat(64);
const question = { id: 'constructor', shortLabel: 'Inspect', question: 'What do you think?', type: 'single', options: [{ id: 'yes', title: 'Yes' }, { id: 'none', title: 'None', exclusive: true }], required: true, explanation: 'Author reasoning, not grading', context: '![No automatic image](https://example.invalid/no-auto.png)\n\n```python\nprint("author context")\n```\n\n```brabbler-review\n{"version":99}\n```' };
const step = { id: 'toString', title: 'Current step', markdown: 'Prose', targets: [], questions: [question] };
const material = { stepId: step.id, title: step.title, chapterPath: 'one.md', prose: 'Prose', guidanceFingerprint: 'c'.repeat(64), fingerprint: hash, targets: [], questions: [{ definition: question, fingerprint: hash }], unavailable: [] };
function button(v, text) { const b = [...v.container.querySelectorAll('button')].find(b => b.textContent === text); assert.equal(!!b, true, text); return b; }
async function click(v, text) { const b = button(v, text); assert.equal(b.disabled, false, text); await v.dispatch(b, new v.window.MouseEvent('click', { bubbles: true })); }
async function select(v, text, value) { const s = [...v.container.querySelectorAll('label')].find(l => l.textContent.startsWith(text))?.querySelector('select'); assert.equal(!!s, true, text); s.value = value; await v.dispatch(s, new v.window.Event('change', { bubbles: true })); }
async function field(v, text, value) { const input = [...v.container.querySelectorAll('label')].find(l => l.textContent.startsWith(text))?.querySelector('textarea'); assert.equal(!!input, true, text); const setter = Object.getOwnPropertyDescriptor(v.window.HTMLTextAreaElement.prototype, 'value').set; setter.call(input, value); await v.dispatch(input, new v.window.Event('input', { bubbles: true })); }
function runtime(t) {
  const failures = [], work = [], native = [], restore = [], requests = [], assetReads = [], seeded = []; let remountKey = 0; let asset = { content: 'Snapshot A', contentDigest: '1'.repeat(64) }, holdAssets = false; let view, closed = false, hold = null, conflict = false, currentMaterial = material;
  let tip = { sequence: 0, digest: '', notebookId: 'book', directory: '/book/review-data', state: { events: [] } };
  const replace = (object, name, value) => { const d = Object.getOwnPropertyDescriptor(object, name); Object.defineProperty(object, name, { configurable: true, writable: true, value }); restore.push(() => d ? Object.defineProperty(object, name, d) : delete object[name]); };
  const deny = name => () => { const e = new Error(`Unexpected ${name}`); failures.push(e); throw e; };
  const observe = p => { work.push(p); p.catch(e => failures.push(e)); };
  const fetch = async (url, init = {}) => {
    const operation = (async () => {
      assert.equal(closed, false); assert.equal(init.cache, 'no-store');
      const address = new URL(String(url), 'https://fixture.invalid');
      assert.equal(address.origin, 'https://fixture.invalid'); assert.equal(address.searchParams.get('index'), '/book/index.md');
      if (address.pathname === '/api/review-notebook') {
        assert.equal(init.method ?? 'GET', 'GET'); assert.ok(init.signal);
        if (!address.searchParams.has('asset')) return { ok: true, json: async () => ({ index: { version: 1, id: 'book', title: 'Notebook', chapters: [{ id: 'one', title: 'One', path: 'one.md' }] }, chapters: [{ id: 'one', title: 'One', path: 'one.md', steps: [{ ...step, questions: currentMaterial.questions.map(q => q.definition), targets: currentMaterial.targets.map(t => t.definition) }] }] }) };
        assert.equal(address.searchParams.get('asset'), 'asset.txt');
        const ticket = { value: structuredClone(asset), release: deferred(), signal: init.signal }; assetReads.push(ticket); gates.push(ticket);
        if (!holdAssets) ticket.release.resolve();
        return { ok: true, json: async () => { await ticket.release.promise; return ticket.value; } };
      }
      assert.equal(String(url), '/api/review-data?index=%2Fbook%2Findex.md');
      const body = init.body ? JSON.parse(init.body) : null; requests.push(body ?? { action: 'GET' });
      let value;
      if (!body) { assert.equal(init.method, 'GET'); value = structuredClone(tip); }
      else {
        assert.equal(init.method, 'POST'); assert.equal(init.headers['Content-Type'], 'application/json');
        if (body.action === 'inspect') { assert.equal(body.stepId, currentMaterial.stepId); value = structuredClone(currentMaterial); }
        else {
          assert.equal(['append', 'import'].includes(body.action), true); assert.deepEqual(body.expected, { sequence: tip.sequence, digest: tip.digest });
          if (conflict) { conflict = false; return { ok: false, status: 409, json: async () => ({ error: 'peer changed history' }) }; }
          const op = body.action === 'import' ? { kind: 'import', batchId: body.batchId, digest: createHash('sha256').update(body.text).digest('hex'), reply: validateReply(JSON.parse(body.text)) } : body.operation;
          tip = { ...tip, state: reduceReview(tip.state, op, body.submissionId, ['answer', 'mark', 'feedback'].includes(op.kind) ? currentMaterial : null), sequence: tip.sequence + 1, digest: nextHash };
          value = structuredClone(tip);
        }
      }
      const gate = hold && (hold.action === (body?.action ?? 'GET')) ? hold : null;
      if (gate) { hold = null; gate.entered.resolve(); }
      return { ok: true, status: 200, json: async () => { if (gate) await gate.release.promise; return value; } };
    })();
    native.push(operation); operation.catch(e => failures.push(e)); return operation;
  };
  replace(globalThis, 'fetch', fetch);
  for (const name of ['WebSocket', 'XMLHttpRequest', 'EventSource']) replace(globalThis, name, deny(name));
  const oldConsole = console.error; replace(console, 'error', (...args) => { failures.push(new Error(args.map(String).join(' '))); oldConsole(...args); });
  const gates = [];
  t.after(async () => {
    closed = true; for (const g of gates) g.release.resolve();
    try { await view?.unmount(); } catch (e) { failures.push(e); }
    let joined = 0; while (joined < work.length) { const peers = work.slice(joined); joined = work.length; await Promise.allSettled(peers); }
    await Promise.allSettled(native);
    try { await view?.dispose(); } catch (e) { failures.push(e); }
    for (const r of restore.toReversed()) r();
    if (failures.length) throw new AggregateError(failures, 'Review panel fixture failures');
  });
  return {
    requests, onWork: observe, assetReads,
    seed(key, raw) { seeded.push([key, raw]); },
    async remount(props) { await view.rerender(createElement(I18nProvider, null, createElement(NotebookReviewPanel, { draftOwner: 'primary', ...props, key: `new-${++remountKey}` }))); },
    asset(value, hold = false) { asset = value; holdAssets = hold; },
    hold(action) { const gate = { action, entered: deferred(), release: deferred() }; gates.push(gate); hold = gate; return gate; },
    conflict() { conflict = true; }, material(m) { currentMaterial = m; }, tip: () => tip,
    async mount(props, reader = false) { const owners = Array.isArray(props) ? props : [props]; view = await mount(t, createElement(I18nProvider, null, ...owners.map((p, i) => createElement(reader ? GuidedReviewReader : NotebookReviewPanel, { draftOwner: 'primary', ...p, key: i }))), { setup(window) {
      replace(globalThis, 'localStorage', window.localStorage);
      for (const [key, raw] of seeded) window.localStorage.setItem(key, raw);
      for (const name of ['WebSocket', 'XMLHttpRequest', 'EventSource']) replace(window, name, deny(name));
      replace(window, 'fetch', fetch);
      replace(window, 'matchMedia', query => ({ media: query, matches: false, addEventListener() {}, removeEventListener() {} }));
      const fail = event => failures.push(event.error ?? event.reason ?? new Error(event.message));
      window.addEventListener('error', fail); window.addEventListener('unhandledrejection', fail);
      restore.push(() => { window.removeEventListener('error', fail); window.removeEventListener('unhandledrejection', fail); });
    } }); return view; },
    async joinLatest() { await act(async () => { await work.at(-1); }); },
    async join() { await act(async () => { let joined = 0; while (joined < work.length) { const peers = work.slice(joined); joined = work.length; await Promise.allSettled(peers); } }); },
    healthy() { assert.equal(failures.length, 0, failures[0]?.message); },
  };
}
test('actual mounted explicit activation, required gate, shared choices, frozen preview, destination rejection and reviewer-only resolution', async t => {
  const r = runtime(t), drafted = [], props = { indexPath: '/book/index.md', step, selection: null, destination: { id: 'A', label: 'Existing A' }, onDraftBatch(expected, text) { assert.equal(expected.id, 'A'); drafted.push(text); }, onResume() {}, onWork: r.onWork };
  const v = await r.mount(props);
  assert.equal(r.requests.length, 0, 'reader panel mounting creates/reads nothing');
  await click(v, 'Enable review recording'); await r.join();
  assert.equal(r.tip().state.events[0].operation.kind, 'enable');
  assert.equal(button(v, 'Reviewed').disabled, true);
  assert.equal(v.container.querySelector('.notebook-review-panel img, .notebook-review-panel [data-review-stop]') === null, true, 'authored context inherits restricted notebook rendering');
  assert.match(v.container.textContent, /author context/);
  await select(v, 'Recorded outcome', 'skip'); await click(v, 'Record outcome'); await r.join();
  assert.equal(r.tip().state.events.find(e => e.operation.kind === 'answer').operation.outcome.kind, 'skip');
  assert.equal(button(v, 'Reviewed').disabled, false);
  await click(v, 'Reviewed'); await r.join();
  assert.match(v.container.textContent, /Step state: Reviewed/);
  await click(v, 'Capture current anchor'); await field(v, 'Feedback text', 'Inspect this concern'); await click(v, 'Save feedback'); await r.join();
  const checkbox = [...v.container.querySelectorAll('input[type=checkbox]')].find(n => n.parentElement.textContent.startsWith('Select finding'));
  await v.dispatch(checkbox, new v.window.MouseEvent('click', { bubbles: true }));
  assert.equal(drafted.length, 0, 'selection never sends');
  await click(v, 'Prepare in chat'); await r.join();
  assert.equal(drafted.length, 0, 'prepare freezes only');
  assert.match(v.container.querySelector('[aria-label="Frozen batch preview"]').textContent, /Inspect this concern/);
  await click(v, 'Add batch to chat draft'); await r.join();
  assert.equal(drafted.length, 1); assert.match(drafted[0], /constructor/);
  assert.equal(r.tip().state.events.at(-1).operation.kind, 'drafted');
  await click(v, 'Resolve (reviewer only)'); await r.join();
  assert.match(v.container.textContent, /Resolved/);
  r.healthy();
});
test('actual mounted write body held across newer edits, conflict recovery and ignored obsolete inspection cannot replace current state', async t => {
  const r = runtime(t), props = { indexPath: '/book/index.md', step, selection: null, onResume() {}, onWork: r.onWork };
  const v = await r.mount(props); await click(v, 'Enable review recording'); await r.join();
  await click(v, 'Capture current anchor'); await field(v, 'Feedback text', 'Original draft');
  const gate = r.hold('append'); await click(v, 'Save feedback'); await gate.entered.promise;
  await field(v, 'Feedback text', 'Newer text while saving');
  await act(async () => gate.release.resolve()); await r.join();
  // A completed save must not clear text typed after its request was admitted.
  const text = [...v.container.querySelectorAll('label')].find(l => l.textContent.startsWith('Feedback text')).querySelector('textarea');
  assert.equal(text.value, 'Newer text while saving');
  await click(v, 'Capture current anchor'); r.conflict(); await click(v, 'Save feedback'); await r.join();
  assert.match(v.container.textContent, /Conflict/); assert.equal(text.value, 'Newer text while saving');
  assert.match(v.window.localStorage.getItem('brabbler-notebook-review-draft-v2:%2Fbook%2Findex.md:primary'), /Newer text while saving/);
  await click(v, 'Load saved review record'); await r.join();
  assert.match(v.container.textContent, /Unsaved operation retained/);
  const old = r.hold('inspect'); await click(v, 'Refresh current step identities'); await old.entered.promise;
  r.material({ ...material, fingerprint: nextHash });
  await click(v, 'Refresh current step identities'); await r.joinLatest();
  await act(async () => old.release.resolve()); await r.join();
  assert.match(v.container.textContent, new RegExp(nextHash));
  assert.equal(v.container.querySelector('.notebook-review-panel > p code')?.textContent === hash, false);
  r.healthy();
});
for (const order of ['asset-first', 'inspect-first']) test(`actual guided reader binds displayed mutable bytes, ${order}, refusing Reviewed until an explicit snapshot reload`, async t => {
  const r = runtime(t), target = { version: 1, kind: 'file', id: 'asset', title: 'Working snapshot', path: 'asset.txt' };
  const a = { ...material, questions: [], targets: [{ definition: target, fingerprint: hash, contentDigest: '1'.repeat(64) }] };
  const b = { ...a, fingerprint: nextHash, targets: [{ definition: target, fingerprint: nextHash, contentDigest: '2'.repeat(64) }] };
  r.material(a); r.asset({ content: 'Snapshot A', contentDigest: '1'.repeat(64) }, order === 'inspect-first');
  const v = await r.mount({ indexPath: '/book/index.md', reviewDraftOwner: 'primary', onClose() {}, onWork: r.onWork }, true);
  assert.equal(r.assetReads.length > 0, true, 'real FileEvidence body admitted');
  if (order === 'inspect-first') r.material(b);
  await click(v, 'Enable review recording'); await r.joinLatest();
  const selectDisplayedA = async () => {
    const code = v.container.querySelector('.guided-file-evidence code'); assert.equal(!!code, true, 'actual text renderer is mounted');
    const range = v.window.document.createRange(); range.selectNodeContents(code);
    const selection = v.window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    await v.dispatch(code, new v.window.MouseEvent('mouseup', { bubbles: true }));
    assert.match(v.container.querySelector('[aria-label="New feedback"]').textContent, /selected text\/lines/);
  };
  if (order === 'asset-first') {
    await r.join(); assert.equal(button(v, 'Reviewed').disabled, false, 'matching displayed A and inspected A can be recorded');
    await selectDisplayedA(); await click(v, 'Capture current anchor');
    assert.match(JSON.parse(v.container.querySelector('[aria-label="New feedback"] pre').textContent).selection.quote, /Snapshot A/);
    r.material(b); await click(v, 'Refresh current step identities'); await r.join();
  } else {
    await act(async () => { for (const read of r.assetReads) read.release.resolve(); }); await r.join();
    await selectDisplayedA();
  }
  assert.match(v.container.querySelector('.guided-file-evidence').textContent, /Snapshot A/);
  assert.equal(button(v, 'Reviewed').disabled, true, 'displayed A must not be recorded against inspected B');
  assert.match(v.container.textContent, /Displayed mutable evidence does not match/);
  assert.equal(r.requests.some(q => q.operation?.kind === 'mark'), false);
  r.asset({ content: 'Snapshot B', contentDigest: '2'.repeat(64) });
  await click(v, 'Reload displayed evidence'); await r.join();
  assert.match(v.container.querySelector('.guided-file-evidence').textContent, /Snapshot B/);
  assert.equal(button(v, 'Reviewed').disabled, false);
  await click(v, 'Reviewed'); await r.join(); assert.equal(r.tip().state.events.at(-1).operation.fingerprint, nextHash);
  // No new selection is made after reload. Capture must use the target fallback,
  // never attach A's remembered quote to B's freshly inspected fingerprint.
  await click(v, 'Capture current anchor');
  const captured = JSON.parse(v.container.querySelector('[aria-label="New feedback"] pre').textContent);
  assert.equal(captured.fingerprint, nextHash); assert.equal(captured.targetFingerprint, nextHash);
  assert.equal(Object.hasOwn(captured, 'selection'), false, 'old snapshot selection is cleared on displayed generation/byte change');
  await field(v, 'Feedback text', 'Concern on reloaded B target'); await click(v, 'Save feedback'); await r.join();
  const saved = r.tip().state.events.at(-1).operation.item;
  assert.equal(saved.anchor.fingerprint, nextHash); assert.equal(Object.hasOwn(saved.anchor, 'selection'), false, 'no B-bound feedback can inherit A selection without a fresh capture');
  r.healthy();
});
for (const [name, raw] of [['nested-null', JSON.stringify({ ...freshReviewDraft(), questions: [null] })], ['malformed-json', '{broken'], ['oversized', 'x'.repeat(2 * 1024 * 1024 + 1)]]) test(`malformed browser recovery ${name} is preserved and never mounted or overwritten`, async t => {
  const r = runtime(t), key = 'brabbler-notebook-review-draft-v2:%2Fbook%2Findex.md:primary'; r.seed(key, raw);
  const props = { indexPath: '/book/index.md', step, selection: null, onResume() {}, onWork: r.onWork };
  const v = await r.mount(props);
  assert.equal(v.window.localStorage.getItem(key), raw); assert.match(v.container.textContent, /recovery record preserved/);
  await click(v, 'Enable review recording'); await r.join(); await field(v, 'Feedback text', 'New in-memory draft');
  assert.equal(v.window.localStorage.getItem(key), raw, 'typing cannot overwrite rejected recovery bytes');
  assert.match([...v.container.querySelectorAll('textarea')].find(n => n.readOnly && n.value.includes('New in-memory draft')).value, /New in-memory draft/);
  await click(v, 'Discard malformed browser recovery only (keeps current fields)');
  const keptRaw = v.window.localStorage.getItem(key);
  assert.equal(keptRaw ? JSON.parse(keptRaw).text : null, 'New in-memory draft', 'discard persists current validated fields before clearing recovery warning');
  await r.remount(props); await click(v, 'Load saved review record'); await r.join();
  assert.equal([...v.container.querySelectorAll('label')].find(l => l.textContent.startsWith('Feedback text')).querySelector('textarea').value, 'New in-memory draft', 'immediate reload with no intervening edit recovers kept fields');
  await field(v, 'Feedback text', 'Explicitly recovered local draft');
  assert.match(v.window.localStorage.getItem(key), /Explicitly recovered local draft/); r.healthy();
});
test('two mounted same-guide panes own distinct recovery keys and native radio groups, with explicit copy recovery', async t => {
  const r = runtime(t), prefix = 'brabbler-notebook-review-draft-v2:%2Fbook%2Findex.md:';
  r.seed(prefix + 'alpha', JSON.stringify({ ...freshReviewDraft(), text: 'Alpha recovery' }));
  r.seed(prefix + 'beta', JSON.stringify({ ...freshReviewDraft(), text: 'Beta recovery' }));
  const props = { indexPath: '/book/index.md', step, selection: null, onResume() {}, onWork: r.onWork };
  const v = await r.mount([{ ...props, draftOwner: 'alpha' }, { ...props, draftOwner: 'beta' }]);
  const panels = v.container.querySelectorAll('.notebook-review-panel'), a = { container: panels[0], window: v.window, dispatch: v.dispatch }, b = { ...a, container: panels[1] };
  await click(a, 'Enable review recording'); await r.join(); await click(b, 'Enable review recording'); await r.join();
  const ar = panels[0].querySelectorAll('input[type=radio]'), br = panels[1].querySelectorAll('input[type=radio]');
  assert.notEqual(ar[0].name, br[0].name);
  await v.dispatch(br[0], new v.window.MouseEvent('click', { bubbles: true }));
  await v.dispatch(ar[1], new v.window.MouseEvent('click', { bubbles: true }));
  assert.equal(br[0].checked, true, 'the other pane is not a document-wide shared radio group');
  await field(a, 'Feedback text', 'Alpha independent edit'); await field(b, 'Feedback text', 'Beta independent edit');
  assert.match(v.window.localStorage.getItem(prefix + 'alpha'), /Alpha independent edit/);
  assert.match(v.window.localStorage.getItem(prefix + 'beta'), /Beta independent edit/);
  await click(a, 'List other recovery records'); await select(a, 'Recovery record', prefix + 'beta');
  await click(a, 'Copy selected recovery here (replaces these local fields; original retained)');
  assert.match(v.window.localStorage.getItem(prefix + 'beta'), /Beta independent edit/, 'copy never changes source pane'); r.healthy();
});
test('classification edits made while a feedback save body is held survive its acknowledgement', async t => {
  const r = runtime(t), v = await r.mount({ indexPath: '/book/index.md', step, selection: null, onResume() {}, onWork: r.onWork });
  await click(v, 'Enable review recording'); await r.join(); await click(v, 'Capture current anchor'); await field(v, 'Feedback text', 'Same text');
  const gate = r.hold('append'); await click(v, 'Save feedback'); await gate.entered.promise;
  await select(v, 'Feedback kind', 'guide-issue');
  await act(async () => gate.release.resolve()); await r.join();
  const text = [...v.container.querySelectorAll('label')].find(l => l.textContent.startsWith('Feedback text')).querySelector('textarea');
  assert.equal(text.value, 'Same text');
  assert.equal([...v.container.querySelectorAll('label')].find(l => l.textContent.startsWith('Feedback kind')).querySelector('select').value, 'guide-issue');
  assert.equal(r.tip().state.events.find(e => e.operation.kind === 'feedback').operation.item.kind, 'finding'); r.healthy();
});
test('Unavailable evidence permits plain step guidance concerns, explicit unsure and Needs attention but never Reviewed', async t => {
  const r = runtime(t), target = { version: 1, kind: 'web', id: 'missing', title: 'Unavailable target', url: 'https://example.invalid/missing' };
  const missing = { ...material, fingerprint: null, targets: [{ definition: target, fingerprint: null }], unavailable: ['Immutable object/authority Unavailable'], questions: [{ definition: question, fingerprint: nextHash }] }; r.material(missing);
  const v = await r.mount({ indexPath: '/book/index.md', step: { ...step, targets: [target] }, selection: { target }, onResume() {}, onWork: r.onWork });
  await click(v, 'Enable review recording'); await r.join();
  assert.equal(button(v, 'Reviewed').disabled, true);
  await click(v, 'Needs attention'); await r.join(); await click(v, 'Anchor to this step');
  await field(v, 'Feedback text', 'Evidence is unavailable; repair this guide');
  assert.equal(button(v, 'Save feedback').disabled, true, 'guidance-only finding drafts are not saveable reviewer decisions');
  assert.match(v.window.localStorage.getItem('brabbler-notebook-review-draft-v2:%2Fbook%2Findex.md:primary'), /repair this guide/, 'incomplete classification fields still recover without storage denial');
  await select(v, 'Feedback kind', 'guide-issue');
  await click(v, 'Save feedback'); await r.join();
  const saved = r.tip().state.events.find(e => e.operation.kind === 'feedback').operation.item;
  assert.deepEqual(saved.anchor, { stepId: step.id, fingerprint: material.guidanceFingerprint, basis: 'guidance' });
  await click(v, 'Edit item'); await select(v, 'Feedback kind', 'finding');
  assert.equal(button(v, 'Save feedback').disabled, true, 'editing cannot convert guidance-only provenance to a finding');
  await field(v, 'Feedback text', 'Updated text, same unavailable provenance'); await select(v, 'Feedback kind', 'guide-issue'); await click(v, 'Save feedback'); await r.join();
  assert.equal(r.tip().state.events.at(-1).operation.item.version, 2);
  await select(v, 'Recorded outcome', 'unsure'); await click(v, 'Record outcome'); await r.join();
  assert.equal(button(v, 'Reviewed').disabled, true); assert.match(v.container.textContent, /do not claim missing bytes were inspected/); r.healthy();
});
test('per-batch pasted replies and selected preview recover across a mounted reload without leaking into another batch', async t => {
  const r = runtime(t), props = { indexPath: '/book/index.md', step, selection: null, destination: { id: 'A', label: 'Existing A' }, onDraftBatch() {}, onResume() {}, onWork: r.onWork };
  const v = await r.mount(props); await click(v, 'Enable review recording'); await r.join(); await click(v, 'Anchor to this step'); await field(v, 'Feedback text', 'Concern'); await click(v, 'Save feedback'); await r.join();
  const checkbox = v.container.querySelector('[aria-label="Cross-chapter review tray"] input[type=checkbox]'); await v.dispatch(checkbox, new v.window.MouseEvent('click', { bubbles: true }));
  await click(v, 'Prepare in chat'); await r.join(); const a = r.tip().state.events.at(-1).operation.batch;
  await field(v, 'JSON reply import fallback', 'Unimported A');
  await click(v, 'Prepare in chat'); await r.join(); const b = r.tip().state.events.at(-1).operation.batch;
  const replyField = () => [...v.container.querySelectorAll('label')].find(l => l.textContent.startsWith('JSON reply import fallback')).querySelector('textarea');
  assert.equal(replyField().value, '', 'B does not inherit A JSON'); await field(v, 'JSON reply import fallback', 'Unimported B');
  await click(v, `Preview batch ${a.id}`); assert.equal(replyField().value, 'Unimported A');
  await r.remount(props); await click(v, 'Load saved review record'); await r.join(); assert.equal(replyField().value, 'Unimported A');
  await click(v, `Preview batch ${b.id}`); assert.equal(replyField().value, 'Unimported B');
  const item = b.items[0], reply = { version: 1, batchId: b.id, items: [{ id: item.id, version: item.version, fingerprint: item.anchor.fingerprint, response: 'Investigation only', evidence: 'Pinned identity', proposedChanges: 'No fixes authorized' }] };
  await click(v, 'Enable review recording'); await r.join(); await field(v, 'JSON reply import fallback', JSON.stringify(reply)); await click(v, 'Import pasted JSON reply'); await r.join();
  assert.match(v.container.textContent, /Investigation only/); assert.equal(button(v, 'Resolve (reviewer only)').disabled, false); r.healthy();
});
