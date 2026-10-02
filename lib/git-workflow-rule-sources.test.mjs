import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import fs from "node:fs";
import { bindingTestModule } from "./git-workflow-binding-test-loader.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeTest from "node:test";
const test = (name, run) => nodeTest(name, { skip: process.platform !== "linux" && "Secure source capture requires Linux" }, run);
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { captureGitRuleSources: capture, validateRuleSourceSet, GIT_RULE_DISCOVERY } = await jiti.import("./git-workflow-rule-sources.ts");
const { bindingPathIdentity } = await jiti.import("./git-workflow-binding-io.ts");
const { loadProjectContextFiles } = await import("@earendil-works/pi-coding-agent");
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-rule-sources-")));
  const cwd = join(dir, "repo"), agentDir = join(dir, "agent");
  mkdirSync(cwd); mkdirSync(agentDir);
  const identity = bindingPathIdentity(cwd, true);
  const workspace = { root: cwd, projectRoot: cwd, branch: "feature", commonDir: join(cwd, ".git"), gitDir: join(cwd, ".git"), rootIdentity: identity, gitIdentity: identity, commonIdentity: identity };
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, cwd, agentDir, workspace, options: { workspace, agentDir }, write: (name, content = "instruction\n") => writeFileSync(join(cwd, name), content) };
}
test("discovery contract is pinned to the tested SDK and matches all five names including an empty override", (t) => {
  const f = fixture(t);
  const version = JSON.parse(readFileSync(new URL("../node_modules/@earendil-works/pi-coding-agent/package.json", import.meta.url))).version;
  assert.equal(GIT_RULE_DISCOVERY, `pi-${version}-context-v1`);
  writeFileSync(join(f.agentDir, "CLAUDE.MD"), "global");
  writeFileSync(join(f.dir, "AGENTS.md"), "ancestor");
  for (const name of ["CLAUDE.MD", "CLAUDE.md", "AGENTS.MD", "AGENTS.md", "AGENTS.override.md"]) {
    f.write(name, name === "AGENTS.override.md" ? "" : name);
    const result = capture(f.options);
    assert.deepEqual(result.sources.map(({ path, content }) => ({ path, content: content.replace(/^\uFEFF/, "") })), loadProjectContextFiles({ cwd: f.cwd, agentDir: f.agentDir }));
    assert.equal(result.sources.at(-1).path, join(f.cwd, name));
    assert.deepEqual(validateRuleSourceSet(result), result);
  }
  assert.equal(capture(f.options).sources.at(-1).bytes, 0);
});
test("missing higher-priority files, ancestors, dependencies and raw BOM changes change the digest", (t) => {
  const f = fixture(t);
  f.write("AGENTS.md", "main"); f.write("rules.md", "delegated rules");
  const options = { ...f.options, dependencies: ["rules.md"] };
  const first = capture(options);
  assert.ok(first.absent.includes(join(f.cwd, "AGENTS.override.md")));
  f.write("rules.md", "new delegated rules");
  const second = capture(options); assert.notEqual(first.digest, second.digest);
  f.write("AGENTS.md", "\uFEFFmain");
  const bom = capture(options); assert.notEqual(second.digest, bom.digest);
  assert.equal(bom.sources.find((source) => source.path === join(f.cwd, "AGENTS.md")).content, "\uFEFFmain");
  f.write("AGENTS.override.md", "override");
  const override = capture(options); assert.notEqual(override.digest, bom.digest);
  assert.ok(override.sources.some((source) => source.path.endsWith("AGENTS.override.md")));
  writeFileSync(join(f.dir, "AGENTS.md"), "new parent rules");
  assert.notEqual(capture(options).digest, override.digest);
  unlinkSync(join(f.cwd, "rules.md"));
  assert.throws(() => capture(options), /cannot be captured/);
});
test("unreadable, dangling, nonregular and malformed winners block rather than falling back", (t) => {
  const f = fixture(t); f.write("AGENTS.md", "fallback must not hide failures");
  const override = join(f.cwd, "AGENTS.override.md");
  for (const make of [
    () => symlinkSync(join(f.dir, "missing.md"), override),
    () => mkdirSync(override),
    () => writeFileSync(override, Buffer.from([0xff, 0xfe])),
    () => writeFileSync(override, "binary\0data"),
    () => writeFileSync(override, "x".repeat(256 * 1024 + 1)),
    () => { writeFileSync(override, "unreadable"); chmodSync(override, 0); },
  ]) {
    make(); assert.throws(() => capture(f.options), /cannot be captured|unavailable/);
    rmSync(override, { recursive: true, force: true });
  }
});
test("symlink destinations require exact explicit selection before any content read, and retargeting is never followed silently", (t) => {
  const f = fixture(t), outside = join(f.dir, "installed-policy.md"), link = join(f.cwd, "AGENTS.md");
  writeFileSync(outside, "installed policy"); symlinkSync(outside, link);
  let targets;
  assert.throws(() => capture(f.options), (error) => { targets = error.targets; return /exact destinations/.test(error.message); });
  assert.deepEqual(targets, [{ path: link, realPath: outside }]);
  const approved = capture({ ...f.options, targets });
  assert.equal(approved.sources[0].content, "installed policy");
  const replacement = join(f.dir, "replacement.md"); writeFileSync(replacement, "installed policy");
  unlinkSync(link); symlinkSync(replacement, link);
  assert.throws(() => capture({ ...f.options, targets }), (error) => error.targets?.[0].realPath === replacement);
  assert.notEqual(capture({ ...f.options, targets: [{ path: link, realPath: replacement }] }).digest, approved.digest);
  const credentialFixture = join(f.dir, "test-only.env"); writeFileSync(credentialFixture, "PLACEHOLDER_ONLY=not-a-credential");
  unlinkSync(link); symlinkSync(credentialFixture, link);
  assert.throws(() => capture({ ...f.options, targets: [{ path: link, realPath: credentialFixture }] }), /cannot be captured/);
});
test("explicit dependencies are bounded Markdown documents, not URLs, recursive links, or implicit skill lookup", (t) => {
  const f = fixture(t); f.write("AGENTS.md", "See [other](unread.md), https://example.invalid and the git-worktrees skill.");
  const base = capture(f.options);
  assert.equal(base.sources.length, 1);
  assert.equal(base.coverage, "primary-and-explicit-dependencies");
  f.write("unread.md", "explicit document");
  assert.equal(capture({ ...f.options, dependencies: ["unread.md"] }).sources.at(-1).role, "dependency");
  for (const dependencies of [["unread.md", "./unread.md"], ["https://example.invalid/rules.md"], ["../outside.md"], [".env"], Array(25).fill("unread.md")]) {
    assert.throws(() => capture({ ...f.options, dependencies }));
  }
  const paths = [];
  for (let i = 0; i < 5; i++) { const name = `${i}.md`; f.write(name, "x".repeat(256 * 1024)); paths.push(name); }
  assert.throws(() => capture({ ...f.options, dependencies: paths }), /cannot be captured/);
});
test("global duplicate selection and nested worktree shadowing match SDK without substituting primary checkout rules", (t) => {
  const f = fixture(t);
  f.write("AGENTS.md", "main rules");
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(f.dir, "no-config") } }).trim();
  git(f.cwd, "init", "-qb", "main");
  git(f.cwd, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(f.dir, "no-hooks")}`, "commit", "--allow-empty", "-qm", "initial");
  for (const root of [join(f.cwd, "nested"), join(f.dir, "sibling")]) {
    git(f.cwd, "worktree", "add", "-qb", root.endsWith("nested") ? "nested" : "sibling", root);
    writeFileSync(join(root, "AGENTS.md"), "feature rules");
    const workspace = { ...f.workspace, root, gitDir: git(root, "rev-parse", "--absolute-git-dir") };
    const result = capture({ ...f.options, workspace });
    assert.deepEqual(result.sources.map(({ path, content }) => ({ path, content })), loadProjectContextFiles({ cwd: root, agentDir: f.agentDir }));
    assert.equal(result.shadowed.length, root.endsWith("nested") ? 1 : 0);
    writeFileSync(join(root, "AGENTS.override.md"), "override feature rules");
    const override = capture({ ...f.options, workspace });
    assert.deepEqual(override.sources.map(({ path, content }) => ({ path, content })), loadProjectContextFiles({ cwd: root, agentDir: f.agentDir }));
  }
  const duplicate = capture({ ...f.options, agentDir: f.cwd });
  assert.equal(duplicate.sources.filter((source) => source.path === join(f.cwd, "AGENTS.md")).length, 1);
});
test("parent-directory retargeting is rejected before reading any unselected bytes", async (t) => {
  const f = fixture(t), approvedParent = join(f.cwd, "approved"), hiddenParent = join(f.dir, "unselected");
  mkdirSync(approvedParent); mkdirSync(hiddenParent);
  const file = join(approvedParent, "source.md"), hidden = join(hiddenParent, "source.md");
  writeFileSync(file, "approved source"); writeFileSync(hidden, "unselected fixture sentinel");
  const hiddenInode = fs.statSync(hidden).ino;
  let swapped = false, unselectedReads = 0;
  const filesystem = { ...fs, realpathSync(path, ...args) {
    const result = fs.realpathSync(path, ...args);
    if (!swapped && path === file) {
      swapped = true; renameSync(approvedParent, `${approvedParent}-retained`); symlinkSync(hiddenParent, approvedParent);
    }
    return result;
  }, readSync(...args) {
    if (fs.fstatSync(args[0]).ino === hiddenInode) unselectedReads++;
    return fs.readSync(...args);
  } };
  const paths = await jiti.import("./paths.ts");
  const io = bindingTestModule("./git-workflow-binding-io.ts", { "node:fs": filesystem, "./paths": paths });
  const collector = bindingTestModule("./git-workflow-rule-sources.ts", { "node:fs": filesystem, "./paths": paths,
    "./path-security": await jiti.import("./path-security.ts"), "./git-workflow-binding-io": io,
    "./git-workflow-binding-types": await jiti.import("./git-workflow-binding-types.ts") });
  assert.throws(() => collector.captureGitRuleSources({ ...f.options, dependencies: ["approved/source.md"] }), /cannot be captured/);
  assert.equal(swapped, true); assert.equal(unselectedReads, 0);
});
test("all shadow-selection probes are bounded, readable and representable, including multiple aliased ancestors", (t) => {
  const f = fixture(t), middle = join(f.cwd, "middle"), nested = join(middle, "nested");
  mkdirSync(middle); mkdirSync(nested);
  f.write("AGENTS.md", "main source"); f.write("CLAUDE.md", "SDK fallback source");
  symlinkSync(join(f.cwd, "AGENTS.md"), join(middle, "AGENTS.md"));
  writeFileSync(join(nested, "AGENTS.md"), "feature source");
  const options = { ...f.options, workspace: { ...f.workspace, root: nested }, targets: [{ path: join(middle, "AGENTS.md"), realPath: join(f.cwd, "AGENTS.md") }] };
  const result = capture(options);
  assert.equal(result.shadowed.length, 2); assert.equal(result.selectionSources.length, 2);
  assert.deepEqual(validateRuleSourceSet(result), result);
  chmodSync(join(f.cwd, "AGENTS.md"), 0);
  assert.throws(() => capture(options), /cannot be captured/);
});
test("descriptor growth during capture fails and returned snapshots cannot conceal altered bytes or versions", async (t) => {
  const f = fixture(t); f.write("AGENTS.md", "initial");
  const inode = fs.statSync(join(f.cwd, "AGENTS.md")).ino;
  let changed = false;
  const paths = await jiti.import("./paths.ts");
  const io = bindingTestModule("./git-workflow-binding-io.ts", { "./paths": paths, "node:fs": { ...fs, readSync(...args) {
    const result = fs.readSync(...args);
    if (!changed && fs.fstatSync(args[0]).ino === inode) { changed = true; appendFileSync(join(f.cwd, "AGENTS.md"), "changed"); }
    return result;
  } } });
  const sourceModule = bindingTestModule("./git-workflow-rule-sources.ts", { "./paths": paths,
    "./path-security": await jiti.import("./path-security.ts"), "./git-workflow-binding-io": io,
    "./git-workflow-binding-types": await jiti.import("./git-workflow-binding-types.ts") });
  assert.throws(() => sourceModule.captureGitRuleSources(f.options), /changed|cannot be captured/); assert.ok(changed);
  const captured = capture(f.options);
  for (const edit of [(copy) => { copy.version = 2; }, (copy) => { copy.discovery = "pi-0.87.1-context-v1"; }, (copy) => { copy.discovery = "pi-0.99.1-context-v1"; }, (copy) => { copy.sources[0].content += "forged"; }, (copy) => { copy.authorized = true; }, (copy) => { copy.absent = []; }]) {
    const copy = structuredClone(captured); edit(copy); assert.throws(() => validateRuleSourceSet(copy));
  }
});
