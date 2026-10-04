import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createJiti } from "jiti";
import { canonical, hash, document, writeLegacyGitActionFixture } from "./git-action-legacy-fixture.mjs";

const jiti = createJiti(import.meta.url);
const { createGitAgentActionArtifactReader, GIT_AGENT_PATCH_CHUNK_BYTES: cap, GIT_AGENT_SESSION_HISTORY_LIMITS: historyLimits } = await jiti.import("./git-agent-action-artifact.ts");
const { createGitAction, transitionGitAction, captureGitActionRecord, releaseGitAction, readGitAction } = await jiti.import("./git-action-journal.ts");
const { openGitDiagnosticStore } = await jiti.import("./git-diagnostic-retention.ts");
const { GIT_ACTION_ANCHOR_TYPE: anchorType } = await jiti.import("./git-action-types.ts");
const from = "a".repeat(40), to = "b".repeat(40), target = "c".repeat(40);

function fixture(t, storage = "v2") {
  const root = fs.mkdtempSync(join(tmpdir(), "pi-agent-artifact-")), repo = join(root, "removed-source"), agentDir = join(root, "agent");
  fs.mkdirSync(agentDir, { mode: 0o700 });
  const manager = SessionManager.create(repo, join(root, "sessions"));
  manager.appendMessage({ role: "user", content: "Persist session", timestamp: 1 });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ready" }], timestamp: 2 });
  assert.equal(fs.existsSync(manager.getSessionFile()), true);
  const ids = [];
  t.after(() => { ids.forEach((id) => releaseGitAction(id, agentDir)); fs.rmSync(root, { recursive: true, force: true }); });
  const candidate = (patch = "+captured\n", overrides = {}) => ({ kind: "review", repositoryRoot: repo,
    featureBranch: "feature/captured", targetBranch: "rst-main", featureOid: from, targetOid: target,
    selection: { kind: "commits", commitOids: [from, to] },
    diff: { fromTreeOid: from, toTreeOid: to, patch, hasBinaryChanges: false }, ...overrides });
  const create = async (snapshot = candidate(), anchor = true, mode = storage) => {
    const input = { sessionId: manager.getSessionId(), source: "agent", candidate: snapshot };
    let record;
    if (mode === "legacy") {
      // Deliberate read-only history, not a production v1 write or native proof.
      const captured = captureGitActionRecord(input);
      record = captured.record;
      writeLegacyGitActionFixture(agentDir, record, captured.candidate);
    } else {
      record = await createGitAction(input, agentDir);
      ids.push(record.id);
      if (mode === "v2") {
        // Cancellation persists the exact candidate without claiming execution.
        record = await transitionGitAction(record.id, record.revision, { state: "cancelled" }, agentDir);
        assert.equal(record.diagnostics, undefined);
        releaseGitAction(record.id, agentDir); // force real retained-artifact I/O
      }
    }
    if (anchor) manager.appendCustomEntry(anchorType, { version: 1, actionId: record.id });
    return record;
  };
  const reader = (overrides = {}) => createGitAgentActionArtifactReader({ sessionManager: manager,
    sessionId: manager.getSessionId(), cwd: manager.getCwd(), authorizeRoot: (cwd) => cwd === repo, agentDir, ...overrides });
  const paths = (id) => storage === "legacy"
    ? { record: join(agentDir, "pi-web/git-actions/v1", id, "record.json"), artifact: join(agentDir, "pi-web/git-actions/v1", id, "candidate.json") }
    : { record: join(agentDir, "git-diagnostics-v2", `${id}.action`), artifact: join(agentDir, "git-diagnostics-v2", `${id}.artifact`) };
  const methods = (overrides = {}) => Object.fromEntries(["getHeader", "getSessionId", "getCwd", "getSessionFile", "isPersisted", "getEntries", "getLeafId"]
    .map((name) => [name, overrides[name] ?? manager[name].bind(manager)]));
  return { root, repo, agentDir, manager, create, candidate, reader, paths, methods };
}

function redacted(result, status) {
  assert.equal(result.status, status);
  assert.deepEqual(Object.keys(result).sort(), ["error", "status"]);
  assert.doesNotMatch(result.error, /removed-source|private|secret|captured\n|ENOENT|candidate.json/);
}

