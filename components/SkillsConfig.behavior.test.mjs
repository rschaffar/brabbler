import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, exactQuery, exactHeaders, buttonWithText, click } from '../lib/testing/leaf-controls.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
async function production() {
  const { SkillsConfig } = await jiti.import('./SkillsConfig.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  return function renderSkills() {
    return createElement(I18nProvider, null, createElement(SkillsConfig, { cwd: '/fixture', embedded: true, onClose() {} }));
  };
}
const skill = (name, dormant) => ({ name, description: `${name} description`,
  filePath: `/fixture/skills/${name}/SKILL.md`, baseDir: `/fixture/skills/${name}`,
  disableModelInvocation: dormant, sourceInfo: { source: 'project', scope: 'project' } });
const skills = [skill('dormant-one', true), skill('active-two', false), skill('dormant-three', true), skill('active-four', false)];
const list = view => view.container.querySelector('.config-sidebar-list');
const names = view => [...list(view).querySelectorAll('button')].map(button => button.textContent.trim());
const toggle = view => view.container.querySelector('button[role="switch"]');
const patches = http => http.requests.filter(request => request.options.method === 'PATCH');

function assertDirectRow(view, row) {
  assert.equal(row.closest('details') === null, true, 'dormant row has no disclosure ancestor');
  assert.equal(row.isConnected, true, 'dormant row is mounted initially');
  assert.equal(row.disabled, false, 'dormant row is directly actionable');
  // Emulated semantic/style visibility only, never browser geometry or focus.
  for (let ancestor = row; ancestor; ancestor = ancestor.parentElement) {
    assert.equal(ancestor.hasAttribute('hidden'), false, 'no hidden row/ancestor');
    assert.equal(ancestor.hasAttribute('inert'), false, 'no inert row/ancestor');
    assert.equal(ancestor.getAttribute('aria-hidden')?.toLowerCase() === 'true', false, 'no aria-hidden row/ancestor');
    assert.equal(ancestor.getAttribute('aria-expanded') === 'false', false, 'no collapsed row/ancestor');
    assert.equal(['closed', 'collapsed'].includes(ancestor.getAttribute('data-state')), false, 'no closed row/ancestor');
    assert.equal(ancestor.hasAttribute('data-collapsed') && ancestor.getAttribute('data-collapsed') !== 'false',
      false, 'no data-collapsed row/ancestor');
    assert.equal(ancestor.matches('.collapsed, .is-collapsed, [collapsed]'), false, 'no collapsed wrapper');
    const style = view.window.getComputedStyle(ancestor);
    assert.equal(style.display === 'none', false, 'no display:none row/ancestor');
    assert.equal(['hidden', 'collapse'].includes(style.visibility), false, 'no invisible row/ancestor');
    if (ancestor.id) {
      const controls = [...view.container.querySelectorAll('[aria-controls]')].filter(control =>
        control.getAttribute('aria-controls').split(/\s+/).includes(ancestor.id));
      assert.equal(controls.some(control => control.getAttribute('aria-expanded') === 'false'), false,
        'no collapsed disclosure controls a dormant ancestor');
    }
  }
}

function assertInstructions(http, view, selectedSkill) {
  assert.equal(list(view).querySelector('button[aria-current="page"]').textContent.trim(), selectedSkill.name);
  const regions = view.container.querySelectorAll('[role="region"][aria-label="Instructions"]');
  assert.equal(regions.length, 1, 'real selected instructions region exists');
  const field = regions[0].querySelector('.config-field');
  assert.ok(field, 'real Settings instructions field exists');
  assert.equal(field.querySelector('.config-field-label').textContent, 'Instructions');
  assert.equal(field.children.length, 2, 'label plus exact empty-state child');
  assert.equal(field.lastElementChild.tagName, 'SPAN');
  assert.equal(field.lastElementChild.textContent, 'No instructions in this skill.');
  assert.equal(regions[0].querySelector('[role="status"], [role="alert"], .markdown-body, img, video, audio, iframe') === null,
    true, 'selected empty instructions finished, without Markdown/media');
  const content = http.requests.filter(request => request.url.pathname === '/api/skills/content'
    && (request.options.method ?? 'GET') === 'GET' && request.url.searchParams.get('filePath') === selectedSkill.filePath);
  assert.equal(content.length > 0, true, 'selected file admitted at least one real content GET');
  assert.equal(content.every(request => request.answered && request.jsonCalls > 0), true,
    'selected file content GET bodies were consumed (no StrictMode GET-count contract)');
  http.assertHealthy();
}

