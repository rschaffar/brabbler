import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "jiti";

const home = await mkdtemp(join(tmpdir(), "pi-web-commit-check-route-"));
let agentDir = join(home, "agent"); await mkdir(agentDir, { mode: 0o700 });
const previous = Object.fromEntries(["HOME", "XDG_CONFIG_HOME", "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
Object.assign(process.env, { HOME: home, XDG_CONFIG_HOME: join(home, ".config"), PI_CODING_AGENT_DIR: agentDir });
// Only containment is simulated, never native source/policy/receipt validation.
const shim = join(home, "checkout-verification-test.ts");
const real = new URL("../../../../lib/git-checkout-verification.ts", import.meta.url).pathname;
await writeFile(shim, `import { runGitCheckoutVerification as run } from ${JSON.stringify(real)};
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
export * from ${JSON.stringify(real)};
if (!process.env.NODE_TEST_CONTEXT) throw new Error("node:test-only containment simulation");
// Protocol simulation, NOT an OS cgroup proof. Unlike the old UUID-only fake,
// identity observations measure the original physical fixture directory and
// waiting launcher /proc instance. Native callback facts are never rewritten.
const units = new Map(), stopped = new Set();
const launcher = "let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{try{const p=JSON.parse(input),c=require('node:child_process').spawn(p.argv[0],p.argv.slice(1),{env:p.env,shell:false,stdio:['ignore','inherit','inherit']});c.on('error',()=>process.exit(125));c.on('close',code=>process.exit(code??125));}catch{process.exit(125)}})";
const backend = {
  async absent(name) { return !units.has(name); },
  start(options) {
    const directory = mkdtempSync(join(${JSON.stringify(home)}, "simulated-unit-"));
    const inode = statSync(directory, { bigint: true }), invocation = randomUUID().replaceAll("-", "");
    const child = spawn(process.execPath, ["-e", launcher], { cwd: options.workingDirectory, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const state = { directory, invocation, identity: String(inode.dev) + ":" + String(inode.ino) + ":" + invocation + ":" + directory,
      child, done: false, code: null, launcherIdentity: undefined, output() {} };
    units.set(options.unit, state);
    child.stdout.on("data", data => state.output(data)); child.stderr.on("data", data => state.output(data));
    child.on("error", () => { state.code = 125; state.done = true; });
    child.on("close", code => { state.code = code ?? 125; state.done = true; });
    return { started: new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }),
      release(payload) { child.stdin.end(payload); }, closeInput() { if (!child.stdin.writableEnded) child.stdin.end(); },
      dispose() {}, output(callback) { state.output = callback; } };
  },
  async observe(name) {
    const s = units.get(name); if (!s) throw new Error("unit absent");
    if (!s.done) {
      const proc = statSync("/proc/" + s.child.pid, { bigint: true });
      const raw = readFileSync("/proc/" + s.child.pid + "/stat", "utf8"), fields = raw.slice(raw.lastIndexOf(")") + 2).trim().split(/\\s+/);
      const identity = s.child.pid + ":" + proc.dev + ":" + proc.ino + ":" + fields[19];
      if (s.launcherIdentity && s.launcherIdentity !== identity) throw new Error("original launcher changed");
      s.launcherIdentity = identity;
    }
    return { identity: s.identity, populated: !s.done, launcherPlaced: !s.done, launcherIdentity: s.launcherIdentity,
      unit: { Id: name, LoadState: "loaded", ControlGroup: s.directory, MainPID: s.done ? "0" : String(s.child.pid),
        ActiveState: "active", SubState: s.done ? "exited" : "running", Result: "success", ExecMainCode: "1", ExecMainStatus: String(s.code ?? 0),
        Delegate: "no", KillMode: "control-group", RemainAfterExit: "yes", Restart: "no", InvocationID: s.invocation } };
  },
  assertLauncherCwd(name, observation, expected) {
    const s = units.get(name); if (!s || observation.launcherIdentity !== s.launcherIdentity || observation.unit.InvocationID !== s.invocation) throw new Error("original launcher changed");
    const procCwd = "/proc/" + s.child.pid + "/cwd", inode = statSync(procCwd, { bigint: true });
    const actual = { device: String(inode.dev), inode: String(inode.ino), birthtime: String(inode.birthtimeNs) };
    if (!realpathSync(procCwd) || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("launcher cwd changed");
  },
  async stop(name) {
    const s = units.get(name); if (!s) throw new Error("unit absent");
    if (!s.done) {
      const closed = new Promise(resolve => s.child.once("close", resolve));
      try { process.kill(-s.child.pid, "SIGKILL"); } catch { s.child.kill("SIGKILL"); }
      await closed;
    }
    stopped.add(name + ":" + s.invocation); units.delete(name); rmSync(s.directory, { recursive: true });
  },
  async terminal(name, invocation) { return stopped.has(name + ":" + invocation); },
  // Do NOT pretend this protocol simulator measures escaped descendants or a
  // pinned Linux cgroup. Failed executions retain original-unit quarantine.
  async originalEmpty() { return undefined; },
};
export const runGitCheckoutVerification = (options: Parameters<typeof run>[0]) => run({ ...options, testContainmentBackend: backend,
  testRecoveryEvidence: true, onExecution: async execution => {
    const hook = globalThis[Symbol.for("pi-web:test-human-check-recording")];
    await hook?.("before", execution, options); await options.onExecution(execution); await hook?.("after", execution, options);
  } });`);
const jiti = createJiti(import.meta.url, { alias: { "@/lib/git-checkout-verification": shim, "@": process.cwd() }, moduleCache: false });
const { GET, POST } = await jiti.import("./route.ts");
const { SessionManager } = await jiti.import("@earendil-works/pi-coding-agent");
const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../../lib/session-reader.ts");
const { readGitWorkflowSettingsDocument, writeGitWorkflowSettingsDocument } = await jiti.import("../../../../lib/git-workflow-settings-store.ts");
const native = await jiti.import(real);
const { readGitAction } = await jiti.import("../../../../lib/git-action-journal.ts");
const { inspectGitOperationAdmission, readUnresolvedGitCheckRecovery } = await jiti.import("../../../../lib/git-operation-admission.ts");
const { selectGitProjectResources } = await jiti.import("../../../../lib/git-project-resources.ts");
const { readProjectAuthorization, saveProjectAuthorization } = await jiti.import("../../../../lib/git-project-authorization.ts");
const { POST: commitPOST } = await jiti.import("../commit/route.ts");
const commit = (body) => commitPOST(new Request("http://localhost/api/git/commit", { method: "POST", body: JSON.stringify(body) }));
const hookKey = Symbol.for("pi-web:test-human-check-recording");
const exec = promisify(execFile);
const git = async (cwd, ...args) => (await exec("git", ["-C", cwd, ...args])).stdout.trim();
const get = (id) => GET(new Request(`http://localhost/api/git/verification?sessionId=${encodeURIComponent(id)}`));
const post = (body, signal) => POST(new Request("http://localhost/api/git/verification", { method: "POST", body: JSON.stringify(body), signal }));
const op = (id, operation, extra = {}) => ({ sessionId: id, operation, ...extra });
const consent = (f, preview, operation) => op(f.id, operation, { previewId: preview.previewId, revision: preview.revision });
after(async () => {
  for (const item of globalThis[Symbol.for("pi-web:human-commit-checks:v1")]?.pending.values() ?? []) { clearTimeout(item.timer); item.controller?.abort(); item.actions.forEach(({ handle }) => handle.release()); }
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await rm(home, { recursive: true, force: true });
});
async function fixture(t) {
  agentDir = await mkdtemp(join(home, "agent-fixture-")); process.env.PI_CODING_AGENT_DIR = agentDir;
  const cwd = await mkdtemp(join(home, "repo-")); await exec("git", ["init", "-qb", "main", cwd]);
  await git(cwd, "config", "user.name", "Fixture"); await git(cwd, "config", "user.email", "fixture@example.invalid");
  await writeFile(join(cwd, "a"), "base\n"); await git(cwd, "add", "a"); await git(cwd, "commit", "-qm", "base");
  const sm = SessionManager.create(cwd); sm.appendMessage({ role: "user", content: "fixture", timestamp: Date.now() });
  sm.appendMessage({ role: "assistant", content: [{ type: "text", text: "fixture" }], timestamp: Date.now() });
  sm.appendCustomEntry("pi-web:tool-selection", { version: 1, toolNames: [] });
  const id = sm.getSessionId(); cacheSessionPath(id, sm.getSessionFile()); allowFileRoot(cwd);
  const recipe = (label, requiredStage) => ({ label, argv: [process.execPath, "-e", "process.exit(0)"], ...(requiredStage ? { requiredStage } : {}) });
  writeGitWorkflowSettingsDocument({ version: 1, paused: false, global: {}, projects: { [cwd]: { commits: "manual", checks:
    [recipe("omitted remains integration"), recipe("commit prerequisite", "commit"), recipe("handoff", "handoff"), recipe("manual-only", "none")] } } }, agentDir);
  t.after(() => invalidateSessionPathCache(id));
  return { cwd, sm, id };
}
async function ok(response) { assert.equal(response.status, 200, await response.clone().text()); return response.json(); }
test("requirements source is the saved ordinary Chat-only session; only original commit-stage indexes are listed", async (t) => {
  const f = await fixture(t), head = await git(f.cwd, "rev-parse", "HEAD"), index = await readFile(join(f.cwd, ".git/index"));
  await writeFile(join(f.cwd, "a"), "dirty workspace\n");
  const body = await ok(await get(f.id));
  assert.deepEqual(body.checks, [{ checkIndex: 1, label: "commit prerequisite" }]);
  assert.equal(body.evidenceScope, "working-workspace"); assert.equal(body.candidateTreeVerified, false); assert.equal(body.repositoryChecksWaived, false);
  assert.deepEqual(body.receipts, []); assert.match(body.instructionWarning, /instructions still apply/);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), head); assert.deepEqual(await readFile(join(f.cwd, ".git/index")), index);
  assert.equal(SessionManager.open(f.sm.getSessionFile()).getEntries().filter((e) => e.customType === "pi-web:git-action").length, 0);
});
test("raw command/env/proof/agentDir/cwd/skip and non-commit indexes never launch a command or produce receipts", async (t) => {
  const f = await fixture(t), before = await git(f.cwd, "rev-parse", "HEAD");
  for (const [key, value] of Object.entries({ argv: ["evil"], env: {}, proof: {}, agentDir, cwd: f.cwd, skip: true })) {
    assert.equal((await post(op(f.id, "preview", { checkIndexes: [1], [key]: value }))).status, 400);
  }
  for (const checkIndex of [0, 2, 3, 11]) assert.equal((await post(op(f.id, "preview", { checkIndexes: [checkIndex] }))).status, 409);
  for (const receiptIds of [["00000000-0000-0000-0000-000000000000"], ["expired"]]) assert.notEqual((await post(op(f.id, "status", { receiptIds }))).status, 200);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), before);
});
test("Off/Pause/opt-out/subagent source restrictions stay live for human requirements and runs", async (t) => {
  const f = await fixture(t), document = readGitWorkflowSettingsDocument(agentDir);
  writeGitWorkflowSettingsDocument({ ...document, paused: true }, agentDir); assert.equal((await get(f.id)).status, 409);
  writeGitWorkflowSettingsDocument({ ...document, global: { enabled: false } }, agentDir); assert.equal((await get(f.id)).status, 409);
  writeGitWorkflowSettingsDocument(document, agentDir);
  f.sm.appendCustomEntry("pi-web:subagent", { version: 1 }); assert.equal((await get(f.id)).status, 409);
});
test("no configured commit prerequisite is explicitly not an instruction waiver", async (t) => {
  const f = await fixture(t), document = readGitWorkflowSettingsDocument(agentDir);
  delete document.projects[f.cwd].checks; writeGitWorkflowSettingsDocument(document, agentDir);
  const body = await ok(await get(f.id)); assert.equal(body.status, "no-defined"); assert.deepEqual(body.checks, []); assert.equal(body.repositoryChecksWaived, false);
});
test("required recipe discovery is independent of check permission; disabled/Deny execution still cannot mint or consume evidence", async (t) => {
  for (const restriction of ["disabled", "deny"]) await t.test(restriction, async (t) => {
    const f = await fixture(t);
    if (restriction === "disabled") {
      const doc = readGitWorkflowSettingsDocument(agentDir); doc.projects[f.cwd].checkConfirmation = "disabled"; writeGitWorkflowSettingsDocument(doc, agentDir);
    } else {
      const source = await selectGitProjectResources(f.cwd), status = await readProjectAuthorization(source, undefined, agentDir);
      await saveProjectAuthorization(source, undefined, "project", "checks", "deny", status, agentDir);
    }
    const requirements = await ok(await get(f.id)); assert.equal(requirements.status, "required"); assert.equal(requirements.checks[0].checkIndex, 1);
    assert.equal((await post(op(f.id, "preview", { checkIndexes: [1] }))).status, 409);
    await writeFile(join(f.cwd, "a"), "still requires real checks\n");
    assert.equal((await commit({ sessionId: f.id, operation: "preview", paths: ["a"], message: "not approved" })).status, 409);
    assert.deepEqual(requirements.receipts, []);
    assert.equal(SessionManager.open(f.sm.getSessionFile()).getEntries().filter(e => e.customType === "pi-web:git-action").length, 0);
  });
});

