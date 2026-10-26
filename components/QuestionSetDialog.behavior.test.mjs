import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { packet } from './cards-git.fixture.mjs';
import { createTaskOwner } from '../lib/testing/async.fixture.mjs';
import { batchRequest, originalAnswers, originalMixedDraft, originalReview, footer, details, main, choice, checked, click, input, key } from './question-set-interactions.fixture.mjs';

async function dialog(t) {
  const h = await packet(t), { QuestionSetDialog } = await h.load('./QuestionSetDialog.tsx');
  const { QuestionSetReview } = await h.load('./QuestionSetReview.tsx');
  const owner = createTaskOwner(), works = [], calls = [];
  h.addDomainJoin(() => owner.join());
  let props;
  const render = async next => {
    props = { ...props, ...next };
    await h.render(createElement(QuestionSetDialog, { ...props, key: props.request.id,
      onSubmissionWork(work) { works.push(owner.track('complete real dialog send/catch/finally', work)); } }));
  };
  const finish = async () => act(async () => { await Promise.all(works); });
  return { ...h, QuestionSetReview, calls, works, finish, renderDialog: render,
    async fresh(request = batchRequest(), sessionId = 'batch-session') {
      await h.render(null);
      await render({ request, sessionId, onRespond: async (...args) => { calls.push(args); } });
    } };
}

for (const branch of ['desktop', 'mobile']) test(`original scope/platforms/notes mixed draft, same-tab remount and actual review (${branch} control)`, async t => {
  const h = await dialog(t), request = batchRequest(`original-${branch}`);
  await h.fresh(request);
  await originalMixedDraft(h.view); assert.equal(h.calls.length, 0);
  const storageBefore = [...Object.keys(h.view.window.sessionStorage)];
  assert.equal(storageBefore.some(key => key.endsWith(request.id)), true);
  // A real React remount retaining this realm's actual sessionStorage, not a
  // claim of installed page reload/SSE replay (that browser bridge remains).
  await h.render(null); await h.renderDialog({});
  await originalReview(h.view, branch); assert.equal(h.calls.length, 0);
  await click(h.view, footer(h.view, 'Submit answers')); await h.finish();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0][0] === request, true);
  assert.deepEqual(h.calls[0][1], { answers: originalAnswers });
  assert.equal(Object.keys(h.view.window.sessionStorage).some(key => key.endsWith(request.id)), false);
  await h.render(createElement(h.QuestionSetReview, { set: request, answers: originalAnswers, showOptions: true }));
  assert.equal(h.view.container.querySelector('button,input,textarea,select'), null, 'read-only actual review has no response/edit controls');
  assert.ok(h.view.container.textContent.includes('And keep it reversible'));
  assert.ok(h.view.container.textContent.includes('Test both sizes'));
  assert.equal(h.calls.length, 1);
});

test('finite actual choice matrix: small/large × desktop/mobile/both/none × text/skipped notes', async t => {
  const h = await dialog(t);
  let row = 0;
  for (const scope of ['small', 'large']) for (const platforms of [['desktop'], ['mobile'], ['desktop', 'mobile'], ['none']]) for (const skipped of [false, true]) {
    const request = batchRequest(`finite-${++row}`); await h.fresh(request);
    assert.deepEqual(checked(h.view), []);
    await click(h.view, choice(h.view, scope === 'small' ? 'Small' : 'Large'));
    await input(h.view, details(h.view), 'Scope detail');
    await click(h.view, footer(h.view, 'Next'));
    for (const platform of [...platforms].reverse()) await click(h.view, choice(h.view, { desktop: 'Desktop', mobile: 'Mobile', none: 'None' }[platform]));
    await click(h.view, footer(h.view, 'Next'));
    await input(h.view, main(h.view), 'A temporary constraint'); await input(h.view, details(h.view), 'Separate text details');
    if (skipped) await click(h.view, choice(h.view, 'Skip this question'));
    await click(h.view, footer(h.view, 'Review answers'));
    await click(h.view, footer(h.view, 'Submit answers')); await h.finish();
    assert.equal(h.calls.length, row);
    assert.equal(h.calls.at(-1)[0] === request, true);
    assert.deepEqual(h.calls.at(-1)[1], { answers: [
      { id: 'scope', kind: 'selection', selections: [scope], comment: 'Scope detail' },
      { id: 'platforms', kind: 'selection', selections: platforms },
      skipped ? { id: 'notes', kind: 'skipped' } : { id: 'notes', kind: 'freeform', text: 'A temporary constraint', comment: 'Separate text details' },
    ] });
  }
  assert.equal(row, 16);
});

test('details-only invalid, Back/review/Edit, dirty Cancel/Keep editing/Cancel set use current callback and request', async t => {
  const h = await dialog(t), request = batchRequest('invalid-original'); await h.fresh(request);
  await input(h.view, details(h.view), 'Details alone are not a main answer');
  await click(h.view, footer(h.view, 'Next')); await click(h.view, footer(h.view, 'Next'));
  await click(h.view, footer(h.view, 'Review answers'));
  assert.equal(footer(h.view, 'Submit answers').disabled, true); assert.equal(h.calls.length, 0);
  await click(h.view, footer(h.view, 'Cancel')); await click(h.view, footer(h.view, 'Keep editing'));
  await click(h.view, h.view.container.querySelector('[aria-label="Edit Scope"]'));
  assert.equal(details(h.view).value, 'Details alone are not a main answer');
  const current = [], updated = { ...request, title: 'Current same-ID presentation' };
  await h.renderDialog({ request: updated, onRespond: async (...args) => { current.push(args); } });
  await click(h.view, footer(h.view, 'Cancel'));
  await key(h.view, details(h.view), 'Escape');
  assert.equal(h.view.container.textContent.includes('Cancel question set'), false, 'Escape dismisses confirmation, never the set');
  assert.equal(current.length, 0);
  await click(h.view, footer(h.view, 'Cancel')); await click(h.view, footer(h.view, 'Cancel question set')); await h.finish();
  assert.equal(h.calls.length, 0); assert.equal(current.length, 1);
  assert.equal(current[0][0] === updated, true); assert.deepEqual(current[0][1], { cancelled: true });
  assert.equal(Object.keys(h.view.window.sessionStorage).some(key => key.endsWith(request.id)), false);
});

test('request replacement resets local state and session-scoped draft storage never borrows another session on remount', async t => {
  const h = await dialog(t), a = batchRequest('identity-A'); await h.fresh(a, 'session-A');
  await input(h.view, details(h.view), 'Only session A');
  await h.renderDialog({ request: batchRequest('identity-B') }); assert.equal(details(h.view).value, '');
  await h.fresh(a, 'session-B'); assert.equal(details(h.view).value, '');
  await h.fresh(a, 'session-A'); assert.equal(details(h.view).value, 'Only session A');
  assert.equal(h.calls.length, 0);
});
