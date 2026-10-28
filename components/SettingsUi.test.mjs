import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement as h, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { settingsFixture } from './settings.fixture.mjs';
import { createJiti } from 'jiti';

test('actual shared primitives render semantic hierarchy, statuses, variants and embedded/modal shells', async t => {
  const f = await settingsFixture(t), c = await f.load('ui');
  const tree = embedded => h(c.ConfigPanelShell, { embedded, title: 'Configuration', subtitle: '/project', onClose() {} },
    h(c.ConfigSplitView, null,
      h(c.ConfigSidebar, null, h(c.ConfigSidebarList, null, h(c.ConfigSidebarGroupLabel, null, 'Group'),
        h(c.ConfigSidebarItem, { active: true }, h(c.ConfigStatusDot, { active: false }), h(c.ConfigSidebarText, null, 'Name'))), h(c.ConfigListAction, null, 'New')),
      h(c.ConfigDetail, null, h(c.ConfigDetailStack, null,
        h(c.ConfigDetailHeader, null, h(c.ConfigDetailHeaderInfo, null, h(c.ConfigDetailTitle, null, 'Title')), h(c.ConfigDetailActions, null, h(c.ConfigSwitch, { checked: true, label: 'Enabled', onChange() {} }))),
        h(c.ConfigSectionTitle, null, 'Section'), h(c.ConfigField, { label: 'Field' }, 'Value'), h(c.ConfigEmptyState, null, 'Empty')))),
    h(c.ConfigFooter, { status: 'status' }, h(c.ConfigButton, { variant: 'primary' }, 'Save')));
  for (const embedded of [false, true]) {
    const html = renderToStaticMarkup(tree(embedded));
    for (const className of ['config-panel-surface', 'config-split-view', 'config-sidebar', 'config-sidebar-list', 'config-sidebar-item', 'config-sidebar-text', 'config-sidebar-group-label', 'config-detail', 'config-detail-stack', 'config-detail-header', 'config-detail-header-info', 'config-detail-actions', 'config-detail-title', 'config-section-title', 'config-field', 'config-empty-state', 'config-footer', 'config-button-primary', 'config-switch', 'config-list-action-button', 'config-status-dot is-inactive']) assert.equal(html.includes(className), true, className);
    assert.equal(html.includes('role="dialog"'), !embedded);
    assert.equal(html.includes('config-close-button'), !embedded);
    assert.equal(html.includes('aria-current="page"'), true);
    assert.equal(html.includes('aria-checked="true"'), true);
    assert.equal(html.includes('onmouseenter'), false);
  }
});

test('actual sidebar/button/switch actions use current closures, native disabled state, and exact backdrop targeting', async t => {
  const f = await settingsFixture(t), c = await f.load('ui'); let calls = [];
  const render = (version, checked, loading = false, embedded = false) => h(c.ConfigPanelShell, { embedded, title: 'Title', onClose() { calls.push(`close-${version}`); } },
    h(c.ConfigSidebarItem, { active: checked, onClick() { calls.push(`row-${version}`); } }, 'row'),
    h(c.ConfigListAction, { active: checked, onClick() { calls.push(`new-${version}`); } }, 'new'),
    h(c.ConfigSwitch, { checked, loading, label: 'Enabled', onChange(value) { calls.push([version, value]); } }),
    h(c.ConfigButton, { disabled: loading, onClick() { calls.push(`save-${version}`); } }, 'Save'));
  await f.mount(render('A', false));
  await f.click('[role="switch"]'); assert.deepEqual(calls, [['A', true]]);
  const original = f.node('.config-sidebar-item');
  await f.rerender(render('B', true));
  assert.equal(f.node('.config-sidebar-item') === original, true, 'same real row after rerender');
  await f.click('.config-sidebar-item'); await f.click('.config-list-action-button'); await f.click('[role="switch"]');
  await f.click('.config-panel-surface'); assert.equal(calls.some(value => value === 'close-B'), false, 'inner click is not backdrop');
  await f.click('.config-panel-root');
  assert.deepEqual(calls.slice(1), ['row-B', 'new-B', ['B', false], 'close-B']);
  await f.rerender(render('C', true, true));
  const control = f.node('[role="switch"]'); assert.equal(control.disabled, true); assert.equal(control.getAttribute('aria-busy'), 'true');
  const count = calls.length;
  await f.view.dispatch(control, new f.view.window.MouseEvent('click', { bubbles: true }));
  assert.equal(calls.length, count, 'disabled native button does not invoke callback');
  await f.rerender(render('D', true, false, true));
  assert.equal(f.view.container.querySelector('.config-close-button') === null, true);
  await f.click('.config-panel-root'); assert.equal(calls.length, count, 'embedded is not a dismissal backdrop');
});

test('actual four config sections use the shared hierarchy, and embedded sections omit repeated close', async t => {
  const f = await settingsFixture(t), c = await f.load();
  for (const name of ['ModelsConfig', 'SkillsConfig', 'AgentsConfig', 'PluginsConfig']) {
    const html = renderToStaticMarkup(h(c.I18nProvider, null, h(c[name], { embedded: true, cwd: '/project', onClose() {} })));
    for (const className of ['config-panel-root is-embedded', 'config-split-view', 'config-sidebar', 'config-detail', 'config-detail-stack', 'config-footer']) assert.equal(html.includes(className), true, `${name}: ${className}`);
    assert.equal(html.includes('config-close-button'), false, `${name}: single Settings close owner`);
  }
  assert.equal(f.requests.length, 0, 'SSR starts no settings HTTP work');
});

