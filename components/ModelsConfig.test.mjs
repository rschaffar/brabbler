import '../lib/testing/client-native-boundary.fixture.mjs';
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";
import { createElement as h, useState } from "react";
import { settingsFixture } from "./settings.fixture.mjs";

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true, fsCache: false });
const {
  collectModelRenames,
  hasModelCostDraftValue,
  modelCostToDraft,
  parseCompleteModelCost,
  providerMatchesSearch,
  savedModelIds,
  serializeHeaderRows,
  setCompatBool,
  trackAddedModels,
  updateHeaderRow,
} = await jiti.import("./models-config-helpers.ts");

test("disabling the developer role writes an explicit false override", () => {
  assert.deepEqual(
    setCompatBool({ compat: { supportsStore: true } }, "supportsDeveloperRole", false),
    { compat: { supportsStore: true, supportsDeveloperRole: false } },
  );
});

test("editing a header preserves row order and stable identities", () => {
  const rows = [
    { id: 10, name: "X-First", value: "one" },
    { id: 11, name: "X-Second", value: "two" },
  ];
  const updated = updateHeaderRow(rows, 10, { name: "X-First-Edited" });

  assert.deepEqual(updated.map(({ id, name }) => ({ id, name })), [
    { id: 10, name: "X-First-Edited" },
    { id: 11, name: "X-Second" },
  ]);
  assert.deepEqual(serializeHeaderRows(updated), {
    "X-First-Edited": "one",
    "X-Second": "two",
  });
});

test("blank header drafts are omitted until they have a name", () => {
  const rows = [
    { id: 1, name: "X-Existing", value: "kept" },
    { id: 2, name: "", value: "draft value" },
  ];

  assert.deepEqual(serializeHeaderRows(rows), { "X-Existing": "kept" });
  assert.deepEqual(
    serializeHeaderRows(updateHeaderRow(rows, 2, { name: "X-Draft" })),
    { "X-Existing": "kept", "X-Draft": "draft value" },
  );
});

test("model cost drafts default blank prices to zero unless all are blank", () => {
  const complete = {
    input: "1.25",
    output: "10",
    cacheRead: "0.125",
    cacheWrite: "0",
  };
  assert.deepEqual(parseCompleteModelCost(complete), {
    input: 1.25,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ ...complete, input: "", cacheWrite: "" }), {
    input: 0,
    output: 10,
    cacheRead: 0.125,
    cacheWrite: 0,
  });
  assert.deepEqual(parseCompleteModelCost({ input: "1.25", output: "", cacheRead: "", cacheWrite: "" }), {
    input: 1.25,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
  assert.equal(parseCompleteModelCost(modelCostToDraft()), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "not-a-price" }), undefined);
  assert.equal(parseCompleteModelCost({ ...complete, output: "-1" }), undefined);
  assert.equal(hasModelCostDraftValue(modelCostToDraft()), false);
  assert.equal(hasModelCostDraftValue({ ...complete, cacheWrite: "" }), true);
});

const draft = (models) => ({ providers: { stepfun: { models: models.map((id) => ({ id })) } } });

test("a model renamed in place is reported with its saved reference", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(
    collectModelRenames(draft(["aaa", "ddd1"]), slots, new Map()),
    [{ from: "stepfun/ddd", to: "stepfun/ddd1" }],
  );
});

test("a model rename keeps the provider id the settings file still spells", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  // The panel renamed the provider too, so the slots moved with it.
  const moved = new Map([["house", slots.get("stepfun")]]);
  assert.deepEqual(
    collectModelRenames(
      { providers: { house: { models: [{ id: "aaa" }, { id: "ddd1" }] } } },
      moved,
      new Map([["stepfun", "house"]]),
    ),
    [{ from: "stepfun/ddd", to: "house/ddd1" }],
  );
});

test("added and removed models never look like a rename", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  trackAddedModels(slots, "stepfun", 1);
  assert.deepEqual(collectModelRenames(draft(["aaa", "ddd", "new"]), slots, new Map()), []);

  const spliced = savedModelIds(draft(["aaa", "ddd"]));
  spliced.get("stepfun").splice(0, 1);
  assert.deepEqual(collectModelRenames(draft(["ddd"]), spliced, new Map()), []);
});

test("a blank id in a half-typed row is not a rename yet", () => {
  const slots = savedModelIds(draft(["aaa", "ddd"]));
  assert.deepEqual(collectModelRenames(draft(["aaa", ""]), slots, new Map()), []);
});

test("a provider added since the last save has no saved slots to compare", () => {
  assert.deepEqual(collectModelRenames(draft(["aaa"]), new Map(), new Map()), []);
});


test('provider search matches names and stable OAuth/API ids through the actual rule', () => {
  const provider = { id: 'fixture-subscription-id', label: 'Friendly Subscription' };
  assert.equal(providerMatchesSearch(' friendly ', provider.id, provider.label), true);
  assert.equal(providerMatchesSearch(' FIXTURE-SUBSCRIPTION-ID ', provider.id, provider.label), true);
  assert.equal(providerMatchesSearch('missing', provider.id, provider.label), false);
  assert.equal(providerMatchesSearch('  ', provider.id, provider.label), true);
});

