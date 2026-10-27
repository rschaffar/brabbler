import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement as h, act } from 'react';
import { settingsFixture } from './settings.fixture.mjs';

const profile = (scope, extra = {}) => ({ scope, name: 'same', displayName: `${scope} agent`, description: 'description', systemPrompt: 'literal instructions', tools: ['read'], loadSkills: false, loadExtensions: false, promptMode: 'append', inheritContext: false, runInBackground: false, enabled: true, filePath: scope === 'builtin' ? null : scope === 'global' ? '/home/test/.pi/agent/agents/same.md' : '/project/.pi/agents/same.md', ...extra });
async function fixture(t, profiles, models = [{ provider: 'one', id: 'id:high', name: 'Literal colon' }, { provider: 'two', id: 'same', name: 'Other provider' }]) {
  const f = await settingsFixture(t), graph = await f.load('agents');
  f.route('GET', '/api/subagents/profiles', { query: { cwd: '/project' }, cache: 'no-store', reply: () => ({ data: { profiles } }) });
  f.route('GET', '/api/subagents/settings', { cache: 'no-store', reply: { data: { enabled: false, maxConcurrent: 10 } } });
  f.route('GET', '/api/models', { query: { cwd: '/project' }, reply: { data: { modelList: models } } });
  return { f, graph };
}

test('production profile identity, copy collision, writable scopes and path rules', async t => {
  const f = await settingsFixture(t);
  const { profileKey, duplicateProfileName, isWritableScope, isTogglableScope, displayProfilePath, editableProfile } = await f.load('agents');
  assert.deepEqual(['project', 'global', 'workspace', 'builtin'].map(scope => profileKey(profile(scope))), ['project:same', 'global:same', 'workspace:same', 'builtin:same']);
  assert.equal(duplicateProfileName('same', [profile('global', { name: 'SAME-COPY' }), profile('project', { name: 'same-copy-2' })]), 'same-copy-3');
  for (const scope of ['project', 'global', 'workspace', 'builtin']) {
    assert.equal(isWritableScope(scope), ['project', 'global'].includes(scope));
    assert.equal(isTogglableScope(scope), scope !== 'workspace');
  }
  assert.equal(displayProfilePath(profile('project'), '/project'), './.pi/agents/same.md');
  assert.equal(displayProfilePath(profile('workspace'), '/project'), './.pi/agents/same.md');
  assert.equal(displayProfilePath(profile('global'), '/project'), '~/.pi/agent/agents/same.md');
  assert.equal(displayProfilePath(profile('builtin'), '/project'), null);
  const original = profile('project', { model: 'one/id:high', thinking: 'off', maxTurns: 7 });
  const draft = editableProfile(original);
  assert.equal(draft.model, 'one/id:high'); assert.equal(draft.thinking, 'off'); assert.equal(draft.maxTurns, 7);
  assert.equal('scope' in draft, false); assert.equal('filePath' in draft, false);
  assert.equal(draft.tools === original.tools, false, 'draft does not mutate catalogue tools');
});

