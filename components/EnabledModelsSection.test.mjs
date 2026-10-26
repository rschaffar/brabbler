import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { createElement as h, act } from "react";
import { settingsFixture } from "./settings.fixture.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const {
  enabledModelsBulkActions,
  enabledModelsProviderToggle,
  filterEnabledModels,
  isLastEnabledModel,
  providerBadgeLabel,
} = await jiti.import("./enabled-models-helpers.ts");

const entry = (id, enabled, extra = {}) => ({
  id,
  name: id.toUpperCase(),
  ref: `anthropic/${id}`,
  enabled,
  ...extra,
});

function view(models, overrides = {}) {
  return {
    allEnabled: false,
    patterns: ["anthropic/*"],
    stalePatterns: [],
    enabledTotal: models.filter((model) => model.enabled).length,
    availableTotal: models.length,
    providers: [{
      id: "anthropic",
      name: "Anthropic",
      kind: "builtin",
      enabledCount: models.filter((model) => model.enabled).length,
      models,
    }],
    scope: "global",
    editable: true,
    ...overrides,
  };
}

test("the filter matches model ids and display names", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  assert.deepEqual(filterEnabledModels(models, "opu").map((model) => model.id), ["opus"]);
  assert.deepEqual(filterEnabledModels(models, "SONNET").map((model) => model.id), ["sonnet"]);
  assert.equal(filterEnabledModels(models, "   ").length, 2);
});

test("bulk actions only offer the direction that changes something", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  // Other providers keep models on, so both directions are live here.
  const actions = enabledModelsBulkActions(view(models, { enabledTotal: 4 }), models);
  assert.deepEqual(actions.enableRefs, ["anthropic/opus"]);
  assert.deepEqual(actions.disableRefs, ["anthropic/sonnet"]);
  assert.equal(actions.canEnable, true);
  assert.equal(actions.canDisable, true);

  const allOn = [entry("sonnet", true), entry("opus", true)];
  assert.equal(enabledModelsBulkActions(view(allOn), allOn).canEnable, false);
});

test("a bulk disable that would empty the scope is withheld", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  const actions = enabledModelsBulkActions(view(models), models);
  assert.equal(actions.canDisable, false);
  assert.deepEqual(actions.disableRefs, ["anthropic/sonnet"]);
});

test("a bulk disable stays available while other providers keep models on", () => {
  const models = [entry("sonnet", true)];
  const scoped = view(models, { enabledTotal: 3, availableTotal: 5 });
  assert.equal(enabledModelsBulkActions(scoped, models).canDisable, true);
});

test("read-only project scope disables both bulk actions", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  const readOnly = view(models, { scope: "project", editable: false, enabledTotal: 4 });
  const actions = enabledModelsBulkActions(readOnly, models);
  assert.equal(actions.canEnable, false);
  assert.equal(actions.canDisable, false);
});

test("the last enabled model is locked on", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  const single = view(models);
  assert.equal(isLastEnabledModel(single, models[0]), true);
  assert.equal(isLastEnabledModel(single, models[1]), false);
  assert.equal(isLastEnabledModel(view(models, { enabledTotal: 2 }), models[0]), false);
});

test("the sidebar badge only appears while the selector is narrowed", () => {
  const models = [entry("sonnet", true), entry("opus", false)];
  assert.equal(providerBadgeLabel(view(models), "anthropic"), "1/2");
  assert.equal(providerBadgeLabel(view(models, { allEnabled: true }), "anthropic"), null);
  assert.equal(providerBadgeLabel(view(models), "openai"), null);
  assert.equal(providerBadgeLabel(null, "anthropic"), null);
});