test("requires the actual persisted referring session and a strict raw anchor, not an action ID", async (t) => {
  const f = fixture(t), a = await f.create(), read = f.reader();
  assert.equal((await read({ actionId: a.id, offset: 0 })).status, "ok");
  redacted(await read({ actionId: randomUUID(), offset: 0 }), "denied");
  const unanchored = await f.create(f.candidate(), false);
  redacted(await read({ actionId: unanchored.id, offset: 0 }), "denied");
  const other = SessionManager.create(f.repo, join(f.root, "other-sessions"));
  other.appendMessage({ role: "user", content: "other", timestamp: 2 });
  other.appendMessage({ role: "assistant", content: [{ type: "text", text: "Ready" }], timestamp: 3 });
  redacted(await f.reader({ sessionManager: other, sessionId: other.getSessionId() })({ actionId: a.id, offset: 0 }), "denied");
  for (const overrides of [{ sessionId: "wrong" }, { cwd: "/other" }, { authorizeRoot: () => false },
    { authorizeRoot: () => { throw new Error("secret private path"); } },
    { sessionManager: f.methods({ getSessionId: () => "wrong" }) },
    { sessionManager: f.methods({ getCwd: () => "/wrong" }) },
    { sessionManager: f.methods({ getHeader: () => null }) },
    { sessionManager: f.methods({ getHeader: () => ({ id: f.manager.getSessionId() }) }) },
    { sessionManager: SessionManager.inMemory(f.repo) },
    { sessionManager: f.methods({ isPersisted: () => false }) },
    { sessionManager: f.methods({ getSessionFile: () => undefined }) }]) {
    redacted(await f.reader(overrides)({ actionId: a.id, offset: 0 }), "denied");
  }
  let cwd = f.repo;
  const moving = f.methods({ getCwd: () => cwd });
  redacted(await f.reader({ sessionManager: moving, authorizeRoot: async () => { cwd = "/moved"; return true; } })({ actionId: a.id, offset: 0 }), "denied");
});

test("persisted mode/allocated filenames are insufficient: bootstrap requires the real bounded JSONL header before anchors", async (t) => {
  const f = fixture(t), a = await f.create(), request = { actionId: a.id, offset: 0 };
  const allocated = SessionManager.create(f.repo, join(f.root, "allocated"));
  assert.equal(allocated.isPersisted(), true);
  assert.equal(fs.existsSync(allocated.getSessionFile()), false);
  let anchors = 0;
  const unwritten = {
    getHeader: allocated.getHeader.bind(allocated), getSessionId: allocated.getSessionId.bind(allocated),
    getCwd: allocated.getCwd.bind(allocated), getSessionFile: allocated.getSessionFile.bind(allocated), isPersisted: () => true,
    getLeafId: allocated.getLeafId.bind(allocated), getEntries: () => { anchors++; return f.manager.getEntries(); },
  };
  redacted(await f.reader({ sessionManager: unwritten, sessionId: allocated.getSessionId() })(request), "denied");
  assert.equal(anchors, 0);
  const file = f.manager.getSessionFile(), original = fs.readFileSync(file, "utf8"), header = JSON.parse(original.split("\n")[0]);
  const invalid = ["", "not JSON\n", JSON.stringify({ ...header, id: "wrong" }) + "\n",
    JSON.stringify({ ...header, cwd: "/wrong" }) + "\n", JSON.stringify({ ...header, type: "message" }) + "\n",
    JSON.stringify({ ...header, version: 99 }) + "\n", JSON.stringify({ ...header, secret: true }) + "\n",
    JSON.stringify({ ...header, timestamp: "invalid" }) + "\n", JSON.stringify(header),
    `{"type":"session",${JSON.stringify(header).slice(1)}\n`, "x".repeat(16 * 1024 + 1) + "\n"];
  const manager = f.methods({ getEntries: () => { anchors++; return f.manager.getEntries(); } });
  for (const text of invalid) {
    fs.writeFileSync(file, text);
    redacted(await f.reader({ sessionManager: manager })(request), "denied");
  }
  assert.equal(anchors, 0, "no malformed/unwritten header reaches raw anchor history");
  fs.writeFileSync(file, original);
  const credential = join(f.root, "auth.json"); fs.writeFileSync(credential, "secret credential fixture");
  const reads = t.mock.method(fs, "readSync", () => { throw new Error("Must not read credential format"); });
  redacted(await f.reader({ sessionManager: f.methods({ getSessionFile: () => credential }) })(request), "denied");
  assert.equal(reads.mock.callCount(), 0);
});

