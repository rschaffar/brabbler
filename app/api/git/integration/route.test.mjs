import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-web-browser-native-integration-")), agentDir = join(home, "agent");
await mkdir(agentDir, { mode: 0o700 });
const previous = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map(key => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
const verificationShim = join(home, "verification-test.ts"), integrationShim = join(home, "integration-test.ts");
const realVerification = new URL("../../../../lib/git-verification.ts", import.meta.url).pathname;
const realIntegration = new URL("../../../../lib/git-integration.ts", import.meta.url).pathname;
const backendFixture = new URL("../../../../lib/git-check-containment-test-backend.mjs", import.meta.url).pathname;
// Test-only containment protocol simulation, NOT a Linux cgroup proof. Source,
// authority, receipt, invocation and native checkout/ref transactions are real.
await writeFile(verificationShim, `import { runGitVerification as run } from ${JSON.stringify(realVerification)};
import { createTestContainmentBackend } from ${JSON.stringify(backendFixture)};
export * from ${JSON.stringify(realVerification)};
if (!process.env.NODE_TEST_CONTEXT) throw new Error("test only");
const backend = createTestContainmentBackend();
export const runGitVerification = (options: Parameters<typeof run>[0]) => run({ ...options, testContainmentBackend: backend,
  testBeforeReceiptRegistration: async () => { await (globalThis as any).__browserBeforeReceipt?.(options); } });`);
await writeFile(integrationShim, `import { prepareIntegration as merge, prepareFastForwardIntegration as ff,
  confirmIntegration as confirmMerge, confirmFastForwardIntegration as confirmFF, retireGitIntegrationPlan as retire } from ${JSON.stringify(realIntegration)};
export * from ${JSON.stringify(realIntegration)};
if (!process.env.NODE_TEST_CONTEXT) throw new Error("test only");
const options = (value) => ({ ...value, ...((globalThis as any).__browserAfterCheckout ? { afterCheckout: (globalThis as any).__browserAfterCheckout } : {}) });
export const prepareIntegration = (value) => merge(options(value));
export const prepareFastForwardIntegration = (value) => ff(options(value));
export const confirmIntegration = async (...args) => { const r = await confirmMerge(...args); await (globalThis as any).__browserAfterNative?.(r); return r; };
export const confirmFastForwardIntegration = async (...args) => { const r = await confirmFF(...args); await (globalThis as any).__browserAfterNative?.(r); return r; };
export const retireGitIntegrationPlan = (original) => { const known = retire(original); (globalThis as any).__browserOnRetire?.(original, known); return known; };`);
// One native module instance: genuine process-private WeakMaps cannot be copied.
const jiti = createJiti(import.meta.url, { alias: { "@/lib/git-verification": verificationShim, "@/lib/git-integration": integrationShim, "@": process.cwd() }, moduleCache: true });
const { GET, POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../../lib/session-reader.ts");
const { appendSessionGitWorkflow } = await jiti.import("../../../../lib/git-workflow-policy.ts");
const { snapshotManagedSessionGitWorkflow } = await jiti.import("../../../../lib/git-workflow-session.ts");
const { settingsFromLegacyPolicy } = await jiti.import("../../../../lib/git-workflow-settings.ts");
const { readGitAction, subscribeGitActionUpdates } = await jiti.import("../../../../lib/git-action-journal.ts");
const { selectGitProjectResources } = await jiti.import("../../../../lib/git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("../../../../lib/git-project-authorization.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("../../../../lib/git-workflow-settings-store.ts");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args], { encoding: "utf8" })).stdout.trim();
const get = id => GET(new Request(`http://localhost/api/git/integration?sessionId=${encodeURIComponent(id)}`));
const post = (body, signal) => POST(new Request("http://localhost/api/git/integration", { method: "POST", body: JSON.stringify(body), signal }));
const op = (id, operation, extra = {}) => ({ sessionId: id, operation, ...extra });
const confirm = (id, { plan, actionId }) => op(id, "confirm", { planId: plan.planId, approvePlanId: plan.planId, actionId });
const history = id => readGitAction(id, { includeArtifact: true });
const actionFile = (id, name = "record.json") => join(agentDir, "pi-web/git-actions/v1", id, name);
async function ok(response) { assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
after(async () => {
  for (const item of globalThis[Symbol.for("pi-web:human-native-integration:v1")]?.values() ?? []) { clearTimeout(item.timer); item.action.handle?.release(); }
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
});
async function fixture(t, method = "merge") {
  const dir = await mkdtemp(join(home, "repo-")), target = join(dir, "target"), feature = join(dir, "feature");
  await exec("git", ["init", "-qb", "target", target]);
  await git(target, "config", "user.name", "Tester"); await git(target, "config", "user.email", "tester@example.invalid");
  await git(target, "config", "core.autocrlf", "false");
  await writeFile(join(target, "note"), "base\n"); await git(target, "add", "note"); await git(target, "commit", "-qm", "base");
  await git(target, "worktree", "add", "-qb", "feature", feature);
  await writeFile(join(feature, "note"), "feature\n"); await git(feature, "add", "note"); await git(feature, "commit", "-qm", "feature");
  const sm = SessionManager.create(feature);
  sm.appendMessage({ role: "user", content: "review", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "done" }], timestamp: Date.now() });
  const policy = { mode: "worktree", baseBranch: "target", onCreate: "continue", commits: "manual", integration: { targetBranch: "target", method },
    checks: [{ label: "Test check", argv: [process.execPath, "-e", "process.exit(0)"] }] };
  appendSessionGitWorkflow(sm, policy);
  const id = sm.getSessionId(); cacheSessionPath(id, sm.getSessionFile()); allowFileRoot(feature); allowFileRoot(target);
  t.after(() => invalidateSessionPathCache(id));
  return { id, feature, target, policy, sm };
}
async function proposal(f) {
  const result = await ok(await post(op(f.id, "verify", { checkIndexes: f.policy.checks.map((_, i) => i) })));
  return ok(await post(op(f.id, "plan", { receiptIds: result.receipts.map(r => r.id) })));
}

