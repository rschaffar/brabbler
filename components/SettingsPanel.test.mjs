import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createElement as h, act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { generalFixture } from './general-settings.fixture.mjs';

const modelView = { allEnabled: true, patterns: [], stalePatterns: [], providers: [], enabledTotal: 0, availableTotal: 0, scope: 'global', editable: true, settingsPath: '~/.pi/agent/settings.json' };
test('actual Settings navigation keeps real visited General/Models mounted, remembers section, nested Escape and current close callback', async t => {
  let closed = 0;
  const { f, graph: c, props } = await generalFixture(t, { onClose() { closed++; } });
  f.route('GET', '/api/models-config', { reply: { data: { providers: { fixture: { api: 'openai-completions' } } } } });
  f.route('GET', '/api/auth/providers', { reply: { data: { oauthProviders: [], apiKeyProviders: [] } } });
  f.route('GET', '/api/models/enabled', { query: { cwd: '/project' }, reply: { data: modelView } });
  await f.mount(h(c.SettingsPanel, props));
  const general = f.node('.settings-general');
  assert.equal(f.node('.settings-section-tab[aria-current="page"]').textContent, 'General');
  for (const section of ['General', 'Models', 'SSH', 'Skills', 'Sub-agents', 'Plugins']) assert.equal([...f.view.container.querySelectorAll('.settings-section-tab')].some(n => n.textContent === section), true, section);
  await f.click(f.button('Models', f.node('.settings-section-tabs')));
  assert.equal(general.closest('.settings-section-host').hidden, true, 'actual ancestor hides retained general');
  assert.equal(c.getLastSettingsSection('/project'), 'models');
  const models = f.node('.config-panel-root');
  assert.equal(models.classList.contains('is-embedded'), true);
  assert.equal(models.querySelector('.config-close-button') === null, true);
  await f.click(f.button('Add provider'));
  const filter = f.node('input[placeholder="Search providers…"]');
  const escape = new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  await f.view.dispatch(filter, escape);
  assert.equal(escape.defaultPrevented, true); assert.equal(closed, 0, 'picker consumes Escape before Settings');
  await f.click(f.button('General', f.node('.settings-section-tabs')));
  assert.equal(f.node('.settings-general') === general, true);
  assert.equal(models.closest('.settings-section-host').hidden, true);
  await f.input('.settings-mobile-section-picker', 'models');
  assert.equal(f.node('.config-panel-root') === models, true, 'mobile and desktop controls share mounted section');
  assert.equal(c.getLastSettingsSection('/project'), 'models');
  await f.rerender(h(c.SettingsPanel, { ...props, onClose() { closed += 10; } }));
  await f.view.dispatch(f.view.window.document, new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(closed, 10, 'current document listener closure');
  await f.view.unmount();
  f.view.window.document.dispatchEvent(new f.view.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(closed, 10, 'unmount removes own listener');
});

test('actual project-less panel disables project sections and uses one backdrop dismissal owner', async t => {
  const { f, graph: c, props } = await generalFixture(t, { cwd: null }); let closed = 0;
  await f.mount(h(c.SettingsPanel, { ...props, onClose() { closed++; } }));
  const picker = f.node('.settings-mobile-section-picker');
  assert.deepEqual([...picker.options].filter(n => n.disabled).map(n => n.value), ['skills', 'agents', 'plugins']);
  assert.equal(f.view.container.querySelectorAll('.settings-section-tab:disabled').length, 3);
  await f.click('.settings-dialog-surface'); assert.equal(closed, 0);
  await f.click('.settings-dialog-backdrop'); assert.equal(closed, 1);
});

test('actual General native palette radios, generated-title languages, typography/chat grouping and persisted theme', async t => {
  const { f, graph: c, props } = await generalFixture(t);
  const setters = [];
  function ThemePeer() { const theme = c.useTheme(); setters.push(theme.setThemePreference); return null; }
  await f.mount(h('div', null, h(c.GeneralSettings, props), h(ThemePeer)));
  const initialSetter = setters.at(-1);
  const radios = [...f.view.container.querySelectorAll('input[type="radio"]')];
  assert.deepEqual(radios.map(n => n.value), c.THEME_OPTIONS.map(n => n.id));
  assert.equal(radios.length, 14);
  for (const id of ['light', 'dark', 'mist', 'rose', 'pine', 'sand', 'lilac', 'slate', 'dusk', 'ember', 'contrast-light', 'contrast-dark', 'zenburn', 'auto']) assert.equal(radios.some(n => n.value === id), true);
  for (const radio of radios) {
    const label = radio.closest('label');
    assert.equal(label.hasAttribute('data-system'), radio.value === 'auto', 'only System has system metadata');
    if (radio.value === 'auto') {
      assert.equal(label.dataset.system, 'true');
      assert.deepEqual([...label.querySelectorAll('[data-theme]')].map(chip => chip.dataset.theme), ['light', 'dark']);
    } else {
      const swatch = label.querySelector('[data-theme]');
      assert.equal(swatch !== null, true, 'palette has themed swatch metadata');
      assert.equal(swatch.dataset.theme, radio.value, 'palette swatch is bound to its own palette');
    }
  }
  await f.click('input[type="radio"][value="zenburn"]');
  assert.equal(setters.at(-1) === initialSetter, true, 'actual useTheme setter identity survives a committed preference update');
  assert.equal(f.view.window.document.documentElement.dataset.theme, 'zenburn');
  assert.equal(f.view.window.localStorage.getItem('pi-theme'), 'zenburn');
  assert.equal(f.node('input[value="zenburn"]').checked, true);
  // Original browser palette values, now through every actual General radio and
  // the actual useTheme store. CSS contrast/layout and native keys stay browser-owned.
  const dark = new Set(['dark', 'pine', 'dusk', 'ember', 'slate', 'contrast-dark', 'zenburn']);
  for (const id of ['auto', 'light', 'mist', 'lilac', 'sand', 'rose', 'dark', 'pine', 'dusk', 'ember', 'slate', 'contrast-light', 'contrast-dark', 'zenburn']) {
    await f.click(`input[type="radio"][value="${id}"]`);
    assert.equal(f.node(`input[value="${id}"]`).checked, true, id);
    assert.equal(f.view.window.localStorage.getItem('pi-theme'), id, id);
    assert.equal(f.view.window.document.documentElement.dataset.theme, id === 'auto' ? 'light' : id, id);
    assert.equal(f.view.window.document.documentElement.classList.contains('dark'), dark.has(id), id);
    assert.equal(setters.at(-1) === initialSetter, true, 'same actual setter through the complete palette matrix');
  }
  assert.deepEqual([...f.node('#settings-title-language').options].map(n => n.value), [...c.TITLE_LANGUAGES]);
  assert.equal(f.view.container.querySelector('#settings-language-options') === null, true, 'no interface locale picker');
  const section = heading => [...f.view.container.querySelectorAll('.settings-general-section')].find(n => n.querySelector('h3')?.textContent === heading);
  const typography = section('Fonts & layout'), chat = section('Chat');
  assert.equal(typography.querySelector('.settings-font-rows') !== null, true);
  assert.equal(typography.querySelector('#settings-chat-content-width') !== null, true);
  assert.equal(typography.querySelector('#settings-chat-content-font-size') !== null, true);
  assert.equal(chat.querySelectorAll('[role="switch"]').length, 2);
  assert.equal(chat.querySelectorAll('.settings-chat-option').length, 2);
  assert.equal(chat.querySelector('input[type="range"]') === null, true);
});

test('actual title selection uses exact provider/model IDs and selected-session catalog without changing chat model', async t => {
  const { f, graph: c, props } = await generalFixture(t);
  let model = { provider: 'two', modelId: 'shared:id' }, language = 'en';
  f.route('PUT', '/api/sessions/title-model', { body: () => ({ model }), reply: () => ({ data: { model } }) });
  f.route('PUT', '/api/sessions/title-language', { body: () => ({ language }), reply: () => ({ data: { language } }) });
  await f.mount(h(c.GeneralSettings, props));
  const selector = f.node('#settings-title-model');
  assert.equal(selector.options[0].value, '');
  assert.equal(selector.options.length, 3);
  await f.input(selector, JSON.stringify(['two', 'shared:id']));
  assert.equal(selector.value, JSON.stringify(['two', 'shared:id']));
  model = null; await f.input(selector, '');
  const languageWritesBefore = f.requests.filter(request => request.method === 'PUT' && request.path === '/api/sessions/title-language').length;
  await f.input('#settings-title-language', 'en');
  const languageWrites = f.requests.filter(request => request.method === 'PUT' && request.path === '/api/sessions/title-language');
  assert.equal(languageWrites.length, languageWritesBefore + 1, 'language change admitted an actual server PUT');
  const languageWrite = languageWrites.at(-1);
  assert.deepEqual({ method: languageWrite.method, path: languageWrite.path, body: languageWrite.body }, { method: 'PUT', path: '/api/sessions/title-language', body: { language: 'en' } });
  assert.equal(f.node('#settings-title-language').value, 'en', 'server-confirmed title language committed');
  assert.equal(f.node('#settings-title-language').disabled, false, 'full language save finally settled');
  assert.equal(f.requests.some(r => r.path.startsWith('/api/agent/')), false, 'title settings never set chat model or reload');
});

test('actual General failed title save retains current selection; failed logout reaches real auth action and visible error', async t => {
  const { f, graph: c, props, data } = await generalFixture(t);
  data.title = { model: { provider: 'missing', modelId: 'old' } };
  f.route('PUT', '/api/sessions/title-model', { body: { model: { provider: 'one', modelId: 'shared:id' } }, reply: { status: 500, data: { error: 'title save refused' } } });
  f.route('DELETE', '/api/web-auth', { reply: { status: 500, data: {} } });
  await f.mount(h(c.GeneralSettings, props));
  assert.equal(f.node('#settings-title-model').querySelector('option:disabled').textContent.includes('missing/old'), true);
  await f.input('#settings-title-model', JSON.stringify(['one', 'shared:id']));
  assert.equal(f.node('#settings-title-model').value, JSON.stringify(['missing', 'old']));
  assert.equal(f.text().includes('title save refused'), true);
  await f.click(f.button('Log out'));
  assert.equal(f.view.container.querySelectorAll('[role="alert"]').length, 2);
  assert.equal(f.button('Log out').disabled, false, 'logout finally joined');
});

test('actual section icons and English labels preserve robot/general glyph data', async t => {
  const { graph: c } = await generalFixture(t);
  assert.equal(c.enLocale.messages['common.agents'], 'Sub-agents');
  assert.equal(c.enLocale.messages['agents.new'], 'New sub-agent');
  const agent = renderToStaticMarkup(h(c.SettingsSectionIcon, { section: 'agents' }));
  const child = renderToStaticMarkup(h(c.SubagentIcon));
  for (const html of [agent, child]) {
    assert.match(html, /<rect x="5" y="7" width="14" height="11" rx="2"/);
    assert.match(html, /d="M9 11h\.01M15 11h\.01M9 15h6M12 7V4M10 4h4"/);
  }
  const general = renderToStaticMarkup(h(c.SettingsSectionIcon, { section: 'general' }));
  assert.match(general, /d="M20 7h-9M14 17H5"/);
  assert.match(general, /<circle cx="7" cy="7" r="3"/); assert.match(general, /<circle cx="17" cy="17" r="3"/);
});

// CSS-only rules: preserve exact styling declarations, not a claim of mobile geometry.
test('settings navigation/typography/chat declarations retain responsive presentation and focus treatment', async () => {
  const css = await readFile(new URL('../app/settings.css', import.meta.url), 'utf8');
  for (const pattern of [/:has\(input:focus-visible\)/, /\.settings-dialog-header \{[\s\S]*?display: flex[\s\S]*?align-items: center[\s\S]*?min-height: 50px/,
    /\.settings-section-tab \{[\s\S]*?width: 96px/, /\.settings-section-icon \{[\s\S]*?flex-shrink: 0/, /\.settings-section-tab::after \{[\s\S]*?width: 24px/,
    /\.settings-section-tab\[aria-current="page"\]::after/, /\.settings-section-tab:focus-visible:not\(\[aria-current="page"\]\)/,
    /\.settings-section-tab:focus-visible\[aria-current="page"\][\s\S]*?outline: none/,
    /@media \(max-width: 640px\)[\s\S]*?\.settings-section-tabs \{[\s\S]*?display: none/, /@media \(max-width: 640px\)[\s\S]*?\.settings-mobile-section-picker \{[\s\S]*?display: block/,
    /\.settings-section-icon\.is-agent \{[\s\S]*?transform: scale\(1\.25\)/]) assert.match(css, pattern);
  const row = css.match(/\.settings-chat-option \{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(row, /font-size: 12px/); assert.doesNotMatch(row, /background/);
});

// Explicit cross-owner holds: not relabelled as architecture or retired by this leaf packet.
test('HELD shell shortcuts and all-child detail restoration pending their actual mounted owners', async () => {
  const shell = await readFile(new URL('./AppShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /<SettingsPanel/); assert.match(shell, /setSettingsSection\(section\)/);
  assert.match(shell, /initialSection=\{settingsSection\}/); assert.match(shell, /translate\("common\.settings"\)/);
  assert.match(shell, /<SettingsSectionIcon section=\{section\} size=\{14\} strokeWidth=\{2\} \/>\s*<span>\{label\}<\/span>/);
  assert.match(shell, /<SettingsSectionIcon section="general" size=\{14\} strokeWidth=\{2\} \/>/);
  assert.doesNotMatch(shell, /\["plugins", translate\("common\.plugins"\)\]/);
  assert.doesNotMatch(shell, /setModelsConfigOpen|setSkillsConfigOpen|setAgentsConfigOpen|setPluginsConfigOpen/);
  assert.match(shell, /getLastSettingsSection\(projectTrustCwd\)/);
  const sidebar = await readFile(new URL('./SessionSidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /<SubagentIcon size=\{11\} \/>/);
});

test('retained credential-entry shape and login presentation; mounted logout is separate from real login authority', async () => {
  const login = await readFile(new URL('../app/login/page.tsx', import.meta.url), 'utf8');
  const css = await readFile(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.equal((login.match(/type="password"/g) ?? []).length, 1);
  assert.doesNotMatch(login, /type="(?:text|email)"/); assert.match(login, /autoComplete="current-password"/);
  assert.match(login, /safeLoginDestination\(destination, window\.location\.origin\)/);
  assert.match(login, /className="web-login-composer"[\s\S]*?type="password"[\s\S]*?<button type="submit"/);
  assert.match(css, /\.web-login-composer \{[\s\S]*?display: flex;[\s\S]*?border-radius: 14px/);
});


test('actual Settings SSR connects every requested configuration surface as embedded content', async t => {
  const { f, graph: c, props } = await generalFixture(t);
  for (const initialSection of ['models', 'skills', 'agents', 'plugins']) {
    const html = renderToStaticMarkup(h(c.I18nProvider, null, h(c.SettingsPanel, { ...props, initialSection })));
    assert.equal(html.includes('config-panel-root is-embedded'), true, initialSection);
    assert.equal((html.match(/settings-dialog-close/g) ?? []).length, 1, 'one outer close');
    assert.equal(html.includes('config-panel-header'), false, 'embedded child has no repeated header');
  }
  assert.equal(f.requests.length, 0, 'SSR is inert, not a fetching-panel claim');
});

test('actual General has no divider rows, no appearance width controls, and no interface-language control', async t => {
  const { f, graph: c, props } = await generalFixture(t);
  await f.mount(h(c.SettingsPanel, props));
  assert.equal(f.view.container.querySelectorAll('.settings-dialog-header').length, 1);
  const sections = [...f.view.container.querySelectorAll('.settings-general-section')];
  assert.equal(sections.some(n => Boolean(n.style.borderBottom) || Boolean(n.style.borderLeft)), false);
  const appearance = sections.find(n => n.querySelector('h3')?.textContent === 'Appearance');
  assert.equal(appearance.querySelector('#settings-chat-content-width') === null, true);
  assert.equal(f.view.container.querySelector('style') === null, true);
  assert.equal(f.view.container.querySelectorAll('select').length, 3, 'only section and generated-title language/model selects');
});


test('actual General quote-selection switch delivers the current controlled value and callback', async t => {
  const calls = [];
  const { f, graph: c, props } = await generalFixture(t, { onQuoteSelectionChange(value) { calls.push(['A', value]); } });
  await f.mount(h(c.GeneralSettings, props));
  await f.click('button[aria-label="Show actions for selected text"]');
  await f.rerender(h(c.GeneralSettings, { ...props, quoteSelectionEnabled: true, onQuoteSelectionChange(value) { calls.push(['B', value]); } }));
  await f.click('button[aria-label="Show actions for selected text"]');
  assert.deepEqual(calls, [['A', true], ['B', false]]);
});


test('actual General A/B/A catalog generations ignore delivered obsolete success and caught body error', async t => {
  for (const failOldBody of [false, true]) await t.test(String(failOldBody), async t => {
    const { f, graph: c, props, data } = await generalFixture(t);
    const old = f.gate('old title catalog JSON'); data.modelsGate = old;
    if (failOldBody) data.modelsBodyError = new Error('controlled obsolete catalog body error');
    await f.mount(h(c.GeneralSettings, props), { settle: false });
    await f.commit(undefined, 'general.shell'); // Named independent startup operation, not global idle.
    const oldWork = f.works.filter(work => work.label === 'general.titleModels').map(work => work.promise);
    data.modelsGate = null; data.modelsBodyError = null;
    data.models = { modelList: [{ provider: 'B', id: 'same:id', name: 'B current' }] };
    data.query = { cwd: '/project', sessionId: 'session-B' };
    await f.rerender(h(c.GeneralSettings, { ...props, sessionId: 'session-B' }));
    await act(async () => { await f.works.findLast(work => work.label === 'general.titleModels').promise; });
    assert.equal(f.node('#settings-title-model').options[1].value, JSON.stringify(['B', 'same:id']));
    data.models = { modelList: [{ provider: 'new-A', id: 'same:id', name: 'new A current' }] };
    data.query = { cwd: '/project', sessionId: 'session-A' };
    await f.rerender(h(c.GeneralSettings, props));
    await act(async () => { await f.works.findLast(work => work.label === 'general.titleModels').promise; });
    await act(async () => { old.release(); await Promise.allSettled(oldWork); });
    assert.deepEqual([...f.node('#settings-title-model').options].map(option => option.value), ['', JSON.stringify(['new-A', 'same:id'])]);
    assert.equal(f.text().includes('controlled obsolete catalog body error'), false);
    f.check();
  });
});


test('actual remembered Skills loaded adapter and maintenance own content/body/catch/finally', async t => {
  const { f, graph: c, props } = await generalFixture(t);
  const makeSkill = name => ({ name, description: `${name} description`, filePath: `/project/skills/${name}/SKILL.md`, baseDir: `/project/skills/${name}`, disableModelInvocation: false, sourceInfo: { source: 'project', scope: 'project' }, install: { package: `owner/${name}`, scope: 'project', source: `owner/${name}`, versionHash: 'one', canCheckForUpdates: true } });
  const skills = [makeSkill('first'), makeSkill('remembered')];
  const contentEntered = f.gate('remembered skill content admitted'), body = f.gate('skill maintenance body');
  f.route('GET', '/api/skills', { query: { cwd: '/project' }, reply: { data: { skills, diagnostics: [], projectResourcesLoaded: true } } });
  f.route('GET', '/api/skills/content', { query: { cwd: '/project', filePath: skills[1].filePath }, reply: () => { contentEntered.release(); return { data: { content: '' } }; } });
  let status = 503;
  f.route('POST', '/api/skills/check', { body: { cwd: '/project' }, reply: () => ({ gate: body, status, data: status === 503 ? { error: 'skill maintenance refused' } : { updates: [] } }) });
  await f.mount(h(c.SettingsPanel, { ...props, initialSection: 'skills' }), { setup(window) {
    window.localStorage.setItem('pi-web:settings-navigation', JSON.stringify({ selections: { '["skills","/project"]': skills[1].filePath } }));
  } });
  await contentEntered.promise;
  await f.commit(undefined, 'skills.instructions');
  assert.equal(f.node('.config-sidebar-item[aria-current="page"]').textContent.trim(), 'remembered');
  assert.equal(f.node('[role="region"][aria-label="Instructions"]').textContent.includes('No instructions in this skill.'), true);
  assert.equal(f.works.some(work => work.label === 'skills.instructions' && work.settled), true, 'real selected instructions operation joined');
  const label = c.enLocale.messages['i18n.checkUpdates'];
  await f.click(f.button(label), { settle: false });
  assert.equal(f.works.findLast(work => work.label === 'skills.checkForUpdates').settled, false);
  await f.deliver(body, 'skills.checkForUpdates');
  assert.equal(f.text().includes('skill maintenance refused'), true);
  assert.equal(f.button(label).disabled, false);
  status = 200; await f.click(f.button(label));
  assert.equal(f.text().includes('skill maintenance refused'), false);
  assert.equal(c.getLastSettingsSelection('skills', '/project'), skills[1].filePath);
  const host = f.node('[role="region"][aria-label="Instructions"]');
  await f.click(f.button('General', f.node('.settings-section-tabs')));
  assert.equal(host.closest('.settings-section-host').hidden, true);
  await f.click(f.button('Skills', f.node('.settings-section-tabs')));
  assert.equal(f.node('[role="region"][aria-label="Instructions"]') === host, true);
});

test('actual remembered Plugins loaded adapter preserves compact metadata and joins maintenance/refresh', async t => {
  const { f, graph: c, props } = await generalFixture(t);
  const counts = { extensions: 1, skills: 0, prompts: 0, themes: 0 };
  const pkg = source => ({ source, scope: 'project', canCheckForUpdates: true, filtered: false, disabled: false, counts, resources: [], status: 'loaded', version: '9.9', configuredVersion: '^9', description: 'detail-only description' });
  const packages = [pkg('npm:first'), pkg('npm:remembered')];
  const listing = { packages, standaloneExtensions: [], totals: counts, diagnostics: [], projectResourcesLoaded: true };
  const checkBody = f.gate('plugin check JSON'), reloadBody = f.gate('plugin reload JSON'); let refreshing = false, status = 503;
  f.route('GET', '/api/plugins', { query: { cwd: '/project' }, reply: () => ({ ...(refreshing ? { gate: reloadBody } : {}), data: listing }) });
  f.route('GET', '/api/plugins/bundled', { query: { cwd: '/project', sessionId: 'session-A' }, reply: { data: { plugins: [] } } });
  f.route('POST', '/api/plugins/check', { body: { cwd: '/project' }, reply: () => ({ gate: checkBody, status, data: status === 503 ? { error: 'plugin maintenance refused' } : { updates: [] } }) });
  await f.mount(h(c.SettingsPanel, { ...props, initialSection: 'plugins' }), { setup(window) {
    window.localStorage.setItem('pi-web:settings-navigation', JSON.stringify({ selections: { '["plugins","/project"]': 'project\u0000npm:remembered' } }));
  } });
  assert.equal(f.node('.config-sidebar-item[aria-current="page"]').textContent.trim(), 'npm:remembered');
  const sidebar = f.node('.config-sidebar-list');
  assert.equal(sidebar.textContent.includes('9.9'), false);
  assert.equal(sidebar.textContent.includes('detail-only description'), false);
  assert.equal(f.node('.config-detail').textContent.includes('npm:remembered'), true);
  assert.equal(f.works.some(work => work.label === 'plugins.bundledSidebar' && work.settled), true, 'actual bundled sidebar GET body and callback joined');
  const label = c.enLocale.messages['i18n.checkUpdates'];
  await f.click(f.button(label, f.node('.config-footer')), { settle: false });
  await f.deliver(checkBody, 'plugins.checkForUpdates');
  assert.equal(f.text().includes('plugin maintenance refused'), true);
  status = 200; await f.click(f.button(label, f.node('.config-footer')));
  assert.equal(f.text().includes('plugin maintenance refused'), false);
  refreshing = true;
  await f.click(f.button(c.enLocale.messages['i18n.refresh'], f.node('.config-footer')), { settle: false });
  assert.equal(f.works.findLast(work => work.label === 'plugins.loadPlugins').settled, false);
  await f.deliver(reloadBody, 'plugins.loadPlugins');
  assert.equal(c.getLastSettingsSelection('plugins', '/project'), 'project\u0000npm:remembered');
});
