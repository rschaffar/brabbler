import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { deferred } from '../lib/testing/async.fixture.mjs';
import { exactHeaders, exactQuery } from '../lib/testing/leaf-controls.fixture.mjs';
import { packet, click, input } from './cards-git.fixture.mjs';

function failureAggregate(errors, title) {
  // Display only primitive data: <=700 chars, <=8 causes, <=3 nested edges.
  // Never filter/replace the ORIGINAL objects in AggregateError.errors.
  const messages = [], seen = new Set();
  const visit = (error, depth) => {
    if (depth > 3 || messages.length >= 8) return;
    if (error === null || typeof error !== 'object') {
      messages.push(typeof error === 'string' ? error.slice(0, 700) : typeof error);
      return;
    }
    if (seen.has(error)) return;
    seen.add(error);
    const data = key => Object.getOwnPropertyDescriptor(error, key)?.value;
    const message = data('message');
    messages.push(typeof message === 'string' ? message.slice(0, 700) : 'non-message failure');
    const nested = data('errors');
    if (Array.isArray(nested)) for (const child of nested.slice(0, 8)) visit(child, depth + 1);
    const cause = data('cause');
    if (cause !== undefined) visit(cause, depth + 1);
  };
  let summary;
  try {
    for (const error of errors.slice(0, 8)) visit(error, 0);
    summary = messages.join(' | ').slice(0, 700);
  } catch { summary = 'failure diagnostic unavailable'; }
  return new AggregateError(errors, `${title}; causes: ${summary}`);
}

function storageBytes(storage) {
  return Array.from({ length: storage.length }, (_, i) => storage.key(i)).sort().map(key => [key, storage.getItem(key)]);
}

export const SCRATCHPAD_PROJECT_A = 'a'.repeat(64), SCRATCHPAD_PROJECT_B = 'b'.repeat(64);
const defaultProjects = {
  '/projects/rich': { projectId: SCRATCHPAD_PROJECT_A, root: '/projects/rich' },
  '/projects/other': { projectId: SCRATCHPAD_PROJECT_B, root: '/projects/other' },
  '/worktrees/rich': { projectId: SCRATCHPAD_PROJECT_A, root: '/projects/rich' },
};

