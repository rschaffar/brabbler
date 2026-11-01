import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { ReviewNavigationState, REVIEW_NAVIGATION_LIMITS: limits } = await jiti.import('./operation-review-state.ts');
const position = query => ({ full: true, reading: 'after', changeIndex: 1, expansions: new Map([[0, { fromStart: 20, fromEnd: 40 }]]),
  anchors: { after: { lineNumber: 2500, side: 'additions', offset: 2 } }, scrollLeft: 12, query });
const bounded = state => { assert.ok(state.size <= limits.entries); assert.ok(state.weight <= limits.weight); };
test('both views exceed the weight budget with detached lightweight positions, recent restore and harmless eviction', () => {
  const state = new ReviewNavigationState();
  for (let id = 0; id < limits.entries * 2; id++) for (const view of ['proposal', 'result']) {
    const value = { ...position(`${view}:${id}:` + 'x'.repeat(limits.queryCodeUnits - 30)), patch: 'not retained', context: { contents: 'not retained' }, file: { contents: 'not retained' } };
    state.savePosition(`${view}:${id}`, value); bounded(state);
  }
  assert.ok(state.size < limits.entries, 'text weight, not just entry count, forces eviction');
  assert.equal(state.position('proposal:0'), undefined); assert.equal(state.position('result:0'), undefined);
  const id = limits.entries * 2 - 1;
  const proposal = state.position(`proposal:${id}`), result = state.position(`result:${id}`);
  assert.ok(proposal.query.startsWith(`proposal:${id}:`)); assert.ok(result.query.startsWith(`result:${id}:`));
  for (const restored of [proposal, result]) {
    assert.deepEqual(Object.keys(restored).sort(), ['anchors', 'changeIndex', 'expansions', 'full', 'query', 'reading', 'scrollLeft']);
    assert.equal(restored.reading, 'after'); assert.equal(restored.anchors.after.lineNumber, 2500);
  }
  proposal.expansions.set(99, { fromStart: 999, fromEnd: 999 }); proposal.anchors.after.lineNumber = 1;
  assert.equal(state.position(`proposal:${id}`).expansions.has(99), false);
  assert.equal(state.position(`proposal:${id}`).anchors.after.lineNumber, 2500);
  assert.equal(state.position(`result:${id}`).anchors.after.lineNumber, 2500);
  state.savePosition('proposal:0', position('revisited evicted file')); // No file/operation access limit.
  assert.equal(state.position('proposal:0').query, 'revisited evicted file'); bounded(state);
});
test('offsets share the bounded LRU, recent reads survive eviction, and default/huge convenience state adds no content cache', () => {
  const state = new ReviewNavigationState();
  for (let id = 0; id < limits.entries * 2; id++) for (const view of ['proposal', 'result']) {
    state.saveOffset(`${view}:${id}`, (id + 1) * 256 * 1024); bounded(state);
  }
  assert.equal(state.offset('proposal:0'), 0); assert.equal(state.offset('result:0'), 0);
  const key = `proposal:${limits.entries * 2 - 1}`, resultKey = `result:${limits.entries * 2 - 1}`;
  const recent = state.offset(key), other = state.offset(resultKey);
  for (let id = 0; id < limits.entries - 2; id++) state.saveOffset(`result:${limits.entries * 3 + id}`, 256 * 1024);
  assert.equal(state.offset(key), recent, 'recently read offset survives less-recent entries');
  assert.equal(state.offset(resultKey), other); bounded(state);
  state.saveOffset('proposal:0', 512 * 1024); assert.equal(state.offset('proposal:0'), 512 * 1024);
  const huge = position('q'.repeat(limits.queryCodeUnits * 100));
  huge.expansions = new Map(Array.from({ length: limits.expansions * 4 }, (_, id) => [id, { fromStart: 1, fromEnd: 2 }]));
  const hugeKey = `result:${limits.entries * 5}`;
  state.savePosition(hugeKey, huge); bounded(state);
  const remembered = state.position(hugeKey); assert.equal(remembered.query, ''); assert.equal(remembered.expansions.size, limits.expansions);
  assert.equal(huge.query.length, limits.queryCodeUnits * 100, 'active search is not limited by retention');
  remembered.expansions.clear(); assert.equal(state.position(hugeKey).expansions.size, limits.expansions);
  const empty = new ReviewNavigationState(), defaults = { full: false, reading: 'diff', changeIndex: -1, expansions: new Map(), anchors: {}, scrollLeft: 0, query: '' };
  empty.savePosition('proposal:0', defaults); empty.saveOffset('proposal:0', 0); assert.equal(empty.size, 0); assert.equal(empty.weight, 0);
  empty.saveOffset('proposal:0', 256 * 1024); empty.savePosition('proposal:0', defaults); assert.equal(empty.offset('proposal:0'), 256 * 1024);
  empty.saveOffset('proposal:0', 0); assert.equal(empty.size, 0); bounded(empty);
});
