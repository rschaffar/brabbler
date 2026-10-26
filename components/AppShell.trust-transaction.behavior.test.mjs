// RootGuard capture precedes ALL Jiti/React/JSDOM/project dependency evaluation.
await import('../lib/testing/client-native-boundary.fixture.mjs');
const { default: assert } = await import('node:assert/strict');
const { default: test } = await import('node:test');
const { readFileSync } = await import('node:fs');
const { act } = await import('react');
const { trustFixture, ROOT, SIDEBAR, restricted, granted, choice } = await import('./trust-transaction-runtime.fixture.mjs');

const initialKeys = state => {
  assert.equal(state.sessionKey, 7); assert.equal(state.modelsRefreshKey, 11);
};
const unchanged = state => {
  initialKeys(state); assert.deepEqual(state.projectTrust, restricted);
  assert.equal(state.projectTrustDialogOpen, true);
};
const applied = (state, status = granted) => {
  assert.equal(state.sessionKey, 8); assert.equal(state.modelsRefreshKey, 12);
  assert.deepEqual(state.projectTrust, status); assert.equal(state.projectTrustDialogOpen, false);
  assert.equal(state.projectTrustBusy, false); assert.equal(state.projectTrustError, null);
};

// A narrow source-callpath guard, NOT a mounted AppShell/default-remount proof.
test('default AppShell retains the direct non-async production callpath and real dialog binding', () => {
  const source = readFileSync(new URL('./AppShell.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('import { respondToProjectTrust } from "./project-trust-transaction";'));
  assert.ok(source.includes(`  const handleTrustProject = useCallback((choice: TrustChoice) => respondToProjectTrust(choice, {
    projectTrustCwd, projectTrustBusy, projectTrustCwdRef,
    setProjectTrustBusy, setProjectTrustError, setProjectTrust,
    setProjectTrustDialogOpen, setModelsRefreshKey, setSessionKey,
  }), [projectTrustBusy, projectTrustCwd, setSessionKey]);`));
  assert.ok(source.includes('onConfirm={(choice) => void handleTrustProject(choice)}'));
  assert.ok(source.includes('const projectTrustCwd = historyOnly ? null : selectedSession?.cwd ?? effectiveNewSessionCwd;'));
  assert.ok(source.includes('projectTrustCwdRef.current = projectTrustCwd;'));
  assert.equal(source.includes('fetch("/api/project-trust", {'), false, 'old duplicate POST algorithm removed');
});

test('real dialog + actual AppShell-called transaction: exact selected cwd, held JSON and observable React key/model state', async t => {
  const x = await trustFixture(t), { f } = x;
  const gate = f.gate('trust JSON'); x.route({ data: granted, gate });
  await x.mount({ initialError: 'old error' });
  assert.equal(x.state().cwd, ROOT); assert.equal(x.state().sidebarCwd, SIDEBAR);
  assert.notEqual(ROOT, SIDEBAR);
  await x.select(); await x.confirm();
  x.assertPost(); unchanged(x.state());
  assert.equal(x.state().projectTrustBusy, true); assert.equal(x.state().projectTrustError, null);
  assert.equal(f.button('Trusting...').disabled, true);
  assert.equal(f.button('Cancel').disabled, true);
  assert.ok([...f.view.container.querySelectorAll('input')].every(input => input.disabled));
  assert.equal(f.works.length, 1); assert.equal(f.works[0].settled, false);
  await f.deliver(gate); applied(x.state()); x.assertPost();
  assert.equal(f.works[0].settled, true);
  assert.equal(f.view.container.querySelector('[role="dialog"]'), null);
  // This observes real state increments, NOT a physical ChatWindow remount.
});

const decisions = [
  ['Trust this worktree only', restricted, choice],
  ['Trust this Git project (all worktrees)', restricted, { scope: 'repository', action: 'trust' }],
  ['Stop trusting this worktree', { ...granted }, { scope: 'worktree', action: 'revoke' }],
  ["Clear this worktree's restriction", { ...restricted, repositoryTrusted: true, worktreeDecision: false }, { scope: 'worktree', action: 'clear' }],
  ['Stop trusting this Git project', { ...granted, repositoryTrusted: true }, { scope: 'repository', action: 'revoke' }],
];
for (const [title, status, decision] of decisions) test(`actual transaction from real explicit dialog choice: ${decision.scope}/${decision.action}`, async t => {
  const x = await trustFixture(t), { f } = x;
  x.route({ data: restricted }, decision);
  await x.mount({ initialStatus: status }); await x.select(title); await x.confirm();
  await f.commit(); x.assertPost(decision); applied(x.state(), restricted);
});

const failures = [
  ['parsed 409', { status: 409, data: { error: 'registered-root refusal' } }, 'registered-root refusal'],
  ['non-ok fallback', { status: 503, data: {} }, 'HTTP 503'],
  ['ok plus error', { status: 200, data: { ...granted, error: 'policyNoWrite' } }, 'policyNoWrite'],
  ['fetch Error', { fetchError: new Error('synthetic fetch rejection') }, 'synthetic fetch rejection'],
  ['JSON Error', { bodyError: new Error('synthetic JSON body rejection') }, 'synthetic JSON body rejection'],
  ['non-Error fetch rejection', { fetchError: 'synthetic non-Error rejection' }, 'synthetic non-Error rejection'],
  ['non-Error body rejection', { bodyError: 'synthetic body non-Error' }, 'synthetic body non-Error'],
];
for (const [name, reply, message] of failures) test(`original catch/finally: ${name}`, async t => {
  const x = await trustFixture(t), { f } = x; x.route(reply);
  await x.mount({ initialError: 'previous failure' }); await x.select(); await x.confirm(); await f.commit();
  x.assertPost(); unchanged(x.state());
  assert.equal(x.state().projectTrustBusy, false); assert.equal(x.state().projectTrustError, message);
  assert.equal(f.node('[role="alert"]').textContent, message);
  assert.equal(f.button('Apply trust decision').disabled, false);
  assert.equal(f.button('Cancel').disabled, false);
  assert.equal(f.works.length, 1); assert.equal(f.works[0].settled, true);
});

test('actual Response.json malformed input reaches original catch/finally', async t => {
  const x = await trustFixture(t), { f } = x;
  x.route({ jsonText: '{', expectedJsonError: true });
  await x.mount(); await x.select(); await x.confirm(); await f.commit();
  x.assertPost(); unchanged(x.state()); assert.equal(x.state().projectTrustBusy, false);
  assert.ok(x.state().projectTrustError.length > 0);
  assert.equal(f.node('[role="alert"]').textContent, x.state().projectTrustError);
  assert.equal(f.button('Apply trust decision').disabled, false);
});

for (const mode of ['success', 'error', 'body rejection']) test(`captured A -> B ${mode}: original cwd-only fence and finally`, async t => {
  const x = await trustFixture(t), { f } = x, gate = f.gate('old A JSON');
  x.route(mode === 'success' ? { gate, data: granted } : mode === 'error'
    ? { gate, status: 409, data: { error: 'old A refusal' } }
    : { gate, bodyError: new Error('old A body rejection') });
  await x.mount(); const { promise } = await x.invoke();
  assert.equal(x.state().projectTrustBusy, true); unchanged(x.state());
  await x.cwd('/synthetic/B');
  await f.deliver(gate); await promise;
  x.assertPost(); unchanged(x.state());
  assert.equal(x.state().cwd, '/synthetic/B'); assert.equal(x.state().projectTrustBusy, false);
  assert.equal(x.state().projectTrustError, null);
  // Harness intentionally has no copied AppShell GET/reset effect.
});

for (const error of [false, true]) test(`A -> B -> A characterizes original cwd-only comparison: ${error ? 'error' : 'success'}`, async t => {
  const x = await trustFixture(t), { f } = x, gate = f.gate('original A JSON');
  x.route(error ? { gate, status: 409, data: { error: 'original A refusal' } } : { gate, data: granted });
  await x.mount(); const { promise } = await x.invoke();
  await x.cwd('/synthetic/B'); await x.cwd(ROOT);
  await f.deliver(gate); await promise; x.assertPost();
  if (error) {
    unchanged(x.state()); assert.equal(x.state().projectTrustBusy, false);
    assert.equal(x.state().projectTrustError, 'original A refusal');
  } else applied(x.state());
});

for (const props of [{ cwd: null }, { initialBusy: true }]) test(`original early return has no transport/state dispatch: ${props.cwd === null ? 'null cwd' : 'busy'}`, async t => {
  const x = await trustFixture(t), { f } = x;
  await x.mount({ ...props, initialError: 'must remain' });
  const before = x.state(); const { promise } = await x.invoke(); await promise;
  assert.deepEqual(x.state(), before); assert.equal(f.requests.length, 0);
  assert.equal(f.works.length, 1); assert.equal(f.works[0].settled, true);
});

// Private negative fixtures retain their own cleanup failures; they never erase
// failures from a live outer Node-test fixture or suppress React diagnostics.
const contains = (error, target) => error === target || error?.cause === target ||
  (error instanceof AggregateError && error.errors.some(cause => contains(cause, target)));
async function negativeFixture(run) {
  const hooks = [], cleanup = [];
  let primary;
  try { await run({ after(dispose) { hooks.push(dispose); } }); } catch (error) { primary = error; }
  finally { for (const dispose of hooks) { try { await dispose(); } catch (error) { cleanup.push(error); } } }
  if (primary) throw new AggregateError([primary, ...cleanup], 'negative witness assertion failed');
  return cleanup;
}

test('failed mount retains original thrown effect and joins same complete production transaction before realm restoration', async () => {
  let retained, joined = false, realmRestoredAfterJoin = false;
  const sentinel = new Error('intentional failed mount after trust admission');
  await negativeFixture(async t => {
    let x, marker;
    x = await trustFixture(t, {
      beforeRestore({ target, key }) {
        if (target === marker && key === 'value') {
          joined = x.f.works.length === 1 && x.f.works[0].settled;
          realmRestoredAfterJoin = joined;
        }
      },
      capabilities(port) {
        marker = { value: 'original' }; port.saveRealm(marker, 'value', 'realm-owned');
      },
    });
    x.route({ data: granted });
    let started = false, publicPromise;
    try {
      await x.mount({ onCommit({ respond }) {
        if (started) return; started = true;
        publicPromise = respond(choice);
        throw sentinel;
      } });
      assert.fail('mount must fail');
    } catch (error) { retained = error; }
    assert.ok(contains(retained, sentinel), 'original effect error identity retained');
    assert.ok(publicPromise); await publicPromise;
    assert.equal(x.f.view, undefined); x.assertPost();
    assert.equal(x.f.works[0].promise, publicPromise); assert.equal(x.f.works[0].settled, true);
    assert.equal(marker.value, 'original'); assert.equal(realmRestoredAfterJoin, true);
  });
  assert.equal(joined, true);
  // The mount rejection above retains the original effect marker. Async act
  // need not also report it to console.error; do not require either console
  // outcome here. The separate unexpected-route case owns collector retention.
});

test('peer release precedes settler waits; phased realm/host restoration preserves original failure identities', async () => {
  const failure = new Error('intentional realm restore observer fault');
  const cleanup = await negativeFixture(async t => {
    let marker, host, released = false;
    const x = await trustFixture(t, {
      beforeRestore({ target, key }) { if (target === marker && key === 'value') throw failure; },
      capabilities(port) {
        marker = { value: 'realm-original' }; host = { value: 'host-original' };
        port.saveRealm(marker, 'value', 'realm-owned'); port.save(host, 'value', 'host-owned');
        let release; const peer = new Promise(resolve => { release = resolve; });
        port.onSettle(() => peer);
        port.onSettle(() => { released = true; release(); });
      },
    });
    await x.mount();
    await assert.rejects(x.f.cleanup(), error => contains(error, failure));
    assert.equal(released, true);
    assert.equal(marker.value, 'realm-original'); assert.equal(host.value, 'host-original');
  });
  assert.equal(cleanup.length, 0, 'idempotent cleanup does not invent another failure');
});

test('unexpected caught transport defect remains in independent live collector through cleanup', async () => {
  const sentinel = new Error('unexpected route original assertion');
  const cleanup = await negativeFixture(async t => {
    const x = await trustFixture(t);
    x.f.route('POST', '/api/project-trust', { body: { cwd: ROOT, ...choice }, reply() { throw sentinel; } });
    await x.mount(); const { promise } = await x.invoke(); await promise; await x.f.join();
    assert.throws(() => x.f.check(), error => contains(error, sentinel));
  });
  assert.ok(cleanup.some(error => contains(error, sentinel)));
});
