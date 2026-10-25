import './testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { notifyKey, signingRequest, sshNotificationFixture } from './ssh-notifications.fixture.mjs';
const deniedStatus = 'Notification permission is unavailable or denied. SSH requests remain visible in this page; no permission prompts will be retried automatically.';

// Actual useSshAgent + browser-ssh-client + browser-notifications, real React/
// StrictMode and localStorage. Only external HTTP, Notification, clock and the
// explicitly clicked connection's WebAuthn proof are controlled. No sign proof is
// admitted. Native WebAuthn/crypto/OpenSSH/socket/browser chains remain unchanged.
for (const state of ['live', 'expired', 'removed', 'different-request', 'disconnected', 'page-closed', 'changed-payload', 'changed-policy', 'changed-fingerprint', 'changed-description', 'changed-uv-only', 'changed-unlock-only']) {
  test(`SSH notification clicks only focus/review the exact live owned request: ${state}`, async t => {
    const h = await sshNotificationFixture(t, { stored: 'true' });
    assert.equal(h.assertions, 0); assert.equal(h.current.connection, null); assert.equal(h.prompts, 0);
    await h.connect();
    assert.equal(h.assertions, 1); assert.equal(h.notices.length, 1); assert.equal(h.focus, 0);
    const notice = h.notices[0];
    if (state === 'expired') h.setNow(h.current.requests[0].deadline); // exact monotonic boundary, no expiry timer needed
    if (state === 'removed') await h.poll([]);
    if (state === 'different-request') await h.poll([{ ...signingRequest, id: 'other' }]);
    if (state === 'changed-payload') await h.poll([{ ...signingRequest, challenge: 'CA' }]);
    if (state === 'changed-policy') await h.poll([{ ...signingRequest, userVerification: 'discouraged', unlock: true }]);
    // Keep the original combined-policy/challenge tuples, and vary each other
    // exact-alert field independently so another conjunct cannot mask its loss.
    if (state === 'changed-fingerprint') await h.poll([{ ...signingRequest, fingerprint: 'other fingerprint' }]);
    if (state === 'changed-description') await h.poll([{ ...signingRequest, description: 'other description' }]);
    if (state === 'changed-uv-only') await h.poll([{ ...signingRequest, userVerification: 'discouraged' }]);
    if (state === 'changed-unlock-only') await h.poll([{ ...signingRequest, unlock: true }]);
    if (state === 'disconnected') await h.disconnect();
    if (state === 'page-closed') await h.view.unmount();
    const before = h.actions();
    await h.clickNotice(notice); // deliberately invoke even a closed/stale saved callback
    assert.equal(h.focus, state === 'live' ? 1 : 0, state);
    assert.equal(h.current.reviewedId, state === 'live' ? 'request' : null, state);
    if (state !== 'page-closed') assert.equal(h.field('notice'), state === 'live' ? '' : 'That request is no longer available. Nothing was approved or reconnected.');
    assert.deepEqual(h.actions(), before, 'click never signs, reconnects, renews or changes backend');
    assert.equal(h.prompts, 0); assert.equal(h.assertions, 1);
    assert.equal(notice.closes > 0, true);
  });
}

for (const stored of [null, 'false', 'true']) for (const permission of ['default', 'denied', 'granted', 'unsupported']) {
  test(`saved SSH notification preference ${stored}/${permission} never prompts or restores signing authority`, async t => {
    const h = await sshNotificationFixture(t, { stored, permission });
    const enabled = stored === 'true' && permission === 'granted';
    assert.equal(h.current.notificationsEnabled, enabled);
    assert.equal(h.view.container.querySelector('input[type="checkbox"]').checked, enabled);
    assert.equal(h.current.notificationStatus, stored === 'true' && permission !== 'granted' ? deniedStatus : '');
    assert.equal(h.view.window.localStorage.getItem(notifyKey), stored, 'reading opt-in never rewrites it');
    assert.equal(h.prompts, 0); assert.equal(h.assertions, 0); assert.equal(h.notices.length, 0);
    assert.equal(h.current.connection, null); assert.equal(h.current.reviewedId, null); assert.equal(h.current.requests.length, 0);
    assert.equal(h.actions().every(action => action === 'status'), true, 'no discovery/connection/selection/grant mutation');
    await h.view.unmount(); await h.settle();
    assert.equal(h.assertions, 0); assert.equal(h.prompts, 0);
    assert.equal(h.actions().every(action => action === 'status'), true);
    assert.equal(h.timers.size, 0, 'observation timers released');
  });
}

