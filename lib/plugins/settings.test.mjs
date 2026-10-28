import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { createIdentityGate } from "./identity-gate.fixture.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readPluginSettings, updatePluginSettings, resolvePluginSettings, pluginProjectIdentity, pluginProjectIdentityAsync } = await jiti.import("./settings.ts");
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
test("an explicitly saved parent-equal value stays pinned when its parent later changes", (t) => {
  const { repo, path } = fixture(t);
  updatePluginSettings(manifest, "global", repo, { permission: "ask" }, [], path);
  const pinned = updatePluginSettings(manifest, "project", repo, { permission: "ask" }, [], path);
  assert.equal(pinned.sources.permission, "project");
  assert.equal(Object.hasOwn(pinned.overrides, "permission"), true);
  const changedParent = updatePluginSettings(manifest, "global", repo, { permission: "allow" }, [], path);
  assert.equal(changedParent.effective.permission, "ask");
  assert.equal(changedParent.sources.permission, "project");
  const followed = updatePluginSettings(manifest, "project", repo, {}, ["permission"], path);
  assert.equal(followed.effective.permission, "allow");
  assert.equal(followed.sources.permission, "global");
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

test("async native identity stays fresh across linked, foreign, rebound, missing and sanitized-environment reads", async (t) => {
  const a = fixture(t), b = fixture(t), linked = join(a.root, "linked");
  const unusual = join(a.root, process.platform === "win32" ? "repo ' λ" : "repo ' λ\nmain");
  renameSync(a.repo, unusual); a.repo = unusual;
  execFileSync("git", ["-C", a.repo, "worktree", "add", "-b", "linked", linked], { stdio: "ignore" });
  const expected = pluginProjectIdentity(a.repo), foreign = pluginProjectIdentity(b.repo);
  assert.notEqual(expected, null); assert.notEqual(expected, foreign);
  assert.equal(await pluginProjectIdentityAsync(a.repo), expected);
  assert.equal(await pluginProjectIdentityAsync(linked), expected);
  const alias = join(a.root, "literal path ' λ");
  for (const [repo, identity] of [[a.repo, expected], [b.repo, foreign], [a.repo, expected]]) {
    symlinkSync(repo, alias, process.platform === "win32" ? "junction" : "dir");
    assert.equal(await pluginProjectIdentityAsync(alias), identity, "each alias binding is observed natively, without reuse");
    rmSync(alias);
  }
  const keys = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];
  const old = keys.map(key => process.env[key]);
  try {
    for (const key of keys) process.env[key] = key === "GIT_WORK_TREE" ? b.repo : join(b.repo, ".git");
    assert.equal(await pluginProjectIdentityAsync(a.repo), expected, "ambient Git overrides cannot select the foreign repository");
  } finally {
    keys.forEach((key, i) => { if (old[i] === undefined) delete process.env[key]; else process.env[key] = old[i]; });
  }
  assert.equal(await pluginProjectIdentityAsync(a.root), null);
  assert.equal(await pluginProjectIdentityAsync(join(a.root, "missing")), null);
  const path = process.env.PATH;
  try {
    process.env.PATH = join(a.root, "no-executable");
    assert.equal(await pluginProjectIdentityAsync(a.repo), null, "spawn failure settles as unavailable identity");
  } finally { if (path === undefined) delete process.env.PATH; else process.env.PATH = path; }
});

test("async identity lets event-loop work release a real Git child and waits beyond stdout for native close", async (t) => {
  for (const failure of [undefined, new Error("identity stdin failure")]) await t.test(failure ? "input error" : "native success", async (st) => {
    const root = mkdtempSync(join(tmpdir(), "pi-identity-child-")), repo = join(root, "repo");
    let work, gate;
    st.after(async () => {
      const errors = [];
      for (const finish of [() => gate?.release(), () => work, () => gate?.join(), () => gate?.restore(), () => rmSync(root, { recursive: true, force: true })]) {
        try { await finish(); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, "Identity child cleanup failed");
    });
    execFileSync("git", ["init", "-qb", "main", repo], { stdio: "ignore" });
    const expected = pluginProjectIdentity(repo);
    assert.notEqual(expected, null);
    gate = createIdentityGate(st, root, { interceptSync: true, inputFailure: failure });
    // Import after adapter installation: Jiti's earlier builtin bindings are not
    // evidence that this particular native invocation entered the gate.
    const fresh = createJiti(import.meta.url, { fsCache: false, moduleCache: false });
    const { pluginProjectIdentityAsync: lookup } = await fresh.import("./settings.ts");
    let settled = false;
    work = Promise.resolve(lookup(repo)).then(value => { settled = true; return value; });
    await gate.ready();
    assert.equal(gate.outcome(), undefined, "event-loop work reaches the held identity child before its deadline");
    assert.equal(settled, false, "native stdout or an input error cannot settle identity before child close");
    gate.release();
    assert.equal(await work, failure ? null : expected);
    assert.equal(gate.outcome(), "released");
    assert.equal(gate.child.exitCode, 0);
    assert.equal(gate.child.stdout.destroyed && gate.child.stderr.destroyed, true, "both native output pipes closed before return");
  });
});
