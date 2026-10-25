import '../lib/testing/client-native-boundary.fixture.mjs';
// FIRST DIAGNOSTIC REMEDY, UNEXECUTED. Actual default/hook/same-fiber view.
// Header-held loading is the spinner; the real viewport mounts only at ready.
// Inherited ordinary-session control-key collision remains an unsuppressed hold.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionFixture, detail } from '../hooks/agent-session-mounted.fixture.mjs';
const user = text => ({ role: 'user', content: text, timestamp: 1 });
const restore = { atBottom: false, anchorEntryId: 'entry-5', anchorOffset: 37, oldestEntryId: 'saved-boundary' };
function props(f, extra = {}) {
  return { session: { id: f.savedId, cwd: f.cwd, messageCount: 8, firstMessage: '', path: '', created: '', modified: '' },
    newSessionCwd: null, newSessionDraftKey: null, soundEnabled: false, ...extra };
}
async function pending(t, extra = {}) {
  const f = await sessionFixture(t, { defaultChat: true });
  const row = f.record(f.savedId); row.leaf = 'current-leaf';
  row.messages = Array.from({ length: 8 }, (_, i) => user(`history ${i}`));
  row.entryIds = row.messages.map((_, i) => `entry-${i}`);
  // Withhold BOTH Strict incarnations' headers. A body-only gate permits a
  // superseded first read's existing finally to clear loading prematurely.
  const history = f.hold(detail, { stage: 'headers', repeat: true });
  const options = props(f, typeof extra === 'function' ? extra(f) : extra);
  assert.equal(new Set(row.entryIds).size, 8, 'literal transcript IDs are distinct from session identity');
  await f.mount(options); await history.entered.promise;
  assert.equal(f.mountedOptions, options, 'genuine public ChatWindow props, not Probe options');
  assert.equal(f.mountedOptions.initialScrollPosition, options.initialScrollPosition);
  assert.equal(history.done, false);
  assert.equal(f.defaultViewport, null, 'real loading default returns its spinner, not a hidden controlled viewport');
  assert.equal(f.view.container.textContent, 'Loading session...');
  // Real selected SSE readiness is admitted before any full-owner join, never
  // manufactured by the observer or a magic idle boundary.
  await f.connect(source(f));
  assert.equal(f.defaultOwners.size, 1, 'Strict replay republishes the same actual owner pair');
  for (const request of f.requests.filter(detail)) {
    assert.equal(request.path, `/api/sessions/${f.savedId}`);
    assert.deepEqual([...request.query].sort(), Object.entries({ deferThinking: '1', deferMedia: '1', tree: 'summary', force: '1' }).sort());
  }
  assert.equal(history.done, false, 'all matching history responses remain header-held');
  assert.equal(f.defaultViewport, null, 'connected receipt read must not replace loading history');
  assert.equal(f.view.container.textContent, 'Loading session...');
  assert.deepEqual(f.scrollCalls, [], 'no transcript/viewport admitted before history headers');
  return { f, history, options };
}
const source = f => f.sources.findLast(item => item.readyState !== 2);
const context = request => request.path.endsWith('/context') && request.query.has('before');
function page(f, { hasMore = true, cursor = 'server-cursor' } = {}) {
  const snapshot = f.snapshot(f.savedId);
  return { ...snapshot, context: { ...snapshot.context, hasMore, oldestEntryId: cursor } };
}
function exactContext(request, f, { tail, signal = true } = {}) {
  assert.equal(request.path, `/api/sessions/${f.savedId}/context`);
  assert.deepEqual([...request.query].sort(), Object.entries({ deferThinking: '1', deferMedia: '1',
    leafId: 'current-leaf', before: 'server-cursor', ...(tail ? { tail: String(tail) } : {}) }).sort());
  assert.equal(Boolean(request.signal), signal);
}

test('PARTIAL default Strict saved loading -> committed ready: legitimate auto precedes final saved offset/visibility and cleanup anchor', async t => {
  const positions = [];
  const { f, history } = await pending(t, { initialScrollPosition: restore,
    onScrollPositionChange: (sid, value) => positions.push([sid, value]) });
  await f.deliver(history, page(f)); await f.settleDefault();
  const viewport = f.defaultViewport; assert.ok(viewport);
  assert.deepEqual(f.scrollCalls, [{ top: 2000, behavior: 'auto' }, { top: 463, behavior: 'instant' }],
    'defer skips initial INSTANT, not attached AUTO; later same-fiber restore owns final placement');
  assert.equal(viewport.scrollTop, 463); assert.equal(viewport.style.visibility, '');
  const anchor = viewport.querySelector('[data-entry-id="entry-5"]'); assert.ok(anchor);
  assert.equal(anchor.getBoundingClientRect().top - viewport.getBoundingClientRect().top, 37);
  await f.unmount(); await f.settleDefault();
  assert.deepEqual(positions.at(-1), [f.savedId, { atBottom: false, anchorEntryId: 'entry-4', anchorOffset: -63, oldestEntryId: 'server-cursor' }]);
});

test('PARTIAL default missing saved anchor forwards real leaf/cursor/signal, sentinel waits, unmount aborts held full body', async t => {
  const { f, history } = await pending(t, { initialScrollPosition: { ...restore, anchorEntryId: 'missing' } });
  const older = f.hold(context);
  await f.deliver(history, page(f)); await older.entered.promise;
  const viewport = f.defaultViewport; assert.ok(viewport);
  exactContext(older.request, f);
  assert.equal(older.request.signal.aborted, false); assert.equal(viewport.style.visibility, 'hidden');
  const count = f.requests.filter(context).length; await f.intersect();
  assert.equal(f.requests.filter(context).length, count, 'real view restoration owns pagination');
  assert.equal(f.viewWorks.some(entry => entry.name === 'saved-locate'), true);
  const scrollCount = f.scrollCalls.length;
  // Release the exact late body before starting unmount in the same turn;
  // continuation delivery is still after real cleanup/abort, not before it.
  await f.unmount(() => older.resolve({ context: { messages: [user('retired body')], entryIds: ['missing'], oldestEntryId: 'saved-boundary', hasMore: false } }));
  assert.equal(older.request.signal.aborted, true);
  await f.settleDefault();
  assert.equal(f.scrollCalls.length, scrollCount, 'late aborted body cannot restore retired viewport');
});

test('PARTIAL default search overrides saved restore and forwards exact tail200; committed target is revealed', async t => {
  const handled = [], target = { sessionId: '', entryId: 'search-hit' };
  const { f, history } = await pending(t, f => {
    target.sessionId = f.savedId;
    return { initialScrollPosition: restore, searchTarget: target, onSearchTargetHandled: value => handled.push(value) };
  });
  const older = f.hold(context);
  await f.deliver(history, page(f)); await older.entered.promise;
  const viewport = f.defaultViewport; assert.ok(viewport);
  assert.equal(viewport.style.visibility, '', 'initial search suppresses saved restoration');
  exactContext(older.request, f, { tail: 200 });
  await f.deliver(older, { context: { messages: [user('actual search hit')], entryIds: ['search-hit'], oldestEntryId: 'search-hit', hasMore: false } });
  await f.settleDefault();
  assert.equal(f.viewWorks.some(entry => entry.name === 'search-locate'), true);
  assert.ok(viewport.querySelector('[data-entry-id="search-hit"]'));
  assert.equal(viewport.scrollTop, 0); assert.equal(viewport.style.visibility, '');
  assert.deepEqual(handled, [target]);
  await f.unmount(); await f.settleDefault(); assert.equal(older.request.signal.aborted, true);
});