// Exact declaration and stylesheet/import ownership, not DOM geometry or event proof.
test('settings stylesheet owns fixed sizing, typography, interaction presentation and footer alignment', async () => {
  const css = await readFile(new URL('../app/settings.css', import.meta.url), 'utf8');
  const globals = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.match(layout, /import "\.\/globals\.css";\s*import "\.\/settings\.css";/);
  for (const name of ['config-panel-root', 'settings-dialog-backdrop']) { assert.match(css, new RegExp(`\\.${name} \\{`)); assert.doesNotMatch(globals, new RegExp(`\\.${name} \\{`)); }
  for (const expression of [
    /\.config-sidebar \{[\s\S]*?width: 240px/, /\.config-detail \{[\s\S]*?padding: 20px/,
    /@media \(max-width: 640px\)[\s\S]*?\.config-sidebar \{[\s\S]*?width: 100%/, /@media \(max-width: 640px\)[\s\S]*?\.config-detail \{[\s\S]*?padding: 14px/,
    /\.config-sidebar-text \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 12px/, /\.config-sidebar-group-label \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 10px/,
    /\.config-sidebar-item:not\(:disabled\):hover,[\s\S]*?background: var\(--bg-hover\)/, /\.config-sidebar-item:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\)/,
    /\.config-sidebar-item \{[\s\S]*?height: 30px[\s\S]*?padding: 0 8px/, /\.config-list-action-button \{[\s\S]*?height: 30px[\s\S]*?min-height: 30px/,
    /\.config-detail-stack \{[\s\S]*?gap: 16px[\s\S]*?width: 100%/, /\.config-field-label \{[\s\S]*?font-size: 11px/, /\.config-empty-state \{[\s\S]*?font-size: 12px/,
    /\.config-detail-actions \{[\s\S]*?justify-content: flex-end[\s\S]*?margin-left: auto/, /\.config-footer-actions \{[\s\S]*?justify-content: flex-end/,
    /\.config-footer-actions \.config-button-default \{[\s\S]*?min-width: 96px/, /\.config-button \{[\s\S]*?font-family: inherit/, /\.config-button-default \{[\s\S]*?height: 32px/,
  ]) assert.match(css, expression);
  assert.doesNotMatch(css, /\.config-detail-stack \{[\s\S]*?max-width: 720px/);
});

// Retained exact shared-component adoption/stylesheet contracts. Their scope is structural;
// event, loaded-data and native/browser behavior are not inferred from these checks.
const templateSource = await readFile(new URL("./SettingsUi.tsx", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../app/settings.css", import.meta.url), "utf8");
const enSource = await readFile(new URL("../lib/i18n/messages/en.ts", import.meta.url), "utf8");
const configSources = await Promise.all(
  ["ModelsConfig", "SkillsConfig", "AgentsConfig", "PluginsConfig"].map(async (name) => [
    name,
    await readFile(new URL(`./${name}.tsx`, import.meta.url), "utf8"),
  ]),
);


test("all four settings sections use the shared list-detail layout", () => {
  for (const [name, source] of configSources) {
    for (const primitive of ["ConfigPanelShell", "ConfigSplitView", "ConfigSidebar", "ConfigDetail", "ConfigFooter"]) {
      assert.match(source, new RegExp(`<${primitive}`), `${name} should use ${primitive}`);
    }
  }
});

test("all subpanel sidebars share one typography scale", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-sidebar-text \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 12px/);
  assert.match(cssSource, /\.config-sidebar-group-label \{[\s\S]*?font-family: inherit[\s\S]*?font-size: 10px/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigSidebarText/);
  }
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarGroupLabel/);
  }
});

test("skills and sub-agents share interactive sidebar rows", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSidebarItem/);
  }
  assert.match(templateSource, /export function ConfigSidebarItem[\s\S]*?className=\{\["config-sidebar-item"/);
  assert.match(cssSource, /\.config-sidebar-item:not\(:disabled\):hover,[\s\S]*?background: var\(--bg-hover\)/);
  assert.match(cssSource, /\.config-sidebar-item:focus-visible \{[\s\S]*?outline: 2px solid var\(--accent\)/);
  assert.doesNotMatch(templateSource, /setHovered|setFocusVisible|useState/);
  assert.doesNotMatch(sources.SkillsConfig, /onMouseEnter[\s\S]*?var\(--bg-hover\)/);
});

test("plugin sidebar rows omit detail metadata", () => {
  const pluginSource = Object.fromEntries(configSources).PluginsConfig;
  const sidebarSource = pluginSource.match(/<ConfigSidebarList>[\s\S]*?<\/ConfigSidebarList>/)?.[0] ?? "";
  assert.match(sidebarSource, /<ConfigSidebarItem/);
  assert.match(sidebarSource, /<ConfigSidebarText[\s\S]*?\{pkg\.source\}/);
  assert.doesNotMatch(sidebarSource, /resourceSummary\(pkg|versionSummary\(pkg/);
});

test("skill scope group labels are localized", () => {
  const skillsSource = Object.fromEntries(configSources).SkillsConfig;
  for (const scope of ["global", "project", "path"]) {
    assert.match(skillsSource, new RegExp(`t\\("skills\\.scope\\.${scope}"\\)`));
    assert.match(enSource, new RegExp(`"skills\\.scope\\.${scope}":`));
  }
});

test("all subpanel detail panes share one content hierarchy", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-detail-stack \{[\s\S]*?gap: 16px[\s\S]*?width: 100%/);
  assert.doesNotMatch(cssSource, /\.config-detail-stack \{[\s\S]*?max-width: 720px/);
  assert.match(cssSource, /\.config-field-label \{[\s\S]*?font-size: 11px/);
  assert.match(cssSource, /\.config-empty-state \{[\s\S]*?font-size: 12px/);
  for (const source of Object.values(sources)) {
    assert.match(source, /<ConfigDetailStack/);
    assert.match(source, /<ConfigEmptyState/);
  }
});

test("detail header actions keep buttons and switches aligned to the right", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-detail-actions \{[\s\S]*?justify-content: flex-end[\s\S]*?margin-left: auto/);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigDetailActions>/);
  }
  assert.match(sources.PluginsConfig, /<ConfigDetailActions>[\s\S]*?<ConfigSwitch[\s\S]*?<\/ConfigDetailActions>/);
});

test("keeps shared static presentation in the stylesheet", () => {
  assert.doesNotMatch(templateSource, /<style>/);
  assert.doesNotMatch(templateSource, /style=\{\{/);
  assert.doesNotMatch(templateSource, /onMouseEnter|onMouseLeave/);
  for (const className of [
    "config-panel-surface",
    "config-split-view",
    "config-sidebar-item",
    "config-detail-stack",
    "config-button",
    "config-switch",
  ]) {
    assert.match(templateSource, new RegExp(className));
    assert.match(cssSource, new RegExp(`\\.${className}\\b`));
  }
});

test("embedded sections do not repeat Settings close actions", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(sources.ModelsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.cancel"\)\}/);
  assert.match(sources.SkillsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.close"\)\}/);
  assert.match(sources.PluginsConfig, /!embedded && <ConfigButton onClick=\{onClose\}>\{t\("i18n\.close"\)\}/);
});

test("subpanel footers share sizing while maintenance actions stay secondary", () => {
  const sources = Object.fromEntries(configSources);
  assert.match(cssSource, /\.config-footer-actions \{[\s\S]*?justify-content: flex-end/);
  assert.match(cssSource, /\.config-footer-actions \.config-button-default \{[\s\S]*?min-width: 96px/);
  assert.match(cssSource, /\.config-button \{[\s\S]*?font-family: inherit/);
  assert.match(cssSource, /\.config-button-default \{[\s\S]*?height: 32px/);
  assert.match(sources.ModelsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{handleSave\}/);
  assert.match(sources.AgentsConfig, /<ConfigButton\s+variant="primary"[\s\S]*?onClick=\{\(\) => void save\(\)\}/);
  assert.match(sources.SkillsConfig, /<ConfigButton variant="secondary" onClick=\{\(\) => void checkForUpdates\(\)\}/);
  assert.match(sources.PluginsConfig, /<ConfigButton variant="secondary" onClick=\{\(\) => void loadPlugins\(\)\}/);
});

test("skills, agents, and plugins share enabled and disabled controls", () => {
  const sources = Object.fromEntries(configSources);
  for (const name of ["SkillsConfig", "AgentsConfig", "PluginsConfig"]) {
    assert.match(sources[name], /<ConfigSwitch/);
    assert.match(sources[name], /<ConfigStatusDot/);
  }
});



test('actual passive settings completion adapter preserves promise identity and observes the entire supplied callback chain', async t => {
  const f = await settingsFixture(t), c = await f.load('ui'); let task;
  function Probe() { task = c.useSettingsTask(); return null; }
  await f.mount(h(Probe));
  const gate = f.gate('original settings operation'); let callbackFinished = false, returned;
  const original = gate.promise.then(() => { callbackFinished = true; return 7; });
  await act(async () => { returned = task('adapter.original-chain', () => original)(); });
  assert.equal(returned === original, true, 'adapter returns the actual original promise');
  assert.equal(f.works.filter(work => work.label === 'adapter.original-chain').length, 1, 'complete work observation is not optional inside the provided diagnostic scope');
  assert.equal(callbackFinished, false);
  await f.deliver(gate, 'adapter.original-chain');
  assert.equal(callbackFinished, true);
  assert.equal(await returned, 7);
});

// H-VERSION: one batched case in the existing settings owner, not a new fixture.
// Raw legacy locale/storage inputs are deliberately NOT changed to English.
// Expected text is bound to the real English message data used by this source;
// this does not assert that Chinese translations exist or emulate browser layout.
test('actual WebVersionNotice owns original checks across legacy locale inputs, visibility, poll and unmount', async t => {
  for (const input of [
    { id: 'legacy-desktop', language: 'zh-CN', storedLocale: 'zh-CN', width: 1280, height: 800, touch: false },
    { id: 'legacy-mobile', language: 'zh-TW', storedLocale: 'zh-TW', width: 390, height: 844, touch: true },
  ]) {
    const clientVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';
    assert.notEqual(clientVersion, '99.99.99', 'retain the original mismatch input; do not rewrite the client-version environment');
    const hostFailures = [], realmFailures = [], hostDiagnostics = [], lifetime = [], fixtureCleanups = [];
    const heldBodies = [], plans = [], checks = [], fetches = [], bodies = [], observationTails = [];
    const intervals = [], clearedIntervals = [], addedVisibility = [], removedVisibility = [], confirmations = [];
    let f, c, observeWork, realmSave, realmWindow, removeRealmCollector, realmRestored = false, cleanupPromise;
    const consoleDescriptor = Object.getOwnPropertyDescriptor(console, 'error');
    const nativeConsoleError = console.error;
    const onHostRejection = error => { hostFailures.push(error); };
    const onHostException = error => { hostFailures.push(error); };
    const releaseAllKnownBodies = () => { for (const gate of heldBodies) gate.release(); };
    const joinObservationTails = async () => {
      const errors = []; let cursor = 0;
      while (cursor < observationTails.length) {
        const batch = observationTails.slice(cursor); cursor = observationTails.length;
        for (const result of await Promise.allSettled(batch)) if (result.status === 'rejected') errors.push(result.reason);
      }
      if (errors.length) throw new AggregateError(errors, 'Version passive observation failures');
    };
    const joinCapturedOriginals = async () => {
      const errors = []; let cursor = 0;
      while (cursor < checks.length) {
        const batch = checks.slice(cursor); cursor = checks.length;
        for (const result of await Promise.allSettled(batch.map(check => check.promise))) if (result.status === 'rejected') errors.push(result.reason);
      }
      try { await joinObservationTails(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'Version original work and observations');
    };
    // The one early owner also receives the existing fixture's cleanup registration
    // if fixture construction/import/mount fails before f or a view can escape.
    const cleanup = () => cleanupPromise ??= (async () => {
      const errors = [];
      releaseAllKnownBodies(); // Release EVERY held peer before invoking ANY join.
      for (const dispose of fixtureCleanups) {
        try { await dispose(); } catch (error) { errors.push(error); }
      }
      lifetime.push('fixture-cleanup-returned');
      if (realmWindow && !realmRestored) errors.push(new Error('Independent realm collectors were not restored before fixture destruction'));
      try { process.off('unhandledRejection', onHostRejection); } catch (error) { errors.push(error); }
      try { process.off('uncaughtExceptionMonitor', onHostException); } catch (error) { errors.push(error); }
      try { Object.defineProperty(console, 'error', consoleDescriptor); } catch (error) { errors.push(error); }
      lifetime.push('host-restored');
      if (hostFailures.length || realmFailures.length || hostDiagnostics.length || errors.length) {
        // Original Error/rejection objects (and original diagnostic argument arrays)
        // remain causes, including failures independently seen by settingsFixture.
        throw new AggregateError([...hostFailures, ...realmFailures, ...hostDiagnostics, ...errors], `Version ${input.id} lifetime failures`);
      }
    })();
    t.after(cleanup);
    process.on('unhandledRejection', onHostRejection);
    process.on('uncaughtExceptionMonitor', onHostException);
    Object.defineProperty(console, 'error', { configurable: true, writable: true, value: (...args) => {
      hostDiagnostics.push(args);
      nativeConsoleError(...args);
    } });
    lifetime.push('host-collectors-installed');
    const capture = (observer, originalPromise) => {
      const check = { observer, promise: originalPromise, state: 'pending' };
      checks.push(check);
      observeWork('web-version.check', originalPromise); // Existing f.works owns the EXACT original, never a gate or observer tail.
      observationTails.push(originalPromise.then(value => { check.state = 'fulfilled'; check.value = value; }, error => { check.state = 'rejected'; check.reason = error; }));
    };
    const observerA = originalPromise => capture('A', originalPromise);
    const observerB = originalPromise => capture('B', originalPromise);
    f = await settingsFixture({ after(dispose) { fixtureCleanups.push(dispose); } }, {
      beforeRestore({ target, key }) {
        if (target === realmWindow && key === 'removeEventListener' && !realmRestored) {
          const errors = [];
          for (const [type, listener] of removeRealmCollector.listeners) {
            try { removeRealmCollector.remove(type, listener); } catch (error) { errors.push(error); }
          }
          realmRestored = true;
          lifetime.push('realm-restored');
          if (errors.length) throw new AggregateError(errors, 'Independent version realm collector restoration');
        }
      },
      capabilities({ save, saveRealm, observe, onSettle }) {
        observeWork = observe; realmSave = saveRealm;
        // Delegate every unrelated capability to the existing fixture fence/native
        // implementation. Only the production 60000ms interval is controlled.
        const intervalDelegate = globalThis.setInterval, clearDelegate = globalThis.clearInterval;
        save(globalThis, 'setInterval', function (callback, delay, ...args) {
          if (delay !== 60_000) return Reflect.apply(intervalDelegate, this, [callback, delay, ...args]);
          const interval = { token: {}, callback, delay, args, active: true };
          intervals.push(interval); return interval.token;
        });
        save(globalThis, 'clearInterval', function (token) {
          const interval = intervals.find(entry => entry.token === token);
          if (!interval) return Reflect.apply(clearDelegate, this, [token]);
          clearedIntervals.push(token); interval.active = false;
        });
        const fetchDelegate = globalThis.fetch;
        save(globalThis, 'fetch', function (...args) {
          const originalFetch = Reflect.apply(fetchDelegate, this, args);
          const entry = { promise: originalFetch, state: 'pending' }; fetches.push(entry);
          observationTails.push(originalFetch.then(response => {
            entry.state = 'fulfilled'; entry.response = response;
            const jsonDelegate = response.json;
            response.json = function (...jsonArgs) {
              const originalBody = Reflect.apply(jsonDelegate, this, jsonArgs);
              const body = { promise: originalBody, state: 'pending', finallyRan: false }; bodies.push(body);
              observationTails.push(originalBody.then(value => { body.state = 'fulfilled'; body.value = value; }, error => { body.state = 'rejected'; body.reason = error; })
                .finally(() => { body.finallyRan = true; }));
              return originalBody; // No replacement body promise or fake parsed version.
            };
          }, error => { entry.state = 'rejected'; entry.reason = error; }));
          return originalFetch;
        });
        onSettle(() => {
          releaseAllKnownBodies(); // Synchronous peer releases, including failed setup, precede all joins below.
          return joinCapturedOriginals(); // Same originals also belong to f.works; no empty-Set or gate-as-idle certificate.
        });
      },
      loadGraph: async () => {
        const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
        // Existing, real I18nProvider/SettingsWorkContext scaffold. Defer ONLY the
        // original version-owner import until mount.setup has a realm to fence.
        const ui = await jiti.import('./settings-ui.fixture.tsx');
        return { ...ui, async loadOriginalGraph() {
          lifetime.push('original-version-import-start');
          const [version, messageModule] = await Promise.all([
            jiti.import('./WebVersionNotice.tsx'), jiti.import('../lib/i18n/messages/en.ts'),
          ]);
          Object.assign(c, version);
          c.versionMessages = messageModule.enLocale?.messages;
          assert.ok(c.versionMessages && ['appUpdate.runningVersionChanged', 'appUpdate.reloadWarning', 'appUpdate.reloadWeb']
            .every(key => Object.hasOwn(c.versionMessages, key)), 'bind expected text to the actual exported enLocale.messages, not a guessed zh translation');
          lifetime.push('original-version-import-end');
        } };
      },
    });
    f.route('GET', '/api/app-version', { cache: 'no-store', reply() {
      // Explicit fallback keeps a visibility/restart producer fault reachable as
      // a request-count assertion, not an unexpected-route/setup exception.
      const reply = plans.shift() ?? { data: { version: clientVersion } };
      if (Object.hasOwn(reply, 'fetchError')) return reply;
      const gate = f.gate(`${input.id} version body ${heldBodies.length + 1}`);
      heldBodies.push(gate); return { ...reply, gate };
    } });
    c = await f.load('ui');
    assert.equal(typeof c.I18nProvider, 'function');
    assert.ok(c.SettingsWorkContext, 'use the existing real full-settlement context');
    function Owner({ observer }) { return h(c.WebVersionNotice, { onCheckWork: observer }); }
    // Preserve the existing fixture's Strict Effects replay: each admitted
    // original mount check receives the original initial null response.
    plans.push({ data: { version: null } }, { data: { version: null } });
    await f.mount(h(Owner, { observer: observerA }), { settle: false, setup: async window => {
      realmWindow = window;
      const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
      const onError = event => { realmFailures.push(event.error ?? event.message); };
      const onRejection = event => { realmFailures.push(event.reason); };
      removeRealmCollector = { remove, listeners: [['error', onError], ['unhandledrejection', onRejection]] };
      // Register restoration BEFORE listener installation or further setup can
      // fail. The existing beforeDispose contract restores it before realm close.
      realmSave(window, 'removeEventListener', function (...args) { return remove(...args); });
      // Native listeners, independent of the fixture's own realm collectors.
      add('error', onError); add('unhandledrejection', onRejection);
      const document = window.document;
      const documentAdd = document.addEventListener.bind(document), documentRemove = document.removeEventListener.bind(document);
      // settingsFixture's saveRealm port was captured during capabilities setup;
      // this owner uses the existing native descriptor restoration, never a realm
      // destroy hook or an unowned finalizer.
      realmSave(document, 'visibilityState', 'visible');
      realmSave(document, 'addEventListener', function (type, listener, options) {
        if (type === 'visibilitychange') addedVisibility.push({ listener, options });
        return documentAdd(type, listener, options);
      });
      realmSave(document, 'removeEventListener', function (type, listener, options) {
        if (type === 'visibilitychange') removedVisibility.push({ listener, options });
        return documentRemove(type, listener, options);
      });
      realmSave(window, 'fetch', globalThis.fetch);
      realmSave(window, 'clearInterval', globalThis.clearInterval);
      realmSave(window.navigator, 'language', input.language);
      realmSave(window.navigator, 'languages', [input.language]);
      realmSave(window.navigator, 'maxTouchPoints', input.touch ? 1 : 0);
      realmSave(window, 'innerWidth', input.width); realmSave(window, 'innerHeight', input.height);
      assert.equal(window.localStorage.length, 0, 'fresh original input storage; do not clear or normalize it');
      window.localStorage.setItem('pi-locale', input.storedLocale);
      assert.equal(window.localStorage.getItem('pi-locale'), input.storedLocale);
      assert.equal(window.navigator.language, input.language);
      const confirmDelegate = window.confirm.bind(window);
      realmSave(window, 'confirm', message => {
        if (message !== c.versionMessages?.['appUpdate.reloadWarning']) return confirmDelegate(message);
        confirmations.push(message); return false;
      });
      lifetime.push('realm-collectors-installed');
      await c.loadOriginalGraph();
    } });
    assert.ok(lifetime.indexOf('host-collectors-installed') < lifetime.indexOf('original-version-import-start'));
    assert.ok(lifetime.indexOf('realm-collectors-installed') < lifetime.indexOf('original-version-import-start'));
    const statusCount = () => f.view.container.querySelectorAll('[role="status"]').length;
    const finishPhase = async () => {
      await act(async () => { releaseAllKnownBodies(); await f.join('web-version.check'); await joinCapturedOriginals(); });
      f.check();
    };
    const invokeVisibility = () => {
      const count = checks.length;
      const returned = Reflect.apply(activeVisibility.listener, realmWindow.document, [new realmWindow.Event('visibilitychange')]);
      assert.equal(checks.length, count + 1);
      assert.equal(returned, checks.at(-1).promise, 'registered startCheck returns the EXACT original check promise');
      assert.equal(returned, f.works.at(-1).promise, 'the existing full-settlement owner receives that same promise');
      return returned;
    };
    assert.equal(f.requests.length, 2, 'preserve both original checks admitted by the existing Strict Effects mount');
    assert.equal(checks.length, 2); assert.equal(bodies.length, 2);
    for (let index = 0; index < 2; index++) {
      assert.equal(checks[index].observer, 'A');
      assert.equal(checks[index].promise, f.works[index].promise);
      assert.equal(checks[index].state, 'pending', 'neither original check can finish before its held body/catch continuation');
      assert.equal(bodies[index].state, 'pending');
    }
    assert.equal(statusCount(), 0, 'initial null is not an update');
    assert.equal(intervals.length, 2);
    for (const interval of intervals) { assert.equal(interval.delay, 60_000); assert.deepEqual(interval.args, []); }
    assert.equal(addedVisibility.length, 2); assert.equal(removedVisibility.length, 1);
    assert.equal(removedVisibility[0].listener, addedVisibility[0].listener, 'Strict Effects removes the exact first listener');
    assert.equal(clearedIntervals.length, 1); assert.equal(clearedIntervals[0], intervals[0].token);
    assert.equal(intervals[0].active, false); assert.equal(intervals[1].active, true);
    const activeVisibility = addedVisibility[1], activeInterval = intervals[1];
    const abandonedSignal = f.requests[0].signal, signal = f.requests[1].signal; let aborts = 0;
    assert.notEqual(abandonedSignal, signal); assert.equal(abandonedSignal.aborted, true);
    assert.equal(signal.aborted, false); signal.addEventListener('abort', () => { aborts++; });
    await finishPhase();
    for (let index = 0; index < 2; index++) {
      assert.equal(checks[index].state, 'fulfilled'); assert.equal(checks[index].value, undefined);
      assert.deepEqual(bodies[index].value, { version: null }, 'both original initial API null bodies are parsed and fully settled, including the obsolete effect');
    }
    assert.equal(statusCount(), 0, 'original API null remains hidden before the 99.99.99 response');
    const requestCount = f.requests.length;
    await f.rerender(h(Owner, { observer: observerB }));
    assert.equal(f.requests.length, requestCount, 'changing only the passive observer does not restart the effect');
    assert.equal(intervals.length, 2); assert.equal(addedVisibility.length, 2); assert.equal(removedVisibility.length, 1);
    assert.equal(signal.aborted, false);
    plans.push({ data: { version: '99.99.99' } });
    await act(async () => { assert.equal(activeInterval.callback(), undefined, 'public interval callback remains void, not an awaited observer'); });
    assert.equal(checks.at(-1).observer, 'B', 'latest observer receives the next original check');
    assert.equal(checks.at(-1).state, 'pending'); assert.equal(statusCount(), 0);
    await finishPhase();
    const message = c.versionMessages['appUpdate.runningVersionChanged'].replace('{version}', '99.99.99');
    assert.ok(message.includes('Brabbler v99.99.99 is running.'), 'retain the original History substring expectation against the actual full catalog message');
    let status = f.node('[role="status"]');
    const button = f.button(c.versionMessages['appUpdate.reloadWeb']);
    assert.equal(status.querySelector('span').textContent, message);
    await f.click(button);
    assert.deepEqual(confirmations, [c.versionMessages['appUpdate.reloadWarning']], 'controlled cancel observes the actual warning; true/native reload stays in original LD browser bridge');
    plans.push({ data: { version: '99.99.99' } });
    await act(async () => { void invokeVisibility(); });
    await finishPhase();
    assert.equal(f.node('[role="status"]'), status, 'same mismatch does not replace the actual status');
    assert.equal(f.button(c.versionMessages['appUpdate.reloadWeb']), button);
    for (const data of [{ version: 99 }, { version: null }]) {
      plans.push({ data }); await act(async () => { void invokeVisibility(); }); await finishPhase();
      assert.equal(status.querySelector('span').textContent, message, 'non-string version must not replace the last adopted string');
    }
    plans.push({ data: { version: clientVersion } });
    await act(async () => { void invokeVisibility(); }); await finishPhase();
    assert.equal(statusCount(), 0, 'server == unchanged CLIENT_VERSION hides the update without changing the client-version input');
    assert.equal(status.isConnected, false);
    plans.push({ data: { version: '99.99.99' } });
    await act(async () => { void invokeVisibility(); }); await finishPhase();
    status = f.node('[role="status"]');
    assert.equal(status.querySelector('span').textContent, message);
    realmWindow.document.visibilityState = 'hidden';
    const hiddenRequests = f.requests.length, hiddenChecks = checks.length;
    await act(async () => { void invokeVisibility(); });
    assert.equal(f.requests.length, hiddenRequests, 'hidden direct check admits no HTTP');
    await finishPhase();
    await act(async () => { realmWindow.document.dispatchEvent(new realmWindow.Event('visibilitychange')); });
    assert.equal(checks.length, hiddenChecks + 2, 'native visibility dispatch invokes the actually registered callback');
    assert.equal(f.requests.length, hiddenRequests, 'hidden native dispatch also admits no HTTP');
    await finishPhase();
    realmWindow.document.visibilityState = 'visible'; plans.push({ data: { version: '99.99.99' } });
    await act(async () => { realmWindow.document.dispatchEvent(new realmWindow.Event('visibilitychange')); });
    assert.equal(f.requests.length, hiddenRequests + 1, 'becoming visible admits exactly one original fetch');
    assert.equal(checks.at(-1).state, 'pending'); await finishPhase();
    const bodiesBeforeNonOk = bodies.length;
    plans.push({ status: 503, data: { version: '88.88.88' } });
    await act(async () => { void invokeVisibility(); }); await finishPhase();
    assert.equal(bodies.length, bodiesBeforeNonOk, 'non-ok preserves original no-json policy');
    assert.equal(status.querySelector('span').textContent, message);
    const fetchError = new Error(`${input.id}: original offline fetch failure`);
    plans.push({ fetchError }); await act(async () => { void invokeVisibility(); }); await finishPhase();
    assert.equal(fetches.at(-1).state, 'rejected'); assert.equal(fetches.at(-1).reason, fetchError);
    assert.equal(checks.at(-1).state, 'fulfilled'); assert.equal(checks.at(-1).value, undefined, 'original offline policy catches without replacing the error observed at the capability');
    assert.equal(status.querySelector('span').textContent, message);
    const bodyError = new Error(`${input.id}: original version body failure`);
    plans.push({ bodyError }); await act(async () => { void invokeVisibility(); });
    assert.equal(checks.at(-1).state, 'pending'); await finishPhase();
    assert.equal(bodies.at(-1).state, 'rejected'); assert.equal(bodies.at(-1).reason, bodyError); assert.equal(bodies.at(-1).finallyRan, true);
    assert.equal(checks.at(-1).state, 'fulfilled'); assert.equal(checks.at(-1).value, undefined);
    assert.equal(status.querySelector('span').textContent, message);
    const lateBodyError = new Error(`${input.id}: held body fails after abort`);
    plans.push({ data: { version: '99.99.99' } }, { bodyError: lateBodyError });
    await act(async () => { void invokeVisibility(); void invokeVisibility(); });
    const pending = checks.slice(-2), pendingBodies = bodies.slice(-2);
    assert.deepEqual(pending.map(check => check.state), ['pending', 'pending']);
    await f.rerender(null); // Unmount only the original component; the realm and collectors remain live.
    assert.equal(signal.aborted, true); assert.equal(aborts, 1);
    assert.equal(clearedIntervals.length, 2); assert.equal(clearedIntervals[1], activeInterval.token);
    assert.ok(intervals.every(interval => !interval.active));
    assert.equal(removedVisibility.length, 2);
    for (let index = 0; index < 2; index++) {
      assert.equal(removedVisibility[index].listener, addedVisibility[index].listener, 'both cleanups remove EXACTLY their registered startCheck');
      assert.equal(removedVisibility[index].options, addedVisibility[index].options);
    }
    const unmountedRequests = f.requests.length, unmountedChecks = checks.length;
    await act(async () => { realmWindow.document.dispatchEvent(new realmWindow.Event('visibilitychange')); });
    assert.equal(f.requests.length, unmountedRequests); assert.equal(checks.length, unmountedChecks, 'removed native listener admits no late root');
    assert.equal(status.isConnected, false); assert.equal(statusCount(), 0);
    // The capability deliberately ignores abort. Both successful and failed
    // original bodies must finish, including production catch, not just gates.
    await finishPhase();
    assert.equal(pendingBodies[0].state, 'fulfilled'); assert.deepEqual(pendingBodies[0].value, { version: '99.99.99' });
    assert.equal(pendingBodies[1].state, 'rejected'); assert.equal(pendingBodies[1].reason, lateBodyError);
    assert.ok(pendingBodies.every(body => body.finallyRan));
    assert.ok(pending.every(check => check.state === 'fulfilled' && check.value === undefined));
    assert.equal(statusCount(), 0, 'settled ignored-abort work does not adopt a visible update after unmount');
    assert.ok(f.requests.slice(1).every(request => request.signal === signal), 'the one retained original effect/controller spans observer change and all subsequent checks');
    assert.equal(f.requests[0].signal, abandonedSignal, 'the original obsolete Strict Effects check remains independently owned');
    assert.equal(checks.length, 16); assert.equal(f.requests.length, 14); assert.equal(bodies.length, 12);
    assert.equal(f.works.length, 16); assert.ok(f.works.every(work => work.settled));
    assert.ok(checks.every((check, index) => check.promise === f.works[index].promise));
    assert.equal(plans.length, 0); f.check();
    await cleanup();
    assert.ok(lifetime.indexOf('realm-restored') < lifetime.indexOf('fixture-cleanup-returned'));
    assert.ok(lifetime.indexOf('fixture-cleanup-returned') < lifetime.indexOf('host-restored'));
  }
});

// SOURCE-ONLY proposal: append to the EXISTING SettingsUi.test.mjs.
// Uses its existing settingsFixture/native fence; no second settings platform.
async function workflowSettingsFixture(t) {
  let saveRealm;
  const f = await settingsFixture(t, {
    capabilities(api) { saveRealm = api.saveRealm; },
    loadGraph: async () => {
      // Import only after the existing fixture installs its fences and collectors.
      const { createJiti } = await import('jiti');
      const jiti = createJiti(import.meta.url, { fsCache: false, jsx: { runtime: 'automatic' }, tsconfigPaths: true });
      const i18n = await jiti.import('../hooks/useI18n.tsx');
      const ui = await jiti.import('./SettingsUi.tsx');
      const plugin = await jiti.import('./plugin-ui/BundledPluginSettings.tsx');
      const policyData = await jiti.import('../plugins/git-workflow/manifest.ts');
      const { PluginsConfig } = await jiti.import('./PluginsConfig.tsx');
      const { SettingsPanel } = await jiti.import('./SettingsPanel.tsx');
      const { sessionLaunchManifest } = await jiti.import('../plugins/session-launch/manifest.ts');
      return { I18nProvider: i18n.I18nProvider, SettingsWorkContext: ui.SettingsWorkContext,
        WorkflowSettings: plugin.BundledPluginSettings, PluginsConfig, SettingsPanel, sessionLaunchManifest, ...policyData };
    },
  });
  const setup = window => {
    // Unsupported APIs only: no native modal, inertness, geometry or Tab claim.
    const proto = window.HTMLDialogElement.prototype;
    if (typeof proto.showModal !== 'function') saveRealm(proto, 'showModal', function () { this.open = true; });
    if (typeof proto.close !== 'function') saveRealm(proto, 'close', function () { this.open = false; });
    if (typeof window.HTMLElement.prototype.scrollIntoView !== 'function') saveRealm(window.HTMLElement.prototype, 'scrollIntoView', function () {});
  };
  return { f, c: await f.load(), setup };
}
const matrixCell = (f, key, scope) => f.node(`[data-setting-cell="${key}:${scope}"]`);
const matrixDialog = f => f.node('.plugin-matrix-dialog[open]');
async function matrixDraft(f, key, scope, value, options) {
  await f.click(matrixCell(f, key, scope), options);
  await f.click(matrixDialog(f).querySelector('input[value="custom"]'), options);
  if (value !== undefined) await f.input(matrixDialog(f).querySelector('[aria-label="Value"]'), value, options);
}
async function matrixPreset(f, scope, preset) {
  const before = f.requests.length;
  await f.click(f.button('Workflow presets'));
  await f.input(matrixDialog(f).querySelector('[aria-label="Save workflow choices to"]'), scope);
  await f.input(matrixDialog(f).querySelector('[aria-label="Workflow preset"]'), preset);
  assert.equal(f.requests.length, before, 'choosing a preset and destination does not write');
  assert.match(matrixDialog(f).textContent, /ask_user/);
}
function workflowSnapshot(manifest, sessionId = '55555555-5555-4555-8555-555555555555', cwd = '/repo') {
  return { pluginId: manifest.id, schemaVersion: manifest.schemaVersion, project: cwd,
    sessionId, sessionProject: cwd, sessionApplicable: true, sessionOverrides: {}, enabled: true,
    global: { enabled: true, targetBranch: 'target' }, overrides: {},
    effective: { ...Object.fromEntries(Object.entries(manifest.fields).map(([key, field]) => [key, structuredClone(field.default)])), enabled: true, targetBranch: 'target' },
    sources: { ...Object.fromEntries(Object.keys(manifest.fields).map(key => [key, 'builtin'])), enabled: 'global', targetBranch: 'global' } };
}

test('actual bundled Git Workflow controls preserve scope bodies, effective sources and permission-neutral presets', async t => {
  const parentWork = [];
  const { f, c: { WorkflowSettings, gitWorkflowManifest: manifest, workflowPresets }, setup } = await workflowSettingsFixture(t);
  // Existing lower-owner identities: /repo HTTP capability and policy.test's
  // session UUID. They are NOT substitutes for a native browser checkout/handle.
  const cwd = '/repo', sessionId = '55555555-5555-4555-8555-555555555555';
  const defaults = Object.fromEntries(Object.entries(manifest.fields).map(([key, field]) => [key, structuredClone(field.default)]));
  const builtinSources = Object.fromEntries(Object.keys(manifest.fields).map(key => [key, 'builtin']));
  // Explicit response DATA, not a second scope-resolution implementation.
  const pluginSettings = { pluginId: manifest.id, schemaVersion: manifest.schemaVersion, project: cwd,
    sessionId, sessionProject: cwd, sessionApplicable: true, sessionOverrides: {},
    enabled: false, global: { enabled: false, targetBranch: 'target' }, overrides: {},
    effective: { ...defaults, enabled: false, targetBranch: 'target' },
    sources: { ...builtinSources, enabled: 'global', targetBranch: 'global' } };
  const enabled = { ...pluginSettings, enabled: true, global: { ...pluginSettings.global, enabled: true },
    effective: { ...pluginSettings.effective, enabled: true } };
  const projectDeny = { ...enabled, overrides: { commit: 'deny' },
    effective: { ...enabled.effective, commit: 'deny' }, sources: { ...enabled.sources, commit: 'project' } };
  const sessionAllow = { ...enabled, sessionOverrides: { commit: 'allow' },
    effective: { ...enabled.effective, commit: 'allow' }, sources: { ...enabled.sources, commit: 'session' } };
  const currentValues = workflowPresets['current-branch'].values, askValues = workflowPresets['always-ask'].values;
  assert.deepEqual(Object.keys(currentValues), Object.keys(askValues), 'cut preserves session-key insertion order for the whole-origin digest');
  const intentSources = Object.fromEntries(Object.keys(askValues).map(key => [key, 'session']));
  const currentBranch = { ...sessionAllow, sessionOverrides: { commit: 'allow', ...currentValues },
    effective: { ...sessionAllow.effective, ...currentValues }, sources: { ...sessionAllow.sources, ...intentSources } };
  const alwaysAsk = { ...sessionAllow, sessionOverrides: { commit: 'allow', ...askValues },
    effective: { ...sessionAllow.effective, ...askValues }, sources: { ...sessionAllow.sources, ...intentSources } };
  const finalSettings = { ...enabled, sessionOverrides: { ...askValues },
    effective: { ...enabled.effective, ...askValues }, sources: { ...enabled.sources, ...intentSources } };
  for (const recipe of [currentValues, askValues]) {
    for (const key of ['commit', 'rebase', 'merge', 'createWorktree', 'attachWorktree', 'removeWorktree',
      'cleanupFeature', 'discardResources', 'commitChecks', 'mergeChecks', 'targetBranch']) {
      assert.equal(Object.hasOwn(recipe, key), false, `workflow preset cannot grant/change ${key}`);
    }
  }
  let snapshot = pluginSettings, expectedBody, reply;
  const body = (scope, set, reset = []) => ({ pluginId: 'git-workflow', cwd, sessionId, scope, set, reset });
  f.route('GET', '/api/plugins/bundled', { query: { cwd, sessionId },
    reply: () => ({ data: { plugins: [{ manifest, settings: snapshot }] } }) });
  f.route('PATCH', '/api/plugins/bundled', { body: () => expectedBody, reply: () => reply });
  const element = initialScope => h(WorkflowSettings, { cwd, id: 'git-workflow', sessionId, initialScope,
    onWork: work => { parentWork.push(work); } });
  await f.mount(element('global'), { setup });
  const commit = scope => matrixCell(f, 'commit', scope);
  const fieldText = key => f.node(`[data-setting-row="${key}"]`).textContent;
  assert.deepEqual([...f.view.container.querySelectorAll('[data-scope-heading]')].map(node => node.textContent),
    ['All repositoriesShared defaults', 'repoRepository override', 'This sessionOwn repository only']);
  assert.equal(f.view.container.querySelector('select[aria-label="Plugin settings scope"]') === null, true);
  assert.equal(f.view.container.querySelectorAll('[role="columnheader"]').length, 4, 'one field heading plus exactly three scopes, no Effective scope');
  const save = async (expected, next, action) => {
    expectedBody = expected; reply = { data: { settings: next } };
    const from = f.requests.length, workFrom = f.works.length;
    await action(); // fixture joins ORIGINAL save/body/catch/finally, not just json()
    const requests = f.requests.slice(from);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'PATCH');
    assert.deepEqual(requests[0].body, expected);
    const saves = f.works.slice(workFrom).filter(work => work.label === 'plugins.bundledSettings.save');
    assert.equal(saves.length, 1);
    assert.equal(parentWork.includes(saves[0].promise), true, 'parent and Settings observe SAME complete save');
    assert.equal(saves[0].settled, true);
    snapshot = next;
  };
  await save(body('global', { enabled: true }), enabled, () => f.click('#plugin-enabled'));
  assert.equal(f.node('#plugin-enabled').checked, true);
  assert.match(f.node('#plugin-enabled').parentElement.textContent, /App-wide only · Saved here/);
  await matrixDraft(f, 'commit', 'project', 'deny');
  await save(body('project', { commit: 'deny' }), projectDeny, () => f.click(f.button('Save changes', matrixDialog(f))));
  assert.match(commit('project').textContent, /BlockSaved here/);
  assert.equal(commit('project').dataset.winning, 'true');
  await f.click(commit('project'));
  await f.click(matrixDialog(f).querySelector('input[value="follow"]'));
  await save(body('project', {}, ['commit']), enabled, () => f.click(f.button('Save changes', matrixDialog(f))));
  assert.match(commit('project').textContent, /↳ Built-in fallbackRequire approval/);
  assert.equal(commit('global').dataset.winning, 'true');
  await matrixDraft(f, 'commit', 'session', 'allow');
  await save(body('session', { commit: 'allow' }), sessionAllow, () => f.click(f.button('Save changes', matrixDialog(f))));
  assert.match(commit('session').textContent, /Without approvalSaved here/);
  assert.equal(commit('session').dataset.winning, 'true');
  await matrixPreset(f, 'session', 'current-branch');
  await save(body('session', currentValues), currentBranch, () => f.click(f.button('Apply workflow preset', matrixDialog(f))));
  assert.match(matrixCell(f, 'workspace', 'session').textContent, /Current branchSaved here/);
  assert.equal(matrixCell(f, 'workspace', 'session').dataset.winning, 'true');
  assert.match(commit('session').textContent, /Without approvalSaved here/);
  const beforeProjectEditor = f.requests.length;
  assert.match(commit('project').textContent, /↳ Built-in fallbackRequire approval/);
  await f.click(commit('project'));
  assert.equal(matrixDialog(f).querySelector('[aria-label="Value"]').value, 'ask', 'project editor never displays masking session Allow');
  assert.match(matrixDialog(f).textContent, /narrower override takes priority/);
  await f.click(f.button('Cancel', matrixDialog(f)));
  assert.equal(f.requests.length, beforeProjectEditor, 'opening and cancelling another scope is not a settings write');
  await matrixPreset(f, 'session', 'always-ask');
  await save(body('session', askValues), alwaysAsk, () => f.click(f.button('Apply workflow preset', matrixDialog(f))));
  assert.match(matrixCell(f, 'workspace', 'session').textContent, /Ask each timeSaved here/);
  assert.match(commit('session').textContent, /Without approvalSaved here/);
  assert.equal(snapshot.effective.targetBranch, 'target');
  assert.equal(snapshot.sources.targetBranch, 'global');
  assert.deepEqual(snapshot.effective.commitChecks, pluginSettings.effective.commitChecks);
  assert.deepEqual(snapshot.effective.mergeChecks, pluginSettings.effective.mergeChecks);

  // The original final reset is held across REAL component unmount. A body ACK
  // cannot stand in for the original save/catch/finally or the parent observer.
  const resetGate = f.gate('Git Workflow final session reset body');
  expectedBody = body('session', {}, ['commit']);
  reply = { gate: resetGate, data: { settings: finalSettings } };
  const from = f.requests.length, workFrom = f.works.length;
  await f.click(commit('session'));
  await f.click(matrixDialog(f).querySelector('input[value="follow"]'));
  await f.click(f.button('Save changes', matrixDialog(f)), { settle: false });
  assert.deepEqual(f.requests.slice(from).map(request => request.body), [expectedBody]);
  const saves = f.works.slice(workFrom).filter(work => work.label === 'plugins.bundledSettings.save');
  assert.equal(saves.length, 1);
  const original = saves[0].promise;
  assert.equal(parentWork.includes(original), true);
  assert.equal(saves[0].settled, false);
  assert.equal(commit('session').disabled, true);
  assert.equal(commit('session').dataset.saved, 'false');
  assert.equal(commit('global').dataset.winning, 'true');
  assert.match(fieldText('commit'), /Require approval/);
  await f.rerender(null);
  assert.equal(saves[0].settled, false, 'unmount is not save completion');
  await f.deliver(resetGate, 'plugins.bundledSettings.save');
  assert.equal(saves[0].promise, original);
  assert.equal(saves[0].settled, true);
  assert.equal(f.text(), '');
  snapshot = finalSettings;
  await f.rerender(element('session'));
  await f.commit();
  assert.equal(commit('session').dataset.saved, 'false');
  assert.match(commit('session').textContent, /↳ Built-in fallbackRequire approval/);
  assert.equal(commit('global').dataset.winning, 'true');
  assert.match(matrixCell(f, 'workspace', 'session').textContent, /Ask each timeSaved here/);
  assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 7);
  await f.cleanup();
});

test('actual matrix distinguishes pins, null, empty checks, ignored legacy values and unavailable scopes', async t => {
  const { f, c: { WorkflowSettings, gitWorkflowManifest: manifest }, setup } = await workflowSettingsFixture(t);
  const cwd = '/repo', sessionId = '55555555-5555-4555-8555-555555555555';
  let snapshot = workflowSnapshot(manifest), query = { cwd, sessionId }, expectedBody, reply, outerCancels = 0;
  snapshot.global.commit = 'ask';
  snapshot.global.commitChecks = [{ name: 'Tests', command: 'never-executed --fixture' }];
  snapshot.overrides.merge = 'ask';
  snapshot.sessionOverrides = { commit: 'allow', discardResources: 'allow' };
  snapshot.effective = { ...snapshot.effective, commit: 'allow', commitChecks: snapshot.global.commitChecks };
  snapshot.sources = { ...snapshot.sources, commit: 'session', merge: 'project', commitChecks: 'global' };
  f.route('GET', '/api/plugins/bundled', { query: () => query, reply: () => ({ data: { plugins: [{ manifest, settings: snapshot }] } }) });
  f.route('PATCH', '/api/plugins/bundled', { body: () => expectedBody, reply: () => reply });
  const element = (props = {}) => h('dialog', { open: true, onCancel() { outerCancels++; } },
    h(WorkflowSettings, { cwd, id: manifest.id, sessionId, initialScope: 'project', initialField: 'targetBranch', ...props }));
  await f.mount(element(), { setup });
  assert.equal(f.view.window.document.activeElement.id, 'plugin-targetBranch-project', 'manager field link targets its own repository cell');
  const beforeOpen = f.requests.length;
  await f.click(matrixCell(f, 'commit', 'project'));
  assert.equal(matrixDialog(f).querySelector('input[value="follow"]').checked, true);
  assert.equal(f.button('Save changes', matrixDialog(f)).disabled, true, 'untouched inheritance cannot accidentally pin');
  await act(async () => { matrixDialog(f).dispatchEvent(new f.view.window.Event('cancel', { cancelable: true })); });
  f.check();
  assert.equal(outerCancels, 0, 'inner cancel must not reach an enclosing manager dialog');
  assert.equal(f.view.container.querySelector('.plugin-matrix-dialog') === null, true);
  assert.equal(f.requests.length, beforeOpen);
  assert.equal(f.view.window.document.activeElement === matrixCell(f, 'commit', 'project'), true);
  const save = async (scope, set, reset, next) => {
    expectedBody = { pluginId: manifest.id, cwd, sessionId, scope, set, reset };
    reply = { data: { settings: next } };
    await f.click(f.button('Save changes', matrixDialog(f)));
    snapshot = next;
  };
  await matrixDraft(f, 'commit', 'project');
  assert.match(matrixDialog(f).textContent, /Saving pins this value here/);
  await save('project', { commit: 'ask' }, [], { ...snapshot, overrides: { ...snapshot.overrides, commit: 'ask' } });
  assert.match(matrixCell(f, 'commit', 'project').textContent, /Same value, pinned/);
  assert.equal(matrixCell(f, 'commit', 'session').dataset.winning, 'true');
  await matrixDraft(f, 'targetBranch', 'project');
  await f.click(matrixDialog(f).querySelector('input[type="checkbox"]'));
  assert.match(matrixDialog(f).textContent, /does not answer that workflow question/);
  await save('project', { targetBranch: null }, [], { ...snapshot, overrides: { ...snapshot.overrides, targetBranch: null },
    effective: { ...snapshot.effective, targetBranch: null }, sources: { ...snapshot.sources, targetBranch: 'project' } });
  assert.match(matrixCell(f, 'targetBranch', 'project').textContent, /No saved target/);
  assert.equal(matrixCell(f, 'targetBranch', 'project').dataset.saved, 'true');
  await matrixDraft(f, 'commitChecks', 'project');
  await f.click(f.button('No checks ([])', matrixDialog(f)));
  assert.equal(matrixDialog(f).querySelector('textarea').value, '[]');
  await save('project', { commitChecks: [] }, [], { ...snapshot, overrides: { ...snapshot.overrides, commitChecks: [] },
    effective: { ...snapshot.effective, commitChecks: [] }, sources: { ...snapshot.sources, commitChecks: 'project' } });
  assert.match(matrixCell(f, 'commitChecks', 'project').textContent, /No checksSaved here/);
  expectedBody = { pluginId: manifest.id, cwd, sessionId, scope: 'global', set: { enabled: false }, reset: [] };
  const disabled = { ...snapshot, enabled: false, global: { ...snapshot.global, enabled: false }, effective: { ...snapshot.effective, enabled: false } };
  reply = { data: { settings: disabled } };
  await f.click('#plugin-enabled'); snapshot = disabled;
  assert.equal(f.node('#plugin-enabled').checked, false);
  assert.match(f.node('#plugin-enabled').parentElement.textContent, /Saved here/);
  await f.click(f.node('.plugin-matrix-savedFilter input'));
  await f.click(matrixCell(f, 'merge', 'project'));
  await f.click(matrixDialog(f).querySelector('input[value="follow"]'));
  const withoutMerge = { ...snapshot.overrides }; delete withoutMerge.merge;
  await save('project', {}, ['merge'], { ...snapshot, overrides: withoutMerge, sources: { ...snapshot.sources, merge: 'builtin' } });
  assert.equal(f.view.container.querySelector('[data-setting-row="merge"]') === null, true);
  assert.equal(f.view.window.document.activeElement.type, 'search', 'filtered-away origin falls back to persistent search');
  const discard = matrixCell(f, 'discardResources', 'session');
  assert.equal(discard.tagName, 'DIV');
  assert.match(discard.textContent, /Legacy override ignored/);
  await f.click(f.button('Clear ignored value', discard));
  assert.match(matrixDialog(f).textContent, /Ignored saved value: Allow · always confirm/);
  expectedBody = { pluginId: manifest.id, cwd, sessionId, scope: 'session', set: {}, reset: ['discardResources'] };
  const withoutDiscard = { ...snapshot.sessionOverrides }; delete withoutDiscard.discardResources;
  reply = { data: { settings: { ...snapshot, sessionOverrides: withoutDiscard } } };
  await f.click(f.button('Clear ignored value', matrixDialog(f)));
  snapshot = { ...snapshot, sessionOverrides: withoutDiscard };
  assert.equal(f.view.window.document.activeElement.type, 'search');
  await f.click(f.node('.plugin-matrix-savedFilter input'));
  const writes = f.requests.filter(request => request.method === 'PATCH').length;
  query = { cwd };
  snapshot = { ...snapshot, sessionId: undefined, sessionOverrides: {}, sessionApplicable: false };
  await f.rerender(element({ sessionId: null })); await f.commit();
  assert.match(f.text(), /No session selected/);
  assert.equal(matrixCell(f, 'commit', 'session').tagName, 'DIV');
  assert.equal(matrixCell(f, 'commit', 'global').tagName, 'BUTTON');
  query = { cwd: '/foreign', sessionId };
  snapshot = { ...snapshot, project: '/foreign', sessionId, sessionProject: cwd, sessionApplicable: false };
  await f.rerender(element({ cwd: '/foreign' })); await f.commit();
  assert.match(f.text(), /belongs to another repository/);
  await f.click(matrixCell(f, 'commit', 'global'));
  assert.match(matrixDialog(f).textContent, /cannot determine the session’s result in its own repository/);
  await f.click(f.button('Cancel', matrixDialog(f)));
  query = { cwd: '/unresolved', sessionId };
  snapshot = { ...snapshot, project: null, sessionProject: null };
  await f.rerender(element({ cwd: '/unresolved' })); await f.commit();
  assert.match(f.text(), /own repository could not be resolved/);
  assert.doesNotMatch(f.text(), /belongs to another repository/);
  assert.equal(matrixCell(f, 'commit', 'project').tagName, 'DIV');
  assert.equal(f.requests.filter(request => request.method === 'PATCH').length, writes, 'availability changes never write');
  assert.equal(new Set([...f.view.container.querySelectorAll('[id]')].map(node => node.id)).size,
    f.view.container.querySelectorAll('[id]').length, 'field/scope ids stay unique');
});

test('actual matrix retains drafts and rolls provenance back after complete HTTP, fetch and body failures', async t => {
  for (const kind of ['http', 'fetch', 'body']) await t.test(kind, async st => {
    const { f, c: { WorkflowSettings, gitWorkflowManifest: manifest }, setup } = await workflowSettingsFixture(st);
    const snapshot = workflowSnapshot(manifest), cwd = '/repo', sessionId = snapshot.sessionId, parentWork = [];
    const failure = new Error(`controlled ${kind} save failure`);
    let reply = kind === 'http' ? { status: 400, data: { error: failure.message } }
      : kind === 'fetch' ? { fetchError: failure } : { bodyError: failure };
    const expected = { pluginId: manifest.id, cwd, sessionId, scope: 'project', set: { commit: 'deny' }, reset: [] };
    f.route('GET', '/api/plugins/bundled', { query: { cwd, sessionId }, reply: { data: { plugins: [{ manifest, settings: snapshot }] } } });
    f.route('PATCH', '/api/plugins/bundled', { body: expected, reply: () => reply });
    await f.mount(h(WorkflowSettings, { cwd, id: manifest.id, sessionId, onWork: work => parentWork.push(work) }), { setup });
    await matrixDraft(f, 'commit', 'project', 'deny');
    await f.click(f.button('Save changes', matrixDialog(f)));
    const original = f.works.filter(work => work.label === 'plugins.bundledSettings.save').at(-1);
    assert.equal(parentWork.includes(original.promise), true);
    assert.equal(original.settled, true, 'error body, catch and finally all settled');
    assert.equal((await original.promise).ok, false);
    assert.equal(matrixDialog(f).querySelector('[aria-label="Value"]').value, 'deny');
    assert.match(matrixDialog(f).textContent, /Your draft is retained/);
    assert.match(matrixDialog(f).textContent, new RegExp(`controlled ${kind} save failure`));
    assert.equal(matrixCell(f, 'commit', 'project').dataset.saved, 'false');
    assert.equal(matrixCell(f, 'commit', 'global').dataset.winning, 'true');
    assert.equal(f.button('Save changes', matrixDialog(f)).disabled, false);
    reply = { data: { settings: { ...snapshot, overrides: { commit: 'deny' },
      effective: { ...snapshot.effective, commit: 'deny' }, sources: { ...snapshot.sources, commit: 'project' } } } };
    const saveButton = f.button('Save changes', matrixDialog(f));
    await act(async () => {
      saveButton.dispatchEvent(new f.view.window.MouseEvent('click', { bubbles: true }));
      saveButton.dispatchEvent(new f.view.window.MouseEvent('click', { bubbles: true }));
      await f.join('plugins.bundledSettings.save');
    });
    f.check();
    assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 2, 'one failure and one retry; duplicate admission is fenced');
    assert.equal(f.view.container.querySelector('.plugin-matrix-dialog') === null, true);
    assert.equal(matrixCell(f, 'commit', 'project').dataset.winning, 'true');
  });
});

test('actual keyed settings fence obsolete load/save success and error across session/cwd A-B-A reuse', async t => {
  for (const operation of ['load', 'save']) for (const identity of ['session', 'cwd']) for (const outcome of ['success', 'error']) {
    await t.test(`${operation} ${identity} ${outcome}`, async st => {
      const { f, c: { WorkflowSettings, gitWorkflowManifest: manifest }, setup } = await workflowSettingsFixture(st);
      const a = { cwd: '/repo', sessionId: '55555555-5555-4555-8555-555555555555' };
      const b = identity === 'session' ? { ...a, sessionId: '66666666-6666-4666-8666-666666666666' } : { ...a, cwd: '/other' };
      const oldSnapshot = workflowSnapshot(manifest, a.sessionId, a.cwd);
      const currentSnapshot = { ...workflowSnapshot(manifest, a.sessionId, a.cwd), global: { ...oldSnapshot.global, commit: 'deny' },
        effective: { ...oldSnapshot.effective, commit: 'deny' }, sources: { ...oldSnapshot.sources, commit: 'global' } };
      const oldGate = f.gate('obsolete A complete body'), currentGate = f.gate('current identity complete read');
      let phase = 'old', context = a, expectedBody, patchReply;
      const oldReply = outcome === 'error' ? { gate: oldGate, status: 503, data: { error: 'obsolete A error' } }
        : { gate: oldGate, data: { settings: { ...oldSnapshot, overrides: { commit: 'allow' } }, plugins: [{ manifest, settings: oldSnapshot }] } };
      f.route('GET', '/api/plugins/bundled', { query: () => context, reply: () => phase === 'old'
        ? operation === 'load' ? oldReply : { data: { plugins: [{ manifest, settings: oldSnapshot }] } }
        : { gate: currentGate, data: { plugins: [{ manifest, settings: { ...currentSnapshot, project: context.cwd,
          sessionId: context.sessionId, sessionProject: identity === 'cwd' ? a.cwd : context.cwd, sessionApplicable: context.cwd === a.cwd } }] } } });
      f.route('PATCH', '/api/plugins/bundled', { body: () => expectedBody, reply: () => patchReply });
      const element = value => h(WorkflowSettings, { ...value, id: manifest.id });
      await f.mount(element(a), { setup, settle: operation !== 'load' });
      let obsolete;
      if (operation === 'load') obsolete = f.works.filter(work => work.label === 'plugins.bundledSettings.load');
      else {
        await matrixDraft(f, 'commit', 'project', 'allow');
        expectedBody = { pluginId: manifest.id, ...a, scope: 'project', set: { commit: 'allow' }, reset: [] };
        patchReply = oldReply;
        await f.click(f.button('Save changes', matrixDialog(f)), { settle: false });
        obsolete = [f.works.filter(work => work.label === 'plugins.bundledSettings.save').at(-1)];
      }
      assert.equal(obsolete.every(work => !work.settled), true);
      const loadCurrent = async value => {
        phase = 'current'; context = value;
        const from = f.works.length;
        await f.rerender(element(value));
        const reads = f.works.slice(from).filter(work => work.label === 'plugins.bundledSettings.load');
        assert.equal(reads.length > 0, true);
        await act(async () => { currentGate.release(); await Promise.all(reads.map(work => work.promise)); });
        f.check();
      };
      await loadCurrent(b);
      assert.match(matrixCell(f, 'commit', 'global').textContent, /Block/);
      assert.equal(f.view.container.querySelector('.plugin-matrix-dialog') === null, true, 'old draft does not cross identity');
      await loadCurrent(a); // Same A tuple, new receiving instance—not the old request owner.
      await matrixDraft(f, 'commit', 'project', 'ask', { settle: false });
      expectedBody = { pluginId: manifest.id, ...a, scope: 'project', set: { commit: 'ask' }, reset: [] };
      const errorGate = f.gate('current A2 rejected save');
      patchReply = { gate: errorGate, status: 400, data: { error: 'current A2 save error' } };
      await f.click(f.button('Save changes', matrixDialog(f)), { settle: false });
      const currentSave = f.works.filter(work => work.label === 'plugins.bundledSettings.save').at(-1);
      await act(async () => { errorGate.release(); await currentSave.promise; });
      f.check();
      assert.match(matrixDialog(f).textContent, /current A2 save error/);
      await act(async () => { oldGate.release(); await Promise.all(obsolete.map(work => work.promise)); });
      f.check();
      assert.equal(obsolete.every(work => work.settled), true);
      assert.match(matrixDialog(f).textContent, /current A2 save error/);
      assert.doesNotMatch(f.text(), /obsolete A error/);
      assert.equal(matrixDialog(f).querySelector('[aria-label="Value"]').value, 'ask');
      assert.equal(f.button('Save changes', matrixDialog(f)).disabled, false, 'obsolete finally cannot disturb current retryability');
      assert.equal(matrixCell(f, 'commit', 'global').dataset.winning, 'true');
      assert.match(matrixCell(f, 'commit', 'global').textContent, /Block/);
      assert.equal(matrixCell(f, 'commit', 'project').dataset.saved, 'false');
    });
  }
});

test('actual SettingsPanel/PluginsConfig preserves inner Escape, matrix opt-in and Session Launch legacy immediate save', async t => {
  const { f, c: { SettingsPanel, gitWorkflowManifest: manifest, sessionLaunchManifest: launch }, setup } = await workflowSettingsFixture(t);
  const cwd = '/repo', sessionId = '55555555-5555-4555-8555-555555555555';
  const git = workflowSnapshot(manifest), initialLaunch = { pluginId: launch.id, schemaVersion: 1, project: cwd,
    enabled: true, sessionId, sessionProject: cwd, sessionApplicable: true, sessionOverrides: {}, global: {}, overrides: {},
    effective: { enabled: true, launch: 'ask' }, sources: { enabled: 'builtin', launch: 'builtin' } };
  let launchSettings = initialLaunch;
  f.route('GET', '/api/plugins', { query: { cwd }, reply: { data: { packages: [], standaloneExtensions: [], diagnostics: [],
    totals: { extensions: 0, skills: 0, prompts: 0, themes: 0 } } } });
  f.route('GET', '/api/plugins/bundled', { query: { cwd, sessionId }, reply: () => ({ data: { plugins: [
    { manifest, settings: git }, { manifest: launch, settings: launchSettings }] } }) });
  const expected = { pluginId: launch.id, cwd, sessionId, scope: 'session', set: { launch: 'allow' }, reset: [] };
  f.route('PATCH', '/api/plugins/bundled', { body: expected, reply: () => {
    launchSettings = { ...initialLaunch, sessionOverrides: { launch: 'allow' }, effective: { enabled: true, launch: 'allow' }, sources: { enabled: 'builtin', launch: 'session' } };
    return { data: { settings: launchSettings } };
  } });
  let outerCloses = 0;
  await f.mount(h(SettingsPanel, { cwd, sessionId, initialSection: 'plugins', initialPluginScope: 'session', onClose() { outerCloses++; },
    onSessionReloaded() {}, trustStatus: null, onManageTrust() {}, quoteSelectionEnabled: false, onQuoteSelectionChange() {},
    sessions: [], privacy: {}, sshController: {} }), { setup }); // Other sections are genuinely unmounted, not success doubles.
  await f.click(f.button('Git Workflow'));
  assert.equal(f.view.container.querySelectorAll('[data-scope-heading]').length, 3);
  await f.click(matrixCell(f, 'commit', 'session'));
  await act(async () => {
    const dialog = matrixDialog(f);
    const escape = new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dialog.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, false, 'idle Escape retains native close-watcher handling');
    // JSDOM has no native close watcher: supply only its cancel event.
    dialog.dispatchEvent(new f.view.window.Event('cancel', { cancelable: true }));
  });
  f.check();
  assert.equal(outerCloses, 0);
  assert.equal(f.view.container.querySelector('.plugin-matrix-dialog') === null, true);
  assert.equal(f.view.container.querySelectorAll('.settings-dialog-backdrop').length, 1);
  await f.click(f.button('Session Launch'));
  assert.equal(f.view.container.querySelector('[data-plugin-settings-matrix]') === null, true);
  assert.equal(f.node('[aria-label="Plugin settings scope"]').value, 'session');
  const before = f.requests.length;
  await f.input('#plugin-launch', 'allow');
  const requests = f.requests.slice(before);
  assert.deepEqual(requests.filter(request => request.method === 'PATCH').map(request => request.body), [expected]);
  assert.equal(requests.filter(request => request.method === 'GET').every(request => request.path === '/api/plugins/bundled'), true);
  assert.match(f.node('#plugin-launch').parentElement.textContent, /Effective: "allow" · Source: session/);
  assert.equal(Boolean(f.button('Use project default', f.node('#plugin-launch').parentElement)), true);
  assert.equal(f.view.container.querySelectorAll('.config-sidebar-item[aria-current="page"]').length, 1);
});

test('actual workflow preset preview follows a non-session destination while showing the masking session result', async t => {
  const { f, c: { WorkflowSettings, gitWorkflowManifest: manifest }, setup } = await workflowSettingsFixture(t);
  const cwd = '/repo', snapshot = workflowSnapshot(manifest), sessionId = snapshot.sessionId;
  snapshot.global = { ...snapshot.global, workspace: 'worktree', commit: 'allow' };
  snapshot.sessionOverrides = { workspace: 'current-branch' };
  snapshot.effective = { ...snapshot.effective, workspace: 'current-branch', commit: 'allow' };
  snapshot.sources = { ...snapshot.sources, workspace: 'session', commit: 'global' };
  const askValues = { workspace: 'ask', completion: 'ask', targetSelection: 'ask', methodSelection: 'ask', cleanupWorktree: 'ask', cleanupBranch: 'ask', cleanupArtifacts: 'ask' };
  const next = { ...snapshot, overrides: { ...askValues }, effective: { ...snapshot.effective, ...askValues, workspace: 'current-branch' },
    sources: { ...snapshot.sources, ...Object.fromEntries(Object.keys(askValues).map(key => [key, 'project'])), workspace: 'session' } };
  const expected = { pluginId: manifest.id, cwd, sessionId, scope: 'project', set: askValues, reset: [] };
  f.route('GET', '/api/plugins/bundled', { query: { cwd, sessionId }, reply: { data: { plugins: [{ manifest, settings: snapshot }] } } });
  f.route('PATCH', '/api/plugins/bundled', { body: expected, reply: { data: { settings: next } } });
  await f.mount(h(WorkflowSettings, { cwd, id: manifest.id, sessionId }), { setup });
  await matrixPreset(f, 'project', 'always-ask');
  const preview = () => [...matrixDialog(f).querySelectorAll('.plugin-matrix-presetPreview > div')].find(node => node.querySelector('h3').textContent === 'Working location');
  assert.equal(matrixDialog(f).querySelectorAll('.plugin-matrix-presetPreview > div').length, 7);
  const destination = () => preview().querySelector('.plugin-matrix-previewFacts > div:first-child');
  const resolved = () => preview().querySelector('.plugin-matrix-previewFacts > div:last-child');
  assert.equal(destination().querySelector('dt').textContent, 'At repo');
  assert.match(destination().querySelector('dd').textContent, /^Ask each time\s+Saved explicitly$/);
  assert.match(resolved().textContent, /Resolved for this sessionCurrent branchFrom This session/);
  assert.match(preview().textContent, /narrower override takes priority/);
  await f.input(matrixDialog(f).querySelector('[aria-label="Save workflow choices to"]'), 'global');
  assert.equal(destination().querySelector('dt').textContent, 'At All repositories');
  assert.match(resolved().textContent, /Current branchFrom This session/);
  await f.input(matrixDialog(f).querySelector('[aria-label="Save workflow choices to"]'), 'project');
  assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 0);
  await f.click(f.button('Apply workflow preset', matrixDialog(f)));
  assert.deepEqual(f.requests.filter(request => request.method === 'PATCH').map(request => request.body), [expected]);
  assert.equal(matrixCell(f, 'workspace', 'project').dataset.saved, 'true');
  assert.equal(matrixCell(f, 'workspace', 'session').dataset.winning, 'true');
  assert.match(matrixCell(f, 'workspace', 'project').textContent, /Ask each timeSaved here/);
  assert.match(matrixCell(f, 'commit', 'global').textContent, /Without approvalSaved here/);
  assert.match(matrixCell(f, 'targetBranch', 'global').textContent, /targetSaved here/);
  assert.equal(matrixCell(f, 'targetBranch', 'global').dataset.winning, 'true');
  assert.equal(next.effective.targetBranch, 'target');
  assert.equal(next.sources.targetBranch, 'global');
  assert.deepEqual(next.effective.commitChecks, []);
  assert.deepEqual(next.effective.mergeChecks, []);
});
