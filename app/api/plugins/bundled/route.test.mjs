import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";
const dir = mkdtempSync(join(tmpdir(), "pi-plugin-route-"));
const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = dir;
after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(dir, { recursive: true, force: true }); });
const { GET, PATCH } = await createJiti(import.meta.url, { tsconfigPaths: true }).import("./route.ts");
const request = (body, headers = {}) => new Request("http://localhost:30141/api/plugins/bundled", {
  method: "PATCH", headers: { Host: "localhost:30141", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body),
});
test("bundled settings route inherits API origin protection and validates schema without an execution route", async () => {
  const get = await GET(new Request("http://localhost:30141/api/plugins/bundled", { headers: { Host: "localhost:30141" } }));
  assert.equal(get.status, 200);
  const snapshot = await get.json();
  assert.equal(snapshot.plugins[0].settings.enabled, false);
  const change = { pluginId: "git-workflow", scope: "global", set: { commit: "deny" } };
  assert.equal((await PATCH(request(change, { Origin: "https://evil.invalid", "Sec-Fetch-Site": "cross-site" }))).status, 403);
  const response = await PATCH(request(change)); assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.sources.commit, "global");
  for (const invalid of [{ ...change, set: { commit: "confirm" } }, { ...change, pluginId: "unregistered" }, { ...change, scope: "chat" }, { ...change, cwd: "/outside-allowed-roots" }]) assert.equal((await PATCH(request(invalid))).status, 400);
  const reset = await PATCH(request({ pluginId: "git-workflow", scope: "global", reset: ["commit"] }));
  assert.equal((await reset.json()).settings.sources.commit, "builtin");
});
