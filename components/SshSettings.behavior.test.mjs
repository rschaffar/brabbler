import "../lib/testing/client-native-boundary.fixture.mjs";
import assert from 'node:assert/strict';
import test from 'node:test';
import { sshSettingsFixture, statusView, keyView, publicCredential, genericKey, acknowledgement, syntheticAssertion } from './ssh-settings.fixture.mjs';

const routing = h => h.region('SSH agent selection');
const chooser = h => routing(h).querySelector('select[aria-label="Choose agent (draft)"]');
const recovery = h => h.region('Public credential recovery');
const noAuthority = h => {
  assert.equal(h.current.connection, null); assert.equal(h.current.reviewedId, null);
  assert.equal(h.current.requests.length, 0);
  assert.equal(h.actions().some(action => ['connect', 'activate', 'select', 'unlock', 'begin-unlock', 'finish-unlock', 'begin-request-unlock', 'finish-request-unlock', 'respond'].includes(action)), false);
};
const importProof = credential => ({ token: 'SYNTHETIC-recovery-token', challenge: 'Aw', rpId: 'fixture.invalid', credential: { id: credential.id, spki: credential.spki } });
const importBody = (credential, name, revision, existingKeyId) => ({ action: 'begin-import', name,
  credential: { id: credential.id, spki: credential.spki }, applicationOnly: true, revision,
  ...(existingKeyId ? { existingKeyId } : {}) });
const finishBody = id => ({ action: 'finish-enroll', token: 'SYNTHETIC-recovery-token', assertion: syntheticAssertion(id) });
async function open(h) { await h.setActive(true); await h.settle(); }

// No viewport simulation: actual native geometry/keyboard/touch and default
// SettingsPanel navigation remain installed-browser owners at1280/390.
test('Settings close after successful JSON parsing admits zero discover calls, including already-aborted fetch invocations', async t => {
  const h = await sshSettingsFixture(t);
  assert.equal(h.current.auth, 'ready'); assert.equal(h.actions().includes('discover'), false);
  const before = h.invocations.length;
  const changed = statusView({ revision: 'obsolete-after-close' });
  const held = h.expect('status', { action: 'status' }, changed, { hold: true });
  await h.setActive(true); await held.parsed.promise;
  assert.equal(held.request.jsonReturned, true, 'base JSON and real Response parsing finished before hold');
  assert.equal(h.current.discovering, true);
  await h.setActive(false);
  assert.equal(held.request.options.signal.aborted, true);
  assert.equal(held.request.options.signal.reason, 'settings-closed');
  await h.release(held);
  assert.equal(h.current.status.runtime.revision, 'runtime-1', 'ignored-abort parsed result not applied');
  assert.equal(h.current.discovering, false);
  assert.equal(h.invocations.slice(before).filter(item => item.body?.action === 'discover').length, 0,
    'even fetch(discover,{signal:alreadyAborted}) is an invocation and forbidden');
  assert.deepEqual(h.current.candidates, []); noAuthority(h);
  await open(h);
  assert.equal(h.actions().filter(action => action === 'discover').length, 1, 'later explicit open remains usable');
  h.assertComplete();
});

test('draft socket choice is inert; actual Use captures exact path/label with CURRENT revision, disables duplicates and preserves front socket', async t => {
  const backend = { type: 'socket', path: '/tmp/agent: literal path.sock', label: 'Socket <A>' };
  const h = await sshSettingsFixture(t, { candidates: [{ ...backend, source: 'known', available: true, fingerprints: [] }] });
  await open(h);
  const callsBefore = h.actions().length, stableSocket = h.current.status.runtime.socketPath;
  await h.select(chooser(h), `socket:${backend.path}:${backend.label}`);
  assert.equal(h.actions().length, callsBefore, 'dropdown edit alone sends nothing');
  assert.deepEqual(h.current.status.runtime.selected, { type: 'none' });
  h.setSnapshot(statusView({ revision: 'runtime-2' }));
  await h.click('Refresh agents'); await h.settle();
  assert.equal(chooser(h).value, `socket:${backend.path}:${backend.label}`, 'draft survives genuine status/discovery update');
  const selected = statusView({ revision: 'runtime-3', selected: backend });
  const held = h.expect('use', { action: 'use', revision: 'runtime-2', backend }, selected, { hold: true });
  await h.click('Use agent'); await held.parsed.promise;
  assert.equal(h.current.busy, true); assert.equal(h.button('Use agent').disabled, true); assert.equal(chooser(h).disabled, true);
  await h.click('Use agent');
  assert.equal(h.actions().filter(action => action === 'use').length, 1);
  await h.release(held);
  assert.equal(h.current.busy, false);
  assert.deepEqual(h.current.status.runtime.selected, backend);
  assert.equal(h.current.status.runtime.socketPath, stableSocket);
  // A successful complete component .then must clear the draft; a subsequent
  // actual status change is observable through the real controlled select.
  h.setSnapshot(statusView({ revision: 'runtime-4' }));
  await h.click('Refresh agents'); await h.settle();
  assert.equal(chooser(h).value, 'none');
  assert.equal(h.current.status.runtime.socketPath, stableSocket); noAuthority(h); h.assertComplete();
});