test("actual FF/non-FF human native integration preserves method, exact approval, metadata history and single use", async t => {
  for (const method of ["ff", "merge"]) await t.test(method, async t => {
    const f = await fixture(t, method), before = await ok(await get(f.id));
    assert.deepEqual(before.receipts, []);
    const p = await proposal(f), stored = await history(p.actionId);
    assert.equal(stored.record.state, "awaiting-decision"); assert.equal(stored.candidate.integrationMethod, method);
    assert.equal(stored.candidate.sourceCheckoutRoot, f.feature); assert.equal(stored.candidate.targetCheckoutRoot, f.target);
    assert.doesNotMatch(JSON.stringify(stored), /planId|receiptIds/);
    assert.equal((await post({ ...confirm(f.id, p), approvePlanId: "wrong" })).status, 400);
    const other = await fixture(t); assert.equal((await post(confirm(other.id, p))).status, 409);
    const result = await ok(await post(confirm(f.id, p))), oid = method === "ff" ? p.plan.featureOid : p.plan.mergeOid;
    assert.equal(result.status, "integrated"); assert.equal(result.nativeOutcome.refAcknowledged, true); assert.equal(result.nativeOutcome.indexInstalled, true);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), oid); assert.equal(await readFile(join(f.target, "note"), "utf8"), "feature\n");
    assert.equal(await git(f.target, "show", "-s", "--format=%P", "HEAD"), (method === "ff" ? p.plan.parents : [p.plan.review.targetOid, p.plan.review.featureOid]).join(" "));
    assert.equal((await history(p.actionId)).record.state, "succeeded");
    assert.equal((await post(confirm(f.id, p))).status, 409); assert.equal(existsSync(join(f.target, ".git/index.lock")), false);
  });
});
test("ordinary SDK history is neutral; own saved policy restoration never restores receipt or plan authority", async t => {
  const f = await fixture(t), settings = settingsFromLegacyPolicy(f.policy); snapshotManagedSessionGitWorkflow(f.sm, settings);
  const check = await ok(await post(op(f.id, "verify", { checkIndex: 0 })));
  const manager = SessionManager.open(f.sm.getSessionFile());
  manager.appendMessage({ role: "toolResult", toolCallId: "ordinary", toolName: "read", content: [{ type: "text", text: "progress" }], isError: false, timestamp: Date.now() });
  assert.deepEqual((await ok(await get(f.id))).receipts, [check.receipt]);
  const p = await ok(await post(op(f.id, "plan", { receiptIds: [check.receipt.id] })));
  snapshotManagedSessionGitWorkflow(manager, { ...settings, checks: [{ ...settings.checks[0], label: "changed" }] });
  snapshotManagedSessionGitWorkflow(manager, settings);
  assert.equal((await post(confirm(f.id, p))).status, 409); assert.deepEqual((await ok(await get(f.id))).receipts, []);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
});
test("saved checks and integration Deny independently gate human execution, not read-only review", async t => {
  const f = await fixture(t), selection = await selectGitProjectResources(f.feature);
  const owner = { sessionId: f.id, sessionFile: f.sm.getSessionFile(), sessionCwd: f.feature };
  const set = async (action, decision) => saveProjectAuthorization(selection, owner, "session", action, decision,
    await readProjectAuthorization(selection, owner, agentDir), agentDir);
  await set("checks", "deny"); assert.equal((await post(op(f.id, "verify", { checkIndex: 0 }))).status, 409);
  await set("checks", "inherit"); const p = await proposal(f);
  await set("integration", "deny"); assert.equal((await get(f.id)).status, 200); assert.equal((await post(confirm(f.id, p))).status, 409);
  await set("integration", "inherit"); assert.equal((await post(confirm(f.id, p))).status, 409);
  assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
});
test("stage-disabled remains denial; saved none never waives required checks or exact human approval", async t => {
  const disabled = await fixture(t), settings = settingsFromLegacyPolicy(disabled.policy);
  snapshotManagedSessionGitWorkflow(disabled.sm, { ...settings, checkConfirmation: "disabled" });
  assert.equal((await post(op(disabled.id, "verify", { checkIndex: 0 }))).status, 409);
  const integration = await fixture(t);
  snapshotManagedSessionGitWorkflow(integration.sm, { ...settingsFromLegacyPolicy(integration.policy), integrateConfirmation: "disabled" });
  const checked = await ok(await post(op(integration.id, "verify", { checkIndex: 0 })));
  assert.equal((await post(op(integration.id, "plan", { receiptIds: [checked.receipt.id] }))).status, 409);
  const manual = await fixture(t);
  snapshotManagedSessionGitWorkflow(manual.sm, { ...settingsFromLegacyPolicy(manual.policy), checkConfirmation: "none", integrateConfirmation: "none" });
  assert.notEqual((await post(op(manual.id, "plan", { receiptIds: [] }))).status, 200);
  const p = await proposal(manual);
  assert.equal(await git(manual.target, "rev-parse", "HEAD"), p.plan.review.targetOid, "saved none does not execute a browser proposal");
  assert.equal((await post({ ...confirm(manual.id, p), approvePlanId: "wrong" })).status, 400);
  assert.equal((await post(confirm(manual.id, p))).status, 200);
});

