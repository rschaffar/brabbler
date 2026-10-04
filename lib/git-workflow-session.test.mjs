import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const agentDir = await mkdtemp(join(tmpdir(), "pi-web-fresh-workflow-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const jiti = createJiti(import.meta.url);
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { appendManagedSessionGitWorkflow, snapshotManagedSessionGitWorkflow, snapshotFreshManagedSessionGitWorkflow,
  readManagedSessionGitWorkflow, validateManagedSessionGitWorkflow, hasFreshCommitPolicyProvenance,
  workflowTaskFromEntries, restoreSessionGitWorkflowForRecreation } = await jiti.import("./git-workflow-session.ts");
const { DEFAULT_GIT_WORKFLOW_SETTINGS } = await jiti.import("./git-workflow-settings.ts");
const { GIT_WORKFLOW_TYPE, appendSessionGitWorkflow, readSessionGitWorkflow,
  inheritSessionGitWorkflow } = await jiti.import("./git-workflow-policy.ts");

after(async () => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  await rm(agentDir, { recursive: true, force: true });
});

const settings = (commits = "ask") => ({ ...DEFAULT_GIT_WORKFLOW_SETTINGS, commits });
const create = () => SessionManager.create(agentDir);
const reopen = (manager) => SessionManager.open(manager.getSessionFile(), undefined);
const marker = (manager) => ({ kind: "post-upgrade-create", sessionId: manager.getSessionId() });
const record = (manager) => readManagedSessionGitWorkflow(manager.getEntries());
const proof = (manager, overrides = {}) => hasFreshCommitPolicyProvenance(manager.getEntries(), {
  sessionId: manager.getSessionId(), header: manager.getHeader(),
  persisted: existsSync(manager.getSessionFile()), ...overrides,
});
function persist(manager) {
  manager.appendMessage({ role: "user", content: "fixture task", timestamp: Date.now() });
  manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "ready" }], timestamp: Date.now() });
  assert.equal(existsSync(manager.getSessionFile()), true);
}
function assertTombstone(manager) {
  const entries = manager.getEntries().filter((e) => e.type === "custom" && e.customType === GIT_WORKFLOW_TYPE);
  assert.deepEqual(entries.at(-2).data, { version: 1, policy: null });
  assert.equal(readSessionGitWorkflow(entries.filter((e) => e.data?.version !== 2)), null);
}

test("implicit fresh creation is session-bound, persisted-only and survives reopen without reminting", () => {
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  assert.deepEqual(record(sm).freshCommitPolicyProvenance, marker(sm));
  assert.equal(record(sm).task.settings.commits, "ask", "provenance does not change confirmation");
  assert.equal(proof(sm), false, "SDK disk-backed status is not an actual persisted file");
  persist(sm);
  assert.equal(proof(sm), true);
  const restored = reopen(sm);
  assert.equal(proof(restored), true);
  assert.deepEqual(record(restored), record(sm));
  assert.throws(() => snapshotFreshManagedSessionGitWorkflow(restored, settings()), /genuinely new/);
  assertTombstone(restored);
});

test("fresh snapshots retain pinned Off, Manual and Ask verbatim", () => {
  for (const commits of ["off", "manual", "ask"]) {
    const sm = create();
    snapshotFreshManagedSessionGitWorkflow(sm, settings(commits));
    persist(sm);
    assert.equal(record(reopen(sm)).task.settings.commits, commits);
    assert.equal(proof(reopen(sm)), true, "origin is not an execution grant");
    assert.equal(readSessionGitWorkflow(sm.getEntries()).commits, "manual", "compatibility projection never grants agent commits");
    assertTombstone(sm);
  }
});