// A sidebar row includes decorative ProviderIcon initials, thinking flags and
// scope badges. Select its exact semantic text child, never its aggregate text.
function sidebarRow(f, label) {
  const rows = [...f.view.container.querySelectorAll('.config-sidebar-item')]
    .filter(row => row.querySelector('.config-sidebar-text')?.textContent.trim() === label);
  assert.equal(rows.length, 1, `one sidebar label ${label}`);
  return rows[0];
}

function configWrites(f) { return f.requests.filter(request => request.method === 'PUT' && request.path === '/api/models-config'); }
function requireConfigWrite(f, before, body) {
  const writes = configWrites(f);
  assert.equal(writes.length, before + 1, 'one actual models.json PUT per Save');
  const request = writes.at(-1);
  assert.deepEqual({ method: request.method, path: request.path, body: request.body }, { method: 'PUT', path: '/api/models-config', body }, 'actual serialized models.json request');
  assert.equal(f.node('[role="alert"]').textContent, 'inspection save refused', 'intended save failure is delivered and committed');
}

function field(f, label) {
  const node = [...f.view.container.querySelectorAll('.config-field')].find(n => n.querySelector('.config-field-label')?.textContent === label);
  assert.equal(Boolean(node), true, `field ${label}`); return node;
}
const enabledView = (scope = 'global') => ({ allEnabled: false, patterns: ['stepfun/*'], stalePatterns: [], enabledTotal: 2, availableTotal: 2, settingsPath: scope === 'project' ? '/project/.pi/settings.json' : '~/.pi/agent/settings.json', scope, editable: scope !== 'project', providers: [{ id: 'stepfun', name: 'Stepfun', kind: 'custom', enabledCount: 2, models: [{ id: 'aaa', name: 'AAA', ref: 'stepfun/aaa', enabled: true, thinkingPin: 'high' }, { id: 'ddd', name: 'DDD', ref: 'stepfun/ddd', enabled: true }] }] });
async function modelEditor(t, initial, provider = {}) {
  const f = await settingsFixture(t), { ModelDetail } = await f.load('models'); let current;
  function Editor() {
    const [model, setModel] = useState(initial); current = model;
    return h(ModelDetail, { providerName: 'stepfun', provider, model, onChange: setModel, onDelete() {} });
  }
  await f.mount(h(Editor)); return { f, model: () => current };
}
async function modelsPanel(t, { config = { providers: { stepfun: { api: 'openai-completions', models: [{ id: 'aaa' }, { id: 'ddd' }] } } }, providers = { oauthProviders: [], apiKeyProviders: [] }, scope = 'global', enabled, selection } = {}) {
  const f = await settingsFixture(t), graph = await f.load('models');
  let discovery = providers;
  f.route('GET', '/api/models-config', { reply: { data: config } });
  f.route('GET', '/api/auth/providers', { reply: () => ({ data: discovery }) });
  f.route('GET', '/api/models/enabled', { query: { cwd: '/project' }, reply: { data: enabled ?? enabledView(scope) } });
  await f.mount(h(graph.ModelsConfig, { cwd: '/project', embedded: true, onClose() {} }), { setup(window) {
    if (selection) window.localStorage.setItem('brabbler:settings-navigation', JSON.stringify({ selections: { models: JSON.stringify(selection) } }));
  } });
  return { f, graph, discovery(value) { discovery = value; } };
}

