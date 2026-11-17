import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, act } from 'react';
import { createJiti } from 'jiti';
import { skillsLifetime, resourceInventory, resourceKeys as keys } from './skills-lifetime.fixture.mjs';
import { exactQuery, exactHeaders, buttonWithText, click, inputText } from '../lib/testing/leaf-controls.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
async function production(onWork) {
  const { SkillsConfig } = await jiti.import('./SkillsConfig.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const { SettingsWorkContext } = await jiti.import('./SettingsUi.tsx');
  return function renderSkills(props = {}) { return createElement(I18nProvider, null, createElement(SettingsWorkContext.Provider, { value: onWork },
    createElement(SkillsConfig, { cwd: '/fixture', sessionId: 'session-A', embedded: true, onClose() {}, ...props }))); };
}
const patches = http => http.requests.filter(request => request.options.method === 'PATCH');
const rowButton = (view, name) => [...view.container.querySelectorAll('.config-sidebar-item')].find(button => button.querySelector('.config-sidebar-text').textContent === name);
const scope = (view, name) => [...view.container.querySelectorAll('fieldset')].find(field => field.querySelector('legend').textContent === name);
const radio = (view, name, choice) => scope(view, name).querySelector(`input[value="${choice}"]`);
const text = view => view.container.textContent;
const apply = view => buttonWithText(view.container, 'Apply saved changes');
async function selected(view, name) { await click(view, rowButton(view, name)); }
async function fixture(t, { data = resourceInventory(), setup, settle = true, route, props = {} } = {}) {
  const lifetime = skillsLifetime(t, request => {
    const method = request.options.method ?? 'GET';
    if (request.url.pathname === '/api/skills/content') {
      assert.equal(method, 'GET'); exactHeaders(request);
      const inspected = data.catalog.rows.find(row => row.selectionKey === request.url.searchParams.get('selectionKey'));
      assert.equal(inspected?.kind, 'skill', 'content request names a current skill');
      assert.equal(inspected.membership, 'confirmed');
      exactQuery(request, { selectionKey: inspected.selectionKey, ...(data.context.cwd ? { cwd: data.context.cwd } : {}), ...(data.context.sessionId ? { sessionId: data.context.sessionId } : {}) });
      return { content: '' };
    }
    assert.equal(request.url.pathname, '/api/agent-resources');
    if (method === 'GET') {
      exactHeaders(request);
      assert.deepEqual(Object.keys(request.options), ['signal']);
      assert.equal(typeof request.options.signal.aborted, 'boolean');
      if (route) return route(request);
      exactQuery(request, { ...(data.context.cwd ? { cwd: data.context.cwd } : {}), ...(data.context.sessionId ? { sessionId: data.context.sessionId } : {}) });
      return structuredClone(data);
    }
    assert.equal(method, 'PATCH');
    exactQuery(request, {}); exactHeaders(request, { 'Content-Type': 'application/json' });
    assert.deepEqual(Object.keys(request.options).sort(), ['body', 'headers', 'method']);
    const body = JSON.parse(request.options.body);
    if (body.action) assert.deepEqual(body, { cwd: '/fixture', sessionId: 'session-A', action: 'apply' });
    else {
      assert.deepEqual(Object.keys(body).sort(), ['choice', 'contextToken', 'cwd', 'revision', 'scope', 'selectionKey', 'sessionId']);
      assert.equal(body.contextToken, 'context-token');
      assert.equal(body.revision, `${body.scope}-revision`);
      assert.equal(Object.values(keys).includes(body.selectionKey), true);
    }
    // Every mutation stays held until the test declares its actual result.
  });
  const render = await production(lifetime.onWork);
  const view = await lifetime.mount(render(props), { setup, settle });
  return { view, lifetime, http: lifetime.http, render, data };
}

// Replaces the old dormant-order helper/direct-row/frontmatter assumptions with
// mounted hierarchy, retained disabled rows and independent authored metadata.
test('actual hierarchy uses exact parents, search/disclosure, diagnostics and manual-only metadata without writes', async t => {
  const { view, http } = await fixture(t);
  assert.deepEqual([...view.container.querySelectorAll('.config-sidebar-text')].map(node => node.textContent), ['core', 'Tooling', 'Guide', 'extension', 'Standalone']);
  assert.equal(text(view).includes('Repair the missing declaration; preferences retained'), true);
  await selected(view, 'Tooling');
  assert.equal(text(view).includes('Pi or Nix manages package installation'), true);
  assert.equal([...view.container.querySelectorAll('button')].some(button => /^(Install|Update|Remove|Search packages)$/.test(button.textContent)), false);
  await selected(view, 'Guide');
  assert.equal(view.window.document.activeElement === view.container.querySelector('h3'), true, 'desktop selection focuses actual detail');
  assert.equal(text(view).includes('Authored manual-only skill'), true);
  assert.equal(text(view).includes('No instructions in this skill.'), true);
  assert.equal(text(view).includes('✓ Included in next-turn selection'), false, 'manual-only is not automatic advertising');
  const collapse = view.container.querySelector('button[aria-label="Collapse Tooling"]');
  await click(view, collapse);
  assert.equal(rowButton(view, 'Guide') === undefined, true);
  await inputText(view, view.container.querySelector('input[type="search"]'), 'Guidance description');
  assert.equal(Boolean(rowButton(view, 'Guide')), true, 'search retains matching ancestors despite collapse');
  assert.equal(Boolean(rowButton(view, 'Tooling')), true);
  assert.equal(rowButton(view, 'Standalone') === undefined, true);
  assert.equal(patches(http).length, 0, 'navigation is read-only');
  assert.equal(http.requests.every(request => request.jsonCalls === 1), true);
});

test('real scoped save under Off parent commits only confirmed inventory, supports Inherit and never auto-applies', async t => {
  const data = resourceInventory({ state: 'saved' });
  data.catalog.rows[0].desired.enabled = false;
  data.catalog.rows[0].desired.scopes.global.choice = 'disabled';
  data.catalog.rows[2].desired.enabled = false;
  data.catalog.rows[2].desired.disabledReasons = [{ code: 'parent-disabled', key: keys.group }];
  const { view, http, lifetime } = await fixture(t, { data });
  await selected(view, 'Guide');
  assert.equal(text(view).includes('Excluded by parent: core'), true);
  assert.equal(radio(view, 'Project', 'enabled').disabled, false, 'parent gate never blocks editing child preferences');
  await click(view, radio(view, 'Project', 'enabled'));
  const write = patches(http)[0];
  assert.deepEqual(JSON.parse(write.options.body), { cwd: '/fixture', sessionId: 'session-A', selectionKey: keys.skill, scope: 'project', choice: 'enabled', revision: 'project-revision', contextToken: 'context-token' });
  assert.equal(radio(view, 'Project', 'inherit').checked, true, 'no optimistic saved choice');
  assert.equal(scope(view, 'Project').disabled, true);
  await click(view, radio(view, 'Project', 'enabled'));
  assert.equal(patches(http).length, 1, 'pending repeated click refused');
  const saved = structuredClone(data);
  saved.catalog.rows[2].desired.scopes.project.choice = 'enabled';
  await http.reply(write, saved);
  assert.equal(radio(view, 'Project', 'enabled').checked, true);
  assert.equal(scope(view, 'Project').disabled, false);
  assert.equal(text(view).includes('Saved; apply to use in this conversation'), true);
  assert.equal(text(view).includes('✓ Included in next-turn selection'), false);
  assert.equal(patches(http).length, 1, 'saving does not apply');
  await click(view, radio(view, 'Project', 'inherit'));
  assert.equal(JSON.parse(patches(http)[1].options.body).choice, 'inherit');
  await http.reply(patches(http)[1], { error: 'scoped CAS refused' }, 409);
  assert.equal(radio(view, 'Project', 'enabled').checked, true, 'failed reset retains server-confirmed saved choice');
  assert.equal(text(view).includes('scoped CAS refused'), true);
  await click(view, radio(view, 'Project', 'inherit'));
  assert.equal(text(view).includes('scoped CAS refused'), false, 'only explicit retry clears error');
  await http.reply(patches(http)[2], data);
  assert.equal(radio(view, 'Project', 'inherit').checked, true);
  assert.equal(lifetime.works.filter(work => work.label === 'resources.save').every(work => work.settled), true);
  assert.equal(patches(http).every(request => !JSON.parse(request.options.body).action), true);
});

test('Apply is explicit, exact, readiness-confirmed; immediate busy/error retains saved selection without retry', async t => {
  const { view, http, data } = await fixture(t, { data: resourceInventory({ state: 'saved' }) });
  await selected(view, 'extension');
  assert.equal(text(view).includes('✓ Included in next-turn selection'), false);
  for (const [status, error] of [[409, 'busy: accepted work is running'], [503, 'replacement failed']]) {
    const count = patches(http).length;
    await click(view, apply(view));
    assert.deepEqual(JSON.parse(patches(http).at(-1).options.body), { cwd: '/fixture', sessionId: 'session-A', action: 'apply' });
    assert.equal(apply(view).disabled, true);
    assert.equal(text(view).includes('✓ Included in next-turn selection'), false, 'held Apply cannot claim applied');
    await http.reply(patches(http).at(-1), { error }, status);
    assert.equal(text(view).includes(error), true);
    assert.equal(text(view).includes('Saved; apply to use in this conversation'), true);
    assert.equal(rowButton(view, 'extension').getAttribute('aria-current'), 'page');
    assert.equal(radio(view, 'Session', 'inherit').checked, true);
    assert.equal(apply(view).disabled, status === 503, 'failed readiness needs a fresh real status before another Apply');
    assert.equal(patches(http).length, count + 1, 'no automatic retry or waiting');
    await selected(view, 'Standalone'); await selected(view, 'extension');
    assert.equal(patches(http).length, count + 1, 'navigation/settlement does not retry');
  }
  await click(view, buttonWithText(view.container, 'Refresh'));
  assert.equal(apply(view).disabled, false);
  await click(view, apply(view));
  const ready = structuredClone(data); ready.runtime.state = 'applied'; ready.runtime.appliedRevision = ready.runtime.savedRevision;
  await http.reply(patches(http).at(-1), ready);
  assert.equal(text(view).includes('✓ Included in next-turn selection'), true, 'only actual readiness response earns compact included row');
  assert.equal(text(view).includes('Saved selection applied to this conversation'), true);
  assert.equal(text(view).includes('replacement failed'), false);
  assert.equal(patches(http).length, 3);
});

test('same-revision Apply failure cannot retain a stale actual-readiness claim', async t => {
  const { view, http, data } = await fixture(t);
  await selected(view, 'extension');
  assert.equal(text(view).includes('✓ Included in next-turn selection'), true);
  await click(view, apply(view));
  assert.equal(text(view).includes('✓ Included in next-turn selection'), false, 'admitted reconstruction is not ready');
  await http.reply(patches(http)[0], { error: 'retirement failed' }, 503);
  assert.equal(text(view).includes('✓ Included in next-turn selection'), false);
  assert.equal(text(view).includes('Saved selection applied to this conversation'), false);
  assert.equal(text(view).includes('actual runtime readiness is unconfirmed'), true);
  assert.equal(apply(view).disabled, true);
  assert.equal(radio(view, 'Global', 'inherit').checked, true, 'saved choices are not rolled back');
  data.runtime.state = 'error'; data.runtime.appliedRevision = null; data.runtime.error = 'disposal must finish';
  await click(view, buttonWithText(view.container, 'Refresh'));
  assert.equal(text(view).includes('disposal must finish'), true);
  assert.equal([...view.container.querySelectorAll('button')].some(button => button.textContent === 'Apply saved changes'), false, 'no confirmed live owner');
  assert.equal(patches(http).length, 1);
});

for (const state of ['starting', 'applying', 'error', 'on-open']) test(`actual ${state} response stays honest without automatic waits or action`, async t => {
  const data = resourceInventory({ state }); data.runtime.appliedRevision = null;
  if (state === 'error') data.runtime.error = 'actual runtime load failed';
  if (state === 'applying') data.runtime.applyingRevision = 'captured-target';
  const { view, http } = await fixture(t, { data });
  await selected(view, 'extension');
  assert.equal(text(view).includes('✓ Included in next-turn selection'), false);
  assert.equal([...view.container.querySelectorAll('button')].some(button => button.textContent === 'Apply saved changes'), false);
  if (state === 'error') assert.equal(text(view).includes('actual runtime load failed'), true);
  if (state === 'applying') assert.equal(text(view).includes('Applying: captured'), true);
  assert.equal(patches(http).length, 0, 'GET status never schedules Apply');
});

test('real response controls supported scopes, project-origin no Global, native prompt/theme semantics and no-session Apply absence', async t => {
  const data = resourceInventory({ cwd: null, sessionId: null });
  data.catalog.rows.push({ ...data.catalog.rows[3], kind: 'theme', path: '/fixture/theme', selectionKey: null, desired: null });
  const { view, http, render, lifetime } = await fixture(t, { data, props: { cwd: null, sessionId: null } });
  await selected(view, 'Guide');
  assert.equal(scope(view, 'Global').disabled, false);
  assert.equal(scope(view, 'Project').disabled, true);
  assert.equal(scope(view, 'Session').disabled, true);
  assert.equal(scope(view, 'Project').querySelector('input') === null, true, 'unavailable is not editable Inherit');
  assert.equal([...view.container.querySelectorAll('button')].some(button => button.textContent === 'Apply saved changes'), false);
  assert.equal(text(view).includes('New runtimes use saved choices'), true);
  await selected(view, 'theme');
  assert.equal(view.container.querySelector('fieldset') === null, true, 'native theme has no new gates');
  assert.equal(text(view).includes('Native theme'), true);
  // Rerender the actual receiving instance with a distinct admitted context.
  data.context.cwd = '/project'; data.context.sessionId = null; data.context.scopes.project = true;
  data.scopes.project = { revision: 'project-revision', ownChoices: [] };
  const local = data.catalog.rows[2]; local.scope = 'project'; local.desired.scopes.project = { editable: true, choice: 'inherit' }; local.desired.scopes.global = { editable: false, choice: null };
  await view.rerender(render({ cwd: '/project', sessionId: null }));
  await lifetime.join('resources.load');
  await selected(view, 'Guide');
  assert.equal(scope(view, 'Global') === undefined, true, 'project-origin has no Global editor');
  assert.equal(scope(view, 'Project').disabled, false);
  assert.equal(http.requests.every(request => request.jsonCalls === 1), true);
});

test('native-excluded Off skill reuses actual reader with canonical key/own Session and no native-loader prerequisite', async t => {
  const data = resourceInventory(); data.catalog.rows[2].nativeEnabled = false;
  data.catalog.rows[2].desired.enabled = false;
  data.catalog.rows[2].desired.disabledReasons = [{ code: 'parent-disabled', key: keys.group }];
  const lifetime = skillsLifetime(t, request => {
    assert.equal(request.options.method ?? 'GET', 'GET'); exactHeaders(request);
    if (request.url.pathname === '/api/agent-resources') { exactQuery(request, { cwd: '/fixture', sessionId: 'session-A' }); return data; }
    assert.equal(request.url.pathname, '/api/skills/content'); exactQuery(request, { cwd: '/fixture', sessionId: 'session-A', selectionKey: keys.skill });
    return { content: '' };
  });
  const render = await production(lifetime.onWork), view = await lifetime.mount(render());
  await selected(view, 'Guide'); await lifetime.join('skills.instructions');
  const region = view.container.querySelector('[role="region"][aria-label="Instructions"]');
  assert.equal(region.textContent, 'InstructionsNo instructions in this skill.');
  assert.equal(lifetime.http.requests.some(request => request.url.pathname === '/api/skills/content' && request.jsonCalls === 1), true);
  assert.equal(lifetime.works.some(work => work.label === 'skills.instructions' && work.settled), true);
});

for (const failed of [false, true]) test(`ignored-abort GET A/B/A cannot publish obsolete ${failed ? 'error' : 'success'}`, async t => {
  let current = { cwd: '/fixture', sessionId: 'session-A' }, hold = true;
  const { view, lifetime, http, render } = await fixture(t, { settle: false, route(request) {
    exactQuery(request, current);
    return hold ? undefined : resourceInventory(current);
  } });
  const old = [...http.requests], oldWork = lifetime.works.map(work => work.promise);
  hold = false; current = { cwd: '/fixture-B', sessionId: 'session-B' };
  await view.rerender(render(current));
  await act(async () => { await lifetime.works.at(-1).promise; });
  current = { cwd: '/fixture', sessionId: 'session-A' };
  await view.rerender(render(current));
  await act(async () => { await lifetime.works.at(-1).promise; });
  await selected(view, 'extension');
  for (let index = 0; index < old.length; index++) {
    assert.equal(old[index].options.signal.aborted, true, 'cleanup requests cancellation; fixture deliberately ignores it');
    const stale = resourceInventory(); stale.catalog.rows[3].path = 'OBSOLETE';
    await http.reply(old[index], failed ? { error: 'obsolete GET failure' } : stale, failed ? 503 : 200, index === old.length - 1 ? oldWork : []);
  }
  assert.equal(text(view).includes('OBSOLETE'), false);
  assert.equal(text(view).includes('obsolete GET failure'), false);
  assert.equal(rowButton(view, 'extension').getAttribute('aria-current'), 'page');
  assert.equal(scope(view, 'Global').disabled, false);
});

for (const failed of [false, true]) test(`old scoped save ${failed ? 'error/finally' : 'success/finally'} after A/B/A cannot change current saved state or busy`, async t => {
  const { view, http, lifetime, render, data } = await fixture(t);
  await selected(view, 'extension');
  await click(view, radio(view, 'Project', 'disabled'));
  const old = patches(http)[0], oldWork = lifetime.works.findLast(work => work.label === 'resources.save').promise;
  // Same cwd, different own Session: both must key the receiving instance.
  const originalContext = data.context;
  data.context = { ...originalContext, sessionId: 'session-B' }; data.runtime.sessionId = 'session-B';
  await view.rerender(render({ sessionId: 'session-B' }));
  await act(async () => { await lifetime.works.findLast(work => work.label === 'resources.load').promise; });
  data.context = originalContext; data.runtime.sessionId = 'session-A';
  await view.rerender(render());
  await act(async () => { await lifetime.works.findLast(work => work.label === 'resources.load').promise; });
  await selected(view, 'extension');
  await click(view, radio(view, 'Session', 'enabled'));
  const current = patches(http)[1];
  const stale = structuredClone(data); stale.catalog.rows[3].desired.scopes.project.choice = 'disabled';
  await http.reply(old, failed ? { error: 'obsolete save error' } : stale, failed ? 503 : 200, [oldWork]);
  assert.equal(radio(view, 'Project', 'inherit').checked, true);
  assert.equal(text(view).includes('obsolete save error'), false);
  assert.equal(scope(view, 'Session').disabled, true, 'old finally cannot clear current busy');
  const confirmed = structuredClone(data); confirmed.catalog.rows[3].desired.scopes.session.choice = 'enabled';
  await http.reply(current, confirmed);
  assert.equal(radio(view, 'Session', 'enabled').checked, true);
  assert.equal(scope(view, 'Session').disabled, false);
});

for (const failed of [false, true]) test(`old Apply ${failed ? 'failure' : 'readiness'} after Session A/B/A cannot publish into current work`, async t => {
  const { view, http, lifetime, render, data } = await fixture(t, { data: resourceInventory({ state: 'saved' }) });
  await selected(view, 'extension'); await click(view, apply(view));
  const old = patches(http)[0], oldWork = lifetime.works.findLast(work => work.label === 'resources.apply').promise;
  data.context.sessionId = 'session-B'; data.runtime.sessionId = 'session-B';
  await view.rerender(render({ sessionId: 'session-B' }));
  await act(async () => { await lifetime.works.findLast(work => work.label === 'resources.load').promise; });
  data.context.sessionId = 'session-A'; data.runtime.sessionId = 'session-A';
  await view.rerender(render());
  await act(async () => { await lifetime.works.findLast(work => work.label === 'resources.load').promise; });
  await selected(view, 'extension'); await click(view, radio(view, 'Session', 'enabled'));
  const ready = structuredClone(data); ready.runtime.state = 'applied'; ready.runtime.appliedRevision = ready.runtime.savedRevision;
  await http.reply(old, failed ? { error: 'obsolete Apply failure' } : ready, failed ? 503 : 200, [oldWork]);
  assert.equal(text(view).includes('✓ Included in next-turn selection'), false);
  assert.equal(text(view).includes('obsolete Apply failure'), false);
  assert.equal(scope(view, 'Session').disabled, true);
  assert.equal(rowButton(view, 'extension').getAttribute('aria-current'), 'page');
  await http.reply(patches(http)[1], data);
  assert.equal(scope(view, 'Session').disabled, false);
  assert.equal(patches(http).length, 2, 'no replay into the returned context');
});

test('desktop detail focus and mobile list/Back restore the exact originating row, selection/search/collapse retained', async t => {
  const { view, http } = await fixture(t, { setup(window) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: query => ({ matches: query === '(max-width: 640px)', addEventListener() {}, removeEventListener() {} }) });
  } });
  const listPane = view.container.querySelector('.resource-list-pane'), detailPane = view.container.querySelector('.resource-detail-pane');
  assert.equal(listPane.hidden, false, 'remembered desktop selection does not auto-open mobile detail');
  assert.equal(detailPane.hidden, true);
  await click(view, view.container.querySelector('button[aria-label="Collapse core"]'));
  await inputText(view, view.container.querySelector('input[type="search"]'), 'extension');
  const origin = rowButton(view, 'extension');
  await click(view, origin);
  assert.equal(listPane.hidden, true); assert.equal(detailPane.hidden, false);
  assert.equal(view.window.document.activeElement === view.container.querySelector('h3'), true);
  await click(view, buttonWithText(view.container, 'Back to resources'));
  assert.equal(view.window.document.activeElement === origin, true);
  assert.equal(origin.getAttribute('aria-current'), 'page');
  assert.equal(listPane.hidden, false); assert.equal(detailPane.hidden, true);
  assert.equal(view.container.querySelector('input[type="search"]').value, 'extension', 'Back preserves query');
  await inputText(view, view.container.querySelector('input[type="search"]'), '');
  assert.equal(rowButton(view, 'extension') === undefined, true, 'Back preserves collapsed hierarchy too');
  assert.equal(patches(http).length, 0);
});