test('actual list orders scopes, distinguishes same names, displays shadow/status, and keeps built-in fields read-only', async t => {
  const profiles = ['builtin', 'workspace', 'global', 'project'].map(scope => profile(scope, { enabled: scope !== 'global' }));
  const { f, graph: { AgentsConfig } } = await fixture(t, profiles);
  await f.mount(h(AgentsConfig, { cwd: '/project', embedded: true, onClose() {} }));
  assert.deepEqual([...f.view.container.querySelectorAll('.config-sidebar-item')].map(n => n.textContent.replace('Overridden', '').trim()), ['project agent', 'global agent', 'workspace agent', 'builtin agent']);
  assert.equal(f.node('.config-sidebar-item[aria-current="page"]').textContent.includes('project agent'), true);
  assert.equal(f.view.container.querySelectorAll('.agents-overridden-label').length, 3);
  assert.equal(f.node('.is-muted').textContent, 'global agent');
  const editableControls = [...f.node('.config-detail').querySelectorAll('input,textarea,select')];
  assert.equal(editableControls.length, 16, 'the existing full form, including eleven tool/resource/lifecycle checkboxes');
  const displayNameControl = f.node('input[aria-label="Display name"]');
  assert.equal(displayNameControl.disabled, false);
  assert.equal(f.node('.config-sidebar-item[aria-current="page"] .config-status-dot').classList.contains('is-active'), true);
  assert.equal(f.node('.is-muted').parentElement.querySelector('.config-status-dot').classList.contains('is-inactive'), true);
  await f.click(f.button('builtin agentOverridden'));
  assert.equal(f.node('input[aria-label="Display name"]') === displayNameControl, true, 'same real input, not a read-only replacement');
  const readonlyControls = [...f.node('.config-detail').querySelectorAll('input,textarea,select')];
  assert.equal(readonlyControls.length, editableControls.length);
  assert.equal(readonlyControls.every((node, index) => node === editableControls[index]), true, 'all actual control instances survive read-only selection');
  assert.equal(f.node('.config-detail code').textContent, 'same');
  assert.equal(f.view.container.querySelector('.agents-readonly-status') === null, true);
  assert.equal(f.view.container.querySelector('input[placeholder="provider/modelId"]') === null, true);
  assert.equal(f.view.container.querySelector('input[aria-label="Sub-agent ID"]') === null, true, 'stable id is text');
  assert.equal(f.node('textarea[aria-label="System instructions"]').disabled, true);
  assert.equal(f.node('textarea').style.height, '195px');
  assert.equal(f.node('textarea').style.minHeight, '195px');
  assert.equal(f.node('textarea').style.maxHeight, '60vh');
  assert.equal(f.node('textarea').style.resize, 'none');
  assert.equal(f.node('textarea').style.fontFamily, '');
  assert.equal(f.node('input[aria-label="Display name"]').style.background, 'var(--bg-panel)');
  assert.equal(f.node('input[aria-label="Display name"]').style.color, 'var(--text-dim)');
  assert.equal(f.node('button[aria-label="Model override"]').style.background, 'var(--bg-panel)');
  assert.deepEqual([...f.node('.config-detail').querySelectorAll('input,textarea,select')].map(n => n.disabled).every(Boolean), true);
  await f.click(f.button('workspace agentOverridden'));
  assert.equal(f.node('.config-detail [role="switch"]').disabled, true);
  for (const scope of ['global', 'project']) {
    const row = [...f.view.container.querySelectorAll('.config-sidebar-item')].find(n => n.textContent.includes(`${scope} agent`));
    await f.click(row);
    assert.equal(f.node('input[aria-label="Display name"]').disabled, false);
    assert.equal(f.node('textarea').style.resize, 'vertical');
  }
  await f.click(f.button('New sub-agent'));
  assert.equal(f.node('.config-list-action-button').getAttribute('aria-current'), 'page');
  assert.equal(f.node('input[aria-label="Sub-agent ID"]').value, 'custom-agent');
  assert.equal(f.node('.config-detail-path').textContent, '~/.pi/agent/agents/custom-agent.md');
  assert.deepEqual([...f.node('select[aria-label="Thinking"]').options].map(n => n.value), ['', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  await f.click('button[aria-label="Model override"]');
  assert.equal(f.node('.model-selector').classList.contains('is-field'), true);
  assert.equal(f.view.container.querySelectorAll('[role="option"]').length, 3);
  const escape = new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await f.view.dispatch(f.node('.model-selector'), escape);
  assert.equal(escape.defaultPrevented, true);
  assert.equal(f.node('button[aria-label="Model override"]').getAttribute('aria-expanded'), 'false');
});

test('real builtin switch PATCH excludes unsaved fields; duplicate/create/save/delete use exact scopes and current callbacks', async t => {
  const profiles = [profile('builtin'), profile('global', { name: 'same-copy' })];
  const { f, graph: { AgentsConfig } } = await fixture(t, profiles);
  let patch, put, confirmed = false, closed = 0;
  f.route('PATCH', '/api/subagents/profiles', { body: () => patch, reply: request => ({ data: { profile: { ...profiles.find(profile => profile.scope === request.body.scope && profile.name === request.body.name), enabled: request.body.enabled } } }) });
  f.route('PUT', '/api/subagents/profiles', { body: () => put, reply: () => ({ status: 500, data: { error: 'save refused' } }) });
  f.route('DELETE', '/api/subagents/profiles', { body: { cwd: '/project', scope: 'global', name: 'same-copy' }, reply: { status: 500, data: { error: 'delete refused' } } });
  await f.mount(h(AgentsConfig, { cwd: '/project', onClose() { closed++; } }), { setup(window) { window.confirm = message => { assert.equal(message, 'Delete global agent?'); return confirmed; }; } });
  await f.click(f.button('builtin agent'));
  const detail = f.node('.config-detail');
  assert.equal(detail.querySelector('input[aria-label="Sub-agent ID"]') === null, true, 'stable id is text');
  assert.equal([...detail.querySelectorAll('input,textarea,select')].every(n => n.disabled), true);
  assert.equal(detail.querySelector('[role="switch"]').disabled, false);
  patch = { cwd: '/project', scope: 'builtin', name: 'same', enabled: false };
  await f.click(detail.querySelector('[role="switch"]'));
  assert.equal(detail.querySelector('[role="switch"]').getAttribute('aria-checked'), 'false');
  await f.click(f.button('Duplicate'));
  assert.equal(f.node('input[aria-label="Sub-agent ID"]').value, 'same-copy-2');
  assert.equal(f.node('input[aria-label="Display name"]').value, 'builtin agent copy');
  await f.click(f.button('project', detail));
  assert.equal(f.node('.config-detail-path').textContent, './.pi/agents/same-copy-2.md');
  await f.input('input[aria-label="Description"]', 'unsaved description');
  put = { cwd: '/project', scope: 'project', profile: { name: 'same-copy-2', displayName: 'builtin agent copy', description: 'unsaved description', systemPrompt: 'literal instructions', tools: ['read'], loadSkills: false, loadExtensions: false, promptMode: 'append', inheritContext: false, runInBackground: false, enabled: false } };
  await f.click(f.button('Save'));
  assert.equal(f.node('[role="alert"]').textContent, 'save refused');
  assert.equal(f.node('input[aria-label="Description"]').value, 'unsaved description');
  await f.click(f.button('global agent'));
  await f.input('input[aria-label="Description"]', 'do not PATCH this draft');
  patch = { cwd: '/project', scope: 'global', name: 'same-copy', enabled: false };
  await f.click(f.node('.config-detail [role="switch"]'));
  assert.equal(f.node('input[aria-label="Description"]').value, 'do not PATCH this draft');
  await f.click(f.button('Delete')); assert.equal(f.requests.filter(r => r.method === 'DELETE').length, 0);
  confirmed = true; await f.click(f.button('Delete'));
  assert.equal(f.node('[role="alert"]').textContent, 'delete refused');
  await f.rerender(h(AgentsConfig, { cwd: '/project', onClose() { closed += 10; } }));
  await f.click('.config-close-button'); assert.equal(closed, 10, 'current close closure');
});

test('built-in setting and concurrency are persisted independently; explicit reload uses current session and callback', async t => {
  const { f, graph: { AgentsConfig } } = await fixture(t, []);
  let expected = { enabled: true }, reloaded = 0;
  f.route('PUT', '/api/subagents/settings', { body: () => expected, reply: () => ({ data: { enabled: true, maxConcurrent: 12 } }) });
  f.route('POST', '/api/agent/session-B', { body: { type: 'reload' }, reply: { data: { success: true, data: {} } } });
  await f.mount(h(AgentsConfig, { cwd: '/project', sessionId: 'session-A', onClose() {}, onReloaded() { reloaded++; } }));
  assert.equal(f.view.container.querySelectorAll('.agents-feature-setting').length, 1);
  assert.deepEqual([f.node('input[aria-label="Concurrent sub-agents"]').min, f.node('input[aria-label="Concurrent sub-agents"]').max, f.node('input[aria-label="Concurrent sub-agents"]').value], ['1', '32', '10']);
  assert.equal(f.node('.agents-feature-actions [role="switch"]').getAttribute('aria-checked'), 'false');
  await f.click('.agents-feature-actions [role="switch"]');
  assert.equal(f.requests.some(r => r.path.startsWith('/api/agent/')), false, 'setting does not auto reload');
  await f.rerender(h(AgentsConfig, { cwd: '/project', sessionId: 'session-B', onClose() {}, onReloaded() { reloaded += 10; } }));
  await f.click(f.button('Reload session')); assert.equal(reloaded, 10);
  expected = { maxConcurrent: 12 };
  await f.input('input[aria-label="Concurrent sub-agents"]', '12');
  await f.commit(() => f.node('input[aria-label="Concurrent sub-agents"]').dispatchEvent(new f.view.window.FocusEvent('focusout', { bubbles: true })));
  assert.equal(f.requests.some(r => r.body?.maxConcurrent === 12), true);
});

// Declarations are deliberately not interaction/layout evidence.
test('agent muted rows, feature divider, nowrap labels and native resize-corner CSS', async () => {
  const css = await readFile(new URL('../app/settings.css', import.meta.url), 'utf8');
  assert.match(css, /\.config-sidebar-text\.is-muted \{[\s\S]*?color: var\(--text-dim\)/);
  assert.match(css, /\.agents-feature-setting \{[\s\S]*?border-bottom: 1px solid var\(--border\)/);
  assert.match(css, /\.agents-concurrency-control \{[\s\S]*?white-space: nowrap;/);
  assert.match(css, /\.agents-overridden-label \{[\s\S]*?white-space: nowrap;/);
  assert.match(css, /\.agents-system-prompt \{[\s\S]*?scrollbar-width: auto;/);
  assert.match(css, /\.agents-system-prompt::-webkit-scrollbar \{[\s\S]*?width: 14px;[\s\S]*?height: 14px;/);
  assert.match(css, /\.agents-system-prompt::-webkit-scrollbar-thumb \{[\s\S]*?border: 5px solid transparent;/);
});


test('actual remembered agent selection uses scope identity and writable duplicate keeps its source scope', async t => {
  const profiles = [profile('project'), profile('global')];
  const { f, graph } = await fixture(t, profiles);
  await f.mount(h(graph.AgentsConfig, { cwd: '/project', embedded: true, onClose() {} }), { setup(window) {
    window.localStorage.setItem('brabbler:settings-navigation', JSON.stringify({ selections: { '["agents","/project"]': 'global:same' } }));
  } });
  assert.equal(f.node('.config-sidebar-item[aria-current="page"]').textContent.includes('global agent'), true);
  assert.equal(f.node('.config-detail-path').textContent, '~/.pi/agent/agents/same.md');
  const actions = f.node('.config-detail-actions');
  assert.deepEqual([...actions.children].map(n => n.getAttribute('role') ?? n.textContent), ['Duplicate', 'Delete', 'switch']);
  await f.click(f.button('Duplicate'));
  assert.equal(f.node('.config-detail-path').textContent, '~/.pi/agent/agents/same-copy.md');
  await f.click(f.button('project agent'));
  assert.equal(graph.getLastSettingsSelection('agents', '/project'), 'project:same');
  await f.click(f.button('Duplicate'));
  assert.equal(f.node('.config-detail-path').textContent, './.pi/agents/same-copy.md');
});


test('actual scoped agent model picker filters/groups identities, preserves literal colon IDs and unavailable authored references', async t => {
  const original = profile('project', { model: 'missing/nope:high' });
  const models = [{ provider: 'one', id: 'id:high', name: 'Literal colon' }, { provider: 'two', id: 'same', name: 'Other provider' }, ...Array.from({ length: 7 }, (_, i) => ({ provider: 'extra', id: `id-${i}`, name: `Extra ${i}` }))];
  const { f, graph } = await fixture(t, [original], models);
  f.route('PUT', '/api/subagents/profiles', { body: { cwd: '/project', scope: 'project', profile: { name: 'same', displayName: 'project agent', description: 'description', systemPrompt: 'literal instructions', tools: ['read'], loadSkills: false, loadExtensions: false, promptMode: 'append', model: 'one/id:high', thinking: 'off', maxTurns: 7, inheritContext: false, runInBackground: false, enabled: true } }, reply: { status: 500, data: { error: 'keep draft for inspection' } } });
  await f.mount(h(graph.AgentsConfig, { cwd: '/project', embedded: true, onClose() {} }));
  assert.equal(f.node('button[aria-label="Model override"]').textContent.includes('missing/nope:high (unavailable)'), true);
  await f.click('button[aria-label="Model override"]');
  const filter = f.node('input[aria-label="Filter models…"]');
  assert.equal(f.node('[role="listbox"]').textContent.includes('one'), true);
  assert.equal(f.node('[role="listbox"]').textContent.includes('two'), true);
  for (const query of ['literal', 'ONE/ID:HIGH', ' id:high ']) {
    await f.input(filter, query);
    assert.deepEqual([...f.view.container.querySelectorAll('[role="option"]')].map(n => n.textContent), ['Literal colon']);
  }
  await f.click(f.button('Literal colon'));
  assert.equal(f.node('button[aria-label="Model override"]').textContent, 'Literal colon');
  await f.input('select[aria-label="Thinking"]', 'off');
  await f.input('input[aria-label="Max turns"]', '7');
  await f.click(f.button('Save'));
  assert.equal(f.node('[role="alert"]').textContent, 'keep draft for inspection');
});

test('retained shared ChatInput selector import/adoption identity, not composer event proof', async () => {
  const input = await readFile(new URL('./ChatInput.tsx', import.meta.url), 'utf8');
  assert.match(input, /import \{ ModelSelector, type ModelSelectorOption \} from "\.\/ModelSelector"/);
  assert.match(input, /<ModelSelector[\s\S]*?options=\{modelOptions\}/);
});


test('actual successful agent save joins preferred-selection reload and callback body before Saved feedback', async t => {
  const f = await settingsFixture(t), graph = await f.load('agents');
  const saved = profile('project', { name: 'custom-agent', displayName: 'custom-agent', description: '', systemPrompt: '', tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'], filePath: '/project/.pi/agents/custom-agent.md' });
  const savedBody = f.gate('save acknowledgement body'), reloadBody = f.gate('preferred profile reload body'), reloadEntered = f.gate('preferred reload admitted');
  let saving = false, reads = 0;
  f.route('GET', '/api/subagents/profiles', { query: { cwd: '/project' }, cache: 'no-store', reply: () => {
    reads++;
    if (saving) { reloadEntered.release(); return { gate: reloadBody, data: { profiles: [saved] } }; }
    return { data: { profiles: [] } };
  } });
  f.route('GET', '/api/subagents/settings', { cache: 'no-store', reply: { data: { enabled: false, maxConcurrent: 10 } } });
  f.route('GET', '/api/models', { query: { cwd: '/project' }, reply: { data: { modelList: [] } } });
  f.route('PUT', '/api/subagents/profiles', { body: { cwd: '/project', scope: 'project', profile: { name: 'custom-agent', displayName: 'custom-agent', description: '', systemPrompt: '', tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'], loadSkills: false, loadExtensions: false, promptMode: 'append', inheritContext: false, runInBackground: false, enabled: true } }, reply: () => { saving = true; return { gate: savedBody, data: { profile: saved } }; } });
  await f.mount(h(graph.AgentsConfig, { cwd: '/project', embedded: true, onClose() {} }));
  await f.click(f.button('New sub-agent')); await f.click(f.button('project', f.node('.config-detail')));
  const initialReads = reads;
  f.admitContinuation('GET', '/api/subagents/profiles'); // Accepted save includes this reload even on exceptional teardown.
  await f.click(f.button('Save'), { settle: false });
  assert.equal(reads, initialReads, 'fetch completion is not JSON/save completion');
  await act(async () => { savedBody.release(); await reloadEntered.promise; });
  assert.equal(reads, initialReads + 1);
  assert.equal(f.works.findLast(work => work.label === 'agents.save').settled, false, 'save owns reload body and handlers');
  await f.deliver(reloadBody, 'agents.save');
  assert.equal(f.node('.config-sidebar-item[aria-current="page"]').textContent, 'custom-agent');
  assert.equal(f.node('.config-detail-path').textContent, './.pi/agents/custom-agent.md');
  assert.equal(f.button('Saved').disabled, true);
  await f.timers(2000);
  assert.equal(f.button('Save').disabled, false);
});


test('actual duplicate action is available for every source scope and preserves profile data with writable-target defaults', async t => {
  const { f, graph } = await fixture(t, ['project', 'global', 'workspace', 'builtin'].map(scope => profile(scope)));
  await f.mount(h(graph.AgentsConfig, { cwd: '/project', embedded: true, onClose() {} }));
  for (const scope of ['project', 'global', 'workspace', 'builtin']) {
    await f.click([...f.view.container.querySelectorAll('.config-sidebar-item')].find(node => node.textContent.includes(`${scope} agent`)));
    await f.click(f.button('Duplicate'));
    assert.equal(f.node('input[aria-label="Sub-agent ID"]').value, 'same-copy');
    assert.equal(f.node('input[aria-label="Display name"]').value, `${scope} agent copy`);
    assert.equal(f.node('textarea[aria-label="System instructions"]').value, 'literal instructions');
    assert.equal(f.node('input[aria-label="Description"]').value, 'description');
    assert.equal(f.node('.config-detail-path').textContent, scope === 'project' ? './.pi/agents/same-copy.md' : '~/.pi/agent/agents/same-copy.md');
    assert.equal(f.node('.config-detail [role="switch"]').disabled, false);
  }
});
