import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertStartupSessionCatalogue, browserFixtureRecipe, prepareBrowserPrelude } from "../e2e/browser-fixture-recipes.mjs";
import { seedModelSpeedDefaults, seedModelSpeedTranscripts } from "../e2e/model-speed.mjs";
import { createDiagnosticStages } from "../e2e/diagnostic-stage.mjs";
import { holdBrowserRead, observeBrowserReads } from "../e2e/browser-read-barrier.mjs";
import { scenarios } from "../e2e/scenarios.mjs";

const shared = ["e2e-model-speed-standard", "e2e-model-speed-fast", "e2e-model-speed-legacy"];
const forks = ["e2e-running-fork-1280", "e2e-running-fork-390"];
const manager = ["e2e-worktree-manager-desktop", "e2e-worktree-manager-mobile"];
const names = ["model-speed-defaults", "model-speed-transcripts", "running-fork-transcripts", "worktree-manager-repositories"];

test("only audited timestamps/appearance/Activity/Markdown omit fork/manager preparation; expected IDs are independent of seed output", async () => {
  for (const group of Object.keys(scenarios)) {
    const reduced = group === "timestamps" || group === "appearance"
      || group === "activity" || group === "markdown";
    const recipe = browserFixtureRecipe(group);
    assert.deepEqual(recipe.map(step => step.name), reduced ? names.slice(0, 2) : names);
    assert.deepEqual(recipe.map(step => step.expectedIds), reduced
      ? [[], shared] : [[], shared, forks, manager]);
    const calls = [], stages = [];
    const options = { sentinel: true };
    const result = await prepareBrowserPrelude(group, options, async (name, work) => { stages.push(name); return work(); },
      names.map((name, index) => input => { assert.equal(input, options); calls.push(name); return [`WRONG-ID-${index}`]; }));
    assert.deepEqual(calls, recipe.map(step => step.name));
    assert.deepEqual(stages, calls.map(name => `prepare/${name}`));
    assert.deepEqual(result.expectedIds, reduced ? shared : [...shared, ...forks, ...manager]);
    assert.deepEqual(result.managerFixtures, reduced ? undefined : ["WRONG-ID-3"]);
    const mutated = browserFixtureRecipe(group);
    mutated[0].expectedIds.push("WRONG-DEFAULT-ID");
    mutated[1].expectedIds.pop();
    assert.deepEqual(browserFixtureRecipe(group), recipe, "Recipe callers cannot mutate expected IDs");
  }
});

// Independent complete appearance catalogue, not collected from a writer/seed.
const appearanceIds = [
  "e2e-long-session", "e2e-branch-session", "e2e-rich-session", "e2e-compacted-session",
  "e2e-external-append-session", "e2e-archive-session", "e2e-other-project", "e2e-git-explorer",
  "e2e-file-line-links", "e2e-bulk-desktop-a", "e2e-bulk-desktop-b",
  "e2e-bulk-mobile-a", "e2e-bulk-mobile-b",
  "e2e-model-speed-standard", "e2e-model-speed-fast", "e2e-model-speed-legacy",
];

test("appearance keeps the actual startup catalogue equality strict at exactly 16 independently declared IDs", async () => {
  const result = await prepareBrowserPrelude("appearance", {}, async (_name, work) => work(),
    names.map(() => () => ["WRONG-SEED-ID"]));
  assert.deepEqual(result.expectedIds, shared);
  assert.equal(appearanceIds.length, 16);
  assert.equal(new Set(appearanceIds).size, 16);

  // Exercise the real helper used by startup, with an independent inventory.
  // Installed appearance remains the proof of runner/fixture/native wiring.
  const expectedIds = Object.freeze([...appearanceIds]);
  const assertCatalogue = ids => assertStartupSessionCatalogue(
    Object.freeze(ids.map(id => Object.freeze({ id }))), expectedIds);
  assertCatalogue(appearanceIds);
  assertCatalogue([...appearanceIds].reverse());
  for (const rejected of [
    appearanceIds.slice(1),
    [...appearanceIds, "unexpected-session"],
    [...appearanceIds.slice(1), appearanceIds[1]],
    [...appearanceIds.slice(1), "wrong-session"],
    ...[...forks, ...manager].map(id => [...appearanceIds, id]),
    [...appearanceIds, ...forks], [...appearanceIds, ...manager],
    [...appearanceIds, ...forks, ...manager],
  ]) assert.throws(() => assertCatalogue(rejected), { code: "ERR_ASSERTION" });
});

