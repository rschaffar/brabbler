import assert from "node:assert/strict";
import test from "node:test";
import * as path from "node:path";
import { loadTsModule } from "../../../lib/sse-stream.fixture.mjs";

function fixture() {
  const calls = [], controls = { fail: false };
  const mutation = async () => { calls.push("effect"); if (controls.fail) throw new Error("partial update"); };
  class PackageManager {
    async installAndPersist() { await mutation(); }
    async removeAndPersist() { await mutation(); }
    async update() { await mutation(); }
    async resolve() { return { extensions: [], skills: [], prompts: [], themes: [] }; }
    listConfiguredPackages() { return []; }
  }
  const settings = { getGlobalSettings: () => ({}), getProjectSettings: () => ({}), setPackages() {}, setProjectPackages() {}, flush: mutation };
  const route = loadTsModule(new URL("./route.ts", import.meta.url), {
    "next/server": { NextResponse: Response }, "fs": {}, "node:path": path,
    "@earendil-works/pi-coding-agent": { getAgentDir: () => "/synthetic-agent", SettingsManager: { create: () => settings }, DefaultPackageManager: PackageManager },
    "@/lib/file-access": { getAllowedFileRoots: async () => [], isExistingFilePathAllowed: () => true },
    "@/lib/request-security": { hasJsonContentType: () => true, isApiRequestAllowed: () => true },
    "@/lib/project-trust": { getProjectTrustStatus: () => ({ trusted: true }) },
    "@/lib/plugin-updates": { isPluginSourceCheckable: () => false },
    "@/lib/settings-listing-runtime": { beginSettingsListingMutation(dir) { assert.equal(dir, "/synthetic-agent"); calls.push("begin"); return (ok) => calls.push(`finish:${ok}`); } },
    "@/lib/models-cache": { invalidateModelsCache() { calls.push("models"); } },
  }).exports;
  return { route, calls, controls };
}
const request = (body) => new Request("http://localhost/api/plugins", { method: "POST", body: JSON.stringify({ cwd: "/synthetic-project", ...body }) });

// ADR 0046 retires action-success/invalidation assertions at f6b91f64:31–53.
// The route must not enter the independent provider-cache mutation lane at all.
test("retired package actions never invalidate or enter native effects", async () => {
  for (const action of ["install", "remove", "update", "disable", "enable"]) {
    const f = fixture();
    const response = await f.route.POST(request({ action, source: "local-fixture" }));
    assert.equal(response.status, 410); assert.match((await response.json()).error, /Pi or Nix/);
    assert.deepEqual(f.calls, []);
  }
});

test("project and bulk updates refuse before even a failing native mutation lane", async () => {
  const f = fixture(); f.controls.fail = true;
  const response = await f.route.POST(request({ action: "update", scope: "project" }));
  assert.equal(response.status, 410); await response.json();
  assert.deepEqual(f.calls, []);
});

test("invalid requests never start a mutation or disable cache retention", async () => {
  for (const body of [{}, { action: "unknown" }, { action: "install" }, { action: "disable" }]) {
    const f = fixture();
    const response = await f.route.POST(request(body));
    assert.equal(response.status, 410); await response.json();
    assert.deepEqual(f.calls, []);
  }
});