test("payloads cannot supply physical authority, commands, proof, skip flags or native callbacks", async t => {
  const f = await fixture(t);
  for (const [key, value] of Object.entries({ cwd: f.feature, argv: ["true"], env: {}, ownerId: f.id, agentDir, proof: {}, skip: true, nativeAuthority: {}, featureBranch: "feature", targetBranch: "target" })) {
    assert.equal((await post(op(f.id, "verify", { checkIndex: 0, [key]: value }))).status, 400);
  }
  assert.equal((await post(op(f.id, "verify", { checkIndex: 5 }))).status, 409);
  assert.equal((await post(op(f.id, "plan", { receiptIds: ["old-json-token"] }))).status, 409);
  assert.equal((await get("missing")).status, 404);
  appendSessionGitWorkflow(f.sm, null); assert.equal((await get(f.id)).status, 409);
});
test("expired, wrong-session and restored historical previews cannot authorize native effects", async t => {
  const f = await fixture(t), p = await proposal(f), now = Date.now;
  assert.equal((await post({ ...confirm(f.id, p), actionId: undefined })).status, 400);
  let retired;
  globalThis.__browserOnRetire = (original, known) => { retired = { original, known }; };
  Date.now = () => p.expiresAt + 1;
  try { assert.equal((await post(confirm(f.id, p))).status, 409); }
  finally { Date.now = now; delete globalThis.__browserOnRetire; }
  assert.equal(retired?.known, true, "native retirement receives the retained ORIGINAL plan, not its public JSON");
  assert.equal(retired.original.planId, p.plan.planId); assert.notEqual(retired.original, p.plan);
  assert.equal((await post(confirm(f.id, p))).status, 409); assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
});
test("source/target staleness never rebaselines or retries an approved candidate", async t => {
  for (const changed of ["feature", "target"]) await t.test(changed, async t => {
    const f = await fixture(t), p = await proposal(f), originalIndex = await readFile(join(f.target, ".git/index"));
    if (changed === "feature") await writeFile(join(f.feature, "note"), "unreviewed\n");
    else { await writeFile(join(f.target, "other"), "concurrent\n"); await git(f.target, "add", "other"); await git(f.target, "commit", "-qm", "concurrent"); }
    const head = await git(f.target, "rev-parse", "HEAD"), index = await readFile(join(f.target, ".git/index"));
    assert.equal((await post(confirm(f.id, p))).status, 409); assert.equal((await post(confirm(f.id, p))).status, 409);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), head); assert.deepEqual(await readFile(join(f.target, ".git/index")), index);
    if (changed === "feature") assert.deepEqual(index, originalIndex);
    assert.equal(await readFile(join(f.target, "note"), "utf8"), "base\n");
  });
});
test("a genuine native lock rejects the original attempt without clearing the foreign lock or retrying", async t => {
  const other = await fixture(t), second = await proposal(other), lock = join(other.target, ".git/index.lock");
  await writeFile(lock, "foreign native owner");
  assert.equal((await post(confirm(other.id, second))).status, 409);
  assert.equal(await readFile(lock, "utf8"), "foreign native owner");
  await rm(lock); assert.equal((await post(confirm(other.id, second))).status, 409, "no retry or revived approval after contention");
  assert.equal(await git(other.target, "rev-parse", "HEAD"), second.plan.review.targetOid);
});
test("same-candidate concurrent native integrations have one winner, no loser rewrite or retry", async t => {
  for (const method of ["ff", "merge"]) await t.test(method, async t => {
    const f = await fixture(t, method), first = await proposal(f), second = await proposal(f);
    const responses = await Promise.all([first, second].map(p => post(confirm(f.id, p))));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    const winner = responses[0].status === 200 ? first : second, loser = winner === first ? second : first;
    assert.equal(await git(f.target, "rev-parse", "HEAD"), method === "ff" ? winner.plan.featureOid : winner.plan.mergeOid);
    assert.equal(await readFile(join(f.target, "note"), "utf8"), "feature\n"); assert.equal(await git(f.target, "status", "--porcelain"), "");
    assert.equal((await post(confirm(f.id, loser))).status, 409); assert.equal(existsSync(join(f.target, ".git/index.lock")), false);
  });
});
test("a new independent check does not invalidate the earlier successful check or approved plan", async t => {
  const f = await fixture(t), p = await proposal(f);
  const checked = await ok(await post(op(f.id, "verify", { checkIndex: 0 })));
  assert.ok(checked.receipt.id);
  assert.equal((await post(confirm(f.id, p))).status, 200);
});
test("a complete real two-check batch supports separately approved native FF and non-FF integration", async t => {
  for (const method of ["ff", "merge"]) await t.test(method, async t => {
    const f = await fixture(t, method);
    f.policy.checks.push({ label: "Second actual command", argv: [process.execPath, "-e", "process.exit(0)"] });
    appendSessionGitWorkflow(f.sm, f.policy);
    const batch = await ok(await post(op(f.id, "verify", { checkIndexes: [0, 1] })));
    assert.equal(batch.receipts.length, 2); assert.equal(batch.actionIds.length, 2);
    assert.deepEqual(batch.receipts[0].batch, batch.receipts[1].batch);
    assert.deepEqual(batch.receipts[0].batch.checkIndexes, [0, 1]);
    assert.deepEqual((await ok(await get(f.id))).receipts, batch.receipts);
    const ids = batch.receipts.map(r => r.id);
    assert.equal((await post(op(f.id, "plan", { receiptIds: ids.slice(0, 1) }))).status, 409);
    const p = await ok(await post(op(f.id, "plan", { receiptIds: ids })));
    assert.deepEqual(p.plan.receiptIds, ids);
    const result = await ok(await post(confirm(f.id, p)));
    assert.equal(result.status, "integrated"); assert.equal(result.nativeOutcome.refAcknowledged, true);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), method === "ff" ? p.plan.featureOid : p.plan.mergeOid);
  });
});