for (const permission of ['denied', 'granted', 'unsupported']) {
  test(`explicit SSH notification toggle ${permission} closes local alerts only and preserves the owned request`, async t => {
    // Natural precondition for an existing alert: permission was granted when it
    // arrived, then the browser revoked/removed the capability. No seeded refs.
    const h = await sshNotificationFixture(t, { stored: 'true' }); await h.connect();
    const notice = h.notices[0]; await h.clickNotice(notice);
    const before = h.actions(), connection = h.current.connection.id;
    h.permission(permission);
    await h.toggle(true);
    assert.equal(h.current.notificationsEnabled, permission === 'granted');
    assert.equal(h.prompts, permission === 'denied' ? 1 : 0);
    assert.equal(h.view.window.localStorage.getItem(notifyKey), String(permission === 'granted'));
    if (permission !== 'granted') {
      assert.equal(h.current.notificationStatus, deniedStatus);
      assert.equal(notice.closes > 1, true, 'failed enable retires already delivered local alerts');
    }
    await h.toggle(false);
    assert.equal(h.current.notificationsEnabled, false); assert.equal(h.view.window.localStorage.getItem(notifyKey), 'false');
    assert.equal(notice.closes > 1, true); assert.equal(h.current.connection.id, connection);
    assert.equal(h.current.requests.map(item => item.id).join(','), 'request'); assert.equal(h.current.reviewedId, 'request');
    assert.deepEqual(h.actions(), before, 'disabling alerts is not deny/disconnect/revoke/lock/use');
    assert.equal(h.prompts, permission === 'denied' ? 1 : 0); assert.equal(h.assertions, 1);
  });
}

test('the rendered opt-in control reaches the real toggle and disabling leaves signing review intact', async t => {
  const h = await sshNotificationFixture(t); await h.connect();
  const checkbox = h.view.container.querySelector('input[type="checkbox"]');
  const before = h.actions();
  await h.view.dispatch(checkbox, new h.view.window.MouseEvent('click', { bubbles: true })); await h.settle();
  assert.equal(checkbox.checked, true); assert.equal(h.current.notificationsEnabled, true); assert.equal(h.notices.length, 1);
  await h.view.dispatch(checkbox, new h.view.window.MouseEvent('click', { bubbles: true })); await h.settle();
  assert.equal(checkbox.checked, false); assert.equal(h.notices[0].closes, 1);
  assert.equal(h.current.connection.id, 'owned-connection'); assert.equal(h.current.requests.length, 1);
  assert.deepEqual(h.actions(), before); assert.equal(h.prompts, 0);
});

for (const leave of ['disconnect', 'pagehide', 'unmount']) test(`ignored-abort poll cannot revive requests, review or notifications after ${leave}`, async t => {
  const h = await sshNotificationFixture(t, { stored: 'true' }); await h.connect();
  const notice = h.notices[0], poll = await h.poll([signingRequest], { hold: true });
  const reviewedBefore = h.current.reviewedId;
  // Do not call settle while the intentionally accepted poll is held. The real
  // disconnect/pagehide has its own full task, all tasks are joined after release.
  if (leave === 'disconnect') await h.act(() => h.current.disconnect());
  if (leave === 'pagehide') await h.act(() => h.view.window.dispatchEvent(new h.view.window.Event('pagehide')));
  if (leave === 'unmount') await h.view.unmount();
  assert.equal(poll.options.signal.aborted, true, 'the transport deliberately ignores the actual abort');
  assert.equal(notice.closes > 0, true);
  await h.deliverPoll(poll, [signingRequest]);
  assert.equal(h.notices.length, 1); assert.equal(h.current.reviewedId, reviewedBefore);
  if (leave !== 'unmount') {
    assert.equal(h.current.connection, null); assert.equal(h.current.requests.length, 0); assert.equal(h.field('review'), '');
  }
  const before = h.actions(); await h.clickNotice(notice);
  assert.equal(h.focus, 0); assert.deepEqual(h.actions(), before); assert.equal(h.assertions, 1); assert.equal(h.prompts, 0);
});

test('saved notification opt-in plus inert public recovery metadata still cannot restore signing authority', async t => {
  const h = await sshNotificationFixture(t, { stored: 'true', publicMetadata: true });
  assert.equal(h.current.recovery.length, 1); assert.equal(h.current.notificationsEnabled, true);
  assert.equal(h.current.connection, null); assert.equal(h.current.requests.length, 0); assert.equal(h.current.reviewedId, null);
  assert.equal(h.assertions, 0); assert.equal(h.prompts, 0); assert.equal(h.notices.length, 0);
  assert.equal(h.actions().every(action => action === 'status'), true);
});

test('unavailable page-local delivery reports failure without reconnect, worker persistence or automatic retry', async t => {
  const h = await sshNotificationFixture(t, { stored: 'true', notificationFailure: true }); await h.connect();
  assert.equal(h.deliveries, 1); assert.equal(h.notices.length, 0);
  assert.match(h.current.notificationStatus, /Page-local notifications could not be delivered/);
  await h.poll([signingRequest]);
  assert.equal(h.deliveries, 1); assert.equal(h.current.connection.id, 'owned-connection'); assert.equal(h.current.requests.length, 1);
  assert.equal(h.assertions, 1); assert.equal(h.prompts, 0);
  assert.equal(h.actions().some(action => !['status', 'connect', 'activate', 'poll'].includes(action)), false);
});

test('a delayed explicit permission answer cannot enable notifications or write opt-in after unmount', async t => {
  const h = await sshNotificationFixture(t, { permission: 'default', permissionHeld: true });
  let toggle;
  await h.act(() => { toggle = h.current.toggleNotifications(true); });
  assert.equal(h.prompts, 1); assert.equal(h.current.notificationBusy, true);
  await h.view.unmount();
  await h.act(async () => { h.permissionGate.resolve('granted'); await toggle; }); await h.settle();
  assert.equal(h.view.window.localStorage.getItem(notifyKey), null);
  assert.equal(h.notices.length, 0); assert.equal(h.assertions, 0);
  assert.equal(h.actions().every(action => action === 'status'), true);
});