test('PARTIAL default sentinel prepend uses server cursor and committed distance, not a visible entry ID', async t => {
  const { f, history } = await pending(t, { initialScrollPosition: restore });
  await f.deliver(history, page(f));
  const viewport = f.defaultViewport; assert.ok(viewport);
  const older = f.hold(context); await f.intersect(); await older.entered.promise;
  exactContext(older.request, f, { signal: false });
  await f.intersect(); assert.equal(f.requests.filter(context).length, 1);
  f.numeric.height = 2400;
  await f.deliver(older, { context: { messages: [user('older actual row')], entryIds: ['earlier'], oldestEntryId: 'earlier', hasMore: false } });
  await f.settleDefault();
  assert.equal(f.viewWorks.some(entry => entry.name === 'history-prepend'), true);
  assert.ok(viewport.querySelector('[data-entry-id="earlier"]'));
  assert.equal(viewport.scrollTop, 863, '2400 minus captured (2000 - 463), after real prepend commits');
});

test('PARTIAL default real SSE reaches StreamingReply commit while saved viewport stays detached; actual scroll reattaches later follow', async t => {
  const { f, history } = await pending(t, { initialScrollPosition: restore });
  await f.deliver(history, page(f, { hasMore: false })); await f.settleDefault();
  const viewport = f.defaultViewport; assert.ok(viewport);
  const witness = f.watchFrames(), before = f.scrollCalls.length;
  await f.event(source(f), { type: 'agent_start' });
  await f.event(source(f), { type: 'message_start', message: { role: 'assistant', content: [{ type: 'text', text: 'actual streamed answer' }], timestamp: 2 } });
  await f.settleDefault();
  assert.equal(viewport.textContent.includes('actual streamed answer'), true);
  assert.equal(viewport.scrollTop, 463); assert.equal(f.scrollCalls.length, before);
  await f.run('actual viewport tail scroll', () => {
    viewport.scrollTop = f.numeric.height - f.numeric.client;
    viewport.dispatchEvent(new f.view.window.Event('scroll'));
  });
  f.numeric.height = 2600;
  await f.event(source(f), { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: ' committed delta' } });
  await f.settleDefault();
  assert.equal(viewport.textContent.includes('actual streamed answer committed delta'), true);
  assert.equal(viewport.scrollTop, 2000);
  assert.equal(f.scrollCalls.some(call => call.top === 2600 && call.behavior === 'auto'), true);
  await f.unmount(); await f.settleDefault();
  await f.run('join precisely observed native frame handles', () => Promise.all(witness.frames.map(frame => frame.promise)));
  // Attached AUTO may also come from the native SSE frame. This finite test
  // does not claim exclusive onCommit attribution or browser physical movement.
});

// SOURCE-ONLY P4/P5 additions. The five original cases above are unchanged.
// These use the existing actual default owner, not the controlled view fixture.
for (const name of ['bash', 'powershell']) test(`default P4 ${name}: exact SSE call progress/reorder and current result reach StreamingReply, then end removes the result`, async t => {
  const { f, history } = await pending(t, { initialScrollPosition: restore });
  await f.deliver(history, page(f, { hasMore: false })); await f.settleDefault();
  const viewport = f.defaultViewport; assert.ok(viewport);
  const phase = () => viewport.querySelector('[class*="pulse_1.5s"]')?.textContent ?? '';
  const row = id => viewport.querySelector(`[data-tool-call-id="${id}"]`);
  await f.event(source(f), { type: 'agent_start' });
  // Use SC's admitted execution-event sequence before the next assistant
  // snapshot: the actual default phase is visible only without stream content.
  await f.event(source(f), { type: 'tool_execution_start', toolCallId: 'other', toolName: 'read' });
  await f.event(source(f), { type: 'tool_execution_start', toolCallId: 'call/1', toolName: name });
  const content = [{ type: 'text', text: 'earlier\nlatest   progress\n' }];
  await f.event(source(f), { type: 'tool_execution_update', toolCallId: 'call/1', toolName: name,
    partialResult: { content, isError: false, details: { owner: 'call/1' } } });
  await f.settleDefault();
  assert.equal(phase().includes('latest progress'), true);
  await f.event(source(f), { type: 'tool_execution_update', toolCallId: 'other', toolName: 'read',
    partialResult: { content: [{ type: 'text', text: 'newest read' }] } });
  await f.settleDefault();
  assert.equal(phase().includes('newest read'), true);
  assert.equal(phase().includes('latest progress'), false, 'most recently updated tool, not last started tool');
  await f.event(source(f), { type: 'tool_execution_update', parentToolCallId: 'parent', toolCallId: 'nested', toolName: name,
    partialResult: { content } });
  await f.settleDefault();
  assert.equal(phase().includes('newest read'), true);
  // A genuine public snapshot now enables StreamingReply. It does not clear
  // activeToolResults, so the earlier real shell partial must join by exact ID.
  await f.event(source(f), { type: 'message_start', message: { role: 'assistant', timestamp: 2, content: [
    { type: 'text', text: 'keep' },
    { type: 'toolCall', id: 'call/1', name, arguments: { command: 'echo scoped' } },
    { type: 'toolCall', id: 'other', name: 'read', arguments: { path: 'other' } },
    { type: 'toolCall', id: 'stale-id', name, arguments: { command: 'echo stale' } },
    { type: 'toolCall', id: 'nested', name, arguments: { command: 'echo nested' } },
  ] } });
  await f.settleDefault();
  assert.equal(phase(), '', 'content-bearing snapshot switches the default from phase to StreamingReply');
  assert.ok(row('call/1')); assert.ok(row('other')); assert.ok(row('stale-id')); assert.ok(row('nested'));
  const expand = row('call/1').querySelector('button[aria-expanded]'); assert.ok(expand);
  if (expand.getAttribute('aria-expanded') === 'false') {
    await f.run('actual streamed tool details click', () => expand.dispatchEvent(new f.view.window.MouseEvent('click', { bubbles: true })));
  }
  await f.settleDefault();
  assert.equal(row('call/1').textContent.includes('earlier'), true);
  assert.equal(row('call/1').textContent.includes('latest   progress'), true);
  const normalBackground = row('call/1').style.backgroundColor;
  for (const id of ['other', 'stale-id', 'nested']) {
    assert.equal(row(id).textContent.includes('earlier'), false, `${id} must not receive call/1 output`);
  }
  assert.equal(row('other').textContent.includes('newest read'), false, 'read progress is not an active shell result');
  assert.equal(row('nested').textContent.includes('earlier'), false, 'nested events cannot replace root results');
  await f.event(source(f), { type: 'tool_execution_update', toolCallId: 'call/1', toolName: name,
    partialResult: { content: [{ type: 'text', text: 'live partial output' }], isError: true, details: { owner: 'call/1' } } });
  await f.settleDefault();
  assert.equal(phase(), '', 'streaming content keeps the updated tool phase hidden');
  assert.equal(phase().includes('newest read'), false);
  assert.equal(row('call/1').textContent.includes('live partial output'), true);
  assert.equal(row('call/1').textContent.includes('earlier'), false, 'current partial replaces the old content');
  assert.notEqual(row('call/1').style.backgroundColor, normalBackground);
  assert.match(row('call/1').style.backgroundColor, /248,\s*113,\s*113/, 'actual tool error presentation');
  for (const id of ['other', 'stale-id', 'nested']) {
    assert.equal(row(id).textContent.includes('live partial output'), false, `${id} must not inherit the current result`);
    assert.equal(row(id).style.backgroundColor, normalBackground);
  }
  await f.event(source(f), { type: 'tool_execution_end', toolCallId: 'call/1' });
  await f.settleDefault();
  assert.ok(row('call/1'), 'streamed tool call remains while its active result is deleted');
  assert.equal(row('call/1').textContent.includes('live partial output'), false);
  assert.equal(row('call/1').textContent.includes('earlier'), false);
  assert.equal(row('call/1').style.backgroundColor, normalBackground);
  assert.equal(phase(), '', 'tool end does not reveal a separate phase beside streaming content');
  assert.equal(phase().includes('live partial output'), false);
  // Same baseline assistant-update contract as SC: extraneous outer metadata
  // does not veto the actual assistant payload. No outer-role policy change.
  await f.event(source(f), { type: 'message_update', message: { role: 'system', content: 'private schemas' },
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'forbidden' } });
  await f.settleDefault();
  assert.equal(viewport.textContent.includes('keepforbidden'), true);
  await f.unmount(); await f.settleDefault();
  // settleDefault joins the real hook/view/input/HTTP bodies and observed native
  // frames. Numeric geometry is not native scrolling or exclusive onCommit proof.
  // Shell details.owner is opaque in this UI; SC owns its exact map equality.
});

