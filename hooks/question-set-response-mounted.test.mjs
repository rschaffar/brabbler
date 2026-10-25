import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { act } from 'react';
import { sessionFixture, command } from './agent-session-mounted.fixture.mjs';
import { policyClockFixture } from './agent-session-clock.fixture.mjs';
import { batchRequest, originalAnswers, originalMixedDraft, originalReview, footer, details, click, input, go } from '../components/question-set-interactions.fixture.mjs';

const responseCommand = command('extension_ui_response');
const responseRequests = h => h.requests.filter(responseCommand);
const draft = (h, sid, request) => h.view.window.sessionStorage.getItem(h.questionDrafts.questionDraftKey(sid, request.id));
const acknowledgement = { success: true, data: { accepted: true } };
async function ready(t) {
  const policyTime = policyClockFixture();
  const h = await sessionFixture(t, { policyTime, questionSets: true });
  await h.mountReady(h.existingOptions());
  const source = h.sources.find(source => source.readyState === 1);
  assert.ok(source);
  return { h, policyTime, source };
}
async function open(h, source, request) { await h.event(source, request); assert.equal(h.current.extensionDialog?.id, request.id); }
async function original(h, source, request) {
  await open(h, source, request); await originalMixedDraft(h.view); await originalReview(h.view);
  assert.equal(responseRequests(h).length, 0);
}
async function submit(h, label = 'Submit answers') {
  const admitted = h.nextSubmission(); await click(h.view, footer(h.view, label)); return await admitted;
}
function assertCommand(h, request, sid = h.savedId) {
  const row = responseRequests(h).at(-1);
  assert.equal(row.path, `/api/agent/${encodeURIComponent(sid)}`);
  assert.deepEqual(row.body, { type: 'extension_ui_response', id: request.id, answers: originalAnswers });
  return row;
}

test('actual dialog -> public response: original 15000ms just-before/at deadline, explicit retry, exact three answers, once-only and ACK draft clear', async t => {
  const { h, policyTime, source } = await ready(t), request = batchRequest('original-ack');
  await original(h, source, request);
  const held = h.hold(responseCommand, { stage: 'headers', abort: 'reject' });
  const attempt = await submit(h), row = await held.entered.promise;
  assertCommand(h, request); assert.ok(draft(h, h.savedId, request));
  assert.equal(footer(h.view, 'Submitting…').disabled, true);
  // Native disabled control activation must not admit a second hook command.
  await h.view.dispatch(footer(h.view, 'Submitting…'), new h.view.window.MouseEvent('click', { bubbles: true }));
  assert.equal(responseRequests(h).length, 1);
  const deadline = policyTime.deadlines.find(item => item.policy === 'question-set-acknowledgement');
  assert.equal(deadline.ms, 15000); assert.equal(row.signal === deadline.controller.signal, true);
  await act(async () => { policyTime.advance(14999); });
  assert.equal(row.signal.aborted, false); assert.equal(h.view.container.querySelector('[role=alert]'), null);
  assert.ok(draft(h, h.savedId, request));
  await h.finishSubmission(attempt, () => policyTime.advance(1));
  assert.equal(row.signal.aborted, true); assert.equal(row.signal.reason.name, 'TimeoutError');
  assert.ok(h.view.container.querySelector('[role=alert]')); assert.equal(h.current.extensionDialog.id, request.id);
  assert.ok(h.view.container.textContent.includes('A tailored release'));
  assert.ok(draft(h, h.savedId, request)); assert.equal(responseRequests(h).length, 1, 'no automatic retry');
  await go(h.view, 3, 'mobile'); assert.equal(responseRequests(h).length, 1, 'rerender/navigation never replay');
  const retry = h.hold(responseCommand, { stage: 'body' });
  const second = await submit(h, 'Retry submission'); await retry.entered.promise;
  assert.equal(responseRequests(h).length, 2, 'two client attempts; first blocked external fetch never reaches native dispatch');
  assertCommand(h, request); assert.ok(draft(h, h.savedId, request), 'not cleared by fetch headers or body admission');
  await h.finishSubmission(second, () => retry.resolve(acknowledgement));
  await h.settleMaintenance();
  assert.equal(h.current.extensionDialog, null); assert.equal(draft(h, h.savedId, request), null);
  assert.equal(h.view.container.querySelector('[data-question-set]'), null);
  assert.equal(responseRequests(h).length, 2, 'one successful controlled ACK, not proof of native exactly-once acceptance');
  h.assertNoFailures();
});