test("in-place history tampering between requests cannot reuse cached anchors despite the same header/inode", async (t) => {
  for (const change of ["remove-anchor", "change-action", "extra-anchor-field", "custom-message", "unrelated-entry", "node-id", "parent-id", "message-content", "reorder", "duplicate-id"]) {
    await t.test(change, async (t) => {
      const f = fixture(t), a = await f.create(), file = f.manager.getSessionFile();
      const cached = structuredClone(f.manager.getEntries()), leaf = f.manager.getLeafId();
      const read = f.reader(), request = { actionId: a.id, offset: 0 };
      assert.equal((await read(request)).status, "ok");
      const lines = fs.readFileSync(file, "utf8").trimEnd().split("\n"), header = lines.shift();
      const entries = lines.map((line) => JSON.parse(line)), before = fs.statSync(file, { bigint: true });
      const index = entries.findIndex((entry) => entry.type === "custom" && entry.data?.actionId === a.id);
      if (change === "remove-anchor") entries.splice(index, 1);
      if (change === "change-action") entries[index].data.actionId = randomUUID();
      if (change === "extra-anchor-field") entries[index].data.approved = true;
      if (change === "custom-message") entries[index].type = "custom_message";
      if (change === "unrelated-entry") entries.push({ type: "custom", id: "extra", parentId: leaf,
        timestamp: new Date().toISOString(), customType: "unrelated", data: {} });
      if (change === "node-id") entries[index].id = "different-node";
      if (change === "parent-id") entries[index].parentId = entries[0].id;
      if (change === "message-content") entries[0].message.content = "changed unrelated user content";
      if (change === "reorder") entries.reverse();
      if (change === "duplicate-id") entries.push(entries[index]);
      fs.writeFileSync(file, [header, ...entries.map((entry) => JSON.stringify(entry)), ""].join("\n"));
      const after = fs.statSync(file, { bigint: true });
      assert.equal(after.ino, before.ino); assert.equal(after.dev, before.dev); assert.equal(after.birthtimeNs, before.birthtimeNs);
      assert.equal(fs.readFileSync(file, "utf8").split("\n")[0], header);
      assert.deepEqual(f.manager.getEntries(), cached); assert.equal(f.manager.getLeafId(), leaf, "SDK remains cached/stale");
      redacted(await read(request), "denied");
      redacted(await f.reader()(request), "denied"); // a new bootstrap cannot adopt cached-only references either
    });
  }
});

test("memory-only anchors/partial cached history and unknown, null or off-branch leaves cannot authorize a persisted patch", async (t) => {
  const f = fixture(t), a = await f.create(), request = { actionId: a.id, offset: 0 };
  const entries = f.manager.getEntries(), validLeaf = f.manager.getLeafId();
  for (const getLeafId of [() => null, () => "guessed-leaf", () => entries[0].id, undefined]) {
    const manager = f.methods(); manager.getLeafId = getLeafId;
    redacted(await f.reader({ sessionManager: manager })(request), "denied");
  }
  for (const cached of [entries.slice(1), entries.slice(0, -1), [...entries, { ...entries.at(-1), id: "memory-only" }]]) {
    redacted(await f.reader({ sessionManager: f.methods({ getEntries: () => cached }) })(request), "denied");
  }
  const file = f.manager.getSessionFile(), lines = fs.readFileSync(file, "utf8").trimEnd().split("\n");
  lines.pop(); fs.writeFileSync(file, lines.join("\n") + "\n");
  assert.equal(f.manager.getLeafId(), validLeaf);
  redacted(await f.reader()(request), "denied");
});

test("trusted leaf changes during artifact I/O deny even when all persisted bytes stay identical", async (t) => {
  const f = fixture(t), a = await f.create(), request = { actionId: a.id, offset: 0 };
  const file = f.manager.getSessionFile(), before = fs.readFileSync(file), originalRead = fs.readSync;
  let changed = false;
  t.mock.method(fs, "readSync", (fd, ...args) => {
    if (!changed && fs.readlinkSync(`/proc/self/fd/${fd}`) === f.paths(a.id).artifact) {
      changed = true;
      f.manager.branch(f.manager.getEntries()[0].id);
    }
    return originalRead(fd, ...args);
  });
  redacted(await f.reader()(request), "denied");
  assert.equal(changed, true); assert.deepEqual(fs.readFileSync(file), before);
});