test("native v3 reader is present; missing process previews never fabricate working-workspace passes", async (t) => {
  assert.equal(typeof native.gitCommitWorkingWorkspaceReceiptReader?.validate, "function");
  const f = await fixture(t), before = await git(f.cwd, "rev-parse", "HEAD");
  const response = await post(op(f.id, "run", { previewId: "00000000-0000-0000-0000-000000000000", revision: "fake" })); assert.equal(response.status, 409);
  assert.deepEqual((await ok(await get(f.id))).receipts, []); assert.equal(await git(f.cwd, "rev-parse", "HEAD"), before);
});
test("single-use human native v3 previews: decline no command/commit; dirty bytes with identical porcelain invalidate run", async (t) => {
  const f = await fixture(t); await writeFile(join(f.cwd, "a"), "dirty A\n");
  const before = await git(f.cwd, "rev-parse", "HEAD"), porcelain = await git(f.cwd, "status", "--porcelain");
  const declined = await ok(await post(op(f.id, "preview", { checkIndexes: [1] })));
  assert.equal((await ok(await post(consent(f, declined, "decline")))).status, "declined");
  assert.equal((await post(consent(f, declined, "run"))).status, 409); assert.deepEqual((await ok(await get(f.id))).receipts, []);
  const preview = await ok(await post(op(f.id, "preview", { checkIndexes: [1] })));
  await writeFile(join(f.cwd, "a"), "dirty B\n"); assert.equal(await git(f.cwd, "status", "--porcelain"), porcelain);
  assert.equal((await post(consent(f, preview, "run"))).status, 409); assert.equal((await post(consent(f, preview, "run"))).status, 409);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), before);
  assert.equal((await readGitAction(preview.actionId)).record.state, "blocked");
});
test("native v3 Run approves saved recipe/source/cwd/env only and never commits afterward; expired/wrong IDs are refused", async (t) => {
  const f = await fixture(t); await writeFile(join(f.cwd, "a"), "dirty workspace\n"); const head = await git(f.cwd, "rev-parse", "HEAD");
  const preview = await ok(await post(op(f.id, "preview", { checkIndexes: [1] })));
  const result = await ok(await post(consent(f, preview, "run"))); assert.equal(result.status, "passed"); assert.equal(result.receipts.length, 1);
  assert.equal(await git(f.cwd, "rev-parse", "HEAD"), head); assert.equal((await post(consent(f, preview, "run"))).status, 409);
  const receiptIds = result.receipts.map((r) => r.id); assert.equal((await post(op(f.id, "status", { receiptIds }))).status, 200);
  const current = SessionManager.open(f.sm.getSessionFile());
  current.appendMessage({ role: "toolResult", toolCallId: "actual-check", toolName: "git_workflow", content: [{ type: "text", text: "actual required check completed" }], isError: false, timestamp: Date.now() });
  assert.equal((await post(op(f.id, "status", { receiptIds }))).status, 200, "ordinary check-result history must not invalidate actual evidence");
  const now = Date.now; Date.now = () => result.receipts[0].expiresAt + 1;
  try { assert.equal((await post(op(f.id, "status", { receiptIds }))).status, 409); } finally { Date.now = now; }
  assert.equal((await post(op(f.id, "status", { receiptIds }))).status, 409, "expired process capabilities never resurrect");
});

