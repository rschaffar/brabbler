// Scope-local ownership of actual route calls and their named catalogue tails.
// This does not start scans, discover directories, cancel unrelated work, or
// claim process-wide/native idle. Parent alone adjudicates scheduling.
import { createSearchStreamScope } from './runtime-search-native-observer.fixture.mjs';
export function createNativeRouteOwner(t, capabilities, commitIndex) {
  const handlers = new Set(), catalogue = new Set(), starts = new Set(), bodies = new Set();
  const wrappers = new Set(), responses = new Set(), projects = new Set(), failures = [];
  const streams = createSearchStreamScope();
  const releases = [], restores = [], removals = [];
  const baselineWrappers = new Set(globalThis.__piSessions?.values() ?? []);
  const baselineStarts = new Set(globalThis.__piStartLocks?.values() ?? []);
  const baselineRead = globalThis.__piSessionListPromise;
  const baselineScan = globalThis.__piWebScanQueue;
  const baselineSave = globalThis.__piWebScanIndexSave;
  const baselineProjects = new Set(globalThis.__piProjectRefresh?.values() ?? []);
  let closed = false, closing;
  const observe = (set, promise) => {
    if (!promise || set.has(promise)) return;
    set.add(promise);
    // Collector remains live through all handlers, shutdown, bodies and commit.
    void Promise.resolve(promise).then(undefined, error => { failures.push(error); });
  };
  const sample = () => {
    const read = globalThis.__piSessionListPromise;
    const scan = globalThis.__piWebScanQueue;
    if (read !== baselineRead) observe(catalogue, read);
    if (scan !== baselineScan) observe(catalogue, scan);
    for (const task of globalThis.__piProjectRefresh?.values() ?? []) {
      if (!baselineProjects.has(task)) observe(projects, task);
    }
    for (const work of globalThis.__piStartLocks?.values() ?? []) {
      if (!baselineStarts.has(work)) observe(starts, work);
    }
    for (const wrapper of globalThis.__piSessions?.values() ?? []) {
      if (!baselineWrappers.has(wrapper) && typeof wrapper.shutdown === 'function') wrappers.add(wrapper);
    }
  };
  const all = async promises => { await Promise.allSettled([...promises]); };
  const close = () => closing ??= (async () => {
    closed = true;
    sample();
    await all(releases.map(fn => Promise.resolve().then(fn).catch(error => { failures.push(error); })));
    // Request promises include actual handler catch/finally and request bodies.
    await all(handlers);
    await all(bodies);
    sample();
    await all(starts);
    sample();
    // Never destroy a baseline/unrelated wrapper. A wrapper removed from the
    // real registry has completed its registration-owned disposal callback.
    const registered = new Set(globalThis.__piSessions?.values() ?? []);
    await all([...wrappers].filter(wrapper => registered.has(wrapper)).map(wrapper =>
      Promise.resolve().then(() => wrapper.shutdown()).catch(error => { failures.push(error); })));
    sample();
    // Captured read promises include generation-retry/project-resolution tails.
    // After admission is closed, their recursive listAllSessions() continuations
    // are part of those same promises, not a new fixture request.
    await all(catalogue);
    // The current serialized scan tail also covers any scan admitted by those
    // read continuations. This is one named queue join, not an idle/flush loop.
    const scanTail = globalThis.__piWebScanQueue;
    if (scanTail !== baselineScan) {
      observe(catalogue, scanTail);
      await all([scanTail]);
    }
    // Stale project publication is not its background generation's settlement.
    sample();
    await all(projects);
    const pending = globalThis.__piWebScanIndexSave;
    if (pending && pending === baselineSave) {
      failures.push(new Error('Refusing to commit an index writer predating this native scope'));
    } else if (pending) {
      // Actual existing production writer, synchronous atomic write + timer
      // removal, after actual scan/read settlement. Best-effort cache persistence
      // is not durable application success or native mutation authority.
      try { commitIndex(); } catch (error) { failures.push(error); }
      if (globalThis.__piWebScanIndexSave) failures.push(new Error('Owned index writer remains scheduled after its specific commit'));
    }
    await all([...responses].map(async response => {
      if (response.body && !response.bodyUsed) await response.arrayBuffer();
    }).map(work => work.catch(error => { failures.push(error); })));
    // Keep public handler/body timing unchanged; join native descriptors only
    // here, in the fixture's separate removal authority, including failures.
    try { await streams.settle(); } catch (error) { failures.push(error); }
    await all(restores.map(fn => Promise.resolve().then(fn).catch(error => { failures.push(error); })));
    // Uncertain native closure preserves the exact owned root for diagnostics.
    if (!failures.length) await all(removals.map(fn => Promise.resolve().then(fn).catch(error => { failures.push(error); })));
    streams.finish();
    if (failures.length) throw new AggregateError([...failures], 'Native session route ownership failed');
  })();
  t.after(close);
  const routes = Object.fromEntries(Object.entries(capabilities).map(([name, call]) => [name, (...args) => {
    if (closed) { const error = new Error(`Native route admission closed: ${name}`); failures.push(error); throw error; }
    sample();
    const work = (async () => {
      try {
        const response = await call(...args);
        responses.add(response);
        return response;
      } finally { sample(); }
    })();
    observe(handlers, work);
    sample();
    return work;
  }]));
  return { routes, close, root: path => streams.root(path), body: work => { observe(bodies, work); return work; }, release: fn => releases.push(fn), final: fn => restores.push(fn), remove: fn => removals.push(fn) };
}