test("full FD hash rejects anchor rewrites during artifact I/O even if observed session stat fingerprints are unchanged", async (t) => {
  const f = fixture(t), a = await f.create(), file = f.manager.getSessionFile(), before = fs.statSync(file, { bigint: true });
  const original = fs.readFileSync(file, "utf8"), actualStat = fs.fstatSync, actualRead = fs.readSync;
  let changed = false;
  t.mock.method(fs, "fstatSync", (fd, options) => {
    const stat = actualStat(fd, options);
    if (options?.bigint && fs.readlinkSync(`/proc/self/fd/${fd}`) === file) {
      stat.size = before.size; stat.mtimeNs = before.mtimeNs; stat.ctimeNs = before.ctimeNs;
    }
    return stat;
  });
  t.mock.method(fs, "readSync", (fd, ...args) => {
    if (!changed && fs.readlinkSync(`/proc/self/fd/${fd}`) === f.paths(a.id).artifact) {
      changed = true;
      fs.writeFileSync(file, original.replace(a.id, randomUUID())); // equal byte count, same inode/header
    }
    return actualRead(fd, ...args);
  });
  redacted(await f.reader()({ actionId: a.id, offset: 0 }), "denied");
  assert.equal(changed, true);
  assert.equal(fs.statSync(file, { bigint: true }).ino, before.ino);
  assert.equal(fs.readFileSync(file, "utf8").split("\n")[0], original.split("\n")[0]);
  assert.equal(f.manager.getEntries().at(-1).data.actionId, a.id);
});

test("bounded current JSONL skips excessive files, entries and nesting rather than authorizing a partial scan", async (t) => {
  const f = fixture(t), a = await f.create(), file = f.manager.getSessionFile(), original = fs.readFileSync(file);
  fs.truncateSync(file, historyLimits.bytes + 1);
  const readCalls = t.mock.method(fs, "readSync", () => { throw new Error("Oversized file must never be read"); });
  redacted(await f.reader()({ actionId: a.id, offset: 0 }), "denied");
  assert.equal(readCalls.mock.callCount(), 0); readCalls.mock.restore();
  fs.writeFileSync(file, original);
  const header = original.toString().split("\n")[0], base = { type: "custom", id: "large", parentId: null,
    timestamp: new Date().toISOString(), customType: "unrelated", data: "x".repeat(historyLimits.entryBytes) };
  fs.writeFileSync(file, `${header}\n${JSON.stringify(base)}\n`);
  redacted(await f.reader()({ actionId: a.id, offset: 0 }), "denied");
  fs.writeFileSync(file, `${header}\n${Array(historyLimits.entries + 1).fill("{}").join("\n")}\n`);
  redacted(await f.reader()({ actionId: a.id, offset: 0 }), "denied");
  let nested = "leaf";
  for (let i = 0; i <= historyLimits.depth; i++) nested = { nested };
  fs.writeFileSync(file, `${header}\n${JSON.stringify({ ...base, data: nested })}\n`);
  redacted(await f.reader()({ actionId: a.id, offset: 0 }), "denied");
  fs.writeFileSync(file, original);
  assert.equal((await f.reader()({ actionId: a.id, offset: 0 })).status, "ok");
});

test("bootstrap pins exact path, parents, device/inode/birthtime and header; identical IDs/cwds cannot transfer the reference", async (t) => {
  for (const change of ["filename", "replacement", "symlink", "parent-symlink", "parent-instance", "missing", "hardlink", "header", "birthtime"]) {
    await t.test(change, async (t) => {
      const f = fixture(t), a = await f.create(), file = f.manager.getSessionFile();
      let selectedFile = file, anchors = 0;
      const manager = f.methods({ getSessionFile: () => selectedFile, getEntries: () => { anchors++; return f.manager.getEntries(); } });
      const read = f.reader({ sessionManager: manager }); // stable proof BEFORE any anchors
      const backup = join(f.root, "saved.jsonl"), sessions = dirname(file);
      if (change === "filename") { fs.copyFileSync(file, backup); selectedFile = backup; }
      if (change === "replacement") { fs.renameSync(file, backup); fs.copyFileSync(backup, file); }
      if (change === "symlink") { fs.renameSync(file, backup); fs.symlinkSync(backup, file); }
      if (change === "parent-symlink") { fs.renameSync(sessions, `${sessions}-old`); fs.symlinkSync(`${sessions}-old`, sessions, "dir"); }
      if (change === "parent-instance") {
        fs.renameSync(sessions, `${sessions}-old`); fs.mkdirSync(sessions);
        fs.renameSync(file.replace(sessions, `${sessions}-old`), file); // SAME leaf inode, different parent
      }
      if (change === "missing") fs.unlinkSync(file);
      if (change === "hardlink") fs.linkSync(file, backup);
      if (change === "header") {
        const text = fs.readFileSync(file, "utf8"), lines = text.split("\n"), header = JSON.parse(lines[0]);
        lines[0] = JSON.stringify({ ...header, timestamp: "2020-01-01T00:00:00.000Z" });
        fs.writeFileSync(file, lines.join("\n")); // same ID/cwd and inode, changed persisted first line
      }
      if (change === "birthtime") {
        const stat = fs.fstatSync;
        t.mock.method(fs, "fstatSync", (fd, options) => {
          const value = stat(fd, options);
          if (options?.bigint && fs.readlinkSync(`/proc/self/fd/${fd}`) === file) value.birthtimeNs += BigInt(1);
          return value;
        });
      }
      redacted(await read({ actionId: a.id, offset: 0 }), "denied");
      assert.equal(anchors, 0);
    });
  }
});

