import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, buttonWithText, click } from '../lib/testing/leaf-controls.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const { SkillsConfig } = await jiti.import('./SkillsConfig.tsx');
const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
const skill = (name, dormant) => ({ name, description: `${name} description`,
  filePath: `/fixture/skills/${name}/SKILL.md`, baseDir: `/fixture/skills/${name}`,
  disableModelInvocation: dormant, sourceInfo: { source: 'project', scope: 'project' } });
const skills = [skill('dormant-one', true), skill('active-two', false), skill('dormant-three', true), skill('active-four', false)];
const render = () => createElement(I18nProvider, null, createElement(SkillsConfig, { cwd: '/fixture', embedded: true, onClose() {} }));
const list = view => view.container.querySelector('.config-sidebar-list');
const names = view => [...list(view).querySelectorAll('button')].map(button => button.textContent.trim());
const toggle = view => view.container.querySelector('button[role="switch"]');
const patches = http => http.requests.filter(request => request.options.method === 'PATCH');

async function fixture(t) {
  const http = controlledLeafFetch(t, request => {
    const method = request.options.method ?? 'GET';
    if (request.url.pathname === '/api/skills' && method === 'GET') {
      assert.equal(request.url.searchParams.get('cwd'), '/fixture');
      return { skills, diagnostics: [], projectResourcesLoaded: true };
    }
    if (request.url.pathname === '/api/skills/content' && method === 'GET') {
      assert.equal(request.url.searchParams.get('cwd'), '/fixture');
      assert.ok(skills.some(item => item.filePath === request.url.searchParams.get('filePath')));
      // Real SkillInstructions remains mounted. Empty content avoids unrelated
      // Markdown/media/layout work; this is not a fake instructions component.
      return { content: '' };
    }
    assert.equal(request.url.pathname, '/api/skills');
    assert.equal(method, 'PATCH');
    const body = JSON.parse(request.options.body);
    assert.ok(skills.some(item => item.filePath === body.filePath));
    assert.equal(typeof body.disableModelInvocation, 'boolean');
    assert.deepEqual(Object.keys(body).sort(), ['disableModelInvocation', 'filePath']);
    // PATCH held so the actual component's pending state is observable.
  });
  const view = http.bind(await mount(t, render()));
  http.assertHealthy();
  return { http, view };
}

test('real skill list shows dormant rows directly after active rows and selects their actual detail', async t => {
  const { http, view } = await fixture(t);
  assert.deepEqual(names(view), ['active-two', 'active-four', 'dormant-one', 'dormant-three']);
  assert.equal(list(view).querySelector('button[aria-current="page"]').textContent.trim(), 'active-two');
  const dormant = buttonWithText(list(view), 'dormant-one');
  assert.equal(dormant.closest('details'), null, 'dormant row is not behind a disclosure');
  assert.equal(dormant.hidden, false);
  await click(view, dormant);
  assert.equal(dormant.getAttribute('aria-current'), 'page');
  assert.ok(view.container.textContent.includes('dormant-one description'));
  assert.ok(view.container.textContent.includes('Hidden from model, still manually invocable'));
  assert.equal(toggle(view).getAttribute('aria-checked'), 'false');
  assert.equal(patches(http).length, 0, 'selecting a dormant row is not a write');
  for (const request of http.requests) assert.equal(request.jsonCalls, 1);
});

test('enable commits only on PATCH success, rejects repeated pending clicks, and failure remains retryable', async t => {
  const { http, view } = await fixture(t);
  await click(view, buttonWithText(list(view), 'dormant-one'));
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
  for (const request of http.requests) assert.equal(request.jsonCalls, 1);
  http.assertHealthy();
});