// Scratchpad-only HTTP/Storage/Visibility adapter. Cards owns guards, real
// React/JSDOM/Jiti, console/runtime collection and realm-before-host restoration.
// Replies are SCRIPTED external inputs, never an implementation of revision,
// history, conflict, save or recovery decisions. Native revisions stay native.
export async function scratchpadFixture(t, { storage = [], plans = [], projects = defaultProjects, setup } = {}) {
  const failures = [], originals = [], operations = [], requests = [], pending = [...plans], cleanups = [];
  const focusSubscriptions = new Set(), visibilitySubscriptions = new Set();
  const teardownError = new Error('owned Scratchpad HTTP shutdown');
  const expectedErrors = new Set([teardownError]);
  let h, disposal, closing = false, terminalObserved = false, props, realmStorage, terminalStorage;
  const phases = [];
  const monitor = error => failures.push(error);
  function checked(run) {
    try { return run(); } catch (error) { failures.push(error); throw error; }
  }
  function observe(promise, kind = 'port') {
    if (terminalObserved) failures.push(new Error(`Scratchpad ${kind} observed after terminal boundary`));
    const record = { promise, kind, settled: false };
    record.observed = promise.then(() => { record.settled = true; }, error => {
      record.settled = true;
      if (!expectedErrors.has(error)) failures.push(error);
    });
    originals.push(record);
    if (kind === 'operation') operations.push(record);
    return promise;
  }
  function onWork(promise) {
    // No request-to-promise inference. One original writer may emit MANY PUTs;
    // header/body observations never become operation handles.
    observe(promise, 'operation');
  }
  function operationFor(promise) {
    const operation = operations.find(value => value.promise === promise);
    checked(() => assert.equal(Boolean(operation), true, 'exact original operation promise was observed'));
    return operation;
  }
  async function joinOriginals() {
    // Enumerate ACTUAL newly observed promises, not microtask/clock/idle polling.
    // refresh can synchronously admit its original nested drain before settling.
    for (let cursor = 0; cursor < originals.length;) {
      const accepted = originals.slice(cursor); cursor = originals.length;
      await Promise.all(accepted.map(record => record.observed));
    }
  }
  function releaseAll() {
    closing = true;
    phases.push('release-all');
    // Synchronous peer-wide release BEFORE unmount/act/join, also on failed setup.
    // A consumed 200 header cannot be rewritten: reject its still-held body.
    for (const request of requests) {
      try { if (!request.headersSent) request.sendHeaders(503); } catch (error) { failures.push(error); }
      try { if (!request.bodySent) request.sendBody(teardownError, true); } catch (error) { failures.push(error); }
    }
  }
  async function dispose() {
    if (!disposal) {
      disposal = (async () => {
        const errors = [];
        releaseAll();
        // Captured common/central disposers also exist when packet never returns.
        for (const cleanup of cleanups) {
          try { await cleanup(); } catch (error) { errors.push(error); }
        }
        // Independent fallback: a failed release/unmount/common cleanup skips no join.
        try { await joinOriginals(); } catch (error) { errors.push(error); }
        phases.push('host-restored'); // Attempt marker, not universal restoration proof.
        if (errors.length) throw failureAggregate(errors, 'Scratchpad cleanup boundaries failed');
      })();
      void disposal.catch(() => {});
    }
    const errors = [];
    try { await disposal; } catch (error) { errors.push(error); }
    // Recheck the LIVE collector even when teardown was cached/previously green.
    // A terminal observed boundary cannot certify future business admissions.
    errors.push(...failures);
    if (errors.length) throw failureAggregate(errors, 'Scratchpad full-work/lifetime failure');
  }
  // Earliest independent caught-error collector/disposer, before graph or setup.
  // Keep the monitor live after early dispose/failed setup until the real after hook.
  t.after(async () => {
    const errors = [];
    try { await dispose(); } catch (error) { errors.push(error); }
    try { process.off('uncaughtExceptionMonitor', monitor); } catch (error) { errors.push(error); }
    if (errors.length) throw failureAggregate(errors, 'Scratchpad final lifetime collection failed');
  });
  process.on('uncaughtExceptionMonitor', monitor);

  const domain = {
    fetch(inputURL, options = {}) {
      try {
        return checked(() => {
          // A matching plan is NOT an admitted HTTP job. Retain this defect even
          // when production catches the separate operational shutdown rejection.
          if (closing) failures.push(new Error('Unexpected Scratchpad HTTP admitted after close'));
          assert.equal(typeof inputURL, 'string');
          const url = new URL(inputURL, 'https://fixture.invalid');
          assert.equal(url.origin, 'https://fixture.invalid');
          assert.equal(url.pathname, '/api/scratchpad');
          assert.equal(url.hash, ''); assert.equal(url.username, ''); assert.equal(url.password, '');
          const projectCwd = url.searchParams.get('projectCwd');
          const metadata = projectCwd === null ? null : projects[projectCwd];
          if (projectCwd !== null) assert.equal(Boolean(metadata), true, 'only a declared project metadata capability may enter');
          const plan = metadata ? { method: 'GET', projectCwd, metadata } : pending.shift();
          assert.equal(Boolean(plan), true, 'only a predeclared exact Scratchpad request may enter');
          const request = { url, options, method: options.method ?? 'GET', plan,
            headers: deferred(), body: deferred(), jsonCalls: 0, headersSent: false, bodySent: false };
          assert.equal(request.method, plan.method);
          exactQuery(request, plan.projectCwd ? { projectCwd: plan.projectCwd }
            : plan.method === 'GET' && plan.projectId !== null ? { projectId: plan.projectId } : {});
          exactHeaders(request, plan.method === 'PUT' ? { 'Content-Type': 'application/json' } : {});
          if (plan.method === 'GET') {
            assert.deepEqual(Object.keys(options), ['cache']);
            assert.equal(options.cache, 'no-store');
            assert.equal(options.body, undefined);
          } else {
            assert.deepEqual(Object.keys(options).sort(), ['body', 'headers', 'method']);
            request.payload = JSON.parse(options.body);
            assert.deepEqual(request.payload, { ...(plan.projectId === null ? { sessionId: null } : { projectId: plan.projectId }), text: plan.text, revision: plan.revision }, 'exact default-transport scope/text/read-revision');
          }
          request.sendHeaders = status => {
            request.headersSent = true;
            request.status = status;
            request.headers.resolve({ ok: status >= 200 && status < 300, status,
              json() {
                request.jsonCalls++;
                return observe(request.body.promise); // Complete body consumption is not the operation join.
              } });
          };
          request.sendBody = (value, reject = false) => {
            request.bodySent = true;
            if (reject) request.body.reject(value); else request.body.resolve(value);
          };
          requests.push(request);
          const port = observe(request.headers.promise);
          if (metadata && !metadata.hold && !closing) {
            request.sendHeaders(200);
            request.sendBody({ projectId: metadata.projectId, root: metadata.root });
          }
          if (closing) {
            // Settlement only, NEVER successful admission/coverage. Still observe
            // and release both recognized late ports without stranding a peer.
            try { request.sendHeaders(503); } catch (error) { failures.push(error); }
            try { request.sendBody(teardownError, true); } catch (error) { failures.push(error); }
          }
          return port;
        });
      } catch (error) { return Promise.reject(error); }
    },
    release: releaseAll,
    async join() {
      await joinOriginals();
      terminalObserved = true;
      if (realmStorage) terminalStorage = storageBytes(realmStorage);
      phases.push('original-work-joined-in-realm');
      checked(() => {
        assert.equal(focusSubscriptions.size, 0, 'actual NoteEditor focus subscriptions removed');
        assert.equal(visibilitySubscriptions.size, 0, 'actual NoteEditor visibility subscriptions removed');
      });
    },
  };
  // No extra generic guard/framework and no Terminal/SSH role registration.
  // beforeUnmount is the common mount's existing optional synchronous boundary.
  const commonT = { after(callback) { cleanups.push(callback); }, mock: t.mock };
  try {
    h = await packet(commonT, { readDomain: domain, beforeUnmount: releaseAll,
      setup(window, installRealm) {
        const document = window.document;
        realmStorage = window.sessionStorage;
        for (const [key, value] of storage) realmStorage.setItem(key, value);
        // Common realm stack captures the ORIGINAL descriptor before replacement.
        installRealm(document, 'visibilityState', 'visible');
        for (const [target, type, subscriptions] of [[window, 'focus', focusSubscriptions], [document, 'visibilitychange', visibilitySubscriptions]]) {
          const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
          installRealm(target, 'addEventListener', (name, listener, options) => {
            if (name === type) subscriptions.add(listener);
            return add(name, listener, options);
          });
          installRealm(target, 'removeEventListener', (name, listener, options) => {
            if (name === type) subscriptions.delete(listener);
            return remove(name, listener, options);
          });
        }
        setup?.(window, { peer, phases, requests });
      } });
    const { ScratchpadPanel } = await h.load('./ScratchpadPanel.tsx');
    const { scratchpadTransport } = await h.load('../lib/scratchpad-client.ts');
    const render = changes => {
      props = { ...props, ...changes };
      return h.render(createElement(ScratchpadPanel, props));
    };
    function node(selector) {
      const value = h.view.container.querySelector(selector);
      assert.equal(value !== null, true, `Scratchpad node ${selector}`);
      return value;
    }
    function section(scope) { return node(`section[aria-label="${scope}"]`); }
    function editor(scope = 'Global') { return section(scope).querySelector('textarea'); }
    function button(name) {
      const values = [...h.view.container.querySelectorAll('button')].filter(value => value.getAttribute('aria-label') === name || value.textContent === name);
      assert.equal(values.length, 1, `one real Scratchpad button ${name}`);
      return values[0];
    }
    const api = {
      requests, phases, onWork, dispose, transport: scratchpadTransport,
      // Explicit named-action selection of ORIGINAL operations, never ports or
      // an arbitrary request's next observation. Handles retain promise identity.
      markOperations() { return operations.length; },
      operationsSince(mark) { return operations.slice(mark); },
      pendingOperationsSince(mark) { return operations.slice(mark).filter(operation => !operation.settled); },
      onePendingOperation(mark, label) {
        const admitted = api.pendingOperationsSince(mark);
        checked(() => assert.equal(admitted.length, 1, `one pending original operation: ${label}`));
        return admitted[0];
      },
      operationFor,
      async joinOperation(operation) {
        checked(() => assert.equal(operations.includes(operation), true, 'join an explicit original operation handle'));
        await act(async () => { await operation.promise; });
        healthy();
      },
      get terminalObserved() { return terminalObserved; },
      get terminalStorage() { return terminalStorage; },
      get view() { return h.view; },
      get subscriptions() { return focusSubscriptions.size + visibilitySubscriptions.size; },
      expect(plan) { checked(() => { assert.equal(closing, false); pending.push(plan); }); },
      projectCwd(projectId) {
        const cwd = Object.keys(projects).find(cwd => projects[cwd].projectId === projectId);
        assert.equal(Boolean(cwd), true, 'declared project input');
        return cwd;
      },
      projectRequests(cwd) { return requests.filter(request => request.plan.projectCwd === cwd); },
      read(projectId) { api.expect({ method: 'GET', projectId }); },
      save(projectId, text, revision) { api.expect({ method: 'PUT', projectId, text, revision }); },
      next(method, projectId) {
        const request = requests.find(value => !value.bodySent && value.method === method && value.plan.projectId === projectId);
        assert.equal(Boolean(request), true, `entered actual ${method} ${JSON.stringify(projectId)}`);
        return request;
      },
      async render(changes = {}) {
        await render({ open: true, projectCwd: '/projects/rich', onClose() {}, onWork, ...changes });
      },
      async rerender(changes) { await render(changes); },
      node, section, editor, button,
      status(scope = 'Global') { return section(scope).querySelector('[role="status"]').textContent; },
      async input(scope, text) { await input(h.view, editor(scope), text); },
      async click(name) { await click(h.view, button(name)); },
      async focus(scope = 'Global') { await act(async () => { editor(scope).focus(); }); },
      async headers(request, status = 200) {
        checked(() => assert.equal(request.headersSent, false));
        await act(async () => { request.sendHeaders(status); await request.headers.promise; });
        checked(() => assert.equal(request.jsonCalls, 1, 'actual default transport consumed response JSON'));
      },
      async body(request, value, { operation } = {}) {
        checked(() => {
          assert.equal(request.headersSent, true); assert.equal(request.bodySent, false);
          if (operation) assert.equal(operations.includes(operation), true, 'explicit operation handle, not a response/body promise');
        });
        await act(async () => {
          request.sendBody(value);
          // Omission means NONTERMINAL delivery only. The caller explicitly joins
          // the selected original after all its declared inputs have been given.
          if (operation) await operation.promise;
        });
        healthy();
      },
      async reply(request, value, status = 200, options) {
        await api.headers(request, status);
        await api.body(request, value, options);
      },
      async visibility(next) {
        h.view.window.document.visibilityState = next ? 'visible' : 'hidden';
        await h.view.dispatch(h.view.window.document, new h.view.window.Event('visibilitychange'));
      },
      async storageEvent(key, newValue) {
        await h.view.dispatch(h.view.window, new h.view.window.StorageEvent('storage', { key, newValue, storageArea: h.view.window.sessionStorage }));
      },
      snapshotStorage() { return storageBytes(realmStorage); },
      peer,
      async complete() {
        await act(async () => { await joinOriginals(); });
        assert.equal(pending.length, 0, 'every declared request actually entered');
        healthy();
      },
    };
    return api;
  } catch (primary) {
    try { await dispose(); } catch (cleanup) { throw failureAggregate([primary, cleanup], 'Scratchpad setup/graph and disposal failed'); }
    throw primary;
  }
  function healthy() {
    if (failures.length) throw failureAggregate([...failures], `Scratchpad caught failures: ${failures.length}`);
  }
  function peer(start) {
    return checked(() => {
      if (closing) throw new Error('Unexpected Scratchpad peer start after close');
      const work = start();
      onWork(work); // Original independent HTTP/JSON job, not just its headers/body.
      return work;
    });
  }
}
