import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readProjectNativeResources: read, saveProjectNativeResources: save, projectNativeResourceSelection: selection,
  readGlobalNativeResources: readGlobal, saveGlobalNativeResources: saveGlobal, ordinaryNativeResourceSelection: ordinary } = await jiti.import("./project-native-resources.ts");
const { getProjectTrustStatus, setProjectTrust } = await jiti.import("./project-trust.ts");
const { acceptanceProject } = await jiti.import("./acceptance/config.ts");
const { nativeDefaultChoice } = await jiti.import("./native-resource-defaults.ts");
const off = { version: 1, codeMode: false, mcpServers: [] };
const paperless = { ...off, mcpServers: [{ scope: "global", name: "paperless" }] };
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "project-native-resources-")), cwd = join(root, "project"), agent = join(root, "agent");
  await mkdir(cwd); await mkdir(agent);
  git(cwd, "init", "-qb", "main");
  git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "base");
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agent, file: join(agent, "brabbler/project-native-resources.json") };
}

test("reading is inert, saving shares with registered future worktrees and never grants trust", async t => {
  const { root, cwd, agent, file } = await fixture(t);
  await mkdir(join(cwd, ".pi")); await writeFile(join(cwd, ".pi/mcp.json"), '{"mcpServers":{}}');
  const first = read(cwd, agent);
  assert.equal(first.supported, true); assert.equal(first.selection, null);
  assert.equal(selection(cwd, agent), undefined);
  assert.equal(existsSync(join(cwd, ".git/brabbler-trust-id")), false);
  assert.equal(existsSync(join(cwd, ".git/brabbler-native-resources-id")), false); assert.equal(existsSync(file), false);
  assert.equal(getProjectTrustStatus(cwd, agent).trusted, false);
  const saved = save(cwd, agent, first.revision, paperless);
  assert.deepEqual(saved.selection, paperless);
  assert.equal(getProjectTrustStatus(cwd, agent).trusted, false);
  assert.equal(existsSync(join(agent, "brabbler/trusted-git-repositories.json")), false);
  const linked = join(root, "linked"); git(cwd, "worktree", "add", "-qb", "linked", linked);
  assert.deepEqual(read(linked, agent), saved);
  const alias = join(root, "alias"); await symlink(linked, alias, "dir");
  assert.deepEqual(selection(alias, agent), paperless);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(agent, "brabbler"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(cwd, ".git/brabbler-native-resources-id"))).mode & 0o777, 0o600);
});

test("native defaults preserve acceptance identity and survive later repository trust grants", async t => {
  const { cwd, agent } = await fixture(t);
  const acceptanceBefore = acceptanceProject(cwd).identity;
  const saved = save(cwd, agent, read(cwd, agent).revision, paperless);
  assert.equal(acceptanceProject(cwd).identity, acceptanceBefore, "saving an MCP default must not rename acceptance profiles/jobs");
  assert.equal(existsSync(join(cwd, ".git/brabbler-trust-id")), false);
  setProjectTrust(cwd, agent, "repository", true);
  assert.equal(existsSync(join(cwd, ".git/brabbler-trust-id")), true);
  assert.deepEqual(selection(cwd, agent), paperless);
  assert.equal(read(cwd, agent).revision, saved.revision, "independent trust changes do not stale native defaults");
});

test("project defaults do not cover siblings, subdirectories, missing or unregistered checkouts", async t => {
  const { root, cwd, agent } = await fixture(t);
  save(cwd, agent, read(cwd, agent).revision, paperless);
  const sibling = join(root, "sibling"); await mkdir(sibling); git(sibling, "init", "-qb", "main");
  assert.equal(selection(sibling, agent), undefined);
  const child = join(cwd, "child"); await mkdir(child);
  assert.equal(read(child, agent).supported, false);
  const fake = join(root, "fake"); await mkdir(fake); await writeFile(join(fake, ".git"), `gitdir: ${join(cwd, ".git")}\n`);
  assert.equal(read(fake, agent).supported, false);
  assert.equal(read(join(root, "missing"), agent).supported, false);
});

test("replacement repository at the same path does not inherit defaults or accept a stale save", async t => {
  const { root, cwd, agent } = await fixture(t);
  const saved = save(cwd, agent, read(cwd, agent).revision, paperless);
  await rename(cwd, join(root, "previous-project")); await mkdir(cwd); git(cwd, "init", "-qb", "main");
  assert.equal(selection(cwd, agent), undefined);
  assert.throws(() => save(cwd, agent, saved.revision, paperless), /changed/);
  assert.equal(existsSync(join(cwd, ".git/brabbler-native-resources-id")), false);
});

