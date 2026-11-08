import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
import { deferred } from './testing/async.fixture.mjs';
const jiti = createJiti(import.meta.url, { fsCache: false });
const { createMermaidRenderer } = await jiti.import('./mermaid-render-client.ts');
const input = code => ({ code, dark: false, allowImages: false, isAllowed: () => true });

function fixture(t) {
  const started = [], controllers = [], works = [];
  const renderer = createMermaidRenderer(value => {
    const gate = deferred(), entry = { value, gate, cancelled: 0 };
    started.push(entry);
    return { promise: gate.promise, cancel() { entry.cancelled++; gate.reject(new DOMException('Disposed', 'AbortError')); } };
  });
  t.after(async () => {
    controllers.forEach(controller => controller.abort());
    started.forEach(entry => entry.gate.reject(new DOMException('Disposed', 'AbortError')));
    await Promise.allSettled(works);
  });
  return { started, run(value) {
    const controller = new AbortController(); controllers.push(controller);
    const work = renderer.render(value, controller.signal); works.push(work);
    return { controller, work };
  } };
}

test('renderer admits one realm at a time and disposes it before the next job', async t => {
  const f = fixture(t);
  for (let i = 0; i < 40; i++) {
    const current = f.run(input(`block-beta\nnode${i}["unique ${i}"]`));
    const queued = f.run(input(`flowchart TD\nA${i} --> B${i}`));
    assert.equal(f.started.length, i * 2 + 1);
    const first = f.started.at(-1);
    first.gate.resolve('<svg>first</svg>');
    assert.equal(await current.work, '<svg>first</svg>');
    assert.equal(first.cancelled, 1, 'realm release precedes job settlement');
    assert.equal(first.value.code, '', 'disposed job drops its source');
    assert.equal(f.started.length, i * 2 + 2);
    f.started.at(-1).gate.resolve('<svg>second</svg>');
    await queued.work;
    assert.equal(f.started.at(-1).cancelled, 1);
  }
});

test('queued and active cancellation settle and drop work without rendering obsolete sources', async t => {
  const f = fixture(t), active = f.run(input('A')), queued = f.run(input('B'));
  const rejectedQueued = assert.rejects(queued.work, { name: 'AbortError' });
  queued.controller.abort(); await rejectedQueued;
  assert.equal(f.started.length, 1, 'cancelled waiting job never creates a realm');
  const rejectedActive = assert.rejects(active.work, { name: 'AbortError' });
  active.controller.abort(); await rejectedActive;
  assert.equal(f.started[0].cancelled, 1);
  const latest = f.run(input('C'));
  f.started.at(-1).gate.resolve('<svg>C</svg>');
  assert.equal(await latest.work, '<svg>C</svg>');
  assert.equal(f.started.length, 2);
});

test('admission has source/count budgets and rechecks consent before starting queued work', async t => {
  const f = fixture(t), active = f.run(input('A'));
  await assert.rejects(f.run(input('x'.repeat(600000))).work, /budget exceeded/);
  let permitted = true;
  const queued = f.run({ ...input('image'), isAllowed: () => permitted });
  const refused = assert.rejects(queued.work, { name: 'AbortError' });
  permitted = false;
  f.started[0].gate.resolve('<svg/>'); await active.work; await refused;
  assert.equal(f.started.length, 1);
  const held = f.run(input('held'));
  const waiting = Array.from({ length: 64 }, (_, i) => f.run(input(`waiting-${i}`)));
  await assert.rejects(f.run(input('overflow')).work, /budget exceeded/);
  for (const job of [held, ...waiting]) {
    const rejected = assert.rejects(job.work, { name: 'AbortError' });
    job.controller.abort(); await rejected;
  }
});
