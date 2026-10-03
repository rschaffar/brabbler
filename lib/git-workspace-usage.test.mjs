import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });
const { beginGitWorkspacePlacement, createTrustedWorkspaceUsage, readPersistedWorkspaceSessions } = await jiti.import("./git-workspace-usage.ts");
const known = (entries = []) => ({ known: true, entries });
const empty = () => ({ sessions: known(), terminals: known(), checks: known(), inflight: known() });
const code = (expected) => (error) => error.code === expected;
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-usage-"));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const root = join(dir, "root"), child = join(root, "child"), other = join(dir, "other"), sessions = join(dir, "sessions");
  for (const path of [root, child, other, sessions]) mkdirSync(path);
  return { dir, root, child, other, sessions };
}

test("cleanup lease fences create/move/fork/start markers in both concurrency directions and survives reload", async (t) => {
  const f = fixture(t);
  const usage = createTrustedWorkspaceUsage(empty);
  for (const operation of ["create", "move", "fork", "start", "subagent", "terminal"]) {
    const finish = beginGitWorkspacePlacement(f.child);
    assert.throws(() => usage.acquireLease(f.root), code("inflight"), operation);
    finish(); finish();
    const lease = usage.acquireLease(f.root);
    assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"), operation);
    const reloaded = await createJiti(import.meta.url, { moduleCache: false }).import("./git-workspace-usage.ts");
    assert.throws(() => reloaded.beginGitWorkspacePlacement(f.child), code("leased"));
    const finishOther = reloaded.beginGitWorkspacePlacement(f.other);
    lease.assertUnused();
    finishOther(); lease.release(); lease.release();
  }
  assert.doesNotThrow(() => { const finish = beginGitWorkspacePlacement(f.root); finish(); });
});

test("planned subagent cwd markers precede creation and block a lease once the disposable directory exists", (t) => {
  const f = fixture(t), planned = join(f.other, "planned"), nested = join(planned, "nested");
  const finish = beginGitWorkspacePlacement(nested);
  mkdirSync(planned); mkdirSync(nested);
  assert.throws(() => createTrustedWorkspaceUsage(empty).acquireLease(planned), code("inflight"));
  finish();
  const lease = createTrustedWorkspaceUsage(empty).acquireLease(planned);
  assert.throws(() => beginGitWorkspacePlacement(join(nested, "not-created-yet")), code("leased"));
  lease.release();
});

test("lease is installed BEFORE inventory callbacks, re-reads fresh facts, and never auto-relocates idle chat", (t) => {
  const f = fixture(t);
  let snapshot = empty(), calls = 0;
  const usage = createTrustedWorkspaceUsage(() => {
    calls++;
    assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"));
    return snapshot;
  });
  const lease = usage.acquireLease(f.root);
  snapshot.sessions.entries.push({ id: "idle-persisted-descendant", cwd: f.child });
  assert.throws(() => lease.assertUnused(), code("used"));
  assert.equal(snapshot.sessions.entries[0].cwd, f.child, "no auto move");
  snapshot = empty();
  snapshot.sessions.entries.push({ id: "merely-active-other-root", cwd: f.other });
  snapshot.sessions.entries.push({ id: "known-chat-other-removed-root", cwd: join(f.other, "missing") });
  assert.deepEqual(lease.assertUnused(), { sessions: "known-idle", terminals: "known-idle", checks: "known-stopped" });
  assert.equal(calls, 3);
  lease.release();
});

test("unknown/unreadable/over-budget inventories fail closed and failed acquisition releases its fence", (t) => {
  const f = fixture(t);
  for (const kind of ["sessions", "terminals", "checks", "inflight"]) {
    for (const value of [{ known: false, entries: [] }, { known: true, entries: Array(10_001).fill({}) }, undefined]) {
      const snapshot = empty(); snapshot[kind] = value;
      assert.throws(() => createTrustedWorkspaceUsage(() => snapshot).acquireLease(f.root), code("unknown"));
      const finish = beginGitWorkspacePlacement(f.child); finish();
    }
  }
  assert.throws(() => createTrustedWorkspaceUsage(() => { throw new Error("unreadable"); }).acquireLease(f.root), code("unknown"));
  const snapshot = empty(); snapshot.inflight.entries.push({ cwd: f.child });
  assert.throws(() => createTrustedWorkspaceUsage(() => snapshot).acquireLease(f.root), code("inflight"));
});