test('mobile Back after detail-member navigation restores the visible origin of a collapsed branch', async t => {
  const { view, http } = await fixture(t, { setup(window) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: query => ({ matches: query === '(max-width: 640px)', addEventListener() {}, removeEventListener() {} }) });
  } });
  await click(view, view.container.querySelector('button[aria-label="Collapse core"]'));
  const origin = rowButton(view, 'core');
  await click(view, origin);
  await click(view, buttonWithText(view.container.querySelector('.config-detail'), 'Tooling'));
  assert.equal(view.container.querySelector('h3').textContent, 'Tooling', 'real detail-member navigation selects the package');
  assert.equal(rowButton(view, 'Tooling') === undefined, true, 'selected package is not rendered under collapsed group');
  await click(view, buttonWithText(view.container, 'Back to resources'));
  assert.equal(view.container.querySelector('.resource-list-pane').hidden, false);
  assert.equal(view.container.querySelector('.resource-detail-pane').hidden, true);
  assert.equal(view.window.document.activeElement === origin, true, 'Back restores the actual visible list origin, not the absent selected member');
  assert.equal(origin.closest('[hidden]') === null, true, 'restored focus is in visible navigation');
  assert.equal(view.container.querySelector('button[aria-label="Expand core"]').getAttribute('aria-expanded'), 'false', 'Back preserves collapsed group');
  assert.equal(view.container.querySelector('input[type="search"]').value, '', 'Back preserves search');
  assert.equal(view.container.querySelector('h3').textContent, 'Tooling', 'restoring origin focus does not rewrite selected detail');
  assert.equal(patches(http).length, 0, 'navigation remains read-only');
});