// Exact non-rendering appendices formerly bundled into both Markdown inputs.
// Route validation is not the oracle: every intended write has an independent count/body/UI assertion.
test('Markdown managed budget: discovery retry, active auth routing, exact saves, invalid/failure drafts and project clear', async t => {
  const relay = { api: 'openai-completions', models: [{ id: 'keep-me' }] };
  let stored = { providers: { 'openai-codex': { modelOverrides: { 'fixture-context-model': {} } }, relay } };
  let discoveryFailed = true, project = false, rejectSave = false, expected;
  const f = await settingsFixture(t), graph = await f.load('models');
  const enabled = () => ({ allEnabled: true, patterns: null, stalePatterns: [], enabledTotal: 1, availableTotal: 1,
    scope: project ? 'project' : 'global', settingsPath: 'synthetic/settings.json', editable: !project,
    providers: [{ id: 'openai-codex', name: 'OpenAI Codex', kind: 'builtin', enabledCount: 1, models: [{
      id: 'fixture-context-model', name: 'Fixture Context Model', ref: 'openai-codex/fixture-context-model', enabled: true,
      contextWindow: stored.providers['openai-codex']?.modelOverrides?.['fixture-context-model']?.contextWindow ?? 272000,
    }] }] });
  f.route('GET', '/api/models-config', { reply: () => ({ data: stored }) });
  f.route('GET', '/api/auth/providers', { reply: () => ({ data: discoveryFailed ? { error: 'Synthetic provider discovery unavailable' } : {
    oauthProviders: [{ id: 'openai-codex', name: 'OpenAI Codex', loggedIn: false }],
    apiKeyProviders: [{ id: 'openai-codex', displayName: 'OpenAI Codex', configured: true, modelCount: 1 }],
  } }) });
  f.route('GET', '/api/models/enabled', { query: { cwd: '/project' }, reply: () => ({ data: enabled() }) });
  f.route('PUT', '/api/models-config', { body: () => expected, reply: () => {
    if (rejectSave) return { data: { error: 'Synthetic save unavailable' } };
    stored = structuredClone(expected); return { data: { success: true } };
  } });
  const resyncBody = { op: 'resync', renames: [], modelRenames: [], fullyEnabled: ['openai-codex'], cwd: '/project' };
  f.route('PUT', '/api/models/enabled', { body: resyncBody, reply: () => ({ data: enabled() }) });
  const counts = (method, path) => f.requests.filter(r => r.method === method && r.path === path).length;
  const budget = () => {
    const inputs = f.view.container.querySelectorAll('input[aria-label="Context window for Fixture Context Model"]');
    assert.equal(inputs.length, 1, 'one actual Fixture Context Model budget input');
    const [input] = inputs;
    return input;
  };
  const budgetButton = label => {
    // ApiKeyDetail also has a credential Save. Resolve the models.json footer
    // from THIS actual budget input's owning panel, including after remount.
    const panel = budget().closest('.config-panel-root');
    assert.equal(panel !== null, true, 'budget input belongs to a real configuration panel');
    assert.equal(panel.getAttribute('aria-label'), 'Models');
    const actions = panel.querySelectorAll(':scope > .config-panel-surface > .config-footer > .config-footer-actions');
    assert.equal(actions.length, 1, 'one models.json footer action owner for this budget input');
    const [owner] = actions;
    return f.button(label, owner); // Preserve exactly-one button within its real owner.
  };
  const save = async (body, count, succeeds) => {
    expected = body;
    const resyncBefore = counts('PUT', '/api/models/enabled');
    await f.click(budgetButton('Save'));
    assert.equal(configWrites(f).length, count, 'the actual Save admitted exactly one serialized PUT');
    assert.deepEqual(configWrites(f).at(-1).body, body);
    if (succeeds) {
      assert.deepEqual(stored, body);
      assert.equal(budgetButton('Saved').disabled, true, 'server-confirmed success presentation committed');
      assert.equal(counts('PUT', '/api/models/enabled'), resyncBefore + (project ? 0 : 1));
      if (!project) assert.deepEqual(f.requests.filter(r => r.method === 'PUT' && r.path === '/api/models/enabled').at(-1).body, resyncBody);
      await f.timers(2000); // Existing Saved feedback policy, not a work-settlement sleep.
      assert.equal(budgetButton('Save').disabled, false);
    } else {
      assert.equal(budgetButton('Save').disabled, false, 'failed save finally committed');
      assert.equal(f.node('[role="alert"]').textContent, 'Synthetic save unavailable');
      assert.equal(counts('PUT', '/api/models/enabled'), resyncBefore);
    }
  };
  const tree = key => h(graph.ModelsConfig, { key, cwd: '/project', embedded: true, onClose() {} });
  await f.mount(tree('initial'));
  assert.equal(counts('GET', '/api/models-config') > 0, true);
  assert.equal(counts('GET', '/api/auth/providers') > 0, true);
  assert.equal(f.text().includes('Provider discovery is unavailable'), true);
  assert.equal([...f.view.container.querySelectorAll('.config-sidebar-text')].some(n => n.textContent === 'openai-codex'), false);
  const beforeRetry = counts('GET', '/api/auth/providers');
  discoveryFailed = false;
  await f.click(f.button('Retry provider discovery'));
  assert.equal(counts('GET', '/api/auth/providers'), beforeRetry + 1);
  assert.equal(budget().placeholder, '272000', 'automatic routing chooses configured API key rather than inactive OAuth');
  assert.equal(f.text().includes('Disconnect'), true, 'actual configured API-key detail, not custom provider form');
  await f.input(budget(), '500000');
  assert.equal(configWrites(f).length, 0, 'budget is a draft');
  await save({ providers: { 'openai-codex': { modelOverrides: { 'fixture-context-model': { contextWindow: 500000 } } }, relay } }, 1, true);
  assert.deepEqual(Object.keys(stored.providers['openai-codex']), ['modelOverrides']);
  await f.rerender(tree('reopened')); await f.commit();
  await f.click(sidebarRow(f, 'OpenAI Codex')); // Also exercise explicit/manual routing after reopen.
  assert.equal(budget().value, '500000');
  assert.equal([...f.view.container.querySelectorAll('.config-sidebar-text')].some(n => n.textContent === 'openai-codex'), false);
  await f.input(budget(), '500k');
  assert.equal(budget().getAttribute('aria-invalid'), 'true');
  await f.click(budgetButton('Save'));
  assert.equal(configWrites(f).length, 1, 'invalid draft cannot admit a PUT');
  assert.equal(f.node('[role="alert"]').textContent.includes('enter a positive whole number'), true);
  assert.equal(budget().value, '500k');
  await f.input(budget(), '600000'); rejectSave = true;
  const six = { providers: { 'openai-codex': { modelOverrides: { 'fixture-context-model': { contextWindow: 600000 } } }, relay } };
  await save(six, 2, false);
  assert.equal(budget().value, '600000');
  assert.equal(stored.providers['openai-codex'].modelOverrides['fixture-context-model'].contextWindow, 500000);
  rejectSave = false; await save(six, 3, true);
  project = true; await f.rerender(tree('project')); await f.commit();
  await f.click(sidebarRow(f, 'OpenAI Codex'));
  assert.equal(f.text().includes("This project's .pi/settings.json sets enabledModels"), true);
  const enabledReads = counts('GET', '/api/models/enabled'), enabledWrites = counts('PUT', '/api/models/enabled');
  await f.input(budget(), ''); await save({ providers: { relay } }, 4, true);
  await f.commit(); // Joins the separately observed actual effect started by refresh(), not only the PUT body.
  assert.equal(counts('GET', '/api/models/enabled'), enabledReads + 1);
  assert.equal(counts('PUT', '/api/models/enabled'), enabledWrites, 'project shadow never writes enabledModels');
  assert.equal(budget().value, ''); assert.equal(budget().placeholder, '272000');
  assert.deepEqual(stored, { providers: { relay } });
  assert.equal(f.requests.some(r => r.path.startsWith('/api/agent/') || r.path === '/api/provider-usage/query'), false);
  f.check();
});

