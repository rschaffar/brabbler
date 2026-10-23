import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { createJiti } from 'jiti';
import { mount } from '../lib/testing/react.fixture.mjs';
import { controlledLeafFetch, buttonWithText, click } from '../lib/testing/leaf-controls.fixture.mjs';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
async function production() {
  const { ToolDefinitionsPanel, getToolParameterFields } = await jiti.import('./ToolDefinitionsPanel.tsx');
  const { I18nProvider, useI18n } = await jiti.import('../hooks/useI18n.tsx');
  function Tools(props) {
    const { t } = useI18n();
    return createElement(ToolDefinitionsPanel, { ...props, translate: t });
  }
  return { getToolParameterFields,
    render: props => createElement(I18nProvider, null, createElement(Tools, props)) };
}
const tool = (name, extra = {}) => ({ name, active: true, description: `${name} description`, ...extra });
const selected = view => [...view.container.querySelectorAll('nav button[aria-pressed="true"]')].map(button => button.textContent);
const detail = view => view.container.querySelector('.tool-definition-detail');

test('production schema projection preserves required/type/enum/default/description data', async t => {
  controlledLeafFetch(t); // Guard production import as well as runtime HTTP.
  const { getToolParameterFields } = await production();
  for (const empty of [undefined, {}, { properties: null }, { properties: false }]) {
    assert.deepEqual(getToolParameterFields(empty), []);
  }
  const fields = getToolParameterFields({ required: ['choice', 42], properties: {
    choice: { type: 'string', description: 'choose exactly', enum: ['a', 'b'], default: 'b' },
    nested: { type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'string' }] } },
    ref: { $ref: '#/$defs/Path' },
    inferred: { enum: [null, 1, 2, 's'] },
    fixed: { const: false, default: false },
    unknown: null,
  } });
  assert.deepEqual(fields, [
    { name: 'choice', type: 'string', description: 'choose exactly', required: true, allowedValues: 'a, b', defaultValue: 'b' },
    { name: 'nested', type: 'string | number[]', description: undefined, required: false, allowedValues: undefined, defaultValue: undefined },
    { name: 'ref', type: 'Path', description: undefined, required: false, allowedValues: undefined, defaultValue: undefined },
    { name: 'inferred', type: 'null | number | string', description: undefined, required: false, allowedValues: 'null, 1, 2, s', defaultValue: undefined },
    { name: 'fixed', type: 'false', description: undefined, required: false, allowedValues: undefined, defaultValue: 'false' },
    { name: 'unknown', type: 'unknown', description: undefined, required: false, allowedValues: undefined, defaultValue: undefined },
  ]);
});

test('actual active-tool buttons select detail; rerender retains or replaces selection by current names', async t => {
  const http = controlledLeafFetch(t);
  const { render } = await production();
  const alpha = tool('alpha'), beta = tool('beta', {
    parameters: { properties: { limit: { type: 'number', default: 2, enum: [1, 2], description: 'result bound' } }, required: ['limit'] },
    promptGuidelines: ['Keep exact scope'],
  });
  const view = http.bind(await mount(t, render({ loading: false, tools: [alpha, tool('disabled', { active: false }), beta] }), { setup: http.setup }));
  assert.deepEqual(selected(view), ['alpha']);
  assert.equal(view.container.querySelectorAll('nav button').length, 2);
  await click(view, buttonWithText(view.container, 'beta'));
  assert.deepEqual(selected(view), ['beta']);
  for (const text of ['beta description', 'limit', 'result bound', '1, 2', 'Keep exact scope']) {
    assert.ok(detail(view).textContent.includes(text), text);
  }
  assert.equal(detail(view).querySelector('.tool-definition-type').textContent, 'number');
  assert.equal(detail(view).querySelector('.required').textContent, 'Required');
  assert.deepEqual([...detail(view).querySelectorAll('.tool-definition-meta')].map(node => node.textContent),
    ['Allowed: 1, 2', 'Default: 2']);

  await view.rerender(render({ loading: false, tools: [beta, alpha] }));
  assert.deepEqual(selected(view), ['beta'], 'same tool name survives reorder');
  await view.rerender(render({ loading: false, tools: [alpha, beta] }));
  assert.deepEqual(selected(view), ['beta'], 'retained selection is not reset to the first tool');
  await view.rerender(render({ loading: false, tools: [alpha, tool('beta', { active: false })] }));
  assert.deepEqual(selected(view), ['alpha'], 'inactive selected name is replaced');
  assert.ok(detail(view).textContent.includes('alpha description'));
  assert.ok(!detail(view).textContent.includes('Keep exact scope'));
  await view.rerender(render({ loading: false, tools: [alpha, beta] }));
  assert.deepEqual(selected(view), ['alpha'], 'reappearing obsolete name must not revive the old selection');
  await view.rerender(render({ loading: false, tools: [] }));
  assert.deepEqual(selected(view), []);
  assert.equal(detail(view).querySelector('.tool-definition-scroll') === null, true, 'no detail scroll for empty tools');
  await view.unmount();
  assert.equal(view.container.childNodes.length, 0);
});

test('a stable selected name receives fresh metadata and never displays inactive definitions', async t => {
  const http = controlledLeafFetch(t);
  const { render } = await production();
  const view = http.bind(await mount(t, render({ loading: true, tools: null }), { setup: http.setup }));
  assert.equal(view.container.querySelectorAll('nav button').length, 0);
  await view.rerender(render({ loading: false, tools: [tool('one')] }));
  assert.deepEqual(selected(view), ['one']);
  await view.rerender(render({ loading: false, tools: [tool('one', {
    description: 'fresh current description', promptGuidelines: ['new guideline'],
  }), tool('secret', { active: false, description: 'must not be shown' })] }));
  assert.deepEqual(selected(view), ['one']);
  assert.ok(detail(view).textContent.includes('fresh current description'));
  assert.ok(detail(view).textContent.includes('new guideline'));
  assert.ok(!view.container.textContent.includes('must not be shown'));
});