test("the provider switch is on only while every model of the provider is", () => {
  const providerOf = (models, overrides = {}) => {
    const full = view(models, overrides);
    return [full, { ...full.providers[0], kind: "custom" }];
  };

  // Other providers keep models on, so both directions are live here.
  const [allOn, allOnProvider] = providerOf([entry("sonnet", true), entry("opus", true)], { enabledTotal: 4 });
  assert.deepEqual(enabledModelsProviderToggle(allOn, allOnProvider), { checked: true, blocked: false, reason: null });

  // A partial selection reads as off, and one click completes it.
  const [partial, partialProvider] = providerOf([entry("sonnet", true), entry("opus", false)], { enabledTotal: 4 });
  assert.deepEqual(enabledModelsProviderToggle(partial, partialProvider), { checked: false, blocked: false, reason: null });

  const [none, noneProvider] = providerOf([entry("sonnet", false), entry("opus", false)], { enabledTotal: 3 });
  assert.deepEqual(enabledModelsProviderToggle(none, noneProvider), { checked: false, blocked: false, reason: null });
});

test("the provider switch is locked when it would empty the scope or the file is read-only", () => {
  const lockedOn = view([entry("sonnet", true), entry("opus", true)], { enabledTotal: 2 });
  assert.deepEqual(
    enabledModelsProviderToggle(lockedOn, { ...lockedOn.providers[0], kind: "custom" }),
    { checked: true, blocked: true, reason: "last-model" },
  );

  const readOnly = view([entry("sonnet", true), entry("opus", false)], {
    scope: "project",
    editable: false,
    enabledTotal: 4,
  });
  assert.deepEqual(
    enabledModelsProviderToggle(readOnly, { ...readOnly.providers[0], kind: "custom" }),
    { checked: false, blocked: true, reason: "project-scope" },
  );
});


function enabledWrites(f) { return f.requests.filter(request => request.method === 'PUT' && request.path === '/api/models/enabled'); }
function requireEnabledWrite(f, before, body) {
  const writes = enabledWrites(f);
  assert.equal(writes.length, before + 1, 'one actual enabled-model PUT admitted by this action');
  const request = writes.at(-1);
  assert.deepEqual({ method: request.method, path: request.path, body: request.body }, { method: 'PUT', path: '/api/models/enabled', body }, 'captured actual enabled-model mutation identity');
  return request;
}

async function mountedEnabled(t, initial, { providerId = 'anthropic', custom = false } = {}) {
  const f = await settingsFixture(t);
  const graph = await f.load('enabled');
  let latest, snapshot = initial;
  f.route('GET', '/api/models/enabled', { query: { cwd: '/project' }, reply: () => ({ data: snapshot }) });
  function Probe() {
    latest = graph.useEnabledModels('/project');
    return h('div', null, h(graph.EnabledModelsBanner, { controller: latest }),
      custom ? h(graph.EnabledModelsProviderSwitch, { providerId, controller: latest }) : h(graph.EnabledModelsSection, { providerId, controller: latest }));
  }
  await f.mount(h(Probe));
  return { f, controller: () => latest, setSnapshot(value) { snapshot = value; } };
}

