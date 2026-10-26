import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, createRef } from 'react';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';
import { markdownDom } from './markdown-dom.fixture.mjs';
import { filesRuntime } from './files-runtime.fixture.mjs';
import { workspace as stateWorkspace } from './file-workspace-harness.fixture.mjs';
import { withFilesDiagnostics } from './files-diagnostics.fixture.mjs';

const style = fileURLToPath(new URL('../lib/testing/style.fixture.mjs', import.meta.url));
const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false, alias: {
  './file-workspace.css': style,
  [fileURLToPath(new URL('./file-workspace.css', import.meta.url))]: style,
} });

async function workspace(t) {
  const runtime = filesRuntime();
  let view;
  t.after(() => runtime.dispose(() => view?.unmount(), () => view?.dispose()));
  const { FileWorkspace } = await jiti.import('./FileWorkspace.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const ref = createRef(), statuses = [];
  let props = { workspaceKey: 'A', active: true, presented: true, gitRefreshKey: 0, onWork: runtime.onWork,
    onStatus: status => { statuses.push(status); }, onShowFiles() {}, onEmpty() {},
    onFocusWorkspace() {}, onMentionLines() {}, onAtMention() {} };
  const element = () => createElement(I18nProvider, null, createElement(FileWorkspace, { ...props, ref }));
  view = await mountWorkspace(element());
  async function mountWorkspace(element) {
    return runtime.mount(t, element, { setup: runtime.setup, beforeDispose: runtime.settle });
  }
  const canvas = view.container.querySelector('.file-workspace-canvas');
  // Numeric observer capability only: this selects the production wide branch,
  // not real CSS geometry, native scrolling or physical focus proof.
  canvas.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0,
    right: 1200, bottom: 800, width: 1200, height: 800, toJSON() { return {}; } });
  await runtime.notifyResize(canvas);
  return { view, runtime, ref, statuses,
    async render(change) { props = { ...props, ...change }; await view.rerender(element()); runtime.assertHealthy(); },
    async open(location, disposition) { await act(async () => { ref.current.open(location, disposition); }); runtime.assertHealthy(); },
  };
}
const readReply = content => ({ content, language: 'text', size: content.length,
  nextOffset: content.length, truncated: false, probeEligibility: { edit: false, gitDiff: false } });
const readPlan = (runtime, location) => runtime.expect({ type: 'read', path: location.filePath,
  sessionId: location.sourceSessionId, viewerCwd: location.cwd });

test('actual workspace mounts with its real stores and releases Strict Effects observers', async t => {
  const f = markdownDom(t);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const observers = [];
  class ResizeCapability {
    constructor(callback) { this.callback = callback; this.closed = false; observers.push(this); }
    observe(target) { this.target = target; this.callback([{ target, contentRect: { width: 1200, height: 800 } }]); }
    unobserve() {}
    disconnect() { this.closed = true; }
  }
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: ResizeCapability });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'ResizeObserver', previous);
    else delete globalThis.ResizeObserver;
  });
  const { FileWorkspace } = await jiti.import('./FileWorkspace.tsx');
  const { I18nProvider } = await jiti.import('../hooks/useI18n.tsx');
  const ref = createRef(), statuses = [];
  const view = await withFilesDiagnostics('Empty Workspace mounted boundary failed', () => f.mount(createElement(I18nProvider, null, createElement(FileWorkspace, {
    ref, workspaceKey: 'A', active: true, presented: true, gitRefreshKey: 0,
    onStatus: status => { statuses.push(status); }, onShowFiles() {}, onEmpty() {},
    onFocusWorkspace() {}, onMentionLines() {}, onAtMention() {},
  }))));
  assert.equal(typeof ref.current.open, 'function');
  const canvas = view.container.querySelector('.file-workspace-canvas');
  assert.equal(Boolean(canvas), true);
  assert.equal(statuses.at(-1).count, 0);
  assert.equal(f.requests.length, 0);
  const owned = observers.filter(observer => observer.target === canvas);
  assert.equal(owned.length, 2, 'real Strict Effects setup/cleanup/setup');
  assert.equal(owned.filter(observer => !observer.closed).length, 1);
  await view.unmount();
  assert.equal(ref.current === null, true);
  assert.ok(observers.every(observer => observer.closed));
  assert.equal(view.container.childNodes.length, 0);
});