test('Markdown adaptive endpoint inheritance saves exact sparse config and refuses stale Test success after edit', async t => {
  const provider = { baseUrl: 'http://127.0.0.1:9/provider', api: 'anthropic-messages', apiKey: 'synthetic-not-a-provider-key',
    compat: { forceAdaptiveThinking: true }, models: [{ id: 'adaptive-fixture', name: 'Adaptive fixture', reasoning: true }, { id: 'sibling-fixture', name: 'Sibling fixture' }] };
  const enabled = { allEnabled: true, patterns: null, stalePatterns: [], enabledTotal: 2, availableTotal: 2, scope: 'global', editable: true, settingsPath: 'synthetic/settings.json',
    providers: [{ id: 'e2e-followups', name: 'e2e-followups', kind: 'custom', enabledCount: 2, models: provider.models.map(m => ({ ...m, ref: `e2e-followups/${m.id}`, enabled: true })) }] };
  const { f } = await modelsPanel(t, { config: { providers: { 'e2e-followups': provider } }, enabled });
  let expected;
  f.route('PUT', '/api/models-config', { body: () => expected, reply: { data: { success: true } } });
  const resync = { op: 'resync', renames: [], modelRenames: [], fullyEnabled: ['e2e-followups'], cwd: '/project' };
  f.route('PUT', '/api/models/enabled', { body: resync, reply: { data: enabled } });
  await f.click(sidebarRow(f, 'adaptive-fixture'));
  await f.click('button[aria-controls="model-advanced-settings"]');
  const adaptive = () => [...f.view.container.querySelectorAll('label')].find(n => n.textContent === 'Claude adaptive thinking')?.querySelector('input');
  assert.equal(Boolean(adaptive()), true); assert.equal(adaptive().checked, true);
  await f.click(adaptive()); await f.input(field(f, 'Base URL override').querySelector('input'), 'http://127.0.0.1:9/model-override');
  expected = { providers: { 'e2e-followups': { ...provider, models: [{ ...provider.models[0], baseUrl: 'http://127.0.0.1:9/model-override', compat: { forceAdaptiveThinking: false } }, provider.models[1]] } } };
  await f.click(f.button('Save'));
  assert.equal(configWrites(f).length, 1); assert.deepEqual(configWrites(f)[0].body, expected);
  assert.equal(f.button('Saved').disabled, true);
  await f.timers(2000); assert.equal(f.button('Save').disabled, false);
  assert.equal(f.requests.filter(r => r.method === 'PUT' && r.path === '/api/models/enabled').length, 1);
  assert.deepEqual(f.requests.filter(r => r.method === 'PUT' && r.path === '/api/models/enabled')[0].body, resync);
  await f.input(field(f, 'Base URL override').querySelector('input'), ''); await f.click(adaptive());
  expected = { providers: { 'e2e-followups': provider } };
  await f.click(f.button('Save'));
  assert.equal(configWrites(f).length, 2); assert.deepEqual(configWrites(f)[1].body, expected);
  assert.equal(f.button('Saved').disabled, true);
  await f.timers(2000); assert.equal(f.button('Save').disabled, false);
  assert.equal(configWrites(f)[1].body.providers['e2e-followups'].models[0].baseUrl, undefined);
  assert.equal(configWrites(f)[1].body.providers['e2e-followups'].models[0].compat?.forceAdaptiveThinking, undefined);
  assert.equal(configWrites(f)[1].body.providers['e2e-followups'].compat.forceAdaptiveThinking, true);
  assert.deepEqual(configWrites(f)[1].body.providers['e2e-followups'].models[1], provider.models[1]);
  assert.equal(f.requests.filter(r => r.method === 'PUT' && r.path === '/api/models/enabled').length, 2);
  const api = field(f, 'API override').querySelector('select');
  await f.input(api, 'openai-completions'); assert.equal(adaptive() === undefined, true);
  await f.input(api, ''); assert.equal(adaptive().checked, true);
  const testRequestsBefore = f.requests.length;
  const held = f.gate('Markdown stale connection-test response');
  f.route('POST', '/api/models-config/test', { body: { providerName: 'e2e-followups', provider, model: provider.models[0] },
    reply: { gate: held, data: { ok: true, responseText: 'STALE_CONNECTION_SENTINEL' } } });
  await f.click(f.button('Test'), { settle: false });
  assert.equal(f.requests.filter(r => r.method === 'POST' && r.path === '/api/models-config/test').length, 1, 'Test really entered');
  assert.deepEqual(f.requests.at(-1).body, { providerName: 'e2e-followups', provider, model: provider.models[0] });
  await f.input(field(f, 'Base URL override').querySelector('input'), 'http://127.0.0.1:9/changed-after-test', { settle: false });
  await f.deliver(held, 'models.handleTest');
  assert.deepEqual(f.requests.slice(testRequestsBefore).map(({ method, path }) => ({ method, path })), [{ method: 'POST', path: '/api/models-config/test' }], 'Test/edit/late delivery neither refetches nor retries nor saves');
  assert.equal(f.text().includes('STALE_CONNECTION_SENTINEL'), false);
  assert.equal(f.button('Test').disabled, false);
  assert.equal(field(f, 'Base URL override').querySelector('input').value, 'http://127.0.0.1:9/changed-after-test');
  assert.equal(configWrites(f).length, 2, 'testing/editing never saves config');
  assert.equal(f.text().includes('Open sessions: select the model again while idle to apply saved changes.'), true);
});

