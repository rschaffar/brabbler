import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readPluginSettings, updatePluginSettings, resolvePluginSettings, pluginProjectIdentity } = await jiti.import("./settings.ts");
const manifest = { id: "example", name: "Example", schemaVersion: 1, fields: {
  enabled: { kind: "boolean", default: false, globalOnly: true },
  flag: { kind: "boolean", default: true },
  target: { kind: "text", nullable: true, default: "main" },
  checks: { kind: "checks", default: [{ name: "Tests", command: "npm test" }] },
  permission: { kind: "enum", default: "ask", options: ["deny", "ask", "allow"] },
} };
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-plugin-settings-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "ignore" });
  execFileSync("git", ["-C", repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "Initial"], { stdio: "ignore" });
  return { root, repo, path: join(root, "data", "settings.json") };
}
test("inherits explicit false/null/empty checks, shares worktrees, resets one field and records origins", (t) => {
  const { root, repo, path } = fixture(t);
  const linked = join(root, "linked");
  execFileSync("git", ["-C", repo, "worktree", "add", "-b", "feature", linked], { stdio: "ignore" });
  assert.equal(pluginProjectIdentity(repo), pluginProjectIdentity(linked));
  let result = readPluginSettings(manifest, repo, path);
  assert.equal(result.enabled, false); assert.equal(result.sources.flag, "builtin");
  updatePluginSettings(manifest, "global", repo, { enabled: true, permission: "deny", target: "base" }, [], path);
  result = updatePluginSettings(manifest, "project", linked, { permission: "allow", flag: false, target: null, checks: [] }, [], path);
  assert.equal(result.enabled, true); assert.equal(result.effective.permission, "allow");
  assert.deepEqual(result.effective.checks, []); assert.equal(result.effective.flag, false); assert.equal(result.effective.target, null);
  assert.equal(result.sources.enabled, "global"); assert.equal(result.sources.flag, "project");
  result = updatePluginSettings(manifest, "project", repo, {}, ["permission"], path);
  assert.equal(result.effective.permission, "deny"); assert.equal(result.sources.permission, "global");
  const stored = JSON.parse(readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(stored.global).sort(), ["enabled", "permission", "target"]);
  assert.equal(Object.hasOwn(stored.projects[pluginProjectIdentity(repo)], "permission"), false);
  result = updatePluginSettings(manifest, "global", repo, { enabled: false }, [], path);
  assert.equal(result.enabled, false);
  assert.throws(() => updatePluginSettings(manifest, "project", repo, { enabled: true }, [], path), /Invalid setting/);
});
test("rejects unknown fields, invalid types, versions, duplicate checks and non-repository project writes", (t) => {
  const { root, repo, path } = fixture(t);
  for (const bad of [{ unknown: true }, { flag: null }, { permission: "confirm" }, { checks: [{ name: "x", command: "true" }, { name: "x", command: "true" }] }]) {
    assert.throws(() => updatePluginSettings(manifest, "global", repo, bad, [], path));
  }
  assert.throws(() => updatePluginSettings(manifest, "project", root, { flag: false }, [], path), /Select a Git/);
  assert.throws(() => updatePluginSettings(manifest, "global", repo, { flag: false }, ["flag"], path), /reset/);
  assert.equal(resolvePluginSettings(manifest, { version: 1, global: {}, projects: {} }, null).sources.target, "builtin");
});