test('selected reader identity survives repeat commands and panel hiding while watch admission follows active/presented', async t => {
  const h = await workspace(t), { view, runtime } = h;
  const location = { filePath: '/root/a.txt', label: 'a.txt', cwd: '/root', sourceSessionId: 'origin-A' };
  const replay = readPlan(runtime, location), current = readPlan(runtime, location);
  await h.open(location);
  await current.deliver(readReply('first\nsecond\nthird')); await replay.deliver(readReply('obsolete'));
  const host = view.container.querySelector('.file-workspace-view');
  const reader = host.querySelector('.file-viewer-content');
  assert.equal(Boolean(host && reader), true);
  assert.equal(host.hidden, false);
  assert.equal(runtime.liveSources.length, 1);
  const first = runtime.liveSources[0], admitted = runtime.requests.length;
  await h.open({ ...location, lineTarget: { line: 2 } });
  assert.ok(view.container.querySelector('.file-workspace-view') === host, 'new command does not rekey host');
  assert.ok(host.querySelector('.file-viewer-content') === reader, 'same reader receives the command');
  assert.equal(runtime.requests.length, admitted, 'repeat does not refetch/remount');
  await h.render({ active: false });
  assert.equal(first.closeCalls, 1);
  assert.equal(runtime.liveSources.length, 0);
  assert.equal(host.hidden, false, 'inactive and concealed are separate inputs');
  await h.render({ presented: false });
  assert.ok(view.container.querySelector('.file-workspace-view') === host);
  assert.ok(host.querySelector('.file-viewer-content') === reader);
  assert.equal(host.hidden, true);
  assert.equal(host.hasAttribute('inert'), true);
  assert.match(host.textContent, /second/);
  await h.render({ presented: true });
  assert.equal(runtime.liveSources.length, 0, 'showing alone cannot override inactive workspace');
  await h.render({ active: true });
  assert.equal(runtime.liveSources.length, 1);
  const replacement = runtime.liveSources[0];
  assert.ok(replacement !== first);
  const sync = readPlan(runtime, location);
  await replacement.connected(); await sync.deliver(readReply('current after reveal'));
  assert.match(host.textContent, /current after reveal/);
  assert.ok(host.querySelector('.file-viewer-content') === reader);
  assert.equal(host.hidden, false);
  const before = runtime.requests.length;
  await first.invokeRetained('connected'); await first.invokeRetained('change');
  assert.equal(runtime.requests.length, before);
  await view.unmount();
  assert.equal(replacement.closeCalls, 1);
  assert.equal(runtime.liveSources.length, 0);
  runtime.assertHealthy();
});