test("legacy policies, explicit opt-out, old v2 and task/settings recapture never mint provenance", () => {
  for (const initial of [undefined, null, { mode: "current", onCreate: "stay", commits: "agent" }]) {
    const sm = create();
    if (initial !== undefined) appendSessionGitWorkflow(sm, initial);
    persist(sm);
    assert.equal(proof(reopen(sm)), false);
    const oldTask = workflowTaskFromEntries(sm.getEntries());
    appendManagedSessionGitWorkflow(sm, { commits: "manual" }, oldTask, initial === null);
    assert.deepEqual(record(sm).task, oldTask);
    assert.equal(record(sm).freshCommitPolicyProvenance, undefined);
    assert.throws(() => snapshotFreshManagedSessionGitWorkflow(sm, settings()), /genuinely new/);
    appendManagedSessionGitWorkflow(sm, {}, { kind: "managed", settings: settings() }); // Apply
    snapshotManagedSessionGitWorkflow(sm, settings("manual")); // recapture
    appendManagedSessionGitWorkflow(sm, { enabled: false }, record(sm).task, true);
    appendManagedSessionGitWorkflow(sm, {}, record(sm).task, false);
    assert.equal(record(reopen(sm)).freshCommitPolicyProvenance, undefined);
    assert.equal(proof(reopen(sm)), false);
    assertTombstone(sm);
  }
  const sm = create();
  snapshotManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  assert.equal(proof(reopen(sm)), false, "generic snapshots do not mint even on empty new managers");
});

test("same-session settings writes and task Apply/recapture invalidate creation provenance", () => {
  const writes = [
    (sm, task) => appendManagedSessionGitWorkflow(sm, { commits: "manual" }, task),
    (sm, task) => appendManagedSessionGitWorkflow(sm, {}, task), // equal-value settings save
    (sm) => appendManagedSessionGitWorkflow(sm, {}, { kind: "managed", settings: settings("manual") }), // Apply
    (sm) => snapshotManagedSessionGitWorkflow(sm, settings("off")), // recapture
  ];
  for (const write of writes) {
    const sm = create();
    snapshotFreshManagedSessionGitWorkflow(sm, settings());
    persist(sm);
    const restored = reopen(sm), original = record(restored).task;
    assert.equal(proof(restored), true);
    write(restored, original);
    const disk = reopen(restored);
    assert.equal(record(disk).freshCommitPolicyProvenance, undefined);
    assert.equal(proof(disk), false);
    assert.ok(disk.getEntries().some((e) => e.data?.freshCommitPolicyProvenance?.sessionId === sm.getSessionId()),
      "historical creation marker survives but must not qualify");
    appendManagedSessionGitWorkflow(disk, {}, record(disk).task);
    assert.equal(proof(reopen(disk)), false, "later writes never resurrect the historical marker");
    assertTombstone(disk);
  }
});

test("opt-out then on preserves captured task and tombstone but never restores creation provenance", () => {
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  const original = record(sm).task;
  const restored = reopen(sm);
  for (const optedOut of [true, false]) {
    appendManagedSessionGitWorkflow(restored, {}, original, optedOut);
    const disk = reopen(restored);
    assert.equal(record(disk).freshCommitPolicyProvenance, undefined);
    assert.equal(record(disk).optedOut, optedOut);
    assert.deepEqual(record(disk).task, original);
    assert.equal(proof(disk), false, "on cannot recover the old creation marker");
    assert.deepEqual(readSessionGitWorkflow(disk.getEntries()), optedOut ? null : record(disk).policy);
    assertTombstone(disk);
  }
});

test("unchanged marked SDK clone omits provenance on inheritance despite its raw copied marker", () => {
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  const source = record(sm);
  const copy = SessionManager.open(reopen(sm).createBranchedSession(sm.getLeafId()), undefined);
  assert.deepEqual(record(copy).freshCommitPolicyProvenance, marker(sm), "SDK copies raw custom history");
  assert.equal(proof(copy), false, "copied marker is not bound to the child id");
  inheritSessionGitWorkflow(sm.getEntries(), copy);
  const expected = { ...source };
  delete expected.freshCommitPolicyProvenance;
  assert.deepEqual(record(reopen(copy)), expected);
  assert.equal(proof(reopen(copy)), false);
  assert.equal(proof(reopen(sm)), true, "unchanged source reopen retains original provenance");
  assertTombstone(copy);
});