test('actual Add provider search matches label/stable OAuth/API IDs while retaining eligibility', async t => {
  const providers = {
    oauthProviders: [{ id: 'fixture-subscription-id', name: 'Friendly Subscription', loggedIn: false, usesCallbackServer: false }, { id: 'active-oauth', name: 'Already connected', loggedIn: true, usesCallbackServer: false }],
    apiKeyProviders: [{ id: 'fixture-api-id', displayName: 'Friendly Key', configured: false, modelCount: 2 }, { id: 'active-api', displayName: 'Already configured', configured: true, modelCount: 2 }],
  };
  const { f } = await modelsPanel(t, { config: {}, providers });
  await f.click(f.button('Add provider'));
  const filter = f.node('input[placeholder="Search providers…"]');
  for (const [query, expected] of [[' friendly ', ['Friendly Subscription', 'Friendly Key']], [' FIXTURE-SUBSCRIPTION-ID ', ['Friendly Subscription']], ['fixture-api-id', ['Friendly Key']], ['missing', []]]) {
    await f.input(filter, query);
    const buttons = [...filter.closest('div').parentElement.querySelectorAll('button')].map(n => n.textContent);
    for (const label of ['Friendly Subscription', 'Friendly Key']) assert.equal(buttons.some(n => n.includes(label)), expected.includes(label), `eligibility ${query}/${label}`);
    assert.equal(buttons.some(n => n.includes('Already')), false);
  }
  await f.input(filter, ' ');
  assert.equal(f.text().includes('OpenAI / Anthropic compatible'), true);
  await f.timers(30); // Exact production autofocus deadline; not async settlement.
  assert.equal(f.view.window.document.activeElement === filter, true);
});

test('actual malformed auth refresh retains both lists and a valid retry restores both', async t => {
  const { f, discovery } = await modelsPanel(t, { providers: { oauthProviders: [{ id: 'old-oauth', name: 'Old OAuth', loggedIn: true }], apiKeyProviders: [{ id: 'old-key', displayName: 'Old Key', configured: true, modelCount: 1 }] } });
  // Trigger a real auth write so onRefresh reloads BOTH lists.
  await f.click(sidebarRow(f, 'Old Key'));
  discovery({ oauthProviders: null, apiKeyProviders: {} });
  f.route('DELETE', '/api/auth/api-key/old-key', { reply: { data: { success: true } } });
  await f.click(f.button('Disconnect'));
  assert.equal(f.text().includes('Old OAuth'), true); assert.equal(f.text().includes('Old Key'), true);
  assert.equal(f.node('[role="alert"]').textContent.includes('Provider discovery is unavailable'), true);
  discovery({ oauthProviders: [{ id: 'new-oauth', name: 'New OAuth', loggedIn: true }], apiKeyProviders: [{ id: 'new-key', displayName: 'New Key', configured: true, modelCount: 2 }] });
  await f.click(f.button('Retry provider discovery'));
  assert.equal(f.text().includes('New OAuth'), true); assert.equal(f.text().includes('New Key'), true);
  assert.equal(f.text().includes('Old OAuth'), false); assert.equal(f.text().includes('Old Key'), false);
});