test('Use failure shows exact error, reconciles once without replay, retains draft and explicit retry uses latest runtime revision', async t => {
  const h = await sshSettingsFixture(t); await open(h);
  await h.select(chooser(h), 'browser');
  const failed = h.expect('use', { action: 'use', revision: 'runtime-1', backend: { type: 'browser' } }, { error: 'controlled selection conflict' }, { status: 409, hold: true });
  await h.click('Use agent'); await failed.parsed.promise;
  h.setSnapshot(statusView({ revision: 'reconciled-runtime' }));
  await h.release(failed);
  assert.equal(h.current.error, 'controlled selection conflict');
  assert.ok([...h.view.container.querySelectorAll('[role="alert"]')].some(item => item.textContent === 'controlled selection conflict'));
  assert.equal(h.current.busy, false); assert.equal(chooser(h).value, 'browser');
  assert.equal(h.actions().filter(action => action === 'use').length, 1, 'no automatic mutation replay');
  const success = statusView({ revision: 'after-explicit-retry', selected: { type: 'browser' } });
  h.expect('use', { action: 'use', revision: 'reconciled-runtime', backend: { type: 'browser' } }, success);
  await h.click('Use agent'); await h.settle();
  assert.equal(h.current.error, ''); assert.equal(h.current.status.runtime.selected.type, 'browser');
  assert.equal(h.actions().filter(action => action === 'use').length, 2); noAuthority(h); h.assertComplete();
});

test('passive observer replacement does not cancel/refetch discovery; later admitted complete handlers reach the current observer', async t => {
  const h = await sshSettingsFixture(t);
  const held = h.expect('status', { action: 'status' }, statusView(), { hold: true });
  await h.setActive(true); await held.parsed.promise;
  const before = h.invocations.length, observedBefore = h.observations.length;
  await h.removeObserver(); // unsupplied optional observer must not change default discovery policy
  const generation = await h.swapObserver();
  assert.equal(held.request.options.signal.aborted, false);
  assert.equal(h.invocations.length, before); assert.equal(h.observations.length, observedBefore);
  await h.release(held);
  h.expect('use', { action: 'use', revision: 'runtime-1', backend: { type: 'none' } }, statusView());
  await h.click('Use agent'); await h.settle();
  assert.equal(h.observations.length, observedBefore + 1, 'complete use .then supplied to current observer');
  assert.equal(h.observations.at(-1).generation, generation, 'not a retained obsolete observer');
  noAuthority(h); h.assertComplete();
});

test('existing recovery acknowledgement, actual remove, and NEW strict reimport preserve public identity without auto-connect or grant', async t => {
  const existing = keyView(), initial = statusView({ keys: [existing] });
  const h = await sshSettingsFixture(t, { snapshot: initial, recovery: publicCredential });
  await open(h); noAuthority(h); assert.equal(h.ceremonies.length, 0);
  const verify = h.button('Verify existing registration', recovery(h));
  assert.equal(verify.disabled, true);
  await h.click(verify); assert.equal(h.actions().includes('begin-import'), false);
  await h.click(recovery(h).querySelector('input[type="checkbox"]'));
  h.expect('begin-import', importBody(publicCredential, existing.name, 'registry-1', existing.id), importProof(publicCredential));
  const verified = statusView({ registryRevision: 'registry-2', keys: [existing] });
  const ack = h.expect('finish-enroll', finishBody(publicCredential.id), acknowledgement(existing, verified), { hold: true });
  await h.proof(publicCredential, async () => {
    await h.click('Verify existing registration', recovery(h)); await ack.parsed.promise;
    assert.equal(h.current.busy, true); noAuthority(h);
    h.setSnapshot(verified); await h.release(ack);
  });
  assert.equal(h.current.status.registry.keys.length, 1);
  assert.equal(h.current.status.registry.keys[0].id, existing.id); assert.equal(h.current.status.registry.keys[0].policy, 'session');
  assert.equal(h.view.container.querySelector('section[aria-label="Public credential recovery"]'), null);
  assert.deepEqual(JSON.parse(h.view.window.localStorage.getItem(genericKey)), publicCredential);
  await h.click('Remove');
  const removed = statusView({ registryRevision: 'registry-3' });
  h.expect('remove', { action: 'remove', keyId: existing.id, revision: 'registry-2' }, removed);
  h.setSnapshot(removed); await h.click('Remove from Brabbler'); await h.settle();
  assert.equal(h.current.status.registry.keys.length, 0);
  const row = recovery(h), name = row.querySelector('input:not([type="checkbox"])');
  assert.equal(h.button('Import with strict verification', row).disabled, true);
  await h.input(name, '  Current strict import  ');
  await h.click(row.querySelector('input[type="checkbox"]'));
  const strict = keyView({ id: 'NEW-strict-registration', name: 'Current strict import', policy: 'strict' });
  const next = statusView({ registryRevision: 'registry-4', keys: [strict] });
  h.expect('begin-import', importBody(publicCredential, 'Current strict import', 'registry-3'), importProof(publicCredential));
  h.expect('finish-enroll', finishBody(publicCredential.id), acknowledgement(strict, next));
  h.setSnapshot(next);
  await h.proof(publicCredential, () => h.click('Import with strict verification', row));
  const actual = h.current.status.registry.keys[0];
  assert.notEqual(actual.id, existing.id); assert.equal(actual.policy, 'strict');
  assert.equal(actual.publicKey, existing.publicKey); assert.equal(actual.protection, null); assert.equal(actual.applicationOnly, true);
  assert.equal(h.ceremonies.length, 2); assert.equal(h.ceremonies.every(item => item.synthetic && item.uv === 'required'), true);
  assert.equal(h.current.status.connections.length, 0); assert.equal(h.current.status.activeId, null);
  assert.deepEqual(JSON.parse(h.view.window.localStorage.getItem(genericKey)), publicCredential);
  noAuthority(h); h.assertComplete();
});