test('clean tab remount restores Workspace-stored mode, wrap and scroll while tab and host remain stable', async t => {
  const h = await stateWorkspace(t, { setup(window) {
    // Already-visible measurement ports precede BOTH real reader mounts. This
    // does not depend on an observer appearing after the content pane exists.
    for (const [key, value] of [['clientWidth', 640], ['clientHeight', 400]]) {
      Object.defineProperty(window.HTMLElement.prototype, key, { configurable: true,
        get() { return this.classList.contains('file-viewer-content') ? value : 0; } });
    }
  } });
  const { view, runtime } = h;
  const a = { filePath: '/root/a.md', label: 'a.md', cwd: '/root', sourceSessionId: 'stored-A' };
  const b = { filePath: '/root/b.txt', label: 'b.txt', cwd: '/root', sourceSessionId: 'stored-B' };
  const click = async node => {
    assert.equal(Boolean(node), true, 'mounted action exists');
    await view.dispatch(node, new view.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  };
  const mode = (host, text) => {
    const node = [...host.querySelectorAll('button')].find(button => button.textContent === text);
    assert.equal(Boolean(node), true, `real ${text} mode control`); return node;
  };
  const payload = { ...readReply('# Alpha\n\nsaved body'), language: 'markdown' };
  const first = [readPlan(runtime, a), readPlan(runtime, a)];
  await h.open(a); await first[1].deliver(payload); await first[0].deliver(readReply('obsolete'));
  const host = view.container.querySelector('.file-workspace-view');
  const tab = [...view.container.querySelectorAll('[role="tab"]')].find(node => node.getAttribute('aria-controls') === host.id);
  assert.equal(Boolean(tab), true);
  await view.dispatch(tab, new view.window.MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  assert.equal(mode(host, 'Preview').getAttribute('aria-pressed'), 'true');
  await click(mode(host, 'Source'));
  await click(host.querySelector('[aria-label="Enable word wrap"]'));
  const oldReader = host.querySelector('.file-viewer-content');
  oldReader.scrollTop = 91; oldReader.scrollLeft = 17;
  await view.dispatch(oldReader, new view.window.Event('scroll', { bubbles: true }));
  assert.equal(mode(host, 'Source').getAttribute('aria-pressed'), 'true');
  assert.equal(host.querySelector('[aria-label="Disable word wrap"]').getAttribute('aria-pressed'), 'true');
  const second = [readPlan(runtime, b), readPlan(runtime, b)];
  await h.open(b); await second[1].deliver(readReply('clean B')); await second[0].deliver(readReply('obsolete'));
  assert.equal(view.container.querySelector(`[id="${host.id}"]`) === host, true, 'inactive tab keeps its host');
  assert.equal(host.querySelector('.file-viewer-content') === null, true, 'clean A reader ACTUALLY unmounted');
  assert.equal(oldReader.isConnected, false);
  assert.equal([...view.container.querySelectorAll('[role="tab"]')].includes(tab), true, 'same tab survives B selection');
  const restored = [readPlan(runtime, a), readPlan(runtime, a)];
  await click(tab);
  await restored[1].deliver(payload); await restored[0].deliver(readReply('obsolete'));
  const newReader = host.querySelector('.file-viewer-content');
  assert.equal(Boolean(newReader), true);
  assert.equal(newReader !== oldReader, true, 'returning to A remounts its real reader');
  assert.equal(view.container.querySelector(`[id="${host.id}"]`) === host, true);
  assert.equal([...view.container.querySelectorAll('[role="tab"]')].includes(tab), true);
  assert.equal(tab.getAttribute('aria-selected'), 'true');
  assert.equal(mode(host, 'Source').getAttribute('aria-pressed'), 'true', 'Workspace forwards stored mode after real remount');
  assert.equal(host.querySelector('[aria-label="Disable word wrap"]')?.getAttribute('aria-pressed'), 'true', 'Workspace forwards stored wrap');
  assert.equal(newReader.scrollTop, 91, 'Workspace forwards stored vertical scroll');
  assert.equal(newReader.scrollLeft, 17, 'Workspace forwards stored horizontal scroll');
  runtime.assertHealthy();
});

// F-CONFLICT: one actual Workspace/provider/store/TabBar graph, not held-Save typing.
test('entered external revisions preserve actual Workspace drafts/tabs, disable Save and discard into the next PUT revision', async t => {
  const { read, editable, click, type, button } = await import('./file-viewer-harness.fixture.mjs');
  const confirmations = [];
  const h = await stateWorkspace(t, { setup(window, runtime) {
    const original = Object.getOwnPropertyDescriptor(window, 'confirm');
    // Register BEFORE replacing the capability, including failed setup. This runs
    // after all known work joins in settle, BEFORE the central realm is destroyed.
    runtime.assertOnSettle(() => {
      if (original) Object.defineProperty(window, 'confirm', original);
      else delete window.confirm;
    });
    Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value(message) {
      confirmations.push(message); return true;
    } });
  } });
  const { view, runtime } = h;
  const tabFor = path => {
    const span = [...view.container.querySelectorAll('[role="tab"] span[title]')]
      .find(node => node.getAttribute('title') === path);
    assert.equal(Boolean(span), true, `actual tab for ${path}`);
    return span.closest('[role="tab"]');
  };
  const hostFor = tab => {
    const host = view.window.document.getElementById(tab.getAttribute('aria-controls'));
    assert.equal(Boolean(host), true); return host;
  };
  const probe = location => runtime.expect({ type: 'edit', path: location.filePath, sessionId: location.sourceSessionId });
  const snapshot = (content, revision, identity) => ({ content, revision, writable: true, editIdentity: identity });
  const preview = { filePath: '/root/preview.html', label: 'preview.html', cwd: '/root', sourceSessionId: 'session-a' };
  const previewReads = [readPlan(runtime, preview), readPlan(runtime, preview)];
  await h.open(preview);
  await previewReads[1].deliver(readReply('Preview tab')); await previewReads[0].deliver(readReply('obsolete'));
  const previewTab = tabFor(preview.filePath);
  await view.dispatch(previewTab, new view.window.MouseEvent('dblclick', { bubbles: true }));

  for (const row of [
    { path: '/root/editable.txt', label: 'editable.txt', baseline: 'A draft\n', draft: 'Keep this draft', external: 'External change\n', key: 'file-panel' },
    { path: '/root/uploads-1280/nested/existing.txt', label: 'existing.txt', baseline: 'original\n', clean: 'clean replacement\n', draft: 'Keep my dirty draft', external: 'disk replacement\n', key: 'upload-1280' },
    { path: '/root/uploads-390/nested/existing.txt', label: 'existing.txt', baseline: 'original\n', clean: 'clean replacement\n', draft: 'Keep my dirty draft', external: 'disk replacement\n', key: 'upload-390' },
  ]) {
    const location = { filePath: row.path, label: row.label, cwd: '/root', sourceSessionId: 'session-a' };
    const oldRevision = `r-${row.key}-old`, newRevision = `r-${row.key}-external`, identity = `identity-${row.key}`;
    const initial = [readPlan(runtime, location), readPlan(runtime, location)];
    await h.open(location);
    const firstEdit = probe(location);
    await initial[1].deliver(read(row.baseline, editable)); await initial[0].deliver(readReply('obsolete'));
    await firstEdit.deliver(snapshot(row.baseline, oldRevision, identity));
    const tab = tabFor(row.path), host = hostFor(tab);
    if (row.clean) {
      const source = runtime.liveSources.find(source => source.url.pathname.endsWith(row.path));
      assert.equal(Boolean(source), true);
      const savedRead = readPlan(runtime, location), savedEdit = probe(location);
      await source.change(); await savedRead.deliver(read(row.clean, editable));
      await savedEdit.deliver(snapshot(row.clean, `r-${row.key}-clean`, identity));
      assert.equal(host.querySelector('.file-source-line-content').textContent, row.clean, 'clean watcher projects exact external saved bytes, including newline');
    }
    await click(view, button(host, 'Edit'));
    const editor = host.querySelector('textarea'); assert.equal(Boolean(editor), true);
    await type(view, editor, row.draft);
    assert.equal(editor.value, row.draft);
    assert.equal(tab.getAttribute('aria-label'), `${row.label} — Unsaved changes`, 'ACTUAL Workspace onDraftChange reaches ACTUAL TabBar');

    // The clean preview really remounts; the dirty editor must NOT. Both tab
    // selections dispatch through the real TabBar -> Workspace callbacks.
    const returningPreview = [readPlan(runtime, preview), readPlan(runtime, preview)];
    await click(view, previewTab);
    await returningPreview[1].deliver(readReply('Preview tab')); await returningPreview[0].deliver(readReply('obsolete'));
    assert.equal(host.hidden, true); assert.equal(editor.isConnected, true);
    assert.equal(host.querySelector('textarea') === editor, true);
    await click(view, tab);
    assert.equal(tab.getAttribute('aria-selected'), 'true'); assert.equal(host.hidden, false);
    assert.equal(host.querySelector('textarea') === editor, true); assert.equal(editor.value, row.draft);

    const source = runtime.liveSources.find(source => source.url.pathname.endsWith(row.path));
    assert.equal(Boolean(source), true);
    const changed = probe(location), before = runtime.requests.length;
    await source.change(); // Actual dirty synchronize skips saved-text read, probes the NEW revision.
    assert.equal(runtime.requests.length, before + 1, 'dirty external change admits only the original edit probe');
    await changed.deliver(snapshot(row.external, newRevision, identity));
    assert.equal(changed.jsonReturned, true); assert.equal(changed.jsonCompletions, 1);
    assert.equal(editor.value, row.draft, 'external revision must NOT drop the entered draft');
    assert.equal(tab.getAttribute('aria-label'), `${row.label} — Unsaved changes`);
    assert.match(host.textContent, /File changed on disk/);
    assert.equal(button(host, 'Save').disabled, true, 'external-change Save-disabled conjunction');

    const reloadRead = readPlan(runtime, location), reloadEdit = probe(location);
    const confirmsBefore = confirmations.length;
    await click(view, button(host, 'Discard draft and reload'));
    assert.equal(confirmations.length, confirmsBefore + 1, 'actual Discard invokes the existing confirm port');
    await reloadRead.deliver(read(row.external, editable));
    await reloadEdit.deliver(snapshot(row.external, newRevision, identity));
    assert.equal(reloadRead.jsonCompletions, 1); assert.equal(reloadEdit.jsonCompletions, 1);
    assert.equal(editor.value, row.external, 'actual discard loads external bytes');
    assert.equal(tab.getAttribute('aria-label'), row.label, 'discard clears the actual Workspace tab draft');

    await type(view, editor, 'A draft\n');
    const save = runtime.expect({ type: 'save', path: row.path, sessionId: location.sourceSessionId,
      body: { content: 'A draft\n', expectedRevision: newRevision, expectedEditIdentity: identity } });
    await click(view, button(host, 'Save'));
    // Preserve the actual request matcher failure (including expectedRevision)
    // before a rejected request can surface only as an unadmitted ticket later.
    runtime.assertHealthy();
    await save.headers();
    const close = tab.querySelector('button');
    assert.equal(close.disabled, true, 'actual Workspace onSavingChange reaches actual tab while PUT body is held');
    const savedRead = readPlan(runtime, location);
    await save.deliver({ revision: `r-${row.key}-saved` });
    await savedRead.deliver(read('A draft\n', editable));
    assert.equal(save.jsonReturned, true); assert.equal(save.jsonCompletions, 1);
    assert.equal(close.disabled, false, 'actual save finally forwards false');
    assert.equal(tab.getAttribute('aria-label'), row.label);
    assert.equal(editor.value, 'A draft\n');
    runtime.assertHealthy();
  }
  assert.equal(confirmations.length, 3);
  // Terminal disposal releases ALL known headers/bodies before full original
  // catch/finally/descendant joins. Unmount/act is NOT used as an idle witness.
  await runtime.dispose(() => view.unmount(), () => view.dispose());
});

