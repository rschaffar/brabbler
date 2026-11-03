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

async function mountedEnabled(t, initial, { providerId = 'anthropic', custom = false, accounts, readReply } = {}) {
  const f = await settingsFixture(t);
  const graph = await f.load('enabled');
  let latest, snapshot = initial;
  f.route('GET', '/api/models/enabled', { query: () => ({ cwd: '/project', ...(accounts === undefined ? {} : { accounts: JSON.stringify(accounts) }) }), reply: readReply ?? (() => ({ data: snapshot })) });
  function Probe() {
    latest = graph.useEnabledModels('/project', accounts);
    return h('div', null, h(graph.EnabledModelsBanner, { controller: latest }),
      custom ? h(graph.EnabledModelsProviderSwitch, { providerId, controller: latest }) : h(graph.EnabledModelsSection, { providerId, controller: latest }));
  }
  await f.mount(h(Probe));
  return { f, controller: () => latest, setSnapshot(value) { snapshot = value; },
    async inspect(next) { accounts = next; await f.rerender(h(Probe)); } };
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

test('actual explicit catalog refresh posts the complete default snapshot; unchanged/partial passes reload readback', async t => {
  const initial = view([entry('sonnet', true)], { settingsPath: '~/.pi/agent/settings.json' });
  const { f } = await mountedEnabled(t, initial);
  let reply = { completed: false, reason: 'offline' }, status = 200;
  f.route('POST', '/api/models/refresh', { body: { provider: 'anthropic', accounts: {} }, reply: () => ({ status, data: reply }) });
  assert.equal(f.requests.some(r => r.method === 'POST'), false, 'no automatic catalog request');
  const initialReads = f.requests.filter(r => r.path === '/api/models/enabled').length;
  for (const [data, http, text] of [
    [{ completed: false, reason: 'offline' }, 200, 'offline'],
    [{ completed: false, reason: 'runtime' }, 200, 'Could not'],
    [{ completed: true, changed: false }, 200, 'no metadata changes'],
    [{ completed: false, changed: false }, 200, 'Could not complete'],
    [{ completed: true, changed: true }, 200, 'updated'],
    [{ error: 'network refusal' }, 500, 'Could not'],
  ]) {
    reply = data; status = http;
    await f.click(f.button('Refresh catalog'));
    assert.equal(f.node('.enabled-models-note').textContent.toLowerCase().includes(text.toLowerCase()), true, `catalog feedback ${text}`);
  }
  assert.equal(f.requests.filter(r => r.path === '/api/models/enabled').length, initialReads + 3, 'unchanged, partial and changed attempts all reload the actual enabled view');
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

test('failed account-bound resync settles an invalidated held read and permits authoritative retry', async t => {
  const accounts = Object.freeze({ anthropic: 'account-a', openai: 'retained-account' });
  const initial = view([entry('sonnet', true), entry('opus', false)]);
  let heldRead, snapshot = initial;
  const { f, controller } = await mountedEnabled(t, initial, { accounts,
    readReply: () => ({ ...(heldRead ? { gate: heldRead } : {}), data: snapshot }) });
  heldRead = f.gate('enabled read superseded by refused resync');
  await act(async () => { controller().refresh(); });
  assert.equal(controller().loading, true);
  const body = { op: 'resync', renames: [], modelRenames: [], fullyEnabled: [], cwd: '/project', accounts };
  f.route('PUT', '/api/models/enabled', { body, reply: { status: 500, data: { error: 'Synthetic resync refused' } } });
  await f.commit(() => controller().resync([], []), 'enabled.mutate');
  await f.deliver(heldRead, 'enabled.read');
  assert.equal(controller().pending, null);
  assert.equal(controller().loading, false, 'failed mutation cannot strand the invalidated read spinner');
  assert.equal(f.text().includes('Synthetic resync refused'), true, 'failure remains visible after obsolete read delivery');
  const before = f.requests.filter(r => r.method === 'GET').length;
  heldRead = null; snapshot = view([entry('recovered', true)]);
  await f.commit(() => controller().refresh());
  assert.equal(f.requests.filter(r => r.method === 'GET').length, before + 1);
  assert.equal(f.text().includes('RECOVERED'), true);
  assert.equal(controller().failure, null);
  assert.deepEqual(enabledWrites(f).map(r => r.body), [body], 'retry reads; it never replays the refused write');
});

test('held A catalog refresh invalidates matching A readback after A/B/A without obsolete feedback or automatic POSTs', async t => {
  const a = Object.freeze({ anthropic: 'account-a', openai: 'retained-account' });
  const b = Object.freeze({ anthropic: 'account-b', openai: 'retained-account' });
  const oldA = view([entry('a-before-refresh', true)]);
  const { f, inspect, setSnapshot } = await mountedEnabled(t, oldA, { accounts: a });
  const refresh = f.gate('A catalog completion after A/B/A');
  const body = { provider: 'anthropic', accounts: a };
  f.route('POST', '/api/models/refresh', { body, reply: { gate: refresh, data: { completed: true, changed: true } } });
  assert.equal(f.requests.some(r => r.method === 'POST'), false);
  await f.click(f.button('Refresh catalog'), { settle: false });
  const readsBefore = f.requests.filter(r => r.method === 'GET').length;
  setSnapshot(view([entry('b-catalog', true)])); await inspect(b); await f.commit(undefined, 'enabled.read');
  assert.equal(f.text().includes('B-CATALOG'), true);
  setSnapshot(oldA); await inspect(a); await f.commit(undefined, 'enabled.read');
  assert.equal(f.text().includes('A-BEFORE-REFRESH'), true, 'returning A read completes before its refresh');
  assert.deepEqual(f.requests.filter(r => r.method === 'POST').map(r => r.body), [body], 'navigation never requests a catalog refresh');
  setSnapshot(view([entry('a-after-refresh', true)]));
  await f.deliver(refresh, 'enabled.catalog'); await f.commit(undefined, 'enabled.read');
  const reads = f.requests.filter(r => r.method === 'GET').slice(readsBefore);
  assert.deepEqual(reads.map(r => JSON.parse(new Map(r.query).get('accounts'))), [b, a, a], 'completion triggers a fresh read for matching displayed A');
  assert.equal(f.text().includes('A-AFTER-REFRESH'), true);
  assert.equal(f.view.container.querySelector('.enabled-models-catalog-note') === null, true, 'retired refresh cannot publish catalog feedback; permanent row help is unrelated');
  assert.deepEqual(f.requests.filter(r => r.method === 'POST').map(r => r.body), [body]);
});

test('queued shared resync retains captured A accounts while B remains the displayed catalog', async t => {
  const a = Object.freeze({ anthropic: 'account-a', openai: 'retained-account' });
  const b = Object.freeze({ anthropic: 'account-b', openai: 'retained-account' });
  const initial = view([entry('sonnet', true), entry('opus', false)], { enabledTotal: 4 });
  const { f, controller, inspect, setSnapshot } = await mountedEnabled(t, initial, { accounts: a });
  const held = f.gate('A toggle before queued shared resync'); let count = 0;
  const queued = { op: 'resync', renames: [], modelRenames: [], fullyEnabled: [], cwd: '/project', accounts: a };
  const bodies = [{ op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project', accounts: a }, queued];
  f.route('PUT', '/api/models/enabled', { body: () => bodies[count], reply: () => ({ ...(count++ === 0 ? { gate: held } : {}), data: initial }) });
  await f.click('button[aria-label="Show OPUS in the model selector"]', { settle: false });
  f.admitContinuation('PUT', '/api/models/enabled', queued);
  await act(async () => { controller().resync([], []); });
  setSnapshot(view([entry('b-only', true)])); await inspect(b); await f.commit(undefined, 'enabled.read');
  assert.equal(f.text().includes('B-ONLY'), true);
  await f.deliver(held, 'enabled.mutate'); await f.commit(undefined, 'enabled.read');
  assert.deepEqual(enabledWrites(f).map(r => r.body), bodies);
  assert.equal(f.text().includes('B-ONLY'), true, 'late A write readback cannot replace B');
  assert.equal(controller().pending, null);
});

test('row thinking save is a shared exact-model intent; pending A completion rereads current B without rebinding', async t => {
  const a = { anthropic: 'account-a', retained: 'retained-account' }, b = { anthropic: 'account-b', retained: 'retained-account' };
  const thinking = { supportedLevels: ['off', 'low', 'high'], sharedLevel: 'low', inheritedLevel: 'low' };
  const initial = view([entry('sonnet', true, { thinking }), entry('opus', true, { thinking })]);
  const { f, controller, inspect, setSnapshot } = await mountedEnabled(t, initial, { accounts: a });
  const select = () => f.node('select[aria-label="Thinking default for SONNET"]');
  assert.equal(select().value, 'low', 'native per-model preference is directly editable on its model row');
  const held = f.gate('shared per-model save body');
  const body = { modelThinking: { provider: 'anthropic', modelId: 'sonnet', level: 'high' } };
  f.route('PUT', '/api/models/defaults', { body, reply: { gate: held, data: { thinkingLevel: 'low' } } });
  await f.input(select(), 'high', { settle: false });
  assert.equal(controller().pending, 'thinking:anthropic/sonnet');
  assert.equal(select().disabled, true, 'thinking saves participate in the existing settings mutation serialization');
  assert.equal(f.node('button[aria-label="Show OPUS in the model selector"]').disabled, true, 'enabled edits cannot overlap the same owner');
  await inspect(b); await f.commit(undefined, 'enabled.read');
  assert.equal(select().value, 'low', 'current B remains authoritative until the shared write completes');
  setSnapshot(view([entry('sonnet', true, { thinking: { ...thinking, sharedLevel: 'high' } }), entry('b-only', true, { thinking })]));
  await f.deliver(held, 'enabled.mutate'); await f.commit(undefined, 'enabled.read');
  assert.equal(select().value, 'high', 'shared completion is reflected in the CURRENT inspected account');
  assert.equal(f.text().includes('B-ONLY'), true, 'A response does not republish A catalog data');
  assert.equal(controller().pending, null);
  assert.deepEqual(f.requests.filter(r => r.method !== 'GET').map(r => ({ path: r.path, body: r.body })), [{ path: '/api/models/defaults', body }],
    'no account/cwd, pattern rewrite, chat/project binding or provider-network mutation');
});

test('row thinking exposes supported choices, unsupported saved values, project/pin overrides and retryable Inherit', async t => {
  const thinking = { supportedLevels: ['off', 'low', 'high'], sharedLevel: 'max', inheritedLevel: 'high', projectLevel: 'high' };
  const initial = view([entry('sonnet', true, { thinkingPin: 'high', thinking }), entry('opus', true, { thinking })], { scope: 'project', editable: false });
  const { f, setSnapshot } = await mountedEnabled(t, initial, { accounts: {} });
  const select = () => f.node('select[aria-label="Thinking default for SONNET"]');
  assert.equal(select().value, 'max', 'catalog capabilities do not silently overwrite a shared stored preference');
  assert.equal(select().disabled, false, 'project enabled-pattern scope is not model-default ownership');
  assert.deepEqual([...select().options].filter(option => !option.disabled).map(option => option.value), ['', 'off', 'low', 'high']);
  assert.equal(f.text().includes('Pinned'), true, 'pin precedence is visible, not an unexplained level badge');
  assert.equal(f.text().includes('Project override'), true, 'per-key project default provenance stays separate from enabled scope');
  let refusal = true, expected = { modelThinking: { provider: 'anthropic', modelId: 'sonnet', level: null } };
  f.route('PUT', '/api/models/defaults', { body: () => expected, reply: () => refusal
    ? { status: 500, data: { error: 'Synthetic default unavailable' } } : { data: {} } });
  await f.input(select(), '');
  assert.equal(select().value, 'max', 'failed clear leaves saved state intact');
  assert.equal(select().disabled, false, 'failed finally unlocks retry');
  assert.equal(f.node('.enabled-models-error').textContent, 'Synthetic default unavailable');
  refusal = false;
  setSnapshot(view([entry('sonnet', true, { thinkingPin: 'high', thinking: { ...thinking, sharedLevel: undefined } })], { scope: 'project', editable: false }));
  await f.input(select(), ''); await f.commit(undefined, 'enabled.read');
  assert.equal(select().value, '', 'Inherit is represented by removal, not a persisted pseudo-level');
  assert.equal(select().selectedOptions[0].textContent.includes('high'), true, 'inherit names the native effective pin/project fallback');
  expected = { modelThinking: { provider: 'anthropic', modelId: 'sonnet', level: 'off' } };
  setSnapshot(view([entry('sonnet', true, { thinking: { ...thinking, sharedLevel: 'off' } })], { scope: 'project', editable: false }));
  await f.input(select(), 'off'); await f.commit(undefined, 'enabled.read');
  assert.equal(select().value, 'off', 'off is an explicit native default, distinct from inherit');
  assert.equal(f.requests.filter(r => r.method === 'PUT' && r.path === '/api/models/defaults').length, 3);
  assert.equal(enabledWrites(f).length, 0, 'row defaults never edit project-shadowed enabled patterns');
});

test('thinking readback captured before a queued resync cannot overwrite that mutation after its completion', async t => {
  const base = { supportedLevels: ['off', 'low', 'high'], sharedLevel: 'low', inheritedLevel: 'low' };
  const initial = view([entry('sonnet', true, { thinking: base }), entry('opus', false, { thinking: base })]);
  let readAfterThinking = false;
  const fakes = { afterThinking: view([entry('sonnet', true, { thinking: { ...base, sharedLevel: 'high' } }), entry('opus', false, { thinking: base })]) };
  let heldRead;
  const { f, controller } = await mountedEnabled(t, initial, { accounts: {},
    readReply: () => readAfterThinking ? { gate: heldRead, data: fakes.afterThinking } : { data: initial } });
  const thinking = f.gate('first shared thinking response'), resync = f.gate('queued resync response');
  heldRead = f.gate('pre-resync shared readback');
  const final = view([entry('sonnet', true, { thinking: { ...base, sharedLevel: 'high' } }), entry('opus', true, { thinking: base })]);
  f.route('PUT', '/api/models/defaults', { body: { modelThinking: { provider: 'anthropic', modelId: 'sonnet', level: 'high' } }, reply: { gate: thinking, data: {} } });
  f.route('PUT', '/api/models/enabled', { body: { op: 'resync', renames: [], modelRenames: [], fullyEnabled: [], cwd: '/project', accounts: {} }, reply: { gate: resync, data: final } });
  await f.input('select[aria-label="Thinking default for SONNET"]', 'high', { settle: false });
  await act(async () => { controller().resync([], []); });
  const originalThinking = f.works.find(work => work.label === 'enabled.mutate' && !work.settled).promise;
  readAfterThinking = true;
  await act(async () => { thinking.release(); await originalThinking; });
  assert.equal(f.works.some(work => work.label === 'enabled.read' && !work.settled), true, 'the actual old GET is admitted while queued resync remains held');
  fakes.afterThinking = final; // A subsequent GET sees the durable resync; the already-held body keeps its old snapshot.
  await f.deliver(resync, 'enabled.mutate');
  assert.equal(controller().view.enabledTotal, 2, 'queued mutation publishes its new scope first');
  await f.deliver(heldRead, 'enabled.read');
  assert.equal(controller().view.enabledTotal, 2, 'late older GET must not undo the completed mutation');
  assert.equal(f.node('button[aria-label="Show OPUS in the model selector"]').getAttribute('aria-checked'), 'true');
  assert.equal(controller().loading, false);
});

test('same-catalog thinking readback retains the list node and scroll; a different account still retires it', async t => {
  const thinking = { supportedLevels: ['off', 'low', 'high'], sharedLevel: 'low', inheritedLevel: 'low' };
  const initial = view(Array.from({ length: 10 }, (_, i) => entry(`model-${i}`, true, { thinking })));
  let current = initial, heldRead;
  const { f, inspect } = await mountedEnabled(t, initial, { accounts: {}, readReply: () => ({ ...(heldRead ? { gate: heldRead } : {}), data: current }) });
  const list = f.node('.enabled-models-list');
  list.scrollTop = 120; // DOM identity/retention proof, not physical layout.
  heldRead = f.gate('same-account preference readback');
  current = view(initial.providers[0].models.map(model => ({ ...model, thinking: { ...thinking, sharedLevel: 'high' } })));
  f.route('PUT', '/api/models/defaults', { body: { modelThinking: { provider: 'anthropic', modelId: 'model-9', level: 'high' } }, reply: { data: {} } });
  await f.input('select[aria-label="Thinking default for MODEL-9"]', 'high', { settle: false });
  await f.commit(undefined, 'enabled.mutate');
  assert.equal(f.view.container.querySelector('.enabled-models-list') === list, true, 'same-identity readback keeps the actual list mounted');
  assert.equal(list.scrollTop, 120);
  assert.equal(f.node('select[aria-label="Thinking default for MODEL-9"]').disabled, true, 'readback gates repeated edits without removing their DOM');
  await f.deliver(heldRead, 'enabled.read');
  assert.equal(f.view.container.querySelector('.enabled-models-list') === list, true);
  assert.equal(list.scrollTop, 120);
  assert.equal(f.node('select[aria-label="Thinking default for MODEL-9"]').value, 'high');
  heldRead = f.gate('different-account catalog'); current = view([entry('b-only', true, { thinking })]);
  await inspect({ anthropic: 'account-b' });
  assert.equal(f.view.container.querySelector('.enabled-models-list') === null, true, 'retention never exposes the old account during a new catalog read');
  await f.deliver(heldRead, 'enabled.read');
  assert.equal(f.text().includes('B-ONLY'), true);
  assert.equal(f.view.container.querySelector('.enabled-models-list') === list, false);
});

test('a mutation completion rereads an intervening catalog refresh rather than discarding its newer models', async t => {
  const initial = view([entry('sonnet', true), entry('opus', false)]);
  const toggled = view([entry('sonnet', true), entry('opus', true)]);
  const freshBefore = view([entry('sonnet', true), entry('opus', false), entry('new-catalog-model', true)]);
  const freshAfter = view([entry('sonnet', true), entry('opus', true), entry('new-catalog-model', true)]);
  let phase = 'initial', freshRead;
  const { f, controller } = await mountedEnabled(t, initial, { accounts: {}, readReply: () => phase === 'initial' ? { data: initial }
    : phase === 'held' ? { gate: freshRead, data: freshBefore } : { data: freshAfter } });
  const catalog = f.gate('catalog pass before mutation completion'), mutation = f.gate('old-catalog mutation response');
  freshRead = f.gate('intervening new catalog with pre-write preferences');
  f.route('POST', '/api/models/refresh', { body: { provider: 'anthropic', accounts: {} }, reply: { gate: catalog, data: { completed: true, changed: true } } });
  f.route('PUT', '/api/models/enabled', { body: { op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project', accounts: {} }, reply: { gate: mutation, data: toggled } });
  await f.click(f.button('Refresh catalog'), { settle: false });
  await f.click('button[aria-label="Show OPUS in the model selector"]', { settle: false });
  phase = 'held'; await f.deliver(catalog, 'enabled.catalog');
  assert.equal(f.works.some(work => work.label === 'enabled.read' && !work.settled), true, 'fresh catalog read genuinely intervenes while PUT is held');
  phase = 'final'; await f.deliver(mutation, 'enabled.mutate');
  await f.deliver(freshRead, 'enabled.read');
  assert.equal(f.text().includes('NEW-CATALOG-MODEL'), true, 'completion must retain a path to the newer refreshed catalog');
  assert.equal(controller().view.providers[0].models.find(model => model.id === 'opus').enabled, true, 'fresh readback also reflects the completed preference write');
});

test('failed post-save readback retains labelled stale rows and offers read-only Retry without replaying the save', async t => {
  const thinking = { supportedLevels: ['off', 'low', 'high'], sharedLevel: 'low', inheritedLevel: 'medium' };
  const initial = view([entry('sonnet', true, { thinking })]);
  let failRead = false;
  const { f } = await mountedEnabled(t, initial, { accounts: {}, readReply: () => failRead
    ? { status: 503, data: { error: 'Synthetic readback unavailable' } }
    : { data: failRead === null ? view([entry('sonnet', true, { thinking: { ...thinking, sharedLevel: 'high' } })]) : initial } });
  f.route('PUT', '/api/models/defaults', { body: { modelThinking: { provider: 'anthropic', modelId: 'sonnet', level: 'high' } }, reply: { data: {} } });
  failRead = true;
  await f.input('select[aria-label="Thinking default for SONNET"]', 'high'); await f.commit(undefined, 'enabled.read');
  assert.equal(f.node('select[aria-label="Thinking default for SONNET"]').value, 'low', 'read failure does not fabricate the saved value');
  const retry = f.button('Retry');
  assert.equal(f.text().includes('previous read'), true, 'retained rows are visibly identified as stale');
  assert.equal(f.node('select[aria-label="Thinking default for SONNET"]').disabled, true, 'stale readback is not presented as editable current state');
  failRead = null;
  await f.click(retry); await f.commit(undefined, 'enabled.read');
  assert.equal(f.node('select[aria-label="Thinking default for SONNET"]').value, 'high');
  assert.equal(f.node('select[aria-label="Thinking default for SONNET"]').disabled, false);
  assert.equal(f.view.container.querySelector('.enabled-models-error') === null, true);
  assert.deepEqual(f.requests.filter(request => request.method !== 'GET').map(request => request.path), ['/api/models/defaults'], 'retry reads saved settings only: no second write or provider refresh');
});

test('automatic readback failure does not erase a refused mutation while reconciling an intervening read', async t => {
  const initial = view([entry('sonnet', true), entry('opus', false)]);
  let phase = 'initial', heldRead;
  const { f, controller } = await mountedEnabled(t, initial, { accounts: {}, readReply: () => phase === 'initial' ? { data: initial }
    : { ...(phase === 'held' ? { gate: heldRead } : {}), status: 503, data: { error: 'Synthetic readback refused' } } });
  const write = f.gate('refused mutation after intervening read'); heldRead = f.gate('earlier metadata read');
  f.route('PUT', '/api/models/enabled', { body: { op: 'models', refs: ['anthropic/opus'], enabled: true, cwd: '/project', accounts: {} },
    reply: { gate: write, status: 500, data: { error: 'Synthetic write refused' } } });
  await f.click('button[aria-label="Show OPUS in the model selector"]', { settle: false });
  phase = 'held'; await act(async () => { controller().refresh(); });
  assert.equal(f.works.some(work => work.label === 'enabled.read' && !work.settled), true);
  phase = 'failed'; await f.deliver(write, 'enabled.mutate'); await f.deliver(heldRead, 'enabled.read');
  assert.equal(f.text().includes('Synthetic write refused'), true, 'mutation failure remains visible without a new explicit action');
  assert.equal(f.text().includes('Synthetic readback refused'), true, 'independent stale-read failure is also visible');
  assert.equal(f.requests.filter(request => request.method === 'PUT').length, 1, 'automatic reconciliation never retries the refused edit');
});

test('an admitted shared thinking save settles after row unmount without a catalog read or replay', async t => {
  const initial = view([entry('sonnet', true, { thinking: { supportedLevels: ['off', 'low'], inheritedLevel: 'low' } })]);
  const { f } = await mountedEnabled(t, initial, { accounts: {} });
  const held = f.gate('per-model save through observer unmount');
  f.route('PUT', '/api/models/defaults', { body: { modelThinking: { provider: 'anthropic', modelId: 'sonnet', level: 'off' } }, reply: { gate: held, data: {} } });
  await f.input('select[aria-label="Thinking default for SONNET"]', 'off', { settle: false });
  const reads = f.requests.filter(r => r.path === '/api/models/enabled').length;
  await f.view.unmount();
  await f.deliver(held, 'enabled.mutate');
  assert.equal(f.requests.filter(r => r.path === '/api/models/enabled').length, reads, 'unmounted owner does not trigger a readback');
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 1, 'observer disposal neither cancels nor replays the admitted preference save');
});