test("two actual required checks form one browser batch for native FF/non-FF plans, never mixed independent runs", async t => {
  for (const method of ["ff", "merge"]) await t.test(method, async t => {
    const f = await fixture(t, method);
    f.policy.checks.push({ label: "Second real check", argv: [process.execPath, "-e", "process.exit(0)"] });
    appendSessionGitWorkflow(f.sm, f.policy);
    const firstSingle = await ok(await post(op(f.id, "verify", { checkIndex: 0 })));
    const secondSingle = await ok(await post(op(f.id, "verify", { checkIndex: 1 })));
    assert.notEqual(firstSingle.receipt.batch.id, secondSingle.receipt.batch.id);
    assert.equal((await post(op(f.id, "plan", { receiptIds: [firstSingle.receipt.id, secondSingle.receipt.id] }))).status, 409);
    const first = await ok(await post(op(f.id, "verify", { checkIndexes: [0, 1] })));
    assert.equal(first.receipts.length, 2); assert.equal(first.actionIds.length, 2);
    assert.deepEqual(first.receipts[0].batch, first.receipts[1].batch);
    assert.deepEqual(first.receipts[0].batch.checkIndexes, [0, 1]);
    assert.deepEqual(Object.keys(first.receipts[0].batch).sort(), ["checkIndexes", "id"]);
    const ids = first.receipts.map(r => r.id);
    const status = await ok(await get(f.id));
    assert.deepEqual(status.receipts.filter(r => ids.includes(r.id)), first.receipts, "GET preserves original display correlation");
    const second = await ok(await post(op(f.id, "verify", { checkIndexes: [0, 1] })));
    assert.notEqual(first.receipts[0].batch.id, second.receipts[0].batch.id);
    assert.equal((await post(op(f.id, "plan", { receiptIds: [ids[0], second.receipts[1].id] }))).status, 409);
    assert.equal((await post(op(f.id, "plan", { receiptIds: ids.slice(0, 1) }))).status, 409);
    assert.equal((await post(op(f.id, "plan", { receiptIds: ids, batch: first.receipts[0].batch }))).status, 400, "display metadata is not public authority");
    const p = await ok(await post(op(f.id, "plan", { receiptIds: ids })));
    assert.equal((await post(confirm(f.id, p))).status, 200);
    assert.equal(await git(f.target, "rev-parse", "HEAD"), method === "ff" ? p.plan.featureOid : p.plan.mergeOid);
  });
});