test('HTTP body error keeps actual review/draft until explicit retry; accepted:false ACK closes without a client replay', async t => {
  const { h, source } = await ready(t), request = batchRequest('body-error'); await original(h, source, request);
  const failed = h.hold(responseCommand, { stage: 'body', status: 503 });
  const first = await submit(h); await failed.entered.promise;
  await h.finishSubmission(first, () => failed.resolve({ error: 'Controlled service unavailable' }));
  assert.ok(h.view.container.querySelector('[role=alert]')); assert.ok(draft(h, h.savedId, request));
  assert.equal(responseRequests(h).length, 1);
  const retry = h.hold(responseCommand, { stage: 'body' }), second = await submit(h, 'Retry submission');
  await retry.entered.promise;
  await h.finishSubmission(second, () => retry.resolve({ success: true, data: { accepted: false } }));
  await h.settleMaintenance();
  assert.equal(h.current.extensionDialog, null); assert.equal(draft(h, h.savedId, request), null);
  assert.equal(h.current.notices.length > 0, true); assert.equal(responseRequests(h).length, 2);
});

test('ignored-abort body at the original deadline: signal alone does not change existing JSON/ACK semantics', async t => {
  const { h, policyTime, source } = await ready(t), request = batchRequest('late-body'); await original(h, source, request);
  const held = h.hold(responseCommand, { stage: 'body', abort: 'ignore' });
  const operation = await submit(h), row = await held.entered.promise;
  await act(async () => { policyTime.advance(14999); }); assert.equal(row.signal.aborted, false);
  await act(async () => { policyTime.advance(1); }); assert.equal(row.signal.aborted, true);
  // Characterization, not a new post-abort admission fence: sendAgentCommand
  // awaits actual json and does not race abort against an abort-ignoring body.
  assert.equal(h.view.container.querySelector('[role=alert]'), null);
  assert.equal(footer(h.view, 'Submitting…').disabled, true); assert.ok(draft(h, h.savedId, request));
  assert.equal(responseRequests(h).length, 1);
  await h.finishSubmission(operation, () => held.resolve(acknowledgement)); await h.settleMaintenance();
  assert.equal(h.current.extensionDialog, null); assert.equal(draft(h, h.savedId, request), null);
  assert.equal(responseRequests(h).length, 1);
});

test('old request ACK/catch/finally cannot close or clear a replacement request on the same session', async t => {
  const { h, source } = await ready(t), old = batchRequest('request-old'), current = batchRequest('request-current');
  await original(h, source, old);
  const held = h.hold(responseCommand, { stage: 'body' }), operation = await submit(h); await held.entered.promise;
  await open(h, source, current); await input(h.view, details(h.view), 'Only current request');
  await h.finishSubmission(operation, () => held.resolve(acknowledgement)); await h.settleMaintenance();
  assert.equal(h.current.extensionDialog?.id, current.id, 'ACK for old request retains the current request ID');
  assert.equal(details(h.view).value, 'Only current request');
  assert.equal(draft(h, h.savedId, old), null); assert.ok(draft(h, h.savedId, current));
  assert.equal(responseRequests(h).length, 1); assertCommand(h, old);
});

