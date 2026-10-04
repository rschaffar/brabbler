import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import test, { after } from "node:test";
import { createJiti } from "jiti";
// Install before Jiti imports so both fs and node:fs named imports see the
// deterministic syscall hook (only enabled inside individual disposable tests).
const nativeRename = fs.renameSync;
let renameHook;
fs.renameSync = (...args) => renameHook ? renameHook(nativeRename, ...args) : nativeRename(...args);
syncBuiltinESMExports();
after(() => { fs.renameSync = nativeRename; syncBuiltinESMExports(); });
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { readGitScopedAuthorityRevision: read, writeGitScopedAuthorityFile: write, advanceGitScopedAuthority: advance,
  captureGitScopedAuthorityRevision: capture } = await jiti.import("./git-scoped-authority.ts");
const { advanceGitWorkflowWriteEpoch, readGitWorkflowWriteEpoch } = await jiti.import("./git-workflow-write-epoch.ts");
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), "pi-scoped-authority-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "pi-web"), { mode: 0o700 });
  return { dir, file: join(dir, "pi-web", "git-workflow-settings.json") };
}
const A = { projectRoots: ["/Alpha"], sessionId: "A" }, B = { projectRoots: ["/Beta"], sessionId: "B" };
const project = (projectRoot) => [{ kind: "project", projectRoot }];
test("durable scopes survive unrelated publications, failed attempts, sessions and >128 foreign observations", async (t) => {
  const { dir, file } = await fixture(t);
  const a = read(dir, A), b = read(dir, B);
  write(dir, file, "{}", "settings", project("/Beta"));
  assert.equal(read(dir, A), a); assert.notEqual(read(dir, B), b);
  for (let i = 0; i < 140; i++) { advance(dir, "settings", [{ kind: "session", sessionId: `other${i}` }]); read(dir, { sessionId: `other${i}` }); }
  assert.equal(read(dir, A), a);
  const beforeFailure = read(dir, B), rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === file) { assert.equal(read(dir, A), a, "reader accepts unchanged before publication"); throw new Error("failed rename"); }
    return rename(from, to);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => write(dir, file, '{"beta":true}', "settings", project("/Beta")), /failed rename/); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(read(dir, A), a); assert.notEqual(read(dir, B), beforeFailure);
  write(dir, file, "{}", "settings", project("/Beta"));
  assert.equal(read(dir, A), a, "an orphan before state never needs settlement");
  write(dir, file, "{}", "settings", project("/Alpha"));
  assert.notEqual(read(dir, A), a, "equal-value own writes revoke");
});
for (const publication of [1, 2]) for (const failFinalRename of [false, true]) test(`P1: external inode replacement after sidecar publication ${publication} is never accounted (final rename failure=${failFinalRename})`, async (t) => {
  const { dir, file } = await fixture(t);
  write(dir, file, "{}", "settings", project("/Alpha"));
  const alpha = read(dir, A), sidecar = join(dir, "pi-web", "git-scoped-authority-v1.json");
  const originalInode = fs.statSync(file).ino;
  let injected = false, reachedAuthorityRename = false, failure, sidecarRenames = 0;
  renameHook = (rename, from, to) => {
    if (to === file) {
      reachedAuthorityRename = true;
      if (failFinalRename) throw new Error("fixture final rename failure");
    }
    const result = rename(from, to);
    if (to === sidecar && ++sidecarRenames === publication) {
      injected = true;
      const external = `${file}.external`;
      fs.writeFileSync(external, "{}", { mode: 0o600 }); rename(external, file);
      assert.notEqual(fs.statSync(file).ino, originalInode);
    }
    return result;
  };
  try { write(dir, file, "{}", "settings", project("/Beta")); } catch (cause) { failure = cause; }
  finally { renameHook = undefined; }
  assert.equal(injected, true, `must inject after sidecar publication ${publication}`);
  assert.throws(() => read(dir, A), /unaccounted/, `original Alpha ${alpha} must not survive a laundered rewrite`);
  assert.match(failure?.message ?? "", /unaccounted/);
  assert.equal(reachedAuthorityRename, false, "reject before Beta overwrites the unexplained file");
  assert.throws(() => write(dir, file, "{}", "settings", project("/Beta")), /unaccounted/);
});

test("an async target guard refuses before effects without quarantining unchanged unrelated authority", async (t) => {
  const { dir, file } = await fixture(t);
  write(dir, file, "{}", "settings", project("/Alpha"));
  const alpha = read(dir, A), beta = read(dir, B);
  assert.throws(() => write(dir, file, '{"beta":true}', "settings", project("/Beta"), async () => {}), /Synchronous authority target guard/);
  assert.equal(await readFile(file, "utf8"), "{}");
  assert.equal(read(dir, A), alpha); assert.notEqual(read(dir, B), beta);
});

test("an affected baseline captured before rename cannot cross publication; unrelated later writes preserve resolved generations", async (t) => {
  const { dir, file } = await fixture(t);
  const a = read(dir, A), rename = fs.renameSync;
  let during;
  fs.renameSync = (from, to) => {
    if (to === file) { assert.equal(read(dir, A), a); during = capture(dir); }
    return rename(from, to);
  };
  syncBuiltinESMExports();
  try { write(dir, file, "{}", "settings", project("/Beta")); }
  finally { fs.renameSync = rename; syncBuiltinESMExports(); }
  assert.equal(read(dir, A), a);
  assert.notEqual(read(dir, B), during(B), "actual effect after the original read must revoke B");
  const b = read(dir, B);
  write(dir, file, "{}", "settings", project("/Gamma"));
  assert.equal(read(dir, B), b, "next publication retains prior resolved generation, no global settle marker");
  assert.equal(read(dir, A), a);
});