test("failed own batch returns no receipts; an independently successful old batch remains server-current without a failure veto", async t => {
  const f = await fixture(t), marker = join(home, `fail-check-${f.id}`);
  f.policy.checks.push({ label: "Conditional fixture check", argv: [process.execPath, "-e",
    `process.exit(require('node:fs').existsSync(${JSON.stringify(marker)}) ? 7 : 0)`] });
  appendSessionGitWorkflow(f.sm, f.policy);
  const passed = await ok(await post(op(f.id, "verify", { checkIndexes: [0, 1] })));
  await writeFile(marker, "fail only the next explicit fixture batch");
  const failed = await post(op(f.id, "verify", { checkIndexes: [0, 1] }));
  assert.equal(failed.status, 409); const body = await failed.json();
  assert.equal(body.receipts, undefined); assert.equal(body.batch, undefined);
  assert.deepEqual((await ok(await get(f.id))).receipts, passed.receipts, "only the failed invocation retires");
  const p = await ok(await post(op(f.id, "plan", { receiptIds: passed.receipts.map(r => r.id) })));
  assert.equal((await post(confirm(f.id, p))).status, 200, "UI fallback prevention must not become a server-wide veto");
});

test("extended recipes including explicit none remain unsupported, without silently dropping required siblings", async t => {
  const f = await fixture(t);
  f.policy.checks.push({ ...f.policy.checks[0], label: "Explicit none", requiredStage: "none" });
  appendSessionGitWorkflow(f.sm, f.policy);
  const response = await post(op(f.id, "verify", { checkIndexes: [0, 1] }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /does not support extended check recipes; no required checks were waived/);
  assert.deepEqual((await ok(await get(f.id))).receipts, []);
});

test("batch siblings share original authority; a failed sibling yields no usable batch, never historical quarantine", async t => {
  const f = await fixture(t); f.policy.checks.push({ label: "fails", argv: [process.execPath, "-e", "process.stderr.write('private output');process.exit(7)"] }); appendSessionGitWorkflow(f.sm, f.policy);
  const response = await post(op(f.id, "verify", { checkIndexes: [0, 1] })); assert.equal(response.status, 409);
  assert.doesNotMatch(await response.text(), /private output|process.exit/); assert.deepEqual((await ok(await get(f.id))).receipts, []);
  const fresh = await ok(await post(op(f.id, "verify", { checkIndex: 0 })));
  assert.equal((await post(op(f.id, "plan", { receiptIds: [fresh.receipt.id] }))).status, 409, "failed required sibling cannot be waived");
});
test("unrelated project updates are neutral during human waiting; own change-and-restore revokes", async t => {
  const f = await fixture(t), p = await proposal(f), doc = readGitWorkflowSettingsDocument(agentDir), root = join(home, "unrelated");
  writeGitWorkflowSettingsDocument({ ...doc, projects: { ...doc.projects, [root]: { commits: "manual" } } }, agentDir, [{ kind: "project", projectRoot: root }]);
  assert.equal((await post(confirm(f.id, p))).status, 200);
  const own = await fixture(t), q = await proposal(own), current = readGitWorkflowSettingsDocument(agentDir);
  writeGitWorkflowSettingsDocument({ ...current, paused: true }, agentDir); writeGitWorkflowSettingsDocument(current, agentDir);
  assert.equal((await post(confirm(own.id, q))).status, 409); assert.equal(await git(own.target, "rev-parse", "HEAD"), q.plan.review.targetOid);
});
test("own authority change-and-restore after diagnostics and before native apply still denies", async t => {
  const f = await fixture(t), p = await proposal(f), document = readGitWorkflowSettingsDocument(agentDir); let injected = false;
  const off = subscribeGitActionUpdates(f.id, async ({ actionId }) => {
    if (actionId === p.actionId && (await history(actionId)).record?.state === "executing" && !injected) {
      injected = true; writeGitWorkflowSettingsDocument({ ...document, paused: true }, agentDir); writeGitWorkflowSettingsDocument(document, agentDir);
    }
  });
  try { assert.equal((await post(confirm(f.id, p))).status, 409); } finally { off(); }
  assert.equal(injected, true); assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
});
test("original check authority revocation at final awaited publication callback yields no receipt, not quarantine", async t => {
  const f = await fixture(t), doc = readGitWorkflowSettingsDocument(agentDir); let injected = false;
  globalThis.__browserBeforeReceipt = async () => { injected = true; writeGitWorkflowSettingsDocument({ ...doc, paused: true }, agentDir); writeGitWorkflowSettingsDocument(doc, agentDir); };
  let response; try { response = await post(op(f.id, "verify", { checkIndex: 0 })); } finally { delete globalThis.__browserBeforeReceipt; }
  assert.equal(injected, true); assert.equal(response.status, 409); assert.deepEqual((await ok(await get(f.id))).receipts, []);
});
test("missing or corrupt diagnostics never erase original approval or native known success", async t => {
  for (const fault of ["candidate", "outcome"]) await t.test(fault, async t => {
    const f = await fixture(t), p = await proposal(f);
    const path = join(agentDir, "git-diagnostics-v2"), backup = path + "-fixture-backup";
    if (fault === "candidate") assert.equal(existsSync(actionFile(p.actionId, "candidate.json")), false, "original live preview does not require a persisted candidate");
    else globalThis.__browserAfterNative = async () => { await rename(path, backup); await writeFile(path, "blocked final diagnostics"); };
    let response; try { response = await post(confirm(f.id, p)); } finally {
      delete globalThis.__browserAfterNative; if (fault === "outcome") { await rm(path); await rename(backup, path); }
    }
    const result = await ok(response); assert.equal(result.status, "integrated"); assert.equal(result.recoveryRequired, undefined);
    if (fault === "outcome") assert.deepEqual(result.diagnostics, { status: "unavailable", reason: "storage-unavailable" });
    else assert.equal(result.diagnostics, undefined, "absence of old-format candidate files is not a v2 recording failure");
    assert.equal(result.nativeOutcome.refAcknowledged, true); assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.mergeOid);
  });
});
test("initial diagnostic creation failure cannot block actual checks, exact process approval or native integration", async t => {
  const f = await fixture(t), path = join(agentDir, "git-diagnostics-v2"), saved = path + "-fixture-backup";
  await mkdir(path, { recursive: true }); await rename(path, saved); await writeFile(path, "disposable unavailable diagnostics");
  try {
    const p = await proposal(f); assert.equal(p.diagnostics.status, "unavailable");
    const result = await ok(await post(confirm(f.id, p))); assert.equal(result.status, "integrated");
    assert.equal(result.nativeOutcome.refAcknowledged, true); assert.equal(result.diagnostics.status, "unavailable");
    assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.mergeOid);
  } finally { await rm(path); await rename(saved, path); }
});