test("SDK clone/branch and empty fork inherit task, overrides and opt-out but not fresh provenance", () => {
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  appendManagedSessionGitWorkflow(sm, { commits: "manual" }, record(sm).task, true);
  const source = record(sm), entries = sm.getEntries();
  for (const leaf of [sm.getEntries().find((e) => e.type === "message").id, sm.getLeafId()]) {
    const file = reopen(sm).createBranchedSession(leaf);
    const copy = SessionManager.open(file, undefined);
    assert.equal(proof(copy), false, "raw copied provenance never qualifies for a new id");
    inheritSessionGitWorkflow(entries, copy);
    assert.deepEqual(record(copy), { version: source.version, overrides: source.overrides,
      task: source.task, policy: source.policy, optedOut: true });
    assert.equal(proof(copy), false);
    assertTombstone(copy);
  }
  const emptyFork = SessionManager.create(agentDir, undefined, { parentSession: sm.getSessionFile() });
  assert.throws(() => snapshotFreshManagedSessionGitWorkflow(emptyFork, settings()), /genuinely new/);
  inheritSessionGitWorkflow(entries, emptyFork);
  persist(emptyFork);
  assert.equal(record(emptyFork).freshCommitPolicyProvenance, undefined);
  assert.equal(record(emptyFork).optedOut, true);
  assert.equal(proof(emptyFork), false);
  assert.deepEqual(record(sm), source, "source remains unchanged");
});

test("copied raw marker with a different header/session id fails even without a parent header", () => {
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  const copy = create();
  copy.appendCustomEntry(GIT_WORKFLOW_TYPE, record(sm));
  persist(copy);
  assert.equal(proof(reopen(copy)), false);
  assert.equal(hasFreshCommitPolicyProvenance(copy.getEntries(), {
    sessionId: sm.getSessionId(), header: copy.getHeader(), persisted: true,
  }), false, "passing the marker id instead of the current id cannot qualify");
  appendManagedSessionGitWorkflow(copy, {}, record(copy).task);
  assert.equal(record(copy).freshCommitPolicyProvenance, undefined, "recapture cannot rebind a copied marker");
});

test("strict optional marker validation fails closed; latest missing/invalid records never resurrect origin", () => {
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  const valid = record(sm);
  for (const invalid of [null, [], {}, "post-upgrade-create", { kind: "other", sessionId: sm.getSessionId() },
    { kind: "post-upgrade-create", sessionId: "" }, { kind: "post-upgrade-create", sessionId: " spaced " },
    { kind: "post-upgrade-create", sessionId: 123 }, { ...marker(sm), extra: true }]) {
    const bad = { ...valid, freshCommitPolicyProvenance: invalid };
    assert.throws(() => validateManagedSessionGitWorkflow(bad), /provenance/);
    const entries = [...sm.getEntries(), { type: "custom", customType: GIT_WORKFLOW_TYPE, data: bad }];
    assert.equal(hasFreshCommitPolicyProvenance(entries, {
      sessionId: sm.getSessionId(), header: sm.getHeader(), persisted: true,
    }), false);
  }
  const without = { ...valid };
  delete without.freshCommitPolicyProvenance;
  sm.appendCustomEntry(GIT_WORKFLOW_TYPE, without);
  assert.equal(proof(sm), false);
  appendManagedSessionGitWorkflow(sm, {}, valid.task);
  assert.equal(proof(sm), false, "writes cannot restore a superseded marker");
});

test("internal initialized-composer recreation preserves null, legacy, absence and exact managed snapshots without origin", () => {
  const cases = [
    () => {}, // initialized old composer with no workflow
    (sm) => appendSessionGitWorkflow(sm, null),
    (sm) => appendSessionGitWorkflow(sm, { mode: "worktree", baseBranch: "main", onCreate: "fork", commits: "agent" }),
    (sm) => appendManagedSessionGitWorkflow(sm, { commits: "off", enabled: false },
      { kind: "managed", settings: settings("manual") }, true),
    (sm) => snapshotFreshManagedSessionGitWorkflow(sm, settings()),
  ];
  for (const initialize of cases) {
    const source = create();
    initialize(source);
    source.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: [] });
    const expected = record(source);
    if (expected) delete expected.freshCommitPolicyProvenance;
    // Both account and Chat-only tool recreation use this deterministic helper.
    // Repeated recreation must not import defaults into an old missing choice.
    let current = source;
    for (let recreation = 0; recreation < 2; recreation++) {
      const replacement = create();
      restoreSessionGitWorkflowForRecreation(replacement, current.getEntries());
      assert.deepEqual(record(replacement), expected);
      assert.deepEqual(workflowTaskFromEntries(replacement.getEntries()), workflowTaskFromEntries(source.getEntries()));
      assert.deepEqual(readSessionGitWorkflow(replacement.getEntries()), readSessionGitWorkflow(source.getEntries()));
      assert.equal(record(replacement)?.freshCommitPolicyProvenance, undefined);
      if (expected) assertTombstone(replacement);
      persist(replacement);
      assert.equal(proof(reopen(replacement)), false);
      current = replacement;
    }
  }
});