test("Alpha chat selecting Beta clamps both, but Gamma and other Chat×Project keys are neutral", async (t) => {
  const { dir } = await fixture(t), selected = { projectRoots: ["/Alpha", "/Beta"], sessionId: "A" };
  const initial = read(dir, selected);
  advance(dir, "settings", project("/Gamma"));
  advance(dir, "grants", [{ kind: "chat-project", sessionId: "B", projectRoot: "/Beta" }]);
  advance(dir, "settings", [{ kind: "chat-project", sessionId: "A", projectRoot: "/Gamma" }]);
  assert.equal(read(dir, selected), initial);
  advance(dir, "settings", project("/Alpha")); assert.notEqual(read(dir, selected), initial);
  const next = read(dir, selected); advance(dir, "settings", project("/Beta")); assert.notEqual(read(dir, selected), next);
  const own = read(dir, selected); advance(dir, "grants", [{ kind: "chat-project", sessionId: "A", projectRoot: "/Beta" }]); assert.notEqual(read(dir, selected), own);
  const global = read(dir, selected); advance(dir, "settings"); assert.notEqual(read(dir, selected), global);
});
test("external equal-byte and change/restore rewrites cannot be laundered by the next unrelated save", async (t) => {
  for (const restore of [false, true]) {
    const { dir, file } = await fixture(t);
    write(dir, file, "{}", "settings", project("/Alpha")); read(dir, A);
    if (restore) await writeFile(file, '{"enabled":false}');
    await writeFile(file, "{}");
    assert.throws(() => read(dir, A), /unaccounted/);
    assert.throws(() => write(dir, file, "{}", "settings", project("/Beta")), /unaccounted/);
  }
});
test("before-await snapshot cannot rebase onto change-and-restore; settings exclude grant self-update", async (t) => {
  const { dir, file } = await fixture(t);
  const captured = capture(dir), original = captured(A);
  write(dir, file, '{"enabled":false}', "settings", project("/Alpha"));
  write(dir, file, "{}", "settings", project("/Alpha"));
  assert.equal(captured(A), original); assert.notEqual(read(dir, A), original);
  const scope = { ...A, domains: ["settings"] }, settings = read(dir, scope);
  advance(dir, "grants", [{ kind: "chat-project", sessionId: "A", projectRoot: "/Alpha" }]);
  assert.equal(read(dir, scope), settings);
});
test("legacy scalar remains v1; relevant equal writes advance scoped generations, omitted scope is global", async (t) => {
  const { dir } = await fixture(t), a = read(dir, A);
  advanceGitWorkflowWriteEpoch(dir, [{ kind: "session", sessionId: "B" }]);
  assert.equal(read(dir, A), a);
  const first = readGitWorkflowWriteEpoch(dir);
  advanceGitWorkflowWriteEpoch(dir, [{ kind: "session", sessionId: "A" }]);
  assert.notEqual(read(dir, A), a); assert.notEqual(readGitWorkflowWriteEpoch(dir), first);
  assert.equal(JSON.parse(await readFile(join(dir, "pi-web", "git-workflow-write-epoch.json"))).version, 1);
  const next = read(dir, A); advanceGitWorkflowWriteEpoch(dir); assert.notEqual(read(dir, A), next);
});
test("sidecar equal-byte rewrites and generation rollback cannot reopen original live observations", async (t) => {
  for (const rollback of [false, true]) {
    const { dir } = await fixture(t); read(dir, A);
    const path = join(dir, "pi-web", "git-scoped-authority-v1.json"), original = await readFile(path);
    if (rollback) advance(dir, "settings", project("/Alpha"));
    await writeFile(path, original);
    assert.throws(() => read(dir, A), /authority/);
    assert.throws(() => advance(dir, "settings", project("/Beta")), /authority/);
  }
});

test("resolved generations survive a fresh process without settlement writes", async (t) => {
  const { dir, file } = await fixture(t);
  write(dir, file, "{}", "settings", project("/Alpha"));
  const before = read(dir, A);
  const source = `import {createJiti} from 'jiti'; const j=createJiti(import.meta.url); const m=await j.import('./lib/git-scoped-authority.ts'); console.log(m.readGitScopedAuthorityRevision(${JSON.stringify(dir)},${JSON.stringify(A)}));`;
  const actual = execFileSync(process.execPath, ["--input-type=module", "-e", source], { cwd: process.cwd(), encoding: "utf8" }).trim();
  assert.equal(actual, before);
});

test("trust ancestry is relevant; siblings are not; corrupt authority storage fails closed", async (t) => {
  const { dir } = await fixture(t), scope = { ...A, trustPaths: ["/parent/Alpha/worktree"] };
  const initial = read(dir, scope);
  advance(dir, "trust", [{ kind: "trust-path", path: "/parent/Beta" }]); assert.equal(read(dir, scope), initial);
  advance(dir, "trust", [{ kind: "trust-path", path: "/parent" }]); assert.notEqual(read(dir, scope), initial);
  await writeFile(join(dir, "pi-web", "git-scoped-authority-v1.json"), '{"version":99}', { mode: 0o600 });
  assert.throws(() => read(dir, scope)); assert.throws(() => advance(dir, "settings", project("/Beta")));
});