test("corrupt check history is diagnostic only, not success proof or a veto on actual published receipts", async t => {
  const f = await fixture(t); let action;
  const off = subscribeGitActionUpdates(f.id, async ({ actionId }) => {
    if ((await history(actionId)).record?.state === "executing") {
      action = actionId; mkdirSync(join(agentDir, "pi-web/git-actions/v1", actionId), { recursive: true });
      writeFileSync(actionFile(actionId), "corrupt legacy history");
    }
  });
  let response; try { response = await post(op(f.id, "verify", { checkIndex: 0 })); } finally { off(); }
  const result = await ok(response); assert.equal(result.actionId, action); assert.ok(result.receipt.id); assert.equal(result.diagnostics, undefined, "corrupt legacy records are not consulted by v2 diagnostic publication");
  const p = await ok(await post(op(f.id, "plan", { receiptIds: [result.receipt.id] })));
  assert.equal((await post(confirm(f.id, p))).status, 200);
});
test("actual native partial checkout reports checkpoints without rollback, fake no-effect or retry guidance", async t => {
  const f = await fixture(t); globalThis.__browserAfterCheckout = async () => { throw new Error("private post-checkout fault"); };
  let p; try { p = await proposal(f); } finally { delete globalThis.__browserAfterCheckout; }
  const response = await post(confirm(f.id, p)); assert.equal(response.status, 409); const result = await response.json();
  assert.equal(result.status, "partial-state"); assert.equal(result.recoveryRequired, true); assert.equal(result.nativeOutcome.checkoutAttempted, true);
  assert.equal(result.nativeOutcome.refAcknowledged, false); assert.equal(result.nativeOutcome.indexInstalled, false);
  assert.doesNotMatch(JSON.stringify(result), /private post-checkout|refresh|new proposal/);
  assert.equal(await readFile(join(f.target, "note"), "utf8"), "feature\n"); assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.review.targetOid);
  assert.equal(existsSync(join(f.target, ".git/index.lock")), false); assert.equal((await post(confirm(f.id, p))).status, 409);
});
test("unknown lost engine return never claims no effect or invites refresh/retry after actual mutation", async t => {
  const f = await fixture(t), p = await proposal(f);
  globalThis.__browserAfterNative = async () => { throw new Error("private lost return"); };
  let response; try { response = await post(confirm(f.id, p)); } finally { delete globalThis.__browserAfterNative; }
  assert.equal(response.status, 409); const result = await response.json(); assert.equal(result.recoveryRequired, true);
  assert.equal(result.nativeOutcome, undefined); assert.equal(result.intended.mergeOid, p.plan.mergeOid);
  assert.doesNotMatch(JSON.stringify(result), /private lost return|refresh|new proposal/); assert.equal(await git(f.target, "rev-parse", "HEAD"), p.plan.mergeOid);
});