test("session instance/path/header changes during authorization or artifact I/O deny instead of returning captured text", async (t) => {
  for (const stage of ["authorization", "anchors", "artifact"]) for (const change of ["filename", "replacement", "header", "append", "missing"]) {
    await t.test(`${stage}: ${change}`, async (t) => {
      const f = fixture(t), a = await f.create(), file = f.manager.getSessionFile();
      let selectedFile = file, changes = 0;
      const mutate = () => {
        if (changes) return;
        changes++;
        const backup = join(f.root, "changed.jsonl");
        if (change === "filename") { fs.copyFileSync(file, backup); selectedFile = backup; }
        if (change === "replacement") { fs.renameSync(file, backup); fs.copyFileSync(backup, file); }
        if (change === "header") {
          const lines = fs.readFileSync(file, "utf8").split("\n");
          lines[0] = JSON.stringify({ ...JSON.parse(lines[0]), cwd: "/changed" }); fs.writeFileSync(file, lines.join("\n"));
        }
        if (change === "append") fs.appendFileSync(file, "{}\n");
        if (change === "missing") fs.unlinkSync(file);
      };
      const manager = f.methods({ getSessionFile: () => selectedFile, getEntries: () => {
        if (stage === "anchors") mutate();
        return f.manager.getEntries();
      } });
      const read = f.reader({ sessionManager: manager, authorizeRoot: async () => { if (stage === "authorization") mutate(); return true; } });
      if (stage === "artifact") {
        const originalRead = fs.readSync;
        t.mock.method(fs, "readSync", (fd, ...args) => {
          if (fs.readlinkSync(`/proc/self/fd/${fd}`) === f.paths(a.id).artifact) mutate();
          return originalRead(fd, ...args);
        });
      }
      redacted(await read({ actionId: a.id, offset: 0 }), "denied");
      assert.equal(changes, 1);
    });
  }
});

test("held session descriptors survive the read window and close on success, refusal and artifact failure; normal appends between reads remain valid", async (t) => {
  const f = fixture(t), a = await f.create(), open = fs.openSync, close = fs.closeSync, descriptors = new Set();
  t.mock.method(fs, "openSync", (...args) => { const fd = open(...args); descriptors.add(fd); return fd; });
  t.mock.method(fs, "closeSync", (fd) => { const result = close(fd); descriptors.delete(fd); return result; });
  let permit = true;
  const read = f.reader({ authorizeRoot: async () => {
    assert.ok([...descriptors].some((fd) => fs.readlinkSync(`/proc/self/fd/${fd}`) === f.manager.getSessionFile()), "session FD held across authorization await");
    return permit;
  } });
  assert.equal(descriptors.size, 0, "bootstrap captures identity without leaking a lifetime FD");
  assert.equal((await read({ actionId: a.id, offset: 0 })).status, "ok");
  assert.equal(descriptors.size, 0);
  f.manager.appendMessage({ role: "user", content: "ordinary append between reads", timestamp: 10 });
  assert.equal((await read({ actionId: a.id, offset: 0 })).status, "ok");
  assert.equal(descriptors.size, 0);
  permit = false;
  redacted(await read({ actionId: a.id, offset: 0 }), "denied"); assert.equal(descriptors.size, 0);
  permit = true; fs.unlinkSync(f.paths(a.id).artifact);
  redacted(await read({ actionId: a.id, offset: 0 }), "unavailable"); assert.equal(descriptors.size, 0);
});

