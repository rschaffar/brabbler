import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { packet, textButton } from './cards-git.fixture.mjs';

// Separate from supplied-page adapter tests: Jiti's cached Card graph must bind
// the actual runtime attachment, not their deliberately external display adapter.
test('runtime v2 and unsupported legacy cards retain their action footer without archive reads', async t => {
  const h = await packet(t); // No read capability: any transport is a fixture failure.
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const operationId = 'a046677d-8293-4445-9a2b-558317341280';
  for (const version of [2, 1]) {
    const request = { type: 'extension_ui_request', id: `pending-${version}`, method: 'plugin_card', pluginId: 'git-workflow',
      title: 'Git commit', operationId, review: { version, id: operationId, operationId }, actions: [{ id: 'approve', label: 'Approve commit', primary: true }] };
    await h.render(createElement(BlockingRequestCard, { request, sessionId: 'current', onRespond: () => assert.fail('display must not authorize') }));
    assert.match(h.view.container.textContent, version === 2 ? /Git-backed review viewer pending/ : /Legacy review unavailable; offline migration required/);
    assert.ok(textButton(h.view.container, 'Approve commit'));
    assert.equal(h.view.container.querySelector('a[href*="reviews/"]') === null, true);
    assert.equal(h.requests.length, 0);
  }
});