test('late ACK across keyed session switch keeps current session/request and clears only captured old-session draft', async t => {
  const { h, source } = await ready(t), old = batchRequest('session-old'), current = batchRequest('session-current');
  await original(h, source, old);
  const held = h.hold(responseCommand, { stage: 'body' }), operation = await submit(h); await held.entered.promise;
  const nextSid = `${h.savedId}-other`; h.declareSession(nextSid);
  const outgoingMaintenance = h.maintenanceHandle;
  // Session identity is mount-owned in the real hook. Use the existing keyed
  // admission bridge: actual connected delivery, then full named mount work.
  // Neither join releases or waits for the independently held old response.
  await h.mountReady(h.existingOptions(nextSid));
  await h.settleMaintenance(outgoingMaintenance);
  assert.notEqual(h.maintenanceHandle, outgoingMaintenance, 'selected session owns a new hook incarnation');
  const active = h.sources.filter(item => item.readyState === 1);
  assert.equal(active.length, 1, 'exactly one accepted selected-session connection');
  const [nextSource] = active;
  assert.equal(nextSource.url, `/api/agent/${encodeURIComponent(nextSid)}/events`);
  assert.equal(source.readyState, 2, 'outgoing session connection is closed');
  assert.equal(h.current.sessionIdRef.current, nextSid);
  assert.equal(h.current.data.sessionId, nextSid, 'real view has accepted the new session snapshot');
  await open(h, nextSource, current);
  await input(h.view, details(h.view), 'Only current session');
  assert.ok(draft(h, h.savedId, old), 'old draft remains until its held ACK');
  await h.finishSubmission(operation, () => held.resolve(acknowledgement)); await h.settleMaintenance();
  assert.equal(h.current.sessionIdRef.current, nextSid); assert.equal(h.current.data.sessionId, nextSid);
  assert.equal(h.current.extensionDialog.id, current.id); assert.equal(details(h.view).value, 'Only current session');
  assert.ok(draft(h, nextSid, current)); assert.equal(draft(h, h.savedId, old), null);
  assert.equal(responseRequests(h).length, 1); assertCommand(h, old, h.savedId);
});

test('admitted ignored-abort body and real dialog send finally remain joined after React unmount', async t => {
  const { h, policyTime, source } = await ready(t), request = batchRequest('unmount-body'); await original(h, source, request);
  const held = h.hold(responseCommand, { stage: 'body' }), operation = await submit(h); const row = await held.entered.promise;
  const oldMaintenance = h.maintenanceHandle;
  await h.unmount();
  await act(async () => { policyTime.advance(15000); }); assert.equal(row.signal.aborted, true);
  await h.finishSubmission(operation, () => held.resolve(acknowledgement));
  await h.settleMaintenance(oldMaintenance);
  assert.equal(draft(h, h.savedId, request), null); assert.equal(responseRequests(h).length, 1);
  assert.equal(h.sources.every(item => item.readyState === 2), true); h.assertNoFailures();
});

test('dirty invalid set cancellation uses the actual public hook and sends only current request cancelled:true after Keep editing', async t => {
  const { h, source } = await ready(t), request = batchRequest('cancel-current');
  await open(h, source, request); await input(h.view, details(h.view), 'Details alone are not a main answer');
  await click(h.view, footer(h.view, 'Next')); await click(h.view, footer(h.view, 'Next'));
  await click(h.view, footer(h.view, 'Review answers')); assert.equal(footer(h.view, 'Submit answers').disabled, true);
  await click(h.view, footer(h.view, 'Cancel')); await click(h.view, footer(h.view, 'Keep editing'));
  assert.equal(responseRequests(h).length, 0);
  await click(h.view, footer(h.view, 'Cancel'));
  const held = h.hold(responseCommand, { stage: 'body' });
  const operation = await submit(h, 'Cancel question set'); const row = await held.entered.promise;
  assert.equal(row.path, `/api/agent/${encodeURIComponent(h.savedId)}`);
  assert.deepEqual(row.body, { type: 'extension_ui_response', id: request.id, cancelled: true });
  assert.ok(draft(h, h.savedId, request));
  await h.finishSubmission(operation, () => held.resolve(acknowledgement)); await h.settleMaintenance();
  assert.equal(h.current.extensionDialog, null); assert.equal(draft(h, h.savedId, request), null);
  assert.equal(responseRequests(h).length, 1);
});