test("historical inherited commit prerequisites refuse explicitly; integration-only inheritance stays no-required, never no-defined", async (t) => {
  const f = await fixture(t), doc = readGitWorkflowSettingsDocument(agentDir);
  delete doc.projects[f.cwd].checks;
  doc.global.checks = [{ label: "inherited required", argv: [process.execPath, "-e", "process.exit(0)"], requiredStage: "commit" }];
  writeGitWorkflowSettingsDocument(doc, agentDir);
  const response = await get(f.id); assert.equal(response.status, 409); assert.equal((await response.json()).code, "unsupported-inheritance");
  assert.equal((await post(op(f.id, "preview", { checkIndexes: [0] }))).status, 409);
  delete doc.global.checks[0].requiredStage; writeGitWorkflowSettingsDocument(doc, agentDir);
  const body = await ok(await get(f.id)); assert.equal(body.status, "no-required"); assert.deepEqual(body.checks, []); assert.equal(body.repositoryChecksWaived, false);
});

test("actual measured facts are durably journalled before native settlement; no callback metadata is a published receipt", async (t) => {
  const f = await fixture(t), preview = await ok(await post(op(f.id, "preview", { checkIndexes: [1] })));
  let before = false, after = false;
  globalThis[hookKey] = async (phase, execution, options) => {
    const admission = inspectGitOperationAdmission(options.agentDir, join(f.cwd, ".git"));
    assert.equal(admission.admitted, false); assert.ok(admission.actionIds.includes(preview.actionId));
    assert.equal(native.lookupGitCheckoutVerificationReceipt(execution.receipt.id), undefined);
    const { record } = await readGitAction(preview.actionId);
    assert.equal(record.state, "executing");
    if (phase === "before") { before = true; assert.equal(record.outcome, undefined); }
    else { after = true; assert.deepEqual(record.outcome.checkoutVerification.runs, [execution]); }
  };
  let response;
  try { response = await post(consent(f, preview, "run")); } finally { delete globalThis[hookKey]; }
  const result = await ok(response); assert.equal(before, true); assert.equal(after, true);
  assert.equal(inspectGitOperationAdmission(agentDir, join(f.cwd, ".git")).admitted, true);
  assert.equal((await readGitAction(preview.actionId)).record.state, "succeeded");
  assert.equal(native.lookupGitCheckoutVerificationReceipt(result.receipts[0].id)?.version, 3);
});

