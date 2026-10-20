import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const root = await mkdtemp(join(tmpdir(), "pi-web-settings-listing-")), agentDir = join(root, "agent");
process.env.PI_CODING_AGENT_DIR = agentDir; process.env.PI_OFFLINE = "1";
process.env.HOME = join(root, "home"); await mkdir(process.env.HOME);
const requests = [], originalFetch = globalThis.fetch;
globalThis.fetch = async (input) => { requests.push(String(input)); throw new Error("Unexpected fixture HTTP"); };
await mkdir(join(agentDir, "extensions"), { recursive: true });
await writeFile(join(agentDir, "extensions", "counted.ts"), `export default function(pi: any) {
(globalThis as any).__settingsListingFactories = ((globalThis as any).__settingsListingFactories ?? 0) + 1;
pi.registerProvider("listing-fixture", { baseUrl: "https://example.invalid/v1", apiKey: "LISTING_FIXTURE_KEY", api: "openai-completions",
models: [{ id: "one", name: "One", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }] });
}`);
await mkdir(join(agentDir, ".pi", "extensions"), { recursive: true });
await writeFile(join(agentDir, ".pi", "extensions", "forbidden.ts"), `export default function() { (globalThis as any).__settingsListingProjectRan = true; }`);
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, moduleCache: false });
const { readSettingsListing, invalidateSettingsListingRuntime } = await jiti.import("./settings-listing-runtime.ts");
const { collectProviderListingInputs } = await jiti.import("./provider-listing-runtime.ts");
const { GET: providers } = await jiti.import("../app/api/auth/providers/route.ts");
const { GET: enabled, PUT } = await jiti.import("../app/api/models/enabled/route.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
allowFileRoot(root);
const factories = () => globalThis.__settingsListingFactories ?? 0;
const rows = () => readSettingsListing(collectProviderListingInputs);
after(async () => { invalidateSettingsListingRuntime(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true }); assert.deepEqual(requests, []); });

test("provider and enabled-model HTTP readers share one global-only runtime, including concurrent calls", async () => {
  const before = factories();
  const replies = await Promise.all([providers(), enabled(new Request(`http://localhost/api/models/enabled?cwd=${root}`)), providers()]);
  for (const reply of replies) assert.equal(reply.status, 200);
  assert.equal(factories() - before, 1);
  assert.equal(globalThis.__settingsListingProjectRan, undefined);
  assert.ok((await rows()).some((row) => row.id === "listing-fixture"));
  assert.equal(factories() - before, 1);
});

test("auth/models.json edits and enabled-model writes stay fresh without repeating factories", async () => {
  const before = factories();
  for (const configured of [true, false, true]) {
    await writeFile(join(agentDir, "auth.json"), JSON.stringify(configured ? { openai: { type: "api_key", key: "synthetic-key" } } : {}));
    const observed = await Promise.all([rows(), rows(), rows()]);
    for (const list of observed) assert.equal(list.find((row) => row.id === "openai").status.configured, configured);
  }
  await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "local-fixture": {
    baseUrl: "https://example.invalid/v1", api: "openai-completions", apiKey: "synthetic", models: [{ id: "new-model" }],
  } } }));
  assert.equal((await rows()).find((row) => row.id === "local-fixture").modelCount, 1);
  const request = (body) => new Request("http://localhost/api/models/enabled", { method: "PUT", body: JSON.stringify({ cwd: root, ...body }) });
  const changed = await PUT(request({ op: "models", refs: ["local-fixture/new-model"], enabled: false }));
  assert.equal(changed.status, 200);
  const view = await (await enabled(new Request(`http://localhost/api/models/enabled?cwd=${root}`))).json();
  assert.equal(view.providers.find((item) => item.id === "local-fixture").enabledCount, 0);
  assert.equal(factories(), before);
  // Project settings are request-local even though the provider runtime is shared.
  const project = join(root, "shadowed"); await mkdir(join(project, ".pi"), { recursive: true });
  await writeFile(join(project, ".pi", "settings.json"), JSON.stringify({ enabledModels: ["local-fixture/*"] }));
  const shadowed = await (await enabled(new Request(`http://localhost/api/models/enabled?cwd=${project}`))).json();
  assert.equal(shadowed.scope, "project"); assert.equal(shadowed.editable, false);
});

test("an unchanged extension factory that fails transiently is retried on the next listing", async () => {
  const file = join(agentDir, "extensions", "transient.ts");
  await writeFile(file, `export default function() {
    const attempts = ((globalThis as any).__listingTransientAttempts = ((globalThis as any).__listingTransientAttempts ?? 0) + 1);
    if (attempts === 1) throw new Error("synthetic transient initialization failure");
  }`);
  invalidateSettingsListingRuntime();
  try {
    await rows(); assert.equal(globalThis.__listingTransientAttempts, 1);
    await rows(); assert.equal(globalThis.__listingTransientAttempts, 2, "failed extension build was not retained");
    await rows(); assert.equal(globalThis.__listingTransientAttempts, 2, "healthy retry is retained");
  } finally { await rm(file); invalidateSettingsListingRuntime(); }
});

test("invalidation rebuilds registrations and returns detached models and maps", async () => {
  const before = factories(); invalidateSettingsListingRuntime();
  const snapshot = await readSettingsListing((runtime) => ({ models: runtime.getModels(), names: new Map(runtime.getProviders().map((p) => [p.id, p.name])) }));
  const item = snapshot.models.find((model) => model.provider === "listing-fixture"); item.name = "caller mutation";
  assert.notEqual(await readSettingsListing((runtime) => runtime.getModels().find((model) => model.provider === "listing-fixture").name), item.name);
  assert.equal(snapshot.names.has("listing-fixture"), true);
  assert.equal(factories() - before, 1);
});