test("appearance preparation writes real defaults and exactly three transcripts, never fork/manager resources", async t => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-appearance-recipe-"));
  const previous = Object.fromEntries(["HOME", "PI_CODING_AGENT_DIR", "PI_OFFLINE"].map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(agentDir, { recursive: true, force: true });
  });
  const home = join(agentDir, "home"), project = join(agentDir, "project");
  const sessionDir = join(agentDir, "sessions", "e2e"), timestamp = "2026-08-23T00:00:00.000Z";
  mkdirSync(home); mkdirSync(project); mkdirSync(sessionDir, { recursive: true });
  Object.assign(process.env, { HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" });
  const stages = [], written = [];
  const message = (id, parentId, role, content) => ({ type: "message", id, parentId, timestamp,
    message: { role, content } });
  const filename = id => `2026-08-23T00-00-00-000Z_${id}.jsonl`;
  const writeSession = (id, entries, cwd = project) => {
    for (const name of ["settings.json", "models.json", "auth.json"]) {
      assert.ok(readFileSync(join(agentDir, name), "utf8").length > 0, "Defaults precede every transcript");
      assert.equal(statSync(join(agentDir, name)).mode & 0o777, 0o600);
    }
    written.push(id);
    writeFileSync(join(sessionDir, filename(id)), [
      { type: "session", version: 3, id, timestamp, cwd }, ...entries,
    ].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  };
  const forbidden = () => assert.fail("Appearance must never invoke fork/manager resource seeds");
  const result = await prepareBrowserPrelude("appearance", { agentDir, writeSession, message, timestamp },
    async (name, work) => { stages.push(name); return work(); },
    [seedModelSpeedDefaults, seedModelSpeedTranscripts, forbidden, forbidden]);
  assert.deepEqual(stages, ["prepare/model-speed-defaults", "prepare/model-speed-transcripts"]);
  assert.deepEqual(written, shared);
  assert.deepEqual(result.expectedIds, shared);
  assert.equal(result.managerFixtures, undefined);
  assert.deepEqual(readdirSync(sessionDir).sort(), shared.map(filename).sort());
  assert.deepEqual(readdirSync(agentDir).sort(), ["auth.json", "home", "models.json", "project", "sessions", "settings.json"],
    "No running-fork directory, manager repositories or manager worktrees are created");
  assert.deepEqual(readdirSync(home), []);
  assert.deepEqual(readdirSync(project), []);
  for (const id of shared) {
    const [header, ...entries] = readFileSync(join(sessionDir, filename(id)), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(header, { type: "session", version: 3, id, timestamp, cwd: project });
    assert.equal(entries[0].type, "model_change");
    assert.equal(entries[1].type, "thinking_level_change");
    assert.equal(entries.filter(entry => entry.type === "message").length, 2);
    assert.equal(entries.filter(entry => entry.type === "custom").length, id === "e2e-model-speed-legacy" ? 0 : 1);
  }
});

// Independent literal inventories from activity-recipe-audit.json and
// markdown-recipe-audit.json. These do not simulate native lifecycle state or
// collect expectations from writes/seed returns. Installed whole chains own wiring.
const activityIds = [
  "e2e-long-session", "e2e-branch-session", "e2e-rich-session", "e2e-compacted-session",
  "e2e-external-append-session", "e2e-archive-session", "e2e-other-project", "e2e-git-explorer",
  "e2e-file-line-links", "e2e-bulk-desktop-a", "e2e-bulk-desktop-b",
  "e2e-bulk-mobile-a", "e2e-bulk-mobile-b",
  "e2e-model-speed-standard", "e2e-model-speed-fast", "e2e-model-speed-legacy",
  "e2e-ready-child-a", "e2e-ready-child-b", "e2e-working-child", "e2e-other-child",
];
const markdownIds = [
  "e2e-archive-session", "e2e-branch-session", "e2e-bulk-desktop-a", "e2e-bulk-desktop-b",
  "e2e-bulk-mobile-a", "e2e-bulk-mobile-b", "e2e-compacted-session", "e2e-external-append-session",
  "e2e-file-line-links", "e2e-file-workspace-peer", "e2e-git-explorer",
  "e2e-highlight-fences", "e2e-highlight-source", "e2e-long-session",
  "e2e-model-speed-fast", "e2e-model-speed-legacy", "e2e-model-speed-standard",
  "e2e-other-project", "e2e-review-notebook", "e2e-rich-session",
  "e5e00000-0000-4000-8000-000000000001", "e5e00000-0000-4000-8000-000000000002",
  "e5e00000-0000-4000-8000-000000000003", "e5e00000-0000-4000-8000-000000000004",
  "e5e00000-0000-4000-8000-000000000005",
  "e5e10000-0000-4000-8000-000000000001", "e5e10000-0000-4000-8000-000000000002",
];

test("Activity uses real startup equality with exactly 20 independent audited IDs", () => {
  assert.equal(activityIds.length, 20);
  assert.equal(new Set(activityIds).size, 20);
  const expectedIds = Object.freeze([...activityIds]);
  const assertCatalogue = ids => assertStartupSessionCatalogue(
    Object.freeze(ids.map(id => Object.freeze({ id }))), expectedIds);
  assertCatalogue(activityIds);
  assertCatalogue([...activityIds].reverse());
  for (const rejected of [
    activityIds.slice(1),
    [...activityIds, "unexpected-session"],
    [...activityIds.slice(1), activityIds[1]],
    [...activityIds.slice(1), "wrong-session"],
    ...[...forks, ...manager].map(id => [...activityIds, id]),
    [...activityIds, ...forks], [...activityIds, ...manager],
    [...activityIds, ...forks, ...manager],
  ]) assert.throws(() => assertCatalogue(rejected), { code: "ERR_ASSERTION" });
});

test("Markdown uses real startup equality with exactly 27 independent audited IDs", () => {
  assert.equal(markdownIds.length, 27);
  assert.equal(new Set(markdownIds).size, 27);
  const expectedIds = Object.freeze([...markdownIds]);
  const assertCatalogue = ids => assertStartupSessionCatalogue(
    Object.freeze(ids.map(id => Object.freeze({ id }))), expectedIds);
  assertCatalogue(markdownIds);
  assertCatalogue([...markdownIds].reverse());
  for (const rejected of [
    markdownIds.slice(1),
    [...markdownIds, "unexpected-session"],
    [...markdownIds.slice(1), markdownIds[1]],
    [...markdownIds.slice(1), "wrong-session"],
    ...[...forks, ...manager].map(id => [...markdownIds, id]),
    [...markdownIds, ...forks], [...markdownIds, ...manager],
    [...markdownIds, ...forks, ...manager],
  ]) assert.throws(() => assertCatalogue(rejected), { code: "ERR_ASSERTION" });
});

test("real model-speed fragments keep synthetic defaults separate from exact transcript files", t => {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-speed-fragments-"));
  const previous = Object.fromEntries(["HOME", "PI_CODING_AGENT_DIR", "PI_OFFLINE"].map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    rmSync(agentDir, { recursive: true, force: true });
  });
  const home = join(agentDir, "home");
  mkdirSync(home, { mode: 0o700 });
  Object.assign(process.env, { HOME: home, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" });
  const now = 1_800_000_000_000;
  let clockReads = 0;
  t.mock.method(Date, "now", () => { clockReads += 1; return now; });
  const forbidden = () => assert.fail("Defaults must not construct or write a transcript");
  seedModelSpeedDefaults({ agentDir, writeSession: forbidden, message: forbidden });
  assert.equal(clockReads, 1, "Only OAuth expiry uses the wall clock");
  assert.deepEqual(readdirSync(agentDir).sort(), ["auth.json", "home", "models.json", "settings.json"]);
  assert.deepEqual(readdirSync(home), []);
  const files = ["settings.json", "models.json", "auth.json"];
  const before = files.map(name => readFileSync(join(agentDir, name), "utf8"));
  const expectedModel = (id, name, api) => ({ id, name, api, reasoning: true, input: ["text"],
    contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } });
  const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "e2e-synthetic-account" } })).toString("base64url");
  const expectedDefaults = [
    { defaultProvider: "openai-codex", defaultModel: "e2e-codex-speed", defaultThinkingLevel: "low",
      enabledModels: ["openai-codex/e2e-codex-speed", "openai/e2e-api-speed"],
      cacheWarming: "off", retry: { enabled: false }, enableInstallTelemetry: false },
    { providers: {
      "openai-codex": { baseUrl: "http://127.0.0.1:9", models: [expectedModel("e2e-codex-speed", "E2E ChatGPT subscription", "openai-codex-responses")] },
      openai: { baseUrl: "http://127.0.0.1:9", models: [expectedModel("e2e-api-speed", "E2E OpenAI API (no speed)", "openai-responses")] },
    } },
    { "openai-codex": { type: "oauth", access: `e2e.${payload}.synthetic`, refresh: "e2e-not-refreshable",
      expires: now + 86_400_000, accountId: "e2e-synthetic-account" },
      openai: { type: "api_key", key: "e2e-api-key-not-real" } },
  ];
  assert.deepEqual(before, expectedDefaults.map(value => `${JSON.stringify(value, null, 2)}\n`));
  for (const name of files) assert.equal(statSync(join(agentDir, name)).mode & 0o777, 0o600);

  // Same header/writer/message context as browser-suite, but no SDK or server.
  const timestamp = "2026-08-23T00:00:00.000Z";
  const project = join(agentDir, "project"), sessionDir = join(agentDir, "sessions", "e2e");
  mkdirSync(project);
  mkdirSync(sessionDir, { recursive: true });
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const calls = [];
  const message = (id, parentId, role, content) => {
    calls.push(role);
    return { type: "message", id, parentId, timestamp,
      message: { role, content, ...(role === "assistant" ? { usage } : {}) } };
  };
  const filename = id => `2026-08-23T00-00-00-000Z_${id}.jsonl`;
  const header = id => ({ type: "session", version: 3, id, timestamp, cwd: project });
  const writeSession = (id, entries) => {
    calls.push(id);
    assert.deepEqual(files.map(name => readFileSync(join(agentDir, name), "utf8")), before,
      "All defaults exist unchanged before each transcript write");
    writeFileSync(join(sessionDir, filename(id)), [header(id), ...entries].map(entry => JSON.stringify(entry)).join("\n") + "\n");
  };
  seedModelSpeedTranscripts({ writeSession, message, timestamp });
  assert.equal(clockReads, 1, "Transcripts use the supplied timestamp, never the wall clock");
  assert.deepEqual(calls, shared.flatMap(id => ["assistant", "user", id]));
  assert.deepEqual(readdirSync(sessionDir).sort(), shared.map(filename).sort());
  assert.deepEqual(readdirSync(agentDir).sort(), ["auth.json", "home", "models.json", "project", "sessions", "settings.json"]);
  const entryIds = [
    ["10000001", "10000002", "10000003", "10000004", "10000005"],
    ["20000001", "20000002", "20000003", "20000004", "20000005"],
    ["30000001", "30000002", "30000003", "30000004", "30000005"],
  ];
  for (const [index, id] of shared.entries()) {
    const [model, thinking, user, answer, speed] = entryIds[index];
    const expected = [header(id),
      { type: "model_change", id: model, parentId: null, timestamp, provider: "openai-codex", modelId: "e2e-codex-speed" },
      { type: "thinking_level_change", id: thinking, parentId: model, timestamp, thinkingLevel: "low" },
      { type: "message", id: user, parentId: thinking, timestamp,
        message: { role: "user", content: `E2E speed conversation ${index + 1}` } },
      { type: "message", id: answer, parentId: user, timestamp,
        message: { role: "assistant", content: [{ type: "text", text: `E2E speed answer ${index + 1}` }], usage,
          timestamp: 1_787_443_200_000, provider: "openai-codex", api: "openai-codex-responses", model: "e2e-codex-speed", stopReason: "stop" } },
    ];
    if (index < 2) expected.push({ type: "custom", id: speed, parentId: answer, timestamp,
      customType: "pi-web:model-speed", data: { version: 1, modelSpeed: index === 0 ? "standard" : "fast" } });
    assert.equal(readFileSync(join(sessionDir, filename(id)), "utf8"), expected.map(entry => JSON.stringify(entry)).join("\n") + "\n");
  }
  assert.deepEqual(files.map(name => readFileSync(join(agentDir, name), "utf8")), before);
});