test("presettlement journal I/O failure preserves original measured unit/receipt IDs, no passing receipt and unresolved admission", async (t) => {
  const f = await fixture(t), preview = await ok(await post(op(f.id, "preview", { checkIndexes: [1] })));
  const path = join(agentDir, "pi-web/git-actions/v1", preview.actionId, "record.json");
  let measured, original;
  globalThis[hookKey] = async (phase, execution) => {
    if (phase === "before") { measured = structuredClone(execution); original = await readFile(path); await writeFile(path, "corrupt fixture journal"); }
  };
  let response;
  try { response = await post(consent(f, preview, "run")); }
  finally { delete globalThis[hookKey]; }
  assert.equal(response.status, 409); const body = await response.json(); assert.equal(body.recoveryRequired, true);
  assert.deepEqual(body.knownRuns, [measured]); assert.equal(body.receipts, undefined);
  assert.equal(native.lookupGitCheckoutVerificationReceipt(measured.receipt.id), undefined);
  assert.equal(inspectGitOperationAdmission(agentDir, join(f.cwd, ".git")).admitted, false, "corrupt journal evidence cannot admit anything");
  await writeFile(path, original);
  const admission = inspectGitOperationAdmission(agentDir, join(f.cwd, ".git"));
  assert.equal(admission.admitted, false); assert.ok(admission.actionIds.includes(preview.actionId));
  assert.equal(readUnresolvedGitCheckRecovery(agentDir, join(f.cwd, ".git")).unit, measured.unit);
  assert.equal((await readGitAction(preview.actionId)).record.state, "recovery-required");
  assert.equal((await get(f.id)).status, 409);
});