// PRIVATE P2-1 fixture controls, not substitute FileViewer behavior/native proof.
test('PRIVATE Files releases both real admitted bodies before first teardown wait on primary, partial setup and pre-act unmount failure', async t => {
  const contains = (root, wanted) => {
    const seen = new Set();
    const visit = (value, present) => {
      if (present && value === wanted) return true;
      if (!value || typeof value !== 'object' || seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value.errors) && value.errors.some(item => visit(item, true))) return true;
      return Object.hasOwn(value, 'cause') && visit(value.cause, true);
    };
    return visit(root, true);
  };
  for (const mode of ['primary', 'partial-setup', 'unmount-before-act']) {
    const beforeFetch = globalThis.fetch, beforeConsole = console.error;
    const runtime = filesRuntime(), guardFetch = globalThis.fetch, guardConsole = console.error;
    const primary = new Error(`Files primary ${mode}`), releaseError = new Error(`Files release ${mode}`);
    const restoreError = new Error(`Files restore ${mode}`), unmountError = new Error(`Files unmount ${mode}`);
    const bodyError = { originalBody: mode };
    const events = [], released = new Set(), finals = [], closes = [], sourceRefs = [];
    const central = []; const owner = { after(fn) { central.push(fn); } };
    let view, windowRef, originalClose, closeDescriptor, complete = false, primaryValue, primaryPresent = false;
    let releaseFaultRaised = false;
    runtime.releaseOnSettle(() => {
      if (!releaseFaultRaised) { releaseFaultRaised = true; events.push('release-error'); throw releaseError; }
    });
    const tickets = [runtime.expect({ type: 'read', path: '/private-a.txt' }), runtime.expect({ type: 'read', path: '/private-b.txt' })];
    const originalSources = tickets.map(ticket => ticket.releaseForCleanup);
    const originals = tickets.map((ticket, index) => {
      const full = globalThis.fetch(`/api/files/private-${index ? 'b' : 'a'}.txt?type=read`)
        .then(response => response.json()).finally(() => { finals.push(index); events.push(`finally-${index}`); });
      runtime.onWork(full);
      const originalRelease = ticket.releaseForCleanup;
      const release = () => {
        sourceRefs.push({ actual: release, expected: releases[index], original: originalRelease });
        released.add(index); events.push(`release-${index}`);
        originalRelease(index ? undefined : bodyError);
      };
      ticket.releaseForCleanup = release; return full;
    });
    const releases = tickets.map(ticket => ticket.releaseForCleanup);
    const firstWait = releaseSource => {
      events.push('first-owned-wait');
      assert.equal(releaseSource === runtime.releaseKnown, true, 'actual release handoff source reference');
      assert.equal(released.has(0) && released.has(1), true, 'BOTH actual tickets released before FIRST teardown wait');
    };
    const destroy = async () => {
      const errors = [];
      for (const dispose of central) { try { await dispose(); } catch (error) { errors.push(error); } }
      if (errors.length === 1) throw errors[0];
      if (errors.length) throw new AggregateError(errors, 'Private central disposal');
    };
    const unmount = () => {
      firstWait(runtime.releaseKnown);
      if (mode === 'unmount-before-act') throw unmountError; // Before invoking real central act; React is NOT replaced.
      return view?.unmount();
    };
    t.after(async () => { if (!complete) await runtime.dispose(unmount, destroy); });
    try {
      // Arrangement waits are not teardown. Both ACTUAL response.json bodies are
      // entered and held before the failing setup/unmount is initiated.
      await tickets[0].headers(); await tickets[1].headers();
      assert.equal(runtime.requests.length, 2);
      assert.equal(tickets.every(ticket => ticket.jsonCalls === 1), true);
      view = await runtime.mount(owner, createElement('div', null, 'private Files scope'), {
        beforeDispose: runtime.settle, beforeUnmount: firstWait,
        setup(window) {
          runtime.setup(window); windowRef = window;
          const marker = '__privateFilesRealm';
          Object.defineProperty(window, marker, { configurable: true, value: 'before' });
          runtime.assertOnSettle(() => {
            Object.defineProperty(window, marker, { configurable: true, value: 'before' });
            events.push('realm-restore'); throw restoreError;
          });
          Object.defineProperty(window, marker, { configurable: true, value: 'during' });
          closeDescriptor = Object.getOwnPropertyDescriptor(window, 'close'); originalClose = window.close;
          Object.defineProperty(window, 'close', { configurable: true, value: function (...args) {
            closes.push({ released: released.size === 2, finallyDone: finals.length === 2,
              realmRestored: window[marker] === 'before', hostLive: globalThis.fetch === guardFetch,
              collectorLive: console.error === guardConsole, originalClose: originalClose === (closeDescriptor?.value ?? originalClose) });
            events.push('close-entry');
            try { return Reflect.apply(originalClose, this, args); }
            finally { events.push('close-finally'); }
          } });
          if (mode === 'partial-setup') throw primary;
        },
      });
      throw primary;
    } catch (error) { primaryValue = error; primaryPresent = true; }
    const cleanup = await Promise.allSettled([runtime.dispose(unmount, destroy)]);
    if (windowRef) {
      if (closeDescriptor) Object.defineProperty(windowRef, 'close', closeDescriptor);
      else delete windowRef.close;
    }
    const outcome = new AggregateError([...(primaryPresent ? [primaryValue] : []), ...cleanup.filter(result => result.status === 'rejected').map(result => result.reason)], 'Private captured Files exit');
    assert.equal(outcome.errors[0] === primaryValue, true, 'original caught primary reference, including wrapper');
    for (const expected of [primary, releaseError, restoreError, bodyError, undefined]) assert.equal(contains(outcome, expected), true, 'every original value retained, undefined included as PRESENT');
    if (mode === 'unmount-before-act') assert.equal(contains(outcome, unmountError), true);
    const leaves = [], seen = new Set();
    const collect = value => {
      if (value && typeof value === 'object') {
        if (seen.has(value)) return; seen.add(value);
        if (Array.isArray(value.errors)) { value.errors.forEach(collect); if (Object.hasOwn(value, 'cause')) collect(value.cause); return; }
        if (Object.hasOwn(value, 'cause')) { collect(value.cause); return; }
      }
      leaves.push(value);
    };
    collect(outcome);
    assert.equal(leaves.every(value => [primary, releaseError, restoreError, bodyError, undefined, unmountError].includes(value)), true, 'unexpected original/cleanup values are NOT filtered away');
    const peerResults = await Promise.allSettled(originals);
    assert.equal(peerResults[0].status, 'rejected'); assert.equal(peerResults[0].reason === bodyError, true);
    assert.equal(peerResults[1].status, 'rejected'); assert.equal(Object.hasOwn(peerResults[1], 'reason'), true); assert.equal(peerResults[1].reason, undefined);
    assert.equal(tickets.every(ticket => ticket.jsonCompletions === 1), true, 'real original JSON finally joined');
    assert.equal(sourceRefs.every(ref => ref.actual === ref.expected && ref.original === originalSources[releases.indexOf(ref.expected)]), true);
    assert.equal(events.indexOf('release-0') < events.indexOf('first-owned-wait'), true);
    assert.equal(events.indexOf('release-1') < events.indexOf('first-owned-wait'), true);
    assert.equal(events.indexOf('first-owned-wait') < events.indexOf('close-entry'), true, 'partial-mount handoff precedes close, not only later outer teardown');
    assert.equal(closes.length, 1);
    assert.equal(Object.values(closes[0]).every(value => value === true), true, 'original finally/REALM restore/live collectors before REAL close');
    assert.equal(events.includes('close-finally'), true);
    assert.equal(globalThis.fetch === beforeFetch && console.error === beforeConsole, true, 'HOST restored AFTER actual close');
    if (view) assert.equal(view.container.childNodes.length, 0, 'real central root unmounted, not a disposal ACK');
    complete = true;
  }
});