test('actual provider/model HeaderListEditors preserve blank rows, order and explicit compatibility override', async t => {
  const { f } = await modelsPanel(t, { config: { providers: { stepfun: { api: 'openai-completions', headers: { 'X-Provider': 'provider' }, compat: { supportsDeveloperRole: false }, models: [{ id: 'aaa', reasoning: true, headers: { 'X-First': 'one', 'X-Second': 'two' }, compat: { supportsStore: true } }] } } } });
  let saved;
  f.route('PUT', '/api/models-config', { body: () => saved, reply: { status: 500, data: { error: 'inspection save refused' } } });
  const providerHeader = f.node('input[placeholder="Header-Name"]');
  await f.input(providerHeader, 'X-Provider-Edited');
  await f.click(sidebarRow(f, 'aaa'));
  const advanced = f.node('button[aria-controls="model-advanced-settings"]');
  await f.click(advanced);
  const headerInputs = () => [...f.view.container.querySelectorAll('input[placeholder="Header-Name"]')];
  const second = headerInputs()[1];
  await f.input(headerInputs()[0], 'X-First-Edited');
  assert.equal(headerInputs()[1] === second, true, 'editing first row retains second DOM identity');
  await f.click(f.button('+ Add header'));
  const values = [...f.view.container.querySelectorAll('input[placeholder="value"]')];
  await f.input(values[2], 'draft value');
  const developer = [...f.view.container.querySelectorAll('label')].find(n => n.textContent.includes('developer'))?.querySelector('input');
  assert.equal(Boolean(developer), true, 'real developer role checkbox');
  assert.equal(developer.checked, false, 'merged provider false shown');
  await f.click(developer); await f.click(developer);
  saved = { providers: { stepfun: { api: 'openai-completions', headers: { 'X-Provider-Edited': 'provider' }, compat: { supportsDeveloperRole: false }, models: [{ id: 'aaa', reasoning: true, headers: { 'X-First-Edited': 'one', 'X-Second': 'two' }, compat: { supportsStore: true, supportsDeveloperRole: false } }] } } };
  const firstSaved = structuredClone(saved), before = configWrites(f).length;
  await f.click(f.button('Save'));
  requireConfigWrite(f, before, firstSaved);
  await f.input(headerInputs()[2], 'X-Draft');
  saved.providers.stepfun.models[0].headers['X-Draft'] = 'draft value';
  const secondSaved = structuredClone(saved), beforeSecond = configWrites(f).length;
  await f.click(f.button('Save'));
  requireConfigWrite(f, beforeSecond, secondSaved);
  assert.equal(configWrites(f).length, before + 2, 'both header Saves really admitted their distinct PUTs');
  assert.equal('X-Draft' in configWrites(f)[before].body.providers.stepfun.models[0].headers, false);
  assert.equal(configWrites(f)[before + 1].body.providers.stepfun.models[0].headers['X-Draft'], 'draft value');
});

test('actual prices stay visible outside Advanced, manual completion commits sparse zeroes and all-blank removes only cost', async t => {
  const { f, model } = await modelEditor(t, { id: 'aaa', cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0, tiers: [{ threshold: 5 }] } });
  assert.equal(f.view.container.querySelector('#model-advanced-settings') === null, true);
  for (const text of ['$1.25', '$10', '$0.125', '$0']) assert.equal(f.text().includes(text), true);
  await f.click(f.button('Edit prices'));
  const input = field(f, 'Input').querySelector('input');
  await f.input(input, '');
  assert.deepEqual(model().cost, { input: 0, output: 10, cacheRead: 0.125, cacheWrite: 0, tiers: [{ threshold: 5 }] });
  for (const label of ['Output', 'Cache read', 'Cache write']) await f.input(field(f, label).querySelector('input'), '');
  assert.equal('cost' in model(), false);
  assert.equal(model().id, 'aaa');
  await f.input(input, '1.25');
  assert.deepEqual(model().cost, { input: 1.25, output: 0, cacheRead: 0, cacheWrite: 0, tiers: [{ threshold: 5 }] });
});

test('actual thinking editor preserves Default/Disabled/Custom for every level and current model identity', async t => {
  const { f, model } = await modelEditor(t, { id: 'aaa', reasoning: true }, { api: 'openai-completions' });
  await f.click('button[aria-controls="model-advanced-settings"]');
  for (const level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    const input = f.node(`input[placeholder="${level}"]`), row = input.parentElement.parentElement;
    assert.equal(input.maxLength, 10);
    await f.click(f.button('Disabled', row)); assert.equal(model().thinkingLevelMap[level], null);
    await f.click(f.button('Custom', row)); assert.equal(model().thinkingLevelMap[level], level);
    await f.input(input, 'mapped'); assert.equal(model().thinkingLevelMap[level], 'mapped');
    await f.click(f.button('Default', row)); assert.equal(model().thinkingLevelMap?.[level], undefined);
  }
  assert.equal(model().thinkingLevelMap, undefined);
});