for (const storage of ["v2", "legacy"]) test(`${storage}: persisted current-branch/compacted raw anchors and fork copies read only captured historical data`, async (t) => {
  const f = fixture(t, storage);
  fs.mkdirSync(f.repo); fs.writeFileSync(join(f.repo, "live"), "unrelated live state");
  const first = f.manager.getLeafId(), a = await f.create();
  const anchorId = f.manager.getLeafId();
  const kept = f.manager.appendMessage({ role: "user", content: "kept after compaction", timestamp: 3 });
  f.manager.appendCompaction("summary does not include the anchor", kept, 100);
  const compactedLeaf = f.manager.getLeafId();
  assert.equal((await f.reader()({ actionId: a.id, offset: 0 })).patch.text, "+captured\n");
  f.manager.branch(first);
  f.manager.appendMessage({ role: "user", content: "sibling without anchor", timestamp: 2 });
  const read = f.reader(), before = fs.readFileSync(f.paths(a.id).record);
  fs.rmSync(f.repo, { recursive: true });
  releaseGitAction(a.id, f.agentDir);
  redacted(await read({ actionId: a.id, offset: 0 }), "denied"); // sibling anchor is not current-branch authority
  f.manager.branch(compactedLeaf); // trusted SDK selection, not a guessed last-entry leaf
  const result = await read({ actionId: a.id, offset: 0 });
  assert.equal(result.patch.text, "+captured\n");
  assert.equal(result.candidate.repositoryRoot, f.repo);
  assert.deepEqual(result.candidate.selection, { kind: "commits", commitOids: [from, to] });
  assert.deepEqual(result.attribution, { actionId: a.id, sessionId: a.sessionId, source: "agent", createdAt: a.createdAt });
  const oldFile = f.manager.getSessionFile();
  f.manager.createBranchedSession(anchorId);
  assert.notEqual(f.manager.getSessionId(), a.sessionId);
  fs.unlinkSync(oldFile);
  redacted(await read({ actionId: a.id, offset: 0 }), "denied"); // stale dispatch identity cannot follow a fork
  const forkRead = f.reader();
  assert.deepEqual(await forkRead({ actionId: a.id, offset: 0 }), result);
  assert.deepEqual(fs.readFileSync(f.paths(a.id).record), before);
  result.candidate.selection.commitOids[0] = target;
  assert.deepEqual((await forkRead({ actionId: a.id, offset: 0 })).candidate.selection.commitOids, [from, to]);
  assert.deepEqual(Object.keys(result).sort(), ["attribution", "candidate", "patch", "status"]);
});

test("malformed, non-plain, extra-field and custom-message anchors deny with redacted errors", async (t) => {
  const f = fixture(t), a = await f.create(), original = f.manager.getEntries().at(-1);
  const data = { version: 1, actionId: a.id };
  const malformed = [null, { ...data, version: 2 }, { ...data, patch: "secret" }, Object.create(data),
    Object.defineProperty({ ...data }, "hidden", { value: true }),
    Object.defineProperty({}, "version", { enumerable: true, get() { throw new Error("secret"); } }),
    { ...data, [Symbol("extra")]: true }];
  for (const value of malformed) {
    redacted(await f.reader({ sessionManager: f.methods({ getEntries: () => [{ ...original, data: value }] }) })({ actionId: a.id, offset: 0 }), "denied");
  }
  for (const entry of [{ ...original, type: "custom_message" }, { ...original, id: "" },
    { ...original, timestamp: "invalid" }, { ...original, receipt: "secret" }, Object.create(original)]) {
    redacted(await f.reader({ sessionManager: f.methods({ getEntries: () => [entry] }) })({ actionId: a.id, offset: 0 }), "denied");
  }
  redacted(await f.reader({ sessionManager: f.methods({ getEntries: () => { throw new Error("private secret"); } }) })({ actionId: a.id, offset: 0 }), "denied");
});

