import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs, { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { bindingTestModule } from "./git-workflow-binding-test-loader.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import nodeTest from "node:test";
const test = (name, run) => nodeTest(name, { skip: process.platform !== "linux" && "Fixture uses Linux source capture" }, run);
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { readGitTaskBinding: read, adoptGitTaskBinding: adopt, retireGitTaskBinding: retire, validateGitTaskBindingSnapshot } = await jiti.import("./git-workflow-binding-store.ts");
const { withGitWorkflowSettingsLock: lock } = await jiti.import("./git-workflow-settings-store.ts");
const { bindingHash, bindingPathIdentity } = await jiti.import("./git-workflow-binding-io.ts");
const { captureGitRuleSources } = await jiti.import("./git-workflow-rule-sources.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const exec = promisify(execFile);
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-binding-store-")));
  const agentDir = join(dir, "agent"), root = join(dir, "repo");
  mkdirSync(agentDir); mkdirSync(root); mkdirSync(join(root, ".git"));
  const file = join(agentDir, "fixture.jsonl"); writeFileSync(file, "test-only fixture", { mode: 0o600 });
  writeFileSync(join(root, "AGENTS.md"), "Use exact human approvals.\n");
  const identity = bindingPathIdentity(root, true);
  const workspace = { root, projectRoot: root, branch: "feature", gitDir: join(root, ".git"), commonDir: join(root, ".git"), rootIdentity: identity, gitIdentity: identity, commonIdentity: identity };
  const snapshot = { version: 1, owner: { sessionId: "test-session", sessionFile: file, sessionIdentity: bindingPathIdentity(file), headerDigest: "a".repeat(64), cwd: root },
    workspace, request: { entryId: "request", digest: "b".repeat(64), goal: "Implement one bounded feature" }, settings: { ...DEFAULT_GIT_WORKFLOW_SETTINGS }, settingsEntryId: "capture", sources: captureGitRuleSources({ workspace, agentDir }) };
  const namespace = join(agentDir, "pi-web", "git-task-bindings", "v1", bindingHash("test-session"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, agentDir, root, file, snapshot, namespace, head: join(namespace, "current.json"),
    adopt: (revision = "none", value = snapshot) => lock(agentDir, async () => adopt(value, revision, agentDir)),
    retire: (revision, reason = null) => lock(agentDir, async () => retire("test-session", revision, reason, agentDir)) };
}
test("reads create nothing; adoption is private, generation-bound and preserves immutable source evidence", async (t) => {
  const f = fixture(t);
  const before = readdirSync(f.agentDir);
  assert.deepEqual(read("test-session", f.agentDir), { revision: "none", record: null });
  assert.deepEqual(readdirSync(f.agentDir), before);
  const first = await f.adopt();
  assert.equal(first.record.generation, 1);
  assert.equal(first.record.reviewOrigin, "workflow-home");
  assert.equal(statSync(f.namespace).mode & 0o777, 0o700);
  assert.equal(statSync(f.head).mode & 0o777, 0o600);
  const artifact = join(f.namespace, `${first.record.id}.json`), bytes = readFileSync(artifact);
  assert.equal(statSync(artifact).mode & 0o777, 0o600);
  const released = await f.retire(first.revision);
  assert.equal(released.record.generation, 2); assert.equal(released.record.state, "released");
  assert.deepEqual(readFileSync(artifact), bytes);
  await assert.rejects(f.adopt(first.revision), /changed elsewhere/);
  const next = await f.adopt(released.revision);
  assert.equal(next.record.generation, 3); assert.notEqual(next.record.id, first.record.id);
  assert.deepEqual(readFileSync(artifact), bytes);
  assert.equal(read("test-session", f.agentDir).revision, next.revision);
});
test("settings capture and moves leave durable, monotonically fenced invalidation rather than resetting old adoption", async (t) => {
  const f = fixture(t);
  const initial = await f.adopt();
  const invalidated = await f.retire(initial.revision, "session-move");
  assert.equal(invalidated.record.state, "invalidated"); assert.equal(invalidated.record.invalidatedBy, "session-move");
  assert.equal(invalidated.record.generation, 2);
  assert.deepEqual(await f.retire(invalidated.revision, "settings-capture"), invalidated);
  const adopted = await f.adopt(invalidated.revision);
  const recaptured = await f.retire(adopted.revision, "settings-capture");
  assert.equal(recaptured.record.generation, 4);
});
test("strict snapshots refuse grant fields, unknown versions, altered source bytes and invalid identities", (t) => {
  const f = fixture(t);
  assert.deepEqual(validateGitTaskBindingSnapshot(f.snapshot), f.snapshot);
  for (const change of [(v) => { v.version = 2; }, (v) => { v.authorized = true; }, (v) => { v.settings.commits = "automatic"; }, (v) => { v.owner.sessionIdentity.ino = "unknown"; }, (v) => { v.sources.sources[0].content = "forged"; }]) {
    const value = structuredClone(f.snapshot); change(value); assert.throws(() => validateGitTaskBindingSnapshot(value));
  }
});
test("corrupt/newer/missing heads and artifacts fail closed without repairing or falling back", async (t) => {
  for (const alteration of ["head-version", "missing-head", "missing-artifact", "artifact-content", "head-oversize"]) {
    const f = fixture(t); const current = await f.adopt();
    const artifact = join(f.namespace, `${current.record.id}.json`);
    if (alteration === "head-version") { const doc = JSON.parse(readFileSync(f.head)); doc.version = 2; writeFileSync(f.head, JSON.stringify(doc)); }
    if (alteration === "missing-head") unlinkSync(f.head);
    if (alteration === "missing-artifact") unlinkSync(artifact);
    if (alteration === "artifact-content") writeFileSync(artifact, "{}");
    if (alteration === "head-oversize") writeFileSync(f.head, "x".repeat(16385));
    assert.throws(() => read("test-session", f.agentDir), /unavailable/);
    await assert.rejects(f.adopt("none"), /unavailable/);
  }
});
test("private storage rejects symlinks, hardlinks and public permissions before parsing content", async (t) => {
  for (const kind of ["head-symlink", "head-hardlink", "artifact-symlink", "file-mode", "directory-mode"]) {
    const f = fixture(t); const current = await f.adopt();
    const artifact = join(f.namespace, `${current.record.id}.json`);
    if (kind.endsWith("symlink")) {
      const target = join(f.dir, "outside.json"); writeFileSync(target, "{}", { mode: 0o600 });
      const path = kind === "head-symlink" ? f.head : artifact; unlinkSync(path); symlinkSync(target, path);
    }
    if (kind === "head-hardlink") linkSync(f.head, join(f.dir, "extra-link"));
    if (kind === "file-mode") chmodSync(f.head, 0o644);
    if (kind === "directory-mode") chmodSync(f.namespace, 0o755);
    assert.throws(() => read("test-session", f.agentDir), /unavailable/);
  }
});
test("two actual processes with the same expected revision have one CAS winner", async (t) => {
  const f = fixture(t), input = join(f.dir, "snapshot.json");
  writeFileSync(input, JSON.stringify(f.snapshot));
  const script = `import {readFileSync} from 'node:fs'; import {createJiti} from 'jiti';
    const jiti=createJiti(process.cwd()+'/package.json');
    const {withGitWorkflowSettingsLock:lock}=await jiti.import('./lib/git-workflow-settings-store.ts');
    const {adoptGitTaskBinding:adopt}=await jiti.import('./lib/git-workflow-binding-store.ts');
    try {const result=await lock(process.argv[1],async()=>adopt(JSON.parse(readFileSync(process.argv[2])), 'none', process.argv[1])); console.log(JSON.stringify({generation:result.record.generation}));}
    catch(error) {console.log(JSON.stringify({error:error.message}));}`;
  const results = await Promise.all([0, 1].map(() => exec(process.execPath, ["--input-type=module", "-e", script, f.agentDir, input], { timeout: 30_000 })));
  const values = results.map((result) => JSON.parse(result.stdout.trim()));
  assert.equal(values.filter((value) => value.generation === 1).length, 1);
  assert.equal(values.filter((value) => /changed elsewhere/.test(value.error)).length, 1);
  assert.equal(read("test-session", f.agentDir).record.generation, 1);
});
test("a failed parent-directory barrier is retried even when mkdir left the namespace entry present", async (t) => {
  const f = fixture(t), parent = join(f.agentDir, "pi-web"), root = join(parent, "git-task-bindings");
  let barriers = 0;
  const filesystem = { ...fs, fsyncSync(fd) {
    if (fs.readlinkSync(`/proc/self/fd/${fd}`) === parent && fs.existsSync(root)) {
      barriers++;
      if (barriers === 1) throw Object.assign(new Error("injected parent barrier failure"), { code: "EIO" });
    }
    return fs.fsyncSync(fd);
  } };
  const epoch = bindingTestModule("./git-workflow-write-epoch.ts", { "node:fs": filesystem,
    "./git-scoped-authority": await jiti.import("./git-scoped-authority.ts"),
    "./atomic-file": await jiti.import("./atomic-file.ts"), "./git-workflow-binding-io": await jiti.import("./git-workflow-binding-io.ts") });
  const imports = { "node:fs": filesystem, "@earendil-works/pi-coding-agent": await jiti.import("@earendil-works/pi-coding-agent"), "./git-workflow-write-epoch": epoch };
  for (const name of ["atomic-file", "git-workflow-binding-io", "git-workflow-binding-runtime", "git-workflow-binding-types", "git-workflow-settings", "git-workflow-policy", "git-workflow-rule-sources"]) imports[`./${name}`] = await jiti.import(`./${name}.ts`);
  const injectedStore = bindingTestModule("./git-workflow-binding-store.ts", imports);
  const attempt = () => lock(f.agentDir, async () => injectedStore.adoptGitTaskBinding(f.snapshot, "none", f.agentDir));
  await assert.rejects(attempt(), /parent barrier failure/);
  assert.equal(fs.existsSync(root), true); assert.equal(read("test-session", f.agentDir).record, null);
  const success = await attempt(); assert.equal(success.record.generation, 1); assert.equal(barriers, 2);
});
test("pre-publication failure retains prior state and orphan evidence; post-publication failure is read back, never replayed", async (t) => {
  const f = fixture(t), first = await f.adopt(), initial = readFileSync(f.head);
  const injected = async (overrides) => {
    const mockedFs = { ...fs, ...overrides };
    const imports = { "node:fs": mockedFs, "@earendil-works/pi-coding-agent": { getAgentDir: () => f.agentDir },
      "./atomic-file": bindingTestModule("./atomic-file.ts", { fs: mockedFs }) };
    imports["./git-workflow-write-epoch"] = bindingTestModule("./git-workflow-write-epoch.ts", { "node:fs": mockedFs,
      "./git-scoped-authority": await jiti.import("./git-scoped-authority.ts"),
      "./atomic-file": imports["./atomic-file"], "./git-workflow-binding-io": await jiti.import("./git-workflow-binding-io.ts") });
    for (const name of ["git-workflow-settings", "git-workflow-policy", "git-workflow-rule-sources", "git-workflow-binding-io", "git-workflow-binding-runtime", "git-workflow-binding-types"]) imports[`./${name}`] = await jiti.import(`./${name}.ts`);
    const injectedStore = bindingTestModule("./git-workflow-binding-store.ts", imports);
    return () => lock(f.agentDir, async () => injectedStore.adoptGitTaskBinding(f.snapshot, first.revision, f.agentDir));
  };
  const failBefore = await injected({ writeFileSync(path, ...args) {
    if (String(path).includes(".current.json-")) throw new Error("fixture publication failure");
    return fs.writeFileSync(path, ...args);
  } });
  await assert.rejects(failBefore(), /fixture publication failure/);
  assert.deepEqual(readFileSync(f.head), initial);
  assert.equal(readdirSync(f.namespace).filter((name) => name !== "current.json").length, 2, "Orphan snapshot is retained, not inferred as current");
  const failAfter = await injected({ fsyncSync(fd) {
    if (fs.fstatSync(fd).isDirectory() && JSON.parse(readFileSync(f.head, "utf8")).generation === 2) throw new Error("fixture post-publication failure");
    return fs.fsyncSync(fd);
  } });
  await assert.rejects(failAfter(), /post-publication failure/);
  assert.equal(read("test-session", f.agentDir).record.generation, 2, "GET reports the actually published generation after an ambiguous response");
  await assert.rejects(f.adopt(first.revision), /changed elsewhere/);
});