test("diagnostic stages preserve return/error identity and never record a failed stage as success", async () => {
  const lines = [];
  const stage = createDiagnosticStages("history", line => lines.push(JSON.parse(line.slice("E2E_STAGE ".length))));
  const value = {};
  assert.equal(await stage("one", () => value), value);
  const error = new Error("original failure");
  await assert.rejects(stage("two", () => { throw error; }), thrown => thrown === error);
  const finish = stage.start("abandoned");
  stage.finishOpen();
  finish();
  assert.deepEqual(lines.filter(line => line.phase === "end").map(line => [line.name, line.succeeded]),
    [["one", true], ["two", false], ["abandoned", false]]);
  assert.ok(lines.filter(line => line.phase === "end").every(line => Number.isFinite(line.elapsedMs) && line.elapsedMs >= 0));
});

// A private JS realm exercises the actual injected observer without Chromium,
// network, timers in the app, or application/package imports.
function browserFixture(fetch) {
  const events = new EventTarget();
  const document = new EventTarget();
  document.visibilityState = "visible";
  const sandbox = { URL, Request, AbortController, document, location: { href: "http://127.0.0.1/" },
    fetch, requestAnimationFrame: callback => queueMicrotask(callback),
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events) };
  sandbox.window = sandbox;
  const realm = vm.createContext(sandbox);
  return {
    sandbox,
    async evaluate(fn, arg) { return vm.runInContext(`(${fn.toString()})(argument)`, Object.assign(realm, { argument: arg })); },
    async route(matcher, handler) { this.matcher = matcher; this.handler = handler; },
    async unroute(matcher, handler) { assert.equal(matcher, this.matcher); assert.equal(handler, this.handler); this.unregistered = true; },
  };
}
const spec = { pathname: "/api/worktrees", query: { cwd: "/old" } };
const address = "http://127.0.0.1/api/worktrees?cwd=%2Fold";
const response = (body = { worktrees: [] }, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });

test("held route cannot pass on arrival/continue alone: waits for actual body consumption and joins callbacks", async () => {
  let deliver, finishBody;
  const bodyPending = new Promise(resolve => { finishBody = resolve; });
  const originalFetch = () => new Promise(resolve => { deliver = resolve; });
  const page = browserFixture(originalFetch);
  const barrier = await holdBrowserRead(page, spec);
  const app = page.evaluate(async url => (await fetch(url)).json(), address);
  let continued = false, body, observation;
  const route = { continue: async () => { continued = true; deliver({ ...response(), json: () => bodyPending }); }, request: () => ({ failure: () => null }) };
  const callback = page.handler(route);
  await barrier.arrived();
  assert.equal(continued, false, "Arrival never releases stale work");
  try {
    observation = barrier.releaseAndObserve();
    void observation.catch(() => {});
    await callback;
    const outcome = await page.evaluate(() => Object.entries(window).find(([key]) => key.startsWith("__e2eReadBarrier_"))[1].reads[0].outcome);
    assert.equal(outcome, "pending", "Route continuation/headers cannot stand in for body consumption");
    finishBody({ worktrees: [] });
    const reads = await observation;
    body = await app;
    assert.equal(reads[0].outcome, "consumed");
    assert.equal(reads[0].observed, true);
    await callback;
  } finally {
    finishBody({ worktrees: [] });
    try { await observation; }
    finally { await barrier.dispose(); }
  }
  assert.equal(continued, true);
  assert.deepEqual(JSON.parse(JSON.stringify(body)), { worktrees: [] });
  assert.equal(page.unregistered, true);
  assert.equal(page.sandbox.fetch, originalFetch, "Original fetch restored");
});

