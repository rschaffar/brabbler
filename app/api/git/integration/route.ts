import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { NextResponse } from "next/server";
import { getAllowedFileRoots, isExistingFilePathAllowed, isFilePathAllowed } from "@/lib/file-access";
import { gitExecEnv } from "@/lib/git-exec";
import { beginGitAction, snapshotGitActionCandidate, type GitActionHandle } from "@/lib/git-action-controller";
import { humanGitActionSink, readHumanGitSessionManager, type HumanGitScope } from "@/lib/git-action-human";
import { GIT_ACTION_ID_PATTERN, type GitActionOutcome, type GitActionDiagnosticWarning } from "@/lib/git-action-types";
import { captureGitActionCandidateSnapshot } from "@/lib/git-action-journal";
import { confirmIntegration, prepareIntegration, confirmFastForwardIntegration, prepareFastForwardIntegration, readGitIntegrationNativeOutcome, retireGitIntegrationPlan,
  type LocalIntegrationPlan } from "@/lib/git-integration";
import { selectGitProjectResources } from "@/lib/git-project-resources";
import { reviewGitBranches, type GitReview } from "@/lib/git-review";
import { captureGitCheckRecoverySnapshot, gitCheckRecoveryDigest, inspectGitVerificationReceipts, lookupGitVerificationReceipt, runGitVerification, type VerificationReceipt } from "@/lib/git-verification";
import { createGitCheckCohort, retireGitCheckCohort, readGitCheckReceiptCohortMetadata } from "@/lib/git-check-runner";
import { hasExtendedGitCheckRecipe } from "@/lib/git-check-recipe";
import { captureHumanGitMutationAuthority } from "@/lib/git-human-mutation-authority";
import { readSessionGitWorkflow } from "@/lib/git-workflow-policy";
import { assertManagedGitAction, assertManagedGitProjectDenial, assertManagedGitWorkspace, ManagedGitAccessError, watchManagedGitAccess } from "@/lib/git-workflow-access";
import { samePath, toNativePath } from "@/lib/paths";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { readSessionHeader, resolveSessionPath } from "@/lib/session-reader";
import type { SessionEntry } from "@/lib/types";

export const dynamic = "force-dynamic";
const exec = promisify(execFile);
const MAX_BODY = 4096, RECEIPT_TTL = 15 * 60_000;
const ID = /^[a-zA-Z0-9_-]{1,128}$/;
const unavailable = { status: "unavailable", reason: "storage-unavailable" } as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function error(message: string, status: number) { return NextResponse.json({ error: message }, { status }); }
class ScopeError extends Error { constructor(readonly status: number) { super("Saved session or checkout unavailable"); } }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]): boolean { return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)); }
function validId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function indexes(value: unknown): value is number[] { return Array.isArray(value) && value.length > 0 && value.length <= 12 &&
  value.every(i => Number.isInteger(i) && i >= 0 && i < 12) && new Set(value).size === value.length; }