test("stale tabs cannot overwrite a newer default; reset affects only future lookups", async t => {
  const { cwd, agent } = await fixture(t);
  const stale = read(cwd, agent);
  const first = save(cwd, agent, stale.revision, paperless), captured = selection(cwd, agent);
  assert.throws(() => save(cwd, agent, stale.revision, off), /changed/);
  const second = save(cwd, agent, first.revision, off);
  assert.deepEqual(selection(cwd, agent), off);
  const cleared = save(cwd, agent, second.revision, null);
  assert.equal(cleared.selection, null); assert.equal(selection(cwd, agent), undefined);
  assert.deepEqual(captured, paperless, "a session snapshot does not track later default changes");
});

test("saving one project preserves other projects and rejected input preserves the store", async t => {
  const { root, cwd, agent, file } = await fixture(t);
  const other = join(root, "other"); await mkdir(other); git(other, "init", "-qb", "main");
  save(cwd, agent, read(cwd, agent).revision, paperless);
  save(other, agent, read(other, agent).revision, { ...off, codeMode: true });
  assert.deepEqual(selection(cwd, agent), paperless);
  assert.deepEqual(selection(other, agent), { ...off, codeMode: true });
  const original = await readFile(file, "utf8");
  for (const invalid of [undefined, {}, { ...off, credential: "SYNTHETIC_NOT_A_SECRET" }]) {
    assert.throws(() => save(cwd, agent, read(cwd, agent).revision, invalid));
    assert.equal(await readFile(file, "utf8"), original);
  }
});

test("malformed, oversized, symlinked and special stores never enable resources or get overwritten", async t => {
  const { cwd, agent, file, root } = await fixture(t);
  const revision = read(cwd, agent).revision;
  await mkdir(join(agent, "brabbler"));
  for (const contents of ["{", "null", '{"version":2,"projects":[]}', '{"version":1,"projects":[{}]}', " ".repeat(4 * 1024 * 1024 + 1)]) {
    await writeFile(file, contents);
    assert.throws(() => selection(cwd, agent), /unavailable/);
    assert.throws(() => save(cwd, agent, revision, paperless), /unavailable/);
    assert.equal(await readFile(file, "utf8"), contents);
    assert.equal(existsSync(`${file}.lock`), false);
  }
  await rm(file);
  const target = join(root, "not-a-settings-file"); await writeFile(target, "SYNTHETIC_DO_NOT_READ"); await symlink(target, file);
  assert.throws(() => selection(cwd, agent), /unavailable/);
  await rm(file); await mkdir(file);
  assert.throws(() => selection(cwd, agent), /unavailable/);
});

test("a save outside its write budget refuses to overwrite a newer store snapshot", async t => {
  const { cwd, agent, file } = await fixture(t);
  const saved = save(cwd, agent, read(cwd, agent).revision, paperless);
  const newer = `${JSON.stringify({ version: 1, projects: [] })}\n`;
  let calls = 0;
  // Simulate a long synchronous probe and a later writer's completed reset at
  // the final write fence. No actual long timeout or credential data is needed.
  t.mock.method(performance, "now", () => {
    if (++calls < 4) return 0;
    writeFileSync(file, newer); return 40_000;
  });
  assert.throws(() => save(cwd, agent, saved.revision, off), /lease budget/);
  assert.equal(await readFile(file, "utf8"), newer);
  assert.equal(existsSync(`${file}.lock`), false);
});

