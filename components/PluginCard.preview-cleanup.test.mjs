import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { packet, click, input, textButton } from './cards-git.fixture.mjs';

const patch = 'diff --git a/notes.txt b/notes.txt\nindex 4824a54..d914290 100644\n--- a/notes.txt\n+++ b/notes.txt\n@@ -1 +1 @@\n-Old text\n+New text\n';
const top = ['node_modules', '.codegraph', '.next', 'test-results', 'next-env.d.ts'];
const nested = ['node_modules', 'src/meetings/__pycache__', 'src/other/__pycache__', 'next-env.d.ts', 'src/meetings/main.pyc'];
const operationId = 'a046677d-8293-4445-9a2b-558317345abc';
const review = { version: 1, id: 'review', operationId, bytes: 1024, entries: 2, sha256: 'a'.repeat(64) };
const metadata = { id: 0, label: 'Exact operation', kind: 'text', bytes: 100, sha256: 'a'.repeat(64) };
const patchEntry = { id: 1, label: 'a/notes.txt b/notes.txt', kind: 'patch', bytes: patch.length, sha256: 'b'.repeat(64) };
const context = { oldFile: { name: 'notes.txt', contents: 'Old text\n', cacheKey: 'captured-before' }, newFile: { name: 'notes.txt', contents: 'New text\n', cacheKey: 'captured-after' } };
const requestFor = (id, title, roots = []) => ({ type: 'extension_ui_request', method: 'plugin_card', id, pluginId: 'git-workflow', title,
  review, patchContext: 'captured-context',
  fields: roots.length ? roots.map(label => ({ label, value: `Needs one-time approval · 1 entries · 14 bytes · SHA256 ${'b'.repeat(64)}` }))
    : [{ label: 'Checkout', value: '/selected' }, { label: 'Resource', value: id }],
  scope: 'Approves the entire selected operation, not just an expanded file or displayed page.',
  sections: [{ title: 'Operation notes', text: ['rebase', 'merge'].includes(id) ? 'Diffs show feature changes since the merge base, not a predicted rebase/merge result.' : 'Exact selected resources', notice: true }],
  actions: [{ id: 'reject', label: roots.length ? 'Keep resources' : 'Reject' }, { id: 'approve', label: 'Approve operation', primary: true }] });

