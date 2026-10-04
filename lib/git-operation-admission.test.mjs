import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const api = await jiti.import("./git-operation-admission.ts");
const { beginSupervisedGitOperationIntent: begin, readGitOperationInvocationOwner: readOwner,
  revalidateGitCommitAdmission: revalidate } = api;
const { selectGitProjectResources } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const sha = (value) => createHash("sha256").update(value).digest("hex");
function git(cwd, ...args) {
  return execFileSync("git", ["--no-optional-locks", "-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function fixture(t, linked = false) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "pi-commit-owner-")), repo = path.join(root, "repo");
  const agent = path.join(root, "agent"), template = path.join(root, "template");
  const environment = { HOME: root, USERPROFILE: root, XDG_CONFIG_HOME: path.join(root, "config"),
    GIT_CONFIG_GLOBAL: path.join(root, "no-global"), GIT_CONFIG_NOSYSTEM: "1", PI_CODING_AGENT_DIR: agent };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
  Object.assign(process.env, environment);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(template);
  execFileSync("git", ["init", "-qb", "main", `--template=${template}`, repo]);
  git(repo, "config", "user.name", "Fixture"); git(repo, "config", "user.email", "fixture@example.invalid");
  fs.writeFileSync(path.join(repo, "file"), "base\n"); git(repo, "add", "file"); git(repo, "commit", "-qm", "base");
  let cwd = repo;
  if (linked) { cwd = path.join(root, "linked"); git(repo, "worktree", "add", "-qb", "feature", cwd); }
  allowFileRoot(repo); allowFileRoot(cwd);
  const selection = await selectGitProjectResources(cwd);
  return { root, repo, cwd, agent, selection, start: (actionId = randomUUID(), agentDir = agent) => begin(selection, actionId, "commit", agentDir) };
}
function diagnosticsSnapshot(dir) {
  const rows = [];
  const visit = (relative) => {
    const file = path.join(dir, relative), s = fs.lstatSync(file, { bigint: true });
    rows.push([relative, String(s.dev), String(s.ino), String(s.birthtimeNs), String(s.mtimeNs), String(s.ctimeNs), String(s.mode),
      s.isSymbolicLink() ? fs.readlinkSync(file) : s.isFile() ? sha(fs.readFileSync(file)) : "directory"]);
    if (s.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
  };
  visit(""); return rows;
}

// Removed ledger tests asserted an obsolete quarantine/settlement protocol.
// Their native safety equivalents are exercised by git-commit(.test),
// git-commit-verification(.test), git-workspace-operation(.test),
// git-cleanup-operation(.test) and independent verification/containment suites.
// These tests deliberately do not recreate the old proof factory to seed state.
test("only the live commit lifecycle API remains; no retired ledger/proof/clear exports", () => {
  assert.deepEqual(Object.keys(api).filter((name) => name !== "default").sort(),
    ["beginSupervisedGitOperationIntent", "readGitOperationInvocationOwner", "revalidateGitCommitAdmission"].sort());
});

test("same repository and same diagnostic action ID admit independent original owners without disk state", async (t) => {
  const f = await fixture(t), actionId = randomUUID();
  const [a, b] = await Promise.all([f.start(actionId), f.start(actionId)]);
  assert.notEqual(a, b); assert.notEqual(a.id, b.id); assert.equal(a.actionId, b.actionId);
  for (const op of [a, b]) {
    op.assertOwned(); assert.equal(readOwner(op).kind, "commit");
    assert.equal(Object.hasOwn(op, "resolve"), false); assert.equal(Object.hasOwn(op, "recordNativeEvidence"), false);
  }
  a.retire(); b.assertOwned(); assert.equal(readOwner(a), undefined); b.retire();
  assert.equal(fs.existsSync(f.agent), false, "even the agent directory is not created");
});

test("invalid, oversized, unfinished and symlinked historical files are inert and never rewritten or cleared", async (t) => {
  const f = await fixture(t), common = f.selection.commonDir;
  const ledger = path.join(f.agent, "pi-web", "git-operation-admission", "v1", sha(common));
  fs.mkdirSync(path.join(ledger, "reservation"), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(ledger, "reservation", "owner"), "stranded previous process", { mode: 0o600 });
  const record = { version: 1, id: randomUUID(), actionId: randomUUID(), kind: "commit", resource: common,
    phase: "intent", createdAt: 1 };
  fs.writeFileSync(path.join(ledger, `${record.id}.json`), JSON.stringify({ version: 1, record, sha256: sha(JSON.stringify(record)) }), { mode: 0o600 });
  fs.writeFileSync(path.join(ledger, `${randomUUID()}.json`), "invalid legacy bytes", { mode: 0o600 });
  fs.writeFileSync(path.join(ledger, `${randomUUID()}.post`), Buffer.alloc(2 * 1024 * 1024 + 1), { mode: 0o600 });
  fs.symlinkSync("unreadable-previous-proof", path.join(ledger, `${randomUUID()}.completed`));
  const history = path.join(f.agent, "pi-web", "git-actions", "v1", randomUUID());
  fs.mkdirSync(history, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(history, "record.json"), "failed/uncertain unparseable old history", { mode: 0o600 });
  const before = diagnosticsSnapshot(f.agent);
  const a = await f.start(record.actionId), b = await f.start();
  await revalidate(f.selection); a.assertOwned(); b.assertOwned(); a.retire(); b.assertOwned(); b.retire();
  const c = await f.start(); c.assertOwned(); c.retire();
  assert.deepEqual(diagnosticsSnapshot(f.agent), before, "no migration, pruning, completion or clearing of private files");
});

test("diagnostic path absence or a non-directory never grants or prevents lifecycle identity", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(f.agent, "diagnostics unavailable");
  const op = await f.start(); op.assertOwned(); op.retire();
  assert.equal(fs.readFileSync(f.agent, "utf8"), "diagnostics unavailable");
});

test("copies, JSON, IDs, owner DTOs and borrowed methods cannot authenticate an owner", async (t) => {
  const f = await fixture(t), op = await f.start(), owner = readOwner(op);
  assert.ok(owner); assert.equal(readOwner(op), owner);
  let inspected = false;
  const structural = { get assertOwned() { inspected = true; throw new Error("must not inspect structural methods"); } };
  for (const fake of [{ ...op }, JSON.parse(JSON.stringify(op)), owner, owner.id, owner.actionId, null, structural])
    assert.equal(readOwner(fake), undefined);
  assert.equal(inspected, false);
  assert.throws(() => op.assertOwned.call({ ...op }), /not active/);
  assert.throws(() => op.retire.call({ ...op }), /Unknown/);
  const detached = op.assertOwned; assert.throws(() => detached(), /not active/);
  assert.throws(() => { op.assertOwned = () => {}; }, TypeError);
  op.assertOwned(); op.retire(); op.retire();
  assert.equal(readOwner(op), undefined); assert.throws(() => op.assertOwned(), /not active/);
});

test("selection is copied before awaits and original owner data is recursively frozen", async (t) => {
  const f = await fixture(t), input = structuredClone(f.selection), expected = structuredClone(f.selection);
  const pending = begin(input, randomUUID(), "commit", f.agent);
  input.cwd = path.join(f.root, "foreign"); input.identities.common.inode = "0";
  const op = await pending, owner = readOwner(op);
  assert.deepEqual(owner.selection, expected); assert.equal(Object.isFrozen(owner), true);
  assert.equal(Object.isFrozen(owner.selection.identities.marker), true);
  assert.throws(() => { owner.selection.identities.common.inode = "0"; }, TypeError);
  op.assertOwned(); op.retire();
});

test("noncommit kinds and invalid diagnostic IDs cannot start a fake reservation or journal", async (t) => {
  const f = await fixture(t);
  for (const kind of ["checks", "integration", "prepare", "workspace", "cleanup", "review", "unknown", undefined])
    await assert.rejects(begin(f.selection, randomUUID(), kind, f.agent), /Only commit/);
  for (const id of ["../escape", "", undefined, null, {}])
    await assert.rejects(begin(f.selection, id, "commit", f.agent), /Invalid Git action identity/);
  assert.equal(fs.existsSync(f.agent), false);
});

test("same-path common directory replacement irreversibly retires only the observed owner", async (t) => {
  const f = await fixture(t), op = await f.start(), original = `${f.selection.commonDir}.original`;
  fs.renameSync(f.selection.commonDir, original); fs.mkdirSync(f.selection.commonDir);
  assert.equal(readOwner(op), undefined);
  fs.rmdirSync(f.selection.commonDir); fs.renameSync(original, f.selection.commonDir);
  assert.equal(readOwner(op), undefined); assert.throws(() => op.assertOwned(), /not active/);
  const fresh = await f.start(); fresh.assertOwned(); fresh.retire(); op.retire();
});

for (const replacement of ["ordinary-copy", "symlink"]) test(`linked marker ${replacement} cannot authenticate an original owner`, async (t) => {
  const f = await fixture(t, true), op = await f.start(), marker = path.join(f.cwd, ".git"), saved = `${marker}.original`;
  const bytes = fs.readFileSync(marker); fs.renameSync(marker, saved);
  if (replacement === "ordinary-copy") fs.writeFileSync(marker, bytes);
  else fs.symlinkSync(saved, marker);
  assert.equal(readOwner(op), undefined);
  fs.unlinkSync(marker); fs.renameSync(saved, marker);
  assert.equal(readOwner(op), undefined); op.retire();
  await assert.rejects(f.start(), /identity changed/, "restored marker metadata still revokes the old selection");
  const fresh = await begin(await selectGitProjectResources(f.cwd), randomUUID(), "commit", f.agent);
  fresh.assertOwned(); fresh.retire();
});

test("a fresh process cannot rehydrate either serialized lifecycle handle or owner DTO", async (t) => {
  const f = await fixture(t), op = await f.start();
  const script = `const {createJiti}=require('jiti');
    (async()=>{const api=await createJiti(${JSON.stringify(import.meta.url)}).import('./git-operation-admission.ts');
      const values=JSON.parse(process.argv[1]);
      process.stdout.write(JSON.stringify(values.map(value=>api.readGitOperationInvocationOwner(value)===undefined)));
    })().catch(error=>{console.error(error);process.exitCode=1;});`;
  const result = execFileSync(process.execPath, ["-e", script, JSON.stringify([op, readOwner(op)])],
    { encoding: "utf8", cwd: path.dirname(fileURLToPath(import.meta.url)) });
  assert.deepEqual(JSON.parse(result), [true, true]); op.assertOwned(); op.retire();
});

test("physical selection revalidation still refuses source/branch drift, never acts as a clear-admission stub", async (t) => {
  const f = await fixture(t);
  await revalidate(f.selection);
  git(f.cwd, "switch", "-qc", "changed");
  await assert.rejects(revalidate(f.selection), /identity changed/);
  await assert.rejects(f.start(), /identity changed/);
  assert.equal(fs.existsSync(f.agent), false);
});