test('actual connection-test body delivered after edit cannot attach old success/error to new endpoint', async t => {
  for (const ok of [true, false]) await t.test(String(ok), async t => {
    const { f } = await modelEditor(t, { id: 'aaa' }, { api: 'openai-completions', baseUrl: 'https://old.invalid/v1' });
    const body = f.gate('test old endpoint body');
    f.route('POST', '/api/models-config/test', { body: { providerName: 'stepfun', provider: { api: 'openai-completions', baseUrl: 'https://old.invalid/v1' }, model: { id: 'aaa' } }, reply: { gate: body, data: { ok, responseText: 'obsolete success', error: 'obsolete error' } } });
    await f.click(f.button('Test'), { settle: false });
    await f.click('button[aria-controls="model-advanced-settings"]', { settle: false });
    await f.input(field(f, 'Base URL override').querySelector('input'), 'https://new.invalid/v1', { settle: false });
    await f.deliver(body, 'models.handleTest');
    assert.equal(f.text().includes('obsolete success'), false); assert.equal(f.text().includes('obsolete error'), false);
    assert.equal(f.button('Test').disabled, false, 'old finally does not leave current test pending');
  });
});

test('actual Models save carries provider/model renames, added/removed slots, pre-save fully-enabled intent and post-save reset', async t => {
  const { f } = await modelsPanel(t);
  let expectedConfig, expectedResync, saves = 0;
  f.route('PUT', '/api/models-config', { body: () => expectedConfig, reply: () => { saves++; return { data: { success: true } }; } });
  f.route('PUT', '/api/models/enabled', { body: () => expectedResync, reply: { data: enabledView() } });
  await f.input('input[placeholder="provider-name"]', 'house'); await f.click(f.button('Rename'));
  await f.click(f.button('aaa')); await f.click(f.button('Remove'));
  await f.click(f.button('+ Model')); await f.input('input[placeholder="model-id"]', 'new');
  await f.click(f.button('ddd')); await f.input('input[placeholder="model-id"]', 'ddd1');
  expectedConfig = { providers: { house: { api: 'openai-completions', models: [{ id: 'ddd1' }, { id: 'new' }] } } };
  expectedResync = { op: 'resync', renames: [{ from: 'stepfun', to: 'house' }], modelRenames: [{ from: 'stepfun/ddd', to: 'house/ddd1' }], fullyEnabled: ['stepfun'], cwd: '/project' };
  await f.click(f.button('Save'));
  assert.equal(saves, 1);
  await f.timers(2000);
  expectedResync = { ...expectedResync, renames: [], modelRenames: [] };
  await f.click(f.button('Save'));
  assert.equal(saves, 2, 'saved slots reset after success');
});

test('actual failed save retains rename slots and literal draft; project-shadowed save reloads rather than mutating scope', async t => {
  for (const scope of ['global', 'project']) await t.test(scope, async t => {
    const { f } = await modelsPanel(t, { scope }); let status = 500;
    f.route('PUT', '/api/models-config', { body: { providers: { stepfun: { api: 'openai-completions', models: [{ id: 'aaa' }, { id: 'ddd1' }] } } }, reply: () => ({ status, data: status === 500 ? { error: 'save failed' } : { success: true } }) });
    f.route('PUT', '/api/models/enabled', { body: { op: 'resync', renames: [], modelRenames: [{ from: 'stepfun/ddd', to: 'stepfun/ddd1' }], fullyEnabled: ['stepfun'], cwd: '/project' }, reply: { data: enabledView(scope) } });
    await f.click(f.button('ddd')); await f.input('input[placeholder="model-id"]', 'ddd1'); await f.click(f.button('Save'));
    assert.equal(f.node('[role="alert"]').textContent, 'save failed');
    assert.equal(f.node('input[placeholder="model-id"]').value, 'ddd1');
    assert.equal(f.requests.some(r => r.path === '/api/models/enabled' && r.method === 'PUT'), false, 'failed file save never resyncs');
    status = 200; await f.click(f.button('Save'));
    assert.equal(f.requests.some(r => r.path === '/api/models/enabled' && r.method === 'PUT'), scope === 'global');
  });
});

