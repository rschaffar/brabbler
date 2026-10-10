import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() } });
const { GET } = await jiti.import("./route.ts");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { updatePluginSettings } = await jiti.import("../../../../lib/plugins/settings.ts");
const { gitWorkflowManifest } = await jiti.import("../../../../plugins/git-workflow/manifest.ts");
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "commit.gpgSign=false", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const request = (params, headers = { host: "localhost" }) => GET(new Request(`http://localhost/api/worktrees/manage?${new URLSearchParams(params)}`, { headers }));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-manager-route-test-")); const old = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = join(root, "agent");
  t.after(() => { if (old === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = old; rmSync(root, { recursive: true, force: true }); });
  const cwd = join(root, "repo"); git(root, "init", "-qb", "main", cwd); git(cwd, "config", "user.name", "Test"); git(cwd, "config", "user.email", "test@example.invalid");
  writeFileSync(join(cwd, "source"), "source"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "Base"); git(cwd, "branch", "feature"); allowFileRoot(cwd);
  return { root, cwd };
}
test("inventory route is read-only, works disabled/no target, and rejects origins, aliases, expressions and stale detail reads", async (t) => {
  const { root, cwd } = fixture(t); const before = readFileSync(join(cwd, ".git/config"));
  assert.equal((await request({ cwd: root })).status, 403);
  assert.equal((await request({ cwd }, { host: "localhost", origin: "https://hostile.invalid" })).status, 403);
  assert.equal((await request({ cwd, target: "main~1" })).status, 400);
  assert.equal((await request({ cwd, extra: "unknown" })).status, 400);
  assert.equal((await request({ cwd: join(cwd, ".git") })).status, 400);
  const alias = join(root, "alias"); symlinkSync(cwd, alias); allowFileRoot(alias); assert.equal((await request({ cwd: alias })).status, 400);
  const response = await request({ cwd }); assert.equal(response.status, 200); const inventory = await response.json();
  assert.equal(inventory.cleanup.enabled, false); assert.equal(inventory.target.tip, null); assert.equal(inventory.rows.length, 2);
  const comparison = await (await request({ cwd, target: "main" })).json(); assert.equal(comparison.rows.find((r) => r.branch === "feature").integration, "integrated");
  assert.equal((await request({ cwd, captureId: comparison.captureId, details: "1", rows: JSON.stringify(["branch:feature"]) })).status, 200);
  assert.equal((await request({ cwd, captureId: comparison.captureId, details: "1", rows: JSON.stringify(["branch:made-up"]) })).status, 400);
  git(cwd, "branch", "later");
  assert.equal((await request({ cwd, captureId: comparison.captureId, details: "1", rows: JSON.stringify(["branch:feature"]) })).status, 409);
  assert.deepEqual(readFileSync(join(cwd, ".git/config")), before);
});
test("inventory defaults use project/global settings only, never session overrides; missing targets still list branches", async (t) => {
  const { cwd } = fixture(t);
  updatePluginSettings(gitWorkflowManifest, "global", cwd, { targetBranch: "main" }, []);
  updatePluginSettings(gitWorkflowManifest, "session", cwd, { targetBranch: "feature" }, [], undefined, { id: "idle-session", cwd });
  let inventory = await (await request({ cwd })).json(); assert.equal(inventory.target.branch, "main"); assert.equal(inventory.target.source, "global");
  updatePluginSettings(gitWorkflowManifest, "project", cwd, { targetBranch: "feature" }, []);
  inventory = await (await request({ cwd, target: "main" })).json(); assert.equal(inventory.target.branch, "main"); assert.equal(inventory.target.configured, "feature"); assert.equal(inventory.target.temporary, true);
  updatePluginSettings(gitWorkflowManifest, "project", cwd, { targetBranch: "missing" }, []);
  inventory = await (await request({ cwd })).json(); assert.equal(inventory.target.branch, null); assert.equal(inventory.target.missingConfigured, true); assert.equal(inventory.rows.length, 2);
});
