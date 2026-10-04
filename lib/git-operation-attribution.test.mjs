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
const { selectGitProjectResources, parseBoundedGitWorktreePaths } = await jiti.import("./git-project-resources.ts");
const { allowFileRoot } = await jiti.import("./file-access.ts");
const { gitActionAttribution } = await jiti.import("./git-action-controller.ts");
const { prepareGitCommit, confirmGitCommit, gitCommitInvocationBinding, captureGitCommitProtectedBoundary,
  readGitCommitProtectedBoundary, readGitCommitNativeCompletion } = await jiti.import("./git-commit.ts");
const { captureGitInvocation, retireGitInvocation } = await jiti.import("./git-invocation.ts");
const { readGitAction } = await jiti.import("./git-action-journal.ts");
const { beginSupervisedGitOperationIntent: begin, readGitOperationInvocationOwner: readOwner } = await jiti.import("./git-operation-admission.ts");
const cwd = fileURLToPath(new URL("..", import.meta.url));
const git = (repo, ...args) => execFileSync("git", ["--no-optional-locks", "-C", repo, ...args],
  { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`
    : JSON.stringify(v);
function init(repo, template) {
  execFileSync("git", ["init", "-qb", "main", `--template=${template}`, repo]);
  git(repo, "config", "user.name", "Tester"); git(repo, "config", "user.email", "test@example.invalid");
  fs.writeFileSync(path.join(repo, "base.txt"), "base\n"); git(repo, "add", "base.txt"); git(repo, "commit", "-qm", "base");
  allowFileRoot(repo);
}
function recordBytes(record) { return canonical({ version: 1, record, sha256: hash(canonical(record)) }); }
async function fixture(t, version = 2, linkedTarget = false) {
  const root = fs.mkdtempSync(path.join(tmpdir(), "pi-web-action-resource-")), agent = path.join(root, "agent");
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
  const a = path.join(root, "a"), b = path.join(root, "b"), template = path.join(root, "template"),
    source = path.join(root, "source"), other = path.join(root, "other");
  fs.mkdirSync(agent, { mode: 0o700 }); fs.mkdirSync(template);
  init(a, template); init(b, template);
  git(a, "worktree", "add", "-qb", "feature", source); git(a, "worktree", "add", "-qb", "other", other);
  allowFileRoot(source); allowFileRoot(other);
  const selected = await selectGitProjectResources(source), target = await selectGitProjectResources(linkedTarget ? other : a);
  const attribution = gitActionAttribution(selected, target);
  const candidate = { kind: "integration", repositoryRoot: source,
    ...(version === 2 ? attribution : version === 1 ? { projectRoot: attribution.projectRoot,
      sourceCheckoutRoot: attribution.sourceCheckoutRoot, targetCheckoutRoot: attribution.targetCheckoutRoot } : {}) };
  // Literal historical bytes, not a retired reservation/proof factory or a live
  // diagnostic publisher. Each test owns its agent namespace and all records.
  const artifact = canonical({ version: 1, candidate });
  const record = { version: 1, id: randomUUID(), sessionId: "historic", source: "agent", kind: "integration",
    state: "executing", revision: 2, createdAt: 1, updatedAt: 2, processId: randomUUID(), decision: "approved",
    summary: candidate, artifact: { sha256: hash(artifact), bytes: Buffer.byteLength(artifact) } };
  const dir = path.join(agent, "pi-web", "git-actions", "v1", record.id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, "record.json"), recordBytes(record), { mode: 0o600 });
  fs.writeFileSync(path.join(dir, "candidate.json"), artifact, { mode: 0o600 });
  git(a, "worktree", "remove", source);
  assert.equal(fs.existsSync(source), false);
  return { root, agent, a, b, source, other, template, selected, target, attribution, candidate, record, dir };
}
function snapshot(dir) {
  const rows = [];
  const visit = (relative) => {
    const file = path.join(dir, relative), stat = fs.lstatSync(file, { bigint: true });
    rows.push([relative, String(stat.dev), String(stat.ino), String(stat.mode), String(stat.mtimeNs), String(stat.ctimeNs),
      stat.isSymbolicLink() ? fs.readlinkSync(file) : stat.isFile() ? hash(fs.readFileSync(file)) : "directory"]);
    if (stat.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(relative, name));
  };
  visit(""); return rows;
}
async function withoutHistoryIO(agent, action) {
  const roots = [path.join(agent, "pi-web", "git-actions"), path.join(agent, "pi-web", "git-operation-admission")];
  const calls = [], restore = [];
  for (const [object, names] of [[fs, ["lstatSync", "statSync", "realpathSync", "openSync", "readFileSync", "readdirSync",
    "opendirSync", "writeFileSync", "unlinkSync", "rmSync", "mkdirSync"]],
  [fs.promises, ["lstat", "stat", "realpath", "open", "readFile", "readdir", "opendir", "writeFile", "unlink", "rm", "mkdir"]]]) {
    for (const name of names) {
      const original = object[name];
      object[name] = function (file, ...args) {
        if (typeof file === "string" && roots.some((root) => file === root || file.startsWith(`${root}${path.sep}`))) {
          calls.push([name, file]); throw new Error("Legacy history is not a lifecycle dependency");
        }
        return original.call(this, file, ...args);
      };
      restore.push(() => { object[name] = original; });
    }
  }
  try { return await action(); }
  finally { for (const undo of restore.reverse()) undo(); assert.deepEqual(calls, [], "no legacy history IO, even swallowed probes"); }
}
async function independentOwners(f, repos) {
  const owners = await Promise.all(repos.map(async (repo) => begin(await selectGitProjectResources(repo), randomUUID(), "commit", f.agent)));
  try { for (const op of owners) { op.assertOwned(); assert.ok(readOwner(op)); } }
  finally { for (const op of owners) op.retire(); }
}

for (const version of [0, 1, 2]) test(`historical ${["unattributed", "path-only", "v2 physical"][version]} evidence is strictly readable, never rehydrated as a live owner`, async (t) => {
  const f = await fixture(t, version), before = snapshot(f.agent);
  const history = await readGitAction(f.record.id, { includeArtifact: true }, f.agent);
  assert.equal(history.unavailable, undefined); assert.equal(history.record.state, "recovery-required");
  assert.deepEqual(history.candidate, f.candidate);
  assert.deepEqual(history.record.summary.resourceAttribution, version === 2 ? f.attribution.resourceAttribution : undefined);
  for (const data of [history.record, history.candidate, f.attribution, history.record.id]) assert.equal(readOwner(data), undefined);
  await withoutHistoryIO(f.agent, () => independentOwners(f, [f.a, f.other, f.b]));
  assert.deepEqual(snapshot(f.agent), before);
});

test("removed historical source cannot mint a physical owner; surviving checkouts remain independent", async (t) => {
  const f = await fixture(t), before = snapshot(f.agent);
  await assert.rejects(begin(f.selected, f.record.id, "commit", f.agent), /outside|unavailable|changed/);
  await withoutHistoryIO(f.agent, () => independentOwners(f, [f.a, f.other, f.b]));
  assert.deepEqual(snapshot(f.agent), before);
});

test("same-path replacement repository revokes the original physical owner, not a newly selected repository", async (t) => {
  const f = await fixture(t), original = await selectGitProjectResources(f.a);
  const op = await begin(original, randomUUID(), "commit", f.agent), before = snapshot(f.agent);
  fs.renameSync(f.a, path.join(f.root, "parked")); init(f.a, f.template);
  assert.equal(readOwner(op), undefined); assert.throws(() => op.assertOwned(), /not active/);
  await assert.rejects(begin(original, randomUUID(), "commit", f.agent), /identity changed/);
  const replacement = await selectGitProjectResources(f.a);
  assert.throws(() => gitActionAttribution(original, replacement), /different captured repository/);
  assert.notDeepEqual(replacement.identities.common, original.identities.common);
  await withoutHistoryIO(f.agent, () => independentOwners(f, [f.a, f.b]));
  op.retire(); assert.deepEqual(snapshot(f.agent), before);
});

test("reused captured target path has a new native identity, never transfers A's attribution to B", async (t) => {
  const f = await fixture(t, 2, true), op = await begin(f.target, randomUUID(), "commit", f.agent), before = snapshot(f.agent);
  git(f.a, "worktree", "remove", f.other); git(f.b, "worktree", "add", "-qb", "target-reuse", f.other);
  assert.equal(readOwner(op), undefined);
  await assert.rejects(begin(f.target, randomUUID(), "commit", f.agent), /identity changed/);
  const current = await selectGitProjectResources(f.other);
  assert.equal(current.projectRoot, f.b);
  assert.throws(() => gitActionAttribution(f.selected, current), /different captured repository/);
  await withoutHistoryIO(f.agent, () => independentOwners(f, [f.a, f.b, f.other]));
  const history = await readGitAction(f.record.id, { includeArtifact: true }, f.agent);
  assert.deepEqual(history.candidate.resourceAttribution, f.attribution.resourceAttribution, "history stays bound to A, not today's B");
  op.retire(); assert.deepEqual(snapshot(f.agent), before);
});

test("path-only history cannot identify a relocated repository or authorize its replacement checkout", async (t) => {
  const f = await fixture(t, 1), before = snapshot(f.agent), old = await selectGitProjectResources(f.a);
  const op = await begin(old, randomUUID(), "commit", f.agent), relocated = path.join(f.root, "relocated");
  fs.renameSync(f.a, relocated); allowFileRoot(relocated); init(f.a, f.template);
  git(f.a, "worktree", "add", "-qb", "replacement-source", f.source);
  assert.equal(readOwner(op), undefined);
  await assert.rejects(begin(f.selected, f.record.id, "commit", f.agent), /identity changed|unavailable/);
  await withoutHistoryIO(f.agent, () => independentOwners(f, [relocated, f.a, f.source, f.b]));
  const history = await readGitAction(f.record.id, { includeArtifact: true }, f.agent);
  assert.equal(history.candidate.resourceAttribution, undefined, "never infer missing instance evidence from current paths");
  assert.equal(readOwner(history.candidate), undefined); op.retire(); assert.deepEqual(snapshot(f.agent), before);
});

test("unregistered or fabricated physical roots refuse without disturbing a valid owner", async (t) => {
  const f = await fixture(t), source = await selectGitProjectResources(f.b), op = await begin(source, randomUUID(), "commit", f.agent);
  const unknown = path.join(f.root, "unknown"); fs.mkdirSync(unknown); allowFileRoot(unknown);
  await assert.rejects(selectGitProjectResources(unknown), /unavailable/);
  await assert.rejects(begin({ ...source, cwd: unknown }, randomUUID(), "commit", f.agent), /unavailable/);
  const forged = structuredClone(source); forged.identities.common.inode = "0";
  await assert.rejects(begin(forged, randomUUID(), "commit", f.agent), /identity changed/);
  assert.equal(readOwner({ ...readOwner(op), selection: forged }), undefined); op.assertOwned(); op.retire();
});

test("new linked checkout reusing a historical source does not revoke a genuine in-flight native commit proof", async (t) => {
  const f = await fixture(t), beforeHistory = snapshot(f.agent);
  fs.writeFileSync(path.join(f.b, "candidate.txt"), "candidate\n");
  const preview = await prepareGitCommit(f.b, ["candidate.txt"]), selection = await selectGitProjectResources(f.b);
  const operation = await begin(selection, randomUUID(), "commit", f.agent), message = "candidate";
  const sessionFile = path.join(f.root, "native-session.jsonl"), sessionId = randomUUID(); fs.writeFileSync(sessionFile, sessionId);
  const live = { revision: 0, owner: Object.freeze({ sessionId, sessionFile, generation: randomUUID() }) };
  const binding = gitCommitInvocationBinding(selection, preview, message, live.owner);
  const invocation = captureGitInvocation(binding, {
    readAuthorityRevisionSync: () => String(live.revision),
    assertCurrentSync(current) {
      assert.deepEqual(current.owner, live.owner); assert.equal(fs.readFileSync(sessionFile, "utf8"), sessionId);
      assert.equal(current.candidateSha256, binding.candidateSha256); operation.assertOwned();
    },
  });
  let result;
  try {
    result = await withoutHistoryIO(f.agent, () => confirmGitCommit(preview, message, async (_, lock) => {
      const proof = captureGitCommitProtectedBoundary(lock, operation, selection, invocation, binding, f.agent);
      assert.ok(readGitCommitProtectedBoundary(proof, selection, f.agent));
      git(f.b, "worktree", "add", "-qb", "late-native-reuse", f.source);
      assert.ok(readGitCommitProtectedBoundary(proof, selection, f.agent));
      return () => { operation.assertOwned(); assert.ok(readGitCommitProtectedBoundary(proof, selection, f.agent)); };
    }, { operation, invocation, binding }));
  } finally { operation.retire(); retireGitInvocation(invocation); }
  assert.equal(result.status, "committed"); assert.equal(git(f.b, "rev-parse", "HEAD"), result.commit);
  assert.equal(readGitCommitNativeCompletion(result, invocation), result);
  assert.equal(readGitCommitNativeCompletion({ ...result }, invocation), undefined);
  assert.equal(fs.existsSync(path.join(selection.gitDir, "index.lock")), false);
  assert.deepEqual(snapshot(f.agent), beforeHistory);
});

for (const damage of ["missing-artifact", "incomplete-summary", "invalid-instance", "unsupported-version", "mismatched-artifact"])
  test(`strict legacy attribution read rejects ${damage}, while lifecycle ignores the untouched diagnostics`, async (t) => {
    const f = await fixture(t);
    if (damage === "missing-artifact") fs.unlinkSync(path.join(f.dir, "candidate.json"));
    else {
      const record = structuredClone(f.record);
      if (damage === "incomplete-summary") delete record.summary.resourceAttribution.commonIdentity;
      if (damage === "invalid-instance") record.summary.resourceAttribution.commonIdentity.inode = "not-an-inode";
      if (damage === "unsupported-version") record.summary.resourceAttribution.version = 99;
      if (damage === "mismatched-artifact") record.summary.resourceAttribution.commonIdentity.inode = "0";
      // Recompute the outer checksum: schema and artifact binding must still
      // reject bad evidence rather than merely noticing corrupted storage.
      fs.writeFileSync(path.join(f.dir, "record.json"), recordBytes(record));
    }
    const before = snapshot(f.agent), history = await readGitAction(f.record.id, { includeArtifact: true }, f.agent);
    assert.match(history.unavailable, /invalid|missing|unsupported|unreadable/);
    assert.equal(history.candidate, undefined);
    if (["incomplete-summary", "invalid-instance", "unsupported-version"].includes(damage)) assert.equal(history.record, null);
    else assert.equal(history.record.state, "recovery-required");
    await withoutHistoryIO(f.agent, () => independentOwners(f, [f.a, f.b]));
    assert.deepEqual(snapshot(f.agent), before);
  });

for (const damaged of ["actions", "version", "inaccessible"]) test(`unavailable legacy ${damaged} is never consulted by physical lifecycle owners`, async (t) => {
  const f = await fixture(t), agent = path.join(f.root, "unavailable-agent");
  const base = path.join(agent, "pi-web", "git-actions");
  fs.mkdirSync(path.dirname(base), { recursive: true, mode: 0o700 });
  if (damaged === "actions") fs.symlinkSync(path.join(f.root, "missing"), base);
  else { fs.mkdirSync(base, { mode: 0o700 }); if (damaged === "version") fs.symlinkSync(path.join(f.root, "missing"), path.join(base, "v1")); }
  const before = snapshot(agent);
  if (damaged === "inaccessible") fs.chmodSync(base, 0o000);
  try {
    // The IO trap makes the negative meaningful even when tests run as root.
    await withoutHistoryIO(agent, () => independentOwners({ ...f, agent }, [f.a, f.b]));
  } finally { if (damaged === "inaccessible") fs.chmodSync(base, 0o700); }
  const after = snapshot(agent);
  // Exempt only the fixture's own chmod timestamps, not metadata on other files.
  const comparable = (rows) => rows.map((row) => damaged === "inaccessible" && row[0] === path.join("pi-web", "git-actions")
    ? row.map((field, i) => i === 4 || i === 5 ? "fixture-chmod" : field) : row);
  assert.deepEqual(comparable(after), comparable(before));
});

test("fresh process cannot adopt historical attribution, but can select its own current physical owner", async (t) => {
  const f = await fixture(t), before = snapshot(f.agent);
  const script = `const {createJiti}=require('jiti'); (async()=>{
    const j=createJiti(process.cwd()+'/lib/git-operation-attribution.test.mjs');
    const {allowFileRoot}=await j.import('./file-access.ts');
    const {selectGitProjectResources}=await j.import('./git-project-resources.ts');
    const {beginSupervisedGitOperationIntent:begin,readGitOperationInvocationOwner:read}=await j.import('./git-operation-admission.ts');
    const {readGitAction}=await j.import('./git-action-journal.ts');
    allowFileRoot(process.argv[1]);
    const history=await readGitAction(process.argv[3],{includeArtifact:true},process.argv[2]);
    if(!history.record || read(history.record)!==undefined || read(history.candidate)!==undefined)throw Error('history became authority');
    const owner=await begin(await selectGitProjectResources(process.argv[1]),history.record.id,'commit',process.argv[2]);
    owner.assertOwned();if(!read(owner))throw Error('own original identity missing');owner.retire();
  })().catch(e=>{console.error(e);process.exitCode=1})`;
  execFileSync(process.execPath, ["-e", script, f.a, f.agent, f.record.id], { cwd, stdio: "pipe" });
  assert.deepEqual(snapshot(f.agent), before);
});

test("physical worktree listing parser retains strict bounded and unambiguous path decoding", () => {
  const oid = "a".repeat(40), row = (cwd) => `worktree ${cwd}\0HEAD ${oid}\0branch refs/heads/main\0\0`;
  const a = path.resolve("/example/a"), b = path.resolve("/example/b");
  assert.deepEqual(parseBoundedGitWorktreePaths(Buffer.from(row(a) + row(b))), [a, b]);
  assert.deepEqual(parseBoundedGitWorktreePaths(Buffer.from(row(a) + row(b).replace("main", "topic-日本語"))), [a, b]);
  for (const bad of [Buffer.from(row(a) + row(a)), Buffer.from(row(a).slice(0, -1)),
    Buffer.from(row(a).replace("HEAD ", "unknown ")),
    Buffer.from(row(a).replace("branch refs/heads/main", "branch refs/heads/main\0branch refs/heads/other")),
    Buffer.from(`worktree ${a}\0HEAD ${oid}\0\0`),
    Buffer.from(Array.from({ length: 257 }, (_, i) => row(path.resolve(`/example/${i}`))).join("")),
    Buffer.alloc(128 * 1024 + 1, 0x78), Buffer.from([0xff, 0x00, 0x00])]) assert.throws(() => parseBoundedGitWorktreePaths(bad));
});