test('actual model primary divider and sidebar indents are presentation contracts', async t => {
  const { f } = await modelEditor(t, { id: 'aaa' });
  const sections = [...f.view.container.querySelectorAll('section')];
  assert.equal(sections.filter(n => n.style.borderTop === '1px solid var(--border)').length, 1);
  assert.equal(sections.some(n => Boolean(n.style.borderBottom)), false);
  const css = await readFile(new URL('../app/settings.css', import.meta.url), 'utf8');
  assert.match(css, /\.models-sidebar-indented-item \{[\s\S]*?padding-left: 26px/);
});


test('actual managed OAuth/API sections and custom header share scope badges without replacing children', async t => {
  const enabled = enabledView();
  enabled.enabledTotal = 4; enabled.availableTotal = 6;
  enabled.providers.push(...['oauth-fixture', 'key-fixture'].map(id => ({ id, name: id, kind: 'builtin', enabledCount: 1, models: [{ id: 'on', name: `${id} on`, ref: `${id}/on`, enabled: true }, { id: 'off', name: `${id} off`, ref: `${id}/off`, enabled: false }] })));
  const { f } = await modelsPanel(t, { enabled, providers: { oauthProviders: [{ id: 'oauth-fixture', name: 'OAuth fixture', loggedIn: true }], apiKeyProviders: [{ id: 'key-fixture', displayName: 'Key fixture', configured: true, modelCount: 2 }] } });
  for (const name of ['OAuth fixture', 'Key fixture']) {
    const row = [...f.view.container.querySelectorAll('.config-sidebar-item')].find(n => n.textContent.includes(name));
    assert.equal(row.querySelector('.models-sidebar-badge').textContent, '1/2');
    await f.click(row);
    assert.equal(f.node('.enabled-models-title').textContent, 'Available models');
    assert.equal(f.view.container.querySelectorAll('.enabled-models-row').length, 2, 'actual managed section rows');
  }
  const custom = [...f.view.container.querySelectorAll('.config-sidebar-item')].find(n => n.textContent.includes('stepfun'));
  assert.equal(custom.querySelector('.models-sidebar-badge').textContent, '2/2');
  await f.click(custom);
  const actions = f.node('.config-detail-actions');
  assert.equal(actions.querySelectorAll('[role="switch"]').length, 1);
  assert.equal(actions.children[0].getAttribute('role'), 'switch');
  assert.equal(actions.children[1].textContent, 'Delete');
  assert.equal(f.view.container.querySelector('.enabled-models-section') === null, true, 'custom is header-only, not sign-in section');
  assert.equal(f.node('.enabled-models-banner') !== null, true);
});

test('actual remembered model detail selection is restored and subsequent provider selection is persisted', async t => {
  const { f, graph } = await modelsPanel(t, { selection: { type: 'model', providerName: 'stepfun', index: 1 } });
  assert.equal(f.node('input[placeholder="model-id"]').value, 'ddd');
  assert.equal(f.node('.config-sidebar-item[aria-current="page"]').textContent, 'ddd');
  await f.click([...f.view.container.querySelectorAll('.config-sidebar-item')].find(node => node.textContent.includes('stepfun')));
  assert.deepEqual(JSON.parse(graph.getLastSettingsSelection('models')), { type: 'provider', name: 'stepfun' });
  assert.equal(f.node('.models-sidebar-indented-item').classList.contains('config-sidebar-item'), true);
  assert.equal(f.node('.models-sidebar-add-item').classList.contains('config-sidebar-item'), true);
});

test('actual deleting a saved provider and adding a new provider cannot report a model rename', async t => {
  const { f } = await modelsPanel(t);
  f.route('PUT', '/api/models-config', { body: { providers: { 'new-provider': { api: 'openai-completions', models: [{ id: 'fresh' }] } } }, reply: { data: { success: true } } });
  f.route('PUT', '/api/models/enabled', { body: { op: 'resync', renames: [], modelRenames: [], fullyEnabled: ['stepfun'], cwd: '/project' }, reply: { data: enabledView() } });
  await f.click(f.button('Delete'));
  await f.click(f.button('Add provider'));
  const custom = [...f.view.container.querySelectorAll('button')].find(n => n.textContent.includes('OpenAI / Anthropic compatible'));
  await f.click(custom);
  await f.click(f.button('+ Model')); await f.input('input[placeholder="model-id"]', 'fresh');
  await f.click(f.button('Save'));
  assert.equal(f.requests.filter(r => r.method === 'PUT').length, 2);
});


test('actual catalog fill completes prices, closes manual editing and keeps spec prices before Advanced', async t => {
  const { f, model } = await modelEditor(t, { id: 'aaa' }, { baseUrl: 'https://gateway.invalid/v1' });
  const cost = { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 };
  f.route('GET', '/api/models-config/catalog', { query: { q: 'aaa', provider: 'stepfun', limit: '50', baseUrl: 'https://gateway.invalid/v1' }, reply: { data: { recommendation: { exactMatches: 1, metadataMethod: 'provider', matchedProviderId: 'stepfun', preset: { cost }, price: { status: 'reliable', method: 'provider', cost, providerId: 'stepfun', providerName: 'Stepfun', support: 1, total: 1 } } } } });
  await f.click(f.button('Edit prices'));
  assert.equal(field(f, 'Input').querySelector('input') !== null, true);
  await f.click(f.button('Fill model details'));
  assert.deepEqual(model().cost, cost);
  assert.equal(f.button('Edit prices').getAttribute('aria-expanded'), 'false');
  assert.equal(f.view.container.querySelector('#model-advanced-settings') === null, true);
  assert.equal(f.text().includes('$1.25'), true);
  assert.equal(f.text().includes('Model specifications'), true);
  assert.equal(f.text().includes('Cost per million tokens'), true);
  assert.equal(f.text().indexOf('Model specifications') < f.text().indexOf('Cost per million tokens'), true);
  assert.equal(f.text().indexOf('Cost per million tokens') < f.text().indexOf('Advanced settings'), true);
  assert.equal(f.text().indexOf('$1.25') < f.text().indexOf('Advanced settings'), true);
});