test("physical aliases and descendants block, prefix siblings do not, same-path replacement is stale", (t) => {
  const f = fixture(t);
  const alias = join(f.dir, "alias"); symlinkSync(f.root, alias);
  const sibling = join(f.dir, "root-sibling"); mkdirSync(sibling);
  const snapshot = empty(); snapshot.sessions.entries.push({ id: "alias-child", cwd: join(alias, "child") });
  assert.throws(() => createTrustedWorkspaceUsage(() => snapshot).acquireLease(f.root), code("used"));
  assert.throws(() => createTrustedWorkspaceUsage(empty).acquireLease(alias), code("stale"));
  const lease = createTrustedWorkspaceUsage(empty).acquireLease(f.root);
  assert.throws(() => beginGitWorkspacePlacement(join(alias, "child")), code("leased"));
  const finish = beginGitWorkspacePlacement(sibling); finish();
  renameSync(f.root, join(f.dir, "old-root"));
  assert.throws(() => lease.assertUnused(), code("stale"), "absence following rename is not removal proof");
  mkdirSync(f.root); mkdirSync(f.child);
  assert.throws(() => lease.assertUnused(), code("stale"));
  assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"));
  const unknownAlias = join(f.dir, "dangling-alias");
  symlinkSync(join(f.root, "missing"), unknownAlias);
  lease.release();
  const unknown = empty(); unknown.sessions.entries.push({ id: "dangling", cwd: join(unknownAlias, "child") });
  assert.throws(() => createTrustedWorkspaceUsage(() => unknown).acquireLease(f.root), code("unknown"));
  lease.release();
});

function removalFixture(t, parentName = "admins") {
  const f = fixture(t), adminParent = join(f.dir, parentName), adminPath = join(adminParent, "fixture");
  mkdirSync(adminParent); mkdirSync(adminPath);
  const markerPath = join(f.root, ".git"); writeFileSync(markerPath, `gitdir: ${adminPath}\n`);
  const id = (path) => {
    const s = statSync(path, { bigint: true });
    return { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) };
  };
  const marker = statSync(markerPath, { bigint: true });
  const selection = { actionId: "fixture-action", featureOid: "a".repeat(40), adminPath,
    adminIdentity: id(adminPath), markerIdentity: { ...id(markerPath), changed: String(marker.ctimeNs), size: String(marker.size) },
    adminInventoryHash: "b".repeat(64) };
  const proof = { version: 1, actionId: selection.actionId, kind: "removed", sourcePath: f.root, adminPath,
    featureOid: selection.featureOid, exit: 0, sourceAbsent: true, adminAbsent: true,
    before: { checkouts: { [f.root]: id(f.root) }, admins: { fixture: selection.adminInventoryHash } },
    after: { checkouts: {}, admins: {} } };
  const issued = new WeakMap();
  // Fake durable admission issuer, never a structural { durable, proof } reader.
  const seal = (value = proof) => {
    const ack = Object.freeze({ durable: true, proof: value }); issued.set(ack, structuredClone(value)); return ack;
  };
  const remove = () => { unlinkSync(markerPath); rmdirSync(f.child); rmdirSync(f.root); rmdirSync(adminPath); };
  return { ...f, adminPath, markerPath, selection, proof, seal, remove, readIssued: (ack) => issued.get(ack) };
}