async function allowed(cwd: string, roots: Awaited<ReturnType<typeof getAllowedFileRoots>>) {
  return isFilePathAllowed(cwd, roots) && isExistingFilePathAllowed(cwd, roots) && statSync(cwd).isDirectory() && samePath(cwd, realpathSync(cwd));
}
// No request cwd/ref. Resolve actual registered target from the saved workflow.
async function targetCheckout(cwd: string, branch: string): Promise<string> {
  const { stdout } = await exec("git", ["--no-optional-locks", "-C", cwd, "worktree", "list", "--porcelain", "-z"], {
    encoding: "utf8", env: gitExecEnv(), timeout: 15000, maxBuffer: 1024 * 1024 });
  let location = "", target = "";
  for (const line of stdout.split("\0")) {
    if (line.startsWith("worktree ")) location = toNativePath(line.slice(9));
    if (line === `branch refs/heads/${branch}`) { if (target) throw new Error("ambiguous target"); target = location; }
  }
  if (!target || samePath(target, cwd)) throw new Error("target checkout unavailable");
  return target;
}
async function session(id: string, action?: "checks" | "integration") {
  const file = await resolveSessionPath(id);
  if (!file) throw new ScopeError(404);
  const header = readSessionHeader(file);
  if (!header || header.id !== id || !header.cwd) throw new Error("session identity mismatch");
  const cwd = header.cwd, scope = { sessionId: id, sessionFile: file, cwd }, agentDir = getAgentDir();
  // Capture the actual owner BEFORE roots, policy, trust and native awaits.
  const authority = captureHumanGitMutationAuthority(scope, agentDir);
  const roots = await getAllowedFileRoots();
  if (!await allowed(cwd, roots)) throw new ScopeError(403);
  const policy = async () => {
    authority.assertCurrentSync();
    const manager = readHumanGitSessionManager(scope);
    const state = await assertManagedGitAction(cwd, manager.getEntries() as SessionEntry[], action ?? "integration", "human", agentDir);
    await assertManagedGitWorkspace(state, cwd);
    if (action) {
      const confirmation = action === "checks" ? "checkConfirmation" : "integrateConfirmation";
      if (state.resolved.session.values[confirmation] === "disabled" || state.task.kind === "managed" && state.task.settings[confirmation] === "disabled") throw new ManagedGitAccessError("This Git stage is disabled");
      await assertManagedGitProjectDenial(cwd, { sessionId: id, sessionFile: file, sessionCwd: cwd }, action, agentDir);
    }
    authority.assertCurrentSync();
    return readSessionGitWorkflow(manager.getEntries() as SessionEntry[]);
  };
  const saved = await policy();
  if (!saved?.integration || !["merge", "ff"].includes(saved.integration.method)) throw new Error("saved local target required");
  const source = await selectGitProjectResources(cwd);
  if (!samePath(source.cwd, cwd) || saved.mode === "current" && saved.branch && saved.branch !== source.branch) throw new Error("feature checkout changed");
  const targetCwd = await targetCheckout(cwd, saved.integration.targetBranch), target = await selectGitProjectResources(targetCwd);
  if (!samePath(target.cwd, targetCwd) || target.branch !== saved.integration.targetBranch || !await allowed(targetCwd, roots)) throw new Error("target unavailable");
  // Later dependencies derive from the SAME original opaque map, not a new fence.
  authority.select(source, target);
  const trusted = () => getProjectTrustStatus(cwd, agentDir).trusted && getProjectTrustStatus(targetCwd, agentDir).trusted;
  if (!trusted()) throw new Error("trust both checkouts required");
  authority.assertCurrentSync();
  return { cwd, targetCwd, featureBranch: source.branch, agentDir, policy, saved, trusted, scope, source, target, authority };
}
type Context = Awaited<ReturnType<typeof session>>;
function matches(review: GitReview, r: VerificationReceipt, c: Context) {
  return lookupGitVerificationReceipt(r.id) === r && r.dependencyVersion === 2 && r.sessionId === c.scope.sessionId && samePath(r.cwd, c.cwd) && samePath(r.targetCwd, c.targetCwd) &&
    r.featureBranch === review.featureBranch && r.targetBranch === review.targetBranch && r.featureOid === review.featureOid && r.targetOid === review.targetOid &&
    r.featureTreeOid === review.featureTreeOid && r.targetTreeOid === review.targetTreeOid && r.mergeTreeOid === review.mergeTreeOid && r.policyDigest === hash(c.saved) &&
    r.exitStatus === 0 && Number.isSafeInteger(r.finishedAt) && r.finishedAt <= Date.now() && Date.now() - r.finishedAt < RECEIPT_TTL && r.checkIndex >= 0 && r.checkIndex < (c.saved.checks?.length ?? 0);
}
// Inert correlation from genuine private cohort membership, not public IDs or
// restored JSON. The native validators remain the only execution authority.
function receiptView(r: VerificationReceipt) {
  const batch = lookupGitVerificationReceipt(r.id) === r ? readGitCheckReceiptCohortMetadata(r.id) : undefined;
  return { id: r.id, checkIndex: r.checkIndex, startedAt: r.startedAt, finishedAt: r.finishedAt,
    logDigest: r.logDigest, ...(batch ? { batch } : {}) };
}
async function guard(c: Context, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (JSON.stringify(await c.policy()) !== JSON.stringify(c.saved)) throw new ManagedGitAccessError("Workflow policy changed");
  const roots = await getAllowedFileRoots();
  if (!await allowed(c.cwd, roots) || !await allowed(c.targetCwd, roots) || !c.trusted()) throw new ManagedGitAccessError("Checkout no longer available");
  signal?.throwIfAborted(); c.authority.assertCurrentSync();
}
interface Diagnostic { id: string; handle?: GitActionHandle; diagnostics?: GitActionDiagnosticWarning }
function observeDiagnostics(action: Diagnostic) {
  // Optional-diagnostics controller migration: this inert warning is never proof.
  const handle = action.handle;
  if (handle?.diagnosticsUnavailable || handle?.diagnostics) {
    const warning = handle.diagnostics ?? unavailable;
    if (!action.diagnostics || warning.reason === "storage-unavailable") action.diagnostics = warning;
  }
}
async function update(action: Diagnostic, state: Parameters<GitActionHandle["update"]>[0], extra?: Parameters<GitActionHandle["update"]>[1]) {
  try { if (action.handle) await action.handle.update(state, extra); else action.diagnostics = unavailable; }
  catch { action.diagnostics = unavailable; }
  observeDiagnostics(action);
}
async function begin(c: Context, candidate: Parameters<typeof beginGitAction>[2]): Promise<Diagnostic> {
  // Pure validation precedes optional storage; an invalid candidate isn't an I/O failure.
  const captured = captureGitActionCandidateSnapshot(candidate);
  const handle = await beginGitAction(humanGitActionSink(c.scope), "human", captured, c.agentDir);
  const action: Diagnostic = { id: handle.record.id, handle };
  observeDiagnostics(action);
  return action;
}
interface Approval { phase: "preparing" | "awaiting" | "approved" | "retired"; candidate?: string; plan?: LocalIntegrationPlan; signal?: AbortSignal }
interface Pending { context: Context; action: Diagnostic; plan: LocalIntegrationPlan; approval: Approval; intended: GitActionOutcome; timer: ReturnType<typeof setTimeout> }
const pendingKey = Symbol.for("pi-web:human-native-integration:v1");
function pending(): Map<string, Pending> { const g = globalThis as unknown as Record<symbol, Map<string, Pending>>; return g[pendingKey] ??= new Map(); }
function retire(id: string) { const p = pending().get(id); if (!p) return; pending().delete(id); clearTimeout(p.timer); p.approval.phase = "retired"; retireGitIntegrationPlan(p.plan); p.action.handle?.release(); }
function sameScope(a: HumanGitScope, b: HumanGitScope) { return a.sessionId === b.sessionId && samePath(a.sessionFile, b.sessionFile) && samePath(a.cwd, b.cwd); }
async function bodyOf(req: Request): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > MAX_BODY) throw new Error("body too large");
  const reader = req.body?.getReader(); if (!reader) throw new Error("missing body");
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; if (size > MAX_BODY) { await reader.cancel(); throw new Error("body too large"); } chunks.push(value); } }
  finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams, id = params.get("sessionId");
    if ([...params.keys()].length !== 1 || !validId(id)) return error("Valid sessionId required", 400);
    const c = await session(id), review = await reviewGitBranches(c.cwd, c.featureBranch, c.saved.integration!.targetBranch);
    c.authority.assertCurrentSync();
    return NextResponse.json({ review, checks: c.saved.checks?.map((check, checkIndex) => ({ checkIndex, label: check.label })) ?? [],
      receipts: inspectGitVerificationReceipts(id).filter(r => matches(review, r, c)).map(receiptView) });
  } catch (cause) { return error("Integration review unavailable", cause instanceof ScopeError ? cause.status : 409); }
}
export async function POST(req: Request) {
  let input: Record<string, unknown>;
  try { const parsed = await bodyOf(req); if (!record(parsed)) return error("Invalid request", 400); input = parsed; }
  catch { return error("Invalid or oversized JSON", 400); }
  const id = input.sessionId, op = input.operation;
  if (!validId(id)) return error("Valid sessionId required", 400);
  const single = op === "verify" && exact(input, ["sessionId", "operation", "checkIndex"]) && indexes([input.checkIndex]);
  const batch = op === "verify" && exact(input, ["sessionId", "operation", "checkIndexes"]) && indexes(input.checkIndexes);
  if (!single && !batch && !(op === "plan" && exact(input, ["sessionId", "operation", "receiptIds"]) && Array.isArray(input.receiptIds) &&
    input.receiptIds.length > 0 && input.receiptIds.length <= 12 && input.receiptIds.every(validId) && new Set(input.receiptIds).size === input.receiptIds.length) &&
    !(op === "confirm" && exact(input, ["sessionId", "operation", "planId", "approvePlanId", "actionId"]) && validId(input.planId) && validId(input.approvePlanId) &&
      typeof input.actionId === "string" && GIT_ACTION_ID_PATTERN.test(input.actionId))) return error("Invalid integration request", 400);
  try {
    const c = await session(id, op === "verify" ? "checks" : "integration");
    if (!c.saved.checks?.length) return error("Saved verification checks required", 409);
    if (c.saved.checks.some(hasExtendedGitCheckRecipe)) return error("Legacy paired integration does not support extended check recipes; no required checks were waived", 409);
    await guard(c, req.signal);
    for (const [key, p] of pending()) if (p.plan.expiresAt <= Date.now()) retire(key);
    if (op === "confirm") {
      if (input.planId !== input.approvePlanId) return error("Exact plan approval required", 400);
      const p = pending().get(input.actionId as string);
      if (!p || !sameScope(p.context.scope, c.scope) || p.plan.planId !== input.planId || p.plan.expiresAt <= Date.now() || p.approval.phase !== "awaiting") return error("Original process preview required", 409);
      // Consume this exact approval independently of optional history state.
      pending().delete(p.action.id); clearTimeout(p.timer); p.approval.phase = "approved"; p.approval.signal = req.signal;
      let enteredNative = false;
      try {
        await guard(p.context, req.signal);
        await update(p.action, "executing", { decision: "approved", intended: p.intended });
        await guard(p.context, req.signal); // original authority after diagnostics
        const confirm = "method" in p.plan ? confirmFastForwardIntegration : confirmIntegration;
        enteredNative = true;
        const result = await confirm(p.plan.planId, input.approvePlanId as string, id);
        const native = readGitIntegrationNativeOutcome(result);
        if (!native) throw new Error("Native completion adapter unavailable");
        await update(p.action, result.status === "integrated" ? "succeeded" : "recovery-required", { outcome: { ...p.intended, status: result.status } });
        return NextResponse.json({ ...result, actionId: p.action.id, nativeOutcome: native,
          ...(p.action.diagnostics ? { diagnostics: p.action.diagnostics } : {}) });
      } catch (cause) {
        const native = readGitIntegrationNativeOutcome(cause);
        // Missing original native facts are NOT proof of no effect. Once inside
        // the engine, an unknown exception must never invite refresh-and-retry.
        const partial = native ? native.status !== "no-checkout-effect" : enteredNative;
        await update(p.action, partial ? "recovery-required" : req.signal.aborted ? "cancelled" : "blocked",
          partial ? { outcome: { status: "partial-state" }, reason: "Native effects require inspection; do not repeat this operation." } : undefined);
        return NextResponse.json({ actionId: p.action.id, ...(native ? { nativeOutcome: native } : {}),
          ...(partial ? { status: "partial-state", recoveryRequired: true, intended: p.intended } : {}),
          error: partial ? "Native integration may have changed checkout, refs or index. Inspect measured facts; do not retry this operation." : "Integration rejected before checkout effects; original candidate is stale, revoked or contended. No automatic retry.",
          ...(p.action.diagnostics ? { diagnostics: p.action.diagnostics } : {}) }, { status: 409 });
      } finally { p.approval.phase = "retired"; retireGitIntegrationPlan(p.plan); p.action.handle?.release(); }
    }
    const review = await reviewGitBranches(c.cwd, c.featureBranch, c.saved.integration!.targetBranch);
    if (op === "verify") {
      const checkIndexes = single ? [input.checkIndex as number] : input.checkIndexes as number[];
      if (checkIndexes.some(i => !c.saved.checks?.[i])) return error("Saved check index required", 409);
      const cohort = createGitCheckCohort(checkIndexes), actions: Diagnostic[] = [], receipts: VerificationReceipt[] = [];
      const watcher = await watchManagedGitAccess(() => guard(c, req.signal), req.signal);
      try {
        for (const checkIndex of checkIndexes) {
          const action = await begin(c, { ...snapshotGitActionCandidate({ kind: "checks", featureCwd: c.cwd, targetCwd: c.targetCwd,
            featureBranch: review.featureBranch, targetBranch: review.targetBranch, checks: [c.saved.checks[checkIndex]] }, c.source, c.target),
            featureOid: review.featureOid, targetOid: review.targetOid, candidateTreeOid: review.mergeTreeOid });
          actions.push(action); await update(action, "executing", { decision: "approved" });
          await guard(c, watcher.signal);
          const snapshot = await captureGitCheckRecoverySnapshot(c.cwd, c.targetCwd, review, hash(c.saved), gitCheckRecoveryDigest(checkIndex, c.saved.checks[checkIndex].argv));
          c.authority.assertCurrentSync();
          const receipt = await runGitVerification({ sessionId: id, cwd: c.cwd, agentDir: c.agentDir, review, checkIndex, actionId: action.id, cohort,
            getPolicy: async () => { await guard(c, watcher.signal); return c.saved; }, isTrusted: c.trusted, signal: watcher.signal,
            readAuthorityRevisionSync: c.authority.readAuthorityRevisionSync });
          if (!matches(review, receipt, c)) throw new Error("Original published receipt required");
          if (receipt.diagnostics) action.diagnostics = unavailable;
          await update(action, "succeeded", { outcome: { status: "passed", featureOid: receipt.featureOid, targetOid: receipt.targetOid } });
          const current = await captureGitCheckRecoverySnapshot(c.cwd, c.targetCwd, review, hash(c.saved), gitCheckRecoveryDigest(checkIndex, c.saved.checks[checkIndex].argv));
          c.authority.assertCurrentSync();
          if (hash(current) !== hash(snapshot) || !matches(review, receipt, c)) throw new Error("Original checked bytes changed during diagnostics");
          receipts.push(receipt);
        }
        return NextResponse.json({ ...(single ? { receipt: receiptView(receipts[0]), actionId: actions[0].id } : { receipts: receipts.map(receiptView), actionIds: actions.map(a => a.id) }),
          ...(actions.some(a => a.diagnostics) ? { diagnostics: actions.find(a => a.diagnostics)!.diagnostics } : {}) });
      } catch {
        retireGitCheckCohort(cohort);
        for (const action of actions) if (action.handle?.record.state !== "succeeded") await update(action, watcher.signal.aborted ? "cancelled" : "failed", { outcome: { status: watcher.signal.aborted ? "cancelled" : "failed" } });
        return NextResponse.json({ actionId: actions.at(-1)?.id, error: "Verification did not produce current successful evidence. Check commands can change files; inspect both checkouts.",
          ...(actions.some(a => a.diagnostics) ? { diagnostics: actions.find(a => a.diagnostics)!.diagnostics } : {}) }, { status: 409 });
      } finally { watcher.dispose(); actions.forEach(a => a.handle?.release()); }
    }
    const receiptIds = input.receiptIds as string[], receipts = inspectGitVerificationReceipts(id);
    if (receiptIds.length !== c.saved.checks.length || receiptIds.some((rid, index) => {
      const r = receipts.find(receipt => receipt.id === rid); return !r || r.checkIndex !== index || !matches(review, r, c);
    })) return error("Current successful receipts required for every saved check", 409);
    if (pending().size >= 128) return error("Preview capacity reached", 409);
    const approval: Approval = { phase: "preparing", signal: req.signal };
    const nativeAuthority = c.authority.nativeAuthority(binding => {
      approval.signal?.throwIfAborted();
      if (approval.phase !== "preparing" && approval.phase !== "approved") throw new Error("Original exact human approval required");
      if (approval.candidate && approval.candidate !== binding.candidateSha256) throw new Error("Exact original candidate required");
      approval.candidate ??= binding.candidateSha256;
      if (approval.plan && (approval.plan.expiresAt <= Date.now() || JSON.stringify(approval.plan.receiptIds) !== JSON.stringify(receiptIds))) throw new Error("Original plan expired or mismatched");
      for (const rid of receiptIds) { const r = lookupGitVerificationReceipt(rid); if (!r || !matches(review, r, c)) throw new Error("Original required receipt revoked"); }
    });
    const options = { sessionId: id, cwd: c.cwd, agentDir: c.agentDir, featureBranch: c.featureBranch, receiptIds, getPolicy: c.policy, nativeAuthority };
    let action: Diagnostic | undefined;
    try {
      const plan = c.saved.integration!.method === "ff" ? await prepareFastForwardIntegration(options) : await prepareIntegration(options);
      approval.plan = plan;
      const resultOid = "method" in plan ? plan.featureOid : plan.mergeOid;
      const { stdout } = await exec("git", ["--no-optional-locks", "-C", c.cwd, "show", "-s", "--format=%ae", resultOid, "--"], {
        encoding: "utf8", env: { ...gitExecEnv(), GIT_NO_REPLACE_OBJECTS: "1" }, timeout: 15000, maxBuffer: 4096 });
      const intended = { ...("method" in plan ? {} : { mergeOid: plan.mergeOid }), tree: plan.review.featureTreeOid,
        parents: "method" in plan ? plan.parents : [plan.review.targetOid, plan.review.featureOid], authorEmail: stdout.trim(),
        featureOid: plan.review.featureOid, targetOid: plan.review.targetOid, targetBranch: plan.review.targetBranch };
      action = await begin(c, { ...snapshotGitActionCandidate({ kind: "integration", featureCwd: c.cwd, targetCwd: c.targetCwd, plan,
        receipts: receiptIds.map(rid => receipts.find(r => r.id === rid)!) }, c.source, c.target), checks: c.saved.checks, candidateTreeOid: plan.review.mergeTreeOid });
      await update(action, "awaiting-decision"); await guard(c, req.signal);
      if (plan.expiresAt <= Date.now()) throw new Error("expired preview");
      approval.phase = "awaiting"; approval.signal = undefined;
      const actionId = action.id, timer = setTimeout(() => retire(actionId), plan.expiresAt - Date.now()); timer.unref?.();
      pending().set(actionId, { context: c, action, plan, approval, intended, timer });
      return NextResponse.json({ actionId, expiresAt: plan.expiresAt, plan, ...(action.diagnostics ? { diagnostics: action.diagnostics } : {}) });
    } catch (cause) { approval.phase = "retired"; if (approval.plan) retireGitIntegrationPlan(approval.plan); if (action) { await update(action, "blocked"); action.handle?.release(); } throw cause; }
  } catch (cause) {
    if (cause instanceof ScopeError) return error(cause.message, cause.status);
    if (cause instanceof ManagedGitAccessError) return error(cause.message, 409);
    if (cause instanceof Error && /^Git integration unavailable: [^\r\n]{1,160}$/.test(cause.message)) return error(cause.message, 409);
    return error("Integration unavailable; refresh review and inspect checkouts", 409);
  }
}