async function fixture(t) {
  let selectedFile = skills[1].filePath;
  const http = controlledLeafFetch(t, request => {
    const method = request.options.method ?? 'GET';
    if (request.url.pathname === '/api/skills' && method === 'GET') {
      exactQuery(request, { cwd: '/fixture' });
      exactHeaders(request);
      assert.deepEqual(Object.keys(request.options), []);
      return { skills, diagnostics: [], projectResourcesLoaded: true };
    }
    if (request.url.pathname === '/api/skills/content' && method === 'GET') {
      exactQuery(request, { cwd: '/fixture', filePath: selectedFile });
      exactHeaders(request);
      assert.deepEqual(Object.keys(request.options), ['signal']);
      assert.equal(typeof request.options.signal?.aborted, 'boolean', 'real instructions abort signal');
      // Real SkillInstructions and Settings children, deliberately empty response.
      // This avoids Markdown rendering, NOT its broad static import graph.
      return { content: '' };
    }
    assert.equal(request.url.pathname, '/api/skills');
    assert.equal(method, 'PATCH');
    exactQuery(request, {});
    exactHeaders(request, { 'Content-Type': 'application/json' });
    assert.deepEqual(Object.keys(request.options).sort(), ['body', 'headers', 'method']);
    const body = JSON.parse(request.options.body);
    assert.equal(body.filePath, selectedFile, 'PATCH is for the actual selected file');
    assert.equal(typeof body.disableModelInvocation, 'boolean');
    assert.deepEqual(Object.keys(body).sort(), ['disableModelInvocation', 'filePath']);
    // PATCH held so the actual component's pending state is observable.
  });
  const render = await production(); // Host guards are already active for imports.
  const view = http.bind(await mount(t, render(), { setup: http.setup }));
  assertInstructions(http, view, skills[1]);
  return { http, view, async select(item) {
    selectedFile = item.filePath; // Declare exact next-click identity before dispatch.
    await click(view, buttonWithText(list(view), item.name));
    assertInstructions(http, view, item);
  } };
}

test('real skill list shows dormant rows directly after active rows and selects their actual detail', async t => {
  const { http, view, select } = await fixture(t);
  assert.deepEqual(names(view), ['active-two', 'active-four', 'dormant-one', 'dormant-three']);
  assert.equal(list(view).querySelector('button[aria-current="page"]').textContent.trim(), 'active-two');
  // Check both dormant rows BEFORE any disclosure or selection action.
  for (const item of [skills[0], skills[2]]) assertDirectRow(view, buttonWithText(list(view), item.name));
  const dormant = buttonWithText(list(view), 'dormant-one');
  await select(skills[0]);
  assert.equal(dormant.getAttribute('aria-current'), 'page');
  assert.ok(view.container.textContent.includes('dormant-one description'));
  assert.ok(view.container.textContent.includes('Hidden from model, still manually invocable'));
  assert.equal(toggle(view).getAttribute('aria-checked'), 'false');
  assert.equal(patches(http).length, 0, 'selecting a dormant row is not a write');
  for (const request of http.requests) assert.equal(request.jsonCalls, 1);
});

test('enable commits only on PATCH success, rejects repeated pending clicks, and failure remains retryable', async t => {
  const { http, view, select } = await fixture(t);
  await select(skills[0]);
  await click(view, toggle(view));
  assert.equal(patches(http).length, 1);
  const enable = patches(http)[0];
  assert.deepEqual(JSON.parse(enable.options.body), { filePath: skills[0].filePath, disableModelInvocation: false });
  assert.equal(toggle(view).getAttribute('aria-checked'), 'false', 'no optimistic enable');
  assert.equal(toggle(view).disabled, true);
  assert.equal(toggle(view).getAttribute('aria-busy'), 'true');
  await click(view, toggle(view));
  assert.equal(patches(http).length, 1);
  await http.reply(enable, { success: true });
  assert.equal(toggle(view).getAttribute('aria-checked'), 'true');
  assert.equal(toggle(view).disabled, false);
  assert.deepEqual(names(view), ['dormant-one', 'active-two', 'active-four', 'dormant-three']);
  assertInstructions(http, view, skills[0]);

  await click(view, toggle(view));
  const disable = patches(http)[1];
  assert.deepEqual(JSON.parse(disable.options.body), { filePath: skills[0].filePath, disableModelInvocation: true });
  assert.equal(toggle(view).getAttribute('aria-checked'), 'true');
  await http.reply(disable, { error: 'synthetic skill denial' }, 503);
  assert.equal(toggle(view).getAttribute('aria-checked'), 'true', 'failed disable does not fabricate success');
  assert.equal(toggle(view).disabled, false, 'finally clears pending');
  assert.ok(view.container.textContent.includes('synthetic skill denial'));
  await click(view, toggle(view));
  assert.ok(!view.container.textContent.includes('synthetic skill denial'), 'explicit retry clears old error');
  await http.reply(patches(http)[2], { success: true });
  assert.equal(toggle(view).getAttribute('aria-checked'), 'false');
  assert.equal(toggle(view).disabled, false);
  assert.deepEqual(names(view), ['active-two', 'active-four', 'dormant-one', 'dormant-three']);
  assertInstructions(http, view, skills[0]);
  for (const request of http.requests) assert.equal(request.jsonCalls, 1);
  http.assertHealthy();
});