test("strict request fields and byte bounds, including mid-scalar offsets", async (t) => {
  const f = fixture(t), a = await f.create(f.candidate("é😀x")), read = f.reader(), req = { actionId: a.id, offset: 0 };
  for (const extra of ["sessionId", "cwd", "agentDir", "repositoryPath", "filename", "includeArtifact", "receiptId", "grant", "limit"]) {
    redacted(await read({ ...req, [extra]: "secret" }), "invalid-request");
  }
  for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "0", 1, 3, 4, 5, 8]) {
    redacted(await read({ ...req, offset }), "invalid-request");
  }
  for (const limitBytes of [0, 1, 3, -1, 4.5, NaN, Infinity, cap + 1, "4", undefined]) {
    redacted(await read({ ...req, limitBytes }), "invalid-request");
  }
  for (const input of [null, [], {}, Object.create(req), { ...req, actionId: "../file" },
    { ...req, [Symbol("extra")]: 1 }, Object.defineProperty({ ...req }, "secret", { value: 1 }),
    Object.defineProperty({}, "actionId", { enumerable: true, get() { throw new Error("secret"); } })]) {
    redacted(await read(input), "invalid-request");
  }
  const chunk = (await read({ ...req, limitBytes: 4 })).patch;
  assert.equal(chunk.text, "é"); assert.equal(chunk.nextOffset, 2); assert.equal(chunk.completePatch, false);
  assert.equal((await read({ ...req, offset: 2, limitBytes: 4 })).patch.text, "😀");
  const eof = (await read({ ...req, offset: 7 })).patch;
  assert.equal(eof.text, ""); assert.equal(eof.end, true); assert.equal(eof.nextOffset, null); assert.equal(eof.completePatch, false);
});

test("pagination reconstructs and hashes the entire exact Unicode/binary patch with bounded scalar-safe chunks", async (t) => {
  const f = fixture(t);
  for (const patch of ["", "x".repeat(cap), "x".repeat(cap + 1), "a".repeat(cap - 1) + "😀é漢\r\n".repeat(7000),
    "GIT binary patch\nliteral 5\nabc\n"]) {
    const binary = patch.startsWith("GIT binary"), a = await f.create(f.candidate(patch, {
      diff: { fromTreeOid: from, toTreeOid: to, patch, hasBinaryChanges: binary },
    })), read = f.reader();
    let offset = 0, reconstructed = "", count = 0;
    do {
      const result = await read({ actionId: a.id, offset }), p = result.patch;
      assert.equal(result.status, "ok");
      assert.ok(p.returnedBytes <= cap); assert.equal(p.returnedBytes, Buffer.byteLength(p.text));
      assert.equal(Buffer.from(p.text).toString(), p.text);
      assert.equal(p.sha256, hash(patch)); assert.equal(p.totalBytes, Buffer.byteLength(patch));
      assert.equal(p.offset, offset); assert.equal(p.hasBinaryChanges, binary);
      assert.equal(p.fromTreeOid, from); assert.equal(p.toTreeOid, to);
      assert.equal(p.completePatch, offset === 0 && p.end);
      reconstructed += p.text; count++;
      if (p.end) { assert.equal(p.nextOffset, null); break; }
      assert.equal(p.nextOffset, offset + p.returnedBytes); assert.ok(p.nextOffset > offset);
      offset = p.nextOffset;
    } while (count < 100);
    assert.equal(reconstructed, patch);
    assert.equal(hash(reconstructed), hash(patch));
  }
});

test("commit attribution is captured verbatim, with no inferred paths or live outcome authority", async (t) => {
  const f = fixture(t), snapshot = f.candidate("+commit\n", { kind: "commit", message: "Captured message",
    parentOid: from, candidateTreeOid: to, paths: ["literal name.txt", "日本語.txt"] });
  delete snapshot.selection;
  const a = await f.create(snapshot), result = await f.reader()({ actionId: a.id, offset: 0 });
  assert.equal(result.candidate.kind, "commit");
  assert.equal(result.candidate.parentOid, from); assert.equal(result.candidate.candidateTreeOid, to);
  assert.equal(result.candidate.message, "Captured message"); assert.deepEqual(result.candidate.paths, snapshot.paths);
  assert.equal(result.candidate.diff, undefined); assert.equal(result.candidate.checks, undefined);
  for (const key of ["record", "receipt", "grant", "intended", "outcome", "processId", "decision"]) assert.equal(result[key], undefined);
  const noPaths = f.candidate("diff --git a/guessed.txt b/guessed.txt\n+text\n");
  const b = await f.create(noPaths), captured = await f.reader()({ actionId: b.id, offset: 0 });
  assert.equal(captured.candidate.paths, undefined);
  assert.equal(captured.candidate.repositoryRoot, f.repo); // this source never existed
});