test("global defaults preserve legacy projects, work outside Git and yield to explicit project off", async t => {
  const { root, cwd, agent, file } = await fixture(t);
  const project = save(cwd, agent, read(cwd, agent).revision, off);
  const legacy = await readFile(file, "utf8");
  assert.equal(JSON.parse(legacy).globalSelection, undefined);
  const first = readGlobal(agent);
  const global = saveGlobal(agent, first.revision, paperless);
  assert.deepEqual(ordinary(cwd, agent), off);
  assert.equal(read(cwd, agent).revision, project.revision);
  const plain = join(root, "plain"); await mkdir(plain);
  assert.deepEqual(ordinary(plain, agent), paperless);
  assert.equal(existsSync(join(plain, ".git")), false);
  assert.equal(existsSync(join(cwd, ".git/brabbler-trust-id")), false);
  assert.throws(() => saveGlobal(agent, first.revision, off), /changed/);
  save(cwd, agent, project.revision, null);
  assert.equal(readGlobal(agent).revision, global.revision);
  assert.deepEqual(ordinary(cwd, agent), paperless);
  const captured = ordinary(cwd, agent);
  saveGlobal(agent, global.revision, null);
  assert.equal(ordinary(plain, agent), undefined);
  assert.deepEqual(captured, paperless);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test("global saves reject project references and corrupted stores without replacement", async t => {
  const { cwd, agent, file } = await fixture(t);
  const saved = saveGlobal(agent, readGlobal(agent).revision, paperless);
  const bytes = await readFile(file, "utf8");
  assert.throws(() => saveGlobal(agent, saved.revision, { ...off, mcpServers: [{ scope: "project", name: "local" }] }), /globally/);
  assert.equal(await readFile(file, "utf8"), bytes);
  for (const globalSelection of [{}, { ...off, mcpServers: [{ scope: "project", name: "local" }] }]) {
    const corrupt = JSON.stringify({ version: 1, projects: [], globalSelection });
    await writeFile(file, corrupt);
    assert.throws(() => readGlobal(agent), /unavailable/);
    assert.throws(() => ordinary(cwd, agent), /unavailable/);
    assert.throws(() => saveGlobal(agent, saved.revision, null), /unavailable/);
    assert.equal(await readFile(file, "utf8"), corrupt);
    assert.equal(existsSync(`${file}.lock`), false);
  }
});

test("per-server project changes preserve unrelated global inheritance and Code-mode", async t => {
  const { cwd, agent } = await fixture(t);
  const docs = { scope: "global", name: "docs" }, issues = { scope: "project", name: "issues" };
  saveGlobal(agent, readGlobal(agent).revision, undefined, { server: docs, value: true });
  const before = read(cwd, agent);
  save(cwd, agent, before.revision, undefined, { server: issues, value: true });
  assert.deepEqual(ordinary(cwd, agent), { ...off, mcpServers: [docs, issues] });
  assert.throws(() => save(cwd, agent, before.revision, undefined, { server: issues, value: false }), /changed/);
  const globalRevision = readGlobal(agent).revision;
  save(cwd, agent, read(cwd, agent).revision, undefined, { server: docs, value: false });
  assert.deepEqual(ordinary(cwd, agent), { ...off, mcpServers: [issues] });
  saveGlobal(agent, globalRevision, undefined, { codeMode: true });
  assert.deepEqual(ordinary(cwd, agent), { ...off, codeMode: true, mcpServers: [issues] });
  save(cwd, agent, read(cwd, agent).revision, undefined, { server: docs, value: null });
  assert.deepEqual(ordinary(cwd, agent), { ...off, codeMode: true, mcpServers: [docs, issues] });
  save(cwd, agent, read(cwd, agent).revision, undefined, { codeMode: false });
  assert.equal(ordinary(cwd, agent).codeMode, false);
  save(cwd, agent, read(cwd, agent).revision, undefined, { codeMode: null });
  assert.equal(ordinary(cwd, agent).codeMode, true);
});

test("legacy snapshots retain exclusions, missing declarations and future-server opt-out until explicit inheritance", async t => {
  const { cwd, agent, file } = await fixture(t);
  const docs = { scope: "global", name: "docs" }, missing = { scope: "global", name: "missing" }, future = { scope: "global", name: "future" };
  save(cwd, agent, read(cwd, agent).revision, { ...off, mcpServers: [missing] });
  const bytes = await readFile(file, "utf8");
  saveGlobal(agent, readGlobal(agent).revision, { ...off, codeMode: true, mcpServers: [docs] });
  assert.deepEqual(ordinary(cwd, agent), { ...off, mcpServers: [missing] });
  save(cwd, agent, read(cwd, agent).revision, undefined, { server: docs, value: null });
  saveGlobal(agent, readGlobal(agent).revision, undefined, { server: future, value: true });
  assert.deepEqual(ordinary(cwd, agent), { ...off, mcpServers: [docs, missing] });
  assert.equal(JSON.parse(await readFile(file, "utf8")).projects[0].selection.mcpServers[0].name,
    JSON.parse(bytes).projects[0].selection.mcpServers[0].name, "legacy selection remains intact");
  save(cwd, agent, read(cwd, agent).revision, undefined, { server: missing, value: false });
  assert.deepEqual(ordinary(cwd, agent), { ...off, mcpServers: [docs] });
  save(cwd, agent, read(cwd, agent).revision, undefined, { codeMode: null });
  assert.equal(ordinary(cwd, agent).codeMode, true);
});

test("per-server choices retain exact enabled references and reject malformed/global inherit preferences", async t => {
  const { cwd, agent, file } = await fixture(t);
  const selected = { scope: "global", name: "same-name" };
  saveGlobal(agent, readGlobal(agent).revision, undefined, { server: selected, value: true });
  assert.deepEqual(ordinary(cwd, agent).mcpServers, [selected]);
  const replacement = { scope: "project", name: "same-name" };
  save(cwd, agent, read(cwd, agent).revision, undefined, { server: replacement, value: true });
  assert.deepEqual(ordinary(cwd, agent).mcpServers, [replacement], "only an explicit new project grant replaces the inherited reference");
  save(cwd, agent, read(cwd, agent).revision, undefined, { server: replacement, value: null });
  assert.deepEqual(ordinary(cwd, agent).mcpServers, [selected]);
  const original = await readFile(file, "utf8");
  for (const change of [{ server: selected, value: null }, { server: replacement, value: true }, { codeMode: null }, { codeMode: undefined }]) {
    assert.throws(() => saveGlobal(agent, readGlobal(agent).revision, undefined, change));
    assert.equal(await readFile(file, "utf8"), original);
  }
  const corrupted = JSON.parse(original); corrupted.globalPreferences.servers[0].value = "on";
  await writeFile(file, JSON.stringify(corrupted));
  assert.throws(() => ordinary(cwd, agent), /unavailable/);
});

test("default display preserves exact scope and spelling when a namespace has a replacement", () => {
  const original = { scope: "global", name: "docs-server" }, replacement = { scope: "project", name: "docs-server" }, alias = { scope: "global", name: "docs_server" };
  const legacy = { ...off, mcpServers: [original] };
  assert.equal(nativeDefaultChoice(legacy, { servers: [] }, original), true);
  assert.equal(nativeDefaultChoice(legacy, { servers: [] }, replacement), false);
  assert.equal(nativeDefaultChoice(legacy, { servers: [] }, alias), false);
  const preferences = { servers: [{ ...replacement, value: true }] };
  assert.equal(nativeDefaultChoice(legacy, preferences, replacement), true);
  assert.equal(nativeDefaultChoice(legacy, preferences, original), false);
});

test("effective server limit rejects overflowing edits before replacing the private store", async t => {
  const { cwd, agent, file } = await fixture(t);
  const full = { ...off, mcpServers: Array.from({ length: 128 }, (_, i) => ({ scope: "global", name: `server-${i}` })) };
  saveGlobal(agent, readGlobal(agent).revision, full);
  const bytes = await readFile(file, "utf8"), extra = { scope: "global", name: "extra" };
  assert.throws(() => saveGlobal(agent, readGlobal(agent).revision, undefined, { server: extra, value: true }), /maximum 128/);
  assert.equal(await readFile(file, "utf8"), bytes);
  assert.throws(() => save(cwd, agent, read(cwd, agent).revision, undefined, { server: extra, value: true }), /maximum 128/);
  assert.equal(await readFile(file, "utf8"), bytes);
  saveGlobal(agent, readGlobal(agent).revision, undefined, { server: full.mcpServers[0], value: false });
  save(cwd, agent, read(cwd, agent).revision, undefined, { server: extra, value: true });
  assert.equal(ordinary(cwd, agent).mcpServers.length, 128);
});

test("unsupported directories and malformed revisions never initialize identity", async t => {
  const { root, cwd, agent } = await fixture(t);
  const plain = join(root, "plain"); await mkdir(plain);
  assert.equal(read(plain, agent).supported, false);
  assert.throws(() => save(plain, agent, "a".repeat(64), paperless), /checkout root/);
  for (const revision of [null, undefined, "", {}, "x".repeat(64)]) assert.throws(() => save(cwd, agent, revision, paperless), /changed/);
  assert.equal(existsSync(join(cwd, ".git/brabbler-native-resources-id")), false);
});