test("source authority change-and-restore during durable callback fences publication and keeps original-unit quarantine", async (t) => {
  const f = await fixture(t), preview = await ok(await post(op(f.id, "preview", { checkIndexes: [1] })));
  globalThis[hookKey] = async (phase) => {
    if (phase === "after") {
      const doc = readGitWorkflowSettingsDocument(agentDir);
      writeGitWorkflowSettingsDocument({ ...doc, paused: true }, agentDir); writeGitWorkflowSettingsDocument(doc, agentDir);
    }
  };
  let response;
  try { response = await post(consent(f, preview, "run")); } finally { delete globalThis[hookKey]; }
  assert.equal(response.status, 409); const body = await response.json(); assert.equal(body.recoveryRequired, true);
  assert.equal(body.knownRuns.length, 1); assert.equal(native.lookupGitCheckoutVerificationReceipt(body.knownRuns[0].receipt.id), undefined);
  assert.equal(inspectGitOperationAdmission(agentDir, join(f.cwd, ".git")).admitted, false);
  assert.equal((await readGitAction(preview.actionId)).record.state, "recovery-required");
});

test("genuine human required receipts gate staged commit confirmation while preserving unrelated index entries and unstaged hunks", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.cwd, "a"), "selected staged\n"); await git(f.cwd, "add", "a");
  await writeFile(join(f.cwd, "a"), "selected staged\nunstaged hunk\n");
  await writeFile(join(f.cwd, "other"), "unselected staged\n"); await git(f.cwd, "add", "other");
  const request = { sessionId: f.id, operation: "preview", paths: ["a"], message: "exact staged", mode: "staged" };
  assert.equal((await commit(request)).status, 409, "commit preview cannot waive missing required evidence");
  const preview = await ok(await post(op(f.id, "preview", { checkIndexes: [1] })));
  const run = await ok(await post(consent(f, preview, "run"))), receiptIds = run.receipts.map(r => r.id);
  const candidate = await ok(await commit({ ...request, receiptIds }));
  assert.deepEqual(candidate.verification.receiptIds, receiptIds); assert.equal(candidate.verification.candidateTreeVerified, false);
  const confirm = { sessionId: f.id, operation: "confirm", actionId: candidate.actionId, preview: candidate.preview, message: request.message };
  assert.equal((await commit(confirm)).status, 409, "confirmation cannot replace the preview's exact receipt set");
  const result = await ok(await commit({ ...confirm, receiptIds })); assert.equal(result.status, "committed");
  assert.equal(await git(f.cwd, "show", "HEAD:a"), "selected staged");
  assert.equal(await git(f.cwd, "diff", "--cached", "--name-only"), "other");
  assert.equal(await git(f.cwd, "diff", "--name-only"), "a");
  assert.match(await readFile(join(f.cwd, "a"), "utf8"), /unstaged hunk/);
});