test('recovery click uses CURRENT replaced public payload and registry revision, not a retained item with the same generic storage key', async t => {
  const h = await sshSettingsFixture(t, { recovery: publicCredential }); await open(h);
  const row = recovery(h); await h.input(row.querySelector('input:not([type="checkbox"])'), 'Prior name');
  await h.click(row.querySelector('input[type="checkbox"]'));
  const replacement = { id: 'CA', spki: 'Cg', origin: publicCredential.origin };
  await h.replaceRecovery(replacement);
  h.setSnapshot(statusView({ registryRevision: 'current-registry' }));
  await h.click('Refresh agents'); await h.settle();
  await h.input(recovery(h).querySelector('input:not([type="checkbox"])'), '  Current name  ');
  const record = keyView({ id: 'CURRENT-new-key', credential: { id: replacement.id, spki: replacement.spki }, policy: 'strict', name: 'Current name' });
  const next = statusView({ registryRevision: 'current-confirmed', keys: [record] });
  h.expect('begin-import', importBody(replacement, 'Current name', 'current-registry'), importProof(replacement));
  h.expect('finish-enroll', finishBody(replacement.id), acknowledgement(record, next));
  h.setSnapshot(next);
  await h.proof(replacement, () => h.click('Import with strict verification', recovery(h)));
  assert.equal(h.ceremonies.length, 1); assert.equal(h.ceremonies[0].id, replacement.id);
  assert.deepEqual(JSON.parse(h.view.window.localStorage.getItem(genericKey)), replacement);
  noAuthority(h); h.assertComplete();
});

test('mismatched durable recovery acknowledgement stays visible and retries only on another explicit click', async t => {
  const h = await sshSettingsFixture(t, { recovery: publicCredential }); await open(h);
  const row = recovery(h); await h.input(row.querySelector('input:not([type="checkbox"])'), 'Mismatch');
  await h.click(row.querySelector('input[type="checkbox"]'));
  h.expect('begin-import', importBody(publicCredential, 'Mismatch', 'registry-1'), importProof(publicCredential));
  const wrong = keyView({ credential: { id: 'CA', spki: 'Cg' } });
  h.expect('finish-enroll', finishBody(publicCredential.id), { record: wrong, snapshot: { revision: 'wrong', keys: [wrong] } });
  h.expect('cancel-enroll', { action: 'cancel-enroll', token: 'SYNTHETIC-recovery-token' }, {});
  await h.proof(publicCredential, () => h.click('Import with strict verification', row));
  assert.equal(h.current.busy, false); assert.notEqual(h.current.error, '');
  assert.equal(h.current.recovery.length, 1); assert.equal(h.actions().filter(action => action === 'begin-import').length, 1);
  assert.equal(Object.keys(h.view.window.localStorage).some(key => key.startsWith('brabbler:browser-ssh-ack:v1:')), false);
  assert.deepEqual(JSON.parse(h.view.window.localStorage.getItem(genericKey)), publicCredential);
  noAuthority(h); h.assertComplete();
});

test('held Settings read is released and fully joined on unmount before shared realm disposal', async t => {
  const h = await sshSettingsFixture(t);
  const held = h.expect('status', { action: 'status' }, statusView(), { hold: true });
  await h.setActive(true); await held.parsed.promise;
  const before = h.invocations.length;
  await h.view.unmount();
  assert.equal(held.request.options.signal.aborted, true);
  await h.dispose(); // shared beforeDispose independently releases held external gates and joins full handlers
  assert.equal(held.release.released, true);
  assert.equal(h.invocations.length, before); assert.equal(h.timers.size, 0);
});

test('failed setup joins its independently admitted held callback before realm/global restoration', async t => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let joinedWithLiveRealm = false;
  await assert.rejects(sshSettingsFixture(t, { failSetup(window) {
    joinedWithLiveRealm = globalThis.window === window && Boolean(window.document.body);
  } }), /deliberate SSH Settings setup failure/);
  assert.equal(joinedWithLiveRealm, true);
  const after = Object.getOwnPropertyDescriptor(globalThis, 'window');
  assert.equal(after?.value === before?.value, true);
});