for (const failureCode of ["net::ERR_ABORTED", "net::ERR_FAILED"]) test(`observed cancellation with ${failureCode} retains exact route error ownership`, async () => {
  const controller = new AbortController();
  let rejectFetch;
  const originalFetch = () => new Promise((_, reject) => { rejectFetch = reject; });
  const page = browserFixture(originalFetch);
  const barrier = await holdBrowserRead(page, spec);
  const app = page.evaluate(async ({ url, signal }) => (await fetch(url, { signal })).json(), { url: address, signal: controller.signal });
  void app.catch(() => {});
  const routeError = new Error("unrelated route failure");
  const callback = page.handler({
    continue: async () => {
      controller.abort();
      rejectFetch(new DOMException("Aborted", "AbortError"));
      throw routeError;
    },
    request: () => ({ failure: () => ({ errorText: failureCode }) }),
  });
  void callback.catch(() => {});
  await barrier.arrived();
  if (failureCode === "net::ERR_ABORTED") {
    const reads = await barrier.releaseAndObserve();
    assert.equal(reads[0].outcome, "cancelled");
    await callback;
    await barrier.dispose();
  } else {
    const ownedFailure = error => error instanceof AggregateError && error.errors.includes(routeError);
    await assert.rejects(barrier.releaseAndObserve(), ownedFailure);
    await assert.rejects(callback, error => error === routeError);
    await assert.rejects(barrier.dispose(), ownedFailure);
  }
  await assert.rejects(app, { name: "AbortError" });
  assert.equal(page.sandbox.fetch, originalFetch);
});