test("missing diff reports no captured patch; missing/corrupt/schema-invalid artifacts never fall back or leak diagnostics", async (t) => {
  const f = fixture(t), noDiff = f.candidate(); delete noDiff.diff;
  noDiff.diffUnavailable = "private diagnostic secret";
  const absent = await f.create(noDiff), absentRead = f.reader();
  const noPatch = await absentRead({ actionId: absent.id, offset: 0 });
  assert.equal(noPatch.status, "ok"); assert.equal(noPatch.patch, null);
  assert.doesNotMatch(JSON.stringify(noPatch), /private|secret|diffUnavailable/);
  redacted(await absentRead({ actionId: absent.id, offset: 1 }), "invalid-request");
  for (const corruption of ["missing-record", "missing-artifact", "bad-record", "bad-artifact", "schema", "surrogate"]) await t.test(corruption, async (t) => {
    // Corrupt inventory intentionally suppresses later publication in that store.
    // Isolate each fault so it cannot prevent the next fixture from being captured.
    const f = fixture(t);
    const a = await f.create(f.candidate(corruption === "surrogate" ? "\ud800" : "+captured\n")), paths = f.paths(a.id);
    releaseGitAction(a.id, f.agentDir);
    if (corruption === "missing-record") fs.unlinkSync(paths.record);
    if (corruption === "missing-artifact") fs.unlinkSync(paths.artifact);
    if (corruption === "bad-record") fs.writeFileSync(paths.record, "secret private broken");
    if (corruption === "bad-artifact") fs.writeFileSync(paths.artifact, "secret private broken");
    if (corruption === "schema") {
      const snapshot = f.candidate(); snapshot.diff.receiptId = "secret";
      const bytes = canonical({ version: 1, candidate: snapshot });
      const record = { ...a, artifact: { sha256: hash(bytes), bytes: Buffer.byteLength(bytes) } };
      fs.unlinkSync(paths.artifact); fs.unlinkSync(paths.record);
      const opened = openGitDiagnosticStore(f.agentDir, { application: true, existingOnly: true });
      assert.equal(opened.status, "stored");
      try {
        // Valid v2 envelopes AND matching inner hashes isolate schema rejection.
        assert.equal(opened.store.appendCompletedArtifact(a.id, Buffer.from(bytes)).artifact, "stored");
        assert.equal(opened.store.appendCompletedRecord(a.id, Buffer.from(document(record))).record, "stored");
        assert.equal(opened.store.readCompletedArtifact(a.id).status, "stored");
        assert.equal(opened.store.readCompletedRecord(a.id).status, "stored");
      } finally { opened.store.close(); }
    }
    redacted(await f.reader()({ actionId: a.id, offset: 0 }), "unavailable");
  });
  const a = await f.create();
  fs.unlinkSync(f.paths(a.id).record); fs.unlinkSync(f.paths(a.id).artifact);
  redacted(await f.reader()({ actionId: a.id, offset: 0 }), "unavailable");
  assert.equal(fs.existsSync(f.paths(a.id).record), false);
  assert.equal(fs.existsSync(f.paths(a.id).artifact), false);
  assert.equal(fs.existsSync(join(f.agentDir, "pi-web")), false, "reads never create legacy storage");
});

test("retention expiry never reconstructs a captured patch or creates legacy storage", async (t) => {
  const f = fixture(t), a = await f.create(), read = f.reader(), request = { actionId: a.id, offset: 0 };
  assert.equal((await read(request)).patch.text, "+captured\n");
  const opened = openGitDiagnosticStore(f.agentDir, { application: true, budgets: { artifactBytes: 0 } });
  assert.equal(opened.status, "stored");
  try { assert.equal(opened.store.retain().removed.artifact, 1); }
  finally { opened.store.close(); }
  const history = await readGitAction(a.id, { includeArtifact: true }, f.agentDir);
  assert.deepEqual(history.record, a);
  assert.equal(history.candidate, undefined); assert.match(history.unavailable, /expired/);
  redacted(await read(request), "unavailable");
  assert.equal(fs.existsSync(f.paths(a.id).artifact), false);
  assert.equal(fs.existsSync(join(f.agentDir, "pi-web")), false);
});

test("anchored live candidates remain readable without diagnostics but release cannot revive them", async (t) => {
  const f = fixture(t);
  // Optional storage is unavailable, not a reason to lose a live exact capture.
  fs.writeFileSync(join(f.agentDir, "git-diagnostics-v2"), "not a diagnostic directory");
  const a = await f.create(f.candidate(), true, "live"), request = { actionId: a.id, offset: 0 }, read = f.reader();
  assert.equal(a.diagnostics.reason, "storage-unavailable");
  assert.equal((await read(request)).patch.text, "+captured\n");
  releaseGitAction(a.id, f.agentDir);
  redacted(await read(request), "unavailable");
  assert.equal(fs.existsSync(join(f.agentDir, "pi-web")), false);
});
