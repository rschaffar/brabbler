await import('../lib/testing/client-native-boundary.fixture.mjs');
// Actual control -> unmodified production hook action, not a fake RPC handler.
const { default: assert } = await import('node:assert/strict');
const { default: test } = await import('node:test');
const { act } = await import('react');
const { sessionFixture, command } = await import('./agent-session-mounted.fixture.mjs');
const options = { timeout: 10000 };
const off = { version: 1, codeMode: false, mcpServers: [] };
const native = { version: 1, codeMode: true, mcpServers: [{ scope: 'project', name: 'synthetic-server' }] };
const ok = data => ({ success: true, data });
const mutations = f => f.requests.filter(command('set_native_resources'));
const button = (f, text) => {
  const nodes = [...f.view.container.querySelectorAll('button')].filter(n => n.textContent.trim() === text);
  assert.equal(nodes.length, 1, `one ${text}`); return nodes[0];
};
const checkbox = (f, title) => [...f.view.container.querySelectorAll('label')].find(n => n.textContent.includes(title)).querySelector('input');
async function click(f, node, settle = true) {
  assert.equal(node.disabled, false);
  await f.view.dispatch(node, new f.view.window.MouseEvent('click', { bubbles: true }));
  if (settle) await f.settleControl();
}
async function connectReplacement(f) {
  // Apply's selected-session finally maintains a NEW source. Its readiness
  // promise is observed maintenance, so deliver the external connected event
  // before joining that maintenance. This is not a public-work/body substitute.
  const active = f.sources.filter(source => source.readyState !== 2);
  assert.equal(active.length, 1, 'one selected replacement source before readiness');
  assert.equal(active[0].url, `/api/agent/${f.savedId}/events`);
  assert.equal(active[0].readyState, 0, 'replacement is awaiting external readiness');
  await f.connect(active[0]);
  await f.settleMaintenance();
}
async function fixture(t, overrides = {}) {
  let f;
  f = await sessionFixture(t, { nativeControl: true, nativeMetadata(request) {
    const sid = request.query.get('sessionId');
    return { configuration: { ok: true, servers: [{ scope: 'project', name: 'synthetic-server', enabled: true, eligible: true, projectOverride: false, transport: 'stdio' }] },
      projectDefault: { supported: true, projectRoot: f.cwd, revision: 'a'.repeat(64), selection: native },
      ...(sid ? { live: { nativeResources: f.record(sid).nativeResources ?? off, effectiveNativeResources: off, mcpServers: [] } } : {}) };
  }, ...overrides });
  return f;
}

test('actual native control/hook: fresh explicit off is serialized in ensure before any default resource startup', options, async t => {
  const f = await fixture(t);
  await f.mountReady();
  assert.equal(f.requests.filter(r => r.path === '/api/agent/new').length, 0);
  await click(f, button(f, 'Session tools'));
  assert.equal(f.requests.filter(r => r.path === '/api/native-tools').length, 1);
  assert.equal(f.requests.filter(r => r.path === '/api/agent/new').length, 0, 'metadata is inert');
  assert.equal(checkbox(f, 'Code-mode').checked, true, 'actual project default supplied as draft only');
  await click(f, checkbox(f, 'Code-mode'));
  await click(f, checkbox(f, 'synthetic-server'));
  const ensure = f.hold(r => r.path === '/api/agent/new');
  await click(f, button(f, 'Apply'), false);
  await ensure.entered.promise;
  const creations = f.requests.filter(r => r.path === '/api/agent/new');
  assert.equal(creations.length, 1);
  const body = { cwd: f.cwd, type: 'ensure_session', modelSpeed: 'standard', nativeResources: off };
  assert.deepEqual(creations[0].body, body);
  assert.equal(creations[0].serializedBody, JSON.stringify(body));
  assert.equal(mutations(f).length, 0, 'no initialize-default-then-off sequence');
  assert.equal(f.requests.filter(command('prompt')).length, 0);
  f.record(f.savedId).nativeResources = off;
  await f.deliver(ensure, { sessionId: f.savedId });
  await f.settleControl(); await f.settleMaintenance();
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  assert.equal(f.current.systemPrompt, `system:${f.savedId}`);
  assert.equal(f.promotions.length, 0);
  assert.equal(mutations(f).length, 0);
  assert.equal(f.requests.filter(command('get_state')).length, 2, 'creation confirmation and state refresh');
  assert.equal(f.requests.filter(command('get_tools')).length, 1);
  assert.equal(f.view.container.querySelector('dialog').open, false);
  f.assertNoFailures();
});