test('default P5 missing e4920: saved oldestEntryId stops restoration with hasMore true, without another page', async t => {
  const positions = [];
  const { f, history } = await pending(t, { initialScrollPosition: { ...restore, anchorEntryId: 'e4920' },
    onScrollPositionChange: (sid, value) => positions.push([sid, value]) });
  const older = f.hold(context);
  await f.deliver(history, page(f)); await older.entered.promise;
  const viewport = f.defaultViewport; assert.ok(viewport);
  exactContext(older.request, f);
  assert.equal(older.request.signal.aborted, false);
  assert.equal(viewport.style.visibility, 'hidden');
  await f.intersect(); assert.equal(f.requests.filter(context).length, 1, 'pending restore owns pagination');
  await f.deliver(older, { context: { messages: [user('boundary page without the saved anchor')], entryIds: ['earlier'],
    oldestEntryId: 'saved-boundary', hasMore: true } });
  await f.settleDefault();
  assert.equal(f.viewWorks.some(entry => entry.name === 'saved-locate'), true);
  assert.deepEqual(f.requests.filter(context).map(request => request.query.get('before')), ['server-cursor']);
  assert.equal(viewport.querySelector('[data-entry-id="e4920"]') === null, true);
  assert.ok(viewport.querySelector('[data-entry-id="earlier"]'));
  assert.equal(viewport.scrollTop, f.numeric.height - f.numeric.client);
  assert.equal(f.scrollCalls.some(call => call.behavior === 'instant' && call.top === f.numeric.height), true);
  assert.equal(viewport.style.visibility, '');
  assert.equal(older.request.signal.aborted, true, 'pending restore cleared and its real effect cleaned up');
  // Do not deliver another sentinel intersection here: after clearing pending,
  // hasMore=true legitimately permits a separate later history-prepend action.
  await f.unmount(); await f.settleDefault();
  assert.deepEqual(positions.at(-1), [f.savedId, { atBottom: true }], 'cleared pending permits the real cleanup publication');
});

test('default P5 missing e4920: real loadContext continues to hasMore false exhaustion, then reveals the tail', async t => {
  const positions = [];
  const { f, history } = await pending(t, { initialScrollPosition: { ...restore, anchorEntryId: 'e4920' },
    onScrollPositionChange: (sid, value) => positions.push([sid, value]) });
  const first = f.hold(context);
  const last = f.hold(request => context(request) && request.query.get('before') === 'older-cursor');
  await f.deliver(history, page(f)); await first.entered.promise;
  const viewport = f.defaultViewport; assert.ok(viewport);
  exactContext(first.request, f);
  assert.equal(first.request.signal.aborted, false);
  assert.equal(viewport.style.visibility, 'hidden');
  await f.deliver(first, { context: { messages: [user('first earlier page')], entryIds: ['earlier-first'],
    oldestEntryId: 'older-cursor', hasMore: true } });
  await last.entered.promise;
  assert.equal(last.request.path, `/api/sessions/${f.savedId}/context`);
  assert.deepEqual([...last.request.query].sort(), Object.entries({ deferThinking: '1', deferMedia: '1',
    leafId: 'current-leaf', before: 'older-cursor' }).sort());
  assert.equal(last.request.signal === first.request.signal, true, 'one real restoration request lifetime');
  assert.equal(last.request.signal.aborted, false);
  assert.equal(viewport.style.visibility, 'hidden', 'no early tail fallback while another page is available');
  await f.intersect(); assert.equal(f.requests.filter(context).length, 2);
  await f.deliver(last, { context: { messages: [user('last earlier page')], entryIds: ['earlier-last'],
    oldestEntryId: 'exhausted-boundary', hasMore: false } });
  await f.settleDefault();
  assert.deepEqual(f.requests.filter(context).map(request => request.query.get('before')), ['server-cursor', 'older-cursor']);
  assert.ok(viewport.querySelector('[data-entry-id="earlier-first"]'));
  assert.ok(viewport.querySelector('[data-entry-id="earlier-last"]'));
  assert.equal(viewport.querySelector('[data-entry-id="e4920"]') === null, true);
  assert.equal(viewport.scrollTop, f.numeric.height - f.numeric.client);
  assert.equal(f.scrollCalls.some(call => call.behavior === 'instant' && call.top === f.numeric.height), true);
  assert.equal(viewport.style.visibility, '');
  assert.equal(last.request.signal.aborted, true, 'terminal fallback clears pending restoration');
  await f.intersect(); await f.settleDefault();
  assert.equal(f.requests.filter(context).length, 2, 'exhausted history does not admit a sentinel page either');
  await f.unmount(); await f.settleDefault();
  assert.deepEqual(positions.at(-1), [f.savedId, { atBottom: true }]);
});

test('default P5 current unaborted context body failure: actual catch/finally returns undefined and the falsey-context fallback reveals the tail', async t => {
  const positions = [];
  const { f, history } = await pending(t, { initialScrollPosition: { ...restore, anchorEntryId: 'e4920' },
    onScrollPositionChange: (sid, value) => positions.push([sid, value]) });
  const older = f.hold(context);
  const failure = new SyntaxError('current context body decode failed');
  f.expectConsoleError('Failed to load context:', error => error === failure);
  await f.deliver(history, page(f)); await older.entered.promise;
  const viewport = f.defaultViewport; assert.ok(viewport);
  exactContext(older.request, f);
  assert.equal(older.request.signal.aborted, false);
  assert.equal(viewport.style.visibility, 'hidden');
  // Reject only the original admitted Response.json() capability. Neither the
  // hook callback nor its return value is replaced. All peers remain owned by
  // the existing release-before-join failure/setup cleanup.
  await f.run('release current original context body rejection', () => older.reject(failure));
  await f.settleDefault();
  assert.equal(f.viewWorks.some(entry => entry.name === 'saved-locate'), true);
  assert.deepEqual(f.requests.filter(context).map(request => request.query.get('before')), ['server-cursor']);
  assert.equal(f.consoleEvents.filter(event => event.level === 'error' && event.args[0] === 'Failed to load context:').length, 1);
  assert.equal(viewport.querySelector('[data-entry-id="e4920"]') === null, true);
  assert.equal(viewport.scrollTop, f.numeric.height - f.numeric.client);
  assert.equal(f.scrollCalls.some(call => call.behavior === 'instant' && call.top === f.numeric.height), true);
  assert.equal(viewport.style.visibility, '');
  assert.equal(older.request.signal.aborted, true, 'aborted only by cleanup after the current failure fallback');
  await f.unmount(); await f.settleDefault();
  assert.deepEqual(positions.at(-1), [f.savedId, { atBottom: true }]);
  // Literal null is NOT claimed: loadContext's actual catch/guards fall through
  // with undefined. See REPORT.md for the exact selected-scope null gap.
});
import { deferred as toolDeferred } from '../lib/testing/async.fixture.mjs';
import { join as toolJoin } from 'node:path';

