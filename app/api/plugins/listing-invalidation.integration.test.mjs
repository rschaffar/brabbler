// ADR 0046 retires f6b91f64's install/disable/enable/remove success chain.
// Keep the real warmed provider-listing connection: retired routes cannot write
// registration, execute this source, or invalidate the independent listing lane.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { POST } = await jiti.import("./route.ts");
const { GET: providers } = await jiti.import("../auth/providers/route.ts");
const { allowFileRoot } = await jiti.import("../../../lib/file-access.ts");
const { invalidateSettingsListingRuntime } = await jiti.import("../../../lib/settings-listing-runtime.ts");

test("retired local package actions preserve native settings and a warmed provider listing", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-listing-"));
  const agent = join(root, "agent"), cwd = join(root, "project"), source = join(root, "local-package");
  const previous = { dir: process.env.PI_CODING_AGENT_DIR, offline: process.env.PI_OFFLINE, fetch: globalThis.fetch };
  process.env.PI_CODING_AGENT_DIR = agent; process.env.PI_OFFLINE = "1";
  const requests = [];
  globalThis.fetch = async input => { requests.push(String(input)); throw new Error("Local package fixture must not use HTTP"); };
  try {
    await mkdir(agent); await mkdir(cwd); await mkdir(source);
    await writeFile(join(agent, "settings.json"), JSON.stringify({ cacheWarming: "off", enableInstallTelemetry: false }));
    await writeFile(join(source, "package.json"), JSON.stringify({ name: "pi-listing-fixture", version: "1.0.0", pi: { extensions: ["provider.ts"] } }));
    await writeFile(join(source, "provider.ts"), `export default function(pi: any) {
      pi.registerProvider("local-package-listing-fixture", {
        baseUrl: "https://fixture.invalid/v1", apiKey: "SYNTHETIC_UNUSED_KEY", api: "openai-completions",
        models: [{ id: "one", name: "Package model", reasoning: false, input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100 }],
      });
    }`);
    allowFileRoot(cwd);
    const listed = async () => {
      const response = await providers(); assert.equal(response.status, 200);
      return (await response.json()).apiKeyProviders.some(provider => provider.id === "local-package-listing-fixture");
    };
    const mutate = async (action, selectedSource = source) => {
      const response = await POST(new Request("http://localhost/api/plugins", {
        method: "POST", headers: { Host: "localhost", "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, source: selectedSource, action, scope: "global" }),
      }));
      const body = await response.json(); assert.equal(response.status, 410, JSON.stringify(body));
      return body;
    };
    const before = await readFile(join(agent, "settings.json"));
    assert.equal(await listed(), false); // Warm the real retained runtime.
    for (const action of ["install", "disable", "enable", "update", "remove"]) {
      await mutate(action);
      assert.equal((await readFile(join(agent, "settings.json"))).equals(before), true, "registration/settings bytes unchanged");
      assert.equal(await listed(), false, "retirement cannot add a provider to a warmed listing");
    }
    assert.deepEqual(requests, []);
  } finally {
    // Every package/listing operation above is awaited before these are restored.
    invalidateSettingsListingRuntime(agent);
    if (previous.dir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.dir;
    if (previous.offline === undefined) delete process.env.PI_OFFLINE; else process.env.PI_OFFLINE = previous.offline;
    globalThis.fetch = previous.fetch;
    await rm(root, { recursive: true, force: true });
  }
});