test('admitted original save and Apply handlers join complete body/catch/finally after observer unmount', async t => {
  for (const kind of ['save', 'apply']) await t.test(kind, async t => {
    const { view, http, lifetime } = await fixture(t, { data: resourceInventory({ state: 'saved' }) });
    await selected(view, 'extension');
    await click(view, kind === 'save' ? radio(view, 'Project', 'disabled') : apply(view));
    const write = patches(http)[0];
    assert.equal(lifetime.works.findLast(work => work.label === `resources.${kind}`).settled, false);
    await lifetime.dispose();
    assert.equal(write.replyStatus, 503);
    assert.equal(write.jsonCalls, 1);
    assert.equal(lifetime.works.every(work => work.settled), true, 'joins originals, not just transport');
    assert.equal(view.container.childNodes.length, 0);
  });
});

test('failed setup joins a real client body/catch/finally before realm closure without a bound view', async t => {
  let caught = false, finalized = false;
  const lifetime = skillsLifetime(t, request => {
    assert.equal(request.url.pathname, '/api/agent/skills-setup-fault');
    assert.equal(request.options.method, 'POST');
    exactQuery(request, {}); exactHeaders(request, { 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(request.options.body), { type: 'reload' });
  });
  const { sendAgentCommand } = await jiti.import('../lib/agent-client.ts');
  const setupError = new Error('controlled Skills setup failure');
  await assert.rejects(lifetime.mount(createElement('div'), { setup() {
    const work = sendAgentCommand('skills-setup-fault', { type: 'reload' }).then(
      () => assert.fail('held failed-setup request cannot succeed'),
      error => { assert.equal(error.name, 'AgentCommandError'); assert.equal(error.status, 503); assert.equal(error.message, 'fixture teardown'); caught = true; },
    ).finally(() => { finalized = true; });
    lifetime.onWork('fixture.setup.actualAgentCommand', work);
    throw setupError;
  } }), error => error === setupError);
  assert.equal(caught, true); assert.equal(finalized, true);
  assert.equal(lifetime.works.length, 1); assert.equal(lifetime.works[0].settled, true);
  await lifetime.dispose();
});