// Fixed original seed-data expectation; no runtime parser/stringifier replica.
const toolFlatExpectedJson = "{\n  \"query\": \"<img data-e2e-tool-xss src=x onerror=\\\"window.__toolArgXss=1\\\">[unsafe](javascript:alert(1))\",\n  \"enabled\": false,\n  \"count\": 0,\n  \"nullable\": null,\n  \"empty\": \"\",\n  \"E2E_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_very_long_label_\": \"E2E argument line 0: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 1: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 2: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 3: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 4: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 5: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 6: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 7: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 8: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 9: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 10: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 11: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 12: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 13: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 14: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 15: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 16: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 17: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 18: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 19: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 20: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 21: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 22: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 23: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 24: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 25: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 26: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 27: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 28: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 29: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 30: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 31: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 32: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 33: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 34: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 35: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 36: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 37: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 38: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 39: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 40: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 41: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 42: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 43: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 44: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 45: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 46: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 47: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 48: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 49: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 50: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 51: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 52: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 53: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 54: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 55: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 56: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 57: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 58: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\\nE2E argument line 59: long_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_valuelong_unbroken_value\",\n  \"<img data-e2e-tool-xss src=x onerror=\\\"window.__toolArgXss=1\\\">[unsafe](javascript:alert(1))\": \"Malicious label remains data\"\n}";