// One physical realm/package graph. No server, SDK, native authority or browser
// geometry claims; the native cases remain separate real Git/filesystem owners.
test('seven generic card tuples join original valid descendant work and preserve current responses and inert history', { timeout: 30_000 }, async t => {
  // Bounded primitive diagnostics for the parent's ONE changed attempt. This
  // timeout is hygiene, not a cancellation/join mechanism or passing evidence.
  const phase = label => console.log(`[git-card-held-gate] ${label}`);
  phase('packet:begin');
  const h = await packet(t, { review: true, cardDescendants: true });
  phase('packet:end; import:highlighter:begin');
  const highlighter = await h.load('./git-card-highlighter.fixture.mjs');
  phase('import:highlighter:end');
  const release = () => {
    phase('release:begin');
    // A one-shot release cannot free gates admitted later during a real join.
    // Exit external hold mode FIRST; explicitly rearm only at a new checkpoint.
    highlighter.hold(false); highlighter.releaseAll();
    phase('release:end');
  };
  // Also prevents future held peers during failed-assertion domain teardown.
  h.addDomainRelease(release);
  // The existing fixture invokes this AFTER actual React unmount and independent
  // peer release, BEFORE its parent-work join/realm restoration. Capture the
  // finite admitted originals then; no root effects can admit later preloads.
  // This safety join must still work when production omits parent observation.
  h.addDomainJoin(async () => {
    const handlers = highlighter.calls.map(call => call.handler);
    const originals = [...highlighter.nativeOriginals, ...handlers.filter(work => work !== undefined)];
    // Never await call.promise: invoking its overridden then before production
    // capture could steal handler identity. Only the ALREADY captured handler
    // and actual native capability promises belong to this independent join.
    const results = await Promise.allSettled(originals);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (handlers.some(work => work === undefined)) errors.push(new Error('Admitted preload has no captured production handler'));
    if (errors.length) throw new AggregateError(errors, 'Native preload/handler originals failed after complete peer settlement');
  });
  phase('import:cards:begin');
  const { BlockingRequestCard } = await h.load('./BlockingRequestCard.tsx');
  const { OperationReceiptCard } = await h.load('./OperationReceiptCard.tsx');
  phase('import:cards:end');
  const currentRead = [], oldRead = [];
  const observe = list => work => { list.push(work); h.onReadWork(work); };
  const oldObserver = observe(oldRead), currentObserver = observe(currentRead);
  const render = async (request, respond, observer = currentObserver) => {
    phase(`render:${request.id}:begin`);
    await h.render(createElement(BlockingRequestCard, {
      request, sessionId: 'current', onReadWork: observer, onRespond: async (...args) => { respond.push(args); },
    }));
    phase(`render:${request.id}:end`);
  };
  const unmount = async () => { phase('unmount:begin'); await h.render(null); phase('unmount:end'); };
  const live = name => h.requests.findLast(r => !r.signal.aborted && r.url.searchParams.has(name));
  const join = async from => {
    phase('join:begin');
    await act(async () => { await h.settle(from); });
    phase('join:end');
  };
  const body = async (request, payload) => {
    assert.equal(Boolean(request), true, 'named response exists');
    phase(`body:${request.url.search}:begin`);
    // Deliver this named external body, not a guessed request.readWork peer.
    // Body consumption below is an observation ONLY; complete ORIGINAL app
    // promises still belong to h.work and are joined after the held checkpoint.
    await act(async () => { request.reply(payload); });
    assert.equal(request.bodyCalls, 1, 'named body consumed exactly once');
    phase(`body:${request.url.search}:end`);
  };
  const assertCaptured = calls => {
    assert.equal(calls.length > 0, true, 'actual default preload was admitted before unmount');
    for (const call of calls) {
      assert.equal(Boolean(call.handler), true);
      assert.equal(h.work.some(entry => entry.promise === call.handler), true, 'parent receives SAME original complete preload handler');
    }
  };
  const pageBody = isPatch => ({ entries: isPatch ? [metadata, patchEntry] : [metadata], total: isPatch ? 2 : 1, next: null });
  const replayPair = async (reads, query, payload) => {
    // Only a caller's just-admitted, exact StrictMode stale/current pair. Never
    // search for arbitrary pending work, reply unknown peers, or omit originals.
    assert.equal(reads.length, 2, 'one exact stale/current replay pair');
    const [stale, active] = reads;
    const href = `https://fixture.invalid/api/sessions/current/reviews/review?${query}`;
    for (const read of reads) {
      assert.equal(read.url.href, href, 'literal session/review/query identity');
      assert.equal(read.status, undefined); assert.equal(read.bodyCalls, 0);
      assert.equal(Boolean(read.readWork), true);
      assert.equal(h.work.some(entry => entry.promise === read.readWork), true, 'actual original handler stays parent-owned');
    }
    assert.equal(stale.signal.aborted, true); assert.equal(active.signal.aborted, false);
    const original = stale.readWork;
    const group = h.view.container.querySelector('[role="group"]');
    const text = h.view.container.textContent;
    const requestCount = h.requests.length, preloadCount = highlighter.calls.length;
    await body(stale, payload); // same exact 200 response tuple as its active peer
    assert.equal(stale.readWork === original, true);
    assert.equal(h.work.some(entry => entry.promise === original), true);
    assert.equal(stale.bodyCalls, 1); assert.equal(stale.status, 200);
    assert.equal(active.bodyCalls, 0); assert.equal(active.status, undefined);
    assert.equal(h.requests.length, requestCount, 'stale body admits no new reads');
    assert.equal(highlighter.calls.length, preloadCount, 'stale body admits no new preload');
    assert.equal(h.view.container.querySelector('[role="group"]') === group, true);
    assert.equal(h.view.container.textContent, text, 'stale replay cannot publish into current DOM');
    return active;
  };
  const mountReview = async (request, respond, observer, isPatch) => {
    const from = h.requests.length;
    await render(request, respond, observer);
    const reads = h.requests.slice(from);
    // mount() retains default strict=true. Each fresh inline ReviewAttachment
    // admits start/patch, aborts those, then admits start/patch again. Paged
    // attachments admit exactly the two start requests, never aggregate patches.
    if (request.review.bytes > 256 * 1024) {
      assert.equal(reads.length, 2, 'paged StrictMode start replay');
      await replayPair(reads, 'start=0', pageBody(isPatch));
    } else {
      assert.equal(reads.length, 4, 'inline StrictMode start/patch replay');
      await replayPair([reads[0], reads[2]], 'start=0', pageBody(isPatch));
      await replayPair([reads[1], reads[3]], 'patch=1', isPatch ? patch : '');
    }
  };
  const fill = async isPatch => {
    await body(live('start'), pageBody(isPatch));
    await body(live('patch'), isPatch ? patch : '');
  };
  for (const [kind, title] of [['rebase', 'Git rebase'], ['merge', 'Git merge'], ['createWorktree', 'Create Git worktree'],
    ['attachWorktree', 'Attach Git worktree'], ['removeWorktree', 'Remove Git worktree'], ['top', 'Clean up integrated Git feature'], ['nested', 'Clean up integrated Git feature']]) {
    const roots = kind === 'top' ? top : kind === 'nested' ? nested : [], isPatch = ['rebase', 'merge'].includes(kind);
    const request = requestFor(kind, title, roots), old = [], current = [];
    highlighter.hold(); // explicit next tuple's held checkpoint
    const start = h.work.length, callStart = highlighter.calls.length;
    await mountReview(request, old, oldObserver, isPatch); await fill(isPatch);
    const calls = highlighter.calls.slice(callStart);
    if (isPatch) assertCaptured(calls); else assert.equal(calls.length, 0);
    const count = h.requests.length, oldCount = oldRead.length;
    const updated = { ...request, title: `${title} current` };
    await render(updated, current, currentObserver);
    assert.equal(h.requests.length, count, 'observer/callback swap cannot restart accepted reads');
    assert.equal(oldRead.length, oldCount, 'accepted promises are not replayed');
    release(); await join(start);
    assert.equal(Boolean(h.view.container.querySelector('[aria-label="Patch view"]')), isPatch);
    if (isPatch) assert.equal(Boolean(h.view.container.querySelector('.git-diff-code-view')), true, 'real valid parsed CodeView, not invalid raw fallback');
    for (const root of roots) assert.equal([...h.view.container.querySelectorAll('dt')].some(node => node.textContent === root), true);
    assert.equal([...h.view.container.querySelectorAll('a')].find(a => a.textContent === 'Download complete exact patch').getAttribute('href'), '/api/sessions/current/reviews/review?patch=1&download=1');
    await click(h.view, textButton(h.view.container, roots.length ? 'Keep resources' : 'Reject'));
    assert.equal(old.length, 0); assert.equal(current.length, 1); assert.equal(current[0][0] === updated, true);
    assert.deepEqual(current[0][1], { action: 'reject' });
    await unmount(); await join(start);
    if (roots.length) {
      const receipt = { version: 1, pluginId: 'git-workflow', sequence: 1, operationId,
        card: { ...request, actions: [] }, phase: 'succeeded', effectStarted: true, checks: [],
        authorization: { mode: 'ask', source: 'one-time artifacts (project allow)', revision: 'revision', decision: 'user-approved' } };
      for (let reload = 0; reload < 2; reload++) {
        await h.render(createElement(OperationReceiptCard, { receipt: JSON.parse(JSON.stringify(receipt)) }));
        await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
        assert.match(h.view.container.textContent, /Succeeded/);
        for (const root of roots) assert.equal([...h.view.container.querySelectorAll('dt')].some(node => node.textContent === root), true);
        for (const button of h.view.container.querySelectorAll('button')) assert.doesNotMatch(button.textContent, /Keep resources|Approve operation|Reject|Cancel/);
        await unmount();
      }
    }
  }

  // Finite ignored-abort case: both a default preload and an aggregate review
  // response already belong to the actual parent BEFORE observer unmount.
  {
    const start = h.work.length, callStart = highlighter.calls.length;
    const request = requestFor('held-preload', 'Held valid descendant'), responses = [];
    phase('held-preload:begin'); highlighter.hold();
    await mountReview(request, responses, currentObserver, true);
    const page = live('start'), aggregate = live('patch');
    // Supplied valid patch starts its real default preload while review reads wait.
    await render({ ...request, patch }, responses);
    const calls = highlighter.calls.slice(callStart); assertCaptured(calls);
    const handlers = calls.map(call => call.handler);
    let completed = 0;
    for (const work of handlers) void work.then(() => { completed++; });
    assert.equal(completed, 0);
    await unmount();
    assert.equal(page.signal.aborted, true); assert.equal(aggregate.signal.aborted, true);
    await body(page, { entries: [metadata, patchEntry], total: 2, next: null });
    await body(aggregate, patch); // ignored abort: no new parsed descendants
    assert.equal(highlighter.calls.length, callStart + calls.length);
    assert.equal(completed, 0, 'leaf response acknowledgement is NOT descendant settlement');
    release(); await join(start);
    phase('held-preload:end');
    assert.equal(completed, handlers.length); assert.equal(h.view.container.childNodes.length, 0);
    assert.equal(responses.length, 0);
  }

  // Paged selected-entry path reaches CommittedPatchDiff directly (not the small
  // aggregate stack), with its own exact preload observation forwarded upward.
  {
    const start = h.work.length, callStart = highlighter.calls.length;
    const request = { ...requestFor('paged', 'Paged valid descendant'), review: { ...review, bytes: 300000 } };
    phase('paged:begin'); highlighter.hold();
    await mountReview(request, [], currentObserver, true);
    const metadataFrom = h.requests.length;
    await body(live('start'), pageBody(true));
    const metadataBody = { text: 'Exact metadata', complete: true, offset: 0, next: null };
    const activeMetadata = await replayPair(h.requests.slice(metadataFrom), 'entry=0&offset=0', metadataBody);
    await body(activeMetadata, metadataBody);
    const patchFrom = h.requests.length;
    await click(h.view, h.view.container.querySelector('[aria-label="Next file"]'));
    const exactPatchBody = { text: patch, complete: true, offset: 0, next: null };
    const activePatch = await replayPair(h.requests.slice(patchFrom), 'entry=1&offset=0', exactPatchBody);
    await body(activePatch, exactPatchBody);
    const calls = highlighter.calls.slice(callStart); assertCaptured(calls);
    await unmount(); release(); await join(start); phase('paged:end');
  }

  // Successful default context publication is also joined through the parent,
  // not inferred from the external response body or from highlighted readiness.
  {
    const start = h.work.length;
    phase('context-success:begin');
    await mountReview(requestFor('context-success', 'Valid context descendant'), [], currentObserver, true); await fill(true);
    release(); await join(start);
    const from = h.work.length;
    await click(h.view, textButton(h.view.container, 'Before'));
    const read = h.requests.findLast(r => !r.signal.aborted && r.url.pathname.endsWith('/patch-context'));
    assert.equal(Boolean(read), true);
    assert.equal(h.work.length - from, 3);
    phase('context-success:body-and-owner:begin');
    await act(async () => { read.reply(context); await h.settle(from); });
    phase('context-success:body-and-owner:end');
    assert.equal(Boolean(h.view.container.querySelector('[aria-label="Before file"]')), true);
    assert.equal(h.view.container.querySelector('[role="alert"]') === null, true);
    await unmount(); await join(from); phase('context-success:end');
  }

  // Current observer owns complete context + action continuations, including the
  // existing catch/finally after ignored abort. No copied context controller.
  {
    const start = h.work.length;
    phase('context-abort:begin');
    await mountReview(requestFor('context', 'Context descendant'), [], currentObserver, true); await fill(true);
    release(); await join(start);
    const from = h.work.length, oldCount = oldRead.length;
    await click(h.view, textButton(h.view.container, 'Before'));
    const contextRead = h.requests.findLast(r => r.url.pathname.endsWith('/patch-context'));
    assert.equal(Boolean(contextRead), true);
    const admitted = h.work.slice(from).map(entry => entry.promise);
    assert.equal(admitted.length, 3, 'ensureContext, user action AND admitted queue finally-chain are parent-owned');
    const loaderFinally = admitted[2]; let loaderDone = false;
    void loaderFinally.then(() => { loaderDone = true; });
    for (const work of admitted) assert.equal(currentRead.includes(work), true);
    const count = h.requests.length;
    await render(requestFor('context', 'Current context descendant'), [], oldObserver);
    assert.equal(h.requests.length, count); assert.equal(oldRead.length, oldCount);
    await unmount(); assert.equal(contextRead.signal.aborted, true);
    // Aborting the public queue request can finish context/action handlers while
    // the REAL admitted fetch/slot-release finally remains held. Join it too.
    phase('context-abort:early-handlers:begin');
    const early = await Promise.allSettled(admitted.slice(0, 2));
    phase('context-abort:early-handlers:end');
    const rejected = early.filter(result => result.status === 'rejected');
    for (const result of rejected) h.expectFailure(result.reason);
    assert.equal(rejected.length, 1); assert.equal(rejected[0].reason.name, 'AbortError');
    assert.equal(loaderDone, false, 'context/action acknowledgement is NOT queue-finally settlement');
    phase('context-abort:body-and-finally:begin');
    await act(async () => { contextRead.reply(context); await loaderFinally; });
    phase('context-abort:body-and-finally:end');
    assert.equal(loaderDone, true);
    await join(from); assert.equal(h.view.container.childNodes.length, 0);
    phase('context-abort:end');
  }

  // Exact original desktop live-reader conjunction. Same physical realm and
  // existing review/opaque-context HTTP capability; no second Pierre/cache fake.
  {
    phase('reader-parent:begin');
    release();
    const pierre = await import('@pierre/diffs');
    const setups = [];
    const setup = pierre.CodeView.prototype.setup;
    t.mock.method(pierre.CodeView.prototype, 'setup', function (...args) {
      const value = setup.apply(this, args);
      setups.push({ instance: this, container: this.getContainerElement() });
      return value;
    });
    const width = 1280, requestStart = h.requests.length;
    const oldLines = Array.from({ length: 5000 }, (_, index) => `Plugin context ${index + 1}\n`);
    const newLines = [...oldLines];
    newLines[49] = `Plugin whole-file candidate reconnect-${width}\n`;
    newLines[4499] = `Plugin distant candidate reconnect-${width}\n`;
    const firstPatch = `diff --git a/draft.txt b/draft.txt\nindex 4824a54..d914290 100644\n--- a/draft.txt\n+++ b/draft.txt\n@@ -47,7 +47,7 @@\n Plugin context 47\n Plugin context 48\n Plugin context 49\n-Plugin context 50\n+Plugin whole-file candidate reconnect-${width}\n Plugin context 51\n Plugin context 52\n Plugin context 53\n@@ -4497,7 +4497,7 @@\n Plugin context 4497\n Plugin context 4498\n Plugin context 4499\n-Plugin context 4500\n+Plugin distant candidate reconnect-${width}\n Plugin context 4501\n Plugin context 4502\n Plugin context 4503\n`;
    // Only this second file's selected/unselected renderer and default context
    // state are transferred. Its native old bytes/hash remain installed proof.
    const secondPatch = `diff --git a/second-draft.txt b/second-draft.txt\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/second-draft.txt\n@@ -0,0 +1 @@\n+Second plugin candidate reconnect-${width}\n`;
    const supplied = firstPatch + secondPatch;
    // Controlled immutable body for this block, NOT native handle authority.
    const snapshot = {
      oldFile: { name: 'draft.txt', contents: oldLines.join(''), cacheKey: 'reader-immutable-before' },
      newFile: { name: 'draft.txt', contents: newLines.join(''), cacheKey: 'reader-immutable-proposed' },
    };
    const originalRequest = { ...requestFor('reconnect-parent', 'Git commit'), operationId,
      patchBefore: 'HEAD', patchAfter: 'Candidate',
      review: { ...review, entries: 3, bytes: Buffer.byteLength(supplied) + metadata.bytes },
      actions: [{ id: 'reject', label: 'Reject' }, { id: 'approve', label: 'Approve commit', primary: true }] };
    const serialized = JSON.stringify(originalRequest);
    const pageData = { entries: [metadata,
      { ...patchEntry, label: 'a/draft.txt b/draft.txt', bytes: Buffer.byteLength(firstPatch) },
      { ...patchEntry, id: 2, label: 'a/second-draft.txt b/second-draft.txt', bytes: Buffer.byteLength(secondPatch) }], total: 3, next: null };
    const first = () => h.view.container.querySelector('[aria-label="File changes: draft.txt"]');
    const control = name => first().querySelector(`[aria-label="${name}"]`);
    const namedFile = path => [...h.view.container.querySelectorAll('button')].find(button =>
      (button.getAttribute('aria-label') ?? button.textContent.trim()) === `Open diff: ${path}`);
    const contextReads = () => h.requests.slice(requestStart).filter(read => read.url.pathname === '/api/plugins/bundled/git-workflow/patch-context');
    const bindFrames = async () => {
      // Actual navigate schedules two nested frames; CodeView.scrollTo then
      // queues Pierre's render frame. Deliver that admitted renderer callback,
      // not a guessed idle loop or a clock/deadline advance.
      await h.frames.fire(h.frames.take());
      await h.frames.fire(h.frames.take());
      await h.frames.fire(h.frames.take());
    };
    const reader = () => {
      const container = first().querySelector('.git-diff-code-view');
      assert.equal(Boolean(container), true, 'actual parent selected CodeView exists');
      const record = setups.findLast(item => item.container === container);
      assert.equal(Boolean(record), true, 'actual public CodeView owns this selected renderer');
      const item = record.instance.getRenderedItems()[0];
      assert.equal(Boolean(item?.element.shadowRoot), true, 'actual Pierre shadow renderer, not raw fallback');
      return { ...record, item };
    };
    const expectLine = (number, text) => {
      const current = reader(), root = current.item.element.shadowRoot;
      const targets = [...root.querySelectorAll(`[data-line="${number}"]`)];
      const row = targets.find(element => element.textContent.trimEnd() === text);
      if (!row) {
        const lines = [...root.querySelectorAll('[data-line]')];
        const describe = rows => rows.map(element => [element.getAttribute('data-line'), element.textContent.slice(0, 100)]);
        phase(`reader-row-mismatch:${JSON.stringify({ number, text, targets: describe(targets),
          head: describe(lines.slice(0, 3)), tail: describe(lines.slice(-3)),
          scrollTop: current.container.scrollTop, clientHeight: current.container.clientHeight,
          queuedFrames: h.frames.take() })}`);
      }
      assert.equal(Boolean(row), true, `actual selected renderer line ${number}`);
    };
    const jump = async (number, text) => {
      const from = h.work.length;
      await input(h.view, control('Line number'), String(number));
      await click(h.view, textButton(first(), 'Go to line'));
      release(); await join(from); await bindFrames();
      expectLine(number, text);
    };
    const mountInline = async (request, respond) => {
      const from = h.requests.length, workFrom = h.work.length;
      await render(request, respond);
      const reads = h.requests.slice(from);
      assert.equal(reads.length, 4, 'same original inline StrictMode page/patch replay');
      const page = await replayPair([reads[0], reads[2]], 'start=0', pageData);
      const patchRead = await replayPair([reads[1], reads[3]], 'patch=1', supplied);
      await body(page, pageData); await body(patchRead, supplied);
      release(); await join(workFrom); await bindFrames();
      assert.equal(Boolean(first()), true);
    };
    const showFull = async (transport = true) => {
      const from = h.work.length, count = contextReads().length;
      await click(h.view, textButton(first(), 'Show full file'));
      assert.equal(contextReads().length, count + Number(transport));
      if (transport) {
        const read = contextReads().at(-1);
        assert.equal(read.url.href, 'https://fixture.invalid/api/plugins/bundled/git-workflow/patch-context?handle=captured-context&file=0');
        await body(read, snapshot);
        assert.equal(read.bodyCalls, 1);
      }
      release(); await join(from); await bindFrames();
    };
    const start = h.work.length, responses = [];
    await mountInline(originalRequest, responses);
    await click(h.view, textButton(h.view.container, 'Side by side'));
    assert.equal(contextReads().length, 0, 'parent patch/read controls never eagerly load context');
    await showFull();
    await jump(2500, 'Plugin context 2500');
    await click(h.view, textButton(first(), 'Diff context'));
    await click(h.view, textButton(h.view.container, 'Unified'));
    await showFull(false); // real parent cache, no second transport read
    await jump(2500, 'Plugin context 2500');
    await click(h.view, textButton(first(), 'Before')); release(); await join(start); await bindFrames();
    await jump(50, 'Plugin context 50'); await jump(4500, 'Plugin context 4500');
    await click(h.view, textButton(first(), 'After')); release(); await join(start); await bindFrames();
    await jump(50, 'Plugin whole-file candidate reconnect-1280');
    await jump(4500, 'Plugin distant candidate reconnect-1280');
    await input(h.view, control('Search full file'), 'plugin context 2500');
    await click(h.view, control('Next match')); release(); await join(start); await bindFrames();
    expectLine(2500, 'Plugin context 2500');
    assert.equal(first().textContent.includes('1/1 matches'), true);
    // Browser scrollTo notifies scroll listeners after rendering. The fixture's
    // jsdom shim only assigns scrollTop; deliver that real DOM notification so
    // the actual parent records its own numeric anchor before renderer unmount.
    await h.view.dispatch(reader().container, new h.view.window.Event('scroll'));
    await bindFrames();
    const oldRenderer = reader().instance;
    await click(h.view, namedFile('second-draft.txt'));
    release(); await join(start); await bindFrames();
    assert.equal(first() === null, true, 'selecting second file actually unmounts first renderer');
    await click(h.view, h.view.container.querySelector('[aria-label="Previous file"]'));
    release(); await join(start); await bindFrames();
    assert.equal(reader().instance !== oldRenderer, true, 'actual renderer was recreated, not hidden or copied');
    assert.equal(textButton(first(), 'After').getAttribute('aria-pressed'), 'true');
    assert.equal(control('Search full file').value, 'plugin context 2500');
    expectLine(2500, 'Plugin context 2500');
    assert.equal(contextReads().length, 1, 'parent retains the requested immutable context across renderer unmount');
    await click(h.view, textButton(first(), 'Changes')); release(); await join(start); await bindFrames();
    assert.equal(textButton(first(), 'Diff context').getAttribute('aria-pressed'), 'true');
    await click(h.view, h.view.container.querySelector('[aria-label="Next file"]'));
    release(); await join(start); await bindFrames();
    const second = h.view.container.querySelector('[aria-label="File changes: second-draft.txt"]');
    assert.equal(Boolean(second), true);
    assert.equal(textButton(second, 'Show full file').getAttribute('aria-pressed'), 'false', 'per-file full state cannot leak');
    await click(h.view, namedFile('draft.txt'));
    release(); await join(start); await bindFrames();
    assert.equal(Boolean(first().querySelector('[aria-label="Unified diff"]')), true);
    await click(h.view, h.view.container.querySelector('[aria-label="Collapse"]'));
    await click(h.view, h.view.container.querySelector('.blocking-card-collapsed'));
    release(); await join(start); await bindFrames();
    assert.equal(Boolean(first().querySelector('[aria-label="Unified diff"]')), true);
    assert.equal(contextReads().length, 1, 'card collapse cannot admit another snapshot read');
    await click(h.view, textButton(first(), 'Before')); release(); await join(start); await bindFrames();
    await jump(50, 'Plugin context 50');
    await click(h.view, textButton(first(), 'After')); release(); await join(start); await bindFrames();
    assert.equal(control('Search full file').value, 'plugin context 2500');
    assert.equal(contextReads().length, 1, 'real collapse/reopen retains full context, not only a partial patch');
    assert.equal(responses.length, 0, 'all parent reading controls are display-only');

    // Real whole-parent unmount, followed by the same serialized request/source.
    // This is component reload wiring; installed document/history reload stays.
    await unmount(); release(); await join(start);
    const restored = JSON.parse(serialized);
    assert.deepEqual(restored, originalRequest);
    await mountInline(restored, responses);
    assert.equal(contextReads().length, 1, 'fresh parent remains lazy, not prehydrated');
    await click(h.view, textButton(h.view.container, 'Side by side'));
    await showFull();
    await click(h.view, textButton(first(), 'Before')); release(); await join(start); await bindFrames();
    await jump(50, 'Plugin context 50');
    await click(h.view, textButton(first(), 'After')); release(); await join(start); await bindFrames();
    await jump(50, 'Plugin whole-file candidate reconnect-1280');
    assert.equal(contextReads().length, 2);
    assert.equal(contextReads()[1].url.href, contextReads()[0].url.href, 'opaque source survives serialized remount');

    await unmount(); release(); await join(start);
    const expiredRequest = JSON.parse(serialized);
    await mountInline(expiredRequest, responses);
    await click(h.view, textButton(h.view.container, 'Side by side'));
    const expiredBody = { error: 'This context snapshot has expired or the server restarted; the saved patch remains available.' };
    const from = h.work.length;
    await click(h.view, textButton(first(), 'Show full file'));
    const expired = contextReads().at(-1);
    assert.equal(expired.url.href, contextReads()[0].url.href);
    await act(async () => { expired.reply(expiredBody, { status: 409 }); });
    release(); await join(from); await bindFrames();
    assert.equal(expired.bodyCalls, 1);
    assert.equal(expired.status, 409);
    const rejected = h.work.slice(from).filter(entry => entry.error);
    assert.equal(rejected.length > 0, true, 'original context rejection remains independently owned');
    const originalError = rejected[0].error;
    assert.equal(originalError.message, expiredBody.error);
    for (const entry of rejected) {
      assert.equal(entry.error, originalError, 'context/action/finally preserve SAME original error');
      h.expectFailure(entry.error); // ONLY this exact expected 409 cause after full join
    }
    assert.equal(first().querySelector('[role="alert"]').textContent.includes(expiredBody.error), true);
    assert.equal(Boolean(first().querySelector('[aria-label="Side-by-side diff"]')), true);
    await click(h.view, textButton(h.view.container, 'Raw patch'));
    assert.equal(first().querySelector('[aria-label="Raw patch"]').textContent, firstPatch);
    assert.equal(contextReads().length, 3, 'expired opaque context never automatically retries');
    assert.equal(responses.length, 0, 'error/raw fallback is not authority to answer');
    const current = { ...expiredRequest, title: 'Git commit current' }, currentResponses = [];
    await render(current, currentResponses);
    assert.equal(contextReads().length, 3, 'current callback swap cannot restart accepted work');
    await click(h.view, textButton(h.view.container, 'Approve commit'));
    assert.equal(responses.length, 0);
    assert.equal(currentResponses.length, 1);
    assert.equal(currentResponses[0][0] === current, true, 'actual response uses current original request, never serialized stale object');
    assert.deepEqual(currentResponses[0][1], { action: 'approve' });
    await unmount(); release(); await join(start);
    phase('reader-parent:end');
  }
  phase('cleanup:begin');
  await h.cleanup(); // releases and full joins; realm restores BEFORE central, host AFTER
  phase('cleanup:end');
});