test("natural polling requires both actual consumed reads; visibility/event triggers and HTTP failures fail", async () => {
  const page = browserFixture(async () => response());
  const original = page.sandbox.fetch;
  const polls = await observeBrowserReads(page, [{ pathname: "/api/hidden-projects" }, { pathname: "/api/agent/running" }], { natural: true });
  try {
    await page.evaluate(async () => { await (await fetch("/api/hidden-projects")).json(); });
    const evaluate = page.evaluate.bind(page);
    let sampled = false;
    page.evaluate = async (fn, arg) => {
      const value = await evaluate(fn, arg);
      if (arg?.count === 2 && !sampled) {
        sampled = true;
        assert.equal(value, false, "One consumed endpoint cannot satisfy both natural poll obligations");
        await evaluate(async () => { await (await fetch("/api/agent/running")).json(); });
      }
      return value;
    };
    const reads = await polls.wait();
    assert.equal(sampled, true);
    assert.deepEqual(Array.from(reads, read => read.index), [0, 1]);
    page.sandbox.dispatchEvent(new Event("pi-web:activity-refresh"));
    await assert.rejects(polls.wait(), /Natural polling interrupted/);
  } finally { await polls.dispose(); }
  assert.equal(page.sandbox.fetch, original);
  const failing = browserFixture(async () => response({}, false));
  const failureProbe = await observeBrowserReads(failing, [spec]);
  try {
    await failing.evaluate(async url => (await fetch(url)).json(), address);
    await assert.rejects(failureProbe.wait(), /HTTP 503/);
  } finally { await failureProbe.dispose(); }
});

test("scoped integration retains catalogue helper wiring, natural polls and canonical reload checks", () => {
  const source = file => readFileSync(new URL(`../e2e/${file}`, import.meta.url), "utf8");
  const suite = source("browser-suite.mjs");
  assert.match(suite, /assertStartupSessionCatalogue\(sessions, \[/);
  assert.match(suite, /\.\.\.preludeIds/);
  assert.match(source("file-panel.mjs"), /await naturalPolls\.wait\(\)/);
  assert.doesNotMatch(source("file-panel.mjs"), /waitForTimeout\(16_000\)/);
  const forks = source("running-session-forks.mjs");
  assert.ok(forks.indexOf("Reload preserves canonical entry identity and order") < forks.indexOf("A genuine SDK extension command"));
  assert.match(forks, /origin = reloadedOrigin/);
  for (const file of ["git-explorer.mjs", "session-move.mjs"]) {
    assert.match(source(file), /releaseAndObserve\(\)/);
    assert.doesNotMatch(source(file), /waitForTimeout\((150|700|750)\)/);
  }
});
