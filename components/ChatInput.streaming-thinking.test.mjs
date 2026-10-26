import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionFixture } from '../hooks/agent-session-mounted.fixture.mjs';
import { composerFixture, click } from './composer.fixture.mjs';

test('one real thinking control keeps resolved labels and locks/closes on a busy transition', async t => {
  const selected = [];
  const f = composerFixture(t), c = await f.input({ thinkingLevel: 'high', thinkingLevelMap: { high: 'adaptive' }, onThinkingLevelChange: level => selected.push(level) });
  const trigger = c.view.container.querySelector('[aria-label="Change reasoning level"]');
  assert.equal(c.view.container.querySelectorAll('[aria-label="Change reasoning level"]').length, 1);
  assert.equal(trigger.title, 'Change reasoning level: adaptive');
  await click(c.view, trigger); assert.equal(trigger.nextElementSibling === null, false);
  await c.update({ isStreaming: true });
  assert.equal(c.view.container.querySelector('[aria-label="Change reasoning level"]') === trigger, true);
  assert.equal(trigger.disabled, true); assert.equal(trigger.title, 'Reasoning level for this turn: adaptive');
  assert.equal(trigger.nextElementSibling === null, true);
  await click(c.view, trigger); assert.deepEqual(selected, []);
  await c.update({ isStreaming: false }); assert.equal(trigger.disabled, false);
});

test('actual thinking control renders original unmapped high, mapped low and off-only menu without another native reselection matrix', async t => {
  const selected = [];
  const f = composerFixture(t), c = await f.input({ thinkingLevel: 'high', thinkingLevelMap: undefined, isAutoThinkingSelection: false,
    onThinkingLevelChange: level => selected.push(level) });
  const trigger = c.view.container.querySelector('[aria-label="Change reasoning level"]');
  assert.equal(trigger !== null, true, 'the actual editable thinking control is rendered');
  assert.equal(trigger.title, 'Change reasoning level: high');
  await c.update({ thinkingLevelMap: { high: 'low' } });
  assert.equal(c.view.container.querySelector('[aria-label="Change reasoning level"]') === trigger, true);
  assert.equal(trigger.title, 'Change reasoning level: low');
  await c.update({ thinkingLevel: 'off', availableThinkingLevels: ['off'] });
  assert.equal(trigger.title, 'Change reasoning level: off');
  await click(c.view, trigger);
  const options = [...trigger.nextElementSibling.querySelectorAll('button')];
  assert.deepEqual(options.map(node => node.querySelector('span[style*="flex: 1"]')?.textContent), ['auto', 'off']);
  assert.equal(trigger.parentElement.querySelectorAll('button').length, 3, 'the actual menu is trigger + auto + off, not an unrelated count of three');
  assert.deepEqual(selected, [], 'metadata and opening the menu do not submit a thinking change');
});

test('auto is uncommitted; concrete/auto selections use the current callback, map and capability list', async t => {
  const old = [], current = [];
  const f = composerFixture(t), c = await f.input({ thinkingLevel: 'high', isAutoThinkingSelection: true, availableThinkingLevels: ['off', 'high'],
    onThinkingLevelChange: level => old.push(level) });
  const trigger = c.view.container.querySelector('[aria-label="Change reasoning level"]');
  const select = async level => {
    await click(c.view, trigger);
    const rows = [...trigger.nextElementSibling.querySelectorAll('button')];
    const row = rows.find(node => node.querySelector('span[style*="flex: 1"]')?.textContent === level);
    assert.ok(row, `thinking option ${level}`); await click(c.view, row);
  };
  assert.equal(trigger.textContent, 'high');
  await select('auto'); assert.deepEqual(old, []);
  await select('high'); assert.deepEqual(old, ['high'], 'commits the shown default');
  await c.update({ isAutoThinkingSelection: false, onThinkingLevelChange: level => current.push(level) });
  await select('high'); assert.deepEqual(current, [], 'active concrete level no-op');
  await select('auto'); assert.deepEqual(current, ['auto']);
  await select('off'); assert.deepEqual(current, ['auto', 'off']);
  await click(c.view, trigger);
  assert.equal(trigger.nextElementSibling.querySelectorAll('button').length, 3, 'auto plus supported levels');
});

// Uses the parent's actual mounted useAgentSession/maintenance fixture, never a
// substitute hook. Parent must integrate that owned fixture in the same packet.
test('actual session hook layers explicit thinking over defaults, restores live state, and auto removes the override', async t => {
  const f = await sessionFixture(t);
  await f.mountReady();
  assert.equal(f.current.thinkingLevel, 'high');
  assert.equal(f.current.isAutoThinkingSelection, true);
  await f.run('explicit fresh thinking', value => value.handleThinkingLevelChange('low'));
  assert.equal(f.current.thinkingLevel, 'low'); assert.equal(f.current.isAutoThinkingSelection, false);
  await f.run('return to default thinking', value => value.handleThinkingLevelChange('auto'));
  assert.equal(f.current.thinkingLevel, 'high'); assert.equal(f.current.isAutoThinkingSelection, true);
  f.record(f.savedId).thinking = 'medium';
  await f.mountReady(f.existingOptions());
  assert.equal(f.current.thinkingLevel, 'medium'); assert.equal(f.current.isAutoThinkingSelection, false);
  const source = f.sources.findLast(item => item.readyState !== 2), before = f.requests.length;
  await f.event(source, { type: 'agent_start' });
  assert.equal(f.current.thinkingLevel, 'medium');
  assert.equal(f.requests.slice(before).filter(request => request.method === 'GET' && request.path === `/api/agent/${f.savedId}`).length, 0,
    'agent_start itself adds no model/thinking status request');
});
