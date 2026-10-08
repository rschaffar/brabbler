import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readPluginSettings, updatePluginSettings } = await jiti.import("./settings.ts");
const manifest = { id: "example", name: "Example", schemaVersion: 1, fields: {
  enabled: { kind: "boolean", default: false, globalOnly: true },
  permission: { kind: "enum", default: "ask", options: ["deny", "ask", "allow"] },
  target: { kind: "text", nullable: true, default: null },
  checks: { kind: "checks", default: [] },
} };
const id = "11111111-1111-4111-8111-111111111111";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "pi-plugin-session-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
  const repo = join(root, "own"), other = join(root, "other"), linked = join(root, "linked");
  for (const path of [repo, other]) {
    git(root, "init", "-b", "main", path);
    git(path, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-m", "Initial");
  }
  git(repo, "worktree", "add", "-b", "feature", linked);
  const path = join(root, "settings.json"), session = { id, cwd: repo };
  const read = (cwd = repo, owner = session) => readPluginSettings(manifest, cwd, path, owner);
  const set = (scope, values, cwd = repo, owner = session, reset = []) => updatePluginSettings(manifest, scope, cwd, values, reset, path, owner);
  return { root, repo, other, linked, path, session, read, set };
}
test("session overrides apply only to own repository, including its linked worktrees", (t) => {
  const { set, read, other, linked } = fixture(t);
  set("global", { enabled: true, permission: "deny", target: "global", checks: [{ name: "Global", command: "global-check" }] });
  set("project", { permission: "ask", target: "foreign", checks: [{ name: "Foreign", command: "foreign-check" }] }, other);
  set("session", { permission: "allow", target: "own", checks: [] });
  assert.equal(read(linked).sources.permission, "session");
  assert.equal(read(linked).effective.permission, "allow");
  assert.deepEqual(read(linked).effective.checks, []);
  const foreign = read(other);
  assert.equal(foreign.effective.permission, "ask");
  assert.equal(foreign.effective.target, "foreign");
  assert.deepEqual(foreign.effective.checks, [{ name: "Foreign", command: "foreign-check" }]);
  assert.deepEqual(foreign.sessionOverrides, {});
  set("project", { permission: "deny" }, other);
  assert.equal(read(other).effective.permission, "deny");
});
test("session identity survives reload, but forks, non-Git cwd and moves do not inherit permissions", (t) => {
  const { set, read, repo, other, root, session } = fixture(t);
  set("session", { permission: "allow" });
  assert.equal(read().effective.permission, "allow");
  assert.equal(read(repo, { ...session, id: "22222222-2222-4222-8222-222222222222" }).effective.permission, "ask");
  assert.equal(read(repo, { ...session, cwd: root }).effective.permission, "ask");
  assert.equal(read(repo, { ...session, cwd: other }).effective.permission, "ask");
  assert.equal(read(other, { ...session, cwd: other }).effective.permission, "ask");
  assert.throws(() => set("session", { permission: "allow" }, other), /own project/);
});
test("reset reveals inherited values; global disable and global-only fields cannot be overridden", (t) => {
  const { set, read, repo, session, path } = fixture(t);
  set("project", { permission: "deny" });
  set("session", { permission: "allow", target: null, checks: [] });
  assert.equal(read().enabled, false);
  assert.equal(read().sources.target, "session");
  set("session", {}, repo, session, ["permission"]);
  assert.equal(read().effective.permission, "deny");
  assert.equal(read().sources.permission, "project");
  assert.throws(() => set("session", { enabled: true }), /Invalid setting/);
  assert.throws(() => set("session", {}, repo, session, ["enabled"]), /Invalid reset/);
  const stored = JSON.parse(readFileSync(path, "utf8"));
  stored.sessions[session.id].values.permission = "invalid";
  writeFileSync(path, JSON.stringify(stored));
  assert.throws(() => read(), /Invalid value/);
});
test("legacy global/project documents remain readable and unrelated saves preserve session overrides", (t) => {
  const { path, set, read } = fixture(t);
  writeFileSync(path, JSON.stringify({ version: 1, global: { enabled: true }, projects: {} }));
  assert.equal(read().enabled, true);
  set("session", { permission: "allow" });
  set("global", { target: "main" });
  assert.equal(read().effective.permission, "allow");
  assert.equal(read().effective.target, "main");
});