test("held lease acknowledges only an issued durable removal after original root/admin/marker removal, through final ref completion", (t) => {
  const f = removalFixture(t);
  let snapshot = empty();
  const lease = createTrustedWorkspaceUsage(() => snapshot, f.readIssued).acquireLease(f.root, undefined, f.selection);
  t.after(() => lease.release());
  const earlyAck = f.seal();
  assert.throws(() => lease.acknowledgeRemoval(earlyAck), code("stale"), "even an issued proof cannot permit early absence");
  lease.assertUnused();
  f.remove();
  assert.throws(() => lease.acknowledgeRemoval(earlyAck), code("stale"), "a premature acknowledgement cannot resurrect later");
  assert.throws(() => lease.assertUnused(), code("stale"), "absence alone never advances the lease");
  assert.throws(() => lease.acknowledgeRemoval({ durable: true, proof: f.proof }), code("stale"), "unissued lookalike is not a seal");
  for (const changed of [
    { ...f.proof, actionId: "other-action" }, { ...f.proof, adminPath: join(f.dir, "other-admin") },
    { ...f.proof, before: { ...f.proof.before, checkouts: { [f.root]: { ...f.proof.before.checkouts[f.root], inode: "0" } } } },
    { ...f.proof, after: f.proof.before },
    { ...f.proof, after: { checkouts: true, admins: {} } },
    { ...f.proof, after: { checkouts: {}, admins: [] } },
  ]) assert.throws(() => lease.acknowledgeRemoval(f.seal(changed)), code("stale"));
  const issuedAck = f.seal();
  lease.acknowledgeRemoval(issuedAck);
  assert.deepEqual(lease.assertUnused(), { sessions: "known-idle", terminals: "known-idle", checks: "known-stopped" });
  assert.throws(() => lease.acknowledgeRemoval(issuedAck), code("stale"), "proof reuse is denied");
  // Independent final-ref verification/completion still happens under this SAME fence.
  assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"));
  snapshot.sessions.entries.push({ id: "idle-descendant", cwd: f.child });
  assert.throws(() => lease.assertUnused(), code("used"));
  snapshot = empty(); snapshot.terminals.known = false;
  assert.throws(() => lease.assertUnused(), code("unknown"));
  snapshot = empty(); snapshot.checks.entries.push({ id: "check", cwd: f.child, stopped: false });
  assert.throws(() => lease.assertUnused(), code("used"));
  snapshot = empty(); snapshot.inflight.entries.push({ cwd: f.child });
  assert.throws(() => lease.assertUnused(), code("inflight"));
  snapshot = empty(); lease.assertUnused();
  let finalRefCompleted = false;
  const completeFakeNativeRef = () => {
    assert.equal(finalRefCompleted, false);
    assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"), "fence spans final-ref settlement");
    lease.assertUnused();
    finalRefCompleted = true;
  };
  completeFakeNativeRef();
  assert.equal(finalRefCompleted, true);
  assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"), "completion itself does not implicitly release");
  lease.release();
  assert.throws(() => lease.acknowledgeRemoval(issuedAck), code("stale"), "released lease cannot acknowledge/reuse proof");
  const finish = beginGitWorkspacePlacement(f.child); finish();
});

test("acknowledged absence keeps replacement/new-placement fences and rejects admin or root reuse", (t) => {
  for (const replaced of ["root", "admin"]) {
    const f = removalFixture(t);
    const lease = createTrustedWorkspaceUsage(empty, f.readIssued).acquireLease(f.root, undefined, f.selection);
    t.after(() => lease.release());
    f.remove(); lease.acknowledgeRemoval(f.seal());
    mkdirSync(replaced === "root" ? f.root : f.adminPath);
    assert.throws(() => lease.assertUnused(), code("stale"));
    assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"));
    lease.release();
  }
});

test("removal acknowledgement rejects renamed original instances and ordinary leases without an issuer", (t) => {
  for (const retained of ["marker", "admin"]) {
    const f = removalFixture(t);
    const lease = createTrustedWorkspaceUsage(empty, f.readIssued).acquireLease(f.root, undefined, f.selection);
    t.after(() => lease.release());
    if (retained === "marker") renameSync(f.markerPath, join(f.other, "retained-marker"));
    else { unlinkSync(f.markerPath); renameSync(f.adminPath, join(f.other, "retained-admin")); }
    rmdirSync(f.child); rmdirSync(f.root);
    if (retained === "marker") rmdirSync(f.adminPath);
    assert.throws(() => lease.acknowledgeRemoval(f.seal()), code("stale"));
    assert.throws(() => lease.assertUnused(), code("stale"));
    lease.release();
  }
  const f = fixture(t), ordinary = createTrustedWorkspaceUsage(empty).acquireLease(f.root);
  t.after(() => ordinary.release());
  rmdirSync(f.child); rmdirSync(f.root);
  assert.throws(() => ordinary.assertUnused(), code("stale"));
  assert.throws(() => ordinary.acknowledgeRemoval({}), code("stale"));
  ordinary.release();
});