// ONE full H-TOOL case in the existing ACTUAL default owner. No direct store
// publication, copied event handler, synthetic hook return or final snapshot.
test('default H-TOOL: actual SSE partial/current Copy work and canonical input commit to the original readable stored entry', async t => {
  const failures = [], registered = [], originals = new Map(), clipboardQueue = [], clipboardCalls = [], clipboardReturns = [];
  const firstEvents = [], currentEvents = [], callerOwners = [], callerStarts = [];
  const refusal = new Error('Expected clipboard refusal');
  let f, finishing = false, admissionClosed = false, heldCopyExit;
  const attempt = async callback => { try { await callback(); } catch (error) { failures.push(error); } };
  const own = (label, promise, expectedRejection = null) => {
    if (originals.has(promise)) return originals.get(promise);
    const record = { label, promise, outcome: 'pending', value: undefined, error: undefined };
    originals.set(promise, record);
    record.observation = promise.then(value => { record.outcome = 'fulfilled'; record.value = value; }, error => {
      record.outcome = 'rejected'; record.error = error;
      if (!expectedRejection || error !== expectedRejection.error) failures.push(error); // SAME unknown/error object stays fatal.
    });
    return record;
  };
  const releaseClipboardPeers = () => {
    const errors = [];
    for (const entry of clipboardCalls) {
      try {
        if (entry.expectedRejection) entry.gate.reject(entry.expectedRejection.error);
        else entry.gate.resolve(undefined);
        entry.released = true; // Release acknowledgement only, never handler settlement.
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Independent accepted clipboard releases failed');
  };
  const joinOriginals = async () => {
    let joined = 0;
    while (joined < originals.size) {
      const batch = [...originals.values()].slice(joined); joined += batch.length;
      await Promise.allSettled(batch.map(record => record.promise));
      await Promise.allSettled(batch.map(record => record.observation)); // ACK bookkeeping is not original work.
    }
  };
  const hostRejection = error => failures.push(error), hostException = error => failures.push(error);
  const finish = async () => {
    if (finishing) return;
    finishing = true; admissionClosed = true;
    // Release ALL accepted external Clipboard peers before ANY join. The first
    // existing fixture hook releases all HTTP/body/readiness peers synchronously
    // before its independent default hook/view/input/frame/transport joins.
    try { releaseClipboardPeers(); } catch (error) { failures.push(error); }
    for (const hook of registered) await attempt(hook);
    await attempt(joinOriginals); // Still attempted if support/React/cleanup failed.
    await attempt(() => process.off('unhandledRejection', hostRejection));
    await attempt(() => process.off('uncaughtExceptionMonitor', hostException));
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Actual default H-TOOL case and independent cleanup failed');
  };
  t.after(finish); // Before fixture construction/import/capabilities.
  process.on('unhandledRejection', hostRejection);
  process.on('uncaughtExceptionMonitor', hostException);
  try {
    // Explicit controlled caller root, not the installed harness's random native
    // directory. Preserve its actual formula/coupling; keep the dynamic installed
    // agentDir -> project -> public session/copy path binding in the native bridge.
    const agentDir = '/synthetic/default-tool-owner';
    const project = toolJoin(agentDir, 'project');
    const clipboard = { writeText(...args) {
      if (admissionClosed || !clipboardQueue.length) {
        const error = new Error('Unexpected per-instance clipboard admission'); failures.push(error); throw error;
      }
      const entry = clipboardQueue.shift();
      entry.receiver = this; entry.args = args; entry.original = entry.gate.promise;
      clipboardCalls.push(entry);
      own('original controlled Clipboard API promise', entry.original, entry.expectedRejection);
      return entry.original;
    } };
    const delegate = clipboard.writeText;
    clipboard.writeText = function(...args) {
      // Observe this instance's actual capability, preserving receiver/args and
      // EXACT original return. This is not a native Chromium clipboard claim.
      const original = Reflect.apply(delegate, this, args);
      clipboardReturns.push({ receiver: this, args, original });
      return original;
    };
    const observe = into => ({
      owners(value) { callerOwners.push(value); },
      started(name, work) { callerStarts.push([name, work]); },
      copy(observation) {
        into.push(observation);
        if (observation.kind === 'started') own('original outer ToolArguments Copy handler', observation.work);
        else if (observation.kind === 'caught' && observation.error !== refusal) failures.push(observation.error);
        else if (observation.kind !== 'caught') failures.push(new Error('Unknown Copy observation kind'));
      },
    });
    f = await sessionFixture({ after: hook => registered.push(hook) }, {
      defaultChat: true, savedSessionId: 'e2e-rich-session', fixtureCwd: project, clipboard,
    });
    const row = f.record(f.savedId); row.leaf = 'current-leaf';
    row.messages = Array.from({ length: 8 }, (_, index) => user(`history ${index}`));
    row.entryIds = row.messages.map((_, index) => `entry-${index}`);
    const history = f.hold(detail, { stage: 'headers', repeat: true });
    let options = props(f, { workObserver: observe(firstEvents) });
    await f.mount(options); await history.entered.promise;
    assert.equal(f.savedId, 'e2e-rich-session');
    assert.equal(f.cwd, project); assert.equal(options.session.cwd, project);
    assert.equal(options.session.id, f.savedId);
    assert.equal(f.mountedOptions, options, 'actual public default ChatWindow props');
    assert.equal(f.defaultViewport, null, 'original header-held default spinner');
    const stream = source(f); assert.ok(stream);
    assert.equal(stream.url, '/api/agent/e2e-rich-session/events');
    await f.connect(stream);
    assert.equal(f.defaultOwners.size, 1, 'same actual default owner pair through Strict replay');
    for (const request of f.requests.filter(detail)) {
      assert.equal(request.path, '/api/sessions/e2e-rich-session');
      assert.deepEqual([...request.query].sort(), Object.entries({ deferThinking: '1', deferMedia: '1', tree: 'summary', force: '1' }).sort());
    }
    await f.deliver(history, page(f, { hasMore: false })); await f.settleDefault();
    const viewport = f.defaultViewport; assert.ok(viewport);
    const card = id => viewport.querySelector(`[data-tool-call-id="${id}"]`);
    const header = node => node.querySelector(':scope > div > button');
    const textButton = (node, text) => [...node.querySelectorAll('button')].find(button => button.textContent.trim() === text);
    const status = node => node.querySelector('[data-tool-arguments] [role="status"]')?.textContent;
    const field = (node, name) => [...node.querySelectorAll('[data-tool-fields] tr')]
      .find(item => item.querySelector('th')?.textContent === name)?.querySelector('td')?.textContent;
    const click = async node => {
      assert.ok(node, 'actual default DOM control exists');
      await f.run('actual default DOM control dispatch, not handler idle', () => node.dispatchEvent(new f.view.window.MouseEvent('click', { bubbles: true })));
    };
    const emit = async event => {
      assert.equal(source(f) === stream, true, 'same genuine ready source owns the original events');
      await f.event(stream, event); // Existing real EventSource -> actual hook handler.
    };
    const update = event => emit({ type: 'message_update', assistantMessageEvent: event });
    const beginCopy = async (node, expectedText, expectedRejection = null) => {
      const entry = { expectedText, expectedRejection, gate: toolDeferred() };
      clipboardQueue.push(entry);
      const before = f.copyWorks.length;
      await click(textButton(node, 'Copy arguments'));
      assert.equal(f.copyWorks.length, before + 1, 'one original outer Copy handler admitted');
      assert.equal(clipboardCalls.at(-1) === entry, true, 'named original Clipboard call admitted');
      assert.equal(entry.receiver === clipboard, true, 'native-delegating receiver preserved');
      assert.equal(entry.args.length, 1);
      assert.equal(entry.args[0], expectedText, 'literal current Clipboard API input');
      assert.equal(clipboardReturns.at(-1).original === entry.gate.promise, true, 'SAME original Clipboard API promise returned');
      assert.equal(clipboardReturns.at(-1).receiver === clipboard, true);
      assert.equal(clipboardReturns.at(-1).args[0], expectedText);
      entry.outer = f.copyWorks.at(-1);
      assert.equal(entry.outer.promise === entry.outer.observation.work, true, 'SAME original outer handler work');
      assert.equal(entry.outer.promise === entry.gate.promise, false, 'inner Clipboard ACK is NOT outer handler work');
      assert.equal(entry.outer.finished, false, 'original outer handler is still pending');
      assert.equal(originals.get(entry.outer.promise).outcome, 'pending');
      return entry;
    };
    const finishCopy = async (entry, node, expectedStatus = 'Copied') => {
      await f.run('release the named original Clipboard outcome', () => {
        if (entry.expectedRejection) entry.gate.reject(entry.expectedRejection.error);
        else entry.gate.resolve(undefined);
      });
      await f.settleDefault(); // Joins the ACTUAL full outer handler + existing default owners.
      assert.equal(entry.outer.finished, true);
      assert.equal(originals.get(entry.outer.promise).outcome, 'fulfilled', 'actual handler catch completes rather than leaking rejection');
      assert.equal(status(node), expectedStatus, 'actual Copy success/refusal/currentness presentation');
      const inner = originals.get(entry.gate.promise);
      assert.equal(inner.outcome, entry.expectedRejection ? 'rejected' : 'fulfilled');
      if (entry.expectedRejection) assert.equal(inner.error === entry.expectedRejection.error, true, 'SAME original Clipboard rejection Error');
    };

    const timestamp = Date.parse('2026-08-23T00:00:00.000Z');
    const message = { role: 'assistant', content: [], timestamp };
    await emit({ type: 'agent_start' });
    await emit({ type: 'message_start', message });
    await update({ type: 'toolcall_start', contentIndex: 0, id: 'readable-stream', toolName: 'e2e_stream_arguments' });
    await update({ type: 'toolcall_delta', contentIndex: 0, delta: '{"query":"E2E partial' });
    await f.settleDefault();
    const liveCard = card('readable-stream'); assert.ok(liveCard);
    const liveHeader = header(liveCard);
    assert.equal(liveHeader.getAttribute('aria-expanded'), 'false');
    assert.equal(liveCard.querySelector('[data-tool-arguments]') === null, true);
    await click(liveHeader);
    const raw = liveCard.querySelector('[data-tool-input]'); assert.ok(raw);
    assert.equal(raw.textContent, '{"query":"E2E partial');
    const first = await beginCopy(liveCard, '{"query":"E2E partial');
    // Update while the FIRST original Copy handler is still pending. Its late
    // success must not claim Copied for the current, different raw input.
    await update({ type: 'toolcall_delta', contentIndex: 0, delta: ' and more' });
    assert.equal(card('readable-stream') === liveCard, true, 'same actual live ToolCall card after delta');
    assert.equal(header(liveCard) === liveHeader, true);
    assert.equal(liveCard.querySelector('[data-tool-input]') === raw, true);
    assert.equal(raw.textContent, '{"query":"E2E partial and more', 'literal original current partial raw input');
    await finishCopy(first, liveCard, '');
    const rejected = await beginCopy(liveCard, '{"query":"E2E partial and more', { error: refusal });
    // Same public/default instance, current callback. Pending handler closure
    // keeps its actual text while its passive catch notification uses the latest
    // observer through ChatWindow/MessageView/ToolCall/ToolArguments.
    options = { ...options, workObserver: observe(currentEvents) };
    await f.rerender(options);
    assert.equal(card('readable-stream') === liveCard, true);
    assert.equal(header(liveCard) === liveHeader, true);
    await finishCopy(rejected, liveCard, 'Could not copy arguments. Show the raw arguments to select and copy them.');
    assert.equal(firstEvents.filter(event => event.kind === 'caught').length, 0, 'obsolete observer receives no current caught Error');
    assert.equal(currentEvents.filter(event => event.kind === 'caught').length, 1, 'latest observer receives original catch');
    assert.equal(currentEvents.find(event => event.kind === 'caught').error === refusal, true, 'SAME caught original refusal Error');
    assert.equal(currentEvents.find(event => event.kind === 'caught').text, '{"query":"E2E partial and more');
    const current = await beginCopy(liveCard, '{"query":"E2E partial and more');
    await finishCopy(current, liveCard);
    const toolCall = { type: 'toolCall', id: 'readable-stream', name: 'e2e_stream_arguments', arguments: { query: 'E2E completed', enabled: false } };
    const canonical = '{\n  "query": "E2E completed",\n  "enabled": false\n}';
    await update({ type: 'toolcall_end', contentIndex: 0, toolCall }); await f.settleDefault();
    assert.equal(card('readable-stream') === liveCard, true, 'same actual live card at canonical toolcall_end');
    assert.equal(header(liveCard) === liveHeader, true);
    assert.equal(liveHeader.getAttribute('aria-expanded'), 'true');
    assert.equal(liveCard.querySelector('[data-tool-input]') === null, true, 'canonical input replaces partial raw input');
    assert.equal(liveCard.querySelector('[data-tool-fields]') !== null, true, 'canonical fields mounted');
    assert.equal(field(liveCard, 'query'), 'E2E completed');
    assert.equal(field(liveCard, 'enabled'), 'false');
    assert.equal(status(liveCard), '', 'partial Copy status is not current for canonical text');
    await finishCopy(await beginCopy(liveCard, canonical), liveCard);
    const detailsBeforeEnd = f.requests.filter(detail).length;
    await emit({ type: 'message_end', entryId: 'readable-stream-entry', message: { ...message, content: [toolCall] } });
    await f.settleDefault();
    assert.equal(viewport.querySelectorAll('[data-tool-call-id="readable-stream"]').length, 1, 'one logical tool card after actual message_end');
    const savedCard = card('readable-stream'); assert.ok(savedCard);
    assert.equal(Boolean(savedCard.closest('[data-entry-id="readable-stream-entry"]')), true, 'actual hook commits original readable-stream-entry');
    assert.equal(header(savedCard).getAttribute('aria-expanded'), 'true', 'same logical ToolCall expansion survives actual saved handoff');
    assert.equal(savedCard.querySelector('[data-tool-fields]') !== null, true);
    assert.equal(field(savedCard, 'query'), 'E2E completed');
    assert.equal(field(savedCard, 'enabled'), 'false');
    assert.equal(liveCard.isConnected, false, 'production ends StreamingReply rather than retaining a ghost card');
    assert.equal(savedCard === liveCard, false, 'honest DOM remount at saved handoff; logical ID/expansion, not invented node continuity');
    assert.equal(f.requests.filter(detail).length, detailsBeforeEnd, 'actual message_end, not a manufactured final history snapshot');
    await finishCopy(await beginCopy(savedCard, canonical), savedCard);

    // Original saved-corpus value shapes, now driven through the SAME actual
    // default hook's public SSE path. One fixture, not native/per-row startup.
    const hostile = '<img data-e2e-tool-xss src=x onerror="window.__toolArgXss=1">[unsafe](javascript:alert(1))';
    const longLabel = `E2E_${'very_long_label_'.repeat(16)}`;
    const multiline = Array.from({ length: 60 }, (_, index) => `E2E argument line ${index}: ${'long_unbroken_value'.repeat(20)}`).join('\n');
    const calls = [
      { type: 'toolCall', id: 'readable-flat', name: 'e2e_arguments', arguments: { query: hostile, enabled: false, count: 0, nullable: null, empty: '', [longLabel]: multiline, [hostile]: 'Malicious label remains data' } },
      { type: 'toolCall', id: 'readable-nested', name: 'e2e_nested', arguments: { query: 'nested query', nested: { text: hostile, values: [false, 0, null] } } },
      { type: 'toolCall', id: 'readable-write', name: 'write', arguments: { path: toolJoin(project, 'readable-write.txt'), content: 'E2E plain write\n**not bold**\n' + hostile } },
      { type: 'toolCall', id: 'readable-edit', name: 'edit', arguments: { path: toolJoin(project, 'readable-edit.txt'), edits: [{ oldText: 'E2E old text\n' + hostile, newText: 'E2E replacement text\n**not bold**' }] } },
    ];
    const expectedNested = String.raw`{
  "query": "nested query",
  "nested": {
    "text": "<img data-e2e-tool-xss src=x onerror=\"window.__toolArgXss=1\">[unsafe](javascript:alert(1))",
    "values": [
      false,
      0,
      null
    ]
  }
}`;
    const expectedWrite = String.raw`{
  "path": "${project}/readable-write.txt",
  "content": "E2E plain write\n**not bold**\n<img data-e2e-tool-xss src=x onerror=\"window.__toolArgXss=1\">[unsafe](javascript:alert(1))"
}`;
    const expectedEdit = String.raw`{
  "path": "${project}/readable-edit.txt",
  "edits": [
    {
      "oldText": "E2E old text\n<img data-e2e-tool-xss src=x onerror=\"window.__toolArgXss=1\">[unsafe](javascript:alert(1))",
      "newText": "E2E replacement text\n**not bold**"
    }
  ]
}`;
    await emit({ type: 'message_start', message: { role: 'assistant', timestamp, content: calls } });
    await f.settleDefault();
    for (const [index, expected] of [toolFlatExpectedJson, expectedNested, expectedWrite, expectedEdit].entries()) {
      const currentCard = card(calls[index].id); assert.ok(currentCard);
      const currentHeader = header(currentCard); assert.equal(currentHeader.getAttribute('aria-expanded'), 'false');
      await click(currentHeader);
      const args = currentCard.querySelector('[data-tool-arguments]'); assert.ok(args);
      if (index === 0) {
        assert.equal(args.querySelectorAll('[data-tool-fields] tr').length, 7);
        for (const [name, value] of [['query', hostile], ['enabled', 'false'], ['count', '0'], ['nullable', 'null'], ['empty', '(empty)'],
          [longLabel, multiline], [hostile, 'Malicious label remains data']]) assert.equal(field(currentCard, name), value, 'literal original flat argument value');
      } else if (index === 2) {
        assert.equal(args.querySelector('[data-tool-file-text]')?.textContent, 'E2E plain write\n**not bold**\n' + hostile);
        assert.equal(calls[index].arguments.path, toolJoin(options.session.cwd, 'readable-write.txt'), 'public cwd/project/write path coupling');
      } else {
        assert.equal(args.querySelector('[data-tool-input]')?.textContent, expected, 'literal nested/edit canonical input');
        assert.equal(args.querySelector('table') === null, true);
      }
      assert.equal(args.querySelector('img, script, iframe, a, strong') === null, true, 'original argument strings remain data');
      await finishCopy(await beginCopy(currentCard, expected), currentCard);
      const show = textButton(args, 'Show raw arguments');
      if (show) {
        assert.equal(show.getAttribute('aria-expanded'), 'false');
        await click(show);
        assert.equal(args.querySelector('[data-tool-input]')?.textContent, expected, 'literal complete raw arguments');
        await finishCopy(await beginCopy(currentCard, expected), currentCard);
        await click(textButton(args, 'Hide raw arguments'));
        assert.equal(args.querySelector('[data-tool-input]') === null, true);
      }
    }
    assert.equal(f.view.window.__toolArgXss, undefined);
    await emit({ type: 'message_end', entryId: 'readable-argument-corpus-entry', message: { role: 'assistant', timestamp, content: calls } });
    await emit({ type: 'message_end', entryId: 'readable-edit-result', message: { role: 'toolResult', toolCallId: 'readable-edit', toolName: 'edit', timestamp,
      isError: true, content: [{ type: 'text', text: 'E2E seeded readable-edit result' }] } });
    await f.settleDefault();
    assert.equal(card('readable-edit').textContent.includes('E2E seeded readable-edit result'), true, 'actual stored error result joins its original tool ID');
    for (const call of calls) {
      assert.equal(viewport.querySelectorAll(`[data-tool-call-id="${call.id}"]`).length, 1);
      assert.equal(header(card(call.id)).getAttribute('aria-expanded'), 'true', 'logical seeded card expansion survives actual message_end');
    }
    assert.equal(clipboardQueue.length, 0, 'every planned Copy was actually admitted');
    assert.equal(f.copyWorks.length, clipboardCalls.length, 'outer original handlers and inner calls counted separately, one per actual control action');
    assert.equal([...originals.values()].every(record => record.outcome !== 'pending'), true);
    assert.equal(currentEvents.filter(event => event.kind === 'caught').length, 1);
    // Actual Copy handlers remain owned after their observer is removed. Admit
    // BOTH peers before a primary failure, then unmount without releasing either.
    const peers = [await beginCopy(card('readable-stream'), canonical),
      await beginCopy(card('readable-stream'), canonical, { error: refusal })];
    const latest = [];
    options = { ...options, workObserver: observe(latest) };
    await f.rerender(options);
    const teardownHeader = header(card('readable-stream'));
    assert.equal(Boolean(teardownHeader), true, 'actual pending-Copy card header exists');
    const expandedBeforeUnmount = teardownHeader.getAttribute('aria-expanded');
    assert.equal(expandedBeforeUnmount, 'true', 'establish the real expanded-card premise outside intentional catch');
    heldCopyExit = { peers, latest, cleanup: new Error('Registered Tool cleanup hook failure'), firstHook: null, close: null };
    try {
      assert.equal(expandedBeforeUnmount, 'false',
        'intentional independent UI assertion while both original Copy handlers are held');
    } catch (error) {
      if (!(error instanceof assert.AssertionError) || error.actual !== 'true' || error.expected !== 'false' || error.operator !== 'strictEqual') throw error;
      heldCopyExit.primary = error; failures.push(error);
    }
    assert.equal(Object.hasOwn(heldCopyExit, 'primary'), true, 'original primary captured at its assertion origin');
    assert.equal(peers.every(entry => !entry.outer.finished && originals.get(entry.outer.promise).outcome === 'pending'), true);
    const window = f.view.window, closeDescriptor = Object.getOwnPropertyDescriptor(window, 'close'), nativeClose = window.close;
    window.close = function (...args) {
      heldCopyExit.close = {
        originals: peers.every(entry => originals.get(entry.outer.promise).outcome === 'fulfilled'),
        observations: peers.every(entry => entry.outer.finished),
        sourceClosed: stream.readyState === 2,
      };
      // Restore this observation descriptor before delegating actual destruction.
      try {
        if (closeDescriptor) Object.defineProperty(window, 'close', closeDescriptor);
        else delete window.close;
      } catch (error) { failures.push(error); }
      return Reflect.apply(nativeClose, this, args);
    };
    registered.unshift(() => {
      heldCopyExit.firstHook = {
        bothReleased: peers.every(entry => entry.released === true),
        originalsStillPending: peers.every(entry => !entry.outer.finished),
      };
      throw heldCopyExit.cleanup; // A registered hook fault, NOT native unmount failure.
    });
    // No agent_end: these controlled events are not native persisted history.
    await f.unmount();
    assert.equal(stream.readyState, 2, 'real observer unmount closes the original ready source');
    assert.equal(peers.every(entry => !entry.outer.finished && originals.get(entry.gate.promise).outcome === 'pending'), true,
      'observer removal does not settle original Clipboard or outer handler work');
    assert.equal(f.defaultOwners.size, 1);
  } catch (error) { failures.push(error); }
  finally {
    const [outcome] = await Promise.allSettled([finish()]);
    if (!heldCopyExit) {
      if (outcome.status === 'rejected') throw outcome.reason;
    } else {
      try {
        assert.equal(outcome.status, 'rejected');
        assert.equal(outcome.reason instanceof AggregateError, true);
        assert.equal(outcome.reason.errors.length, 2, 'unknown failures remain fatal, never filtered');
        assert.equal(outcome.reason.errors[0] === heldCopyExit.primary, true, 'SAME original primary retained');
        assert.equal(outcome.reason.errors[1] === heldCopyExit.cleanup, true, 'SAME preceding registered-hook failure retained');
        assert.equal(heldCopyExit.firstHook.bothReleased && heldCopyExit.firstHook.originalsStillPending, true,
          'both release ACKs precede first hook/join while original handlers remain pending');
        assert.equal(heldCopyExit.close.originals && heldCopyExit.close.observations && heldCopyExit.close.sourceClosed, true,
          'full original Copy handlers and distinct observations joined BEFORE actual realm close');
        for (const entry of heldCopyExit.peers) {
          assert.equal(entry.outer.finished, true);
          assert.equal(originals.get(entry.outer.promise).outcome, 'fulfilled', 'real catch fulfills the outer handler');
          const inner = originals.get(entry.gate.promise);
          assert.equal(inner.outcome, entry.expectedRejection ? 'rejected' : 'fulfilled');
          if (entry.expectedRejection) assert.equal(inner.error === refusal, true);
        }
        const caught = heldCopyExit.latest.filter(event => event.kind === 'caught');
        assert.equal(caught.length, 1, 'latest observer receives one caught outcome after real unmount');
        assert.equal(caught[0].error === refusal, true, 'latest observer receives SAME original refusal after unmount');
        assert.equal(f.copyWorks.every(entry => entry.finished), true);
      } catch (error) {
        if (error instanceof assert.AssertionError) {
          const primitive = value => ['string', 'number', 'boolean', 'undefined'].includes(typeof value) ? value : '[non-scalar]';
          t.diagnostic('H-TOOL terminal assertion: ' + JSON.stringify([error.message.slice(0, 400), primitive(error.actual), primitive(error.expected)]));
        }
        throw new AggregateError([...(outcome.status === 'rejected' ? [outcome.reason] : []), error],
          'Tool primary/unmount settlement assertions failed; original failures retained');
      }
    }
  }
});

// Reading remedy: existing real hook/input and existing real default graph only.
// No replacement loadContext, hook, draft store, renderer or global observer.
test('H-COMPOSER actual hook and ChatInput retain the exact saved draft through a distinct new draft and return to the same saved namespace', async t => {
  // Supply the literal public ChatInput key through the sparse composition's
  // explicit external prop port. This owns store/input behavior, not the real
  // AppShell/ChatWindow caller's key calculation or the unrelated welcome view.
  const f = await sessionFixture(t, { composer: true });
  const sid = f.savedId, newKey = f.draftKey;
  const literal = 'upstream-list-draft\n2. retained';
  const newLiteral = 'independent unsent new draft';
  assert.equal(typeof sid, 'string');
  assert.equal(typeof newKey, 'string');
  assert.equal(sid === newKey, false, 'saved and provisional namespaces differ');
  f.setDraft(sid, { value: '', images: [] });
  f.setDraft(newKey, { value: newLiteral, images: [] });
  const savedOptions = { ...f.existingOptions(sid), composerDraftKey: sid };
  await f.mountReady(savedOptions);
  const input = () => f.view.container.querySelector('.chat-input-textarea');
  assert.equal(input() !== null, true, 'the existing fixture mounts actual ChatInput');
  const setValue = Object.getOwnPropertyDescriptor(f.view.window.HTMLTextAreaElement.prototype, 'value').set;
  await f.run('type the exact original saved browser draft', () => {
    setValue.call(input(), literal);
    input().dispatchEvent(new f.view.window.Event('input', { bubbles: true }));
  });
  const firstInputHandle = f.composerRef.current;
  assert.equal(typeof firstInputHandle?.whenSettled, 'function');
  await f.run('join the actual saved input work', () => firstInputHandle.whenSettled());
  await f.settleMaintenance();
  assert.equal(input().value, literal);
  assert.equal(f.getDraft(sid)?.value, literal, 'the real store has the exact saved bytes before departure');
  assert.equal(f.getDraft(sid)?.images.length, 0);
  assert.equal(f.getDraft(newKey)?.value, newLiteral, 'typing saved RICH must not write the new namespace');

  // Ordinary keyed SPA departure, not document reload or a new session factory.
  await f.mountReady(f.newOptions({ persistNewSession: false, composerDraftKey: newKey }));
  assert.equal(f.mountedOptions.session, null);
  assert.equal(f.mountedOptions.newSessionDraftKey, newKey);
  assert.equal(input() !== null, true);
  assert.equal(input().value, newLiteral, 'new draft reads its independent actual store namespace');
  assert.equal(f.getDraft(sid)?.value, literal, 'saved draft survives the actual hook/input departure');
  const newInputHandle = f.composerRef.current;
  await f.run('join the actual new input work', () => newInputHandle.whenSettled());
  await f.settleMaintenance();

  await f.mountReady({ ...f.existingOptions(sid), composerDraftKey: sid });
  assert.equal(f.mountedOptions.session.id, sid, 'return to the SAME saved SID, not a similar new record');
  assert.equal(f.mountedOptions.newSessionDraftKey, null);
  assert.equal(input() !== null, true);
  assert.equal(input().value, literal, 'same saved namespace restores upstream-list-draft exactly');
  assert.equal(f.getDraft(sid)?.value, literal);
  assert.equal(f.getDraft(newKey), null, 'the abandoned persistNewSession:false namespace clears under the unchanged hook policy, without clearing saved RICH');
  assert.equal(f.getDraft(sid)?.images.length, 0);
  const returnedInputHandle = f.composerRef.current;
  await f.run('join the actual returned saved input work', () => returnedInputHandle.whenSettled());
  await f.settleMaintenance();
  assert.equal(f.requests.some(request => request.path === '/api/agent/new'), false, 'no ensure/SDK creation for the decision row');
  assert.equal(f.requests.some(request => request.body?.type === 'prompt'), false, 'no draft is submitted');
  await f.unmount();
  await f.settleMaintenance();
  // This is not the actual AppShell navigation/key adopter. The original native
  // saved RICH -> LONG -> RICH roundtrip stays until that caller is qualified.
});

test('H-BRANCH actual default branch callback cancels the old saved locate generation before its original body arrives and owns current branch work', async t => {
  const f = await sessionFixture(t, { defaultChat: true });
  const sid = f.savedId, row = f.record(sid);
  row.leaf = 'e4999';
  row.messages = Array.from({ length: 50 }, (_, i) => user(`E2E message ${String(4950 + i).padStart(4, '0')}`));
  row.entryIds = Array.from({ length: 50 }, (_, i) => `e${4950 + i}`);
  let chooseBranch;
  const branchLeaves = [], positions = [];
  const history = f.hold(detail, { stage: 'headers', repeat: true });
  const oldPage = f.hold(request => request.path === `/api/sessions/${sid}/context`
    && request.query.get('leafId') === 'e4999' && request.query.get('before') === 'e4950');
  const currentPage = f.hold(request => request.path === `/api/sessions/${sid}/context`
    && request.query.get('leafId') === 'alternate' && !request.query.has('before'));
  const persistBranch = f.hold(request => request.path === `/api/agent/${sid}`
    && request.body?.type === 'navigate_tree' && request.body.targetId === 'alternate');
  await f.mount(props(f, {
    initialScrollPosition: { atBottom: false, anchorEntryId: 'e4920', anchorOffset: 37, oldestEntryId: 'e4900' },
    onBranchDataChange(_tree, leaf, change) { branchLeaves.push(leaf); chooseBranch = change; },
    onScrollPositionChange(selectedSid, position) { positions.push([selectedSid, position]); },
  }));
  await history.entered.promise;
  await f.connect(source(f));
  await f.deliver(history, page(f, { hasMore: true, cursor: 'e4950' }));
  await oldPage.entered.promise;
  const viewport = f.defaultViewport;
  assert.equal(viewport !== null, true);
  assert.equal(viewport.style.visibility, 'hidden');
  assert.equal(typeof chooseBranch, 'function', 'the actual hook publishes the public branch-selection callback');
  assert.equal(oldPage.request.signal.aborted, false);
  assert.deepEqual([...oldPage.request.query].sort(), Object.entries({
    deferThinking: '1', deferMedia: '1', leafId: 'e4999', before: 'e4950',
  }).sort());
  const oldLocate = f.viewWorks.find(entry => entry.name === 'saved-locate');
  assert.equal(oldLocate !== undefined, true, 'the existing observer owns the original work.run(locate) promise');

  let originalBranchWork;
  const branch = await f.start('actual default public alternate-branch callback', () => {
    originalBranchWork = chooseBranch('alternate');
    return originalBranchWork;
  });
  assert.equal(typeof originalBranchWork?.then, 'function', 'do not substitute a void dispatch/gate for original callback work');
  await currentPage.entered.promise;
  assert.equal(oldPage.request.signal.aborted, true, 'actual leaf change cleans up the old restoration generation');
  assert.equal(branchLeaves.includes('alternate'), true);
  assert.equal(f.defaultViewport === viewport, true, 'same actual default viewport, not a replacement view');
  assert.equal(viewport.style.visibility, '', 'branch change reveals the current context without an old anchor');
  assert.equal(currentPage.request.signal, undefined, 'public branch load is distinct from saved-locate cancellation');
  assert.deepEqual([...currentPage.request.query].sort(), Object.entries({
    deferThinking: '1', deferMedia: '1', leafId: 'alternate',
  }).sort());
  await f.deliver(currentPage, { context: { messages: [user('E2E alternate history branch')],
    entryIds: ['alternate'], oldestEntryId: 'alternate', hasMore: false } });
  await persistBranch.entered.promise;
  assert.equal(viewport.querySelector('[data-entry-id="alternate"]') !== null, true);
  assert.equal(viewport.querySelector('[data-entry-id="e4920"]') === null, true);
  assert.equal(persistBranch.done, false, 'current callback still owns its original navigate-tree body');
  await f.run('detach the current branch at its actual reading position', () => {
    viewport.scrollTop = 20;
    viewport.dispatchEvent(new f.view.window.Event('scroll'));
  });
  const beforeLateScroll = f.scrollCalls.length;
  const oldPayload = { context: {
    messages: Array.from({ length: 50 }, (_, i) => user(`E2E message ${String(4900 + i).padStart(4, '0')}`)),
    entryIds: Array.from({ length: 50 }, (_, i) => `e${4900 + i}`), oldestEntryId: 'e4900', hasMore: true,
  } };
  // Release EVERY accepted peer before any original callback/default/input/
  // maintenance join. Each release is attempted even if another throws.
  await f.run('release obsolete original body and current branch acknowledgement independently', async () => {
    const releases = await Promise.allSettled([
      Promise.resolve().then(() => oldPage.resolve(oldPayload)),
      Promise.resolve().then(() => persistBranch.cleanup()),
    ]);
    const failures = releases.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length) throw new AggregateError(failures, 'Branch peer release failed');
  });
  const joinFailures = [];
  try { await f.finish(branch); } catch (error) { joinFailures.push(error); }
  try { await f.settleDefault(); } catch (error) { joinFailures.push(error); }
  if (joinFailures.length === 1) throw joinFailures[0];
  if (joinFailures.length) throw new AggregateError(joinFailures, 'Independent original branch/default joins failed');
  assert.equal(oldPage.done, true);
  assert.equal(currentPage.done, true);
  assert.equal(persistBranch.done, true);
  assert.equal(f.viewWorks.includes(oldLocate), true, 'same observed original saved-locate lifetime was joined');
  assert.equal(branchLeaves.at(-1), 'alternate', 'old body cannot publish the retired leaf');
  assert.equal(viewport.querySelector('[data-entry-id="alternate"]') !== null, true);
  assert.equal(viewport.querySelector('[data-entry-id="e4920"]') === null, true, 'obsolete original page cannot adopt old items');
  assert.equal(viewport.querySelector('[data-entry-id="e4900"]') === null, true);
  assert.equal(viewport.scrollTop, 20, 'obsolete locate cannot restore its anchor or force current branch tail');
  assert.equal(f.scrollCalls.length, beforeLateScroll, 'no late old-generation scroll assignment');
  assert.equal(viewport.style.visibility, '');
  assert.equal(f.requests.filter(request => request.path.endsWith('/context') && request.query.has('before')).length, 1);
  assert.equal(f.requests.filter(request => request.body?.type === 'navigate_tree').length, 1);
  await f.unmount();
  await f.settleDefault();
  assert.equal(positions.length > 0, true, 'current branch has a real cleanup scroll-position publication');
  assert.equal(positions.at(-1)[0], sid);
  assert.equal(positions.at(-1)[1].atBottom, false);
  assert.equal(positions.at(-1)[1].anchorEntryId, 'alternate');
});