test("same-session raw replay of the original creation v2 can never resurrect eligibility after a workflow write", () => {
  const writes = [
    (sm, task) => appendManagedSessionGitWorkflow(sm, { commits: "manual" }, task),
    (sm) => appendManagedSessionGitWorkflow(sm, {}, { kind: "managed", settings: settings("off") }), // Apply
    (sm, task) => appendManagedSessionGitWorkflow(sm, {}, task, true),
    (sm, task) => {
      appendManagedSessionGitWorkflow(sm, {}, task, true);
      appendManagedSessionGitWorkflow(sm, {}, task, false);
    },
    (sm, task) => appendManagedSessionGitWorkflow(sm, {}, task), // equal-value save
  ];
  for (const write of writes) {
    const sm = create();
    snapshotFreshManagedSessionGitWorkflow(sm, settings());
    persist(sm);
    const original = record(sm);
    assert.equal(proof(sm), true);
    write(sm, original.task);
    assert.equal(proof(reopen(sm)), false);
    sm.appendCustomEntry(GIT_WORKFLOW_TYPE, original);
    assert.deepEqual(record(sm).freshCommitPolicyProvenance, marker(sm), "raw replay really restores latest marked bytes");
    assert.equal(proof(reopen(sm)), false, "eligibility depends on original creation, not latest marker");
  }
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  sm.appendCustomEntry(GIT_WORKFLOW_TYPE, record(sm));
  assert.equal(proof(reopen(sm)), false, "even a duplicate marked v2 alone is a subsequent workflow write");
});

test("strict startup order intentionally refuses benign pre-start metadata", () => {
  const metadata = [
    (sm) => sm.appendCustomEntry("pi-web:provider-accounts", { version: 1, accounts: {} }),
    (sm) => sm.appendCustomEntry("pi-web:tool-selection", { version: 1, tools: [] }),
    (sm) => sm.appendSessionInfo("initialized composer"),
    (sm) => sm.appendModelChange("fixture", "fixture-model"),
  ];
  for (const append of metadata) {
    const sm = create();
    append(sm);
    assert.throws(() => snapshotFreshManagedSessionGitWorkflow(sm, settings()), /genuinely new/);
    assert.equal(record(sm), undefined, "refusal writes neither tombstone nor provenance");
  }
});

test("subagent metadata and persisted header-only reopen cannot acquire ordinary fresh provenance", async () => {
  const sm = create();
  snapshotFreshManagedSessionGitWorkflow(sm, settings());
  persist(sm);
  sm.appendCustomEntry("pi-web:subagent", { version: 1 });
  assert.equal(proof(sm), false);
  appendManagedSessionGitWorkflow(sm, {}, record(sm).task);
  assert.equal(record(sm).freshCommitPolicyProvenance, undefined);
  const subagent = create();
  subagent.appendCustomEntry("pi-web:subagent", { version: 1 });
  assert.throws(() => snapshotFreshManagedSessionGitWorkflow(subagent, settings()), /genuinely new/);
  const empty = create();
  await writeFile(empty.getSessionFile(), JSON.stringify(empty.getHeader()) + "\n");
  assert.throws(() => snapshotFreshManagedSessionGitWorkflow(reopen(empty), settings()), /genuinely new/);
  assert.equal(proof(reopen(empty)), false);
});