test('actual native control/hook: pending selected Apply owns exact RPC, stable ID/transcript/draft and joined state/tools/finally', options, async t => {
  const f = await fixture(t), row = f.record(f.savedId);
  row.nativeResources = off; row.messages = [{ role: 'user', content: 'Synthetic original', timestamp: 1 }]; row.entryIds = ['original-entry'];
  await f.mountReady(f.existingOptions());
  f.setDraft(f.savedId, { value: 'literal unsent', images: [] });
  const transcript = f.current.messages, originalSource = f.sources.find(s => s.readyState !== 2);
  await click(f, button(f, 'Session tools'));
  await click(f, checkbox(f, 'Code-mode')); await click(f, checkbox(f, 'synthetic-server'));
  const mutation = f.hold(command('set_native_resources'));
  const stateBefore = f.requests.filter(command('get_state')).length, toolsBefore = f.requests.filter(command('get_tools')).length;
  await click(f, button(f, 'Apply'), false); await mutation.entered.promise;
  assert.equal(button(f, 'Applying…').disabled, true);
  assert.equal(mutations(f).length, 1);
  const body = { type: 'set_native_resources', nativeResources: native };
  assert.deepEqual(mutations(f)[0].body, body); assert.equal(mutations(f)[0].serializedBody, JSON.stringify(body));
  assert.equal(originalSource.readyState, 2);
  row.nativeResources = native;
  await f.deliver(mutation, ok({ sessionId: f.savedId, nativeResources: native }));
  await f.settleControl();
  await connectReplacement(f);
  assert.equal(f.current.sessionIdRef.current, f.savedId);
  assert.equal(f.current.messages === transcript, true);
  assert.equal(f.getDraft(f.savedId).value, 'literal unsent');
  assert.deepEqual(f.current.data.nativeResources, native);
  assert.equal(f.requests.filter(command('get_state')).length, stateBefore + 1);
  assert.equal(f.requests.filter(command('get_tools')).length, toolsBefore + 1);
  assert.equal(f.requests.filter(command('prompt')).length, 0);
  assert.equal(f.view.container.querySelector('dialog').open, false);
  f.assertNoFailures();
});

test('actual native control/hook: lost Apply ACK repairs metadata only, locks repeat, Refresh confirms without replay', options, async t => {
  const f = await fixture(t); f.record(f.savedId).nativeResources = off;
  await f.mountReady(f.existingOptions());
  await click(f, button(f, 'Session tools')); await click(f, checkbox(f, 'Code-mode'));
  const mutation = f.hold(command('set_native_resources'));
  const repair = f.hold(r => r.path === `/api/sessions/${f.savedId}` && r.query.get('tail') === '1');
  const live = f.hold(r => r.path === `/api/agent/${f.savedId}` && r.query.get('tools') === '1');
  await click(f, button(f, 'Apply'), false); await mutation.entered.promise;
  await f.deliver(mutation, { error: 'synthetic lost native ACK' });
  await repair.entered.promise;
  await f.deliver(repair, f.snapshot(f.savedId, { nativeResources: off }));
  await live.entered.promise; await f.deliver(live, { running: true, state: f.live(f.savedId), tools: [] });
  await f.settleControl();
  await connectReplacement(f);
  assert.equal(mutations(f).length, 1);
  assert.equal(button(f, 'Apply').disabled, true);
  assert.equal(f.view.container.querySelector('dialog').open, true);
  const reads = f.requests.filter(r => r.path === '/api/native-tools').length;
  await click(f, button(f, 'Refresh status'));
  assert.equal(f.requests.filter(r => r.path === '/api/native-tools').length, reads + 1);
  assert.equal(mutations(f).length, 1);
  assert.equal(checkbox(f, 'Code-mode').checked, false);
  assert.equal(button(f, 'Apply').disabled, false);
  assert.equal(f.requests.filter(r => r.path === `/api/sessions/${f.savedId}` && r.query.get('tail') === '1').length, 1);
  assert.equal(f.requests.filter(r => r.path === `/api/agent/${f.savedId}` && r.query.get('tools') === '1').length, 1);
  f.assertNoFailures();
});