// Convenience ONLY for these disposable usage tests, not a cleanup-engine or
// admission implementation. No git commit/build/browser or user repo operation.
function nativeOnlySourceFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-usage-native-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const primary = join(dir, "primary"), source = join(dir, "source");
  const git = (cwd, ...args) => execFileSync("git", ["--no-optional-locks", "-c", "core.hooksPath=/dev/null", "-C", cwd, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: dir, XDG_CONFIG_HOME: dir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  git(dir, "-c", "init.templateDir=", "init", "-q", "-b", "main", primary);
  const common = join(primary, ".git");
  // Deterministic prebuilt empty-history fixture objects. No commit command,
  // signing, hooks, inherited global configuration or credential discovery.
  const object = (type, body) => {
    const data = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]);
    const oid = createHash("sha1").update(data).digest("hex"), folder = join(common, "objects", oid.slice(0, 2));
    mkdirSync(folder, { recursive: true }); writeFileSync(join(folder, oid.slice(2)), deflateSync(data)); return oid;
  };
  const tree = object("tree", Buffer.alloc(0));
  const featureOid = object("commit", Buffer.from(`tree ${tree}\nauthor Fixture <fixture@example.invalid> 1 +0000\ncommitter Fixture <fixture@example.invalid> 1 +0000\n\nFixture\n`));
  for (const branch of ["main", "feature"]) writeFileSync(join(common, "refs", "heads", branch), `${featureOid}\n`);
  git(primary, "worktree", "add", "-q", source, "feature");
  const adminPath = git(source, "rev-parse", "--absolute-git-dir").trim(), adminParent = dirname(adminPath);
  const id = (path) => {
    const s = statSync(path, { bigint: true });
    return { device: String(s.dev), inode: String(s.ino), birthtime: String(s.birthtimeNs) };
  };
  const marker = statSync(join(source, ".git"), { bigint: true });
  const adminHash = createHash("sha256").update(readFileSync(join(adminPath, "HEAD"))).update(readFileSync(join(adminPath, "gitdir"))).digest("hex");
  const selection = { actionId: "native-fixture", featureOid, adminPath, adminIdentity: id(adminPath),
    markerIdentity: { ...id(join(source, ".git")), changed: String(marker.ctimeNs), size: String(marker.size) }, adminInventoryHash: adminHash };
  const before = { checkouts: { [primary]: id(primary), [source]: id(source) }, admins: { [basename(adminPath)]: adminHash },
    registrations: git(primary, "worktree", "list", "--porcelain", "-z"), refs: git(primary, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs") };
  const issued = new WeakMap();
  const removeAndRecord = () => {
    git(primary, "worktree", "remove", "--", source);
    assert.equal(existsSync(source), false); assert.equal(existsSync(adminPath), false);
    assert.equal(existsSync(adminParent), false, "native Git retires its NOWEMPTY worktrees directory");
    const after = { checkouts: { [primary]: id(primary) }, admins: {},
      registrations: git(primary, "worktree", "list", "--porcelain", "-z"), refs: git(primary, "for-each-ref", "--format=%(refname)%00%(objectname)%00%(symref)", "refs") };
    assert.equal(after.refs, before.refs, "worktree removal leaves the feature ref for the native owner");
    assert.equal(after.registrations.includes(source), false);
    const proof = { version: 1, actionId: selection.actionId, kind: "removed", sourcePath: source, adminPath, featureOid,
      exit: 0, sourceAbsent: true, adminAbsent: true, before, after };
    const record = join(dir, "verified-removal.json"); writeFileSync(record, JSON.stringify(proof), { mode: 0o600, flush: true });
    assert.deepEqual(JSON.parse(readFileSync(record, "utf8")), proof);
    const ack = Object.freeze({ durable: true, proof }); issued.set(ack, structuredClone(proof)); return ack;
  };
  return { dir, primary, common, source, adminParent, selection, git, removeAndRecord, readIssued: (ack) => issued.get(ack) };
}

const linuxFixture = { skip: process.platform !== "linux" && "Needs positive Linux descriptor retirement proof" };
test("real lease accepts native removal of the sole linked source/admin parent with target and main PRIMARY, holding through final completion", linuxFixture, (t) => {
  const f = nativeOnlySourceFixture(t);
  let snapshot = empty();
  const lease = createTrustedWorkspaceUsage(() => snapshot, f.readIssued).acquireLease(f.source, undefined, f.selection);
  t.after(() => lease.release());
  assert.throws(() => lease.acknowledgeRemoval({}), code("stale"));
  lease.assertUnused();
  const ack = f.removeAndRecord();
  assert.throws(() => lease.assertUnused(), code("stale"), "absent parent/root needs the issued transition");
  assert.throws(() => lease.acknowledgeRemoval(JSON.parse(JSON.stringify(ack))), code("stale"));
  lease.acknowledgeRemoval(ack);
  assert.deepEqual(lease.assertUnused(), { sessions: "known-idle", terminals: "known-idle", checks: "known-stopped" });
  assert.throws(() => lease.acknowledgeRemoval(ack), code("stale"));
  assert.throws(() => beginGitWorkspacePlacement(join(f.source, "descendant")), code("leased"));
  snapshot.terminals.known = false;
  assert.throws(() => lease.assertUnused(), code("unknown"), "retired parent never makes unknown processes inactive");
  snapshot = empty(); lease.assertUnused();
  assert.equal(f.git(f.primary, "rev-parse", "refs/heads/feature").trim(), f.selection.featureOid, "branch CAS belongs to the native owner");
  assert.throws(() => beginGitWorkspacePlacement(f.source), code("leased"), "same fence spans remaining native ref settlement");
  lease.release();
  const finish = beginGitWorkspacePlacement(f.source); finish();
});

test("native retired-parent proof rejects current empty replacement, common replacement, recreated root and third worktree races", linuxFixture, (t) => {
  for (const phase of ["before-ack", "after-ack"]) for (const race of ["empty-parent", "common", "root", "third"]) {
    const f = nativeOnlySourceFixture(t), lease = createTrustedWorkspaceUsage(empty, f.readIssued).acquireLease(f.source, undefined, f.selection);
    t.after(() => lease.release());
    const ack = f.removeAndRecord();
    if (phase === "after-ack") lease.acknowledgeRemoval(ack);
    if (race === "empty-parent") mkdirSync(f.adminParent);
    else if (race === "common") { renameSync(f.common, join(f.dir, "old-common")); mkdirSync(f.common); }
    else if (race === "root") mkdirSync(f.source);
    else {
      const third = join(f.dir, "third"), finish = beginGitWorkspacePlacement(third);
      try { f.git(f.primary, "worktree", "add", "-q", "--detach", third, "HEAD"); }
      finally { finish(); }
    }
    if (phase === "before-ack") assert.throws(() => lease.acknowledgeRemoval(ack), code("stale"), race);
    assert.throws(() => lease.assertUnused(), code("stale"), `${phase} ${race}`);
    assert.throws(() => beginGitWorkspacePlacement(join(f.source, "child")), code("leased"));
    lease.release();
  }
});

test("missing admin parent is not waived for an unknown role or a wider-than-own changed inventory", (t) => {
  for (const role of ["other-parent", "third-admin"]) {
    const f = removalFixture(t, role === "third-admin" ? "worktrees" : "admins");
    if (role === "third-admin") {
      mkdirSync(join(dirname(f.adminPath), "third"));
      f.proof.before.admins.third = "c".repeat(64);
    }
    const lease = createTrustedWorkspaceUsage(empty, f.readIssued).acquireLease(f.root, undefined, f.selection);
    t.after(() => lease.release());
    f.remove();
    if (role === "third-admin") rmdirSync(join(dirname(f.adminPath), "third"));
    rmdirSync(dirname(f.adminPath));
    assert.throws(() => lease.acknowledgeRemoval(f.seal()), code("stale"));
    assert.throws(() => lease.assertUnused(), code("stale"));
    lease.release();
  }
});

test("acknowledging a retained empty original parent does not authorize its later unrelated disappearance", (t) => {
  const f = removalFixture(t, "worktrees");
  const lease = createTrustedWorkspaceUsage(empty, f.readIssued).acquireLease(f.root, undefined, f.selection);
  t.after(() => lease.release());
  f.remove(); lease.acknowledgeRemoval(f.seal()); lease.assertUnused();
  rmdirSync(dirname(f.adminPath));
  assert.throws(() => lease.assertUnused(), code("stale"));
  assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"));
  lease.release();
});

test("retained parent verifies exact surviving admin instance, not just an unchanged child name", (t) => {
  const f = removalFixture(t, "worktrees"), sibling = join(dirname(f.adminPath), "sibling");
  mkdirSync(sibling);
  f.proof.before.admins.sibling = "c".repeat(64); f.proof.after.admins.sibling = "c".repeat(64);
  const lease = createTrustedWorkspaceUsage(empty, f.readIssued).acquireLease(f.root, undefined, f.selection);
  t.after(() => lease.release());
  f.remove(); lease.acknowledgeRemoval(f.seal()); lease.assertUnused();
  renameSync(sibling, join(f.other, "old-sibling")); mkdirSync(sibling);
  assert.throws(() => lease.assertUnused(), code("stale"));
  assert.throws(() => beginGitWorkspacePlacement(f.child), code("leased"));
  lease.release();
});

test("terminal proof must include trusted current containment, positive exit and surviving-child accounting", (t) => {
  const f = fixture(t);
  const terminal = { id: "fixture-process", known: true, exited: false, survivingChildren: 0, containedCwds: [f.child] };
  let snapshot = empty(); snapshot.terminals.entries.push(terminal);
  const usage = createTrustedWorkspaceUsage(() => snapshot);
  assert.throws(() => usage.acquireLease(f.root), code("used"));
  terminal.exited = true; terminal.survivingChildren = 1;
  assert.throws(() => usage.acquireLease(f.root), code("used"));
  terminal.known = false;
  assert.throws(() => usage.acquireLease(f.root), code("unknown"));
  terminal.known = true; terminal.exited = false; terminal.containedCwds = [];
  assert.throws(() => usage.acquireLease(f.root), code("unknown"));
  terminal.exited = true; terminal.survivingChildren = 0;
  let lease = usage.acquireLease(f.root); lease.release();
  terminal.exited = false; terminal.containedCwds = [f.other];
  lease = usage.acquireLease(f.root); lease.release();
  snapshot = empty(); snapshot.checks.entries.push({ id: "check", cwd: f.child, stopped: false });
  assert.throws(() => usage.acquireLease(f.root), code("used"));
  snapshot.checks.entries[0].stopped = true;
  lease = usage.acquireLease(f.root); lease.release();
});

test("persisted inventory scans every bounded SDK header, not transcripts or a cache; malformed/oversized/missing is unknown", (t) => {
  const f = fixture(t), grouped = join(f.sessions, "--encoded--"); mkdirSync(grouped);
  const file = join(grouped, "idle.jsonl");
  const header = JSON.stringify({ type: "session", version: 3, id: "idle", cwd: f.child });
  writeFileSync(file, `${header}\n${"private transcript must not be parsed".repeat(10000)}`);
  assert.deepEqual(readPersistedWorkspaceSessions(f.sessions), known([{ id: "idle", cwd: f.child }]));
  const snapshot = empty(); snapshot.sessions = readPersistedWorkspaceSessions(f.sessions);
  assert.throws(() => createTrustedWorkspaceUsage(() => snapshot).acquireLease(f.root), code("used"));
  assert.equal(readPersistedWorkspaceSessions(f.sessions, { headerBytes: 5 }).known, false);
  assert.equal(readPersistedWorkspaceSessions(f.sessions, { entries: 1 }).known, false);
  assert.equal(readPersistedWorkspaceSessions(join(f.dir, "missing")).known, false);
  writeFileSync(file, "not a header\n");
  assert.equal(readPersistedWorkspaceSessions(f.sessions).known, false);
  rmSync(file); symlinkSync(join(f.dir, "missing"), file);
  assert.equal(readPersistedWorkspaceSessions(f.sessions).known, false);
});
