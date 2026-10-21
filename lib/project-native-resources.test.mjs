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
const { readProjectNativeResources: read, saveProjectNativeResources: save, projectNativeResourceSelection: selection } = await jiti.import("./project-native-resources.ts");
const { getProjectTrustStatus, setProjectTrust } = await jiti.import("./project-trust.ts");
const { acceptanceProject } = await jiti.import("./acceptance/config.ts");
const off = { version: 1, codeMode: false, mcpServers: [] };
const paperless = { ...off, mcpServers: [{ scope: "global", name: "paperless" }] };
const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "project-native-resources-")), cwd = join(root, "project"), agent = join(root, "agent");
  await mkdir(cwd); await mkdir(agent);
  git(cwd, "init", "-qb", "main");
  git(cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "base");
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, cwd, agent, file: join(agent, "pi-web/project-native-resources.json") };
}

test("reading is inert, saving shares with registered future worktrees and never grants trust", async t => {
  const { root, cwd, agent, file } = await fixture(t);
  await mkdir(join(cwd, ".pi")); await writeFile(join(cwd, ".pi/mcp.json"), '{"mcpServers":{}}');
  const first = read(cwd, agent);
  assert.equal(first.supported, true); assert.equal(first.selection, null);
  assert.equal(selection(cwd, agent), undefined);
  assert.equal(existsSync(join(cwd, ".git/pi-web-trust-id")), false);
  assert.equal(existsSync(join(cwd, ".git/pi-web-native-resources-id")), false); assert.equal(existsSync(file), false);
  assert.equal(getProjectTrustStatus(cwd, agent).trusted, false);
  const saved = save(cwd, agent, first.revision, paperless);
  assert.deepEqual(saved.selection, paperless);
  assert.equal(getProjectTrustStatus(cwd, agent).trusted, false);
  assert.equal(existsSync(join(agent, "pi-web/trusted-git-repositories.json")), false);
  const linked = join(root, "linked"); git(cwd, "worktree", "add", "-qb", "linked", linked);
  assert.deepEqual(read(linked, agent), saved);
  const alias = join(root, "alias"); await symlink(linked, alias, "dir");
  assert.deepEqual(selection(alias, agent), paperless);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(agent, "pi-web"))).mode & 0o777, 0o700);
  assert.equal((await stat(join(cwd, ".git/pi-web-native-resources-id"))).mode & 0o777, 0o600);
});

test("native defaults preserve acceptance identity and survive later repository trust grants", async t => {
  const { cwd, agent } = await fixture(t);
  const acceptanceBefore = acceptanceProject(cwd).identity;
  const saved = save(cwd, agent, read(cwd, agent).revision, paperless);
  assert.equal(acceptanceProject(cwd).identity, acceptanceBefore, "saving an MCP default must not rename acceptance profiles/jobs");
  assert.equal(existsSync(join(cwd, ".git/pi-web-trust-id")), false);
  setProjectTrust(cwd, agent, "repository", true);
  assert.equal(existsSync(join(cwd, ".git/pi-web-trust-id")), true);
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
  assert.equal(existsSync(join(cwd, ".git/pi-web-native-resources-id")), false);
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
  await mkdir(join(agent, "pi-web"));
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

test("unsupported directories and malformed revisions never initialize identity", async t => {
  const { root, cwd, agent } = await fixture(t);
  const plain = join(root, "plain"); await mkdir(plain);
  assert.equal(read(plain, agent).supported, false);
  assert.throws(() => save(plain, agent, "a".repeat(64), paperless), /checkout root/);
  for (const revision of [null, undefined, "", {}, "x".repeat(64)]) assert.throws(() => save(cwd, agent, revision, paperless), /changed/);
  assert.equal(existsSync(join(cwd, ".git/pi-web-native-resources-id")), false);
});