// Appended finite N1/N3/N4 cut owners. External metadata/store values model a
// committed remote change; they do not certify native SDK/file/PID authority.
const nativeReads = f => f.requests.filter(r => r.path === '/api/native-tools' && r.method === 'GET');
const defaultWrites = f => f.requests.filter(r => r.path === '/api/native-tools' && r.method === 'POST');
const metadataFor = (f, projectDefault) => ({
  configuration: { ok: true, servers: [{ scope: 'project', name: 'synthetic-server', enabled: true, eligible: true, projectOverride: false, transport: 'stdio' }] },
  projectDefault,
  live: { nativeResources: f.record(f.savedId).nativeResources, effectiveNativeResources: off, mcpServers: [] },
});
const noSideCommands = f => {
  assert.equal(f.requests.filter(command('abort')).length, 0);
  assert.equal(f.requests.filter(command('abort_bash')).length, 0);
  assert.equal(f.requests.filter(command('prompt')).length, 0);
  assert.equal(f.requests.filter(r => r.path === '/api/agent/new').length, 0);
};

test('actual control/hook: OTHER remains busy while CURRENT applies off once with lost successful ACK; explicit Refresh alone confirms without replay', options, async t => {
  const OTHER = 'native-ack-OTHER';
  const f = await fixture(t, { savedSessionId: 'native-ack-CURRENT', nativePeerSessionId: OTHER });
  f.record(f.savedId).nativeResources = native;
  const otherRow = f.declareSession(OTHER); otherRow.nativeResources = native; otherRow.running = true;
  otherRow.state = { isStreaming: true, isPromptRunning: true };
  await f.mountReady(f.existingOptions());
  const owner = f.current.maintenanceHandle ?? f.maintenanceHandle;
  const otherOwner = f.nativePeerCurrent.whenMaintenanceSettled;
  const transcript = f.current.messages, otherTranscript = f.nativePeerCurrent.messages;
  const otherSource = f.sources.find(source => source.url === `/api/agent/${OTHER}/events` && source.readyState === 1);
  assert.ok(otherSource); assert.equal(f.nativePeerCurrent.agentRunning, true); assert.equal(f.current.agentRunning, false);
  f.setDraft(f.savedId, { value: 'CURRENT literal draft', images: [] });
  f.setDraft(OTHER, { value: 'OTHER literal draft', images: [] });
  await click(f, button(f, 'Session tools'));
  assert.equal(nativeReads(f).length, 1); assert.equal(nativeReads(f)[0].query.get('sessionId'), f.savedId);
  assert.ok(nativeReads(f)[0].signal instanceof AbortSignal);
  await click(f, checkbox(f, 'Code-mode')); await click(f, checkbox(f, 'synthetic-server'));
  assert.equal(button(f, 'Apply').disabled, false, 'unrelated real hook busy state does not disable current control');
  const mutation = f.hold(command('set_native_resources'));
  const repair = f.hold(r => r.path === `/api/sessions/${f.savedId}` && r.query.get('tail') === '1');
  const live = f.hold(r => r.path === `/api/agent/${f.savedId}` && r.query.get('tools') === '1');
  const otherRequests = f.requests.filter(r => r.path.includes(`/${OTHER}`)).length;
  await click(f, button(f, 'Apply'), false); await mutation.entered.promise;
  assert.equal(mutations(f).length, 1);
  const request = mutations(f)[0], body = { type: 'set_native_resources', nativeResources: off };
  assert.equal(request.path, `/api/agent/${f.savedId}`); assert.deepEqual(request.body, body);
  assert.equal(request.serializedBody, JSON.stringify(body)); assert.equal(request.signal, undefined);
  assert.equal(button(f, 'Applying…').disabled, true); assert.equal(button(f, 'Cancel').disabled, true);
  assert.equal(f.controlWorks.filter(work => work.label === 'native.apply').length, 1);
  assert.equal(f.controlWorks.find(work => work.label === 'native.apply').settled, false);
  // External server outcome committed off; only its acknowledgement is lost,
  // matching browser route.fetch -> ambiguous fulfil, not a mock onApply.
  f.record(f.savedId).nativeResources = off;
  await f.deliver(mutation, { success: false, error: 'Synthetic acknowledgement unavailable' });
  await repair.entered.promise;
  assert.equal(button(f, 'Applying…').disabled, true, 'full hook catch owns held repair body');
  assert.equal(mutations(f).length, 1);
  await f.deliver(repair, f.snapshot(f.savedId));
  await live.entered.promise;
  await f.deliver(live, { running: true, state: f.live(f.savedId), tools: [] });
  await f.settleControl();
  const replacement = f.sources.filter(source => source.url === `/api/agent/${f.savedId}/events` && source.readyState !== 2);
  assert.equal(replacement.length, 1); assert.equal(replacement[0].readyState, 0);
  await f.connect(replacement[0]); await f.settleMaintenance(); await f.settleMaintenance(otherOwner);
  assert.equal(f.maintenanceHandle, owner, 'same CURRENT hook incarnation');
  assert.equal(f.nativePeerCurrent.whenMaintenanceSettled, otherOwner, 'same OTHER hook incarnation');
  assert.equal(f.current.sessionIdRef.current, f.savedId); assert.equal(f.nativePeerCurrent.sessionIdRef.current, OTHER);
  assert.equal(f.current.messages, transcript); assert.equal(f.nativePeerCurrent.messages, otherTranscript);
  assert.equal(f.getDraft(f.savedId).value, 'CURRENT literal draft'); assert.equal(f.getDraft(OTHER).value, 'OTHER literal draft');
  assert.deepEqual(f.current.data.nativeResources, off);
  assert.equal(f.view.container.querySelector('[role="alert"]')?.textContent ?? null, 'Synthetic acknowledgement unavailable');
  assert.equal(button(f, 'Apply').disabled, true); assert.equal(button(f, 'Cancel').disabled, false);
  assert.equal(nativeReads(f).length, 1, 'no automatic control metadata confirmation');
  const refresh = f.hold(r => r.path === '/api/native-tools' && r.method === 'GET');
  await click(f, button(f, 'Refresh status'), false); await refresh.entered.promise;
  assert.equal(nativeReads(f).length, 2); assert.equal(button(f, 'Apply').disabled, true);
  assert.equal(nativeReads(f)[1].query.get('sessionId'), f.savedId);
  assert.ok(nativeReads(f)[1].signal instanceof AbortSignal);
  await f.deliver(refresh, metadataFor(f, { supported: true, projectRoot: f.cwd, revision: 'a'.repeat(64), selection: native }));
  await f.settleControl();
  assert.equal(checkbox(f, 'Code-mode').checked, false); assert.equal(checkbox(f, 'synthetic-server').checked, false);
  assert.equal(button(f, 'Apply').disabled, false); assert.equal(f.view.container.querySelector('[role="alert"]'), null);
  assert.equal(mutations(f).length, 1); assert.equal(defaultWrites(f).length, 0);
  assert.equal(f.requests.filter(r => r.path === `/api/sessions/${f.savedId}` && r.query.get('tail') === '1').length, 1);
  assert.equal(f.requests.filter(r => r.path === `/api/agent/${f.savedId}` && r.query.get('tools') === '1').length, 1);
  assert.equal(f.requests.filter(r => r.path.includes(`/${OTHER}`)).length, otherRequests, 'no wait/Stop/read dispatch retargeted to OTHER');
  assert.equal(otherSource.readyState, 1); assert.equal(otherSource.closeCount, 0);
  assert.equal(f.nativePeerCurrent.agentRunning, true); assert.equal(otherRow.running, true);
  assert.ok(f.controlWorks.every(work => work.settled)); noSideCommands(f); f.assertNoFailures();
});