test('actual serialized PUT queue retains the latest save-resync after success AND failure', async t => {
  for (const status of [200, 409]) {
    await t.test(`toggle ${status}`, async t => {
      const initial = view([entry('sonnet', true), entry('opus', false)], { enabledTotal: 4, settingsPath: '~/.pi/agent/settings.json' });
      const { f, controller } = await mountedEnabled(t, initial);
      const held = f.gate('toggle body'); let writes = 0;
      const expected = [
        { op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project' },
        { op: 'resync', renames: [{ from: 'old', to: 'new' }], modelRenames: [{ from: 'old/id', to: 'new/id2' }], fullyEnabled: [], cwd: '/project' },
      ];
      f.route('PUT', '/api/models/enabled', { body: () => expected[writes], reply: () => {
        writes++;
        return writes === 1 ? { gate: held, status, data: status === 200 ? initial : { reason: 'last-model', error: 'raw refusal must not leak' } } : { data: initial };
      } });
      await f.click('button[aria-label="Show OPUS in the model selector"]', { settle: false });
      assert.equal(controller().pending, 'anthropic/opus');
      const active = f.node('button[aria-label="Show OPUS in the model selector"]');
      const other = f.node('button[aria-label="Show SONNET in the model selector"]');
      const enable = f.button('Enable all'), disable = f.button('Disable all');
      assert.equal(active.disabled, true, 'active pending row is locked');
      assert.equal(active.getAttribute('aria-busy'), 'true', 'actual pending row carries busy metadata');
      assert.equal(other.disabled, true, 'other row is locked during the same mutation');
      assert.deepEqual([enable.disabled, disable.disabled], [true, true], 'real bulk controls locked during held JSON');
      const admittedBeforeDisabledActivation = enabledWrites(f).length;
      await act(async () => { active.click(); other.click(); enable.click(); disable.click(); });
      assert.equal(enabledWrites(f).length, admittedBeforeDisabledActivation, 'native disabled activation admits no extra operation');
      await act(async () => {
        controller().resync([], []); // Superseded one-slot intent, NOT a FIFO.
        controller().resync(expected[1].renames, expected[1].modelRenames);
      });
      assert.equal(writes, 1, 'resync cannot overlap settings-file mutation');
      await f.deliver(held, 'enabled.mutate');
      assert.equal(writes, 2, 'latest resync is not dropped after toggle settlement');
      assert.equal(controller().pending, null, 'complete finally and nested queued operation joined');
      assert.deepEqual([active.disabled, other.disabled, enable.disabled, disable.disabled], [false, false, false, false], 'appropriate global controls unlock only after full success/refusal and queued finally');
      assert.equal(active.getAttribute('aria-busy'), null, 'pending busy metadata cleared after full chain');
      assert.equal(active.getAttribute('aria-checked'), 'false', 'returned view, not optimistic state, controls checked value');
    });
  }
});

test('actual filtered bulk sends shown refs; whole provider is server-resolved; pins and counts stay visible', async t => {
  const models = Array.from({ length: 9 }, (_, i) => entry(`model-${i}`, i === 0, i === 0 ? { thinkingPin: 'high' } : {}));
  const initial = view(models, { enabledTotal: 4, availableTotal: 12, settingsPath: '~/.pi/agent/settings.json' });
  const { f } = await mountedEnabled(t, initial);
  let expected;
  f.route('PUT', '/api/models/enabled', { body: () => expected, reply: { data: initial } });
  assert.equal(f.node('.enabled-models-pin').textContent, 'high');
  assert.equal(f.node('.enabled-models-banner-facts').textContent, '· enabledModels 4/12');
  await f.input('.enabled-models-filter', 'MODEL-8');
  assert.equal(f.view.container.querySelectorAll('.enabled-models-row').length, 1);
  expected = { op: 'models', refs: ['anthropic/model-8'], enabled: true, cwd: '/project' };
  let before = enabledWrites(f).length;
  await f.click(f.button('Enable shown'));
  requireEnabledWrite(f, before, { op: 'models', refs: ['anthropic/model-8'], enabled: true, cwd: '/project' });
  await f.input('.enabled-models-filter', '');
  expected = { op: 'provider', provider: 'anthropic', enabled: true, cwd: '/project' };
  before = enabledWrites(f).length;
  await f.click(f.button('Enable all'));
  requireEnabledWrite(f, before, { op: 'provider', provider: 'anthropic', enabled: true, cwd: '/project' });
});

test('actual refusal localization, project shadow, last-model lock and prune eligibility', async t => {
  const initial = view([entry('sonnet', true), entry('opus', false)], { enabledTotal: 1, stalePatterns: ['unmatched/high:high'], settingsPath: '~/.pi/agent/settings.json' });
  const { f, controller, setSnapshot } = await mountedEnabled(t, initial);
  assert.equal(f.node('button[aria-label="At least one model has to stay enabled."]').disabled, true);
  let expected = { op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project' }, reason = 'last-model';
  f.route('PUT', '/api/models/enabled', { body: () => expected, reply: () => ({ status: 409, data: { reason, error: `raw ${reason}` } }) });
  let before = enabledWrites(f).length;
  await f.click('button[aria-label="Show OPUS in the model selector"]');
  requireEnabledWrite(f, before, { op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project' });
  assert.equal(f.node('button[aria-label="At least one model has to stay enabled."]').disabled, true, 'last-model restriction survives refusal/finally');
  assert.equal(f.node('button[aria-label="Show OPUS in the model selector"]').disabled, false, 'eligible row unlocks after refusal/finally');
  assert.equal(f.node('.enabled-models-error').textContent, 'At least one model has to stay enabled.');
  reason = 'project-scope';
  before = enabledWrites(f).length;
  await f.click('button[aria-label="Show OPUS in the model selector"]');
  requireEnabledWrite(f, before, { op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project' });
  assert.equal(f.node('button[aria-label="Show OPUS in the model selector"]').getAttribute('aria-busy'), null);
  assert.equal(f.node('button[aria-label="At least one model has to stay enabled."]').disabled, true);
  assert.equal(f.node('.enabled-models-error').textContent.startsWith("This project's .pi/settings.json"), true);
  assert.equal(f.node('.enabled-models-error').textContent.includes('raw project-scope'), false);
  expected = { op: 'prune', cwd: '/project' };
  before = enabledWrites(f).length;
  await f.click(f.button('Remove unmatched entries'));
  requireEnabledWrite(f, before, { op: 'prune', cwd: '/project' });
  assert.equal(controller().view.stalePatterns.length, 1, 'refused prune does not fabricate a successful removal');
  setSnapshot({ ...initial, stalePatterns: [] });
  await f.commit(() => controller().refresh());
  assert.equal([...f.view.container.querySelectorAll('.enabled-models-banner button')].some(n => n.textContent === 'Remove unmatched entries'), false, 'no prune for zero unmatched entries');
  setSnapshot({ ...initial, editable: false, scope: 'project', settingsPath: '/project/.pi/settings.json' });
  await f.commit(() => controller().refresh());
  assert.equal([...f.view.container.querySelectorAll('.enabled-models-row [role="switch"]')].every(n => n.disabled), true);
  assert.equal([...f.view.container.querySelectorAll('.enabled-models-row [role="switch"]')].every(node => node.getAttribute('aria-busy') === null), true, 'project restriction, not leftover pending, owns disabled state');
  assert.equal(f.view.container.querySelectorAll('.enabled-models-banner button').length, 0, 'readonly cannot prune or clear');
  assert.equal(f.node('.enabled-models-note').textContent.includes(".pi/settings.json"), true);
  assert.equal(f.node('.enabled-models-banner-key').title, '/project/.pi/settings.json');
});

test('actual custom switch is off for partial, completes provider in one click, unavailable reason is only a tooltip', async t => {
  const initial = view([entry('sonnet', true), entry('opus', false)], { enabledTotal: 4, settingsPath: '~/.pi/agent/settings.json' });
  initial.providers[0].kind = 'custom';
  const { f, controller, setSnapshot } = await mountedEnabled(t, initial, { custom: true });
  const completed = { ...initial, enabledTotal: initial.enabledTotal + 1, providers: [{ ...initial.providers[0], enabledCount: 2, models: initial.providers[0].models.map(model => ({ ...model, enabled: true })) }] };
  f.route('PUT', '/api/models/enabled', { body: { op: 'provider', provider: 'anthropic', enabled: true, cwd: '/project' }, reply: { data: completed } });
  assert.equal(f.node('[role="switch"]').getAttribute('aria-checked'), 'false');
  const before = enabledWrites(f).length, readsBefore = f.requests.filter(request => request.method === 'GET').length;
  await f.click('[role="switch"]');
  requireEnabledWrite(f, before, { op: 'provider', provider: 'anthropic', enabled: true, cwd: '/project' });
  assert.equal(f.node('[role="switch"]').getAttribute('aria-checked'), 'true', 'actual PUT completion, not an independent GET, checks the provider');
  assert.equal(controller().view.providers[0].enabledCount, 2);
  assert.equal(controller().pending, null);
  assert.equal(f.requests.filter(request => request.method === 'GET').length, readsBefore, 'no injected refresh substitutes for write delivery');
  const allOn = { ...initial, enabledTotal: 2, providers: [{ ...initial.providers[0], enabledCount: 2, models: initial.providers[0].models.map(model => ({ ...model, enabled: true })) }] };
  setSnapshot(allOn); await f.commit(() => controller().refresh());
  assert.equal(f.node('[role="switch"]').disabled, true);
  assert.equal(f.node('[role="switch"]').title, 'At least one model has to stay enabled.');
  assert.equal(f.view.container.querySelectorAll('p').length, 0, 'refusal belongs to tooltip');
  setSnapshot({ ...initial, editable: false, scope: 'project' }); await f.commit(() => controller().refresh());
  assert.equal(f.node('[role="switch"]').disabled, true);
  assert.equal(f.node('[role="switch"]').title.startsWith("This project's .pi/settings.json"), true);
  setSnapshot({ ...initial, providers: [] });
  await f.commit(() => controller().refresh());
  const control = f.node('[role="switch"]');
  assert.equal(control.disabled, true);
  assert.equal(control.title.includes('Save your changes'), true);
  assert.equal(f.text().includes('Sign in'), false);
  assert.equal(f.view.container.querySelector('.enabled-models-section') === null, true, 'custom header has no built-in section');
});

test('actual explicit catalog refresh posts exact provider only; offline/unchanged/changed/errors retain feedback', async t => {
  const initial = view([entry('sonnet', true)], { settingsPath: '~/.pi/agent/settings.json' });
  const { f } = await mountedEnabled(t, initial);
  let reply = { completed: false, reason: 'offline' }, status = 200;
  f.route('POST', '/api/models/refresh', { body: { provider: 'anthropic' }, reply: () => ({ status, data: reply }) });
  assert.equal(f.requests.some(r => r.method === 'POST'), false, 'no automatic catalog request');
  const initialReads = f.requests.filter(r => r.path === '/api/models/enabled').length;
  for (const [data, http, text] of [
    [{ completed: false, reason: 'offline' }, 200, 'offline'],
    [{ completed: false, reason: 'runtime' }, 200, 'Could not'],
    [{ completed: true, changed: false }, 200, 'up to date'],
    [{ completed: true, changed: true }, 200, 'updated'],
    [{ error: 'network refusal' }, 500, 'Could not'],
  ]) {
    reply = data; status = http;
    await f.click(f.button('Refresh catalog'));
    assert.equal(f.node('.enabled-models-note').textContent.toLowerCase().includes(text.toLowerCase()), true, `catalog feedback ${text}`);
  }
  assert.equal(f.requests.filter(r => r.path === '/api/models/enabled').length, initialReads + 1, 'only the changed catalog reloads the actual enabled view');
});

test('enabled-model title, row separators and provider badge CSS declarations', async () => {
  const css = await readFile(new URL('../app/settings.css', import.meta.url), 'utf8');
  const title = css.slice(css.indexOf('.enabled-models-title {'));
  assert.match(title.slice(0, title.indexOf('}')), /font-size: 13px;[\s\S]*font-weight: 600;/);
  const section = css.slice(css.indexOf('.enabled-models-section {'));
  assert.doesNotMatch(section.slice(0, section.indexOf('}')), /border-top/);
  assert.match(css, /\.models-sidebar-badge \{/);
  assert.match(css, /\.enabled-models-row \+ \.enabled-models-row \{/);
});


test('actual admitted toggle and queued resync drain through full body/callback/finally after observer unmount', async t => {
  const initial = view([entry('sonnet', true), entry('opus', false)], { enabledTotal: 4, settingsPath: '~/.pi/agent/settings.json' });
  const { f, controller } = await mountedEnabled(t, initial);
  const held = f.gate('unmounted admitted toggle body'); let count = 0;
  const queued = { op: 'resync', renames: [], modelRenames: [], fullyEnabled: [], cwd: '/project' };
  const expected = [{ op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project' }, queued];
  f.route('PUT', '/api/models/enabled', { body: () => expected[count], reply: () => ({ ...(count++ === 0 ? { gate: held } : {}), data: initial }) });
  await f.click('button[aria-label="Show OPUS in the model selector"]', { settle: false });
  await act(async () => { controller().resync([], []); });
  // Already admitted logical work may finish. No permission for a third write.
  f.admitContinuation('PUT', '/api/models/enabled', queued);
  await f.cleanup();
  assert.equal(count, 2);
  assert.equal(held.released, true);
  assert.equal(f.works.every(work => work.settled), true, 'full original promises, including nested resync, are joined');
  assert.equal(f.requests.filter(r => r.method === 'GET').every(r => r.signal?.aborted === true), true, 'read observers aborted before realm closure');
});