for (const failure of ['contradictory', 'lost-body']) test(`actual default clear/control/hook: ${failure} ACK locks save until explicit no-default read; existing CURRENT/OTHER unchanged`, options, async t => {
  const OTHER = 'native-default-INHERITED', revision = 'a'.repeat(64), nextRevision = 'b'.repeat(64);
  let f, project;
  f = await fixture(t, { savedSessionId: 'native-default-CURRENT', nativePeerSessionId: OTHER,
    nativeMetadata() { return metadataFor(f, project); },
    nativeDefault() { throw new Error('unexpected unheld default mutation/replay'); },
  });
  project = { supported: true, projectRoot: f.cwd, revision, selection: native };
  f.record(f.savedId).nativeResources = off; f.declareSession(OTHER).nativeResources = native;
  await f.mountReady(f.existingOptions());
  const owner = f.maintenanceHandle, otherOwner = f.nativePeerCurrent.whenMaintenanceSettled;
  const transcript = f.current.messages, otherTranscript = f.nativePeerCurrent.messages;
  await click(f, button(f, 'Session tools')); assert.equal(nativeReads(f).length, 1);
  const reset = f.hold(r => r.path === '/api/native-tools' && r.method === 'POST');
  await click(f, button(f, 'Clear project default'), false); await reset.entered.promise;
  assert.equal(defaultWrites(f).length, 1);
  const request = defaultWrites(f)[0], body = { cwd: f.cwd, revision, nativeResources: null };
  assert.deepEqual(request.body, body); assert.equal(request.serializedBody, JSON.stringify(body)); assert.equal(request.signal, undefined);
  assert.equal(button(f, 'Saving default…').disabled, true); assert.equal(button(f, 'Apply').disabled, true);
  assert.equal(f.controlWorks.filter(work => work.label === 'native.default').length, 1);
  assert.equal(f.controlWorks.find(work => work.label === 'native.default').settled, false);
  project = { ...project, revision: nextRevision, selection: null }; // external committed reset, not an onApply policy
  if (failure === 'contradictory') {
    await f.deliver(reset, { projectDefault: { ...project, selection: native }, error: 'Synthetic default acknowledgement unavailable' });
  } else {
    await act(async () => {
      reset.reject(new Error('Synthetic default acknowledgement unavailable'));
      await Promise.allSettled([reset.bodyPromise]);
    });
  }
  await f.settleControl();
  assert.equal(f.view.container.querySelector('[role="alert"]')?.textContent ?? null, 'Synthetic default acknowledgement unavailable');
  assert.equal(button(f, 'Save selection as project default').disabled, true);
  assert.equal(button(f, 'Clear project default').disabled, true); assert.equal(button(f, 'Cancel').disabled, false);
  assert.equal(nativeReads(f).length, 1); assert.equal(defaultWrites(f).length, 1);
  const refresh = f.hold(r => r.path === '/api/native-tools' && r.method === 'GET');
  await click(f, button(f, 'Refresh status'), false); await refresh.entered.promise;
  assert.equal(button(f, 'Save selection as project default').disabled, true);
  await f.deliver(refresh, metadataFor(f, project)); await f.settleControl();
  assert.equal(nativeReads(f).length, 2); assert.equal(nativeReads(f)[1].query.get('sessionId'), f.savedId);
  assert.ok(nativeReads(f)[1].signal instanceof AbortSignal);
  assert.equal(button(f, 'Save selection as project default').disabled, false);
  assert.equal(button(f, 'Clear project default').disabled, true);
  assert.match(f.view.container.textContent, /No project default\. New sessions start with native tools off unless explicitly selected\./);
  assert.equal(f.view.container.querySelector('[role="alert"]'), null);
  assert.equal(defaultWrites(f).length, 1); assert.equal(mutations(f).length, 0);
  assert.deepEqual(f.current.data.nativeResources, off); assert.deepEqual(f.nativePeerCurrent.data.nativeResources, native);
  assert.deepEqual(f.record(f.savedId).nativeResources, off); assert.deepEqual(f.record(OTHER).nativeResources, native);
  assert.equal(f.current.messages, transcript); assert.equal(f.nativePeerCurrent.messages, otherTranscript);
  assert.equal(f.maintenanceHandle, owner); assert.equal(f.nativePeerCurrent.whenMaintenanceSettled, otherOwner);
  assert.equal(f.current.sessionIdRef.current, f.savedId); assert.equal(f.nativePeerCurrent.sessionIdRef.current, OTHER);
  assert.ok(f.controlWorks.every(work => work.settled)); noSideCommands(f); f.assertNoFailures();
});
